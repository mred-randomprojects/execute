const fs = require("node:fs");
const path = require("node:path");

// Daily rolling copies of the store, in userData/backups/. The store is one file
// rewritten on every edit, so without these a bug that reaches disk leaves
// nothing from before it. Kept apart from main.cjs so it can be tested without
// Electron (see backups.test.mjs).

/** How many daily copies to keep. */
const KEEP = 30;

/** Exactly the names this module writes; nothing else in backups/ is ever touched. */
const DAILY = /^execute-store\.\d{4}-\d{2}-\d{2}\.json$/;

/** `date` as YYYY-MM-DD in local time (toISOString would give the UTC day). */
function localDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dailyName(date) {
  return `execute-store.${localDate(date)}.json`;
}

/**
 * Of the names in backups/, the daily copies to delete: all but the newest
 * `keep`. Names that aren't exactly `execute-store.YYYY-MM-DD.json` (the
 * one-off pre-sync-v2 copies, anything put there by hand) are never returned.
 */
function dailyBackupsToPrune(names, keep = KEEP) {
  const daily = names.filter((name) => DAILY.test(name)).sort(); // ISO dates sort by age
  return daily.slice(0, Math.max(0, daily.length - keep));
}

/**
 * Copy the store file to backups/execute-store.<local date>.json unless today's
 * copy already exists, then prune the daily copies to the newest `keep`.
 * Returns the path written, or null when there was nothing to do.
 */
function backUpDaily(storeFile, backupsDir, now = new Date(), keep = KEEP) {
  const target = path.join(backupsDir, dailyName(now));
  if (fs.existsSync(target) || !fs.existsSync(storeFile)) return null;
  fs.mkdirSync(backupsDir, { recursive: true });
  fs.copyFileSync(storeFile, target, fs.constants.COPYFILE_EXCL);
  for (const name of dailyBackupsToPrune(fs.readdirSync(backupsDir), keep)) {
    fs.unlinkSync(path.join(backupsDir, name));
  }
  return target;
}

// ── Restoring one (the renderer's "Restore a backup…") ───────────────

/**
 * A name the renderer may ask for: a plain file name in backups/, ending in
 * .json. No separators, no leading dot, so it can't reach outside the folder.
 */
const BACKUP_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/;

/** The JSON files in backups/, newest first: name, size, last modified. */
function listBackups(backupsDir) {
  let names;
  try {
    names = fs.readdirSync(backupsDir);
  } catch (error) {
    if (error != null && error.code === "ENOENT") return [];
    throw error;
  }
  const out = [];
  for (const name of names) {
    if (!BACKUP_NAME.test(name)) continue;
    const stat = fs.lstatSync(path.join(backupsDir, name));
    if (stat.isFile()) out.push({ name, size: stat.size, mtimeMs: stat.mtimeMs });
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.name < b.name ? 1 : -1));
}

/** One backup, parsed. Only a name `listBackups` could return. */
function readBackup(backupsDir, name) {
  if (typeof name !== "string" || !BACKUP_NAME.test(name)) throw new Error("Not a backup file name.");
  const file = path.join(backupsDir, name);
  if (!fs.lstatSync(file).isFile()) throw new Error("Not a backup file.");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * Before a restore: keep what the app holds now as
 * backups/execute-store.before-restore.<local date>-<hhmmss>.json, so nothing
 * the restore overwrote is lost, even after a restart has emptied ⌘z.
 * Restoring that file puts every edit the restore reverted back; it doesn't
 * delete what the restore brought back (a restore never deletes). Never
 * overwrites a file, and the daily prune never touches these names. Returns
 * the name written.
 */
function keepCopyBeforeRestore(backupsDir, data, now = new Date()) {
  fs.mkdirSync(backupsDir, { recursive: true });
  const hhmmss = [now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, "0")).join("");
  const base = `execute-store.before-restore.${localDate(now)}-${hhmmss}`;
  const json = JSON.stringify(data);
  for (let n = 0; n < 100; n++) {
    const name = n === 0 ? `${base}.json` : `${base}-${n}.json`;
    try {
      fs.writeFileSync(path.join(backupsDir, name), json, { encoding: "utf8", flag: "wx" });
      return name;
    } catch (error) {
      if (error == null || error.code !== "EEXIST") throw error;
    }
  }
  throw new Error("Couldn't find a free name for the copy before restoring.");
}

module.exports = {
  KEEP,
  backUpDaily,
  dailyBackupsToPrune,
  keepCopyBeforeRestore,
  listBackups,
  localDate,
  readBackup,
};
