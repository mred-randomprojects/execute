import type { RefObject } from "react";
import type { ISODate, Project, Task, TaskId } from "../types";
import type { ReckoningCard, ReckoningLeaf } from "../selectors";
import { countAll } from "../store/tasks";
import { relativeLabel } from "../store/dates";
import { ActionChip } from "../components/ActionChip";
import { BreakdownPanel } from "../components/BreakdownPanel";
import { CaptureBar } from "../components/CaptureBar";
import { DeferralBadges } from "../components/DeferralBadges";
import { NO_SPELLCHECK } from "../ui/noSpellcheck";

/** The disposition row + optional "why" note, shown under the focused leaf. */
function LeafActions({
  reason,
  onReasonChange,
  onComplete,
  onKeep,
  onPostpone,
  onDrop,
  onStartBreakdown,
}: {
  reason: string;
  onReasonChange: (v: string) => void;
  onComplete: () => void;
  onKeep: () => void;
  onPostpone: () => void;
  onDrop: () => void;
  onStartBreakdown: () => void;
}) {
  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <ActionChip label="Done" hint="e" tone="good" onClick={onComplete} />
        <ActionChip label="Keep for today" hint="t" tone="today" onClick={onKeep} />
        <ActionChip label="Break down" hint="b" tone="accent" onClick={onStartBreakdown} />
        <ActionChip label="Postpone…" hint="s" tone="soft" onClick={onPostpone} />
        <ActionChip label="Drop" hint="d" tone="bad" onClick={onDrop} />
      </div>
      <input
        {...NO_SPELLCHECK}
        value={reason}
        onChange={(e) => onReasonChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.blur();
          }
        }}
        placeholder="Why didn't this get done? (optional — attached to your choice)"
        className="mt-2 w-full rounded-sm border border-line bg-surface px-2.5 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
      />
    </div>
  );
}

export function ReckoningView({
  cards,
  cursorId,
  today,
  projects,
  breakdownTask,
  reason,
  onReasonChange,
  onSelect,
  onComplete,
  onKeep,
  onPostpone,
  onDrop,
  onStartBreakdown,
  onPostponeAll,
  onDropAll,
  onPrevCard,
  onNextCard,
  onAddStep,
  onFinishBreakdown,
  onSwitchToBoard,
  captureRef,
  onCapture,
  onCaptureArrowDown,
}: {
  cards: ReckoningCard[];
  cursorId: TaskId | null;
  today: ISODate;
  projects: Project[];
  breakdownTask: Task | null;
  reason: string;
  onReasonChange: (v: string) => void;
  onSelect: (id: TaskId) => void;
  onComplete: (id: TaskId) => void;
  onKeep: (id: TaskId) => void;
  onPostpone: (id: TaskId) => void;
  onDrop: (id: TaskId) => void;
  onStartBreakdown: (id: TaskId) => void;
  onPostponeAll: (card: ReckoningCard) => void;
  onDropAll: (card: ReckoningCard) => void;
  onPrevCard: () => void;
  onNextCard: () => void;
  onAddStep: (parentId: TaskId, text: string) => void;
  onFinishBreakdown: () => void;
  onSwitchToBoard: () => void;
  captureRef: RefObject<HTMLInputElement>;
  onCapture: (raw: string) => void;
  onCaptureArrowDown: () => void;
}) {
  if (breakdownTask != null) {
    return (
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-10 py-10">
        <BreakdownPanel
          task={breakdownTask}
          stepDate={today}
          when="today"
          onAddStep={(text) => onAddStep(breakdownTask.id, text)}
          onFinish={onFinishBreakdown}
        />
      </div>
    );
  }

  const totalLeftovers = cards.reduce((n, c) => n + c.leaves.length, 0);
  const cardIndex = Math.max(
    0,
    cards.findIndex((c) => c.leaves.some((l) => l.task.id === cursorId))
  );
  const card = cards[cardIndex];
  if (card == null) return <div className="h-full" />; // gate clearing; about to unmount

  const project = projects.find((p) => p.id === card.root.projectId) ?? null;
  const progress = countAll(card.root);
  const isContainer = card.root.children.length > 0;
  // A "solo" card is a top-level leftover that is itself the only leaf — the
  // header already shows its title, so the leaf block omits a repeated title.
  const soloLeaf =
    !isContainer && card.leaves.length === 1 ? card.leaves[0] : null;

  const renderActions = (leafId: TaskId) => (
    <LeafActions
      reason={reason}
      onReasonChange={onReasonChange}
      onComplete={() => onComplete(leafId)}
      onKeep={() => onKeep(leafId)}
      onPostpone={() => onPostpone(leafId)}
      onDrop={() => onDrop(leafId)}
      onStartBreakdown={() => onStartBreakdown(leafId)}
    />
  );

  const renderLeaf = (leaf: ReckoningLeaf, showText: boolean) => {
    const focused = leaf.task.id === cursorId;
    return (
      <div
        key={leaf.task.id}
        onClick={() => onSelect(leaf.task.id)}
        className={[
          "relative rounded px-3 py-2.5",
          focused ? "bg-surface-2" : "cursor-pointer hover:bg-surface-2/60",
        ].join(" ")}
      >
        {focused && (
          <span className="absolute left-0 top-2 bottom-2 w-[2px] bg-accent" />
        )}
        <div className="flex items-center gap-3">
          <span className="mono shrink-0 text-[11px] text-bad">
            {relativeLabel(leaf.task.plannedFor ?? today, today)}
          </span>
          {showText && (
            <span className="flex-1 text-[14px] text-ink">
              {leaf.parents.length > 0 && (
                <span className="text-ink-faint">
                  {leaf.parents
                    .map((p) => (p.text === "" ? "Untitled" : p.text))
                    .join(" ▸ ")}{" "}
                  ▸{" "}
                </span>
              )}
              {leaf.task.text === "" ? "Untitled" : leaf.task.text}
            </span>
          )}
          {!showText && <span className="flex-1" />}
          <DeferralBadges task={leaf.task} />
        </div>
        {focused && leaf.task.notes.trim() !== "" && (
          <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-soft">
            {leaf.task.notes}
          </p>
        )}
        {focused && renderActions(leaf.task.id)}
      </div>
    );
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-10 py-10">
      {/* The front door never closes: capture stays available even mid-gate, so a
          stray thought lands in the system (planned for today) without resolving
          a single leftover or making the pile any longer. */}
      <div className="mb-6">
        <CaptureBar
          inputRef={captureRef}
          placeholder="Add a task for today…"
          onAdd={onCapture}
          onArrowDown={onCaptureArrowDown}
        />
      </div>

      <header className="mb-6 flex items-start justify-between gap-4 border-b border-line pb-5">
        <div>
          <div className="eyebrow mb-1.5 text-bad">The Reckoning</div>
          <h1 className="font-serif text-[32px] font-medium leading-none tracking-tight text-ink">
            Unfinished from before today
          </h1>
          <p className="mt-2 max-w-xl text-[14px] text-ink-soft">
            {totalLeftovers} task{totalLeftovers === 1 ? "" : "s"} you committed to
            didn't get done{cards.length > 1 ? `, across ${cards.length} groups` : ""}.
            Finish each, keep it for today, break it into something smaller, postpone
            it to a day you name, or drop it. Today starts once this is clear.
          </p>
        </div>
        <button
          tabIndex={-1}
          onClick={onSwitchToBoard}
          className="kbd shrink-0"
          aria-label="Switch to the planning board"
        >
          v · board
        </button>
      </header>

      {/* One card at a time: a top-level commitment and its stranded subtasks. */}
      <div className="flex flex-1 flex-col overflow-auto">
        <div className="rounded-lg border border-line bg-surface/40 p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-2">
                {project != null && (
                  <span className="flex items-center gap-1.5 text-[11px] text-ink-soft">
                    <span
                      className="h-[8px] w-[8px] rounded-full"
                      style={{ backgroundColor: project.color }}
                    />
                    {project.name}
                  </span>
                )}
                {isContainer && progress.total > 0 && (
                  <span className="mono text-[11px] text-ink-faint">
                    {progress.done} of {progress.total} done
                  </span>
                )}
              </div>
              <h2 className="font-serif text-[22px] font-medium leading-tight text-ink">
                {card.root.text === "" ? "Untitled" : card.root.text}
              </h2>
            </div>
            {cards.length > 1 && (
              <div className="flex shrink-0 items-center gap-2 text-[11px] text-ink-faint">
                <button
                  tabIndex={-1}
                  aria-label="Previous group"
                  onClick={onPrevCard}
                  className="kbd"
                >
                  ‹
                </button>
                <span className="mono">
                  {cardIndex + 1}/{cards.length}
                </span>
                <button
                  tabIndex={-1}
                  aria-label="Next group"
                  onClick={onNextCard}
                  className="kbd"
                >
                  ›
                </button>
              </div>
            )}
          </div>

          {soloLeaf != null ? (
            renderLeaf(soloLeaf, false)
          ) : (
            <div className="flex flex-col gap-1">
              {card.leaves.map((leaf) => renderLeaf(leaf, true))}
            </div>
          )}

          {isContainer && card.leaves.length > 1 && (
            <div className="mt-3 flex items-center gap-1.5 border-t border-line pt-3 text-[11px] text-ink-faint">
              <span className="mr-1">Whole group:</span>
              <ActionChip
                label="Postpone all…"
                hint="⇧S"
                tone="soft"
                onClick={() => onPostponeAll(card)}
              />
              <ActionChip
                label="Drop all"
                hint="⇧D"
                tone="bad"
                onClick={() => onDropAll(card)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
