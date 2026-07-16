import { useRef, useState, useEffect } from "react";
import { BLOCK_MINUTES } from "../types";
import {
  ESTIMATE_PRESETS,
  MAX_ESTIMATE_BLOCKS,
  blocksFromMinutes,
  formatMinutes,
} from "../store/estimate";

/**
 * A small modal for setting a task's effort estimate in "blocks" (~20m each).
 * Mirrors {@link SchedulePicker}: it focuses itself and stops key propagation,
 * so the outline shortcuts stay dormant beneath it. Returns the chosen minute
 * count (or null to clear) to the caller.
 */
export function EstimatePicker({
  count,
  current,
  onPick,
  onClose,
}: {
  count: number;
  /** The focused task's current estimate in minutes (null = none). */
  current: number | null;
  onPick: (minutes: number | null) => void;
  onClose: () => void;
}) {
  const currentBlocks = blocksFromMinutes(current);
  // Options: a "None" row (blocks 0) followed by each preset.
  const opts: number[] = [0, ...ESTIMATE_PRESETS];
  const initial = Math.max(0, opts.indexOf(currentBlocks));
  const [sel, setSel] = useState(initial === -1 ? 0 : initial);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const pick = (blocks: number) => {
    onClose();
    onPick(blocks <= 0 ? null : blocks * BLOCK_MINUTES);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-8 pt-[16vh] backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        ref={ref}
        role="dialog"
        aria-label="Estimate"
        tabIndex={-1}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSel((s) => Math.min(s + 1, opts.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSel((s) => Math.max(s - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(opts[sel]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (e.key === "0" || e.key === "n") {
            e.preventDefault();
            pick(0);
          } else if (e.key >= "1" && e.key <= String(MAX_ESTIMATE_BLOCKS)) {
            // A digit sets that many blocks directly, even if it isn't a preset.
            e.preventDefault();
            pick(Number(e.key));
          }
        }}
        className="w-full max-w-sm overflow-hidden rounded border border-line bg-surface shadow-lg outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mono border-b border-line px-4 py-2.5 text-[11px] uppercase tracking-[0.14em] text-ink-faint">
          Estimate{count > 1 ? ` · ${count} tasks` : ""}
        </div>
        <div className="py-1">
          {opts.map((blocks, i) => (
            <button
              key={blocks}
              onMouseMove={() => setSel(i)}
              onClick={() => pick(blocks)}
              className={[
                "flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-[14px]",
                i === sel ? "bg-surface-2 text-ink" : "text-ink-soft",
              ].join(" ")}
            >
              <span className="flex items-baseline gap-2">
                <span>{blocks === 0 ? "No estimate" : `${blocks} block${blocks === 1 ? "" : "s"}`}</span>
                {blocks > 0 && (
                  <span className="mono text-[11px] text-ink-faint">
                    {formatMinutes(blocks * BLOCK_MINUTES)}
                  </span>
                )}
                {currentBlocks === blocks && <span className="text-[11px] text-accent">●</span>}
              </span>
              <span className="kbd">{blocks === 0 ? "0" : blocks}</span>
            </button>
          ))}
        </div>
        <div className="border-t border-line px-4 py-2 text-[11px] text-ink-faint">
          One block ≈ {BLOCK_MINUTES} minutes of focused work.
        </div>
      </div>
    </div>
  );
}
