const ExcelJS = require("exceljs");
const { iterateOnlyIn, iterateDuplicates, iterateMatched } = require("./compare");

async function buildReport({ outPath, db, counts, fileA, fileB, schema, keyColumns, compareColumns, cellCompareEnabled }) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: outPath, useStyles: false, useSharedStrings: false });

  /* ---- Summary ---- */
  const wsSummary = workbook.addWorksheet("Summary");
  wsSummary.columns = [{ width: 44 }, { width: 40 }];
  const summaryRows = [
    ["REPORT 1", fileA.name],
    ["Sheet", fileA.sheetName],
    ["Header row", fileA.headerRow],
    ["Total rows", counts.rowsA],
    ["Total columns", fileA.columns.length],
    ["Unique keys", counts.uniqueKeysA],
    ["Duplicate groups", counts.duplicateGroupsA],
    ["Duplicate rows (extra copies)", counts.duplicateExtraRowsA],
    ["", ""],
    ["REPORT 2", fileB.name],
    ["Sheet", fileB.sheetName],
    ["Header row", fileB.headerRow],
    ["Total rows", counts.rowsB],
    ["Total columns", fileB.columns.length],
    ["Unique keys", counts.uniqueKeysB],
    ["Duplicate groups", counts.duplicateGroupsB],
    ["Duplicate rows (extra copies)", counts.duplicateExtraRowsB],
    ["", ""],
    ["COLUMN COMPARISON", ""],
    ["Common columns", schema.common.length],
    ["Columns only in Report 1", schema.onlyA.length],
    ["Columns only in Report 2", schema.onlyB.length],
    ["", ""],
    [`ROW COMPARISON (key: ${keyColumns.join(", ")})`, ""],
    ["Matched keys (present in both)", counts.matched],
    ["Rows only in Report 1", counts.onlyInA],
    ["Rows only in Report 2", counts.onlyInB],
  ];
  if (cellCompareEnabled) {
    summaryRows.push(
      ["", ""],
      ["CELL-WISE COMPARISON", ""],
      ["Columns compared", compareColumns.join(", ")],
      ["Matched rows — all compared cells equal", counts.exactMatchCount],
      ["Matched rows — at least one mismatch", counts.mismatchCount]
    );
  }
  summaryRows.forEach((r) => wsSummary.addRow(r).commit());
  wsSummary.commit();

  /* ---- Column comparison ---- */
  const wsCols = workbook.addWorksheet("Column Comparison");
  wsCols.columns = [{ width: 32 }, { width: 14 }, { width: 14 }];
  wsCols.addRow(["Column", "In Report 1", "In Report 2"]).commit();
  schema.common.forEach((c) => wsCols.addRow([c, "Yes", "Yes"]).commit());
  schema.onlyA.forEach((c) => wsCols.addRow([c, "Yes", "No"]).commit());
  schema.onlyB.forEach((c) => wsCols.addRow([c, "No", "Yes"]).commit());
  wsCols.commit();

  /* ---- Only in Report 1 / 2 ---- */
  function writeOnlySheet(name, which, columns) {
    const ws = workbook.addWorksheet(name);
    ws.addRow(["Excel Row #", ...columns]).commit();
    for (const r of iterateOnlyIn(db, which)) {
      const data = JSON.parse(r.data);
      ws.addRow([r.excel_row, ...columns.map((c) => data[c])]).commit();
    }
    ws.commit();
  }
  writeOnlySheet("Only In Report 1", "a", fileA.columns);
  writeOnlySheet("Only In Report 2", "b", fileB.columns);

  /* ---- Duplicates in Report 1 / 2 ---- */
  function writeDupSheet(name, which, columns) {
    const ws = workbook.addWorksheet(name);
    ws.addRow(["Occurrence #", "Group Size", "Excel Row #", ...columns]).commit();
    for (const r of iterateDuplicates(db, which)) {
      const data = JSON.parse(r.data);
      ws.addRow([r.occurrence, r.group_size, r.excel_row, ...columns.map((c) => data[c])]).commit();
    }
    ws.commit();
  }
  writeDupSheet("Duplicates Report 1", "a", fileA.columns);
  writeDupSheet("Duplicates Report 2", "b", fileB.columns);

  /* ---- Matched rows (and, if enabled, cell comparison) ---- */
  const wsMatched = workbook.addWorksheet("Matched Rows");
  wsMatched.addRow([
    ...keyColumns.map((k) => `Key: ${k}`),
    ...fileA.columns.map((c) => `R1: ${c}`),
    ...fileB.columns.map((c) => `R2: ${c}`),
    "Note",
  ]).commit();

  let wsCell = null;
  if (cellCompareEnabled) {
    wsCell = workbook.addWorksheet("Cell Comparison");
    const header = [...keyColumns.map((k) => `Key: ${k}`)];
    compareColumns.forEach((c) => header.push(`${c} (Report 1)`, `${c} (Report 2)`, `${c} Match?`));
    header.push("Overall Match", "Note");
    wsCell.addRow(header).commit();
  }

  for (const r of iterateMatched(db)) {
    const aData = JSON.parse(r.a_data);
    const bData = JSON.parse(r.b_data);
    const note = r.a_cnt > 1 || r.b_cnt > 1 ? `Report 1 x${r.a_cnt}, Report 2 x${r.b_cnt} — first occurrence shown` : "";

    wsMatched
      .addRow([
        ...keyColumns.map((k) => aData[k]),
        ...fileA.columns.map((c) => aData[c]),
        ...fileB.columns.map((c) => bData[c]),
        note,
      ])
      .commit();

    if (wsCell) {
      const row = [...keyColumns.map((k) => aData[k])];
      let allMatch = true;
      compareColumns.forEach((c) => {
        const va = aData[c] === null || aData[c] === undefined ? "" : String(aData[c]).trim();
        const vb = bData[c] === null || bData[c] === undefined ? "" : String(bData[c]).trim();
        const isMatch = va === vb;
        if (!isMatch) allMatch = false;
        row.push(aData[c], bData[c], isMatch ? "Match" : "Mismatch");
      });
      row.push(allMatch ? "Match" : "Mismatch", note);
      wsCell.addRow(row).commit();
    }
  }
  wsMatched.commit();
  if (wsCell) wsCell.commit();

  await workbook.commit();
}

module.exports = { buildReport };
