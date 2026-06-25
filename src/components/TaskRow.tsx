import { useEffect, useRef, useState } from "react";
import type { Task } from "../types";
import { countAll } from "../store/tasks";
import { relativeLabel } from "../store/dates";
import { horizonLabel } from "../selectors";
import { useEditor } from "../ui/editor";
import { renderInline } from "../ui/markdown";
import { NO_SPELLCHECK } from "../ui/noSpellcheck";

function FocusIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="1.7" fill="currentColor" />
    </svg>
  );
}

const PRIORITY_DOT: Record<number, string> = {
  1: "bg-bad",
  2: "bg-mid",
  3: "bg-accent",
};

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
      <path
        d="M13 4.5 6.5 11 3 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      aria-hidden="true"
      className={`transition-transform ${open ? "rotate-90" : ""}`}
    >
      <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RowInput({ task }: { task: Task }) {
  const ed = useEditor();
  const [value, setValue] = useState(task.text);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el == null) return;
    el.focus();
    el.select();
  }, []);

  return (
    <input
      {...NO_SPELLCHECK}
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => ed.commit(task.id, value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          e.stopPropagation();
          ed.toggleFromEdit(task.id, value);
        } else if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          ed.exitEdit(task.id, value); // Enter just commits + leaves edit mode
        } else if (e.key === "Tab" && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          ed.indentEditing(task.id, value);
        } else if (e.key === "Tab" && e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          ed.outdentEditing(task.id, value);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          e.stopPropagation();
          ed.exitUp(task.id, value);
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          e.stopPropagation();
          ed.exitDown(task.id, value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          ed.exitEdit(task.id, value);
        } else if (e.key === "Backspace" && value === "") {
          e.preventDefault();
          e.stopPropagation();
          ed.removeAndExit(task.id);
        }
      }}
      placeholder="Task…"
      className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-faint"
    />
  );
}

export function TaskRow({ task, depth }: { task: Task; depth: number }) {
  const ed = useEditor();
  const isFocused = ed.cursorId === task.id;
  const inSelection = ed.selectedIds.includes(task.id);
  const editing = ed.editingId === task.id;
  const isMoving = ed.movingId === task.id;
  const isDropTarget = ed.mode === "move" && isFocused && !isMoving;
  const hasChildren = task.children.length > 0;
  const isCollapsed = ed.collapsed.has(task.id);
  const plannedToday = task.plannedFor === ed.today;
  const progress = hasChildren ? countAll(task) : null;
  // In Today, a task that isn't itself planned for today only shows because a
  // descendant is — dim it so the "for today" items stand out.
  const dimNotToday = ed.view === "today" && !plannedToday && !task.completed;

  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isFocused) rowRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [isFocused]);

  return (
    <>
      <div
        ref={rowRef}
        onClick={() => ed.select(task.id)}
        onDoubleClick={() => ed.openDetail(task.id)}
        className={[
          "group relative flex items-center gap-2 rounded-sm py-[5px] pr-2 cursor-default select-none",
          inSelection && !editing ? "bg-surface-2" : "hover:bg-surface-2/60",
          isMoving ? "opacity-50" : "",
        ].join(" ")}
        style={{ paddingLeft: `${depth * 22 + 6}px` }}
      >
        {isFocused && (
          <span className="absolute left-0 top-[6px] bottom-[6px] w-[2px] bg-accent" />
        )}
        {isDropTarget && (
          <span className="absolute -top-[1px] left-0 right-0 h-[2px] bg-accent" />
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

        <button
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            e.currentTarget.blur();
            ed.toggle(task.id);
          }}
          aria-label={task.completed ? "Mark incomplete" : "Mark complete"}
          className={[
            "flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-sm border transition-colors",
            task.completed
              ? "border-good bg-good text-white"
              : "border-line-strong text-transparent hover:border-ink-soft",
          ].join(" ")}
        >
          <CheckIcon />
        </button>

        {task.priority < 4 && !task.completed && (
          <span
            className={`h-[6px] w-[6px] shrink-0 rounded-full ${PRIORITY_DOT[task.priority] ?? ""}`}
            title={`priority ${task.priority}`}
          />
        )}

        {editing ? (
          <RowInput task={task} />
        ) : (
          <span
            onClick={() => isFocused && ed.startEdit(task.id)}
            className={[
              "flex-1 truncate text-[14px]",
              task.completed
                ? "text-ink-faint line-through"
                : dimNotToday
                  ? "text-ink-soft"
                  : "text-ink",
              task.text === "" ? "text-ink-faint" : "",
            ].join(" ")}
          >
            {task.text === "" ? "Untitled" : renderInline(task.text)}
          </span>
        )}

        {!editing && task.notes.trim() !== "" && (
          <span className="shrink-0 text-ink-faint" title="Has details" aria-hidden="true">
            ¶
          </span>
        )}

        {progress != null && progress.total > 0 && (
          <span className="mono shrink-0 text-[11px] text-ink-faint">
            {progress.done}/{progress.total}
          </span>
        )}

        <button
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            e.currentTarget.blur();
            ed.zoomInto(task.id);
          }}
          className="grid h-5 w-5 shrink-0 place-items-center rounded-sm text-ink-faint opacity-0 transition hover:text-ink group-hover:opacity-100"
          aria-label="Zoom into task"
          title="Zoom in (⌥↵)"
        >
          <FocusIcon />
        </button>

        {task.plannedFor != null && !task.completed && ed.view !== "today" && (
          <span
            className={[
              "mono shrink-0 rounded-sm px-1.5 py-[1px] text-[10px] font-medium",
              task.plannedFor < ed.today
                ? "bg-bad-soft text-bad"
                : plannedToday
                  ? "bg-accent-soft text-accent"
                  : "bg-surface-2 text-ink-faint",
            ].join(" ")}
          >
            {relativeLabel(task.plannedFor, ed.today)}
          </span>
        )}

        {task.horizon != null && !ed.bucketed && !task.completed && ed.view !== "today" && (
          <span className="mono shrink-0 rounded-sm bg-surface-2 px-1.5 py-[1px] text-[10px] font-medium text-ink-soft">
            {horizonLabel(task, ed.today)}
          </span>
        )}
      </div>

      {hasChildren &&
        !isCollapsed &&
        task.children.map((child) => (
          <TaskRow key={child.id} task={child} depth={depth + 1} />
        ))}
    </>
  );
}
