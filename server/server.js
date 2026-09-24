"use strict";
/*
 * Shared-plan server for the Project Status and Resource Engagement Plan Dashboard.
 *
 * - Serves the dashboard (index.html and its assets) and a small JSON API.
 * - Stores every saved version of the shared plan in SQLite (node:sqlite, no npm packages).
 * - Identifies users from the Windows login that IIS forwards in the X-Remote-User header
 *   (authMode "iis"), or from a fixed local user for development (authMode "dev").
 * - Editors (listed in config.json) can save; everyone else who signs in is a viewer.
 * - Every save is written to an audit log with who changed what.
 *
 * Run:  node server/server.js            (reads server/config.json if present)
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { DatabaseSync } = require("node:sqlite");

const APP_ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = process.env.DASHBOARD_CONFIG || path.join(__dirname, "config.json");
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const ROW_LISTS = ["sourceBaseline", "currentPlan", "proposedPlan"];
const STRING_SETS = ["addedResources", "customTestStatuses", "removedTestStatuses", "customSourceStatuses", "removedSourceStatuses"];

/* ---------- Configuration (re-read automatically when config.json changes) ---------- */
function defaultDevUser() {
  const domain = process.env.USERDOMAIN;
  const name = os.userInfo().username;
  return domain ? `${domain}\\${name}` : name;
}
const DEFAULTS = {
  host: "127.0.0.1",
  port: 3000,
  authMode: "dev",
  devUser: defaultDevUser(),
  editors: null, // null => devUser only (dev mode) / nobody (iis mode)
  dbPath: "data/dashboard.db",
  keepVersions: 1000
};
let config = null;
let configMtime = -1;
function loadConfig() {
  let mtime = 0;
  try { mtime = fs.statSync(CONFIG_PATH).mtimeMs; } catch { mtime = 0; }
  if (config && mtime === configMtime) return config;
  let fileCfg = {};
  if (mtime) {
    try { fileCfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); }
    catch (e) {
      if (config) { console.error(`config.json is invalid, keeping previous settings: ${e.message}`); return config; }
      throw new Error(`config.json is invalid: ${e.message}`);
    }
  }
  const next = { ...DEFAULTS, ...fileCfg };
  if (!Array.isArray(next.editors)) next.editors = next.authMode === "dev" ? [next.devUser] : [];
  next.editorsLower = new Set(next.editors.map(e => String(e).trim().toLowerCase()));
  if (config) console.log(`Configuration reloaded (${next.editors.length} editor entr${next.editors.length === 1 ? "y" : "ies"}).`);
  config = next;
  configMtime = mtime;
  return config;
}
loadConfig();

if (!["iis", "dev"].includes(config.authMode)) {
  console.error(`authMode must be "iis" or "dev" (got "${config.authMode}").`);
  process.exit(1);
}
if (config.authMode === "iis" && !["127.0.0.1", "::1", "localhost"].includes(config.host)) {
  // The X-Remote-User header can only be trusted when nothing but IIS can reach this port.
  console.error(`authMode "iis" requires host 127.0.0.1 so only IIS can reach the server (got "${config.host}").`);
  process.exit(1);
}

/* ---------- Database ---------- */
const dbFile = path.resolve(__dirname, config.dbPath);
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
const db = new DatabaseSync(dbFile);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS plan_versions (
    version    INTEGER PRIMARY KEY,
    saved_at   TEXT NOT NULL,
    saved_by   TEXT NOT NULL,
    action     TEXT NOT NULL,
    state_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    at           TEXT NOT NULL,
    user         TEXT NOT NULL,
    action       TEXT NOT NULL,
    version      INTEGER,
    summary      TEXT NOT NULL,
    details_json TEXT
  );
`);
const q = {
  latest: db.prepare("SELECT version, saved_at, saved_by, action, state_json FROM plan_versions ORDER BY version DESC LIMIT 1"),
  latestMeta: db.prepare("SELECT version, saved_at, saved_by, action FROM plan_versions ORDER BY version DESC LIMIT 1"),
  byVersion: db.prepare("SELECT version, saved_at, saved_by, action, state_json FROM plan_versions WHERE version = ?"),
  insertVersion: db.prepare("INSERT INTO plan_versions (version, saved_at, saved_by, action, state_json) VALUES (?, ?, ?, ?, ?)"),
  prune: db.prepare("DELETE FROM plan_versions WHERE version <= ?"),
  insertAudit: db.prepare("INSERT INTO audit_log (at, user, action, version, summary, details_json) VALUES (?, ?, ?, ?, ?, ?)"),
  audit: db.prepare("SELECT id, at, user, action, version, summary, details_json FROM audit_log ORDER BY id DESC LIMIT ?"),
  hasVersion: db.prepare("SELECT 1 FROM plan_versions WHERE version = ?")
};

/* ---------- Identity ---------- */
function identify(req) {
  const cfg = loadConfig();
  if (cfg.authMode === "dev") return cfg.devUser;
  const raw = String(req.headers["x-remote-user"] || "").trim();
  return raw || null;
}
function canEdit(user) {
  const cfg = loadConfig();
  return cfg.editorsLower.has("*") || cfg.editorsLower.has(String(user).toLowerCase());
}

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
  const listNames = { proposedPlan: "Proposed plan", currentPlan: "Current plan", sourceBaseline: "Source baseline" };
  for (const list of ["proposedPlan", "currentPlan", "sourceBaseline"]) {
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

function validateState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return "Plan state must be an object.";
  for (const list of ROW_LISTS) {
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

/* ---------- HTTP helpers ---------- */
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'"
};
function send(res, status, body, headers = {}) {
  const isJson = typeof body !== "string" && !Buffer.isBuffer(body);
  const payload = isJson ? JSON.stringify(body) : body;
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Cache-Control": "no-store",
    ...(isJson ? { "Content-Type": "application/json; charset=utf-8" } : {}),
    ...headers
  });
  res.end(payload);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", c => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error("Request is too large."), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch { reject(Object.assign(new Error("Request body is not valid JSON."), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

/* ---------- Static files (explicit allow-list: never serves server code, config or the database) ---------- */
const STATIC_FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/favicon.svg": ["favicon.svg", "image/svg+xml"],
  "/site.webmanifest": ["site.webmanifest", "application/manifest+json"],
  "/templates/Demo_Project_Register_Template.xlsx": ["templates/Demo_Project_Register_Template.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]
};
function serveStatic(res, pathname) {
  const hit = STATIC_FILES[pathname];
  if (!hit) return send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
  fs.readFile(path.join(APP_ROOT, hit[0]), (err, data) => {
    if (err) return send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
    send(res, 200, data, { "Content-Type": hit[1], "Cache-Control": "no-cache" });
  });
}

/* ---------- API ---------- */
function planMeta(row) {
  return row ? { version: row.version, updatedAt: row.saved_at, updatedBy: row.saved_by, action: row.action } : { version: 0, updatedAt: null, updatedBy: null, action: null };
}

function savePlan(user, body) {
  const baseVersion = Number(body.baseVersion) || 0;
  const action = String(body.action || "edit").slice(0, 80);
  const error = validateState(body.state);
  if (error) return [400, { error }];
  const mine = cleanState(body.state);

  db.exec("BEGIN IMMEDIATE");
  try {
    const latest = q.latest.get();
    const latestVersion = latest ? latest.version : 0;
    const theirs = latest ? JSON.parse(latest.state_json) : null;
    let next = mine, merged = false;

    if (baseVersion !== latestVersion) {
      const baseRow = baseVersion ? q.byVersion.get(baseVersion) : null;
      if (!theirs || (baseVersion && !baseRow)) {
        db.exec("ROLLBACK");
        return [409, { error: "Your copy of the plan is too old to merge. The latest version has been loaded.", ...planMeta(latest), state: theirs }];
      }
      try {
        next = mergeStates(baseRow ? JSON.parse(baseRow.state_json) : { sourceBaseline: [], currentPlan: [], proposedPlan: [] }, mine, theirs);
        merged = true;
      } catch (e) {
        db.exec("ROLLBACK");
        if (e instanceof MergeConflict) return [409, { error: `Not saved: ${e.message} The latest version has been loaded; please redo your change.`, ...planMeta(latest), state: theirs }];
        throw e;
      }
    }

    if (theirs && same(next, theirs)) {
      db.exec("ROLLBACK");
      return [200, { ...planMeta(latest), merged, unchanged: true, ...(merged ? { state: theirs } : {}) }];
    }

    const version = latestVersion + 1;
    const now = new Date().toISOString();
    q.insertVersion.run(version, now, user, action, JSON.stringify(next));
    const { summary, details } = diffStates(theirs, next);
    q.insertAudit.run(now, user, action, version, summary, JSON.stringify(details));
    const keep = Math.max(10, Number(loadConfig().keepVersions) || DEFAULTS.keepVersions);
    if (version > keep) q.prune.run(version - keep);
    db.exec("COMMIT");
    console.log(`${now}  v${version}  ${user}  ${action}  ${summary}`);
    return [200, { version, updatedAt: now, updatedBy: user, action, merged, ...(merged ? { state: next } : {}) }];
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
    throw e;
  }
}

async function handleApi(req, res, pathname, url) {
  const user = identify(req);
  if (!user) return send(res, 401, { error: "Not signed in. IIS must use Windows Authentication and forward the user to this server." });
  const editor = canEdit(user);

  if (req.method !== "GET") {
    // Custom header forces a CORS preflight, which this server never approves, so other sites cannot post here.
    if (req.headers["x-requested-with"] !== "dashboard") return send(res, 403, { error: "Missing request header." });
    if (!editor) return send(res, 403, { error: "You have view-only access. Ask an administrator to add you to the editors list." });
  }

  if (req.method === "GET" && pathname === "/api/me") {
    return send(res, 200, { user, canEdit: editor, authMode: loadConfig().authMode });
  }
  if (req.method === "GET" && pathname === "/api/plan") {
    const latest = q.latest.get();
    return send(res, 200, { ...planMeta(latest), state: latest ? JSON.parse(latest.state_json) : null });
  }
  if (req.method === "GET" && pathname === "/api/plan/version") {
    return send(res, 200, planMeta(q.latestMeta.get()));
  }
  if (req.method === "PUT" && pathname === "/api/plan") {
    const [status, body] = savePlan(user, await readJson(req));
    return send(res, status, body);
  }
  if (req.method === "GET" && pathname === "/api/audit") {
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 50));
    const rows = q.audit.all(limit).map(r => ({
      id: r.id, at: r.at, user: r.user, action: r.action, version: r.version, summary: r.summary,
      details: r.details_json ? JSON.parse(r.details_json) : [],
      restorable: r.version ? !!q.hasVersion.get(r.version) : false
    }));
    return send(res, 200, { entries: rows });
  }
  const versionMatch = pathname.match(/^\/api\/versions\/(\d+)$/);
  if (req.method === "GET" && versionMatch) {
    const row = q.byVersion.get(Number(versionMatch[1]));
    if (!row) return send(res, 404, { error: "That version is no longer stored." });
    return send(res, 200, { ...planMeta(row), state: JSON.parse(row.state_json) });
  }
  return send(res, 404, { error: "Unknown API endpoint." });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith("/api/")) return await handleApi(req, res, pathname, url);
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed", { "Content-Type": "text/plain; charset=utf-8" });
    return serveStatic(res, pathname);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) send(res, status, { error: status === 500 ? "Server error." : e.message });
  }
});

server.listen(config.port, config.host, () => {
  const latest = q.latestMeta.get();
  console.log(`Resource Planning Dashboard server listening on http://${config.host}:${config.port}/`);
  console.log(`Auth mode: ${config.authMode}${config.authMode === "dev" ? ` (everyone is treated as ${config.devUser} — local testing only)` : " (user from IIS X-Remote-User header)"}`);
  console.log(`Editors: ${config.editors.length ? config.editors.join(", ") : "(none — everyone is view-only)"}`);
  console.log(`Database: ${dbFile} · ${latest ? `shared plan at v${latest.version}` : "no shared plan yet (first editor to open the dashboard publishes it)"}`);
});
