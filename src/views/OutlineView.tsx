import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { ISODate, OutlineId, Project, ProjectId, TaskId } from "../types";
import { projectRowId } from "../types";
import type {
  Crumb,
  LaterGroup,
  ProjectTaskGroup,
  TodayProgress,
  ViewKind,
  ZoomFocus,
} from "../selectors";
import { VIEW_TITLES } from "../selectors";
import { formatLong } from "../store/dates";
import { CaptureBar } from "../components/CaptureBar";
import { TaskRow } from "../components/TaskRow";
import { InboxZero } from "../components/InboxZero";
import { Donut } from "../components/Donut";
import { NO_SPELLCHECK } from "../ui/noSpellcheck";

const TITLES = VIEW_TITLES;

const PLACEHOLDERS: Record<ViewKind, string> = {
  today: "Add a task for today…",
  backlog: "Capture something for later…",
  all: "Capture a task…",
  projects: "Capture into a project…",
  trash: "",
};

function Subtitle({
  view,
  progress,
}: {
  view: ViewKind;
  progress: TodayProgress;
}) {
  if (view === "today") {
    if (progress.total > 0 && progress.remaining === 0) {
      return <span className="text-good">Inbox zero — every task done.</span>;
    }
    return (
      <span>
        {progress.remaining} to go
        {progress.total > 0 ? ` · ${progress.done}/${progress.total} done` : ""}
      </span>
    );
  }
  if (view === "backlog") {
    return <span>Things for later — by week, month, someday. Press s to schedule.</span>;
  }
  if (view === "projects") {
    return <span>Every project — your stable home. Empty ones stay put.</span>;
  }
  return <span>Your whole outline. Press t to plan a task for today.</span>;
}

function EmptyState({ view }: { view: ViewKind }) {
  const msg: Record<ViewKind, string> = {
    today: "Nothing planned for today. Add one above, or plan from the backlog.",
    backlog: "Backlog is clear.",
    all: "No tasks yet — capture your first above.",
    projects: "No projects yet — create one above.",
    trash: "",
  };
  return (
    <div className="px-2 py-10 text-center text-[14px] text-ink-faint">
      {msg[view]}
    </div>
  );
}

function CaretIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="11"
      height="11"
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

/** A "focus / zoom in" target glyph. */
function FocusIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="1.7" fill="currentColor" />
    </svg>
  );
}

function ProjectDivider({
  group,
  focused,
  selected,
  editing,
  collapsed,
  onAddTask,
  onSelect,
  onToggleCollapse,
  onZoom,
  onStartRename,
  onCommitName,
  onExitRename,
  onArrowName,
  onCycleColor,
}: {
  group: ProjectTaskGroup;
  focused: boolean;
  selected: boolean;
  editing: boolean;
  collapsed: boolean;
  onAddTask: (projectId: ProjectId, afterId: TaskId | null) => void;
  onSelect: (id: OutlineId) => void;
  onToggleCollapse: (projectId: ProjectId) => void;
  onZoom: (projectId: ProjectId) => void;
  onStartRename: (projectId: ProjectId) => void;
  onCommitName: (projectId: ProjectId, name: string) => void;
  onExitRename: () => void;
  onArrowName: (projectId: ProjectId, name: string, dir: "up" | "down") => void;
  onCycleColor: (projectId: ProjectId) => void;
}) {
  const lastTask = group.tasks[group.tasks.length - 1] ?? null;
  const rowId = projectRowId(group.project.id);
  const active = focused || selected;
  const hasTasks = group.tasks.length > 0;

  return (
    <div
      onClick={() => onSelect(rowId)}
      onDoubleClick={() => onStartRename(group.project.id)}
      className="group relative mb-1.5 mt-7 flex cursor-default select-none items-center gap-2 px-1 first:mt-1"
    >
      {focused && (
        <span className="absolute left-0 top-1/2 h-3.5 w-[2px] -translate-y-1/2 bg-accent" />
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.currentTarget.blur();
          if (hasTasks) onToggleCollapse(group.project.id);
        }}
        className={`flex h-4 w-4 shrink-0 items-center justify-center text-ink-faint hover:text-ink ${
          hasTasks ? "visible" : "invisible"
        }`}
        aria-label={collapsed ? "Expand project" : "Collapse project"}
      >
        <CaretIcon open={!collapsed} />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.currentTarget.blur();
          onCycleColor(group.project.id);
        }}
        className="h-[7px] w-[7px] shrink-0 rounded-full ring-1 ring-inset ring-black/10 transition-transform hover:scale-125"
        style={{ backgroundColor: group.project.color }}
        aria-label={`Cycle color for ${group.project.name}`}
      />
      {editing ? (
        <ProjectNameInput
          project={group.project}
          onCommit={onCommitName}
          onExit={onExitRename}
          onArrow={onArrowName}
        />
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (focused) onStartRename(group.project.id);
            else onSelect(rowId);
          }}
          className={[
            "mono ml-0.5 max-w-[55%] shrink-0 truncate bg-transparent text-left text-[11px] font-medium uppercase tracking-[0.14em] transition-colors",
            active ? "text-ink" : "text-ink-soft group-hover:text-ink",
          ].join(" ")}
        >
          {group.project.name}
        </button>
      )}
      <span
        className="h-px flex-1"
        style={{ backgroundColor: group.project.color, opacity: 0.3 }}
      />
      <span className="mono shrink-0 text-[11px] text-ink-faint">
        {group.tasks.length}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.currentTarget.blur();
          onZoom(group.project.id);
        }}
        className="grid h-5 w-5 shrink-0 place-items-center rounded-sm text-ink-faint opacity-0 transition hover:text-ink focus:opacity-100 group-hover:opacity-100"
        aria-label={`Zoom into ${group.project.name}`}
        title="Zoom in (⌥↵)"
      >
        <FocusIcon />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.currentTarget.blur();
          onAddTask(group.project.id, lastTask?.id ?? null);
        }}
        className="grid h-5 w-5 shrink-0 place-items-center rounded-sm text-[15px] leading-none text-ink-faint opacity-0 transition hover:text-ink focus:opacity-100 group-hover:opacity-100"
        aria-label={`Add task to ${group.project.name}`}
      >
        +
      </button>
    </div>
  );
}

export function ProjectNameInput({
  project,
  onCommit,
  onExit,
  onArrow,
}: {
  project: Project;
  onCommit: (projectId: ProjectId, name: string) => void;
  onExit: () => void;
  onArrow: (projectId: ProjectId, name: string, dir: "up" | "down") => void;
}) {
  const [value, setValue] = useState(project.name);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = () => {
    onCommit(project.id, value);
  };

  return (
    <input
      {...NO_SPELLCHECK}
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          commit();
          onExit();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          e.stopPropagation();
          onArrow(project.id, value, "up");
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          e.stopPropagation();
          onArrow(project.id, value, "down");
        }
      }}
      className="mono min-w-0 max-w-[55%] flex-1 bg-transparent text-[12px] font-medium tracking-wide text-ink outline-none"
    />
  );
}

function Breadcrumb({
  crumbs,
  onCrumb,
}: {
  crumbs: Crumb[];
  onCrumb: (id: OutlineId | null) => void;
}) {
  return (
    <nav className="mb-2 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-faint">
      {crumbs.map((c, i) => (
        <span key={`${c.kind}-${c.id ?? "home"}-${i}`} className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onCrumb(c.id)}
            className="max-w-[18ch] truncate transition-colors hover:text-ink"
          >
            {c.label}
          </button>
          <span aria-hidden className="select-none opacity-50">
            ›
          </span>
        </span>
      ))}
    </nav>
  );
}

function CompletedHiddenPill({ onShow }: { onShow: () => void }) {
  return (
    <button
      type="button"
      onClick={onShow}
      className="mono shrink-0 rounded-sm bg-surface-2 px-1.5 py-[3px] text-[10px] font-medium uppercase tracking-[0.1em] text-ink-faint transition-colors hover:text-ink"
      title="Show completed (h)"
    >
      ✓ completed hidden
    </button>
  );
}

function LayoutToggle({
  layout,
  onToggle,
}: {
  layout: "date" | "project";
  onToggle: () => void;
}) {
  const seg = (target: "date" | "project", label: string) => (
    <button
      type="button"
      onClick={() => {
        if (layout !== target) onToggle();
      }}
      className={[
        "mono rounded-[1px] px-2 py-[3px] text-[10px] uppercase tracking-[0.1em] transition-colors",
        layout === target ? "bg-surface-3 text-ink" : "text-ink-faint hover:text-ink",
      ].join(" ")}
    >
      {label}
    </button>
  );
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-sm border border-line p-0.5">
      {seg("date", "By date")}
      {seg("project", "By project")}
    </div>
  );
}

function BucketSection({ group }: { group: LaterGroup }) {
  const { meta, tasks, done, total } = group;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <section className="mt-6 px-2 first:mt-1">
      <div className="mb-1.5 flex items-center gap-2.5 px-1">
        {meta.elapsed != null && (
          <Donut fraction={meta.elapsed} label={`${Math.round(meta.elapsed * 100)}% elapsed`} />
        )}
        <span className="mono text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">
          {meta.label}
        </span>
        {meta.sublabel != null && (
          <span className="mono text-[11px] text-ink-faint">{meta.sublabel}</span>
        )}
        <span className="h-px flex-1 bg-line" />
        {total > 0 && (
          <span className="mono shrink-0 text-[11px] text-ink-faint">{pct}% done</span>
        )}
      </div>
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} depth={0} />
      ))}
    </section>
  );
}

export function OutlineView({
  view,
  today,
  groups,
  buckets,
  laterLayout,
  onToggleLaterLayout,
  zoom,
  collapsedProjectIds,
  hideCompleted,
  onToggleHideCompleted,
  focusedId,
  selectedIds,
  editingProjectId,
  progress,
  captureRef,
  onAdd,
  onCaptureArrowDown,
  onAddProject,
  onAddToProject,
  onSelectRow,
  onCrumb,
  onToggleProjectCollapsed,
  onZoomProject,
  onStartRenameProject,
  onCommitProjectName,
  onExitProjectName,
  onArrowProjectName,
  onCycleProjectColor,
}: {
  view: ViewKind;
  today: ISODate;
  groups: ProjectTaskGroup[];
  buckets: LaterGroup[];
  laterLayout: "date" | "project";
  onToggleLaterLayout: () => void;
  zoom: ZoomFocus | null;
  collapsedProjectIds: Set<ProjectId>;
  hideCompleted: boolean;
  onToggleHideCompleted: () => void;
  focusedId: OutlineId | null;
  selectedIds: OutlineId[];
  editingProjectId: ProjectId | null;
  progress: TodayProgress;
  captureRef: RefObject<HTMLInputElement>;
  onAdd: (raw: string) => void;
  onCaptureArrowDown: () => void;
  onAddProject: () => void;
  onAddToProject: (projectId: ProjectId, afterId: TaskId | null) => void;
  onSelectRow: (id: OutlineId) => void;
  onCrumb: (id: OutlineId | null) => void;
  onToggleProjectCollapsed: (projectId: ProjectId) => void;
  onZoomProject: (projectId: ProjectId) => void;
  onStartRenameProject: (projectId: ProjectId) => void;
  onCommitProjectName: (projectId: ProjectId, name: string) => void;
  onExitProjectName: () => void;
  onArrowProjectName: (projectId: ProjectId, name: string, dir: "up" | "down") => void;
  onCycleProjectColor: (projectId: ProjectId) => void;
}) {
  const usingBuckets = zoom == null && view === "backlog" && laterLayout === "date";
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-10 py-8">
      {zoom != null ? (
        <header className="mb-5 border-b border-line pb-4">
          <Breadcrumb crumbs={zoom.crumbs} onCrumb={onCrumb} />
          <div className="flex items-center gap-2.5">
            {zoom.color != null && (
              <span
                className="h-3 w-3 shrink-0 rounded-full ring-1 ring-inset ring-black/10"
                style={{ backgroundColor: zoom.color }}
              />
            )}
            <h1 className="min-w-0 flex-1 truncate font-serif text-[28px] font-medium leading-none tracking-tight text-ink">
              {zoom.title}
            </h1>
            {hideCompleted && <CompletedHiddenPill onShow={onToggleHideCompleted} />}
          </div>
          <p className="mt-2 text-[13px] text-ink-soft">
            {zoom.kind === "project"
              ? "Focused on this project — everything in it, due soon or later. Esc backs out."
              : "Focused on this task — its subtree only. Esc backs out."}
          </p>
        </header>
      ) : (
        <header className="mb-5 border-b border-line pb-4">
          {view === "today" && (
            <div className="eyebrow mb-1.5">{formatLong(today)}</div>
          )}
          <div className="flex items-center justify-between gap-3">
            <h1 className="font-serif text-[32px] font-medium leading-none tracking-tight text-ink">
              {TITLES[view]}
            </h1>
            <div className="flex shrink-0 items-center gap-2">
              {view === "backlog" && (
                <LayoutToggle layout={laterLayout} onToggle={onToggleLaterLayout} />
              )}
              {hideCompleted && <CompletedHiddenPill onShow={onToggleHideCompleted} />}
            </div>
          </div>
          <p className="mt-2 text-[14px] text-ink-soft">
            <Subtitle view={view} progress={progress} />
          </p>
        </header>
      )}

      <div className="mb-4">
        <CaptureBar
          inputRef={captureRef}
          placeholder={zoom != null ? `Add to ${zoom.title}…` : PLACEHOLDERS[view]}
          onAdd={onAdd}
          onArrowDown={onCaptureArrowDown}
        />
      </div>

      {zoom == null && view === "all" && (
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={onAddProject}
            className="rounded-sm border border-line px-2.5 py-1 text-[12px] text-ink-soft hover:border-line-strong hover:text-ink"
          >
            + Project
          </button>
        </div>
      )}

      {zoom == null && view === "today" && progress.total > 0 && progress.remaining === 0 && (
        <div className="mb-4">
          <InboxZero total={progress.total} />
        </div>
      )}

      <div className="-mx-2 flex-1 overflow-auto">
        {zoom != null ? (
          <section className="px-2">
            {zoom.subtree.length === 0 ? (
              <button
                type="button"
                onClick={() => captureRef.current?.focus()}
                className="block w-full px-1 py-2 text-left text-[13px] text-ink-faint hover:text-ink-soft"
              >
                Nothing here yet — capture above to add the first task.
              </button>
            ) : (
              zoom.subtree.map((t) => <TaskRow key={t.id} task={t} depth={0} />)
            )}
          </section>
        ) : usingBuckets ? (
          buckets.length === 0 ? (
            <EmptyState view={view} />
          ) : (
            buckets.map((group) => <BucketSection key={group.meta.id} group={group} />)
          )
        ) : groups.length === 0 ? (
          <EmptyState view={view} />
        ) : (
          groups.map((group) => {
            const collapsed = collapsedProjectIds.has(group.project.id);
            return (
              <section key={group.project.id} className="px-2">
                <ProjectDivider
                  group={group}
                  focused={focusedId === projectRowId(group.project.id)}
                  selected={selectedIds.includes(projectRowId(group.project.id))}
                  editing={editingProjectId === group.project.id}
                  collapsed={collapsed}
                  onAddTask={onAddToProject}
                  onSelect={onSelectRow}
                  onToggleCollapse={onToggleProjectCollapsed}
                  onZoom={onZoomProject}
                  onStartRename={onStartRenameProject}
                  onCommitName={onCommitProjectName}
                  onExitRename={onExitProjectName}
                  onArrowName={onArrowProjectName}
                  onCycleColor={onCycleProjectColor}
                />
                {collapsed ? null : group.tasks.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => onAddToProject(group.project.id, null)}
                    className="block w-full px-1 pb-2 pt-1 text-left text-[12px] text-ink-faint hover:text-ink-soft"
                  >
                    Empty — press + to add the first task.
                  </button>
                ) : (
                  group.tasks.map((t) => <TaskRow key={t.id} task={t} depth={0} />)
                )}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
