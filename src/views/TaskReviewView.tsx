import { useEffect, useRef, useState } from "react";
import type { ISODate, Project, Task, TaskId } from "../types";
import { ActionChip } from "../components/ActionChip";
import { DeferralBadges } from "../components/DeferralBadges";
import { NO_SPELLCHECK } from "../ui/noSpellcheck";
import { relativeLabel } from "../store/dates";

/**
 * Where a row came from — and so what its verbs mean. Overdue and today rows
 * are commitments that came due: moving them is a deferral, counted on the
 * task. Week rows were never promised to a day, so taking one on is a fresh
 * commitment and pushing it is plain rescheduling.
 */
export type ReviewSection = "overdue" | "today" | "week";

export interface ReviewRow {
  id: TaskId;
  task: Task;
  section: ReviewSection;
}

/** Where a task sits: its project and the titles of its ancestors, root first. */
export interface TaskContext {
  project: Project | null;
  path: string[];
}

const SECTION_LABEL: Record<ReviewSection, string> = {
  overdue: "Overdue",
  today: "Today",
  week: "This week, no day yet",
};

/**
 * The task review: every task waiting on a decision, in one list, whenever you
 * ask for it — what's overdue, what's still open today, and what this week
 * holds without a day. It replaced three rituals (the morning gate, Shutdown
 * and Plan) that asked the same question at fixed moments; nothing here opens
 * on its own or blocks anything.
 *
 * One cursor, one set of verbs on every row. `l` sets a row aside for this
 * pass without deciding anything. Every task carries its context
 * (project › parent), because a subtask's title alone rarely says what it's
 * part of.
 */
export function TaskReviewView({
  rows,
  cursorId,
  later,
  today,
  contextOf,
  catchUp,
  reason,
  reasonTick,
  onReasonChange,
  onSelect,
  onComplete,
  onToday,
  onTomorrow,
  onPostpone,
  onWontDo,
  onDrop,
  onStartBreakdown,
  onLater,
  onExit,
}: {
  rows: ReviewRow[];
  cursorId: TaskId | null;
  /** Rows set aside in this pass. */
  later: ReadonlySet<string>;
  today: ISODate;
  contextOf: (id: TaskId) => TaskContext;
  /** Offered when the overdue pile is big: move it all to the Inbox at once. */
  catchUp: { count: number; onCatchUp: () => void } | null;
  reason: string;
  /** Bumped (by `/`) to open and focus the focused task's reason field. */
  reasonTick: number;
  onReasonChange: (v: string) => void;
  onSelect: (id: TaskId) => void;
  onComplete: (id: TaskId) => void;
  onToday: (id: TaskId) => void;
  onTomorrow: (id: TaskId) => void;
  onPostpone: (id: TaskId) => void;
  onWontDo: (id: TaskId) => void;
  onDrop: (id: TaskId) => void;
  onStartBreakdown: (id: TaskId) => void;
  onLater: (id: TaskId) => void;
  onExit: () => void;
}) {
  const left = rows.filter((r) => !later.has(r.id)).length;
  const laterCount = rows.length - left;
  const sections = (["overdue", "today", "week"] as const)
    .map((section) => ({ section, rows: rows.filter((r) => r.section === section) }))
    .filter((s) => s.rows.length > 0);

  return (
    <div className="mx-auto flex h-full w-full page-width flex-col px-10 py-10">
      <header className="mb-5 border-b border-line pb-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="eyebrow mb-1.5 text-accent">Task review</div>
            <h1 className="font-serif text-[32px] font-medium leading-none tracking-tight text-ink">
              {left > 0 ? "What stays, what goes?" : laterCount > 0 ? "Done for now" : "Nothing left to decide."}
            </h1>
          </div>
          <button tabIndex={-1} onClick={onExit} className="kbd shrink-0" aria-label="Leave the review">
            esc
          </button>
        </div>
        <p className="mt-2 max-w-xl text-[13px] text-ink-soft">
          {left > 0 ? (
            <>
              {left} {left === 1 ? "task" : "tasks"} to decide — or <span className="kbd">l</span> to leave one for
              later.
            </>
          ) : laterCount > 0 ? (
            <>{laterCount} left for later. Review again whenever you like, from <span className="kbd">⌘k</span>.</>
          ) : (
            <>Everything has a place. Press <span className="kbd">esc</span> to get back to it.</>
          )}
        </p>
      </header>

      <div className="flex flex-1 flex-col overflow-auto">
        {sections.map(({ section, rows: sectionRows }) => {
          const open = sectionRows.filter((r) => !later.has(r.id)).length;
          return (
            <section key={section} className="mb-6" aria-label={SECTION_LABEL[section]}>
              <div className="eyebrow mb-1.5 flex items-baseline gap-2 px-3">
                <span>{SECTION_LABEL[section]}</span>
                <span className="text-ink-faint">· {open > 0 ? `${open} to go` : "all set aside"}</span>
                {section === "overdue" && catchUp != null && (
                  <span className="ml-auto normal-case tracking-normal">
                    <ActionChip
                      label={`Move all ${catchUp.count} to the Inbox`}
                      tone="soft"
                      onClick={catchUp.onCatchUp}
                    />
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                {sectionRows.map((r) => (
                  <ReviewTaskRow
                    key={r.id}
                    row={r}
                    today={today}
                    context={contextOf(r.id)}
                    focused={r.id === cursorId}
                    isLater={later.has(r.id)}
                    reason={reason}
                    reasonTick={reasonTick}
                    onReasonChange={onReasonChange}
                    onSelect={() => onSelect(r.id)}
                    onComplete={() => onComplete(r.id)}
                    onToday={() => onToday(r.id)}
                    onTomorrow={() => onTomorrow(r.id)}
                    onLater={() => onLater(r.id)}
                    onStartBreakdown={() => onStartBreakdown(r.id)}
                    onPostpone={() => onPostpone(r.id)}
                    onWontDo={() => onWontDo(r.id)}
                    onDrop={() => onDrop(r.id)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** Rows scroll into view when the cursor lands on them (keyboard-first rule). */
function useScrollIntoView(focused: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [focused]);
  return ref;
}

function ReviewTaskRow({
  row,
  today,
  context,
  focused,
  isLater,
  reason,
  reasonTick,
  onReasonChange,
  onSelect,
  onComplete,
  onToday,
  onTomorrow,
  onLater,
  onStartBreakdown,
  onPostpone,
  onWontDo,
  onDrop,
}: {
  row: ReviewRow;
  today: ISODate;
  context: TaskContext;
  focused: boolean;
  isLater: boolean;
  reason: string;
  reasonTick: number;
  onReasonChange: (v: string) => void;
  onSelect: () => void;
  onComplete: () => void;
  onToday: () => void;
  onTomorrow: () => void;
  onLater: () => void;
  onStartBreakdown: () => void;
  onPostpone: () => void;
  onWontDo: () => void;
  onDrop: () => void;
}) {
  const { task, section } = row;
  const ref = useScrollIntoView(focused);
  const inputRef = useRef<HTMLInputElement>(null);
  const [reasonOpen, setReasonOpen] = useState(false);
  useEffect(() => {
    if (!focused) setReasonOpen(false);
  }, [focused]);
  // `/` asks for the field: open it and put the cursor in it — on the focused
  // row only. Every row tracks the tick, so an unfocused one doesn't open.
  const seenTick = useRef(reasonTick);
  useEffect(() => {
    if (reasonTick === seenTick.current) return;
    seenTick.current = reasonTick;
    if (!focused) return;
    setReasonOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [reasonTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const showReason = focused && (reasonOpen || reason !== "");

  return (
    <div
      ref={ref}
      onClick={onSelect}
      className={[
        "relative rounded px-3 py-2.5",
        focused ? "bg-surface-2" : "cursor-pointer hover:bg-surface-2/60",
        isLater && !focused ? "opacity-60" : "",
      ].join(" ")}
    >
      {focused && <span className="absolute left-0 top-2 bottom-2 w-[2px] bg-accent" />}

      {/* Context first: a subtask's title rarely says what it belongs to. */}
      <div className="mb-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-ink-faint">
        {context.project != null && (
          <>
            <span
              className="h-[7px] w-[7px] shrink-0 rounded-full"
              style={{ backgroundColor: context.project.color }}
            />
            <span className="shrink-0">{context.project.name}</span>
          </>
        )}
        {context.path.map((p, i) => (
          <span key={i} className="flex min-w-0 items-center gap-1.5">
            <span aria-hidden="true">›</span>
            <span className="truncate" title={p}>
              {p}
            </span>
          </span>
        ))}
      </div>

      <div className="flex items-start gap-3">
        <span className={`flex-1 text-[14px] ${focused ? "text-ink" : "text-ink-soft"}`}>
          {task.text === "" ? "Untitled" : task.text}
        </span>
        {isLater && <span className="mono shrink-0 text-[11px] text-accent">later</span>}
        {section === "overdue" && task.plannedFor != null && (
          <span className="mono shrink-0 rounded-sm bg-bad-soft px-1.5 py-[1px] text-[10px] font-medium text-bad">
            {relativeLabel(task.plannedFor, today)}
          </span>
        )}
        <DeferralBadges task={task} />
      </div>

      {focused && task.notes.trim() !== "" && (
        <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-soft">{task.notes}</p>
      )}

      {focused && (
        <div className="mt-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <ActionChip label="Done" hint="e" tone="good" onClick={onComplete} />
            {section !== "today" && (
              <ActionChip label={section === "overdue" ? "Keep for today" : "Today"} hint="t" tone="today" onClick={onToday} />
            )}
            <ActionChip label="Tomorrow" hint="→" tone="soft" onClick={onTomorrow} />
            <ActionChip label="Break down" hint="b" tone="accent" onClick={onStartBreakdown} />
            <ActionChip label="Postpone…" hint="s" tone="soft" onClick={onPostpone} />
            <ActionChip label="Won’t do" hint="w" tone="soft" onClick={onWontDo} />
            <ActionChip label="Drop" hint="d" tone="bad" onClick={onDrop} />
            <ActionChip label={isLater ? "Ask me now" : "Later"} hint="l" tone="soft" onClick={onLater} />
          </div>
          {showReason ? (
            <input
              ref={inputRef}
              {...NO_SPELLCHECK}
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Escape" || e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.blur();
                }
              }}
              placeholder="Why? (optional — attached to whatever you choose next)"
              className="mt-2 w-full rounded-sm border border-line bg-surface px-2.5 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong"
            />
          ) : (
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                setReasonOpen(true);
                requestAnimationFrame(() => inputRef.current?.focus());
              }}
              className="mt-2 text-[11px] text-ink-faint hover:text-ink-soft"
            >
              + why? (optional) <span className="kbd ml-1">/</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
