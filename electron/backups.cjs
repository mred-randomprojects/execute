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

module.exports = { KEEP, backUpDaily, dailyBackupsToPrune, localDate };
