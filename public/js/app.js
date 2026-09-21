/* ====================================================================== */
/* Sidebar view switching                                                 */
/* ====================================================================== */
document.querySelectorAll(".nav-link").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-link").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("view-" + btn.dataset.view).classList.add("active");
  });
});

/* ====================================================================== */
/* Icons (inline SVG, no external icon library)                           */
/* ====================================================================== */
const ICONS = {
  upload: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  check: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  x: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  alert: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  download: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  file: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
};

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ====================================================================== */
/* State                                                                  */
/* ====================================================================== */
function emptyFileInfo() {
  return {
    name: "", sizeBytes: 0, sheetNames: [], selectedSheet: "", selectedSheetIndex: 0, headerRow: 1,
    columns: [], error: null, uploading: false, uploadProgress: 0,
  };
}

let state = {
  sessionId: null,
  fileA: emptyFileInfo(),
  fileB: emptyFileInfo(),
  keyColumns: [],
  compareEnabled: true,
  compareColumns: [],
  job: null,
  pollTimer: null,
};

async function initSession() {
  const res = await fetch("/api/session", { method: "POST" });
  const data = await res.json();
  state.sessionId = data.sessionId;
  document.getElementById("serverMeta").textContent = "session ready";
}

function bothReady() {
  return state.fileA.columns.length > 0 && state.fileB.columns.length > 0 && !state.fileA.error && !state.fileB.error;
}
function getSchema() {
  if (!bothReady()) return null;
  const setA = new Set(state.fileA.columns);
  const setB = new Set(state.fileB.columns);
  return {
    common: state.fileA.columns.filter((c) => setB.has(c)),
    onlyA: state.fileA.columns.filter((c) => !setB.has(c)),
    onlyB: state.fileB.columns.filter((c) => !setA.has(c)),
  };
}

/* ====================================================================== */
/* Upload + inspect                                                       */
/* ====================================================================== */
function uploadFile(file, which) {
  const info = which === "A" ? state.fileA : state.fileB;
  info.uploading = true;
  info.uploadProgress = 0;
  info.error = null;
  render();

  const formData = new FormData();
  formData.append("file", file);
  const xhr = new XMLHttpRequest();
  xhr.open("POST", `/api/upload/${state.sessionId}/${which.toLowerCase()}`);

  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      info.uploadProgress = Math.round((e.loaded / e.total) * 100);
      render();
    }
  };

  xhr.onload = async () => {
    info.uploading = false;
    let data;
    try {
      data = JSON.parse(xhr.responseText);
    } catch (e) {
      data = { error: "Unexpected server response." };
    }
    if (xhr.status >= 400 || data.error) {
      info.error = data.error || "Upload failed.";
      render();
      return;
    }
    info.name = data.originalName;
    info.sizeBytes = data.sizeBytes;
    info.sheetNames = data.sheetNames;
    info.selectedSheet = data.sheetNames[0] || "";
    info.selectedSheetIndex = 0;
    info.headerRow = 1;
    state.job = null;
    await inspectFile(which);
  };

  xhr.onerror = () => {
    info.uploading = false;
    info.error = "Upload failed — check the connection to the server.";
    render();
  };

  xhr.send(formData);
}

async function inspectFile(which) {
  const info = which === "A" ? state.fileA : state.fileB;
  if (!info.selectedSheet) return;
  try {
    const res = await fetch(`/api/inspect/${state.sessionId}/${which.toLowerCase()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sheetIndex: info.selectedSheetIndex, headerRow: info.headerRow }),
    });
    const data = await res.json();
    if (data.error) {
      info.columns = [];
      info.error = data.error;
    } else {
      info.columns = data.columns;
      info.error = null;
    }
  } catch (e) {
    info.error = "Could not reach the server.";
  }
  state.job = null;
  maybeAutoSuggest();
  render();
}

function maybeAutoSuggest() {
  const schema = getSchema();
  if (!schema) return;
  if (state.keyColumns.length === 0 && schema.common.length > 0) {
    const guess = schema.common.find((c) => /^(id|key|code|number|no)$/i.test(c)) || schema.common[0];
    state.keyColumns = [guess];
  }
  if (state.compareEnabled && state.compareColumns.length === 0 && schema.common.length > 0) {
    state.compareColumns = schema.common.filter((c) => !state.keyColumns.includes(c));
  }
}

function toggleKeyColumn(c) {
  const i = state.keyColumns.indexOf(c);
  if (i >= 0) state.keyColumns.splice(i, 1); else state.keyColumns.push(c);
  state.job = null;
  render();
}
function toggleCompareColumn(c) {
  const i = state.compareColumns.indexOf(c);
  if (i >= 0) state.compareColumns.splice(i, 1); else state.compareColumns.push(c);
  state.job = null;
  render();
}

/* ====================================================================== */
/* Compare job + polling                                                  */
/* ====================================================================== */
async function runAnalysis() {
  state.job = { phase: "starting", rowsProcessed: 0, error: null, result: null };
  render();

  const body = {
    a: { sheetName: state.fileA.selectedSheet, sheetIndex: state.fileA.selectedSheetIndex, headerRow: state.fileA.headerRow },
    b: { sheetName: state.fileB.selectedSheet, sheetIndex: state.fileB.selectedSheetIndex, headerRow: state.fileB.headerRow },
    keyColumns: state.keyColumns,
    compareEnabled: state.compareEnabled,
    compareColumns: state.compareColumns,
  };

  const res = await fetch(`/api/compare/${state.sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) {
    state.job = { phase: "error", error: data.error };
    render();
    return;
  }
  pollStatus();
}

function pollStatus() {
  clearTimeout(state.pollTimer);
  state.pollTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/status/${state.sessionId}`);
      const job = await res.json();
      state.job = job;
      render();
      if (job.phase !== "done" && job.phase !== "error") pollStatus();
    } catch (e) {
      state.job = { phase: "error", error: "Lost connection to the server." };
      render();
    }
  }, 900);
}

function downloadReport() {
  window.location.href = `/api/download/${state.sessionId}`;
}

async function resetAll() {
  clearTimeout(state.pollTimer);
  state = {
    sessionId: state.sessionId,
    fileA: emptyFileInfo(),
    fileB: emptyFileInfo(),
    keyColumns: [],
    compareEnabled: true,
    compareColumns: [],
    job: null,
    pollTimer: null,
  };
  await initSession();
  render();
}
document.getElementById("resetBtn").addEventListener("click", resetAll);

/* ====================================================================== */
/* Rendering                                                              */
/* ====================================================================== */
function formatBytes(n) {
  if (n < 1024) return n + " B";
  const units = ["KB", "MB", "GB", "TB"];
  let u = -1;
  do { n /= 1024; u++; } while (n >= 1024 && u < units.length - 1);
  return n.toFixed(1) + " " + units[u];
}

function renderFileSlot(which) {
  const info = which === "A" ? state.fileA : state.fileB;
  const label = which === "A" ? "Report 1" : "Report 2";
  const accentVar = which === "A" ? "var(--a-color)" : "var(--b-color)";

  if (info.uploading) {
    return `
      <div class="file-card">
        <div class="file-name">${ICONS.file} ${label}</div>
        <div class="file-meta">
          <div>Uploading… ${info.uploadProgress}%</div>
          <div class="progress-track"><div class="progress-fill" style="width:${info.uploadProgress}%"></div></div>
        </div>
      </div>`;
  }

  if (!info.name) {
    return `
      <div>
        <label class="upload-box">
          <input type="file" accept=".xlsx,.xls" data-action="upload" data-target="${which}" />
          ${ICONS.upload}
          <div class="up-label">${label}</div>
          <div class="up-sub">Click to choose a file (any size)</div>
        </label>
        ${info.error ? `<div class="error">${ICONS.alert} ${esc(info.error)}</div>` : ""}
      </div>`;
  }

  const sheetOptions = info.sheetNames.length > 1
    ? `<div class="field-row"><label>Sheet</label>
        <select class="sel" data-action="sheet-change" data-target="${which}">
          ${info.sheetNames.map((s, i) => `<option value="${i}" ${i === info.selectedSheetIndex ? "selected" : ""}>${esc(s)}</option>`).join("")}
        </select>
      </div>`
    : "";

  const statusLine = info.error
    ? `<div class="error">${ICONS.alert} ${esc(info.error)}</div>`
    : (info.columns.length > 0 ? `<div>${info.columns.length} column${info.columns.length === 1 ? "" : "s"} detected</div>` : `<div>Reading header…</div>`);

  return `
    <div class="file-card">
      <div class="file-name">
        <span style="color:${accentVar}">${ICONS.file}</span>
        ${label}
        <button class="clear-btn" data-action="clear-file" data-target="${which}" title="Remove file">${ICONS.x}</button>
      </div>
      <div class="file-meta">
        <div class="mono" style="font-size:12px">${esc(info.name)} · ${formatBytes(info.sizeBytes)}</div>
        ${sheetOptions}
        <div class="field-row">
          <label>Header row</label>
          <input class="num" type="number" min="1" value="${info.headerRow}" data-action="header-row" data-target="${which}" />
          <span style="font-size:12px">which row has column titles?</span>
        </div>
        ${statusLine}
      </div>
    </div>`;
}

function renderStat(label, value) {
  return `<div class="stat"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(value)}</div></div>`;
}

const PHASE_LABELS = {
  starting: "Starting…",
  ingesting_a: "Reading Report 1 into the working database…",
  ingesting_b: "Reading Report 2 into the working database…",
  comparing: "Running comparison queries…",
  writing_report: "Writing the Excel report…",
  done: "Done",
  error: "Something went wrong",
};

function render() {
  const app = document.getElementById("app");
  const schema = getSchema();
  const parsed = bothReady();
  let html = "";

  html += `
    <div class="step">
      <div class="step-num ${parsed ? "done" : ""}">${parsed ? ICONS.check : "1"}</div>
      <div class="step-head">Upload your two files</div>
      <p class="step-desc">Accepts .xlsx and .xls of any size — files stream directly to the server's disk.</p>
      <div class="upload-grid">
        ${renderFileSlot("A")}
        ${renderFileSlot("B")}
      </div>
    </div>`;

  if (parsed && schema) {
    html += `
      <div class="step">
        <div class="step-num done">${ICONS.check}</div>
        <div class="step-head">Column comparison</div>
        <p class="step-desc">Report 1 has ${state.fileA.columns.length} column${state.fileA.columns.length === 1 ? "" : "s"}, Report 2 has ${state.fileB.columns.length}. ${schema.common.length} match by name.</p>
        <div class="card">
          <div class="chip-row">
            ${schema.common.map((c) => `<span class="chip common">${esc(c)}</span>`).join("")}
            ${schema.onlyA.map((c) => `<span class="chip a">${esc(c)} · Report 1 only</span>`).join("")}
            ${schema.onlyB.map((c) => `<span class="chip b">${esc(c)} · Report 2 only</span>`).join("")}
          </div>
        </div>
      </div>`;
  }

  if (parsed && schema) {
    html += `
      <div class="step">
        <div class="step-num ${state.keyColumns.length ? "done" : ""}">${state.keyColumns.length ? ICONS.check : "2"}</div>
        <div class="step-head">Choose key column(s)</div>
        <p class="step-desc">Pick the column(s) that uniquely identify a row. Used to match rows between reports and to detect duplicates within each report.</p>
        <div class="card">
          ${schema.common.length === 0
            ? `<div class="error">${ICONS.alert} No columns share the same name — rows can't be matched by key.</div>`
            : `<div class="checklist">
                ${schema.common.map((c) => `
                  <label class="check">
                    <input type="checkbox" data-action="toggle-key" data-col="${esc(c)}" ${state.keyColumns.includes(c) ? "checked" : ""} />
                    <span>${esc(c)}</span>
                  </label>`).join("")}
              </div>`}
        </div>
      </div>`;
  }

  if (parsed && schema && state.keyColumns.length > 0) {
    html += `
      <div class="step">
        <div class="step-num ${(!state.compareEnabled || state.compareColumns.length) ? "done" : ""}">${(!state.compareEnabled || state.compareColumns.length) ? ICONS.check : "3"}</div>
        <div class="step-head">Cell-by-cell comparison (optional)</div>
        <p class="step-desc">For rows that match on the key column(s), compare the actual cell values in specific columns.</p>
        <div class="card">
          <label class="toggle-row">
            <input type="checkbox" data-action="toggle-compare-enabled" ${state.compareEnabled ? "checked" : ""} />
            Compare cell values for matched rows
          </label>
          ${state.compareEnabled
            ? (schema.common.length === 0
                ? `<div class="note">No shared columns available to compare.</div>`
                : `<div class="checklist">
                    ${schema.common.map((c) => `
                      <label class="check">
                        <input type="checkbox" data-action="toggle-compare" data-col="${esc(c)}" ${state.compareColumns.includes(c) ? "checked" : ""} />
                        <span>${esc(c)}</span>
                      </label>`).join("")}
                  </div>`)
            : ""}
        </div>
      </div>`;
  }

  if (parsed && state.keyColumns.length > 0) {
    const job = state.job;
    const running = job && job.phase !== "done" && job.phase !== "error";
    const done = job && job.phase === "done";

    html += `
      <div class="step">
        <div class="step-num ${done ? "done" : ""}">${done ? ICONS.check : "4"}</div>
        <div class="step-head">Generate the report</div>
        <p class="step-desc">Streams both files into a working database and writes the report straight to disk — safe for very large files.</p>
        <div class="card">
          <button class="btn btn-primary" data-action="run-analysis" ${running ? "disabled" : ""}>
            ${running ? "Comparing…" : "Compare reports"}
          </button>

          ${job ? `
            <div class="status-line">
              ${running ? '<span class="spinner"></span>' : ""}
              <span>${PHASE_LABELS[job.phase] || job.phase}${job.rowsProcessed ? ` — ${job.rowsProcessed.toLocaleString()} rows` : ""}</span>
            </div>` : ""}

          ${job && job.phase === "error" ? `<div class="error" style="margin-top:10px">${ICONS.alert} ${esc(job.error)}</div>` : ""}

          ${done ? `
            <div class="stat-grid" style="margin-top:20px">
              ${renderStat("Rows — Report 1", job.result.counts.rowsA.toLocaleString())}
              ${renderStat("Rows — Report 2", job.result.counts.rowsB.toLocaleString())}
              ${renderStat("Matched rows", job.result.counts.matched.toLocaleString())}
              ${renderStat("Only in Report 1", job.result.counts.onlyInA.toLocaleString())}
              ${renderStat("Only in Report 2", job.result.counts.onlyInB.toLocaleString())}
              ${renderStat("Duplicate groups — R1 / R2", `${job.result.counts.duplicateGroupsA} / ${job.result.counts.duplicateGroupsB}`)}
              ${job.result.counts.exactMatchCount !== undefined ? renderStat("Exact matches (compared cols)", job.result.counts.exactMatchCount.toLocaleString()) : ""}
              ${job.result.counts.mismatchCount !== undefined ? renderStat("Rows with mismatches", job.result.counts.mismatchCount.toLocaleString()) : ""}
            </div>
            <button class="btn btn-outline" style="margin-top:18px" data-action="download-report">${ICONS.download} Download Excel report</button>
          ` : ""}
        </div>
      </div>`;
  }

  app.innerHTML = html;
}

/* ====================================================================== */
/* Event delegation                                                       */
/* ====================================================================== */
document.getElementById("app").addEventListener("change", (e) => {
  const el = e.target;
  const action = el.dataset.action;
  if (action === "upload") {
    if (el.files && el.files[0]) uploadFile(el.files[0], el.dataset.target);
  } else if (action === "sheet-change") {
    const info = el.dataset.target === "A" ? state.fileA : state.fileB;
    info.selectedSheetIndex = parseInt(el.value, 10);
    info.selectedSheet = info.sheetNames[info.selectedSheetIndex];
    inspectFile(el.dataset.target);
  } else if (action === "header-row") {
    const info = el.dataset.target === "A" ? state.fileA : state.fileB;
    info.headerRow = Math.max(1, parseInt(el.value || "1", 10));
    inspectFile(el.dataset.target);
  }
});

document.getElementById("app").addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;
  if (action === "clear-file") {
    if (el.dataset.target === "A") state.fileA = emptyFileInfo();
    else state.fileB = emptyFileInfo();
    state.job = null;
    render();
  } else if (action === "toggle-key") {
    toggleKeyColumn(el.dataset.col);
  } else if (action === "toggle-compare") {
    toggleCompareColumn(el.dataset.col);
  } else if (action === "toggle-compare-enabled") {
    state.compareEnabled = el.checked;
    state.job = null;
    render();
  } else if (action === "run-analysis") {
    runAnalysis();
  } else if (action === "download-report") {
    downloadReport();
  }
});

/* ====================================================================== */
/* Boot                                                                   */
/* ====================================================================== */
initSession().then(render);
