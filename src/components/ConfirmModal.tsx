import { useRef, useEffect } from "react";

/** A pending confirmation: what to show, and what to do if the user accepts. */
export interface ConfirmRequest {
  title: string;
  body?: string;
  /** Label for the action button (e.g. "Delete", "Empty trash", "Subtasks too"). */
  confirmLabel: string;
  onConfirm: () => void;
  /** Runs on decline (esc / Cancel). Optional: most confirms just do nothing. */
  onCancel?: () => void;
  /** What Enter does. Point it at "cancel" when declining is the safe default. */
  enterAction?: "confirm" | "cancel";
  /** "danger" (default) styles the confirm button red; "neutral" uses the accent. */
  tone?: "danger" | "neutral";
}

/**
 * Keyboard-first confirmation dialog. Enter triggers `enterAction` (accept by
 * default), Escape cancels, and `y` / `n` always answer directly; the overlay
 * owns the keyboard while open (the resolver maps it to the binding-less
 * "confirm" context, so nothing fires beneath it). Visual language matches
 * SchedulePicker.
 */
export function ConfirmModal({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  enterAction = "confirm",
  tone = "danger",
}: {
  title: string;
  body?: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  enterAction?: "confirm" | "cancel";
  tone?: "danger" | "neutral";
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-8 pt-[18vh] backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        ref={ref}
        tabIndex={-1}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            (enterAction === "confirm" ? onConfirm : onCancel)();
          } else if (e.key === "Escape" || e.key === "n") {
            e.preventDefault();
            onCancel();
          } else if (e.key === "y") {
            e.preventDefault();
            onConfirm();
          }
        }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm overflow-hidden rounded border border-line bg-surface shadow-lg outline-none"
      >
        <div className="px-5 pb-3 pt-4">
          <h2 className="text-[15px] font-medium text-ink">{title}</h2>
          {body != null && (
            <p className="mt-1.5 text-[13px] leading-snug text-ink-soft">{body}</p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-2.5">
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[13px] text-ink-soft hover:text-ink"
          >
            Cancel <span className="kbd">{enterAction === "cancel" ? "↵ / esc" : "esc"}</span>
          </button>
          <button
            onClick={onConfirm}
            className={[
              "flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[13px] font-medium",
              tone === "danger"
                ? "border-bad/40 bg-bad-soft text-bad hover:border-bad/70"
                : "border-accent/40 bg-accent-soft text-accent hover:border-accent/70",
            ].join(" ")}
          >
            {confirmLabel} <span className="kbd">{enterAction === "confirm" ? "↵" : "y"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
