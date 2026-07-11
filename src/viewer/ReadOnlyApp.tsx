import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import type { AppState, ProjectId, TaskId } from "../types";
import { todayISO } from "../store/dates";
import {
  groupTasksByProject,
  todayProgress,
  viewTasks,
  VIEW_TITLES,
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

export function ReadOnlyApp({
  state,
  user,
  onSignOut,
}: {
  state: AppState;
  user: User;
  onSignOut: () => void;
}) {
  const today = todayISO(state.devDateOverride);
  const [view, setView] = useState<ViewKind>("today");
  const period: Period = "today";

  // Local-only UI state — navigation, not mutation. Persisting none of it.
  const [cursorId, setCursorId] = useState<TaskId | null>(null);
  const [peekId, setPeekId] = useState<TaskId | null>(null);
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
    // Navigation is allowed (it's local); everything that mutates is inert.
    select: setCursorId,
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
    toggle: noop,
    reopen: noop,
    startEdit: noop,
    startReason: noop,
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

  const toggleProject = (id: ProjectId) =>
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink">
      <header className="flex items-center justify-between border-b border-line px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="font-serif text-lg font-medium">execute</span>
          <span className="mono rounded-sm bg-surface-2 px-1.5 py-[2px] text-[10px] uppercase tracking-[0.12em] text-ink-faint">
            read-only
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-[12px] text-ink-faint sm:inline">{user.email}</span>
          <button
            type="button"
            onClick={onSignOut}
            className="rounded border border-line bg-surface px-3 py-1 text-[12px] font-medium hover:bg-surface-2"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-8 sm:px-10">
        <div className="mb-5 border-b border-line pb-4">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="font-serif text-[32px] font-medium leading-none tracking-tight">
              {view === "today" ? "Today" : VIEW_TITLES[view]}
            </h1>
          </div>
          <nav aria-label="View" className="mt-3 flex flex-wrap items-center gap-0.5">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setView(t.key)}
                className={[
                  "mono rounded-sm px-2 py-[4px] text-[10px] font-medium uppercase tracking-[0.1em] transition-colors",
                  t.key === view ? "bg-surface-3 text-ink" : "text-ink-faint hover:bg-surface-2 hover:text-ink",
                ].join(" ")}
              >
                {t.label}
              </button>
            ))}
          </nav>
          {view === "today" && (
            <p className="mt-2 text-[14px] text-ink-soft">
              {progress.total > 0 && progress.remaining === 0 ? (
                <span className="text-good">Inbox zero — every task done.</span>
              ) : (
                <span>
                  {progress.remaining} to go
                  {progress.total > 0 ? ` · ${progress.done}/${progress.total} done` : ""}
                </span>
              )}
            </p>
          )}
        </div>

        <EditorProvider value={editor}>
          <div className="-mx-2 flex-1 overflow-auto">
            {groups.length === 0 ? (
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
          </div>
        </EditorProvider>
      </div>
    </div>
  );
}
