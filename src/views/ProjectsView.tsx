import type { OutlineId, ProjectId } from "../types";
import { projectRowId } from "../types";
import type { ProjectSummary } from "../selectors";
import { ProjectNameInput } from "./OutlineView";

function ChevronRight() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
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

function ProjectRow({
  summary,
  focused,
  selected,
  editing,
  onSelect,
  onOpen,
  onCycleColor,
  onStartRename,
  onCommitName,
  onExitRename,
  onArrowName,
}: {
  summary: ProjectSummary;
  focused: boolean;
  selected: boolean;
  editing: boolean;
  onSelect: (id: OutlineId) => void;
  onOpen: (projectId: ProjectId) => void;
  onCycleColor: (projectId: ProjectId) => void;
  onStartRename: (projectId: ProjectId) => void;
  onCommitName: (projectId: ProjectId, name: string) => void;
  onExitRename: () => void;
  onArrowName: (projectId: ProjectId, name: string, dir: "up" | "down") => void;
}) {
  const { project, open, today, done } = summary;
  const rowId = projectRowId(project.id);
  const active = focused || selected;

  return (
    <div
      onClick={() => onSelect(rowId)}
      onDoubleClick={() => onStartRename(project.id)}
      className={[
        "group relative flex cursor-default select-none items-center gap-3 rounded-sm px-2.5 py-2.5",
        active ? "bg-surface-2" : "hover:bg-surface-2/60",
      ].join(" ")}
    >
      {focused && (
        <span className="absolute left-0 top-2 bottom-2 w-[2px] bg-accent" />
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.currentTarget.blur();
          onCycleColor(project.id);
        }}
        className="h-3 w-3 shrink-0 rounded-full ring-1 ring-inset ring-black/10 transition-transform hover:scale-110"
        style={{ backgroundColor: project.color }}
        aria-label={`Cycle color for ${project.name}`}
      />

      {editing ? (
        <div className="min-w-0 flex-1">
          <ProjectNameInput
            project={project}
            onCommit={onCommitName}
            onExit={onExitRename}
            onArrow={onArrowName}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (focused) onStartRename(project.id);
            else onSelect(rowId);
          }}
          className={[
            "min-w-0 flex-1 truncate bg-transparent text-left font-serif text-[16px] font-medium tracking-tight transition-colors",
            active ? "text-ink" : "text-ink group-hover:text-ink",
          ].join(" ")}
        >
          {project.name}
        </button>
      )}

      <span className="mono shrink-0 text-[11px] text-ink-faint">
        <span className={open > 0 ? "text-ink-soft" : ""}>{open} open</span>
        {today > 0 && <span className="text-accent"> · {today} today</span>}
        {done > 0 && <span> · {done} done</span>}
      </span>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.currentTarget.blur();
          onOpen(project.id);
        }}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-sm text-ink-faint transition-colors hover:text-ink"
        aria-label={`Open ${project.name}`}
        title="Open project (→)"
      >
        <ChevronRight />
      </button>
    </div>
  );
}

export function ProjectsView({
  summaries,
  focusedId,
  selectedIds,
  editingProjectId,
  onSelectRow,
  onOpenProject,
  onAddProject,
  onCycleProjectColor,
  onStartRenameProject,
  onCommitProjectName,
  onExitProjectName,
  onArrowProjectName,
}: {
  summaries: ProjectSummary[];
  focusedId: OutlineId | null;
  selectedIds: OutlineId[];
  editingProjectId: ProjectId | null;
  onSelectRow: (id: OutlineId) => void;
  onOpenProject: (projectId: ProjectId) => void;
  onAddProject: () => void;
  onCycleProjectColor: (projectId: ProjectId) => void;
  onStartRenameProject: (projectId: ProjectId) => void;
  onCommitProjectName: (projectId: ProjectId, name: string) => void;
  onExitProjectName: () => void;
  onArrowProjectName: (projectId: ProjectId, name: string, dir: "up" | "down") => void;
}) {
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-10 py-8">
      <header className="mb-5 flex items-end justify-between gap-3 border-b border-line pb-4">
        <div>
          <h1 className="font-serif text-[32px] font-medium leading-none tracking-tight text-ink">
            Projects
          </h1>
          <p className="mt-2 text-[14px] text-ink-soft">
            Open one to see and add its tasks. Every task also lives in All.
          </p>
        </div>
        <button
          type="button"
          onClick={onAddProject}
          className="shrink-0 rounded-sm border border-line px-2.5 py-1 text-[12px] text-ink-soft hover:border-line-strong hover:text-ink"
        >
          + Project
        </button>
      </header>

      <div className="-mx-2 flex-1 overflow-auto">
        {summaries.map((summary) => (
          <ProjectRow
            key={summary.project.id}
            summary={summary}
            focused={focusedId === projectRowId(summary.project.id)}
            selected={selectedIds.includes(projectRowId(summary.project.id))}
            editing={editingProjectId === summary.project.id}
            onSelect={onSelectRow}
            onOpen={onOpenProject}
            onCycleColor={onCycleProjectColor}
            onStartRename={onStartRenameProject}
            onCommitName={onCommitProjectName}
            onExitRename={onExitProjectName}
            onArrowName={onArrowProjectName}
          />
        ))}
      </div>
    </div>
  );
}
