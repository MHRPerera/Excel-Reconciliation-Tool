# Excel Comparison Tool

Compares two Excel workbooks — column-by-column and row-by-row — and produces a
full diff report as a downloadable `.xlsx` file. Built to handle very large
files (multi-gigabyte) by never loading a whole workbook into memory:

- **Upload** streams straight to disk (`multer` disk storage) — the server
  never buffers a whole file in RAM.
- **Reading** each sheet uses ExcelJS's streaming (SAX-style) reader, which
  processes one row at a time with a small constant memory footprint.
- **Comparison** (matching, duplicates, only-in-A/B) runs as indexed SQL
  queries inside an embedded SQLite database (`better-sqlite3`), not as
  JavaScript array operations — so it stays fast and memory-light regardless
  of row count.
- **The report** is streamed straight to disk sheet-by-sheet with ExcelJS's
  streaming writer, so even huge detail sheets never sit fully in memory.

This is a real, from-scratch project — I was not able to run `npm install` or
execute it in this environment (no network access here), so please treat it
as a solid first version to test on your machine rather than something
already verified end-to-end. The architecture and APIs used are accurate to
the documented behavior of ExcelJS / better-sqlite3 / multer, but I'd
recommend testing with a small file first, then a large one.

## 1. Install & run

Requires Node.js 18+.

```bash
cd excel-compare-app
npm install
npm start
```

Then open **http://localhost:3000**.

`better-sqlite3` compiles a small native module during `npm install` — this
needs Python and a C++ toolchain available on the machine (normal on most
dev machines; on a bare Linux server you may need `build-essential` /
`python3` installed first). If that's a hassle, an alternative is swapping
`better-sqlite3` for `sql.js` (WASM, no native build) — happy to adapt if you
hit issues.

## 2. Configuration

Environment variables (optional):

| Variable       | Default | Purpose                                      |
|----------------|---------|-----------------------------------------------|
| `PORT`         | `3000`  | HTTP port                                     |
| `MAX_FILE_MB`  | `5000`  | Max size per uploaded file, in MB             |

Example:

```bash
PORT=8080 MAX_FILE_MB=10000 npm start
```

## 3. Deploying

Since this needs a persistent Node process (not just static files), it needs
actual server hosting rather than static hosting like GitHub Pages / Netlify.
Reasonable options:

- **Your own VPS / server**: `npm install && npm start` (use `pm2` or a
  systemd service to keep it running).
- **Render / Railway / Fly.io**: point them at this repo; they'll run
  `npm install` and `npm start` automatically. Make sure the plan has enough
  disk space for your expected file sizes (see below).
- **Reverse proxy (nginx, etc.)**: raise `client_max_body_size` to match
  `MAX_FILE_MB`, or large uploads will be rejected by the proxy before they
  reach the app.

## 4. Disk space planning

For a comparison, the server temporarily needs roughly:

- Both original uploaded files (kept for the duration of the session)
- A SQLite working database (roughly comparable in size to the two input
  files combined, sometimes a bit more due to indexes)
- The output report file

As a rule of thumb, plan for **~3-4x the combined size of your two input
files** in free disk space. Sessions (uploads + working database) are
automatically deleted an hour after creation; you can lower `SESSION_TTL_MS`
in `lib/sessions.js` if you want them cleaned up sooner.

## 5. Project structure

```
excel-compare-app/
  server.js              Express entry point
  routes/api.js           All API endpoints + the async compare job
  lib/
    sheetNames.js         Fast sheet-name listing (reads zip metadata only)
    ingest.js              Streaming xlsx reader -> SQLite ingestion
    compare.js             SQL-based diff engine (matched/only-in/duplicates)
    report.js              Streaming xlsx report writer
    sessions.js            In-memory session + auto-cleanup
  public/
    index.html             Site shell: header, sidebar, footer
    css/style.css
    js/app.js               Frontend wizard logic (talks to the API only)
  data/sessions/<id>/       Per-comparison working files (created at runtime)
```

## 6. Known limitations / good next steps

- Job state is kept in memory in a single Node process — fine for one server
  instance, but won't work if you run multiple instances behind a load
  balancer without adding a shared store (e.g. Redis) for job status.
- SQLite writes/joins happen synchronously on the main thread. For very large
  files this can make the server briefly less responsive to other requests
  during a comparison. Moving the compare job into a Node `worker_thread`
  would fix this without changing the overall design.
- `.xls` (older binary format) is passed through the same code path; ExcelJS
  supports it, but it's less battle-tested at very large sizes than `.xlsx`.
- No authentication — add a login/API-key layer before exposing this
  publicly if the spreadsheets are sensitive.
