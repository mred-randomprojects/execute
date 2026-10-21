import { useEffect, useRef, useState } from "react";
import type { BackupFile } from "../store/persistence";
import { backupKind, backupWhen } from "../ui/backups";

const size = (bytes: number) =>
  bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;

/**
 * "Restore a backup…": the files in the desktop's backups/ folder, newest
 * first. ↑/↓ choose, ↵ picks (a confirm follows), esc closes. Owns the
 * keyboard while open, like the other pickers.
 */
export function BackupPicker({
  backups,
  onPick,
  onClose,
}: {
  backups: BackupFile[];
  onPick: (b: BackupFile) => void;
  onClose: () => void;
}) {
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const selRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    listRef.current?.focus();
  }, []);

  useEffect(() => {
    selRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [sel]);

  const pick = (b: BackupFile) => {
    onClose();
    onPick(b);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-scrim p-8 pt-[16vh] backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        ref={listRef}
        role="dialog"
        aria-label="Restore a backup"
        tabIndex={-1}
        className="w-full max-w-md overflow-hidden rounded border border-line bg-surface shadow-lg outline-none"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSel((s) => Math.min(s + 1, backups.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSel((s) => Math.max(s - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const chosen = backups[sel];
            if (chosen != null) pick(chosen);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      >
        <div className="mono border-b border-line px-4 py-2.5 text-[11px] uppercase tracking-[0.14em] text-ink-faint">
          Restore a backup
        </div>
        <div role="listbox" aria-label="Backups" className="max-h-80 overflow-auto py-1">
          {backups.map((b, i) => (
            <button
              key={b.name}
              ref={i === sel ? selRef : null}
              role="option"
              aria-selected={i === sel}
              onMouseMove={() => setSel(i)}
              onClick={() => pick(b)}
              className={[
                "flex w-full items-baseline gap-3 px-4 py-2 text-left text-[14px]",
                i === sel ? "bg-surface-2 text-ink" : "text-ink-soft",
              ].join(" ")}
            >
              <span className="mono shrink-0 tabular-nums">{backupWhen(b)}</span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink-faint">{backupKind(b)}</span>
              <span className="mono shrink-0 text-[11px] text-ink-faint">{size(b.size)}</span>
            </button>
          ))}
        </div>
        <div className="border-t border-line px-4 py-1.5 text-[11px] text-ink-faint">
          A daily copy is your data just before that day's first change · ↑↓ to choose · ↵ to restore
        </div>
      </div>
    </div>
  );
}
