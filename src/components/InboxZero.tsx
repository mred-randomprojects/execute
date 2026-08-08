import type { Run } from "../store/streak";

export function InboxZero({ total, run }: { total: number; run: Run }) {
  return (
    <div className="rounded border border-good/30 bg-good-soft px-6 py-8 text-center">
      <div className="eyebrow mb-2 text-good">Inbox zero</div>
      <h2 className="font-serif text-[26px] font-medium tracking-tight text-ink">
        Everything for today is done.
      </h2>
      <p className="mt-2 text-[14px] text-ink-soft">
        {total} task{total === 1 ? "" : "s"} cleared. Rest, or plan tomorrow.
      </p>
      {/* The moment the run is worth naming is the moment you just extended it. */}
      {run.days > 0 && (
        <p className="mt-3 text-[13px] text-ink-faint">
          <span className="text-good">
            {run.days} day{run.days === 1 ? "" : "s"} closed running
          </span>
          {run.missed > 0 && ` · ${run.missed} missed`}
        </p>
      )}
    </div>
  );
}
