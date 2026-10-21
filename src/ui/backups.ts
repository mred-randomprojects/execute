import type { BackupFile } from "../store/persistence";

/** When a backup was written, e.g. "Oct 18, 00:01". */
export function backupWhen(b: BackupFile): string {
  return new Date(b.mtimeMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** What a backup file is, by its name (electron/backups.cjs writes the first two). */
export function backupKind(b: BackupFile): string {
  if (/^execute-store\.\d{4}-\d{2}-\d{2}\.json$/.test(b.name)) return "daily copy";
  if (b.name.startsWith("execute-store.before-restore.")) return "what you had before a restore";
  return b.name;
}
