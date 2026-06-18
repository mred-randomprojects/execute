import { useEffect, useMemo, useRef, useState } from "react";
import type { OutlineId, ProjectId, TaskId, TaskPriority, ThemeName } from "./types";
import {
  DEFAULT_PROJECT_ID,
  isProjectRowId,
  projectIdFromRowId,
  projectRowId,
} from "./types";
import {
  addChild,
  addTaskAfter,
  addTaskAtProjectStart,
  createProject,
  cycleProjectColor,
  emptyTrash,
  indent,
  initStore,
  logBreakdown,
  markOpened,
  moveAsChild,
  moveBefore,
  outdent,
  postponeToBacklog,
  purgeFromTrash,
  renameProject,
  reorderAcrossProjects,
  restoreFromTrash,
  setCompleted,
  setCompletedMany,
  setDevDateOverride,
  setNotes,
  setPlannedFor,
  setPlannedForMany,
  setProjectForMany,
  setPriority,
  setText,
  setTheme,
  toggleComplete,
  trashMany,
  trashTask,
  undo,
  useStore,
} from "./store/store";
import { findById, findParentId } from "./store/tasks";
import { todayISO } from "./store/dates";
import { parseCapture } from "./store/capture";
import {
  backlogCount,
  flattenRows,
  groupTasksByProject,
  leftoverLeaves,
  todayProgress,
  viewTasks,
  type ViewKind,
} from "./selectors";
import {
  emptySelection,
  moveSelection,
  selectAfterRemoving,
  selectOne,
  type Selection,
} from "./ui/selection";
import { keymap } from "./keyboard/keymap";
import { useKeyboard } from "./keyboard/useKeyboard";
import type { AppMode, ContextState } from "./keyboard/types";
import { EditorProvider, type Editor } from "./ui/editor";
import { Sidebar } from "./components/Sidebar";
import { OutlineView } from "./views/OutlineView";
import { ReckoningView } from "./views/ReckoningView";
import { TrashView } from "./views/TrashView";
import { DetailPanel, type DetailHandlers } from "./components/DetailPanel";
import { HelpOverlay } from "./components/HelpOverlay";
import { DevControls } from "./components/DevControls";
import { StatusBar } from "./components/StatusBar";
import { CommandPalette, type Command } from "./components/CommandPalette";

const THEMES: ThemeName[] = ["slate", "ivory", "carbon", "bordeaux"];

interface OutlineProjectRow {
  kind: "project";
  id: OutlineId;
  projectId: ProjectId;
}

interface OutlineTaskRow {
  kind: "task";
  id: OutlineId;
  taskId: TaskId;
}

type OutlineRow = OutlineProjectRow | OutlineTaskRow;

export function App() {
  const { state, ready } = useStore();
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const today = todayISO(state.devDateOverride);

  // ── UI state ──────────────────────────────────────────────────────
  const [view, setView] = useState<ViewKind>("today");
  const [selection, setSelection] = useState<Selection>(emptySelection);
  const [editingId, setEditingId] = useState<TaskId | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<ProjectId | null>(null);
  const [collapsed, setCollapsed] = useState<Set<TaskId>>(new Set());
  const [mode, setMode] = useState<AppMode>("normal");
  const [movingId, setMovingId] = useState<TaskId | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [reckCursorId, setReckCursorId] = useState<TaskId | null>(null);
  const [breakingDownId, setBreakingDownId] = useState<TaskId | null>(null);
  const [reckReason, setReckReason] = useState("");

  const captureRef = useRef<HTMLInputElement>(null);
  const focusedId = selection.focusedId;
  const focusedTaskId =
    focusedId != null && !isProjectRowId(focusedId) ? focusedId : null;

  useEffect(() => {
    void initStore();
  }, []);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", state.theme);
  }, [state.theme]);
  useEffect(() => {
    if (ready) markOpened(today);
  }, [ready, today]);

  // ── Reckoning (the hard gate) ─────────────────────────────────────
  const leftovers = useMemo(
    () => leftoverLeaves(state.tasks, today),
    [state.tasks, today]
  );
  const reckoningActive = ready && leftovers.length > 0;
  const breakdownTask =
    breakingDownId != null ? findById(state.tasks, breakingDownId) ?? null : null;
  const leftoverKey = leftovers.map((t) => t.id).join(",");

  useEffect(() => {
    if (!reckoningActive) {
      if (reckCursorId !== null) setReckCursorId(null);
      return;
    }
    const ids = leftovers.map((t) => t.id);
    if (reckCursorId === null || !ids.includes(reckCursorId)) setReckCursorId(ids[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftoverKey, reckoningActive]);
  useEffect(() => setReckReason(""), [reckCursorId]);
  useEffect(() => {
    if (breakingDownId != null && findById(state.tasks, breakingDownId) == null) {
      setBreakingDownId(null);
    }
  }, [state.tasks, breakingDownId]);

  // ── Derived (outline) ─────────────────────────────────────────────
  const filtered = useMemo(
    () => viewTasks(state.tasks, view, today),
    [state.tasks, view, today]
  );
  const projectGroups = useMemo(
    () => groupTasksByProject(filtered, state.projects),
    [filtered, state.projects]
  );
  const outlineRows = useMemo<OutlineRow[]>(
    () =>
      projectGroups.flatMap((group) => [
        {
          kind: "project" as const,
          id: projectRowId(group.project.id),
          projectId: group.project.id,
        },
        ...flattenRows(group.tasks, collapsed).map((row) => ({
          kind: "task" as const,
          id: row.task.id,
          taskId: row.task.id,
        })),
      ]),
    [projectGroups, collapsed]
  );
  const flatIds = useMemo(() => outlineRows.map((r) => r.id), [outlineRows]);
  const flatKey = flatIds.join(",");

  const progress = useMemo(() => todayProgress(state.tasks, today), [state.tasks, today]);
  const backlog = useMemo(() => backlogCount(state.tasks), [state.tasks]);
  const focusedTask =
    focusedTaskId != null ? findById(state.tasks, focusedTaskId) ?? null : null;
  const focusedProjectId =
    focusedId != null && isProjectRowId(focusedId)
      ? projectIdFromRowId(focusedId)
      : null;
  const currentProjectId = focusedProjectId ?? focusedTask?.projectId ?? null;
  const selectedTaskIds = selection.selectedIds.filter(
    (id): id is TaskId => !isProjectRowId(id)
  );

  useEffect(() => {
    setSelection((s) =>
      flatIds.length === 0
        ? emptySelection
        : s.focusedId != null && flatIds.includes(s.focusedId)
          ? s
          : selectOne(s.focusedId, flatIds)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatKey]);
  useEffect(() => {
    if (editingId !== null && !flatIds.includes(editingId)) setEditingId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatKey]);
  useEffect(() => {
    if (
      editingProjectId !== null &&
      !state.projects.some((project) => project.id === editingProjectId)
    ) {
      setEditingProjectId(null);
    }
  }, [editingProjectId, state.projects]);

  const didInitialFocus = useRef(false);
  useEffect(() => {
    if (ready && !didInitialFocus.current && state.tasks.length === 0) {
      didInitialFocus.current = true;
      captureRef.current?.focus();
    }
  }, [ready, state.tasks.length]);

  // ── Helpers ───────────────────────────────────────────────────────
  const defaultPlannedFor = () => (view === "today" ? today : null);
  const setFocus = (id: OutlineId | null) =>
    setSelection(
      id == null ? emptySelection : { focusedId: id, anchorId: id, selectedIds: [id] }
    );

  const startEditingOutlineId = (id: OutlineId) => {
    setFocus(id);
    if (isProjectRowId(id)) {
      setEditingId(null);
      setEditingProjectId(projectIdFromRowId(id));
      return;
    }
    setEditingProjectId(null);
    setEditingId(id);
  };

  const toggleCollapsedFor = (id: TaskId) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exitMove = () => {
    setMode("normal");
    setMovingId(null);
  };

  const planToggle = (id: TaskId) => {
    const t = findById(state.tasks, id);
    setPlannedFor(id, t?.plannedFor === today ? null : today);
  };

  const commitText = (id: TaskId, raw: string) => {
    const p = parseCapture(raw);
    setText(id, p.text);
    if (p.completed) setCompleted(id, true);
  };

  const trashWithNeighbor = (id: TaskId) => {
    const next = selectAfterRemoving(selection, flatIds, new Set([id]));
    trashTask(id);
    setSelection(next);
  };

  const openPanel = () => {
    if (focusedTaskId != null) setShowPanel(true);
  };
  const openDetailFor = (id: TaskId) => {
    setFocus(id);
    setShowPanel(true);
  };

  const actionTargets = (): TaskId[] =>
    selectedTaskIds.length > 0
      ? selectedTaskIds
      : focusedTaskId != null
        ? [focusedTaskId]
        : [];

  // ── Commands ──────────────────────────────────────────────────────
  const moveReckCursor = (dir: "up" | "down") => {
    const ids = leftovers.map((t) => t.id);
    if (ids.length === 0) return;
    const i = reckCursorId == null ? -1 : ids.indexOf(reckCursorId);
    const next = i < 0 ? 0 : Math.min(Math.max(i + (dir === "down" ? 1 : -1), 0), ids.length - 1);
    setReckCursorId(ids[next]);
  };

  const cmd = {
    cursorDown: () => {
      if (reckoningActive) return moveReckCursor("down");
      if (
        focusedProjectId != null &&
        focusedId != null &&
        flatIds.indexOf(focusedId) === flatIds.length - 1
      ) {
        const newId = addTaskAtProjectStart(
          focusedProjectId,
          "",
          defaultPlannedFor()
        );
        setFocus(newId);
        setEditingProjectId(null);
        setEditingId(newId);
        return;
      }
      setSelection((s) => moveSelection(s, flatIds, "down", false));
    },
    cursorUp: () => {
      if (reckoningActive) return moveReckCursor("up");
      const i = focusedId == null ? -1 : flatIds.indexOf(focusedId);
      if (i <= 0) {
        captureRef.current?.focus(); // at the top → jump up to the capture bar
        return;
      }
      setSelection((s) => moveSelection(s, flatIds, "up", false));
    },
    selectDown: () => setSelection((s) => moveSelection(s, flatIds, "down", true)),
    selectUp: () => setSelection((s) => moveSelection(s, flatIds, "up", true)),
    reorderUp: () => reorderAcrossProjects(actionTargets(), "up"),
    reorderDown: () => reorderAcrossProjects(actionTargets(), "down"),
    // → expands a collapsed task first (outliner convention); only opens the
    // details panel when there's nothing to expand.
    panelOpen: () => {
      if (focusedTaskId != null) {
        const t = findById(filtered, focusedTaskId);
        if (t != null && t.children.length > 0 && collapsed.has(focusedTaskId)) {
          toggleCollapsedFor(focusedTaskId);
          return;
        }
      }
      openPanel();
    },
    // ← closes the panel, else collapses an expanded task, else jumps to parent.
    panelBack: () => {
      if (showPanel) {
        setShowPanel(false);
        return;
      }
      if (focusedTaskId == null) return;
      const t = findById(filtered, focusedTaskId);
      if (t != null && t.children.length > 0 && !collapsed.has(focusedTaskId)) {
        toggleCollapsedFor(focusedTaskId);
        return;
      }
      const parent = findParentId(filtered, focusedTaskId);
      if (parent != null) setFocus(parent);
    },
    editStart: () => {
      if (focusedId != null) startEditingOutlineId(focusedId);
    },
    taskNew: () => {
      if (focusedProjectId != null) {
        const newId = addTaskAtProjectStart(
          focusedProjectId,
          "",
          defaultPlannedFor()
        );
        setFocus(newId);
        setEditingProjectId(null);
        setEditingId(newId);
        return;
      }
      const newId = addTaskAfter(focusedTaskId, "", defaultPlannedFor());
      setFocus(newId);
      setEditingProjectId(null);
      setEditingId(newId);
    },
    taskToggle: () => {
      const ids = actionTargets();
      if (ids.length === 0) return;
      if (ids.length === 1) return toggleComplete(ids[0]);
      const allDone = ids.every((id) => findById(state.tasks, id)?.completed);
      setCompletedMany(ids, !allDone);
    },
    taskPlanToday: () => {
      const ids = actionTargets();
      if (ids.length === 0) return;
      if (ids.length === 1) return planToggle(ids[0]);
      const allPlanned = ids.every((id) => findById(state.tasks, id)?.plannedFor === today);
      setPlannedForMany(ids, allPlanned ? null : today);
    },
    taskIndent: () => {
      if (focusedTaskId != null) indent(focusedTaskId);
    },
    taskOutdent: () => {
      if (focusedTaskId != null) outdent(focusedTaskId);
    },
    taskTrash: () => {
      const ids = actionTargets();
      if (ids.length === 0) return;
      const next = selectAfterRemoving(selection, flatIds, new Set(ids));
      if (ids.length === 1) trashTask(ids[0]);
      else trashMany(ids);
      setSelection(next);
    },
    taskCollapse: () => {
      if (focusedTaskId == null) return;
      const t = findById(filtered, focusedTaskId);
      if (t != null && t.children.length > 0) toggleCollapsedFor(focusedTaskId);
    },
    moveEnter: () => {
      if (focusedTaskId != null) {
        setMovingId(focusedTaskId);
        setMode("move");
      }
    },
    moveDropSibling: () => {
      if (movingId != null && focusedTaskId != null) moveBefore(movingId, focusedTaskId);
      else if (movingId != null && focusedProjectId != null) {
        setProjectForMany([movingId], focusedProjectId);
      }
      exitMove();
    },
    moveDropChild: () => {
      if (movingId != null && focusedTaskId != null) moveAsChild(movingId, focusedTaskId);
      else if (movingId != null && focusedProjectId != null) {
        setProjectForMany([movingId], focusedProjectId);
      }
      exitMove();
    },
    captureFocus: () => captureRef.current?.focus(),
    helpToggle: () => setShowHelp((v) => !v),
    paletteOpen: () => setShowPalette(true),
    gotoView: (v: ViewKind) => () => setView(v),
    dismiss: () => {
      if (showHelp) setShowHelp(false);
      else if (showPalette) setShowPalette(false);
      else if (mode === "move") exitMove();
      else if (editingProjectId != null) setEditingProjectId(null);
      else if (editingId != null) setEditingId(null);
      else if (showPanel) setShowPanel(false);
    },
    reckComplete: (id?: TaskId) => {
      const target = id ?? reckCursorId;
      if (target != null) setCompleted(target, true, reckReason || null);
    },
    reckBacklog: (id?: TaskId) => {
      const target = id ?? reckCursorId;
      if (target != null) postponeToBacklog(target, reckReason || null);
    },
    reckDrop: (id?: TaskId) => {
      const target = id ?? reckCursorId;
      if (target != null) trashTask(target, { reason: reckReason || null, log: true });
    },
    reckBreakdown: (id?: TaskId) => {
      const target = id ?? reckCursorId;
      if (target != null) setBreakingDownId(target);
    },
  };

  // ── Keyboard wiring ───────────────────────────────────────────────
  const dispatchState: ContextState = { showHelp, showPalette, reckoningActive, mode };
  const actionMap: Record<string, () => void> = {
    "cursor.down": cmd.cursorDown,
    "cursor.up": cmd.cursorUp,
    "select.down": cmd.selectDown,
    "select.up": cmd.selectUp,
    "reorder.down": cmd.reorderDown,
    "reorder.up": cmd.reorderUp,
    "panel.open": cmd.panelOpen,
    "panel.back": cmd.panelBack,
    "edit.start": cmd.editStart,
    "task.new": cmd.taskNew,
    "task.toggle": cmd.taskToggle,
    "task.planToday": cmd.taskPlanToday,
    "task.indent": cmd.taskIndent,
    "task.outdent": cmd.taskOutdent,
    "task.trash": cmd.taskTrash,
    "task.collapse": cmd.taskCollapse,
    "move.enter": cmd.moveEnter,
    "move.dropSibling": cmd.moveDropSibling,
    "move.dropChild": cmd.moveDropChild,
    "move.cancel": cmd.dismiss,
    "capture.focus": cmd.captureFocus,
    "undo": undo,
    "help.toggle": cmd.helpToggle,
    "palette.open": cmd.paletteOpen,
    "view.today": cmd.gotoView("today"),
    "view.backlog": cmd.gotoView("backlog"),
    "view.all": cmd.gotoView("all"),
    "view.trash": cmd.gotoView("trash"),
    "dismiss": cmd.dismiss,
    "reck.complete": cmd.reckComplete,
    "reck.breakdown": cmd.reckBreakdown,
    "reck.backlog": cmd.reckBacklog,
    "reck.drop": cmd.reckDrop,
  };
  useKeyboard(keymap, actionMap, dispatchState);

  // ── Editor surface for rows ───────────────────────────────────────
  const editor: Editor = {
    view,
    today,
    cursorId: focusedTaskId,
    selectedIds: selectedTaskIds,
    editingId,
    collapsed,
    mode,
    movingId,
    select: setFocus,
    toggle: toggleComplete,
    togglePlan: planToggle,
    toggleCollapse: toggleCollapsedFor,
    openDetail: openDetailFor,
    startEdit: (id) => {
      setFocus(id);
      setEditingProjectId(null);
      setEditingId(id);
    },
    commit: commitText,
    commitAndNew: (id, raw) => {
      const p = parseCapture(raw);
      if (p.text === "") {
        trashWithNeighbor(id);
        setEditingProjectId(null);
        setEditingId(null);
        return;
      }
      setText(id, p.text);
      if (p.completed) setCompleted(id, true);
      const t = findById(state.tasks, id);
      const newId = addTaskAfter(id, "", t?.plannedFor ?? null);
      setFocus(newId);
      setEditingProjectId(null);
      setEditingId(newId);
    },
    indentEditing: (id, raw) => {
      commitText(id, raw);
      indent(id);
    },
    outdentEditing: (id, raw) => {
      commitText(id, raw);
      outdent(id);
    },
    editPrev: (id, raw) => {
      commitText(id, raw);
      const i = flatIds.indexOf(id);
      const prev = flatIds[i - 1];
      if (prev != null) {
        startEditingOutlineId(prev);
      } else {
        setEditingId(null);
        setEditingProjectId(null);
        captureRef.current?.focus(); // top of list → up into the capture bar
      }
    },
    editNext: (id, raw) => {
      commitText(id, raw);
      const i = flatIds.indexOf(id);
      const next = flatIds[i + 1];
      if (next != null) {
        startEditingOutlineId(next);
      }
    },
    toggleFromEdit: (id, raw) => {
      commitText(id, raw);
      toggleComplete(id);
    },
    exitEdit: (id, raw) => {
      commitText(id, raw);
      setEditingProjectId(null);
      setEditingId(null);
    },
    removeAndExit: (id) => {
      trashWithNeighbor(id);
      setEditingProjectId(null);
      setEditingId(null);
    },
  };

  // ── Detail panel handlers (content only) ──────────────────────────
  const detailHandlers: DetailHandlers = {
    onCommitNotes: (id, text) => setNotes(id, text),
    onToggle: (id) => toggleComplete(id),
    onPriority: (id, p: TaskPriority) => setPriority(id, p),
    onProject: (id, projectId) => setProjectForMany([id], projectId),
    onTogglePlan: (id) => planToggle(id),
    onBack: () => {
      setShowPanel(false);
      (document.activeElement as HTMLElement | null)?.blur();
    },
  };

  const commitProjectName = (projectId: ProjectId, name: string) => {
    renameProject(projectId, name);
    setEditingProjectId(null);
  };

  const onCapture = (raw: string) => {
    const p = parseCapture(raw);
    if (p.text === "") return;
    const projectId = currentProjectId ?? DEFAULT_PROJECT_ID;
    const id = addTaskAfter(null, p.text, defaultPlannedFor(), projectId);
    if (p.completed) setCompleted(id, true);
    setFocus(id);
  };

  const projectNameFromCommand = (query: string): string => {
    const trimmed = query.trim();
    const lower = trimmed.toLowerCase();
    const prefixes = ["new project", "create project", "project"];
    for (const prefix of prefixes) {
      if (lower === prefix) return "New project";
      if (lower.startsWith(`${prefix} `)) return trimmed.slice(prefix.length).trim();
    }
    return "New project";
  };

  const renameProjectNameFromCommand = (query: string): string | null => {
    const trimmed = query.trim();
    const lower = trimmed.toLowerCase();
    const prefixes = ["rename project", "project rename"];
    for (const prefix of prefixes) {
      if (lower.startsWith(`${prefix} `)) return trimmed.slice(prefix.length).trim();
    }
    return null;
  };

  const createProjectAndFirstTask = (name: string) => {
    const projectId = createProject(name.trim() || "New project");
    const targetView = view === "trash" ? "backlog" : view;
    const plannedFor = targetView === "today" ? today : null;
    if (view === "trash") setView("backlog");
    const id = addTaskAtProjectStart(projectId, "", plannedFor);
    setFocus(id);
    setEditingProjectId(null);
    setEditingId(id);
  };

  const addTaskToProject = (projectId: ProjectId, afterId: TaskId | null) => {
    const id =
      afterId == null
        ? addTaskAtProjectStart(projectId, "", defaultPlannedFor())
        : addTaskAfter(afterId, "", defaultPlannedFor(), projectId);
    setFocus(id);
    setEditingProjectId(null);
    setEditingId(id);
  };

  const cycleTheme = () => {
    const i = THEMES.indexOf(state.theme);
    setTheme(THEMES[(i + 1) % THEMES.length]);
  };

  const commands: Command[] = [
    { id: "today", label: "Go to Today", hint: "1", run: () => setView("today") },
    { id: "backlog", label: "Go to Backlog", hint: "2", run: () => setView("backlog") },
    { id: "all", label: "Go to All", hint: "3", run: () => setView("all") },
    { id: "trash", label: "Go to Trash", hint: "4", run: () => setView("trash") },
    { id: "new", label: "New task", hint: "o", run: cmd.taskNew },
    { id: "details", label: "Open details panel", hint: "→", run: openPanel },
    { id: "toggle", label: "Complete / uncomplete task", hint: "space", run: cmd.taskToggle },
    { id: "plan", label: "Plan / unplan for today", hint: "t", run: cmd.taskPlanToday },
    { id: "move", label: "Move task (re-parent)", hint: "m", run: cmd.moveEnter },
    {
      id: "project-new",
      label: "New project",
      aliases: ["new project", "create project", "project"],
      hint: "name",
      run: (query) => createProjectAndFirstTask(projectNameFromCommand(query)),
    },
    {
      id: "project-rename-current",
      label: "Rename current project",
      aliases: ["rename project", "project rename"],
      hint: "name",
      run: (query) => {
        if (currentProjectId == null) return;
        const name = renameProjectNameFromCommand(query);
        if (name != null && name.trim() !== "") renameProject(currentProjectId, name);
      },
    },
    {
      id: "project-color-current",
      label: "Cycle current project color",
      aliases: ["cycle project color", "project color"],
      run: () => {
        if (currentProjectId != null) cycleProjectColor(currentProjectId);
      },
    },
    ...state.projects.map((project) => ({
      id: `project-set-${project.id}`,
      label: `Set project: ${project.name}`,
      run: () => {
        const ids = actionTargets();
        if (ids.length > 0) setProjectForMany(ids, project.id);
      },
    })),
    { id: "p1", label: "Priority: Urgent", run: () => focusedTaskId && setPriority(focusedTaskId, 1) },
    { id: "p2", label: "Priority: High", run: () => focusedTaskId && setPriority(focusedTaskId, 2) },
    { id: "p3", label: "Priority: Medium", run: () => focusedTaskId && setPriority(focusedTaskId, 3) },
    { id: "p4", label: "Priority: None", run: () => focusedTaskId && setPriority(focusedTaskId, 4) },
    { id: "undo", label: "Undo", hint: "⌘z", run: undo },
    { id: "help", label: "Keyboard help", hint: "?", run: () => setShowHelp(true) },
    { id: "theme-slate", label: "Theme: Slate", run: () => setTheme("slate") },
    { id: "theme-ivory", label: "Theme: Ivory", run: () => setTheme("ivory") },
    { id: "theme-carbon", label: "Theme: Carbon", run: () => setTheme("carbon") },
    { id: "theme-bordeaux", label: "Theme: Bordeaux", run: () => setTheme("bordeaux") },
  ];

  if (!ready) {
    return <div className="grid h-full place-items-center bg-bg text-ink-faint" />;
  }

  const panelTaskLog =
    focusedTask != null ? state.log.filter((l) => l.taskId === focusedTask.id) : [];
  const panelOpen = showPanel && focusedTask != null && !reckoningActive && view !== "trash";

  return (
    <div className="relative flex h-full overflow-hidden bg-bg text-ink">
      <div className="drag-region absolute inset-x-0 top-0 z-20 h-7" />

      <Sidebar
        view={view}
        todayRemaining={progress.remaining}
        backlog={backlog}
        trash={state.trash.length}
        onSelect={setView}
        onOpenHelp={() => setShowHelp(true)}
        onCycleTheme={cycleTheme}
      >
        {import.meta.env.DEV && (
          <DevControls today={today} override={state.devDateOverride} onSet={setDevDateOverride} />
        )}
      </Sidebar>

      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 overflow-hidden">
            {reckoningActive ? (
              <ReckoningView
                leftovers={leftovers}
                cursorId={reckCursorId}
                today={today}
                breakdownTask={breakdownTask}
                reason={reckReason}
                onReasonChange={setReckReason}
                onSelect={setReckCursorId}
                onComplete={cmd.reckComplete}
                onBacklog={cmd.reckBacklog}
                onDrop={cmd.reckDrop}
                onStartBreakdown={(id) => setBreakingDownId(id)}
                onAddStep={(parentId, text) => addChild(parentId, parseCapture(text).text, today)}
                onFinishBreakdown={() => {
                  if (breakingDownId != null) logBreakdown(breakingDownId);
                  setBreakingDownId(null);
                }}
              />
            ) : view === "trash" ? (
              <TrashView
                trash={state.trash}
                onRestore={restoreFromTrash}
                onPurge={purgeFromTrash}
                onEmpty={emptyTrash}
              />
            ) : (
              <EditorProvider value={editor}>
                <OutlineView
                  view={view}
                  today={today}
                  groups={projectGroups}
                  focusedId={focusedId}
                  selectedIds={selection.selectedIds}
                  editingProjectId={editingProjectId}
                  progress={progress}
                  captureRef={captureRef}
                  onAdd={onCapture}
                  onCaptureArrowDown={() => flatIds[0] != null && setFocus(flatIds[0])}
                  onAddProject={() => createProjectAndFirstTask("New project")}
                  onAddToProject={addTaskToProject}
                  onSelectRow={setFocus}
                  onStartRenameProject={(projectId) =>
                    startEditingOutlineId(projectRowId(projectId))
                  }
                  onCommitProjectName={commitProjectName}
                  onExitProjectName={() => setEditingProjectId(null)}
                  onCycleProjectColor={cycleProjectColor}
                />
              </EditorProvider>
            )}
          </div>

          {panelOpen && focusedTask != null && (
            <DetailPanel
              task={focusedTask}
              today={today}
              log={panelTaskLog}
              projects={state.projects}
              handlers={detailHandlers}
            />
          )}
        </div>
        <StatusBar reckoning={reckoningActive} />
      </main>

      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
      {showPalette && (
        <CommandPalette commands={commands} onClose={() => setShowPalette(false)} />
      )}
    </div>
  );
}
