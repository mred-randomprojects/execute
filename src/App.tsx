import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Horizon,
  OutlineId,
  ProjectId,
  RecurrenceId,
  Task,
  TaskId,
  TaskPriority,
  ThemeName,
} from "./types";
import {
  DEFAULT_PROJECT_ID,
  isProjectRowId,
  projectIdFromRowId,
  projectRowId,
} from "./types";
import {
  acceptRecurrence,
  addChild,
  addRecurrenceStep,
  addTaskAfter,
  addTaskAtProjectStart,
  createProject,
  createRecurrence,
  cycleProjectColor,
  emptyTrash,
  indent,
  indentRecurrenceNode,
  dropManyWithLog,
  initStore,
  keepForToday,
  logBreakdown,
  markOpened,
  markWontDo,
  markWontDoMany,
  moveAfter,
  moveAsChild,
  moveBefore,
  clearWontDo,
  outdent,
  outdentRecurrenceNode,
  postponeManyToBacklog,
  postponeToBacklog,
  purgeFromTrash,
  removeRecurrenceNode,
  renameProject,
  reorderAcrossProjects,
  restoreFromTrash,
  setBoardPreferred,
  setCompleted,
  setCompletedMany,
  setCurrentTask,
  setDailyCapacityBlocks,
  setDevDateOverride,
  setEstimatedMinutesMany,
  setHorizonMany,
  setNotes,
  setPlannedForMany,
  setProjectForMany,
  setPriority,
  setRecurrenceRule,
  setRecurrenceText,
  setText,
  setTheme,
  setWontDoReason,
  toggleComplete,
  toggleWontDo,
  trashMany,
  trashTask,
  undo,
  useStore,
} from "./store/store";
import { findById, findParentId, isOpen, walk } from "./store/tasks";
import { addDays, monthKey, monthKeyOffset, todayISO, weekKey, weekKeyOffset } from "./store/dates";
import { defaultRule } from "./store/recurrence";
import { parseCapture } from "./store/capture";
import { taskToMarkdown } from "./store/taskMarkdown";
import {
  backlogCount,
  filterTree,
  filterTreeEffective,
  flattenRows,
  groupRecurrencesByRule,
  groupTasksByBucket,
  groupTasksByProject,
  leftoverLeaves,
  prevVisibleSiblingId,
  projectSummaries,
  reckoningCards,
  groupTasksByDay,
  PERIOD_LABELS,
  PERIODS,
  recurringForToday,
  resolveZoom,
  scheduleStep,
  stepSchedule,
  suggestedForToday,
  taskBucket,
  todayCapacity,
  todayLeaves,
  todayProgress,
  viewPredicate,
  viewTasks,
  VIEW_TITLES,
  zoomParent,
  type Period,
  type ReckoningCard,
  type ScheduleStep,
  type ViewKind,
  type ZoomTarget,
} from "./selectors";
import { minutesFromBlocks } from "./store/estimate";
import {
  emptySelection,
  moveSelection,
  nearestSurvivor,
  rangeTo,
  selectAfterRemoving,
  selectOne,
  toggleSelected,
  type Selection,
} from "./ui/selection";
import { keymap } from "./keyboard/keymap";
import { useKeyboard } from "./keyboard/useKeyboard";
import type { AppMode, ContextState } from "./keyboard/types";
import { EditorProvider, type Editor } from "./ui/editor";
import { copyText } from "./ui/clipboard";
import { Sidebar } from "./components/Sidebar";
import { SyncButton } from "./components/SyncButton";
import { initAutoSync } from "./sync/desktopSync";
import { OutlineView } from "./views/OutlineView";
import { ProjectsView } from "./views/ProjectsView";
import { RecurringView } from "./views/RecurringView";
import { ReckoningView } from "./views/ReckoningView";
import { ReckoningBoard, type BoardLeftover } from "./views/ReckoningBoard";
import { TrashView } from "./views/TrashView";
import { RepeatPicker } from "./components/RepeatPicker";
import { DetailPanel, type DetailHandlers } from "./components/DetailPanel";
import { HelpOverlay } from "./components/HelpOverlay";
import { DevControls } from "./components/DevControls";
import { StatusBar } from "./components/StatusBar";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { SchedulePicker, type ScheduleChoice } from "./components/SchedulePicker";
import { EstimatePicker } from "./components/EstimatePicker";
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
  const { state, ready, loadError } = useStore();
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const today = todayISO(state.devDateOverride);

  // ── UI state ──────────────────────────────────────────────────────
  const [view, setView] = useState<ViewKind>("today");
  // Which time window the home view shows (the Today / Tomorrow / … tab strip).
  const [period, setPeriod] = useState<Period>("today");
  const [selection, setSelection] = useState<Selection>(emptySelection);
  const [editingId, setEditingId] = useState<TaskId | null>(null);
  // Task whose "won't do" reason is being typed inline (empty field). Cleared when
  // the reason is saved/skipped, or when the row leaves the view.
  const [reasonEditId, setReasonEditId] = useState<TaskId | null>(null);
  // In-place preview (`p`): the row unwraps its full title and shows its notes
  // inline — a lighter look than the side panel. Pinned to one task; moving the
  // cursor or Esc closes it.
  const [peekId, setPeekId] = useState<TaskId | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<ProjectId | null>(null);
  const [collapsed, setCollapsed] = useState<Set<TaskId>>(new Set());
  const [collapsedProjects, setCollapsedProjects] = useState<Set<ProjectId>>(new Set());
  const [zoom, setZoom] = useState<ZoomTarget | null>(null);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [mode, setMode] = useState<AppMode>("normal");
  const [movingId, setMovingId] = useState<TaskId | null>(null);
  // Bumped on a keyboard reorder so the focused row scrolls back into view.
  const [scrollTick, setScrollTick] = useState(0);
  const bumpScroll = () => setScrollTick((n) => n + 1);
  // The task currently being dragged (mouse DnD), or null.
  const [dragId, setDragId] = useState<TaskId | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showEstimate, setShowEstimate] = useState(false);
  // The reckoning gate's two-panel skin (leftovers ↔ today + capacity). Opt-in
  // and persisted (state.boardPreferred); `v` toggles it and the card review.
  const boardMode = state.boardPreferred;
  // When the board's "push to later" opens the schedule picker, the task it
  // targets (the picker otherwise reads the outline selection, stale mid-gate).
  const [boardScheduleId, setBoardScheduleId] = useState<TaskId | null>(null);
  // Which board column the cursor is in, and the cursor within the Today column
  // (the leftovers column reuses reckCursorId). Lets → pull and ← send back.
  const [boardColumn, setBoardColumn] = useState<"left" | "right">("left");
  const [todayCursorId, setTodayCursorId] = useState<TaskId | null>(null);
  const [repeatTarget, setRepeatTarget] = useState<{ recId: RecurrenceId; taskId: TaskId } | null>(
    null
  );
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

  // Peek is ephemeral: it belongs to the row it was opened on and closes the
  // moment the cursor leaves it.
  useEffect(() => {
    if (peekId != null && focusedTaskId !== peekId) setPeekId(null);
  }, [focusedTaskId, peekId]);

  useEffect(() => {
    void initStore();
  }, []);
  // Auto cloud-sync (desktop only; no-op elsewhere). Rides the store's persist
  // hook, so every change syncs without per-action wiring.
  useEffect(() => initAutoSync(), []);
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

  // ── Planning board (the reckoning's opt-in board skin) ────────────
  const capacity = useMemo(
    () => todayCapacity(state.tasks, today, state.dailyCapacityBlocks),
    [state.tasks, today, state.dailyCapacityBlocks]
  );
  // Open work already committed to today — the board's right column.
  const todayOpenLeaves = useMemo(
    () => todayLeaves(state.tasks, today).filter(isOpen),
    [state.tasks, today]
  );
  // The leftovers as board rows, each tagged with its nearest ancestor's text
  // for context. Ordered to match `leftovers` so the cursor lines up 1:1.
  const boardLeftovers = useMemo<BoardLeftover[]>(() => {
    const parentText = new Map<TaskId, string | null>();
    for (const card of reckCards) {
      for (const leaf of card.leaves) {
        const nearest = leaf.parents[leaf.parents.length - 1] ?? (card.root.id !== leaf.task.id ? card.root : null);
        parentText.set(leaf.task.id, nearest?.text ?? null);
      }
    }
    return leftovers.map((task) => ({ task, parentText: parentText.get(task.id) ?? null }));
  }, [leftovers, reckCards]);

  // Keep the Today-column cursor pointing at a real row; when Today empties, fall
  // back to the leftovers column so the cursor never strands on nothing.
  useEffect(() => {
    const ids = todayOpenLeaves.map((t) => t.id);
    if (todayCursorId != null && !ids.includes(todayCursorId)) {
      setTodayCursorId(ids[0] ?? null);
    } else if (todayCursorId == null && boardColumn === "right" && ids[0] != null) {
      setTodayCursorId(ids[0]);
    }
  }, [todayOpenLeaves, todayCursorId, boardColumn]);
  useEffect(() => {
    if (boardColumn === "right" && todayOpenLeaves.length === 0) setBoardColumn("left");
  }, [boardColumn, todayOpenLeaves.length]);

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
    () => viewTasks(state.tasks, view, today, period),
    [state.tasks, view, today, period]
  );
  // "Hide all completed" (toggle on `h`) prunes done tasks from the outline,
  // keeping a completed parent only when it still has a visible (incomplete)
  // descendant. Counts/progress read from state.tasks, so they stay accurate.
  //
  // The pruning re-applies the view's *own* predicate (not just `!completed`), so
  // a context-only parent — one shown in Today solely because a descendant is
  // planned for today — drops out once that descendant is completed and hidden,
  // instead of stranding an empty, not-for-today row. (A parent still shows while
  // any open today-descendant remains, since it's kept via that child.)
  const visibleTasks = useMemo(
    () =>
      hideCompleted
        ? filterTreeEffective(filtered, (t) => viewPredicate(view, today, period)(t) && isOpen(t))
        : filtered,
    [filtered, hideCompleted, view, today, period]
  );
  const projectGroups = useMemo(
    () => groupTasksByProject(visibleTasks, state.projects),
    [visibleTasks, state.projects]
  );
  // Multi-day period tabs (weeks/months) split each project under second-order
  // day separators; `tasks` is re-flattened in section order so the keyboard
  // walk, counts, and render order all agree.
  const multiDayPeriod =
    view === "today" &&
    (period === "thisWeek" || period === "nextWeek" || period === "thisMonth" || period === "nextMonth");
  const displayGroups = useMemo(() => {
    if (!multiDayPeriod) return projectGroups;
    return projectGroups.map((g) => {
      const sections = groupTasksByDay(g.tasks, today, period);
      return { ...g, tasks: sections.flatMap((s) => s.tasks), sections };
    });
  }, [multiDayPeriod, projectGroups, today, period]);
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
    return { ...z, subtree: filterTree(z.subtree, (t) => isOpen(t)) };
  }, [zoom, state.tasks, state.projects, view, hideCompleted]);
  // Soft-horizon tasks the engine projects onto today — shown as a passive,
  // non-reckoning "Suggested for today" group at the foot of Today. They join the
  // outline flow so ↑/↓ reach them and `t` (accept) / `s` (reschedule) just work.
  const suggestedTasks = useMemo(
    () =>
      view === "today" && period === "today" && zoom == null
        ? suggestedForToday(state.tasks, today)
        : [],
    [view, period, zoom, state.tasks, today]
  );
  // Recurrence definitions, grouped by pattern for the Recurring view.
  const recurrenceGroups = useMemo(
    () => (view === "recurring" ? groupRecurrencesByRule(state.recurrences) : []),
    [view, state.recurrences]
  );
  // Recurrences due today that aren't already accepted — passive suggestions in
  // Today the user can accept (`t`) to materialize as real dated tasks.
  const recurringToday = useMemo(
    () =>
      view === "today" && period === "today" && zoom == null
        ? recurringForToday(state.recurrences, state.tasks, today)
        : [],
    [view, period, zoom, state.recurrences, state.tasks, today]
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
    if (view === "recurring") {
      // Navigate over the recurrence templates (roots + their steps).
      return recurrenceGroups.flatMap((group) =>
        group.recurrences.flatMap((rec) =>
          flattenRows([rec.template], collapsed).map((row) => ({
            kind: "task" as const,
            id: row.task.id,
            taskId: row.task.id,
          }))
        )
      );
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
    const rows = displayGroups.flatMap((group) => [
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
    // Recurring-today suggestions trail those, again matching render order. Only
    // the template root is focusable (its steps render as a static preview).
    for (const rec of recurringToday) {
      rows.push({ kind: "task" as const, id: rec.template.id, taskId: rec.template.id });
    }
    return rows;
  }, [zoomFocus, view, state.projects, displayGroups, usingBuckets, bucketGroups, collapsed, collapsedProjects, suggestedTasks, recurrenceGroups, recurringToday]);
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
  // The "right now" task, resolved from its id. Shown only while it exists and is
  // incomplete — finishing or deleting it retires the banner.
  const currentTask =
    state.currentTaskId != null ? findById(state.tasks, state.currentTaskId) ?? null : null;
  const activeCurrentTask = currentTask != null && isOpen(currentTask) ? currentTask : null;
  const focusedProjectId =
    focusedId != null && isProjectRowId(focusedId)
      ? projectIdFromRowId(focusedId)
      : null;
  const currentProjectId = focusedProjectId ?? focusedTask?.projectId ?? null;
  const selectedTaskIds = selection.selectedIds.filter(
    (id): id is TaskId => !isProjectRowId(id)
  );
  // The recurrence a focused row belongs to (in the Recurring view), plus whether
  // that row is the template root. Used to route edits to recurrence actions.
  const focusedRecurrence =
    view === "recurring" && focusedTaskId != null
      ? state.recurrences.find((r) => findById([r.template], focusedTaskId) != null) ?? null
      : null;
  const focusedIsRecurrenceRoot =
    focusedRecurrence != null && focusedRecurrence.template.id === focusedTaskId;
  const focusedRecurringNode =
    focusedRecurrence != null && focusedTaskId != null
      ? findById([focusedRecurrence.template], focusedTaskId) ?? null
      : null;
  // In Today, the recurrence suggestion (if any) the cursor is on — its actions
  // route to "accept", never to mutating the template.
  const focusedRecurringToday =
    focusedTaskId != null
      ? recurringToday.find((r) => r.template.id === focusedTaskId) ?? null
      : null;

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
  // Drop the inline reason field if its row left the view or was reopened.
  useEffect(() => {
    if (reasonEditId === null) return;
    const t = findById(state.tasks, reasonEditId);
    if (t == null || t.wontDo == null || !flatIds.includes(reasonEditId)) {
      setReasonEditId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatKey, state.tasks, reasonEditId]);
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
  // Clear a dangling "current" pointer if its task was deleted / trashed.
  useEffect(() => {
    if (state.currentTaskId != null && findById(state.tasks, state.currentTaskId) == null) {
      setCurrentTask(null);
    }
  }, [state.currentTaskId, state.tasks]);

  const didInitialFocus = useRef(false);
  useEffect(() => {
    if (ready && !didInitialFocus.current && state.tasks.length === 0) {
      didInitialFocus.current = true;
      captureRef.current?.focus();
    }
  }, [ready, state.tasks.length]);

  // ── Helpers ───────────────────────────────────────────────────────
  // New tasks land in the window being viewed: the Today/Tomorrow tabs give a
  // concrete day; the fuzzy tabs (weeks / months / someday) stamp their horizon
  // via withPeriodSchedule right after creation. Other views: unscheduled.
  const defaultPlannedFor = () =>
    view !== "today" ? null : period === "today" ? today : period === "tomorrow" ? addDays(today, 1) : null;
  const periodHorizon = (): Horizon | null => {
    if (view !== "today") return null;
    switch (period) {
      case "thisWeek":
        return { unit: "week", anchor: weekKey(today) };
      case "nextWeek":
        return { unit: "week", anchor: weekKeyOffset(today, 1) };
      case "thisMonth":
        return { unit: "month", anchor: monthKey(today) };
      case "nextMonth":
        return { unit: "month", anchor: monthKeyOffset(today, 1) };
      case "someday":
        return { unit: "someday", anchor: null };
      default:
        return null;
    }
  };
  const withPeriodSchedule = (id: TaskId): TaskId => {
    const h = periodHorizon();
    if (h != null) setHorizonMany([id], h);
    return id;
  };
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

  // Tab nests a task under the row visually above it — its previous *visible*
  // sibling in the current (filtered) view — never under a sibling the view is
  // hiding. So we resolve the parent from the displayed forest, not the raw tree.
  const indentInView = (id: TaskId) => {
    const groups: { tasks: Task[] }[] = usingBuckets ? bucketGroups : displayGroups;
    const forest =
      zoomFocus != null
        ? zoomFocus.subtree
        : groups.find((g) => findById(g.tasks, id) != null)?.tasks ?? [];
    const underId = prevVisibleSiblingId(forest, id);
    if (underId != null) indent(id, underId);
  };

  // Same, but for a step inside a recurrence template (routes to recurrence ops).
  const indentRecurringInView = (id: TaskId) => {
    const rec = state.recurrences.find((r) => findById([r.template], id) != null);
    if (rec == null) return;
    const underId = prevVisibleSiblingId([rec.template], id);
    if (underId != null) indentRecurrenceNode(id, underId);
  };

  const isUntitledRecurringNode = (id: TaskId, raw: string): boolean => {
    if (parseCapture(raw).text !== "") return false;
    const rec = state.recurrences.find((r) => findById([r.template], id) != null);
    const node = rec != null ? findById([rec.template], id) : undefined;
    return node != null && node.children.length === 0;
  };

  const openRepeatFor = (recId: RecurrenceId, taskId: TaskId) =>
    setRepeatTarget({ recId, taskId });
  // `r` / `s` in the Recurring view (or on a Today recurrence suggestion) opens
  // the repeat picker for whichever recurrence the cursor belongs to.
  const openRepeatFocused = () => {
    if (focusedRecurrence != null) {
      openRepeatFor(focusedRecurrence.id, focusedRecurrence.template.id);
    } else if (focusedRecurringToday != null) {
      openRepeatFor(focusedRecurringToday.id, focusedRecurringToday.template.id);
    }
  };
  const acceptRecurringToday = () => {
    if (focusedRecurringToday != null) acceptRecurrence(focusedRecurringToday.id, today);
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

  // ── Scheduling (the `s` picker + the detail panel's chips) ────────
  const applyScheduleTo = (ids: TaskId[], choice: ScheduleChoice) => {
    if (ids.length === 0) return;
    if (typeof choice === "object") return setPlannedForMany(ids, choice.date);
    switch (choice) {
      case "today":
        return setPlannedForMany(ids, today);
      case "tomorrow":
        return setPlannedForMany(ids, addDays(today, 1));
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

  // Deliberate schedule sets (picker, palette, panel) on a task with subtasks
  // offer to carry the subtree along. Default is no — Enter and esc both apply
  // the choice to just the targeted task(s); each branch is one store update,
  // so a single ⌘z reverts it entirely.
  const applyScheduleAsking = (ids: TaskId[], choice: ScheduleChoice) => {
    const subtree: TaskId[] = [];
    for (const id of ids) {
      const t = findById(state.tasks, id);
      // Only cascade the schedule onto still-open subtasks. Including completed
      // or won't-do ones would stamp them with today's date and resurface them
      // in Today as if they were just done — see isOpen (excludes both).
      if (t != null) walk(t.children, (x) => { if (isOpen(x)) subtree.push(x.id); });
    }
    if (subtree.length === 0) return applyScheduleTo(ids, choice);
    setConfirm({
      title: subtree.length === 1 ? "Also schedule its subtask?" : `Also schedule its ${subtree.length} subtasks?`,
      body: "Subtasks keep their own schedules unless you include them (y).",
      confirmLabel: "Subtasks too",
      cancelLabel: "Just this task",
      tone: "neutral",
      enterAction: "cancel",
      onConfirm: () => applyScheduleTo([...ids, ...subtree], choice),
      onCancel: () => applyScheduleTo(ids, choice),
    });
  };
  const applySchedule = (choice: ScheduleChoice) => applyScheduleAsking(actionTargets(), choice);

  // t / ⇧t walk the schedule ladder (the s-picker's options in order, wrapping).
  // Accept flows stay special: on a recurrence suggestion (or in Recurring) t
  // still accepts today's occurrence, and on a "Suggested for today" row t
  // accepts the suggestion — a real today commitment — instead of stepping the
  // fuzzy horizon it came from. Steppers never prompt about subtasks; they're
  // rapid-fire keys, and the picker is the deliberate path.
  const stepFocusedSchedule = (dir: 1 | -1) => {
    if (focusedRecurringToday != null) {
      if (dir === 1) acceptRecurringToday();
      return;
    }
    if (view === "recurring") {
      if (dir === 1 && focusedRecurrence != null) acceptRecurrence(focusedRecurrence.id, today);
      return;
    }
    const ids = actionTargets();
    if (ids.length === 0) return;
    const suggested = new Set(suggestedTasks.map((t) => t.id));
    // Group by destination rung so a multi-selection stays one update per rung.
    const groups = new Map<ScheduleStep, TaskId[]>();
    for (const id of ids) {
      const t = findById(state.tasks, id);
      if (t == null) continue;
      const next =
        dir === 1 && suggested.has(id) ? "today" : stepSchedule(scheduleStep(t, today), dir);
      const g = groups.get(next);
      if (g != null) g.push(id);
      else groups.set(next, [id]);
    }
    for (const [step, group] of groups) applyScheduleTo(group, step);
  };

  // [ / ] — the home view's period tab strip.
  const stepPeriodTab = (dir: 1 | -1) => {
    if (zoom != null) return; // zoom ignores date windows; tabs are hidden there
    if (view !== "today") {
      setView("today");
      return;
    }
    const i = PERIODS.indexOf(period);
    setPeriod(PERIODS[Math.min(Math.max(i + dir, 0), PERIODS.length - 1)]);
  };
  // The picker's current-state dot: "today" / a horizon bucket / "inbox" (null = a specific date).
  const scheduleTag =
    focusedTask == null
      ? null
      : focusedTask.plannedFor === today
        ? "today"
        : focusedTask.plannedFor === addDays(today, 1)
          ? "tomorrow"
          : focusedTask.plannedFor != null
            ? null
            : taskBucket(focusedTask, today);
  // Who the schedule picker acts on: a board leftover when pushing from the
  // board, otherwise the normal outline selection/cursor.
  const scheduleTargetIds =
    boardScheduleId != null
      ? findById(state.tasks, boardScheduleId) != null
        ? [boardScheduleId]
        : []
      : actionTargets();

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
        const newId = withPeriodSchedule(
          addTaskAtProjectStart(focusedProjectId, "", defaultPlannedFor())
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
    reorderUp: () => {
      reorderAcrossProjects(actionTargets(), "up", visibleTaskIds);
      bumpScroll();
    },
    reorderDown: () => {
      reorderAcrossProjects(actionTargets(), "down", visibleTaskIds);
      bumpScroll();
    },
    // → expands a collapsed project/task first (outliner convention), then
    // descends; only opens the details panel when there's nothing to expand.
    panelOpen: () => {
      if (view === "recurring") {
        if (
          focusedTaskId != null &&
          (focusedRecurringNode?.children.length ?? 0) > 0 &&
          collapsed.has(focusedTaskId)
        ) {
          toggleCollapsedFor(focusedTaskId);
          return;
        }
        setSelection((s) => moveSelection(s, flatIds, "down", false));
        return;
      }
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
      if (view === "recurring") {
        if (
          focusedTaskId != null &&
          (focusedRecurringNode?.children.length ?? 0) > 0 &&
          !collapsed.has(focusedTaskId)
        ) {
          toggleCollapsedFor(focusedTaskId);
          return;
        }
        if (focusedTaskId != null && focusedRecurrence != null) {
          const parent = findParentId([focusedRecurrence.template], focusedTaskId);
          if (parent != null) setFocus(parent);
        }
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
      if (focusedRecurringToday != null) return acceptRecurringToday();
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
      // In the Recurring view "new" builds recurrence definitions and their steps:
      // nothing focused → a new recurrence; a root → its first step; a step → a
      // sibling step. Top-level rows are always full recurrences, never stray tasks.
      if (view === "recurring") {
        if (focusedTaskId == null) return beginEdit(createRecurrence("", defaultRule(today)).taskId);
        return beginEdit(addRecurrenceStep(focusedTaskId, focusedIsRecurrenceRoot ? "child" : "sibling"));
      }
      if (focusedTaskId != null) return beginEdit(withPeriodSchedule(addTaskAfter(focusedTaskId, "", defaultPlannedFor())));
      if (focusedProjectId != null) {
        setProjectCollapsed(focusedProjectId, false);
        return beginEdit(withPeriodSchedule(addTaskAtProjectStart(focusedProjectId, "", defaultPlannedFor())));
      }
      // Nothing focused but zoomed in: the new task belongs to the zoom root.
      if (zoom?.kind === "task") return beginEdit(withPeriodSchedule(addChild(zoom.id, "", defaultPlannedFor())));
      if (zoom?.kind === "project") return beginEdit(withPeriodSchedule(addTaskAtProjectStart(zoom.id, "", defaultPlannedFor())));
      beginEdit(withPeriodSchedule(addTaskAfter(null, "", defaultPlannedFor())));
    },
    taskToggle: () => {
      if (focusedRecurringToday != null) return acceptRecurringToday();
      if (view === "recurring") return; // recurrence templates aren't completable
      const ids = actionTargets();
      if (ids.length === 0) return;
      if (ids.length === 1) return toggleComplete(ids[0]);
      const allDone = ids.every((id) => findById(state.tasks, id)?.completed);
      setCompletedMany(ids, !allDone);
    },
    scheduleLater: () => stepFocusedSchedule(1),
    scheduleEarlier: () => stepFocusedSchedule(-1),
    taskPeek: () => {
      if (focusedTaskId == null) return;
      setPeekId((p) => (p === focusedTaskId ? null : focusedTaskId));
    },
    taskIndent: () => {
      if (focusedRecurringToday != null) return; // don't restructure a suggestion
      if (view === "recurring") {
        if (focusedTaskId != null) indentRecurringInView(focusedTaskId);
        return;
      }
      // With the detail panel open (preview), Tab dives into the notes editor
      // instead of indenting — focus leaves the list and lands in the panel.
      if (showPanel && focusedTaskId != null && !reckoningActive && view !== "trash") {
        setEditNotesSignal((n) => n + 1);
        return;
      }
      if (focusedTaskId != null) indentInView(focusedTaskId);
    },
    taskOutdent: () => {
      if (focusedRecurringToday != null) return;
      if (view === "recurring") {
        if (focusedTaskId != null) outdentRecurrenceNode(focusedTaskId);
        return;
      }
      if (focusedTaskId != null) outdent(focusedTaskId);
    },
    taskTrash: () => {
      if (focusedRecurringToday != null) return; // never trash a template from Today
      if (view === "recurring") {
        const id = focusedTaskId;
        if (id == null) return;
        const rootWithSteps =
          focusedIsRecurrenceRoot && (focusedRecurringNode?.children.length ?? 0) > 0;
        const doRemove = () => {
          const next = selectAfterRemoving(selection, flatIds, new Set([id]));
          removeRecurrenceNode(id);
          setSelection(next);
        };
        if (!rootWithSteps) return doRemove();
        setConfirm({
          title: "Delete this recurring task and its steps?",
          body: "The definition is removed. Tasks already added to Today are untouched.",
          confirmLabel: "Delete",
          onConfirm: doRemove,
        });
        return;
      }
      const ids = actionTargets();
      if (ids.length === 0) return;
      const targets = ids
        .map((id) => findById(state.tasks, id))
        .filter((t): t is Task => t != null);
      // Backspace escalates by state: open → won't-do → trash. As long as any
      // target is still open, the first press marks the open ones "won't do"
      // (resolved, but kept with a reason). Only once every target is already
      // resolved does the next press take them to the Trash.
      const allResolved = targets.length > 0 && targets.every((t) => !isOpen(t));
      if (!allResolved) {
        const openIds = targets.filter((t) => isOpen(t)).map((t) => t.id);
        if (openIds.length === 0) return;
        if (openIds.length === 1) {
          markWontDo(openIds[0]);
          setFocus(openIds[0]);
          setReasonEditId(openIds[0]); // one skip → capture a reason inline
        } else {
          markWontDoMany(openIds);
        }
        return;
      }
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
      if (view === "recurring") {
        if (focusedTaskId != null && (focusedRecurringNode?.children.length ?? 0) > 0) {
          toggleCollapsedFor(focusedTaskId);
        }
        return;
      }
      if (focusedProjectId != null) {
        if (view !== "projects") toggleProjectCollapsed(focusedProjectId);
        return;
      }
      if (focusedTaskId == null) return;
      const t = findById(filtered, focusedTaskId);
      if (t != null && t.children.length > 0) toggleCollapsedFor(focusedTaskId);
    },
    taskCurrent: () => {
      // Definitions and Today suggestions aren't real tasks — they can't be "current".
      if (view === "recurring" || focusedRecurringToday != null) return;
      if (focusedTaskId == null) return;
      setCurrentTask(state.currentTaskId === focusedTaskId ? null : focusedTaskId);
    },
    // `w` = "won't do · why": edit the skip reason inline. On an open task it
    // first marks it won't-do (a reason presupposes the state); on a completed or
    // non-task row it's inert.
    taskReason: () => {
      if (view === "recurring" || focusedRecurringToday != null) return;
      if (focusedTaskId == null) return;
      const t = findById(state.tasks, focusedTaskId);
      if (t == null) return;
      if (t.wontDo == null) {
        if (!isOpen(t)) return; // a completed task isn't "won't do"
        markWontDo(focusedTaskId);
      }
      setFocus(focusedTaskId);
      setReasonEditId(focusedTaskId);
    },
    zoomIn: () => {
      if (view === "recurring") return; // no zoom into recurrence definitions (v1)
      if (focusedProjectId != null) zoomInto({ kind: "project", id: focusedProjectId });
      else if (focusedTaskId != null) zoomInto({ kind: "task", id: focusedTaskId });
    },
    moveEnter: () => {
      if (view === "recurring") return;
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
      // In the Recurring view (or on a Today recurrence), `s` sets the repeat.
      if (view === "recurring" || focusedRecurringToday != null) return openRepeatFocused();
      if (actionTargets().length > 0) setShowSchedule(true);
    },
    repeatOpen: openRepeatFocused,
    // Toggle the Later view's grouping (by date / by project). No-op elsewhere,
    // since the layout only exists in the Later (backlog) view.
    toggleLaterLayout: () => {
      if (view === "backlog") setLaterLayout((l) => (l === "date" ? "project" : "date"));
    },
    gotoView: (v: ViewKind) => () => {
      setZoom(null); // picking a view leaves focus mode
      if (v === "today") setPeriod("today"); // 1 = the home tab; [ / ] reach the rest
      setView(v);
    },
    // [ / ] walk the home view's period tabs (clamped at the ends). From another
    // view they return home first, to whatever tab was left open.
    periodNext: () => stepPeriodTab(1),
    periodPrev: () => stepPeriodTab(-1),
    dismiss: () => {
      if (confirm != null) setConfirm(null);
      else if (repeatTarget != null) setRepeatTarget(null);
      else if (showHelp) setShowHelp(false);
      else if (showPalette) setShowPalette(false);
      else if (showSchedule) {
        setShowSchedule(false);
        setBoardScheduleId(null);
      } else if (showEstimate) setShowEstimate(false);
      else if (mode === "move") exitMove();
      else if (reasonEditId != null) setReasonEditId(null);
      else if (editingProjectId != null) setEditingProjectId(null);
      else if (editingId != null) setEditingId(null);
      else if (peekId != null) setPeekId(null);
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

  // ── Planning board (the reckoning's board skin) ───────────────────
  // The board is a two-way triage: `→` pulls a leftover into today, `←` sends a
  // today task back to the leftovers, and `Tab` switches columns. The shared
  // verbs (later / done / drop / estimate) act on whichever column is active.
  const boardActiveId = (): TaskId | null =>
    boardColumn === "left" ? reckCursorId : todayCursorId;
  // Move the cursor forward past a just-resolved task, in whichever column it sat.
  const advanceBoardCursorPast = (id: TaskId) => {
    if (leftovers.some((t) => t.id === id)) {
      advanceReckCursorPast(id);
    } else {
      const ids = todayOpenLeaves.map((t) => t.id);
      const i = ids.indexOf(id);
      setTodayCursorId(ids[i + 1] ?? ids[i - 1] ?? null);
    }
  };
  const boardPull = (id: TaskId) => {
    advanceBoardCursorPast(id);
    keepForToday(id, reckReason || null); // leftover → today (bumps carried, logs "kept")
  };
  const boardSendBack = (id: TaskId) => {
    advanceBoardCursorPast(id);
    // Back to the leftovers pile: a day overdue is enough to make it a leftover
    // again (its exact past date is already water under the bridge).
    setPlannedForMany([id], addDays(today, -1));
  };
  const boardComplete = (id: TaskId) => {
    advanceBoardCursorPast(id);
    setCompleted(id, true, reckReason || null);
  };
  const boardDrop = (id: TaskId) => {
    advanceBoardCursorPast(id);
    trashTask(id, { reason: reckReason || null, log: true });
  };
  const boardPushToLater = (id: TaskId) => {
    setBoardScheduleId(id);
    setShowSchedule(true);
  };
  const boardSetEstimate = (id: TaskId, blocks: number) =>
    setEstimatedMinutesMany([id], minutesFromBlocks(blocks));

  const moveBoardCursor = (dir: "up" | "down") => {
    if (boardColumn === "left") return moveReckCursor(dir);
    const ids = todayOpenLeaves.map((t) => t.id);
    if (ids.length === 0) return;
    const i = todayCursorId == null ? -1 : ids.indexOf(todayCursorId);
    const next = i < 0 ? 0 : Math.min(Math.max(i + (dir === "down" ? 1 : -1), 0), ids.length - 1);
    setTodayCursorId(ids[next]);
  };
  const switchBoardColumn = () => {
    if (boardColumn === "left") {
      if (todayOpenLeaves.length === 0) return; // nothing to switch to
      if (todayCursorId == null || !todayOpenLeaves.some((t) => t.id === todayCursorId)) {
        setTodayCursorId(todayOpenLeaves[0].id);
      }
      setBoardColumn("right");
    } else {
      if (leftovers.length === 0) return;
      setBoardColumn("left");
    }
  };
  // Keyboard verbs act on the active column's cursor (mouse chips pass a row id).
  const boardKey = (fn: (id: TaskId) => void) => () => {
    const id = boardActiveId();
    if (id != null) fn(id);
  };
  const setCursorEstimateBlocks = (blocks: number) => {
    const id = boardActiveId();
    if (id != null) boardSetEstimate(id, blocks);
  };
  const openEstimatePicker = () => {
    if (actionTargets().length > 0) setShowEstimate(true);
  };

  // ── Keyboard wiring ───────────────────────────────────────────────
  const dispatchState: ContextState = {
    showHelp,
    showPalette,
    showSchedule,
    showEstimate,
    showRepeat: repeatTarget != null,
    showConfirm: confirm != null,
    reckoningActive,
    boardMode,
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
    "task.scheduleLater": cmd.scheduleLater,
    "task.scheduleEarlier": cmd.scheduleEarlier,
    "task.peek": cmd.taskPeek,
    "period.next": cmd.periodNext,
    "period.prev": cmd.periodPrev,
    "task.indent": cmd.taskIndent,
    "task.outdent": cmd.taskOutdent,
    "task.trash": cmd.taskTrash,
    "task.collapse": cmd.taskCollapse,
    "task.current": cmd.taskCurrent,
    "task.reason": cmd.taskReason,
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
    "estimate.open": openEstimatePicker,
    "recurrence.repeat": cmd.repeatOpen,
    "later.toggleLayout": cmd.toggleLaterLayout,
    "view.today": cmd.gotoView("today"),
    "view.backlog": cmd.gotoView("backlog"),
    "view.all": cmd.gotoView("all"),
    "view.projects": cmd.gotoView("projects"),
    "view.recurring": cmd.gotoView("recurring"),
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
    // Planning board (context "board").
    "board.toggle": () => setBoardPreferred(!boardMode),
    "board.cursorDown": () => moveBoardCursor("down"),
    "board.cursorUp": () => moveBoardCursor("up"),
    "board.switchColumn": switchBoardColumn,
    "board.pull": () => {
      if (boardColumn === "left" && reckCursorId != null) boardPull(reckCursorId);
    },
    "board.sendBack": () => {
      if (boardColumn === "right" && todayCursorId != null) boardSendBack(todayCursorId);
    },
    "board.push": boardKey(boardPushToLater),
    "board.complete": boardKey(boardComplete),
    "board.breakdown": () => {
      if (boardColumn === "left") cmd.reckBreakdown(); // breakdown is a leftovers action
    },
    "board.drop": boardKey(boardDrop),
    "board.estimate1": () => setCursorEstimateBlocks(1),
    "board.estimate2": () => setCursorEstimateBlocks(2),
    "board.estimate3": () => setCursorEstimateBlocks(3),
    "board.estimate4": () => setCursorEstimateBlocks(4),
    "board.estimate5": () => setCursorEstimateBlocks(5),
    "board.estimate6": () => setCursorEstimateBlocks(6),
    "board.estimate7": () => setCursorEstimateBlocks(7),
    "board.estimate8": () => setCursorEstimateBlocks(8),
    "board.estimateClear": () => setCursorEstimateBlocks(0),
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
    currentId: state.currentTaskId,
    selectedIds: selectedTaskIds,
    editingId,
    reasonEditId,
    peekId,
    collapsed,
    mode,
    movingId,
    scrollTick,
    select: setFocus,
    toggleSelect: (id) => setSelection((s) => toggleSelected(s, id, flatIds)),
    rangeSelect: (id) => setSelection((s) => rangeTo(s, id, flatIds)),
    canDrag: true,
    dragId,
    beginDrag: (id) => setDragId(id),
    endDrag: () => setDragId(null),
    // A target is legal only when a drag is active, it isn't the dragged row,
    // and it isn't inside the dragged row's own subtree (no cycles).
    dropAllowed: (targetId) => {
      if (dragId == null || targetId === dragId) return false;
      const dragged = findById(state.tasks, dragId);
      return dragged == null || findById(dragged.children, targetId) == null;
    },
    dropOn: (targetId, pos) => {
      const id = dragId;
      setDragId(null);
      if (id == null || id === targetId) return;
      const dragged = findById(state.tasks, id);
      // Defensive re-check (the store ops also guard): never move into own subtree.
      if (dragged == null || findById(dragged.children, targetId) != null) return;
      if (pos === "child") moveAsChild(id, targetId);
      else if (pos === "before") moveBefore(id, targetId);
      else moveAfter(id, targetId);
    },
    toggle: toggleComplete,
    reopen: clearWontDo,
    toggleCollapse: toggleCollapsedFor,
    openDetail: openDetailFor,
    togglePeek: (id) => {
      setFocus(id);
      setPeekId((p) => (p === id ? null : id));
    },
    zoomInto: (id) => zoomInto({ kind: "task", id }),
    startEdit: (id) => {
      setFocus(id);
      setEditingProjectId(null);
      setEditingId(id);
    },
    startReason: (id) => {
      setFocus(id);
      setReasonEditId(id);
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
    commitReason: (id, reason) => {
      setWontDoReason(id, reason);
      setReasonEditId(null);
    },
  };

  // Same surface, but for the Recurring view: every callback routes to recurrence
  // actions on the template tree, never to `tasks`. Completion/plan/zoom/detail
  // don't apply to definitions, so they're inert.
  const commitRecurrence = (id: TaskId, raw: string) => setRecurrenceText(id, parseCapture(raw).text);
  const removeRecurrenceWithNeighbor = (id: TaskId) => {
    const next = selectAfterRemoving(selection, flatIds, new Set([id]));
    removeRecurrenceNode(id);
    setSelection(next);
  };
  const recurrenceEditor: Editor = {
    view,
    today,
    bucketed: false,
    cursorId: focusedTaskId,
    currentId: null, // recurrence templates are never "current"
    selectedIds: selectedTaskIds,
    editingId,
    reasonEditId: null, // recurrence templates are never "won't do"
    peekId: null, // templates carry no notes worth peeking; the panel covers them
    togglePeek: () => {},
    collapsed,
    mode,
    movingId,
    scrollTick,
    select: setFocus,
    toggleSelect: setFocus, // recurrence view navigates one template at a time
    rangeSelect: setFocus,
    canDrag: false,
    dragId: null,
    beginDrag: () => {},
    endDrag: () => {},
    dropAllowed: () => false,
    dropOn: () => {},
    toggle: () => {},
    reopen: () => {},
    toggleCollapse: toggleCollapsedFor,
    openDetail: () => {},
    zoomInto: () => {},
    startEdit: (id) => {
      setFocus(id);
      setEditingProjectId(null);
      setEditingId(id);
    },
    startReason: () => {},
    commit: commitRecurrence,
    indentEditing: (id, raw) => {
      commitRecurrence(id, raw);
      indentRecurringInView(id);
    },
    outdentEditing: (id, raw) => {
      commitRecurrence(id, raw);
      outdentRecurrenceNode(id);
    },
    exitUp: (id, raw) => {
      const removed = isUntitledRecurringNode(id, raw);
      if (removed) removeRecurrenceNode(id);
      else commitRecurrence(id, raw);
      exitEditTo(id, "up", removed);
    },
    exitDown: (id, raw) => {
      const removed = isUntitledRecurringNode(id, raw);
      if (removed) removeRecurrenceNode(id);
      else commitRecurrence(id, raw);
      exitEditTo(id, "down", removed);
    },
    toggleFromEdit: (id, raw) => commitRecurrence(id, raw),
    exitEdit: (id, raw) => {
      if (isUntitledRecurringNode(id, raw)) removeRecurrenceWithNeighbor(id);
      else commitRecurrence(id, raw);
      setEditingProjectId(null);
      setEditingId(null);
    },
    removeAndExit: (id) => {
      removeRecurrenceWithNeighbor(id);
      setEditingProjectId(null);
      setEditingId(null);
    },
    commitReason: () => {},
  };

  // ── Detail panel handlers (content only) ──────────────────────────
  const detailHandlers: DetailHandlers = {
    onCommitNotes: (id, text) => setNotes(id, text),
    onToggle: (id) => toggleComplete(id),
    onToggleWontDo: (id) => toggleWontDo(id),
    onCommitReason: (id, reason) => setWontDoReason(id, reason),
    onPriority: (id, p: TaskPriority) => setPriority(id, p),
    onProject: (id, projectId) => setProjectForMany([id], projectId),
    onSchedule: (id, choice) => applyScheduleTo([id], choice),
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
    // In the Recurring view, capture creates a recurrence definition (default:
    // every day) — the user then adds steps (o) and sets the repeat (r).
    if (view === "recurring") {
      setFocus(createRecurrence(p.text, defaultRule(today)).taskId);
      return;
    }
    let id: TaskId;
    if (zoom?.kind === "task") {
      id = withPeriodSchedule(addChild(zoom.id, p.text, defaultPlannedFor()));
    } else if (zoom?.kind === "project") {
      id = withPeriodSchedule(addTaskAtProjectStart(zoom.id, p.text, defaultPlannedFor()));
    } else {
      const projectId = currentProjectId ?? DEFAULT_PROJECT_ID;
      setProjectCollapsed(projectId, false); // keep the captured task visible
      id = withPeriodSchedule(addTaskAfter(null, p.text, defaultPlannedFor(), projectId));
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
        ? withPeriodSchedule(addTaskAtProjectStart(projectId, "", defaultPlannedFor()))
        : withPeriodSchedule(addTaskAfter(afterId, "", defaultPlannedFor(), projectId));
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
    { id: "recurring", label: "Go to Recurring", hint: "5", run: cmd.gotoView("recurring") },
    { id: "trash", label: "Go to Trash", hint: "6", run: cmd.gotoView("trash") },
    { id: "new", label: "New task", hint: "o", run: cmd.taskNew },
    { id: "details", label: "Open details panel", hint: "→", run: openPanel },
    { id: "peek", label: "Peek: unwrap task in place", aliases: ["preview"], hint: "p", run: cmd.taskPeek },
    { id: "toggle", label: "Complete / uncomplete task", hint: "space", run: cmd.taskToggle },
    {
      id: "wontdo",
      label:
        focusedTask?.wontDo != null
          ? "Won’t do · edit the reason"
          : "Won’t do (skip) · add a reason",
      aliases: ["wont do", "skip", "reason"],
      hint: "w",
      run: cmd.taskReason,
    },
    { id: "sched-later", label: "Schedule: one step later", aliases: ["defer", "postpone"], hint: "t", run: cmd.scheduleLater },
    { id: "sched-earlier", label: "Schedule: one step sooner", aliases: ["advance"], hint: "⇧ t", run: cmd.scheduleEarlier },
    {
      id: "current",
      label:
        focusedTaskId != null && state.currentTaskId === focusedTaskId
          ? "Clear current (focus) task"
          : "Set as current (focus) task",
      hint: "c",
      run: cmd.taskCurrent,
    },
    // Scheduling, reachable from the palette (the `s` picker is the keyboard path).
    // All act on the focused/selected task(s); no-op when nothing is targeted.
    { id: "sched-today", label: "Schedule: Today", aliases: ["schedule"], hint: "s t", run: () => applySchedule("today") },
    { id: "sched-tomorrow", label: "Schedule: Tomorrow", aliases: ["schedule"], hint: "s r", run: () => applySchedule("tomorrow") },
    { id: "sched-this-week", label: "Schedule: This week", aliases: ["schedule"], hint: "s w", run: () => applySchedule("thisWeek") },
    { id: "sched-next-week", label: "Schedule: Next week", aliases: ["schedule"], hint: "s e", run: () => applySchedule("nextWeek") },
    { id: "sched-this-month", label: "Schedule: This month", aliases: ["schedule"], hint: "s m", run: () => applySchedule("thisMonth") },
    { id: "sched-next-month", label: "Schedule: Next month", aliases: ["schedule"], hint: "s n", run: () => applySchedule("nextMonth") },
    { id: "sched-someday", label: "Schedule: Someday", aliases: ["schedule"], hint: "s s", run: () => applySchedule("someday") },
    { id: "sched-inbox", label: "Schedule: Inbox (untriage)", aliases: ["schedule"], hint: "s i", run: () => applySchedule("inbox") },
    { id: "estimate", label: "Estimate effort (blocks of ~20m)…", aliases: ["estimate", "effort", "blocks", "time", "size"], hint: "e", run: openEstimatePicker },
    { id: "capacity-up", label: `Daily capacity: raise (${state.dailyCapacityBlocks} → ${state.dailyCapacityBlocks + 1} blocks)`, aliases: ["capacity", "budget"], run: () => setDailyCapacityBlocks(state.dailyCapacityBlocks + 1) },
    { id: "capacity-down", label: `Daily capacity: lower (${state.dailyCapacityBlocks} → ${Math.max(1, state.dailyCapacityBlocks - 1)} blocks)`, aliases: ["capacity", "budget"], run: () => setDailyCapacityBlocks(state.dailyCapacityBlocks - 1) },
    // The home view's period tabs, reachable by name. Deliberately AFTER the
    // Schedule commands: typing "next week" must offer scheduling first.
    ...PERIODS.filter((p) => p !== "today").map((p) => ({
      id: `period-${p}`,
      label: `Go to ${PERIOD_LABELS[p]} (Today tab)`,
      aliases: ["tab", "period"],
      hint: "[ ]",
      run: () => {
        setZoom(null);
        setView("today");
        setPeriod(p);
      },
    })),
    {
      id: "copy-id",
      label: "Copy task ID to clipboard",
      aliases: ["id", "copy id", "task id"],
      run: () => {
        if (focusedTaskId != null) void copyText(focusedTaskId);
      },
    },
    {
      id: "copy-md",
      label: "Copy task data (markdown, with notes)",
      aliases: ["copy", "markdown", "export", "copy task", "task data"],
      run: () => {
        if (focusedTask != null) void copyText(taskToMarkdown(focusedTask, { includeNotes: true }));
      },
    },
    {
      id: "copy-md-titles",
      label: "Copy task data (markdown, titles only)",
      aliases: ["copy", "markdown", "export", "task data"],
      run: () => {
        if (focusedTask != null) void copyText(taskToMarkdown(focusedTask, { includeNotes: false }));
      },
    },
    { id: "move", label: "Move task (re-parent)", hint: "m", run: cmd.moveEnter },
    { id: "zoom", label: "Zoom in / focus", hint: "⌥↵", run: cmd.zoomIn },
    {
      id: "hide-completed",
      label: hideCompleted ? "Show completed & won't-do tasks" : "Hide completed & won't-do tasks",
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
    return (
      <div className="grid h-full place-items-center bg-bg text-ink-faint">
        <span className="text-sm">Loading…</span>
      </div>
    );
  }
  if (loadError != null) {
    return (
      <div className="grid h-full place-items-center bg-bg text-ink">
        <div className="max-w-sm space-y-3 px-6 text-center">
          <h1 className="font-serif text-2xl font-medium">Couldn't load your tasks</h1>
          <p className="text-sm text-ink-soft">{loadError}</p>
          <p className="text-[12px] text-ink-faint">
            Your data on disk is untouched — this was only a read that failed.
          </p>
          <button
            onClick={() => void initStore()}
            className="rounded border border-line bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-2"
          >
            Try again
          </button>
        </div>
      </div>
    );
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
        recurring={state.recurrences.length}
        trash={state.trash.length}
        onSelect={setView}
        onOpenHelp={() => setShowHelp(true)}
        onCycleTheme={cycleTheme}
      >
        {import.meta.env.DEV && (
          <DevControls today={today} override={state.devDateOverride} onSet={setDevDateOverride} />
        )}
        <SyncButton />
      </Sidebar>

      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 overflow-hidden">
            {reckoningActive ? (
              boardMode && breakdownTask == null ? (
                <ReckoningBoard
                  leftovers={boardLeftovers}
                  todayOpen={todayOpenLeaves}
                  capacity={capacity}
                  column={boardColumn}
                  cursorId={reckCursorId}
                  todayCursorId={todayCursorId}
                  today={today}
                  projects={state.projects}
                  onSelect={(id) => {
                    setBoardColumn("left");
                    setReckCursorId(id);
                  }}
                  onSelectToday={(id) => {
                    setBoardColumn("right");
                    setTodayCursorId(id);
                  }}
                  onPull={boardPull}
                  onSendBack={boardSendBack}
                  onPush={boardPushToLater}
                  onComplete={boardComplete}
                  onDrop={boardDrop}
                  onSetEstimate={boardSetEstimate}
                  onCapacityDelta={(d) => setDailyCapacityBlocks(state.dailyCapacityBlocks + d)}
                  onSwitchToCards={() => setBoardPreferred(false)}
                  captureRef={captureRef}
                  onCapture={onReckCapture}
                  onCaptureArrowDown={() => {
                    if (reckCursorId == null && leftovers[0] != null) {
                      setReckCursorId(leftovers[0].id);
                    }
                  }}
                />
              ) : (
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
                onSwitchToBoard={() => setBoardPreferred(true)}
                captureRef={captureRef}
                onCapture={onReckCapture}
                onCaptureArrowDown={() => {
                  if (reckCursorId == null && leftovers[0] != null) {
                    setReckCursorId(leftovers[0].id);
                  }
                }}
              />
              )
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
            ) : view === "recurring" ? (
              <EditorProvider value={recurrenceEditor}>
                <RecurringView
                  groups={recurrenceGroups}
                  captureRef={captureRef}
                  onAdd={onCapture}
                  onCaptureArrowDown={() => flatIds[0] != null && setFocus(flatIds[0])}
                  onCaptureFocus={() => setSelection(emptySelection)}
                  onEditRule={openRepeatFor}
                />
              </EditorProvider>
            ) : (
              <EditorProvider value={editor}>
                <OutlineView
                  view={view}
                  today={today}
                  period={period}
                  onPeriod={setPeriod}
                  groups={displayGroups}
                  suggested={suggestedTasks}
                  recurring={recurringToday}
                  onAcceptRecurring={(recId) => acceptRecurrence(recId, today)}
                  current={activeCurrentTask}
                  onFocusCurrent={() => {
                    if (activeCurrentTask != null) setFocus(activeCurrentTask.id);
                  }}
                  onClearCurrent={() => setCurrentTask(null)}
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
              scheduleTag={scheduleTag}
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
      {showSchedule && scheduleTargetIds.length > 0 && (
        <SchedulePicker
          today={today}
          count={scheduleTargetIds.length}
          current={boardScheduleId != null ? null : scheduleTag}
          onPick={(choice) => {
            if (boardScheduleId != null) {
              // Board "push to later": act on the targeted task, then move the
              // cursor forward (in its column) so the triage keeps flowing.
              advanceBoardCursorPast(boardScheduleId);
              applyScheduleTo([boardScheduleId], choice);
              setBoardScheduleId(null);
            } else {
              applySchedule(choice);
            }
          }}
          onClose={() => {
            setShowSchedule(false);
            setBoardScheduleId(null);
          }}
        />
      )}
      {showEstimate && actionTargets().length > 0 && (
        <EstimatePicker
          count={actionTargets().length}
          current={focusedTask?.estimatedMinutes ?? null}
          onPick={(minutes) => setEstimatedMinutesMany(actionTargets(), minutes)}
          onClose={() => setShowEstimate(false)}
        />
      )}
      {repeatTarget != null && (
        <RepeatPicker
          anchor={today}
          current={state.recurrences.find((r) => r.id === repeatTarget.recId)?.rule ?? null}
          onPick={(rule) => setRecurrenceRule(repeatTarget.recId, rule)}
          onClose={() => setRepeatTarget(null)}
        />
      )}
      {confirm != null && (
        <ConfirmModal
          title={confirm.title}
          body={confirm.body}
          confirmLabel={confirm.confirmLabel}
          cancelLabel={confirm.cancelLabel}
          enterAction={confirm.enterAction}
          tone={confirm.tone}
          onConfirm={() => {
            const req = confirm;
            setConfirm(null);
            req.onConfirm();
          }}
          onCancel={() => {
            const req = confirm;
            setConfirm(null);
            req.onCancel?.();
          }}
        />
      )}
    </div>
  );
}
