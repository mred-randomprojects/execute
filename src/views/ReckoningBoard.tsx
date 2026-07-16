import type { RefObject } from "react";
import type { ISODate, Project, Task, TaskId } from "../types";
import { BLOCK_MINUTES } from "../types";
import type { CapacityLoad } from "../selectors";
import { relativeLabel } from "../store/dates";
import { blocksFromMinutes, formatMinutes, MAX_ESTIMATE_BLOCKS } from "../store/estimate";
import { BlockPips } from "../components/BlockPips";
import { CaptureBar } from "../components/CaptureBar";

/** One leftover to triage, with the nearest ancestor's text for context. */
export interface BoardLeftover {
  task: Task;
  parentText: string | null;
}

function ProjectDot({ project }: { project: Project | null }) {
  if (project == null) return null;
  return (
    <span
      className="h-[7px] w-[7px] shrink-0 rounded-full"
      style={{ backgroundColor: project.color }}
      title={project.name}
    />
  );
}

/** Eight clickable pips — click the Nth to set N blocks, click the current to clear. */
function EstimateSetter({
  minutes,
  onSet,
}: {
  minutes: number | null;
  onSet: (blocks: number) => void;
}) {
  const current = blocksFromMinutes(minutes);
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-ink-faint">Effort</span>
      <div className="flex items-center gap-[3px]">
        {Array.from({ length: MAX_ESTIMATE_BLOCKS }).map((_, i) => {
          const n = i + 1;
          const filled = n <= current;
          return (
            <button
              key={n}
              tabIndex={-1}
              aria-label={`${n} block${n === 1 ? "" : "s"}`}
              onClick={(e) => {
                e.stopPropagation();
                onSet(n === current ? 0 : n);
              }}
              className={[
                "h-[12px] w-[12px] rounded-[2px] border transition-colors",
                filled
                  ? "border-accent bg-accent"
                  : "border-line-strong hover:border-ink-soft",
              ].join(" ")}
            />
          );
        })}
      </div>
      <span className="mono text-[11px] text-ink-faint">
        {current === 0 ? "—" : formatMinutes(current * BLOCK_MINUTES)}
      </span>
    </div>
  );
}

/** The soft daily-capacity gauge: a segmented bar + running totals + ± controls. */
function CapacityMeter({
  capacity,
  onDelta,
}: {
  capacity: CapacityLoad;
  onDelta: (delta: number) => void;
}) {
  const { usedBlocks, capacityBlocks, usedMinutes, unestimated, overBlocks } = capacity;
  const withinCells = Math.min(usedBlocks, capacityBlocks);
  const emptyCells = Math.max(0, capacityBlocks - usedBlocks);
  const over = overBlocks > 0;

  return (
    <div className="rounded-lg border border-line bg-surface/50 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="eyebrow">Today's load</span>
        <span className="flex items-center gap-1.5">
          <span className={`mono text-[13px] font-medium ${over ? "text-bad" : "text-ink"}`}>
            {usedBlocks} / {capacityBlocks}
          </span>
          <span className="mono text-[11px] text-ink-faint">blocks</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-[3px]">
        {Array.from({ length: withinCells }).map((_, i) => (
          <span key={`u${i}`} className="h-[9px] flex-1 min-w-[8px] rounded-[2px] bg-accent" />
        ))}
        {Array.from({ length: emptyCells }).map((_, i) => (
          <span key={`e${i}`} className="h-[9px] flex-1 min-w-[8px] rounded-[2px] bg-surface-2" />
        ))}
        {Array.from({ length: overBlocks }).map((_, i) => (
          <span key={`o${i}`} className="h-[9px] flex-1 min-w-[8px] rounded-[2px] bg-bad" />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-ink-faint">
        <span>
          ≈ {formatMinutes(usedMinutes)} of {formatMinutes(capacityBlocks * BLOCK_MINUTES)}
          {over && <span className="text-bad"> · over by {overBlocks}</span>}
          {unestimated > 0 && <span> · {unestimated} unestimated</span>}
        </span>
        <span className="flex items-center gap-1">
          <button
            tabIndex={-1}
            aria-label="Lower capacity"
            onClick={() => onDelta(-1)}
            className="kbd px-1.5"
          >
            −
          </button>
          <button
            tabIndex={-1}
            aria-label="Raise capacity"
            onClick={() => onDelta(1)}
            className="kbd px-1.5"
          >
            +
          </button>
        </span>
      </div>
    </div>
  );
}

function ActionChip({
  label,
  hint,
  tone,
  onClick,
}: {
  label: string;
  hint: string;
  tone: "good" | "accent" | "soft" | "bad";
  onClick: () => void;
}) {
  const tones: Record<string, string> = {
    good: "border-good/40 text-good hover:bg-good-soft",
    accent: "border-accent/40 text-accent hover:bg-accent-soft",
    soft: "border-line-strong text-ink-soft hover:bg-surface-2",
    bad: "border-bad/40 text-bad hover:bg-bad-soft",
  };
  return (
    <button
      tabIndex={-1}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        e.currentTarget.blur();
        onClick();
      }}
      className={`flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[12px] font-medium transition-colors ${tones[tone]}`}
    >
      {label}
      <span className="kbd">{hint}</span>
    </button>
  );
}

function CarriedBadge({ count }: { count: number }) {
  if (count < 1) return null;
  const tone = count >= 3 ? "border-bad/40 text-bad" : "border-line-strong text-ink-faint";
  return (
    <span
      title={`Kept for today ${count} time${count === 1 ? "" : "s"} without finishing`}
      className={`mono shrink-0 rounded-sm border px-1.5 py-[1px] text-[10px] ${tone}`}
    >
      carried {count}×
    </span>
  );
}

export function ReckoningBoard({
  leftovers,
  todayOpen,
  capacity,
  cursorId,
  today,
  projects,
  onSelect,
  onPull,
  onPush,
  onComplete,
  onDrop,
  onSetEstimate,
  onCapacityDelta,
  onSwitchToCards,
  captureRef,
  onCapture,
  onCaptureArrowDown,
}: {
  leftovers: BoardLeftover[];
  todayOpen: Task[];
  capacity: CapacityLoad;
  cursorId: TaskId | null;
  today: ISODate;
  projects: Project[];
  onSelect: (id: TaskId) => void;
  onPull: (id: TaskId) => void;
  onPush: (id: TaskId) => void;
  onComplete: (id: TaskId) => void;
  onDrop: (id: TaskId) => void;
  onSetEstimate: (id: TaskId, blocks: number) => void;
  onCapacityDelta: (delta: number) => void;
  onSwitchToCards: () => void;
  captureRef: RefObject<HTMLInputElement>;
  onCapture: (raw: string) => void;
  onCaptureArrowDown: () => void;
}) {
  const projectOf = (t: Task): Project | null =>
    projects.find((p) => p.id === t.projectId) ?? null;
  const totalLeft = leftovers.length;

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-8 py-8">
      <div className="mb-5">
        <CaptureBar
          inputRef={captureRef}
          placeholder="Add a task for today…"
          onAdd={onCapture}
          onArrowDown={onCaptureArrowDown}
        />
      </div>

      <header className="mb-5 flex items-end justify-between border-b border-line pb-4">
        <div>
          <div className="eyebrow mb-1.5 text-bad">The Reckoning · board</div>
          <h1 className="font-serif text-[28px] font-medium leading-none tracking-tight text-ink">
            Pull what you can into today
          </h1>
          <p className="mt-2 max-w-xl text-[13px] text-ink-soft">
            Left is everything overdue. Pull the ones you'll really do into today
            (→), push the rest to later (s), and watch the capacity meter so today
            stays realistic. Today starts once the left is clear.
          </p>
        </div>
        <button
          tabIndex={-1}
          onClick={onSwitchToCards}
          className="kbd shrink-0"
          aria-label="Switch to the card review"
        >
          v · cards
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-5 overflow-hidden">
        {/* ── Left: leftovers to triage ── */}
        <section className="flex min-h-0 flex-col">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="eyebrow">Before today</span>
            <span className="mono text-[11px] text-ink-faint">{totalLeft}</span>
          </div>
          <div className="flex-1 overflow-auto pr-1">
            {totalLeft === 0 ? (
              <div className="rounded-lg border border-dashed border-line px-4 py-10 text-center text-[13px] text-ink-faint">
                All caught up — nothing overdue.
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {leftovers.map(({ task, parentText }) => {
                  const focused = task.id === cursorId;
                  return (
                    <div
                      key={task.id}
                      onClick={() => onSelect(task.id)}
                      className={[
                        "relative rounded-md px-3 py-2",
                        focused
                          ? "bg-surface-2 ring-1 ring-inset ring-accent/30"
                          : "cursor-pointer hover:bg-surface-2/60",
                      ].join(" ")}
                    >
                      {focused && (
                        <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-accent" />
                      )}
                      <div className="flex items-center gap-2">
                        <span className="mono shrink-0 text-[11px] text-bad">
                          {relativeLabel(task.plannedFor ?? today, today)}
                        </span>
                        <ProjectDot project={projectOf(task)} />
                        <span className="min-w-0 flex-1 truncate text-[14px] text-ink">
                          {parentText != null && parentText.trim() !== "" && (
                            <span className="text-ink-faint">
                              {parentText} ▸{" "}
                            </span>
                          )}
                          {task.text === "" ? "Untitled" : task.text}
                        </span>
                        {!focused && <BlockPips minutes={task.estimatedMinutes} />}
                        <CarriedBadge count={task.carriedCount} />
                      </div>

                      {focused && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <ActionChip label="Today" hint="→" tone="accent" onClick={() => onPull(task.id)} />
                          <ActionChip label="Later" hint="s" tone="soft" onClick={() => onPush(task.id)} />
                          <ActionChip label="Done" hint="e" tone="good" onClick={() => onComplete(task.id)} />
                          <ActionChip label="Drop" hint="d" tone="bad" onClick={() => onDrop(task.id)} />
                          <span className="mx-1 h-4 w-px bg-line" />
                          <EstimateSetter
                            minutes={task.estimatedMinutes}
                            onSet={(blocks) => onSetEstimate(task.id, blocks)}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* ── Right: today + capacity ── */}
        <section className="flex min-h-0 flex-col">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="eyebrow">Today</span>
            <span className="mono text-[11px] text-ink-faint">{todayOpen.length}</span>
          </div>
          <CapacityMeter capacity={capacity} onDelta={onCapacityDelta} />
          <div className="mt-3 flex-1 overflow-auto pr-1">
            {todayOpen.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line px-4 py-10 text-center text-[13px] text-ink-faint">
                Nothing committed yet. Pull leftovers in with →.
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {todayOpen.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-surface-2/50"
                  >
                    <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-accent" />
                    <ProjectDot project={projectOf(task)} />
                    <span className="min-w-0 flex-1 truncate text-[14px] text-ink">
                      {task.text === "" ? "Untitled" : task.text}
                    </span>
                    <BlockPips minutes={task.estimatedMinutes} />
                    <CarriedBadge count={task.carriedCount} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <footer className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 text-[11px] text-ink-faint">
        {[
          ["→ / ↵", "pull to today"],
          ["s", "push to later"],
          ["e", "done"],
          ["d", "drop"],
          ["1 – 8", "estimate"],
          ["0", "clear"],
          ["v", "cards"],
        ].map(([keys, label]) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className="kbd">{keys}</span>
            {label}
          </span>
        ))}
      </footer>
    </div>
  );
}
