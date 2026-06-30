import { useEffect, useMemo, useRef, useState } from "react";
import type { OutlineId, ProjectId, Task, TaskId, TaskPriority, ThemeName } from "./types";
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
  dropManyWithLog,
  initStore,
  keepForToday,
  logBreakdown,
  markOpened,
  moveAsChild,
  moveBefore,
  outdent,
  postponeManyToBacklog,
  postponeToBacklog,
  purgeFromTrash,
  renameProject,
  reorderAcrossProjects,
  restoreFromTrash,
  setCompleted,
  setCompletedMany,
  setDevDateOverride,
  setHorizonMany,
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
import { addDays, monthKey, monthKeyOffset, todayISO, weekKey, weekKeyOffset } from "./store/dates";
import { parseCapture } from "./store/capture";
import {
  backlogCount,
  filterTree,
  flattenRows,
  groupTasksByBucket,
  groupTasksByProject,
  leftoverLeaves,
  prevVisibleSiblingId,
  projectSummaries,
  reckoningCards,
  resolveZoom,
  suggestedForToday,
  taskBucket,
  todayProgress,
  viewTasks,
  VIEW_TITLES,
  zoomParent,
  type ReckoningCard,
  type ViewKind,
  type ZoomTarget,
} from "./selectors";
import {
  emptySelection,
  moveSelection,
  nearestSurvivor,
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
import { ProjectsView } from "./views/ProjectsView";
import { ReckoningView } from "./views/ReckoningView";
import { TrashView } from "./views/TrashView";
import { DetailPanel, type DetailHandlers } from "./components/DetailPanel";
import { HelpOverlay } from "./components/HelpOverlay";
import { DevControls } from "./components/DevControls";
import { StatusBar } from "./components/StatusBar";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { SchedulePicker, type ScheduleChoice } from "./components/SchedulePicker";
import { ConfirmModal, type ConfirmRequest } from "./components/ConfirmModal";

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
  const [collapsedProjects, setCollapsedProjects] = useState<Set<ProjectId>>(new Set());
  const [zoom, setZoom] = useState<ZoomTarget | null>(null);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [mode, setMode] = useState<AppMode>("normal");
  const [movingId, setMovingId] = useState<TaskId | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [laterLayout, setLaterLayout] = useState<"date" | "project">("date");
  const [showPanel, setShowPanel] = useState(false);
  // Bumped to ask an open detail panel to dive from preview into its notes editor
  // (Tab from the list). The panel reacts to changes only, so the value is opaque.
  const [editNotesSignal, setEditNotesSignal] = useState(0);
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
  // Same leftovers, grouped by top-level ancestor for the card-by-card review.
  const reckCards = useMemo(
    () => reckoningCards(state.tasks, today),
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
  // "Hide all completed" (toggle on `h`) prunes done tasks from the outline,
  // keeping a completed parent only when it still has a visible (incomplete)
  // descendant. Counts/progress read from state.tasks, so they stay accurate.
  const visibleTasks = useMemo(
    () => (hideCompleted ? filterTree(filtered, (t) => !t.completed) : filtered),
    [filtered, hideCompleted]
  );
  const projectGroups = useMemo(
    () => groupTasksByProject(visibleTasks, state.projects),
    [visibleTasks, state.projects]
  );
  // "Later" (the backlog view) can group by time horizon instead of by project.
  const usingBuckets = view === "backlog" && laterLayout === "date";
  const bucketGroups = useMemo(
    () => (usingBuckets ? groupTasksByBucket(visibleTasks, state.tasks, today) : []),
    [usingBuckets, visibleTasks, state.tasks, today]
  );
  // The Projects tab is a project index (list + edit details), not a task
  // outline — tasks live in All. Counts come straight from the full tree.
  const projectIndex = useMemo(
    () => projectSummaries(state.tasks, state.projects, today),
    [state.tasks, state.projects, today]
  );
  // Zoom (Workflowy-style hoist) overrides the project-grouped outline: when set,
  // the view shows only the focused subtree, with breadcrumbs back out.
  const zoomFocus = useMemo(() => {
    if (zoom == null) return null;
    const z = resolveZoom(state.tasks, state.projects, zoom, VIEW_TITLES[view]);
    if (z == null || !hideCompleted) return z;
    return { ...z, subtree: filterTree(z.subtree, (t) => !t.completed) };
  }, [zoom, state.tasks, state.projects, view, hideCompleted]);
  // Soft-horizon tasks the engine projects onto today — shown as a passive,
  // non-reckoning "Suggested for today" group at the foot of Today. They join the
  // outline flow so ↑/↓ reach them and `t` (accept) / `s` (reschedule) just work.
  const suggestedTasks = useMemo(
    () => (view === "today" && zoom == null ? suggestedForToday(state.tasks, today) : []),
    [view, zoom, state.tasks, today]
  );
  const outlineRows = useMemo<OutlineRow[]>(() => {
    if (zoomFocus != null) {
      return flattenRows(zoomFocus.subtree, collapsed).map((row) => ({
        kind: "task" as const,
        id: row.task.id,
        taskId: row.task.id,
      }));
    }
    if (view === "projects") {
      // The index navigates over project rows only — no task rows.
      return state.projects.map((project) => ({
        kind: "project" as const,
        id: projectRowId(project.id),
        projectId: project.id,
      }));
    }
    if (usingBuckets) {
      // By-date "Later": bucket headers aren't focusable; navigate the tasks.
      return bucketGroups.flatMap((group) =>
        flattenRows(group.tasks, collapsed).map((row) => ({
          kind: "task" as const,
          id: row.task.id,
          taskId: row.task.id,
        }))
      );
    }
    const rows = projectGroups.flatMap((group) => [
      {
        kind: "project" as const,
        id: projectRowId(group.project.id),
        projectId: group.project.id,
      },
      ...(collapsedProjects.has(group.project.id)
        ? []
        : flattenRows(group.tasks, collapsed).map((row) => ({
            kind: "task" as const,
            id: row.task.id,
            taskId: row.task.id,
          }))),
    ]);
    // Suggested-for-today rows trail the project groups, matching their render order.
    for (const t of suggestedTasks) {
      rows.push({ kind: "task" as const, id: t.id, taskId: t.id });
    }
    return rows;
  }, [zoomFocus, view, state.projects, projectGroups, usingBuckets, bucketGroups, collapsed, collapsedProjects, suggestedTasks]);
  const flatIds = useMemo(() => outlineRows.map((r) => r.id), [outlineRows]);
  const flatKey = flatIds.join(",");
  // The task ids the view actually renders — so structural edits (reorder) act on
  // visible siblings and skip filtered-out ones.
  const visibleTaskIds = useMemo(
    () =>
      new Set(
        outlineRows.flatMap((r) => (r.kind === "task" ? [r.taskId] : []))
      ),
    [outlineRows]
  );

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

  // When the visible set changes, keep the cursor sensible. If the focused row
  // left the view (planned away with `t`, rescheduled, completed+hidden…), land
  // on the nearest surviving neighbor — preferring the row above — instead of
  // snapping to the top. `prevFlatIdsRef` holds the order before this change.
  const prevFlatIdsRef = useRef<OutlineId[]>(flatIds);
  useEffect(() => {
    const prev = prevFlatIdsRef.current;
    prevFlatIdsRef.current = flatIds;
    setSelection((s) =>
      flatIds.length === 0
        ? emptySelection
        : s.focusedId != null && flatIds.includes(s.focusedId)
          ? s
          : selectOne(nearestSurvivor(prev, flatIds, s.focusedId), flatIds)
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
  // If the zoomed task/project is deleted out from under us, drop back to the view.
  useEffect(() => {
    if (zoom != null && zoomFocus == null) setZoom(null);
  }, [zoom, zoomFocus]);

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

  // ↑/↓ out of an inline edit: drop to normal mode and move focus one row, so
  // the rich navigation keys (panel, collapse, descend) work on the landing
  // row. The caller has already saved/discarded the row being left; `removed`
  // says whether that row is gone (so we don't try to land on it).
  const exitEditTo = (currentId: OutlineId, dir: "up" | "down", removed: boolean) => {
    const i = flatIds.indexOf(currentId);
    const prev = i > 0 ? flatIds[i - 1] : null;
    const next = i >= 0 && i + 1 < flatIds.length ? flatIds[i + 1] : null;
    setEditingProjectId(null);
    setEditingId(null);
    if (dir === "up") {
      if (prev != null) setFocus(prev);
      else captureRef.current?.focus(); // top of list → up into the capture bar
    } else if (next != null) {
      setFocus(next);
    } else if (removed) {
      if (prev != null) setFocus(prev); // last row discarded → fall back upward
    } else {
      setFocus(currentId); // last row → stay put, now in normal mode
    }
  };

  const toggleCollapsedFor = (id: TaskId) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const setProjectCollapsed = (projectId: ProjectId, value: boolean) =>
    setCollapsedProjects((prev) => {
      if (prev.has(projectId) === value) return prev;
      const next = new Set(prev);
      if (value) next.add(projectId);
      else next.delete(projectId);
      return next;
    });
  const toggleProjectCollapsed = (projectId: ProjectId) =>
    setProjectCollapsed(projectId, !collapsedProjects.has(projectId));

  const zoomInto = (target: ZoomTarget) => {
    setZoom(target);
    setShowPanel(false);
  };

  // In the Projects index there's no task list, so a new project just gets
  // created and dropped straight into rename mode.
  const createProjectInIndex = () => {
    const projectId = createProject("New project");
    setFocus(projectRowId(projectId));
    setEditingId(null);
    setEditingProjectId(projectId);
  };

  const exitMove = () => {
    setMode("normal");
    setMovingId(null);
  };

  const planToggle = (id: TaskId) => {
    const t = findById(state.tasks, id);
    setPlannedFor(id, t?.plannedFor === today ? null : today);
  };

  // Tab nests a task under the row visually above it — its previous *visible*
  // sibling in the current (filtered) view — never under a sibling the view is
  // hiding. So we resolve the parent from the displayed forest, not the raw tree.
  const indentInView = (id: TaskId) => {
    const groups: { tasks: Task[] }[] = usingBuckets ? bucketGroups : projectGroups;
    const forest =
      zoomFocus != null
        ? zoomFocus.subtree
        : groups.find((g) => findById(g.tasks, id) != null)?.tasks ?? [];
    const underId = prevVisibleSiblingId(forest, id);
    if (underId != null) indent(id, underId);
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

  // ── Scheduling (the `s` picker) ───────────────────────────────────
  const applySchedule = (choice: ScheduleChoice) => {
    const ids = actionTargets();
    if (ids.length === 0) return;
    if (typeof choice === "object") return setPlannedForMany(ids, choice.date);
    switch (choice) {
      case "today":
        return setPlannedForMany(ids, today);
      case "inbox":
        return setHorizonMany(ids, null);
      case "someday":
        return setHorizonMany(ids, { unit: "someday", anchor: null });
      case "thisWeek":
        return setHorizonMany(ids, { unit: "week", anchor: weekKey(today) });
      case "nextWeek":
        return setHorizonMany(ids, { unit: "week", anchor: weekKeyOffset(today, 1) });
      case "thisMonth":
        return setHorizonMany(ids, { unit: "month", anchor: monthKey(today) });
      case "nextMonth":
        return setHorizonMany(ids, { unit: "month", anchor: monthKeyOffset(today, 1) });
    }
  };
  // The picker's current-state dot: "today" / a horizon bucket / "inbox" (null = a specific date).
  const scheduleTag =
    focusedTask == null
      ? null
      : focusedTask.plannedFor === today
        ? "today"
        : focusedTask.plannedFor != null
          ? null
          : taskBucket(focusedTask, today);

  // ── Commands ──────────────────────────────────────────────────────
  const moveReckCursor = (dir: "up" | "down") => {
    const ids = leftovers.map((t) => t.id);
    if (ids.length === 0) return;
    const i = reckCursorId == null ? -1 : ids.indexOf(reckCursorId);
    const next = i < 0 ? 0 : Math.min(Math.max(i + (dir === "down" ? 1 : -1), 0), ids.length - 1);
    setReckCursorId(ids[next]);
  };

  // Resolving a leftover removes it; land the cursor on the next remaining one
  // (or the previous, if it was last) so the review flows forward on its own.
  const advanceReckCursorPast = (resolvedId: TaskId) => {
    const ids = leftovers.map((t) => t.id);
    const i = ids.indexOf(resolvedId);
    if (i === -1) return;
    setReckCursorId(ids[i + 1] ?? ids[i - 1] ?? null);
  };
  const advanceReckCursorPastCard = (card: ReckoningCard) => {
    const idx = reckCards.findIndex((c) => c.root.id === card.root.id);
    const nextCard = reckCards[idx + 1] ?? reckCards[idx - 1] ?? null;
    setReckCursorId(nextCard?.leaves[0]?.task.id ?? null);
  };
  const currentReckCard = (): ReckoningCard | null =>
    reckCards.find((c) => c.leaves.some((l) => l.task.id === reckCursorId)) ??
    reckCards[0] ??
    null;
  const moveReckCard = (dir: "prev" | "next") => {
    if (reckCards.length === 0) return;
    const idx = Math.max(
      0,
      reckCards.findIndex((c) => c.leaves.some((l) => l.task.id === reckCursorId))
    );
    const target = dir === "next" ? reckCards[idx + 1] : reckCards[idx - 1];
    if (target != null) setReckCursorId(target.leaves[0]?.task.id ?? null);
  };

  const cmd = {
    cursorDown: () => {
      if (reckoningActive) return moveReckCursor("down");
      if (
        view !== "projects" &&
        focusedProjectId != null &&
        focusedId != null &&
        flatIds.indexOf(focusedId) === flatIds.length - 1
      ) {
        setProjectCollapsed(focusedProjectId, false);
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
    cursorFirst: () => {
      if (flatIds.length > 0) setSelection(selectOne(flatIds[0], flatIds));
    },
    cursorLast: () => {
      if (flatIds.length > 0)
        setSelection(selectOne(flatIds[flatIds.length - 1], flatIds));
    },
    selectDown: () => setSelection((s) => moveSelection(s, flatIds, "down", true)),
    selectUp: () => setSelection((s) => moveSelection(s, flatIds, "up", true)),
    reorderUp: () => reorderAcrossProjects(actionTargets(), "up", visibleTaskIds),
    reorderDown: () => reorderAcrossProjects(actionTargets(), "down", visibleTaskIds),
    // → expands a collapsed project/task first (outliner convention), then
    // descends; only opens the details panel when there's nothing to expand.
    panelOpen: () => {
      if (focusedProjectId != null) {
        if (view === "projects") {
          zoomInto({ kind: "project", id: focusedProjectId }); // → opens the project
        } else if (collapsedProjects.has(focusedProjectId)) {
          setProjectCollapsed(focusedProjectId, false);
        } else {
          setSelection((s) => moveSelection(s, flatIds, "down", false)); // descend
        }
        return;
      }
      if (focusedTaskId != null) {
        const t = findById(filtered, focusedTaskId);
        if (t != null && t.children.length > 0 && collapsed.has(focusedTaskId)) {
          toggleCollapsedFor(focusedTaskId);
          return;
        }
      }
      openPanel();
    },
    // ← closes the panel, else collapses an expanded project/task, else climbs
    // to the parent task — or to the owning project header at the top level.
    panelBack: () => {
      if (showPanel) {
        setShowPanel(false);
        return;
      }
      if (focusedProjectId != null) {
        if (view !== "projects" && !collapsedProjects.has(focusedProjectId)) {
          setProjectCollapsed(focusedProjectId, true);
        }
        return;
      }
      if (focusedTaskId == null) return;
      const t = findById(filtered, focusedTaskId);
      if (t != null && t.children.length > 0 && !collapsed.has(focusedTaskId)) {
        toggleCollapsedFor(focusedTaskId);
        return;
      }
      const parent = findParentId(filtered, focusedTaskId);
      const zoomRootId = zoomFocus?.kind === "task" ? zoomFocus.rootId : null;
      if (parent != null && parent !== zoomRootId) {
        setFocus(parent);
      } else if (parent == null && zoomFocus == null) {
        const top = findById(state.tasks, focusedTaskId);
        if (top != null) setFocus(projectRowId(top.projectId));
      }
      // else: at the top of the zoom — use Esc to back out.
    },
    editStart: () => {
      if (focusedId != null) startEditingOutlineId(focusedId);
    },
    taskNew: () => {
      // The Projects index (not zoomed in) has no task list — "new" makes a project.
      if (view === "projects" && zoom == null) return createProjectInIndex();
      const beginEdit = (newId: TaskId) => {
        setFocus(newId);
        setEditingProjectId(null);
        setEditingId(newId);
      };
      if (focusedTaskId != null) return beginEdit(addTaskAfter(focusedTaskId, "", defaultPlannedFor()));
      if (focusedProjectId != null) {
        setProjectCollapsed(focusedProjectId, false);
        return beginEdit(addTaskAtProjectStart(focusedProjectId, "", defaultPlannedFor()));
      }
      // Nothing focused but zoomed in: the new task belongs to the zoom root.
      if (zoom?.kind === "task") return beginEdit(addChild(zoom.id, "", defaultPlannedFor()));
      if (zoom?.kind === "project") return beginEdit(addTaskAtProjectStart(zoom.id, "", defaultPlannedFor()));
      beginEdit(addTaskAfter(null, "", defaultPlannedFor()));
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
      // With the detail panel open (preview), Tab dives into the notes editor
      // instead of indenting — focus leaves the list and lands in the panel.
      if (showPanel && focusedTaskId != null && !reckoningActive && view !== "trash") {
        setEditNotesSignal((n) => n + 1);
        return;
      }
      if (focusedTaskId != null) indentInView(focusedTaskId);
    },
    taskOutdent: () => {
      if (focusedTaskId != null) outdent(focusedTaskId);
    },
    taskTrash: () => {
      const ids = actionTargets();
      if (ids.length === 0) return;
      const doTrash = () => {
        const next = selectAfterRemoving(selection, flatIds, new Set(ids));
        if (ids.length === 1) trashTask(ids[0]);
        else trashMany(ids);
        setSelection(next);
      };
      // A leaf trashes instantly (reversible + undoable, keyboard-first). Deleting
      // a task with subtasks takes a whole subtree, so confirm that first.
      const hasSubtree = ids.some(
        (id) => (findById(state.tasks, id)?.children.length ?? 0) > 0
      );
      if (!hasSubtree) return doTrash();
      setConfirm({
        title:
          ids.length > 1
            ? `Delete ${ids.length} tasks and their subtasks?`
            : "Delete this task and its subtasks?",
        body: "They move to Trash — restore them there, or undo with ⌘Z.",
        confirmLabel: "Delete",
        onConfirm: doTrash,
      });
    },
    taskCollapse: () => {
      if (focusedProjectId != null) {
        if (view !== "projects") toggleProjectCollapsed(focusedProjectId);
        return;
      }
      if (focusedTaskId == null) return;
      const t = findById(filtered, focusedTaskId);
      if (t != null && t.children.length > 0) toggleCollapsedFor(focusedTaskId);
    },
    zoomIn: () => {
      if (focusedProjectId != null) zoomInto({ kind: "project", id: focusedProjectId });
      else if (focusedTaskId != null) zoomInto({ kind: "task", id: focusedTaskId });
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
    toggleHideCompleted: () => setHideCompleted((v) => !v),
    helpToggle: () => setShowHelp((v) => !v),
    paletteOpen: () => setShowPalette(true),
    scheduleOpen: () => {
      if (actionTargets().length > 0) setShowSchedule(true);
    },
    // Toggle the Later view's grouping (by date / by project). No-op elsewhere,
    // since the layout only exists in the Later (backlog) view.
    toggleLaterLayout: () => {
      if (view === "backlog") setLaterLayout((l) => (l === "date" ? "project" : "date"));
    },
    gotoView: (v: ViewKind) => () => {
      setZoom(null); // picking a view leaves focus mode
      setView(v);
    },
    dismiss: () => {
      if (confirm != null) setConfirm(null);
      else if (showHelp) setShowHelp(false);
      else if (showPalette) setShowPalette(false);
      else if (showSchedule) setShowSchedule(false);
      else if (mode === "move") exitMove();
      else if (editingProjectId != null) setEditingProjectId(null);
      else if (editingId != null) setEditingId(null);
      else if (showPanel) setShowPanel(false);
      else if (zoom != null) {
        // Climb one level out of the zoom; land focus on the node we just left.
        const prevRootId = zoomFocus?.rootId ?? null;
        setZoom(zoomParent(state.tasks, zoom));
        if (prevRootId != null) setFocus(prevRootId);
      }
    },
    reckComplete: (id?: TaskId) => {
      const target = id ?? reckCursorId;
      if (target == null) return;
      advanceReckCursorPast(target);
      setCompleted(target, true, reckReason || null);
    },
    reckKeep: (id?: TaskId) => {
      const target = id ?? reckCursorId;
      if (target == null) return;
      advanceReckCursorPast(target);
      keepForToday(target, reckReason || null);
    },
    reckBacklog: (id?: TaskId) => {
      const target = id ?? reckCursorId;
      if (target == null) return;
      advanceReckCursorPast(target);
      postponeToBacklog(target, reckReason || null);
    },
    reckDrop: (id?: TaskId) => {
      const target = id ?? reckCursorId;
      if (target == null) return;
      advanceReckCursorPast(target);
      trashTask(target, { reason: reckReason || null, log: true });
    },
    reckBreakdown: (id?: TaskId) => {
      const target = id ?? reckCursorId;
      if (target != null) setBreakingDownId(target);
    },
    reckBacklogAll: (card: ReckoningCard) => {
      advanceReckCursorPastCard(card);
      postponeManyToBacklog(card.leaves.map((l) => l.task.id), reckReason || null);
    },
    reckDropAll: (card: ReckoningCard) => {
      advanceReckCursorPastCard(card);
      dropManyWithLog(card.leaves.map((l) => l.task.id), reckReason || null);
    },
  };

  // ── Keyboard wiring ───────────────────────────────────────────────
  const dispatchState: ContextState = {
    showHelp,
    showPalette,
    showSchedule,
    showConfirm: confirm != null,
    reckoningActive,
    mode,
  };
  const actionMap: Record<string, () => void> = {
    "cursor.down": cmd.cursorDown,
    "cursor.up": cmd.cursorUp,
    "cursor.first": cmd.cursorFirst,
    "cursor.last": cmd.cursorLast,
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
    "zoom.in": cmd.zoomIn,
    "move.enter": cmd.moveEnter,
    "move.dropSibling": cmd.moveDropSibling,
    "move.dropChild": cmd.moveDropChild,
    "move.cancel": cmd.dismiss,
    "capture.focus": cmd.captureFocus,
    "filter.hideCompleted": cmd.toggleHideCompleted,
    "undo": undo,
    "help.toggle": cmd.helpToggle,
    "palette.open": cmd.paletteOpen,
    "schedule.open": cmd.scheduleOpen,
    "later.toggleLayout": cmd.toggleLaterLayout,
    "view.today": cmd.gotoView("today"),
    "view.backlog": cmd.gotoView("backlog"),
    "view.all": cmd.gotoView("all"),
    "view.projects": cmd.gotoView("projects"),
    "view.trash": cmd.gotoView("trash"),
    "dismiss": cmd.dismiss,
    // Arg-less wrappers: the keyboard engine calls handlers with the dispatch
    // state, so these must ignore it and act on the cursor (not a stray object).
    "reck.complete": () => cmd.reckComplete(),
    "reck.keep": () => cmd.reckKeep(),
    "reck.breakdown": () => cmd.reckBreakdown(),
    "reck.backlog": () => cmd.reckBacklog(),
    "reck.drop": () => cmd.reckDrop(),
    "reck.nextCard": () => moveReckCard("next"),
    "reck.prevCard": () => moveReckCard("prev"),
    "reck.backlogAll": () => {
      const c = currentReckCard();
      if (c != null) cmd.reckBacklogAll(c);
    },
    "reck.dropAll": () => {
      const c = currentReckCard();
      if (c != null) cmd.reckDropAll(c);
    },
  };
  useKeyboard(keymap, actionMap, dispatchState);

  // ── Editor surface for rows ───────────────────────────────────────
  // A brand-new task left untitled (empty text, no children) is abandoned the
  // moment you move off it — discard it instead of leaving "Untitled" litter.
  const isUntitledLeaf = (id: TaskId, raw: string): boolean => {
    if (parseCapture(raw).text !== "") return false;
    const t = findById(state.tasks, id);
    return t != null && t.children.length === 0;
  };

  const editor: Editor = {
    view,
    today,
    bucketed: usingBuckets,
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
    zoomInto: (id) => zoomInto({ kind: "task", id }),
    startEdit: (id) => {
      setFocus(id);
      setEditingProjectId(null);
      setEditingId(id);
    },
    commit: commitText,
    indentEditing: (id, raw) => {
      commitText(id, raw);
      indentInView(id);
    },
    outdentEditing: (id, raw) => {
      commitText(id, raw);
      outdent(id);
    },
    exitUp: (id, raw) => {
      const removed = isUntitledLeaf(id, raw);
      if (removed) trashTask(id);
      else commitText(id, raw);
      exitEditTo(id, "up", removed);
    },
    exitDown: (id, raw) => {
      const removed = isUntitledLeaf(id, raw);
      if (removed) trashTask(id);
      else commitText(id, raw);
      exitEditTo(id, "down", removed);
    },
    toggleFromEdit: (id, raw) => {
      commitText(id, raw);
      toggleComplete(id);
    },
    exitEdit: (id, raw) => {
      if (isUntitledLeaf(id, raw)) trashWithNeighbor(id);
      else commitText(id, raw);
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

  // ↑/↓ while renaming a project header: save the name, then leave edit mode and
  // move focus one row — same exit behavior as task rows, so headers no longer
  // trap the cursor.
  const exitProjectRename = (
    projectId: ProjectId,
    name: string,
    dir: "up" | "down"
  ) => {
    renameProject(projectId, name);
    exitEditTo(projectRowId(projectId), dir, false);
  };

  const onCapture = (raw: string) => {
    const p = parseCapture(raw);
    if (p.text === "") return;
    let id: TaskId;
    if (zoom?.kind === "task") {
      id = addChild(zoom.id, p.text, defaultPlannedFor());
    } else if (zoom?.kind === "project") {
      id = addTaskAtProjectStart(zoom.id, p.text, defaultPlannedFor());
    } else {
      const projectId = currentProjectId ?? DEFAULT_PROJECT_ID;
      setProjectCollapsed(projectId, false); // keep the captured task visible
      id = addTaskAfter(null, p.text, defaultPlannedFor(), projectId);
    }
    if (p.completed) setCompleted(id, true);
    setFocus(id);
  };

  // Capture during the Reckoning: the gate must never block the front door. A
  // dump lands in the Inbox project planned for today (the user's choice — new
  // tasks are for today), and since it's not planned *before* today it never
  // joins the leftovers, so the pile to clear can't grow. Cursor stays put.
  const onReckCapture = (raw: string) => {
    const p = parseCapture(raw);
    if (p.text === "") return;
    const id = addTaskAtProjectStart(DEFAULT_PROJECT_ID, p.text, today);
    if (p.completed) setCompleted(id, true);
  };

  // Breadcrumb navigation: null exits zoom; a project row / task id re-roots.
  const onCrumb = (id: OutlineId | null) => {
    if (id == null) {
      setZoom(null);
    } else if (isProjectRowId(id)) {
      zoomInto({ kind: "project", id: projectIdFromRowId(id) });
    } else {
      zoomInto({ kind: "task", id });
    }
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
    // In the Projects index there's no task list — just name the project.
    if (view === "projects") {
      setFocus(projectRowId(projectId));
      setEditingId(null);
      setEditingProjectId(projectId);
      return;
    }
    const targetView = view === "trash" ? "backlog" : view;
    const plannedFor = targetView === "today" ? today : null;
    if (view === "trash") setView("backlog");
    const id = addTaskAtProjectStart(projectId, "", plannedFor);
    setFocus(id);
    setEditingProjectId(null);
    setEditingId(id);
  };

  const addTaskToProject = (projectId: ProjectId, afterId: TaskId | null) => {
    setProjectCollapsed(projectId, false); // never add into a collapsed (hidden) project
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
    { id: "today", label: "Go to Today", hint: "1", run: cmd.gotoView("today") },
    { id: "backlog", label: "Go to Backlog", hint: "2", run: cmd.gotoView("backlog") },
    { id: "all", label: "Go to All", hint: "3", run: cmd.gotoView("all") },
    { id: "projects", label: "Go to Projects", hint: "4", run: cmd.gotoView("projects") },
    { id: "trash", label: "Go to Trash", hint: "5", run: cmd.gotoView("trash") },
    { id: "new", label: "New task", hint: "o", run: cmd.taskNew },
    { id: "details", label: "Open details panel", hint: "→", run: openPanel },
    { id: "toggle", label: "Complete / uncomplete task", hint: "space", run: cmd.taskToggle },
    { id: "plan", label: "Plan / unplan for today", hint: "t", run: cmd.taskPlanToday },
    // Scheduling, reachable from the palette (the `s` picker is the keyboard path).
    // All act on the focused/selected task(s); no-op when nothing is targeted.
    { id: "sched-today", label: "Schedule: Today", aliases: ["schedule"], hint: "s t", run: () => applySchedule("today") },
    { id: "sched-tomorrow", label: "Schedule: Tomorrow", aliases: ["schedule"], run: () => applySchedule({ date: addDays(today, 1) }) },
    { id: "sched-this-week", label: "Schedule: This week", aliases: ["schedule"], hint: "s w", run: () => applySchedule("thisWeek") },
    { id: "sched-next-week", label: "Schedule: Next week", aliases: ["schedule"], hint: "s e", run: () => applySchedule("nextWeek") },
    { id: "sched-this-month", label: "Schedule: This month", aliases: ["schedule"], hint: "s m", run: () => applySchedule("thisMonth") },
    { id: "sched-next-month", label: "Schedule: Next month", aliases: ["schedule"], hint: "s n", run: () => applySchedule("nextMonth") },
    { id: "sched-someday", label: "Schedule: Someday", aliases: ["schedule"], hint: "s s", run: () => applySchedule("someday") },
    { id: "sched-inbox", label: "Schedule: Inbox (untriage)", aliases: ["schedule"], hint: "s i", run: () => applySchedule("inbox") },
    { id: "move", label: "Move task (re-parent)", hint: "m", run: cmd.moveEnter },
    { id: "zoom", label: "Zoom in / focus", hint: "⌥↵", run: cmd.zoomIn },
    {
      id: "hide-completed",
      label: hideCompleted ? "Show completed tasks" : "Hide all completed tasks",
      hint: "h",
      run: cmd.toggleHideCompleted,
    },
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
    <div className="relative flex h-full overflow-hidden bg-bg text-ink" spellCheck={false}>
      <div className="drag-region absolute inset-x-0 top-0 z-20 h-7" />

      <Sidebar
        view={view}
        todayRemaining={progress.remaining}
        backlog={backlog}
        projectCount={state.projects.length}
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
                cards={reckCards}
                cursorId={reckCursorId}
                today={today}
                projects={state.projects}
                breakdownTask={breakdownTask}
                reason={reckReason}
                onReasonChange={setReckReason}
                onSelect={setReckCursorId}
                onComplete={cmd.reckComplete}
                onKeep={cmd.reckKeep}
                onBacklog={cmd.reckBacklog}
                onDrop={cmd.reckDrop}
                onStartBreakdown={cmd.reckBreakdown}
                onBacklogAll={cmd.reckBacklogAll}
                onDropAll={cmd.reckDropAll}
                onPrevCard={() => moveReckCard("prev")}
                onNextCard={() => moveReckCard("next")}
                onAddStep={(parentId, text) => addChild(parentId, parseCapture(text).text, today)}
                onFinishBreakdown={() => {
                  if (breakingDownId != null) logBreakdown(breakingDownId);
                  setBreakingDownId(null);
                }}
                captureRef={captureRef}
                onCapture={onReckCapture}
                onCaptureArrowDown={() => {
                  if (reckCursorId == null && leftovers[0] != null) {
                    setReckCursorId(leftovers[0].id);
                  }
                }}
              />
            ) : view === "trash" ? (
              <TrashView
                trash={state.trash}
                onRestore={restoreFromTrash}
                onPurge={(id) =>
                  setConfirm({
                    title: "Delete forever?",
                    body: "This permanently removes the task from Trash — it can’t be undone.",
                    confirmLabel: "Delete forever",
                    onConfirm: () => purgeFromTrash(id),
                  })
                }
                onEmpty={() =>
                  setConfirm({
                    title: "Empty the trash?",
                    body: "Permanently removes every task in Trash. This can’t be undone.",
                    confirmLabel: "Empty trash",
                    onConfirm: emptyTrash,
                  })
                }
              />
            ) : view === "projects" && zoomFocus == null ? (
              <ProjectsView
                summaries={projectIndex}
                focusedId={focusedId}
                selectedIds={selection.selectedIds}
                editingProjectId={editingProjectId}
                onSelectRow={setFocus}
                onOpenProject={(projectId) => zoomInto({ kind: "project", id: projectId })}
                onAddProject={createProjectInIndex}
                onCycleProjectColor={cycleProjectColor}
                onStartRenameProject={(projectId) =>
                  startEditingOutlineId(projectRowId(projectId))
                }
                onCommitProjectName={commitProjectName}
                onExitProjectName={() => setEditingProjectId(null)}
                onArrowProjectName={exitProjectRename}
              />
            ) : (
              <EditorProvider value={editor}>
                <OutlineView
                  view={view}
                  today={today}
                  groups={projectGroups}
                  suggested={suggestedTasks}
                  zoom={zoomFocus}
                  collapsedProjectIds={collapsedProjects}
                  hideCompleted={hideCompleted}
                  onToggleHideCompleted={cmd.toggleHideCompleted}
                  buckets={bucketGroups}
                  laterLayout={laterLayout}
                  onToggleLaterLayout={cmd.toggleLaterLayout}
                  focusedId={focusedId}
                  selectedIds={selection.selectedIds}
                  editingProjectId={editingProjectId}
                  progress={progress}
                  captureRef={captureRef}
                  onAdd={onCapture}
                  onCaptureArrowDown={() => flatIds[0] != null && setFocus(flatIds[0])}
                  onCaptureFocus={() => setSelection(emptySelection)}
                  onAddProject={() => createProjectAndFirstTask("New project")}
                  onAddToProject={addTaskToProject}
                  onSelectRow={setFocus}
                  onCrumb={onCrumb}
                  onToggleProjectCollapsed={toggleProjectCollapsed}
                  onZoomProject={(projectId) => zoomInto({ kind: "project", id: projectId })}
                  onStartRenameProject={(projectId) =>
                    startEditingOutlineId(projectRowId(projectId))
                  }
                  onCommitProjectName={commitProjectName}
                  onExitProjectName={() => setEditingProjectId(null)}
                  onArrowProjectName={exitProjectRename}
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
              editSignal={editNotesSignal}
            />
          )}
        </div>
        <StatusBar reckoning={reckoningActive} />
      </main>

      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
      {showPalette && (
        <CommandPalette commands={commands} onClose={() => setShowPalette(false)} />
      )}
      {showSchedule && actionTargets().length > 0 && (
        <SchedulePicker
          today={today}
          count={actionTargets().length}
          current={scheduleTag}
          onPick={applySchedule}
          onClose={() => setShowSchedule(false)}
        />
      )}
      {confirm != null && (
        <ConfirmModal
          title={confirm.title}
          body={confirm.body}
          confirmLabel={confirm.confirmLabel}
          onConfirm={() => {
            const req = confirm;
            setConfirm(null);
            req.onConfirm();
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
