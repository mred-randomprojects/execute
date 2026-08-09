import { useEffect, useRef } from "react";
import type { ISODate } from "../types";
import { WAITING_STALE_DAYS } from "../types";
import type { Review } from "../store/review";
import { formatLong } from "../store/dates";

function Stat({ value, label, tone }: { value: number; label: string; tone?: string }) {
  return (
    <div>
      <div className={`mono text-[20px] leading-none ${tone ?? "text-ink"}`}>{value}</div>
      <div className="mt-1 text-[11px] text-ink-faint">{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-3">
      <div className="eyebrow mb-2">{title}</div>
      {children}
    </section>
  );
}

const daysSince = (ms: number): number => Math.floor((Date.now() - ms) / 86_400_000);

/**
 * The week, read back to you.
 *
 * Every number here was already being recorded and none of it was ever shown.
 * The reasons matter most: one at a time they're a shrug, in aggregate they're a
 * diagnosis — "no time ×9" is a capacity problem, "waiting on Ana ×4" is a
 * dependency problem, and they want opposite fixes.
 */
export function ReviewPanel({
  review,
  today,
  onClose,
}: {
  review: Review;
  today: ISODate;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const { counts, rate } = review;
  const deferred = counts.postponed + counts.kept;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-8 pt-[10vh] backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-label="Review"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape" || e.key === "Enter") {
            e.preventDefault();
            onClose();
          }
        }}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded border border-line bg-surface shadow-lg outline-none"
      >
        <div className="mono flex items-center justify-between border-b border-line px-5 py-2.5 text-[11px] uppercase tracking-[0.14em] text-ink-faint">
          <span>Your week</span>
          <span>
            {formatLong(review.from)} – {formatLong(review.to)}
          </span>
        </div>

        <div className="flex flex-col gap-5 overflow-auto px-5 py-4">
          <div className="grid grid-cols-4 gap-3">
            <Stat
              value={rate.closed}
              label={rate.counted > 0 ? `of ${rate.counted} days closed` : "days closed"}
              tone="text-good"
            />
            <Stat value={counts.completed} label="finished" />
            <Stat value={counts.skipped} label="declined" />
            <Stat value={deferred} label="deferred" tone={deferred > 0 ? "text-bad" : undefined} />
          </div>

          {review.reasons.length > 0 && (
            <Section title="Why things didn't happen">
              <ul className="flex flex-col gap-1">
                {review.reasons.map((r) => (
                  <li key={r.reason} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-[13px] text-ink">{r.reason}</span>
                    <span className="mono shrink-0 text-[12px] text-ink-faint">×{r.count}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {review.waiting.length > 0 && (
            <Section title="Waiting on others">
              <ul className="flex flex-col gap-1">
                {review.waiting.map((t) => {
                  const days = daysSince(t.waitingOn?.since ?? Date.now());
                  return (
                    <li key={t.id} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-[13px] text-ink">
                        {t.text === "" ? "Untitled" : t.text}
                        {t.waitingOn?.who != null && t.waitingOn.who.trim() !== "" && (
                          <span className="text-ink-faint"> · {t.waitingOn.who}</span>
                        )}
                      </span>
                      <span
                        className={`mono shrink-0 text-[12px] ${
                          days >= WAITING_STALE_DAYS ? "text-bad" : "text-ink-faint"
                        }`}
                      >
                        {days}d
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}

          {review.chronic.length > 0 && (
            <Section title="Kept putting off">
              <ul className="flex flex-col gap-1">
                {review.chronic.map(({ task, deferrals }) => (
                  <li key={task.id} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-[13px] text-ink">
                      {task.text === "" ? "Untitled" : task.text}
                    </span>
                    <span className="mono shrink-0 text-[12px] text-bad">{deferrals}×</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[12px] text-ink-faint">
                A task you've deferred this often isn't a task. Break it into the
                smallest step you'd actually do, or decide you won't.
              </p>
            </Section>
          )}

          {rate.counted === 0 && review.reasons.length === 0 && (
            <p className="py-6 text-center text-[13px] text-ink-faint">
              Nothing to review yet — this fills in as you close days.
            </p>
          )}
        </div>

        <div className="border-t border-line px-5 py-1.5 text-[11px] text-ink-faint">
          Everything here was already being recorded · esc to close
          {today !== review.to && ` · as of ${review.to}`}
        </div>
      </div>
    </div>
  );
}
