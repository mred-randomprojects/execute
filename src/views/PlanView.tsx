import type { Project, TaskId } from "../types";
import { BLOCK_MINUTES } from "../types";
import type { CapacityLoad, PlanCandidate } from "../selectors";
import { ActionChip } from "../components/ActionChip";
import { BlockPips } from "../components/BlockPips";
import { DeferralBadges } from "../components/DeferralBadges";
import { formatMinutes } from "../store/estimate";

const SOURCE_LABEL: Record<PlanCandidate["source"], string> = {
  week: "this week",
  suggested: "suggested",
  recurring: "recurring",
};

/**
 * The morning half of the pair. Shutdown closes the day; this opens it.
 *
 * The old flow left the choosing implicit: candidates existed (horizon
 * projections, recurrences firing today, work you'd scheduled for this week) but
 * only ever as passive rows you might scroll past. Deciding what today *is*
 * happened by accident, or not at all — and a day nobody chose is the day that
 * over-commits, because saying yes to one more thing costs nothing when you
 * can't see the total.
 *
 * So: everything on offer in one place, one key to take it on, and the capacity
 * meter filling as you go. The point isn't to fill the bar — it's to make the
 * cost of the next yes visible at the moment you say it.
 */
export function PlanView({
  candidates,
  cursorId,
  committed,
  capacity,
  projects,
  onSelect,
  onAccept,
  onPush,
  onDone,
}: {
  candidates: PlanCandidate[];
  cursorId: TaskId | null;
  /** How much is already committed to today — what you're adding to. */
  committed: number;
  capacity: CapacityLoad;
  projects: Project[];
  onSelect: (id: TaskId) => void;
  onAccept: (c: PlanCandidate) => void;
  onPush: (c: PlanCandidate) => void;
  onDone: () => void;
}) {
  const over = capacity.overBlocks > 0;

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-10 py-10">
      <header className="mb-5 flex items-start justify-between gap-4 border-b border-line pb-5">
        <div>
          <div className="eyebrow mb-1.5 text-accent">Plan</div>
          <h1 className="font-serif text-[32px] font-medium leading-none tracking-tight text-ink">
            {candidates.length === 0 ? "Nothing waiting to be planned." : "What is today?"}
          </h1>
          <p className="mt-2 max-w-xl text-[14px] text-ink-soft">
            {candidates.length === 0 ? (
              <>
                {committed > 0
                  ? `${committed} already committed for today. Nothing else is asking.`
                  : "Nothing from this week or your recurrences is asking for today. Capture something, or enjoy the quiet."}
              </>
            ) : (
              <>
                {committed} committed so far. Take on what you'll really do — the
                meter is the point, not the list.
              </>
            )}
          </p>
        </div>
        <button tabIndex={-1} onClick={onDone} className="kbd shrink-0" aria-label="Done planning">
          esc
        </button>
      </header>

      {/* The running total. Deliberately above the list: the cost of the next
          "yes" has to be visible at the moment you say it, not discovered by the
          gate tomorrow. */}
      <div
        className={[
          "mb-5 flex items-center justify-between rounded border px-4 py-2.5",
          over ? "border-bad/40 bg-bad-soft" : "border-line bg-surface",
        ].join(" ")}
      >
        <span className="text-[13px] text-ink">
          <span className={`mono font-medium ${over ? "text-bad" : "text-ink"}`}>
            {capacity.usedBlocks} / {capacity.capacityBlocks} blocks
          </span>
          <span className="text-ink-soft">
            {" "}
            · ≈ {formatMinutes(capacity.usedMinutes)} of{" "}
            {formatMinutes(capacity.capacityBlocks * BLOCK_MINUTES)}
            {capacity.unestimated > 0 && ` · ${capacity.unestimated} unestimated`}
          </span>
        </span>
        {over && (
          <span className="mono shrink-0 text-[11px] text-bad">over by {capacity.overBlocks}</span>
        )}
      </div>

      <div className="flex flex-1 flex-col overflow-auto">
        {candidates.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line px-4 py-10 text-center text-[13px] text-ink-faint">
            Press <span className="kbd">esc</span> and get started.
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {candidates.map((c) => {
              const focused = c.id === cursorId;
              const project = projects.find((p) => p.id === c.task.projectId) ?? null;
              return (
                <div
                  key={c.id}
                  onClick={() => onSelect(c.id)}
                  className={[
                    "relative rounded px-3 py-2.5",
                    focused ? "bg-surface-2" : "cursor-pointer hover:bg-surface-2/60",
                  ].join(" ")}
                >
                  {focused && (
                    <span className="absolute left-0 top-2 bottom-2 w-[2px] bg-accent" />
                  )}
                  <div className="flex items-center gap-3">
                    <span className="mono w-[68px] shrink-0 text-[11px] text-ink-faint">
                      {SOURCE_LABEL[c.source]}
                    </span>
                    {project != null && (
                      <span
                        className="h-[7px] w-[7px] shrink-0 rounded-full"
                        style={{ backgroundColor: project.color }}
                        title={project.name}
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[14px] text-ink">
                      {c.task.text === "" ? "Untitled" : c.task.text}
                    </span>
                    <BlockPips minutes={c.task.estimatedMinutes} />
                    <DeferralBadges task={c.task} />
                  </div>
                  {focused && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <ActionChip
                        label="Take it on"
                        hint="t"
                        tone="today"
                        onClick={() => onAccept(c)}
                      />
                      <ActionChip
                        label="Not today…"
                        hint="s"
                        tone="soft"
                        onClick={() => onPush(c)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
