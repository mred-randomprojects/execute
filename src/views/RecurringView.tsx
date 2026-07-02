import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { RecurrenceId, RecurrenceRule, Task, TaskId } from "../types";
import type { RecurrenceGroup } from "../selectors";
import { endsLabel } from "../store/recurrence";
import { countAll } from "../store/tasks";
import { useEditor } from "../ui/editor";
import { renderInline } from "../ui/markdown";
import { RowInput } from "../components/TaskRow";
import { CaptureBar } from "../components/CaptureBar";

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      aria-hidden="true"
      className={`transition-transform ${open ? "rotate-90" : ""}`}
    >
      <path
        d="M6 4l4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RepeatIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        d="M4 6.5V6a3 3 0 0 1 3-3h4l-1.5-1.5M12 9.5V10a3 3 0 0 1-3 3H5l1.5 1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RecurrenceRow({
  task,
  depth,
  rule,
  onEditRule,
}: {
  task: Task;
  depth: number;
  rule?: RecurrenceRule;
  onEditRule?: () => void;
}) {
  const ed = useEditor();
  const isRoot = rule != null;
  const isFocused = ed.cursorId === task.id;
  const inSelection = ed.selectedIds.includes(task.id);
  const editing = ed.editingId === task.id;
  const hasChildren = task.children.length > 0;
  const isCollapsed = ed.collapsed.has(task.id);
  const progress = hasChildren ? countAll(task) : null;
  const ends = rule != null ? endsLabel(rule) : null;

  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isFocused) rowRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [isFocused]);

  return (
    <>
      <div
        ref={rowRef}
        onClick={() => ed.select(task.id)}
        className={[
          "group relative flex items-center gap-2 rounded-sm py-[5px] pr-2 cursor-default select-none",
          inSelection && !editing ? "bg-surface-2" : "hover:bg-surface-2/60",
        ].join(" ")}
        style={{ paddingLeft: `${depth * 22 + 6}px` }}
      >
        {isFocused && (
          <span className="absolute left-0 top-[6px] bottom-[6px] w-[2px] bg-accent" />
        )}

        <button
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            e.currentTarget.blur();
            if (hasChildren) ed.toggleCollapse(task.id);
          }}
          className={`flex h-4 w-4 items-center justify-center text-ink-faint ${
            hasChildren ? "visible" : "invisible"
          }`}
          aria-label={isCollapsed ? "Expand" : "Collapse"}
        >
          <Caret open={!isCollapsed} />
        </button>

        {isRoot ? (
          <span className="grid h-[17px] w-[17px] shrink-0 place-items-center text-ink-faint" aria-hidden>
            <RepeatIcon />
          </span>
        ) : (
          <span className="ml-[3px] mr-[6px] h-[5px] w-[5px] shrink-0 rounded-full bg-ink-faint" aria-hidden />
        )}

        {editing ? (
          <RowInput task={task} />
        ) : (
          <span
            onClick={() => isFocused && ed.startEdit(task.id)}
            className={[
              "flex-1 truncate text-[14px]",
              isRoot ? "text-ink" : "text-ink-soft",
              task.text === "" ? "text-ink-faint" : "",
            ].join(" ")}
          >
            {task.text === "" ? (isRoot ? "Untitled recurring task" : "Untitled step") : renderInline(task.text)}
          </span>
        )}

        {progress != null && progress.total > 0 && (
          <span className="mono shrink-0 text-[11px] text-ink-faint">
            {progress.total} {progress.total === 1 ? "step" : "steps"}
          </span>
        )}

        {ends != null && (
          <span className="mono shrink-0 rounded-sm bg-surface-2 px-1.5 py-[1px] text-[10px] text-ink-faint">
            {ends}
          </span>
        )}

        {isRoot && onEditRule != null && (
          <button
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              e.currentTarget.blur();
              onEditRule();
            }}
            className="grid h-5 w-5 shrink-0 place-items-center rounded-sm text-ink-faint opacity-0 transition hover:text-ink focus:opacity-100 group-hover:opacity-100"
            aria-label="Change repeat rule"
            title="Change repeat (r)"
          >
            <RepeatIcon />
          </button>
        )}
      </div>

      {hasChildren &&
        !isCollapsed &&
        task.children.map((child) => (
          <RecurrenceRow key={child.id} task={child} depth={depth + 1} />
        ))}
    </>
  );
}

export function RecurringView({
  groups,
  captureRef,
  onAdd,
  onCaptureArrowDown,
  onCaptureFocus,
  onEditRule,
}: {
  groups: RecurrenceGroup[];
  captureRef: RefObject<HTMLInputElement>;
  onAdd: (raw: string) => void;
  onCaptureArrowDown: () => void;
  onCaptureFocus: () => void;
  onEditRule: (recId: RecurrenceId, taskId: TaskId) => void;
}) {
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-10 py-8">
      <header className="mb-5 border-b border-line pb-4">
        <h1 className="font-serif text-[32px] font-medium leading-none tracking-tight text-ink">
          Recurring
        </h1>
        <p className="mt-2 text-[14px] text-ink-soft">
          Tasks that come back on a schedule. They surface in Today when due — you decide whether to
          take them on. Press <span className="kbd">r</span> to set the repeat.
        </p>
      </header>

      <div className="mb-4">
        <CaptureBar
          inputRef={captureRef}
          placeholder="New recurring task… (e.g. Morning ritual)"
          onAdd={onAdd}
          onArrowDown={onCaptureArrowDown}
          onFocus={onCaptureFocus}
        />
      </div>

      <div className="-mx-2 flex-1 overflow-auto">
        {groups.length === 0 ? (
          <div className="px-2 py-10 text-center text-[14px] text-ink-faint">
            No recurring tasks yet. Capture one above, add steps with <span className="kbd">o</span>,
            then set its repeat with <span className="kbd">r</span>.
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.label} className="mt-6 px-2 first:mt-1">
              <div className="mb-1.5 flex items-center gap-2.5 px-1">
                <span className="mono text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">
                  {group.label}
                </span>
                <span className="h-px flex-1 bg-line" />
                <span className="mono shrink-0 text-[11px] text-ink-faint">
                  {group.recurrences.length}
                </span>
              </div>
              {group.recurrences.map((rec) => (
                <RecurrenceRow
                  key={rec.template.id}
                  task={rec.template}
                  depth={0}
                  rule={rec.rule}
                  onEditRule={() => onEditRule(rec.id, rec.template.id)}
                />
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
