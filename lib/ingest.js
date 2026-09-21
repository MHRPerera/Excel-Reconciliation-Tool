const ExcelJS = require("exceljs");

function cellToPlain(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if (v.text !== undefined) return v.text; // rich text
    if (v.result !== undefined) return v.result; // formula result
    if (v.hyperlink !== undefined) return v.text || v.hyperlink;
  }
  return v;
}

function buildColumnNames(headerValues) {
  const seen = {};
  const columns = [];
  // headerValues is 1-indexed (index 0 is unused) as returned by ExcelJS row.values
  for (let i = 1; i < headerValues.length; i++) {
    let name = headerValues[i] === null || headerValues[i] === undefined ? "" : String(cellToPlain(headerValues[i])).trim();
    if (!name) name = `Column${i}`;
    if (seen[name] === undefined) {
      seen[name] = 0;
    } else {
      seen[name] += 1;
      name = `${name}_${seen[name]}`;
    }
    columns.push(name);
  }
  return columns;
}

/**
 * Reads just far enough into a sheet to capture the header row and return
 * column names. Stops reading as soon as the header row is found, so this
 * stays fast even on very large files as long as the header is near the top.
 *
 * Sheets are matched by POSITION (sheetIndex, 0-based), not by name. Some
 * writers (e.g. openpyxl) store worksheet data before the workbook-level
 * sheet name list in the zip, which can make ExcelJS's streaming reader
 * misreport (or fail to resolve) a sheet's name while streaming. Matching by
 * the order sheets are emitted avoids that entirely — it always lines up
 * with the order returned by listSheetNames(), since both reflect the order
 * sheets are defined in the workbook.
 */
async function inspectHeader(filePath, sheetIndex, headerRow) {
  const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
    sharedStrings: "cache",
    styles: "ignore",
    hyperlinks: "ignore",
    worksheets: "emit",
  });

  let idx = -1;
  for await (const worksheetReader of workbookReader) {
    idx++;
    if (idx !== sheetIndex) {
      // Must drain rows to advance the stream to the next worksheet entry.
      // eslint-disable-next-line no-unused-vars
      for await (const _row of worksheetReader) {
        /* skip */
      }
      continue;
    }
    for await (const row of worksheetReader) {
      if (row.number === headerRow) {
        return { columns: buildColumnNames(row.values), error: null };
      }
      if (row.number > headerRow) break;
    }
    return { columns: [], error: `Header row ${headerRow} was not found in that sheet.` };
  }
  return { columns: [], error: `That sheet could not be found in the file.` };
}

/**
 * Streams every data row of a sheet into a SQLite table, computing a key
 * string per row from the chosen key columns as it goes. Memory use stays
 * flat (a small batch buffer) no matter how large the source file is.
 *
 * onProgress(rowsProcessed) is called periodically for status reporting.
 */
async function ingestSheetToSqlite({ filePath, sheetIndex, headerRow, keyColumns, db, table, onProgress }) {
  db.exec(`DROP TABLE IF EXISTS ${table};`);
  db.exec(`CREATE TABLE ${table} (excel_row INTEGER, key TEXT, data TEXT);`);
  const insert = db.prepare(`INSERT INTO ${table} (excel_row, key, data) VALUES (?, ?, ?)`);
  const insertBatch = db.transaction((rows) => {
    for (const r of rows) insert.run(r.excel_row, r.key, r.data);
  });

  const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
    sharedStrings: "cache",
    styles: "ignore",
    hyperlinks: "ignore",
    worksheets: "emit",
  });

  let columns = null;
  let rowCount = 0;
  const BATCH_SIZE = 2000;
  let batch = [];
  let lastReport = Date.now();
  let idx = -1;

  for await (const worksheetReader of workbookReader) {
    idx++;
    if (idx !== sheetIndex) {
      // eslint-disable-next-line no-unused-vars
      for await (const _row of worksheetReader) {
        /* skip other sheets */
      }
      continue;
    }

    for await (const row of worksheetReader) {
      const rowNumber = row.number;
      if (rowNumber < headerRow) continue;

      const values = row.values;
      if (rowNumber === headerRow) {
        columns = buildColumnNames(values);
        continue;
      }
      if (!columns) continue;

      const obj = {};
      let hasData = false;
      for (let i = 1; i <= columns.length; i++) {
        const v = cellToPlain(values[i]);
        obj[columns[i - 1]] = v === undefined ? null : v;
        if (v !== null && v !== undefined && String(v).trim() !== "") hasData = true;
      }
      if (!hasData) continue; // skip fully blank rows

      const keyVal = keyColumns
        .map((k) => (obj[k] === null || obj[k] === undefined ? "" : String(obj[k]).trim()))
        .join("\u241F");

      batch.push({ excel_row: rowNumber, key: keyVal, data: JSON.stringify(obj) });
      rowCount++;

      if (batch.length >= BATCH_SIZE) {
        insertBatch(batch);
        batch = [];
        if (onProgress && Date.now() - lastReport > 400) {
          onProgress(rowCount);
          lastReport = Date.now();
        }
      }
    }
  }
  if (batch.length) insertBatch(batch);
  if (onProgress) onProgress(rowCount);

  db.exec(`CREATE INDEX idx_${table}_key_row ON ${table}(key, excel_row);`);

  return { columns: columns || [], rowCount };
}

module.exports = { inspectHeader, ingestSheetToSqlite, buildColumnNames, cellToPlain };
