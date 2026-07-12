import { useEffect, useRef, useState } from "react";
import type { Task } from "../types";
import { countAll, isOpen } from "../store/tasks";
import { copyText } from "../ui/clipboard";
import { relativeLabel } from "../store/dates";
import { horizonLabel } from "../selectors";
import { useEditor, type DropPos } from "../ui/editor";
import { renderBlock, renderInline } from "../ui/markdown";
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

function XIcon() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
      <path
        d="M4 4l8 8M12 4l-8 8"
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

export function RowInput({ task }: { task: Task }) {
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

/** Inline "why won't you do this?" field, shown just after a fresh skip. */
export function ReasonInput({ task }: { task: Task }) {
  const ed = useEditor();
  const [value, setValue] = useState(task.wontDo?.reason ?? "");
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
      onBlur={() => ed.commitReason(task.id, value)}
      onKeyDown={(e) => {
        // Enter and Escape both save-and-exit (matching the title editor), so an
        // unmount-time blur can only ever re-commit the same value — never a
        // value the user meant to discard.
        if (e.key === "Enter" || e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          ed.commitReason(task.id, value);
        }
      }}
      placeholder="why? (optional — enter to save)"
      className="min-w-0 flex-1 bg-transparent text-[12px] italic text-ink-soft outline-none placeholder:not-italic placeholder:text-ink-faint"
    />
  );
}

export function TaskRow({ task, depth }: { task: Task; depth: number }) {
  const ed = useEditor();
  const isFocused = ed.cursorId === task.id;
  const wontDo = task.wontDo != null;
  const reasonText = task.wontDo?.reason ?? "";
  const hasReason = reasonText !== "";
  const isCurrent = ed.currentId === task.id && isOpen(task);
  const inSelection = ed.selectedIds.includes(task.id);
  const editing = ed.editingId === task.id;
  const reasonEditing = ed.reasonEditId === task.id;
  const peeking = ed.peekId === task.id && !editing;
  const isMoving = ed.movingId === task.id;
  const isDropTarget = ed.mode === "move" && isFocused && !isMoving;
  const hasChildren = task.children.length > 0;
  const isCollapsed = ed.collapsed.has(task.id);
  const isDragging = ed.dragId === task.id;
  const [dropPos, setDropPos] = useState<DropPos | null>(null);
  const plannedToday = task.plannedFor === ed.today;
  const progress = hasChildren ? countAll(task) : null;
  // In Today, a task that isn't itself planned for today only shows because a
  // descendant is — dim it so the "for today" items stand out.
  const dimNotToday = ed.view === "today" && !plannedToday && isOpen(task);

  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isFocused) rowRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [isFocused]);

  return (
    <>
      <div
        ref={rowRef}
        draggable={ed.canDrag && !editing}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey) ed.toggleSelect(task.id); // ⌘-click: discontiguous
          else if (e.shiftKey) ed.rangeSelect(task.id); // ⇧-click: range
          else ed.select(task.id);
        }}
        onDoubleClick={() => ed.openDetail(task.id)}
        onDragStart={(e) => {
          if (!ed.canDrag) return;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", task.id);
          ed.beginDrag(task.id);
        }}
        onDragEnd={() => {
          ed.endDrag();
          setDropPos(null);
        }}
        onDragOver={(e) => {
          // Only a legal target opts into the drop (preventDefault); otherwise the
          // browser shows a "no-drop" cursor — so you can't drop into own subtree.
          if (!ed.dropAllowed(task.id)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          const rect = rowRef.current?.getBoundingClientRect();
          if (rect == null) return;
          const frac = (e.clientY - rect.top) / rect.height;
          const pos: DropPos = frac < 0.28 ? "before" : frac > 0.72 ? "after" : "child";
          setDropPos((p) => (p === pos ? p : pos));
        }}
        onDragLeave={(e) => {
          if (!rowRef.current?.contains(e.relatedTarget as Node | null)) setDropPos(null);
        }}
        onDrop={(e) => {
          if (ed.dropAllowed(task.id) && dropPos != null) {
            e.preventDefault();
            ed.dropOn(task.id, dropPos);
          }
          setDropPos(null);
        }}
        className={[
          "group relative flex gap-2 rounded-sm py-[5px] pr-2 cursor-default select-none",
          peeking ? "items-start" : "items-center",
          isCurrent
            ? "bg-accent-soft/40 ring-1 ring-inset ring-accent/40"
            : inSelection && !editing
              ? "bg-surface-2"
              : "hover:bg-surface-2/60",
          isMoving ? "opacity-50" : "",
          isDragging ? "opacity-40" : "",
          dropPos === "child" ? "ring-1 ring-inset ring-accent/70 bg-accent-soft/40" : "",
        ].join(" ")}
        style={{ paddingLeft: `${depth * 22 + 6}px` }}
      >
        {isFocused && (
          <span className="absolute left-0 top-[6px] bottom-[6px] w-[2px] bg-accent" />
        )}
        {isDropTarget && (
          <span className="absolute -top-[1px] left-0 right-0 h-[2px] bg-accent" />
        )}
        {dropPos === "before" && (
          <span className="pointer-events-none absolute -top-[1px] left-0 right-0 h-[2px] bg-accent" />
        )}
        {dropPos === "after" && (
          <span className="pointer-events-none absolute -bottom-[1px] left-0 right-0 h-[2px] bg-accent" />
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
            // The ✕ box reopens a skip; otherwise it's the ordinary done toggle.
            if (wontDo) ed.reopen(task.id);
            else ed.toggle(task.id);
          }}
          aria-label={
            task.completed
              ? "Mark incomplete"
              : wontDo
                ? "Won’t do — click to reopen"
                : "Mark complete"
          }
          className={[
            "flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-sm border transition-colors",
            task.completed
              ? "border-good bg-good text-white"
              : wontDo
                ? "border-bad bg-bad text-white"
                : "border-line-strong text-transparent hover:border-ink-soft",
          ].join(" ")}
        >
          {wontDo ? <XIcon /> : <CheckIcon />}
        </button>

        {task.priority < 4 && isOpen(task) && (
          <span
            className={`h-[6px] w-[6px] shrink-0 rounded-full ${PRIORITY_DOT[task.priority] ?? ""}`}
            title={`priority ${task.priority}`}
          />
        )}

        {editing ? (
          <RowInput task={task} />
        ) : (
          <span
            onClick={(e) => {
              // A modified click is a selection gesture (handled by the row) —
              // don't drop into title editing.
              if (e.metaKey || e.ctrlKey || e.shiftKey) return;
              if (isFocused) ed.startEdit(task.id);
            }}
            className={[
              "flex-1 text-[14px]",
              peeking
                ? "whitespace-pre-wrap [overflow-wrap:anywhere] leading-relaxed"
                : "truncate",
              task.completed || wontDo
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

        {/* Won't-do reason: an inline field right after a fresh skip; otherwise
            the recorded reason (or a "why?" prompt when none yet). The focused
            row shows a `w` keycap so the edit shortcut is discoverable. */}
        {!editing && reasonEditing ? (
          <ReasonInput task={task} />
        ) : !editing && wontDo && (hasReason || isFocused) ? (
          <span
            onClick={() => isFocused && ed.startReason(task.id)}
            className="flex min-w-0 max-w-[50%] shrink items-center gap-1.5"
          >
            {hasReason ? (
              <span className="min-w-0 truncate text-[12px] italic text-ink-faint" title={reasonText}>
                — {reasonText}
              </span>
            ) : (
              <span className="text-[12px] text-ink-faint">why?</span>
            )}
            {isFocused && <span className="kbd shrink-0">w</span>}
          </span>
        ) : null}

        {isCurrent && !editing && (
          <span className="mono shrink-0 rounded-sm bg-accent px-1.5 py-[1px] text-[10px] font-medium uppercase tracking-[0.12em] text-white">
            Now
          </span>
        )}

        {!editing && task.notes.trim() !== "" && (
          <button
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              e.currentTarget.blur();
              ed.togglePeek(task.id);
            }}
            className="flex shrink-0 items-center gap-1 text-ink-faint transition hover:text-ink"
            title="Has details — peek in place (p)"
            aria-label="Peek details"
          >
            <span aria-hidden="true">¶</span>
            {isFocused && !peeking && <span className="kbd">p</span>}
          </button>
        )}

        {progress != null && progress.total > 0 && (
          <span className="mono shrink-0 text-[11px] text-ink-faint">
            {progress.done}/{progress.total}
          </span>
        )}

        {!editing && (
          <button
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              e.currentTarget.blur();
              void copyText(task.id);
            }}
            className={[
              "mono shrink-0 rounded-sm bg-surface-2 px-1 py-[1px] text-[10px] text-ink-faint transition hover:text-ink",
              isFocused ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            ].join(" ")}
            aria-label={`Task id ${task.id} — click to copy`}
            title={`${task.id} · click to copy`}
          >
            {task.id.slice(0, 4)}
          </button>
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

        {task.plannedFor != null && isOpen(task) && ed.view !== "today" && (
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

        {task.horizon != null && !ed.bucketed && isOpen(task) && ed.view !== "today" && (
          <span className="mono shrink-0 rounded-sm bg-surface-2 px-1.5 py-[1px] text-[10px] font-medium text-ink-soft">
            {horizonLabel(task, ed.today)}
          </span>
        )}
      </div>

      {/* The peek body (`p`): the task's notes, rendered in place under the
          unwrapped title. Aligned with the title text, not the checkbox. */}
      {peeking && task.notes.trim() !== "" && (
        <div
          className="mb-1.5 mr-2 rounded-sm border-l-2 border-accent/40 bg-surface-2/60 px-3 py-2 text-[13px] leading-relaxed text-ink-soft"
          style={{ marginLeft: `${depth * 22 + 55}px` }}
        >
          {renderBlock(task.notes)}
        </div>
      )}

      {hasChildren &&
        !isCollapsed &&
        task.children.map((child) => (
          <TaskRow key={child.id} task={child} depth={depth + 1} />
        ))}
    </>
  );
}
