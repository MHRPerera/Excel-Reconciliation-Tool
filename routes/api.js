const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const { createSession, getSession } = require("../lib/sessions");
const { listSheetNames } = require("../lib/sheetNames");
const { inspectHeader, ingestSheetToSqlite } = require("../lib/ingest");
const { buildAggregates, getCounts, computeCellCompareCounts } = require("../lib/compare");
const { buildReport } = require("../lib/report");

const MAX_FILE_MB = parseInt(process.env.MAX_FILE_MB || "5000", 10); // 5 GB default ceiling

const router = express.Router();

/* ------------------------------------------------------------------ */
/* Session + upload                                                    */
/* ------------------------------------------------------------------ */

router.post("/session", (req, res) => {
  const session = createSession();
  res.json({ sessionId: session.id });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const session = getSession(req.params.sessionId);
    if (!session) return cb(new Error("Unknown or expired session."));
    cb(null, session.dir);
  },
  filename: (req, file, cb) => {
    const which = req.params.which === "b" ? "b" : "a";
    cb(null, `report-${which}.xlsx`);
  },
});
const upload = multer({ storage, limits: { fileSize: MAX_FILE_MB * 1024 * 1024 } });

router.post("/upload/:sessionId/:which", (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) {
      const msg = err.code === "LIMIT_FILE_SIZE" ? `File exceeds the ${MAX_FILE_MB} MB limit configured on this server.` : err.message;
      return res.status(400).json({ error: msg });
    }
    const session = getSession(req.params.sessionId);
    if (!session) return res.status(404).json({ error: "Session not found or expired. Refresh the page and try again." });
    const which = req.params.which === "b" ? "b" : "a";
    if (!req.file) return res.status(400).json({ error: "No file received." });

    session.files[which] = { path: req.file.path, name: req.file.originalname, sizeBytes: req.file.size };

    try {
      const sheetNames = await listSheetNames(req.file.path);
      res.json({ originalName: req.file.originalname, sizeBytes: req.file.size, sheetNames });
    } catch (e) {
      res.status(400).json({ error: "Could not read this as a valid .xlsx file: " + e.message });
    }
  });
});

/* ------------------------------------------------------------------ */
/* Inspect (fast header preview, no full ingest)                       */
/* ------------------------------------------------------------------ */

router.post("/inspect/:sessionId/:which", async (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Session not found or expired." });
  const which = req.params.which === "b" ? "b" : "a";
  const fileInfo = session.files[which];
  if (!fileInfo) return res.status(400).json({ error: "Upload this file first." });

  const { sheetIndex, headerRow } = req.body;
  try {
    const result = await inspectHeader(fileInfo.path, parseInt(sheetIndex, 10) || 0, parseInt(headerRow, 10) || 1);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ------------------------------------------------------------------ */
/* Compare (kicks off an async streaming job)                          */
/* ------------------------------------------------------------------ */

router.post("/compare/:sessionId", (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Session not found or expired." });
  if (!session.files.a || !session.files.b) return res.status(400).json({ error: "Both files must be uploaded first." });

  const { a, b, keyColumns, compareEnabled, compareColumns } = req.body;
  if (!Array.isArray(keyColumns) || keyColumns.length === 0) {
    return res.status(400).json({ error: "Select at least one key column." });
  }

  session.job = { phase: "starting", rowsProcessed: 0, error: null, result: null };
  res.json({ started: true });

  runCompareJob(session, { a, b, keyColumns, compareEnabled: !!compareEnabled, compareColumns: compareColumns || [] }).catch((err) => {
    session.job = { phase: "error", error: err.message || String(err) };
  });
});

async function runCompareJob(session, config) {
  const dbPath = path.join(session.dir, "work.sqlite");
  fs.rmSync(dbPath, { force: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  session.job = { phase: "ingesting_a", rowsProcessed: 0, error: null, result: null };
  const ingestA = await ingestSheetToSqlite({
    filePath: session.files.a.path,
    sheetIndex: parseInt(config.a.sheetIndex, 10) || 0,
    headerRow: parseInt(config.a.headerRow, 10) || 1,
    keyColumns: config.keyColumns,
    db,
    table: "rows_a",
    onProgress: (n) => (session.job.rowsProcessed = n),
  });

  session.job = { phase: "ingesting_b", rowsProcessed: 0, error: null, result: null };
  const ingestB = await ingestSheetToSqlite({
    filePath: session.files.b.path,
    sheetIndex: parseInt(config.b.sheetIndex, 10) || 0,
    headerRow: parseInt(config.b.headerRow, 10) || 1,
    keyColumns: config.keyColumns,
    db,
    table: "rows_b",
    onProgress: (n) => (session.job.rowsProcessed = n),
  });

  session.job = { phase: "comparing", rowsProcessed: 0, error: null, result: null };
  buildAggregates(db);
  const counts = getCounts(db);

  const setA = new Set(ingestA.columns);
  const setB = new Set(ingestB.columns);
  const schema = {
    common: ingestA.columns.filter((c) => setB.has(c)),
    onlyA: ingestA.columns.filter((c) => !setB.has(c)),
    onlyB: ingestB.columns.filter((c) => !setA.has(c)),
  };

  const cellCompareEnabled = config.compareEnabled && config.compareColumns.length > 0;
  if (cellCompareEnabled) {
    Object.assign(counts, computeCellCompareCounts(db, config.compareColumns));
  }

  session.job = { phase: "writing_report", rowsProcessed: 0, error: null, result: null };
  const outPath = path.join(session.dir, "comparison_report.xlsx");
  await buildReport({
    outPath,
    db,
    counts,
    fileA: { name: session.files.a.name, sheetName: config.a.sheetName, headerRow: config.a.headerRow, columns: ingestA.columns },
    fileB: { name: session.files.b.name, sheetName: config.b.sheetName, headerRow: config.b.headerRow, columns: ingestB.columns },
    schema,
    keyColumns: config.keyColumns,
    compareColumns: config.compareColumns,
    cellCompareEnabled,
  });

  db.close();
  session.job = { phase: "done", rowsProcessed: 0, error: null, result: { counts, schema, reportReady: true } };
}

router.get("/status/:sessionId", (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Session not found or expired." });
  res.json(session.job);
});

router.get("/download/:sessionId", (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Session not found or expired." });
  const reportPath = path.join(session.dir, "comparison_report.xlsx");
  if (!fs.existsSync(reportPath)) return res.status(404).json({ error: "Report not ready yet." });
  res.download(reportPath, "comparison_report.xlsx");
});

module.exports = router;
