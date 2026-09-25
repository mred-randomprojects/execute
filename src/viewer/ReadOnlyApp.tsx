import { useEffect, useMemo, useRef, useState } from "react";
import type { AppState, ProjectId, TaskId } from "../types";
import { findById } from "../store/tasks";
import { TaskSheet, type TaskPatch } from "./TaskSheet";
import { sinceLabel, todayISO } from "../store/dates";
import { CaptureBar } from "../components/CaptureBar";
import {
  groupTasksByProject,
  leftoverTree,
  todayProgress,
  viewTasks,
  type Period,
  type ViewKind,
} from "../selectors";
import { EditorProvider, type Editor } from "../ui/editor";
import { TaskRow } from "../components/TaskRow";

// The three windows the viewer exposes. (Projects / Recurring / Trash are
// desktop-only management surfaces; the read-only mirror stays task-focused.)
const TABS: { key: ViewKind; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "backlog", label: "Later" },
  { key: "all", label: "All" },
];

/** Project header — the OutlineView divider, stripped of every edit affordance. */
function ReadOnlyDivider({
  name,
  color,
  count,
  collapsed,
  onToggle,
}: {
  name: string;
  color: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="group relative mb-1.5 mt-7 flex select-none items-center gap-2 px-1 first:mt-1">
      <button
        type="button"
        onClick={onToggle}
        className={`flex h-4 w-4 shrink-0 items-center justify-center text-ink-faint hover:text-ink ${count > 0 ? "visible" : "invisible"}`}
        aria-label={collapsed ? "Expand project" : "Collapse project"}
      >
        <svg
          viewBox="0 0 16 16"
          width="11"
          height="11"
          aria-hidden="true"
          className={`transition-transform ${collapsed ? "" : "rotate-90"}`}
        >
          <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <span
        className="h-[7px] w-[7px] shrink-0 rounded-full ring-1 ring-inset ring-black/10"
        style={{ backgroundColor: color }}
      />
      <span className="mono ml-0.5 max-w-[55%] shrink-0 truncate text-left text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">
        {name}
      </span>
      <span className="h-px flex-1" style={{ backgroundColor: color, opacity: 0.3 }} />
      <span className="mono shrink-0 text-[11px] text-ink-faint">{count}</span>
    </div>
  );
}

/** A one-line strip under the header for things the user must know about. */
export interface ViewerNotice {
  text: string;
  action: string;
  onAction: () => void;
}

/** Re-render every 30s so "updated 5m ago" keeps telling the truth. */
function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Past this, the cloud copy is old enough that the header says so in colour. */
const STALE_CLOUD_MS = 24 * 3_600_000;

export function ReadOnlyApp({
  state,
  cloudUpdatedAt,
  notice,
  email,
  onSignOut,
  onToggle,
  onAdd,
  onUpdate,
}: {
  state: AppState;
  /** When any client last wrote the cloud document — how fresh this view is. */
  cloudUpdatedAt: number | null;
  notice: ViewerNotice | null;
  email: string | null;
  onSignOut: () => void;
  onToggle: (id: TaskId) => void;
  onAdd: (text: string, today: boolean) => void;
  onUpdate: (id: TaskId, patch: TaskPatch) => void;
}) {
  const captureRef = useRef<HTMLInputElement>(null);
  const today = todayISO(state.devDateOverride);
  const [view, setView] = useState<ViewKind>("today");
  const period: Period = "today";

  // Local-only UI state — navigation, not mutation. Persisting none of it.
  const [cursorId, setCursorId] = useState<TaskId | null>(null);
  const [peekId, setPeekId] = useState<TaskId | null>(null);
  // The task whose details sheet is open. Tapping a row opens it — on a phone
  // that's the whole of "select", and the only way to reach a task's fields.
  const [sheetId, setSheetId] = useState<TaskId | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<TaskId>>(new Set());
  const [collapsedProjects, setCollapsedProjects] = useState<Set<ProjectId>>(new Set());

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", state.theme);
  }, [state.theme]);

  const filtered = useMemo(
    () => viewTasks(state.tasks, view, today, period),
    [state.tasks, view, today],
  );
  const groups = useMemo(
    () => groupTasksByProject(filtered, state.projects),
    [filtered, state.projects],
  );
  const progress = useMemo(() => todayProgress(state.tasks, today), [state.tasks, today]);
  // Planned for a day that's gone. The desktop's Reckoning carries these
  // forward when it's opened; until then no date-keyed tab would show them, and
  // a Today tab that hides everything from yesterday reads as "no tasks".
  const earlierGroups = useMemo(
    () =>
      view === "today" ? groupTasksByProject(leftoverTree(state.tasks, today), state.projects) : [],
    [state.tasks, state.projects, view, today],
  );
  const now = useNow();
  const cloudStale = cloudUpdatedAt != null && now - cloudUpdatedAt > STALE_CLOUD_MS;

  const noop = () => {};
  const editor: Editor = {
    view,
    today,
    bucketed: false,
    cursorId,
    currentId: state.currentTaskId,
    selectedIds: [],
    editingId: null,
    reasonEditId: null,
    peekId,
    collapsed,
    mode: "normal",
    movingId: null,
    scrollTick: 0, // no keyboard reorder in the viewer
    // Tapping a task expands it in place (peek): the full title unwraps and any
    // notes render below. On mobile, truncated titles were otherwise unreadable
    // and there was no way to see a task's details.
    select: (id) => {
      setCursorId(id);
      setSheetId(id);
    },
    toggleSelect: setCursorId, // no multi-select in the viewer — just focus
    rangeSelect: setCursorId,
    canDrag: false, // no drag-to-move in the read-only viewer
    touch: true, // phone layout: full-width wrapping titles, badges below, bigger targets
    dragId: null,
    beginDrag: noop,
    endDrag: noop,
    dropAllowed: () => false,
    dropOn: noop,
    toggleCollapse: (id) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    togglePeek: (id) => {
      setCursorId(id);
      setPeekId((p) => (p === id ? null : id));
    },
    // Completion is the one write the viewer allows — check tasks off anywhere.
    toggle: onToggle,
    reopen: noop,
    startEdit: noop,
    startReason: noop,
    waitingEditId: null,
    startWaiting: noop,
    commitWaiting: noop,
    clearWaiting: noop,
    openDetail: noop,
    zoomInto: noop,
    commit: noop,
    indentEditing: noop,
    outdentEditing: noop,
    exitUp: noop,
    exitDown: noop,
    toggleFromEdit: noop,
    exitEdit: noop,
    removeAndExit: noop,
    commitReason: noop,
  };

  const sheetTask = sheetId != null ? (findById(state.tasks, sheetId) ?? null) : null;

  const toggleProject = (id: ProjectId) =>
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink">
      {/* One slim bar that stays put: name, freshness, account. */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-bg/95 px-4 py-2.5 backdrop-blur sm:px-6">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <span className="font-serif text-lg font-medium">execute</span>
          {cloudUpdatedAt != null && (
            <span className={`truncate text-[11px] ${cloudStale ? "text-mid" : "text-ink-faint"}`}>
              updated {sinceLabel(cloudUpdatedAt, now)}
            </span>
          )}
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setAccountOpen((o) => !o)}
            aria-label="Account"
            aria-expanded={accountOpen}
            className="grid h-8 w-8 place-items-center rounded-full border border-line bg-surface text-[13px] font-medium text-ink-soft"
          >
            {(email ?? "?").slice(0, 1).toUpperCase()}
          </button>
          {accountOpen && (
            <>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setAccountOpen(false)}
                className="fixed inset-0 z-30 cursor-default"
              />
              <div className="absolute right-0 top-10 z-40 w-56 rounded-md border border-line bg-surface p-1 shadow-lg">
                {email != null && (
                  <p className="truncate px-3 py-2 text-[12px] text-ink-faint">{email}</p>
                )}
                <button
                  type="button"
                  onClick={onSignOut}
                  className="w-full rounded-sm px-3 py-2 text-left text-[14px] text-ink hover:bg-surface-2"
                >
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {notice != null && (
        <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-2 px-4 py-2 text-[13px] text-ink sm:px-6">
          <span>{notice.text}</span>
          <button
            type="button"
            onClick={notice.onAction}
            className="shrink-0 rounded border border-line bg-surface px-3 py-1 text-[12px] font-medium hover:bg-surface-3"
          >
            {notice.action}
          </button>
        </div>
      )}

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-10 pt-4 sm:px-10 sm:pt-8">
        {/* The view switch is the heading: no separate title above it. */}
        <div className="mb-3 flex items-center justify-between gap-3">
          <nav aria-label="View" className="flex rounded-md bg-surface-2 p-0.5">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setView(t.key)}
                aria-current={t.key === view ? "page" : undefined}
                className={[
                  "rounded-[5px] px-3.5 py-1.5 text-[14px] font-medium transition-colors",
                  t.key === view ? "bg-surface text-ink shadow-sm" : "text-ink-faint",
                ].join(" ")}
              >
                {t.label}
              </button>
            ))}
          </nav>
          {view === "today" && (
            <p className="shrink-0 text-[13px] text-ink-soft">
              {progress.total > 0 && progress.remaining === 0 ? (
                <span className="text-good">All done</span>
              ) : (
                <span>
                  {progress.remaining} to go
                  {progress.total > 0 ? ` · ${progress.done}/${progress.total}` : ""}
                </span>
              )}
            </p>
          )}
        </div>

        <div className="mb-4">
          <CaptureBar
            inputRef={captureRef}
            placeholder={view === "today" ? "Add a task for today…" : "Capture a task…"}
            onAdd={(raw) => onAdd(raw, view === "today")}
            onArrowDown={() => {}}
          />
        </div>

        <EditorProvider value={editor}>
          <div className="-mx-2 flex-1">
            {groups.length === 0 && earlierGroups.length === 0 ? (
              <div className="px-2 py-10 text-center text-[14px] text-ink-faint">
                Nothing here.
              </div>
            ) : (
              groups.map((group) => {
                const isCollapsed = collapsedProjects.has(group.project.id);
                return (
                  <section key={group.project.id} className="px-2">
                    <ReadOnlyDivider
                      name={group.project.name}
                      color={group.project.color}
                      count={group.tasks.length}
                      collapsed={isCollapsed}
                      onToggle={() => toggleProject(group.project.id)}
                    />
                    {isCollapsed
                      ? null
                      : group.tasks.map((t) => <TaskRow key={t.id} task={t} depth={0} />)}
                  </section>
                );
              })
            )}
            {earlierGroups.length > 0 && (
              <div className="mt-10 px-2">
                <div className="mb-1 flex items-baseline justify-between gap-3 border-b border-line pb-2">
                  <h2 className="font-serif text-[20px] font-medium">Earlier</h2>
                  <span className="text-[12px] text-ink-faint">
                    planned for a past day · the desktop carries these forward
                  </span>
                </div>
                {earlierGroups.map((group) => (
                  <section key={group.project.id}>
                    <ReadOnlyDivider
                      name={group.project.name}
                      color={group.project.color}
                      count={group.tasks.length}
                      collapsed={collapsedProjects.has(group.project.id)}
                      onToggle={() => toggleProject(group.project.id)}
                    />
                    {collapsedProjects.has(group.project.id)
                      ? null
                      : group.tasks.map((t) => <TaskRow key={t.id} task={t} depth={0} />)}
                  </section>
                ))}
              </div>
            )}
          </div>
        </EditorProvider>
      </div>
      {sheetTask != null && (
        <TaskSheet
          task={sheetTask}
          projects={state.projects}
          canChangeProject={state.tasks.some((t) => t.id === sheetTask.id)}
          today={today}
          onUpdate={(patch) => onUpdate(sheetTask.id, patch)}
          onToggle={() => onToggle(sheetTask.id)}
          onClose={() => setSheetId(null)}
        />
      )}
    </div>
  );
}
