"use strict";
/*
 * Makes a consistent copy of the shared-plan database while the server keeps running.
 * Usage:  node server/backup.js [backup-folder]      (default: server/backups)
 * Schedule it daily with Windows Task Scheduler and keep the backup folder on backed-up storage.
 */
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const configPath = process.env.DASHBOARD_CONFIG || path.join(__dirname, "config.json");
let dbPath = "data/dashboard.db";
try { dbPath = JSON.parse(fs.readFileSync(configPath, "utf8")).dbPath || dbPath; } catch { /* use default */ }
const dbFile = path.resolve(__dirname, dbPath);
if (!fs.existsSync(dbFile)) { console.error(`Database not found: ${dbFile}`); process.exit(1); }

const outDir = path.resolve(process.argv[2] || path.join(__dirname, "backups"));
fs.mkdirSync(outDir, { recursive: true });
const d = new Date();
const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
const outFile = path.join(outDir, `dashboard_${stamp}.db`);

const db = new DatabaseSync(dbFile);
db.exec(`VACUUM INTO '${outFile.replace(/'/g, "''")}'`);
db.close();
console.log(`Backup written: ${outFile}`);
