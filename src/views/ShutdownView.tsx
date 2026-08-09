import type { ISODate, Project, Task, TaskId } from "../types";
import type { DayTally } from "../selectors";
import { ActionChip } from "../components/ActionChip";
import { BreakdownPanel } from "../components/BreakdownPanel";
import { DeferralBadges } from "../components/DeferralBadges";
import { NO_SPELLCHECK } from "../ui/noSpellcheck";

/**
 * The evening shutdown: close today deliberately, instead of discovering
 * tomorrow morning that you didn't.
 *
 * The Reckoning has always been the app's spine, but it sits at the worst hour
 * of the day — you meet it cold, before you've started, wanting to *begin*. It's
 * also a day late: at 9am you're guessing why yesterday's task didn't happen,
 * where at 6pm you still remember.
 *
 * So this is the same accounting, moved to the moment you actually stop working,
 * and pointed at tomorrow rather than today. Nothing about the gate changes — it
 * simply has nothing left to catch when you've been here first. The Reckoning
 * becomes the safety net for days you skipped shutdown, which is a better deal
 * than a toll booth: it still exists, you just earn your way past it the night
 * before.
 */
export function ShutdownView({
  open,
  cursorId,
  tally,
  tomorrowCount,
  projects,
  breakdownTask,
  tomorrow,
  reason,
  onReasonChange,
  onSelect,
  onComplete,
  onCarry,
  onPostpone,
  onWontDo,
  onDrop,
  onStartBreakdown,
  onCarryAll,
  onAddStep,
  onFinishBreakdown,
  onExit,
}: {
  /** Today's still-unresolved commitments, in tree order. */
  open: Task[];
  cursorId: TaskId | null;
  tally: DayTally;
  /** How much is already committed to tomorrow — the load you're adding to. */
  tomorrowCount: number;
  projects: Project[];
  breakdownTask: Task | null;
  tomorrow: ISODate;
  reason: string;
  onReasonChange: (v: string) => void;
  onSelect: (id: TaskId) => void;
  onComplete: (id: TaskId) => void;
  onCarry: (id: TaskId) => void;
  onPostpone: (id: TaskId) => void;
  onWontDo: (id: TaskId) => void;
  onDrop: (id: TaskId) => void;
  onStartBreakdown: (id: TaskId) => void;
  onCarryAll: () => void;
  onAddStep: (parentId: TaskId, text: string) => void;
  onFinishBreakdown: () => void;
  onExit: () => void;
}) {
  if (breakdownTask != null) {
    return (
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-10 py-10">
        <BreakdownPanel
          task={breakdownTask}
          stepDate={tomorrow}
          when="tomorrow"
          onAddStep={(text) => onAddStep(breakdownTask.id, text)}
          onFinish={onFinishBreakdown}
        />
      </div>
    );
  }

  const resolved = tally.done + tally.skipped;

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-10 py-10">
      <header className="mb-6 flex items-start justify-between gap-4 border-b border-line pb-5">
        <div>
          <div className="eyebrow mb-1.5 text-accent">Shutdown</div>
          <h1 className="font-serif text-[32px] font-medium leading-none tracking-tight text-ink">
            {open.length === 0 ? "The day is closed." : "Close the day"}
          </h1>
          <p className="mt-2 max-w-xl text-[14px] text-ink-soft">
            {open.length === 0 ? (
              <>
                {tally.done} finished
                {tally.skipped > 0 && `, ${tally.skipped} deliberately not`}. Nothing
                left unresolved — and nothing waiting to ambush you in the morning.
                {tomorrowCount > 0 && ` ${tomorrowCount} already lined up for tomorrow.`}
              </>
            ) : (
              <>
                {resolved} of {tally.committed} resolved. Give the rest an ending
                now, while you still remember why: finish it, carry it to tomorrow,
                break it into something you'd actually do, postpone it to a day you
                name, or decide you won't.
              </>
            )}
          </p>
        </div>
        <button
          tabIndex={-1}
          onClick={onExit}
          className="kbd shrink-0"
          aria-label="Leave shutdown"
        >
          esc
        </button>
      </header>

      {open.length === 0 ? (
        <div className="rounded-lg border border-good/30 bg-good-soft px-6 py-10 text-center">
          <p className="font-serif text-[22px] text-ink">Nothing left to decide.</p>
          <p className="mt-2 text-[13px] text-ink-soft">
            Press <span className="kbd">esc</span> and stop working.
          </p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-auto">
          <div className="flex flex-col gap-1">
            {open.map((task) => {
              const focused = task.id === cursorId;
              const project = projects.find((p) => p.id === task.projectId) ?? null;
              return (
                <div
                  key={task.id}
                  onClick={() => onSelect(task.id)}
                  className={[
                    "relative rounded px-3 py-2.5",
                    focused ? "bg-surface-2" : "cursor-pointer hover:bg-surface-2/60",
                  ].join(" ")}
                >
                  {focused && (
                    <span className="absolute left-0 top-2 bottom-2 w-[2px] bg-accent" />
                  )}
                  <div className="flex items-center gap-3">
                    {project != null && (
                      <span
                        className="h-[7px] w-[7px] shrink-0 rounded-full"
                        style={{ backgroundColor: project.color }}
                        title={project.name}
                      />
                    )}
                    <span className="flex-1 text-[14px] text-ink">
                      {task.text === "" ? "Untitled" : task.text}
                    </span>
                    <DeferralBadges task={task} />
                  </div>
                  {focused && task.notes.trim() !== "" && (
                    <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-soft">
                      {task.notes}
                    </p>
                  )}
                  {focused && (
                    <div className="mt-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <ActionChip label="Done" hint="e" tone="good" onClick={() => onComplete(task.id)} />
                        <ActionChip label="Tomorrow" hint="t" tone="today" onClick={() => onCarry(task.id)} />
                        <ActionChip label="Break down" hint="b" tone="accent" onClick={() => onStartBreakdown(task.id)} />
                        <ActionChip label="Postpone…" hint="s" tone="soft" onClick={() => onPostpone(task.id)} />
                        <ActionChip label="Won’t do" hint="w" tone="soft" onClick={() => onWontDo(task.id)} />
                        <ActionChip label="Drop" hint="d" tone="bad" onClick={() => onDrop(task.id)} />
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
                  )}
                </div>
              );
            })}
          </div>

          {open.length > 1 && (
            <div className="mt-4 flex items-center gap-1.5 border-t border-line pt-3 text-[11px] text-ink-faint">
              <span className="mr-1">
                All {open.length}, unchanged
                {tomorrowCount > 0 && ` (tomorrow already holds ${tomorrowCount})`}:
              </span>
              <ActionChip label="Carry to tomorrow" hint="⇧T" tone="today" onClick={onCarryAll} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
