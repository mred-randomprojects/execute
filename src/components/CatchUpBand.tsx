/**
 * The amnesty offered when you come back to a wall.
 *
 * The gate's job is to stop work carrying forward *silently*. It was never meant
 * to punish absence — but that's what it does after a week away, when twenty
 * overdue commitments stand between you and starting, at the exact moment your
 * motivation is lowest. That's the point people quit, and a strict app you've
 * stopped opening enforces nothing at all.
 *
 * So there's a door: move the whole pile to the Inbox and start today clean. It
 * is still a decision, still one deliberate keystroke, still recorded, and every
 * task keeps its postpone count — which is the difference between an amnesty and
 * a leak.
 */
export function CatchUpBand({
  count,
  daysAway,
  onCatchUp,
}: {
  count: number;
  /** Days the app went unopened. 0 when the pile simply grew while you were here. */
  daysAway: number;
  onCatchUp: () => void;
}) {
  return (
    <div className="mb-5 flex items-center justify-between gap-4 rounded border border-line-strong bg-surface-2 px-4 py-3">
      <p className="text-[13px] leading-snug text-ink-soft">
        <span className="font-medium text-ink">
          {daysAway > 0
            ? `${daysAway} day${daysAway === 1 ? "" : "s"} away. ${count} commitments went past.`
            : `${count} commitments went past.`}
        </span>{" "}
        Work through them one at a time — or move the pile to the Inbox and start
        today clean. Nothing is lost either way: each one keeps its history, and
        the move is recorded.
      </p>
      <button
        onClick={onCatchUp}
        className="shrink-0 rounded-sm border border-line-strong px-2.5 py-1 text-[12px] font-medium text-ink-soft transition-colors hover:bg-surface hover:text-ink"
        aria-label="Move them all to the Inbox"
      >
        Start clean
      </button>
    </div>
  );
}
