/**
 * After both rows_a / rows_b tables are populated, this builds small
 * "aggregate" tables (one row per unique key) so every subsequent query is a
 * cheap indexed lookup rather than a full scan. This is what lets the tool
 * stay fast on very large row counts without loading rows into Node memory.
 */
function buildAggregates(db) {
  db.exec(`DROP TABLE IF EXISTS agg_a; DROP TABLE IF EXISTS agg_b;`);
  db.exec(`
    CREATE TABLE agg_a AS
      SELECT key, COUNT(*) AS cnt, MIN(excel_row) AS min_row FROM rows_a GROUP BY key;
    CREATE UNIQUE INDEX idx_agg_a_key ON agg_a(key);

    CREATE TABLE agg_b AS
      SELECT key, COUNT(*) AS cnt, MIN(excel_row) AS min_row FROM rows_b GROUP BY key;
    CREATE UNIQUE INDEX idx_agg_b_key ON agg_b(key);
  `);
}

function getCounts(db) {
  const rowsA = db.prepare(`SELECT COUNT(*) c FROM rows_a`).get().c;
  const rowsB = db.prepare(`SELECT COUNT(*) c FROM rows_b`).get().c;
  const uniqueKeysA = db.prepare(`SELECT COUNT(*) c FROM agg_a`).get().c;
  const uniqueKeysB = db.prepare(`SELECT COUNT(*) c FROM agg_b`).get().c;
  const dupGroupsA = db.prepare(`SELECT COUNT(*) c FROM agg_a WHERE cnt > 1`).get().c;
  const dupGroupsB = db.prepare(`SELECT COUNT(*) c FROM agg_b WHERE cnt > 1`).get().c;
  const dupExtraA = db.prepare(`SELECT COALESCE(SUM(cnt - 1), 0) c FROM agg_a WHERE cnt > 1`).get().c;
  const dupExtraB = db.prepare(`SELECT COALESCE(SUM(cnt - 1), 0) c FROM agg_b WHERE cnt > 1`).get().c;
  const onlyInA = db
    .prepare(`SELECT COUNT(*) c FROM agg_a a LEFT JOIN agg_b b ON b.key = a.key WHERE b.key IS NULL`)
    .get().c;
  const onlyInB = db
    .prepare(`SELECT COUNT(*) c FROM agg_b b LEFT JOIN agg_a a ON a.key = b.key WHERE a.key IS NULL`)
    .get().c;
  const matched = db.prepare(`SELECT COUNT(*) c FROM agg_a a INNER JOIN agg_b b ON a.key = b.key`).get().c;

  return {
    rowsA,
    rowsB,
    uniqueKeysA,
    uniqueKeysB,
    duplicateGroupsA: dupGroupsA,
    duplicateGroupsB: dupGroupsB,
    duplicateExtraRowsA: dupExtraA,
    duplicateExtraRowsB: dupExtraB,
    onlyInA,
    onlyInB,
    matched,
  };
}

// Streaming iterators (use .iterate() so Node never holds the full result set)

function iterateOnlyIn(db, which) {
  const [rows, aggSelf, aggOther] = which === "a" ? ["rows_a", "agg_a", "agg_b"] : ["rows_b", "agg_b", "agg_a"];
  const sql = `
    SELECT r.excel_row, r.data
    FROM ${rows} r
    JOIN ${aggSelf} g ON r.key = g.key
    LEFT JOIN ${aggOther} o ON o.key = g.key
    WHERE o.key IS NULL
    ORDER BY r.excel_row
  `;
  return db.prepare(sql).iterate();
}

function iterateDuplicates(db, which) {
  const [rows, agg] = which === "a" ? ["rows_a", "agg_a"] : ["rows_b", "agg_b"];
  const sql = `
    SELECT r.excel_row, r.data, g.cnt AS group_size,
           ROW_NUMBER() OVER (PARTITION BY r.key ORDER BY r.excel_row) AS occurrence
    FROM ${rows} r
    JOIN ${agg} g ON r.key = g.key
    WHERE g.cnt > 1
    ORDER BY r.key, r.excel_row
  `;
  return db.prepare(sql).iterate();
}

function iterateMatched(db) {
  const sql = `
    SELECT ga.key AS key, ra.excel_row AS a_row, ra.data AS a_data, ga.cnt AS a_cnt,
           rb.excel_row AS b_row, rb.data AS b_data, gb.cnt AS b_cnt
    FROM agg_a ga
    JOIN agg_b gb ON ga.key = gb.key
    JOIN rows_a ra ON ra.key = ga.key AND ra.excel_row = ga.min_row
    JOIN rows_b rb ON rb.key = gb.key AND rb.excel_row = gb.min_row
    ORDER BY ga.key
  `;
  return db.prepare(sql).iterate();
}

/**
 * Pre-pass to count exact-match vs mismatch rows for the requested compare
 * columns, so the Summary sheet (written first) can report these totals.
 * The actual per-cell detail rows are written in a second pass in report.js.
 */
function computeCellCompareCounts(db, compareColumns) {
  let exactMatchCount = 0;
  let mismatchCount = 0;
  for (const r of iterateMatched(db)) {
    const a = JSON.parse(r.a_data);
    const b = JSON.parse(r.b_data);
    let allMatch = true;
    for (const c of compareColumns) {
      const va = a[c] === null || a[c] === undefined ? "" : String(a[c]).trim();
      const vb = b[c] === null || b[c] === undefined ? "" : String(b[c]).trim();
      if (va !== vb) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) exactMatchCount++;
    else mismatchCount++;
  }
  return { exactMatchCount, mismatchCount };
}

module.exports = {
  buildAggregates,
  getCounts,
  iterateOnlyIn,
  iterateDuplicates,
  iterateMatched,
  computeCellCompareCounts,
};
