import type { Task } from "../types";
import { deferralBadges } from "../store/deferral";

/**
 * "carried 3×" / "postponed 5×" chips — a task's deferral ledger, rendered
 * wherever the task is.
 *
 * Deliberately not confined to the Reckoning. The counters existed before this
 * component and were only ever shown *inside the gate*, which is the one moment
 * you already know the task is overdue; seeing "postponed 6×" in the middle of
 * an ordinary Today list is what actually changes a decision. See
 * {@link deferralBadges} for which counts qualify and when the tone escalates.
 */
export function DeferralBadges({
  task,
  className = "",
}: {
  task: Task;
  className?: string;
}) {
  const badges = deferralBadges(task);
  if (badges.length === 0) return null;
  return (
    <>
      {badges.map((b) => (
        <span
          key={b.kind}
          title={b.title}
          className={[
            "mono shrink-0 rounded-sm border px-1.5 py-[1px] text-[10px]",
            b.tone === "loud"
              ? "border-bad/40 text-bad"
              : "border-line-strong text-ink-faint",
            className,
          ].join(" ")}
        >
          {b.label}
        </span>
      ))}
    </>
  );
}
