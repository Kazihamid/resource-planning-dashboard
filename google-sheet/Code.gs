/*
 * Resource Planning Dashboard - Google Sheet backend (Google Apps Script)
 *
 * WHAT THIS DOES
 *   Keeps ONE shared copy of the dashboard plan inside this Google Sheet so everybody who opens the
 *   dashboard sees the same Project & Resource Register and the same "Deployed in Live" list.
 *   You can also read both lists in the tabs "Project Register" and "Deployed in Live" (read-only view:
 *   changes typed into those two tabs are overwritten on the next save; edit in the dashboard instead).
 *   Tabs starting with an underscore (_State, _Versions, _Audit) are the dashboard's own storage. Do not edit them.
 *
 * SETUP (10 minutes, once)
 *   1. Change the two keys below (EDIT_KEY is required, pick your own secret word, at least 8 characters).
 *   2. Click Save (disk icon).
 *   3. Click Deploy > New deployment > gear icon > Web app.
 *        Execute as:      Me
 *        Who has access:  Anyone
 *      Click Deploy, then Authorize access (Google shows an "unverified app" warning because this is your own
 *      script: click Advanced > Go to project (unsafe) > Allow).
 *   4. Copy the Web app URL. Paste it into the dashboard: Setup > Google Sheet sharing.
 *   If you change this code later you must Deploy > Manage deployments > Edit > New version > Deploy.
 */

/* ===== SETTINGS: change these two lines only ===== */
const EDIT_KEY = 'CHANGE-ME-to-your-own-secret-word';  // people with this key can view and change data
const VIEW_KEY = '';                                    // optional second key: people with it can only view. '' = off
/* ================================================= */

/* ----- plan rules (same code as the Node server, so behaviour is identical) ----- */
const ROW_LISTS = ["sourceBaseline", "currentPlan", "proposedPlan", "deployedLive"];
const OPTIONAL_ROW_LISTS = new Set(["deployedLive"]); // older dashboards do not send this list yet
// Actions that can create a new entry by hand; only these are checked for duplicates (imports and restores of
// whole plans may legitimately carry old data and are never blocked).
const DUPLICATE_CHECKED_ACTIONS = new Set(["edit", "restore-deployed"]);
const STRING_SETS = ["addedResources", "customTestStatuses", "removedTestStatuses", "customSourceStatuses", "removedSourceStatuses"];
/* ---------- Plan diff / merge ---------- */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function rowsByUid(list) {
  const m = new Map();
  (Array.isArray(list) ? list : []).forEach(r => { if (r && r.uid != null) m.set(String(r.uid), r); });
  return m;
}
class MergeConflict extends Error {}

// Three-way merge of a list of rows keyed by uid: apply "mine vs base" changes onto "theirs".
function mergeRows(base, mine, theirs, listName) {
  const b = rowsByUid(base), m = rowsByUid(mine), t = rowsByUid(theirs);
  const label = r => (r && (r.projectId || r.projectName)) || "a row";
  const result = new Map(t);
  const added = [];
  for (const [uid, row] of m) {
    if (!b.has(uid)) {
      if (t.has(uid) && !same(t.get(uid), row)) throw new MergeConflict(`${label(row)} (${listName}) was added by someone else with different details.`);
      if (!t.has(uid)) added.push([uid, row]);
      continue;
    }
    const baseRow = b.get(uid);
    if (same(baseRow, row)) continue; // unchanged by me
    if (!t.has(uid)) throw new MergeConflict(`${label(row)} was removed by someone else while you edited it.`);
    const theirRow = t.get(uid);
    if (same(theirRow, baseRow) || same(theirRow, row)) result.set(uid, row);
    else throw new MergeConflict(`${label(row)} was changed by someone else at the same time.`);
  }
  for (const [uid, baseRow] of b) {
    if (m.has(uid) || !t.has(uid)) continue; // kept by me, or already removed
    if (!same(t.get(uid), baseRow)) throw new MergeConflict(`${label(baseRow)} was changed by someone else while you removed it.`);
    result.delete(uid);
  }
  return [...added.map(([, r]) => r), ...[...result.values()]];
}
function mergeStringSet(base, mine, theirs) {
  const b = new Set(base || []), m = new Set(mine || []);
  const out = new Set(theirs || []);
  for (const v of m) if (!b.has(v)) out.add(v);
  for (const v of b) if (!m.has(v)) out.delete(v);
  return [...out];
}
function mergeStates(base, mine, theirs) {
  const out = { ...theirs };
  for (const key of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
    if (ROW_LISTS.includes(key)) out[key] = mergeRows(base[key], mine[key], theirs[key], key);
    else if (STRING_SETS.includes(key)) out[key] = mergeStringSet(base[key], mine[key], theirs[key]);
    else if (key === "uidCounter") out[key] = Math.max(Number(mine[key]) || 0, Number(theirs[key]) || 0);
    else if (!same(mine[key], base[key])) {
      if (!same(theirs[key], base[key]) && !same(theirs[key], mine[key])) throw new MergeConflict(`"${key}" was changed by someone else at the same time.`);
      out[key] = mine[key];
    }
  }
  return out;
}

const fmt = v => Array.isArray(v) ? v.join(", ") : (v === null || v === undefined ? "" : String(v));
function diffStates(prev, next) {
  const details = [];
  const parts = [];
  const listNames = { proposedPlan: "Proposed plan", currentPlan: "Current plan", sourceBaseline: "Source baseline", deployedLive: "Deployed in Live" };
  for (const list of ["proposedPlan", "currentPlan", "sourceBaseline", "deployedLive"]) {
    const a = rowsByUid(prev && prev[list]), b = rowsByUid(next && next[list]);
    let added = 0, removed = 0, changed = 0;
    const changedLabels = [];
    for (const [uid, row] of b) {
      if (!a.has(uid)) {
        added++;
        details.push({ list, change: "added", uid, projectId: row.projectId || "", projectName: row.projectName || "" });
      } else if (!same(a.get(uid), row)) {
        changed++;
        const old = a.get(uid);
        const fields = {};
        for (const f of new Set([...Object.keys(old), ...Object.keys(row)])) {
          if (!same(old[f], row[f])) fields[f] = { from: fmt(old[f]), to: fmt(row[f]) };
        }
        if (changedLabels.length < 3) changedLabels.push(`${row.projectId || row.projectName || uid} (${Object.keys(fields).join(", ")})`);
        details.push({ list, change: "changed", uid, projectId: row.projectId || "", projectName: row.projectName || "", fields });
      }
    }
    for (const [uid, row] of a) {
      if (!b.has(uid)) {
        removed++;
        details.push({ list, change: "removed", uid, projectId: row.projectId || "", projectName: row.projectName || "" });
      }
    }
    const bits = [];
    if (added) bits.push(`${added} added`);
    if (removed) bits.push(`${removed} removed`);
    if (changed) bits.push(`${changed} changed${changedLabels.length ? ` — ${changedLabels.join("; ")}${changed > changedLabels.length ? "; …" : ""}` : ""}`);
    if (bits.length) parts.push(`${listNames[list]}: ${bits.join(", ")}`);
  }
  const setNames = { addedResources: "Resource pool", customTestStatuses: "Test statuses", removedTestStatuses: "Removed test statuses", customSourceStatuses: "Source statuses", removedSourceStatuses: "Removed source statuses" };
  for (const key of STRING_SETS) {
    const a = new Set((prev && prev[key]) || []), b = new Set((next && next[key]) || []);
    const plus = [...b].filter(v => !a.has(v)), minus = [...a].filter(v => !b.has(v));
    if (plus.length || minus.length) {
      parts.push(`${setNames[key]}: ${[...plus.map(v => `+${v}`), ...minus.map(v => `-${v}`)].join(", ")}`);
      details.push({ list: key, change: "set", added: plus, removed: minus });
    }
  }
  return { summary: parts.join(" · ") || "No data changes", details: details.slice(0, 2000) };
}

/* ---------- Duplicate entries (same rules as the dashboard's findDuplicate) ----------
   Two rows clash when they share a JIRA ID, or share Project + Task Details + Start + End.
   The register and the Deployed in Live list are checked together. */
function duplicateIndex(state) {
  const idx = new Map();
  for (const list of ["proposedPlan", "deployedLive"]) {
    for (const r of (state && Array.isArray(state[list]) ? state[list] : [])) {
      if (!r || r.draft) continue;
      const keys = new Map();
      const jira = String(r.projectId || "").trim().toLowerCase();
      if (jira) keys.set(`j|${jira}`, `JIRA ID "${String(r.projectId).trim()}"`);
      const group = String(r.projectGroup || "").trim().toLowerCase();
      const name = String(r.projectName || "").trim().toLowerCase().replace(/\s+/g, " ");
      if (group && name && r.start && r.end) keys.set(`c|${group}|${name}|${r.start}|${r.end}`, `"${String(r.projectName).trim()}" with the same project and dates`);
      for (const [k, label] of keys) {
        const e = idx.get(k) || { count: 0, label };
        e.count++;
        idx.set(k, e);
      }
    }
  }
  return idx;
}
// A clash that is new in `next` (not already present in `prev`), or null.
function newDuplicate(prev, next) {
  const before = duplicateIndex(prev);
  for (const [k, e] of duplicateIndex(next)) {
    if (e.count > 1 && !(before.get(k) && before.get(k).count > 1)) return `Duplicate entry: ${e.label} already exists in the register or in Deployed in Live.`;
  }
  return null;
}

function validateState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return "Plan state must be an object.";
  for (const list of ROW_LISTS) {
    if (state[list] === undefined && OPTIONAL_ROW_LISTS.has(list)) continue;
    if (!Array.isArray(state[list])) return `Plan state is missing the ${list} list.`;
    const uids = new Set();
    for (const row of state[list]) {
      if (!row || typeof row !== "object" || typeof row.uid !== "string" || !row.uid) return `Every ${list} row needs a text uid.`;
      if (uids.has(row.uid)) return `Duplicate row id "${row.uid}" in ${list}.`;
      uids.add(row.uid);
    }
  }
  for (const key of STRING_SETS) {
    if (state[key] !== undefined && (!Array.isArray(state[key]) || state[key].some(v => typeof v !== "string"))) return `${key} must be a list of text values.`;
  }
  return null;
}
function cleanState(state) {
  const s = { ...state };
  delete s.config;   // filters and view settings stay per-user in the browser
  delete s.savedAt;
  return s;
}


/* ===================== Google Sheet storage ===================== */
const SHEET_STATE = '_State', SHEET_VERSIONS = '_Versions', SHEET_AUDIT = '_Audit';
const SHEET_REGISTER = 'Project Register', SHEET_DEPLOYED = 'Deployed in Live';
const CHUNK_SIZE = 40000;      // a Google Sheets cell holds at most 50,000 characters
const KEEP_VERSIONS = 40;      // how many past versions can be restored
const KEEP_AUDIT = 2000;       // how many history lines are kept

function out_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function fail_(status, message, extra) { return out_(Object.assign({ error: message, status: status }, extra || {})); }
function str_(v) { return v instanceof Date ? v.toISOString() : (v === null || v === undefined ? '' : String(v)); }

function sheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (name.charAt(0) === '_') {
      sh.getRange('A:G').setNumberFormat('@');            // plain text: stops Sheets turning data into dates/formulas
      if (typeof sh.hideSheet === 'function') sh.hideSheet();
    }
    if (headers) sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sh;
}

function configProblem_() {
  if (!EDIT_KEY || EDIT_KEY.length < 8 || /^CHANGE-ME/i.test(EDIT_KEY)) return 'Setup is not finished: open the script, replace the EDIT_KEY value with your own secret word (at least 8 characters), save, and deploy again.';
  if (VIEW_KEY && VIEW_KEY === EDIT_KEY) return 'VIEW_KEY must be different from EDIT_KEY.';
  return null;
}
function roleFor_(key) {
  key = String(key || '');
  if (EDIT_KEY && key === EDIT_KEY) return 'edit';
  if (VIEW_KEY && key === VIEW_KEY) return 'view';
  return null;
}
function cleanUser_(u) { return String(u || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60) || 'Unknown'; }

function readMeta_() {
  const sh = sheet_(SHEET_STATE, ['version', 'updatedAt', 'updatedBy', 'action', 'chunks']);
  if (sh.getLastRow() < 2) return { version: 0, updatedAt: null, updatedBy: null, action: null, chunks: 0 };
  const r = sh.getRange(2, 1, 1, 5).getValues()[0];
  return { version: Number(r[0]) || 0, updatedAt: str_(r[1]) || null, updatedBy: str_(r[2]) || null, action: str_(r[3]) || null, chunks: Number(r[4]) || 0 };
}
function metaOut_(m) { return { version: m.version, updatedAt: m.updatedAt, updatedBy: m.updatedBy, action: m.action }; }
function chunk_(json) {
  const parts = [];
  for (let i = 0; i < json.length; i += CHUNK_SIZE) parts.push(json.substring(i, i + CHUNK_SIZE));
  return parts.length ? parts : [''];
}
function readLatest_() {
  const meta = readMeta_();
  if (!meta.version) return { meta: meta, state: null };
  const sh = sheet_(SHEET_STATE);
  const vals = sh.getRange(4, 1, meta.chunks, 1).getValues();
  return { meta: meta, state: JSON.parse(vals.map(function (r) { return str_(r[0]); }).join('')) };
}
function writeLatest_(version, at, user, action, parts) {
  const sh = sheet_(SHEET_STATE, ['version', 'updatedAt', 'updatedBy', 'action', 'chunks']);
  const last = sh.getLastRow();
  if (last >= 4) sh.getRange(4, 1, last - 3, 1).clearContent();
  sh.getRange(4, 1, parts.length, 1).setValues(parts.map(function (p) { return [p]; }));
  sh.getRange(2, 1, 1, 5).setValues([[version, at, user, action, parts.length]]);   // last: this is the commit point
}
function appendVersion_(version, at, user, action, parts) {
  const sh = sheet_(SHEET_VERSIONS, ['version', 'part', 'parts', 'savedAt', 'savedBy', 'action', 'data']);
  const start = Math.max(sh.getLastRow(), 1) + 1;
  sh.getRange(start, 1, parts.length, 7).setValues(parts.map(function (p, i) { return [version, i, parts.length, at, user, action, p]; }));
  const n = sh.getLastRow() - 1;
  if (n > 0) {
    const col = sh.getRange(2, 1, n, 1).getValues();
    let old = 0;
    while (old < col.length && Number(col[old][0]) <= version - KEEP_VERSIONS) old++;
    if (old > 0) sh.deleteRows(2, old);
  }
}
function retainedVersions_() {
  const sh = sheet_(SHEET_VERSIONS, ['version', 'part', 'parts', 'savedAt', 'savedBy', 'action', 'data']);
  const set = {};
  if (sh.getLastRow() >= 2) sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { set[Number(r[0])] = true; });
  return set;
}
function readVersion_(n) {
  const sh = sheet_(SHEET_VERSIONS, ['version', 'part', 'parts', 'savedAt', 'savedBy', 'action', 'data']);
  const last = sh.getLastRow();
  if (last < 2) return null;
  // Find where this version's rows are by reading only the first column, then read just those rows
  // (reading every stored version's data would be slow for large plans).
  const col = sh.getRange(2, 1, last - 1, 1).getValues();
  let first = -1, end = -1;
  for (let i = 0; i < col.length; i++) {
    if (Number(col[i][0]) === n) { if (first < 0) first = i; end = i; }
  }
  if (first < 0) return null;
  const rows = sh.getRange(2 + first, 1, end - first + 1, 7).getValues().filter(function (r) { return Number(r[0]) === n; });
  rows.sort(function (a, b) { return Number(a[1]) - Number(b[1]); });
  return {
    meta: { version: n, updatedAt: str_(rows[0][3]), updatedBy: str_(rows[0][4]), action: str_(rows[0][5]) },
    state: JSON.parse(rows.map(function (r) { return str_(r[6]); }).join(''))
  };
}
function appendAudit_(at, user, action, version, summary, details) {
  const sh = sheet_(SHEET_AUDIT, ['at', 'user', 'action', 'version', 'summary', 'details']);
  let list = details.slice(0, 500), json = JSON.stringify(list);
  while (json.length > 45000 && list.length > 1) { list = list.slice(0, Math.floor(list.length / 2)); json = JSON.stringify(list); }
  if (json.length > 45000) json = '[]';
  sh.getRange(sh.getLastRow() + 1, 1, 1, 6).setValues([[at, user, action, version, String(summary).slice(0, 2000), json]]);
  const n = sh.getLastRow() - 1;
  if (n > KEEP_AUDIT + 500) sh.deleteRows(2, n - KEEP_AUDIT);
}
function readAudit_(limit) {
  const sh = sheet_(SHEET_AUDIT, ['at', 'user', 'action', 'version', 'summary', 'details']);
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const take = Math.min(n, limit);
  const rows = sh.getRange(sh.getLastRow() - take + 1, 1, take, 6).getValues();
  const kept = retainedVersions_();
  return rows.reverse().map(function (r) {
    let details = []; try { details = JSON.parse(str_(r[5]) || '[]'); } catch (e) { details = []; }
    const v = Number(r[3]) || null;
    return { at: str_(r[0]), user: str_(r[1]), action: str_(r[2]), version: v, summary: str_(r[4]), details: details, restorable: v ? !!kept[v] : false };
  });
}

/* Readable copies of the two lists for people who want to look at the data in the Sheet itself. */
function fillReadable_(name, headers, formats, rows) {
  const sh = sheet_(name);
  sh.clear();
  const data = [headers].concat(rows);
  const range = sh.getRange(1, 1, data.length, headers.length);
  range.setNumberFormats(data.map(function () { return formats; }));
  range.setValues(data);
  sh.setFrozenRows(1);
}
function writeReadable_(state) {
  const H = ['Project', 'JIRA ID', 'Task Details', 'PM', 'Start Date', 'End Date', 'Effort MD', 'Resource 1', 'Role 1', 'Resource 2', 'Role 2', 'Resource 3', 'Role 3', 'Test Status', 'Project Status', 'Priority'];
  const F = ['@', '@', '@', '@', 'yyyy-mm-dd', 'yyyy-mm-dd', '0.0##', '@', '@', '@', '@', '@', '@', '@', '@', '@'];
  const row = function (p) {
    const r = p.resources || [], ro = p.resourceRoles || [];
    return [p.projectGroup || '', p.projectId || '', p.projectName || '', p.pm || '', p.start || '', p.end || '',
      (p.effortMD === null || p.effortMD === undefined) ? '' : p.effortMD, r[0] || '', ro[0] || '', r[1] || '', ro[1] || '', r[2] || '', ro[2] || '',
      p.testStatus || '', p.status || '', (p.priority && p.priority !== 'Unspecified') ? p.priority : ''];
  };
  fillReadable_(SHEET_REGISTER, H, F, (state.proposedPlan || []).filter(function (p) { return !p.draft; }).map(row));
  fillReadable_(SHEET_DEPLOYED, H.concat(['Release Date', 'Moved By', 'Moved On']), F.concat(['yyyy-mm-dd', '@', '@']),
    (state.deployedLive || []).map(function (p) { return row(p).concat([p.releaseDate || '', p.deployedBy || '', p.deployedAt || '']); }));
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(25000); } catch (e) { return fail_(503, 'The shared sheet is busy. Please try again in a moment.'); }
  try { return fn(); } finally { lock.releaseLock(); }
}

function save_(body) {
  const user = cleanUser_(body.user);
  const baseVersion = Number(body.baseVersion) || 0;
  const action = String(body.saveAction || 'edit').slice(0, 80);
  const error = validateState(body.state);
  if (error) return fail_(400, error);
  const mine = cleanState(body.state);

  const latest = readLatest_();
  const latestVersion = latest.meta.version, theirs = latest.state;
  // A dashboard page from before the Deployed in Live feature does not send that list; keep what is stored.
  if (mine.deployedLive === undefined && theirs && Array.isArray(theirs.deployedLive)) mine.deployedLive = theirs.deployedLive;
  let next = mine, merged = false;

  if (baseVersion !== latestVersion) {
    const baseRec = baseVersion ? readVersion_(baseVersion) : null;
    if (!theirs || (baseVersion && !baseRec)) {
      return fail_(409, 'Your copy of the plan is too old to merge. The latest version has been loaded.', Object.assign(metaOut_(latest.meta), { state: theirs }));
    }
    try {
      next = mergeStates(baseRec ? baseRec.state : { sourceBaseline: [], currentPlan: [], proposedPlan: [] }, mine, theirs);
      merged = true;
    } catch (e) {
      if (e instanceof MergeConflict) return fail_(409, 'Not saved: ' + e.message + ' The latest version has been loaded; please redo your change.', Object.assign(metaOut_(latest.meta), { state: theirs }));
      throw e;
    }
  }
  if (theirs && DUPLICATE_CHECKED_ACTIONS.has(action)) {
    const clash = newDuplicate(theirs, next);
    if (clash) return fail_(409, 'Not saved: ' + clash + ' The latest version has been loaded; please review it and redo your change.', Object.assign(metaOut_(latest.meta), { state: theirs }));
  }
  if (theirs && same(next, theirs)) {
    return out_(Object.assign(metaOut_(latest.meta), { merged: merged, unchanged: true }, merged ? { state: theirs } : {}));
  }

  const version = latestVersion + 1, at = new Date().toISOString();
  const parts = chunk_(JSON.stringify(next));
  const d = diffStates(theirs, next);
  appendVersion_(version, at, user, action, parts);
  writeLatest_(version, at, user, action, parts);
  appendAudit_(at, user, action, version, d.summary, d.details);
  try { writeReadable_(next); } catch (e) { /* the readable tabs are a convenience; the plan itself is already saved */ }
  return out_(Object.assign({ version: version, updatedAt: at, updatedBy: user, action: action, merged: merged }, merged ? { state: next } : {}));
}

function handle_(params, body) {
  try {
    const key = body ? body.key : params.key;
    const action = String((body ? body.action : params.action) || '');
    if (!key && !action) return ContentService.createTextOutput('Resource Planning Dashboard backend is running. Open the dashboard and paste this address in Setup > Google Sheet sharing.');
    const problem = configProblem_();
    if (problem) return fail_(503, problem);
    const role = roleFor_(key);
    if (!role) return fail_(403, 'The access key is wrong or missing. Ask the dashboard owner for a fresh invite link.');

    if (action === 'me' || action === 'ping') return out_({ ok: true, canEdit: role === 'edit', version: readMeta_().version });
    if (action === 'version') return out_(metaOut_(readMeta_()));
    if (action === 'plan') return withLock_(function () { const r = readLatest_(); return out_(Object.assign(metaOut_(r.meta), { state: r.state })); });
    if (action === 'audit') {
      const limit = Math.min(500, Math.max(1, Number(params.limit) || 50));
      return out_({ entries: readAudit_(limit) });
    }
    if (action === 'getversion') {
      const rec = readVersion_(Number(params.n));
      if (!rec) return fail_(404, 'That version is no longer stored.');
      return out_(Object.assign(rec.meta, { state: rec.state }));
    }
    if (action === 'save') {
      if (role !== 'edit') return fail_(403, 'This link is view-only. Ask the dashboard owner for an edit link.');
      return withLock_(function () { return save_(body); });
    }
    return fail_(404, 'Unknown request.');
  } catch (err) {
    return fail_(500, 'Server error: ' + (err && err.message ? err.message : err));
  }
}
function doGet(e) { return handle_((e && e.parameter) || {}, null); }
function doPost(e) {
  let body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return fail_(400, 'The request was not valid.'); }
  return handle_({}, body);
}
