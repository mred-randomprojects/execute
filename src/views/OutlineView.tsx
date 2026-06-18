import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { ISODate, OutlineId, Project, ProjectId, TaskId } from "../types";
import { projectRowId } from "../types";
import type { ProjectTaskGroup, TodayProgress, ViewKind } from "../selectors";
import { formatLong } from "../store/dates";
import { CaptureBar } from "../components/CaptureBar";
import { TaskRow } from "../components/TaskRow";
import { InboxZero } from "../components/InboxZero";

const TITLES: Record<ViewKind, string> = {
  today: "Today",
  backlog: "Backlog",
  all: "All tasks",
  trash: "Trash",
};

const PLACEHOLDERS: Record<ViewKind, string> = {
  today: "Add a task for today…",
  backlog: "Capture something for later…",
  all: "Capture a task…",
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
  if (view === "backlog") return <span>Things to plan into a day.</span>;
  return <span>Your whole outline. Press t to plan a task for today.</span>;
}

function EmptyState({ view }: { view: ViewKind }) {
  const msg: Record<ViewKind, string> = {
    today: "Nothing planned for today. Add one above, or plan from the backlog.",
    backlog: "Backlog is clear.",
    all: "No tasks yet — capture your first above.",
    trash: "",
  };
  return (
    <div className="px-2 py-10 text-center text-[14px] text-ink-faint">
      {msg[view]}
    </div>
  );
}

function ProjectDivider({
  group,
  focused,
  selected,
  editing,
  onAddTask,
  onSelect,
  onStartRename,
  onCommitName,
  onExitRename,
  onCycleColor,
}: {
  group: ProjectTaskGroup;
  focused: boolean;
  selected: boolean;
  editing: boolean;
  onAddTask: (projectId: ProjectId, afterId: TaskId | null) => void;
  onSelect: (id: OutlineId) => void;
  onStartRename: (projectId: ProjectId) => void;
  onCommitName: (projectId: ProjectId, name: string) => void;
  onExitRename: () => void;
  onCycleColor: (projectId: ProjectId) => void;
}) {
  const lastTask = group.tasks[group.tasks.length - 1] ?? null;
  const rowId = projectRowId(group.project.id);

  return (
    <div
      onClick={() => onSelect(rowId)}
      onDoubleClick={() => onStartRename(group.project.id)}
      className={[
        "group relative sticky top-0 z-10 mb-1 mt-5 flex cursor-default select-none items-center gap-2 rounded-sm border-y bg-bg px-1.5 py-2",
        selected ? "bg-surface-2" : "hover:bg-surface-2/60",
      ].join(" ")}
      style={{ borderTopColor: group.project.color }}
    >
      {focused && (
        <span className="absolute left-0 top-[7px] bottom-[7px] w-[2px] bg-accent" />
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.currentTarget.blur();
          onCycleColor(group.project.id);
        }}
        className="h-3 w-3 shrink-0 rounded-full border border-line-strong"
        style={{ backgroundColor: group.project.color }}
        aria-label={`Cycle color for ${group.project.name}`}
      />
      {editing ? (
        <ProjectNameInput
          project={group.project}
          onCommit={onCommitName}
          onExit={onExitRename}
        />
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (focused) onStartRename(group.project.id);
            else onSelect(rowId);
          }}
          className="min-w-0 flex-1 truncate bg-transparent text-left font-serif text-[16px] font-medium leading-tight tracking-tight text-ink"
        >
          {group.project.name}
        </button>
      )}
      <span className="mono shrink-0 text-[11px] text-ink-faint">
        {group.tasks.length}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.currentTarget.blur();
          onAddTask(group.project.id, lastTask?.id ?? null);
        }}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-sm border border-line text-[16px] leading-none text-ink-soft hover:border-line-strong hover:text-ink"
        aria-label={`Add task to ${group.project.name}`}
      >
        +
      </button>
    </div>
  );
}

function ProjectNameInput({
  project,
  onCommit,
  onExit,
}: {
  project: Project;
  onCommit: (projectId: ProjectId, name: string) => void;
  onExit: () => void;
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
        }
      }}
      className="min-w-0 flex-1 bg-transparent font-serif text-[16px] font-medium leading-tight tracking-tight text-ink outline-none"
    />
  );
}

export function OutlineView({
  view,
  today,
  groups,
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
  onStartRenameProject,
  onCommitProjectName,
  onExitProjectName,
  onCycleProjectColor,
}: {
  view: ViewKind;
  today: ISODate;
  groups: ProjectTaskGroup[];
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
  onStartRenameProject: (projectId: ProjectId) => void;
  onCommitProjectName: (projectId: ProjectId, name: string) => void;
  onExitProjectName: () => void;
  onCycleProjectColor: (projectId: ProjectId) => void;
}) {
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-10 py-8">
      <header className="mb-5 border-b border-line pb-4">
        {view === "today" && (
          <div className="eyebrow mb-1.5">{formatLong(today)}</div>
        )}
        <h1 className="font-serif text-[32px] font-medium leading-none tracking-tight text-ink">
          {TITLES[view]}
        </h1>
        <p className="mt-2 text-[14px] text-ink-soft">
          <Subtitle view={view} progress={progress} />
        </p>
      </header>

      <div className="mb-4">
        <CaptureBar
          inputRef={captureRef}
          placeholder={PLACEHOLDERS[view]}
          onAdd={onAdd}
          onArrowDown={onCaptureArrowDown}
        />
      </div>

      <div className="mb-2 flex justify-end">
        <button
          type="button"
          onClick={onAddProject}
          className="rounded-sm border border-line px-2.5 py-1 text-[12px] text-ink-soft hover:border-line-strong hover:text-ink"
        >
          + Project
        </button>
      </div>

      {view === "today" && progress.total > 0 && progress.remaining === 0 && (
        <div className="mb-4">
          <InboxZero total={progress.total} />
        </div>
      )}

      <div className="-mx-2 flex-1 overflow-auto">
        {groups.length === 0 ? (
          <EmptyState view={view} />
        ) : (
          groups.map((group) => (
            <section key={group.project.id} className="px-2">
              <ProjectDivider
                group={group}
                focused={focusedId === projectRowId(group.project.id)}
                selected={selectedIds.includes(projectRowId(group.project.id))}
                editing={editingProjectId === group.project.id}
                onAddTask={onAddToProject}
                onSelect={onSelectRow}
                onStartRename={onStartRenameProject}
                onCommitName={onCommitProjectName}
                onExitRename={onExitProjectName}
                onCycleColor={onCycleProjectColor}
              />
              {group.tasks.length === 0 ? (
                <div className="px-1 pb-2 pt-1 text-[12px] text-ink-faint">
                  No tasks here.
                </div>
              ) : (
                group.tasks.map((t) => <TaskRow key={t.id} task={t} depth={0} />)
              )}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
