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
  autoAcceptRecurrences,
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
  flushPendingSave,
  initStore,
  carryManyTo,
  keepManyForToday,
  logBreakdown,
  markOpened,
  markWontDo,
  markWontDoMany,
  moveAfter,
  moveAsChild,
  moveBefore,
  clearWaiting,
  clearWontDo,
  markWaiting,
  outdent,
  outdentRecurrenceNode,
  postponeManyTo,
  purgeFromTrash,
  recordCommandUse,
  recordDay,
  removeRecurrenceNode,
  renameProject,
  reorder,
  reorderAcrossProjects,
  resetCommandRanking,
  restoreFromTrash,
  restoreBackup,
  getState as getStoreState,
  setWrapAll,
  setHideCompleted,
  setCompleted,
  setCompletedMany,
  setProgressNote,
  stopWorking,
  toggleWorking,
  pauseWorkAt,
  setDailyCapacityBlocks,
  setDevDateOverride,
  setEstimatedMinutesMany,
  setHorizonMany,
  setNotes,
  setPlannedForMany,
  setPresence,
  setProjectForMany,
  setPriority,
  setScheduledAt,
  setRecurrenceProject,
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
  undoThrough,
  redo,
  redoThrough,
  getUndoSteps,
  getRedoSteps,
  undoDepth,
  useStore,
  createHabit,
  deleteHabit,
  markHabit,
  renameHabit,
  setHabitArchived,
  setHabitCue,
  setHabitMeasure,
  setHabitNote,
  moveHabit,
  setHabitPerWeek,
  setKpiValue,
  toggleHabitDone,
  toggleHabitSkip,
  toggleHabitMissed,
  type PostponeTarget,
} from "./store/store";
import {
  DEFAULT_MEASURE,
  cadenceLabel,
  everyLabel,
  formatValue,
  habitsToLog,
  parseHabitName,
  parseKpiName,
  noteOn,
  pendingOn,
  rangeLabel,
  valueOn,
} from "./store/habits";
import { HabitLogPanel } from "./components/HabitCheckList";

function withoutId(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  next.delete(id);
  return next;
}

import { findById, findParentId, getAncestorPath, isLeaf, isLive, isOpen, walk } from "./store/tasks";
import {
  addDays,
  daysBetween,
  monthKey,
  monthKeyOffset,
  todayISO,
  weekKey,
  weekKeyOffset,
} from "./store/dates";
import { defaultRule } from "./store/recurrence";
import { parseCapture } from "./store/capture";
import { taskToMarkdown, sectionsToMarkdown, type MarkdownSection } from "./store/taskMarkdown";
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
  groupTasksByDay,
  PERIOD_LABELS,
  PERIODS,
  resolveZoom,
  scheduleStep,
  stepSchedule,
  waitingOnOthers,
  taskBucket,
  todayCapacity,
  todayLeaves,
  todayProgress,
  todayTally,
  viewPredicate,
  viewTasks,
  VIEW_TITLES,
  zoomParent,
  type Period,
  type ScheduleStep,
  type ViewKind,
  type ZoomTarget,
} from "./selectors";
import { willPromptOnKeep, willPromptOnPostpone } from "./store/deferral";
import { presenceSnapshot } from "./store/presence";
import { isRunning, workingOn } from "./store/work";
import { useWorkAwake } from "./ui/useWorkAwake";
import { SidebarWork } from "./components/WorkClock";
import { currentRun } from "./store/streak";
import { suggestedCapacityBlocks } from "./store/capacity";
import { DayStreak } from "./components/DayStreak";
import {
  emptySelection,
  moveSelection,
  nearestSurvivor,
  rangeTo,
  selectAfterRemoving,
  selectAll,
  selectOne,
  toggleSelected,
  type Selection,
} from "./ui/selection";
import { keymap } from "./keyboard/keymap";
import { useKeyboard } from "./keyboard/useKeyboard";
import type { ContextState } from "./keyboard/types";
import type { Habit, HabitId, HabitMeasure, ISODate, KpiEvery } from "./types";
import { EditorProvider, type Editor } from "./ui/editor";
import { copyText } from "./ui/clipboard";
import { Sidebar } from "./components/Sidebar";
import { SyncButton } from "./components/SyncButton";
import { initAutoSync } from "./sync/desktopSync";
import { OutlineView } from "./views/OutlineView";
import { ProjectsView } from "./views/ProjectsView";
import { RecurringView } from "./views/RecurringView";
import { TaskReviewView, type ReviewRow } from "./views/TaskReviewView";
import { BreakdownPanel } from "./components/BreakdownPanel";
import { TrashView } from "./views/TrashView";
import { HABIT_STRIP_DAYS, HabitsView, type HabitEditing, type HabitField } from "./views/HabitsView";
import { nextTrendRange, type TrendRange } from "./store/habitTrend";
import { RepeatPicker } from "./components/RepeatPicker";
import { DetailPanel, type DetailHandlers } from "./components/DetailPanel";
import { HelpOverlay } from "./components/HelpOverlay";
import { HistoryPanel, buildHistoryRows, type HistoryRow } from "./components/HistoryPanel";
import { LookBackPanel } from "./components/LookBackPanel";
import { buildLookBack } from "./store/lookBack";
import { DevControls } from "./components/DevControls";
import { StatusBar } from "./components/StatusBar";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { SearchPalette } from "./components/SearchPalette";
import { FilterBar } from "./components/FilterBar";
import { matchesFilter, subsequenceMatch } from "./store/search";
import { SchedulePicker, type ScheduleChoice } from "./components/SchedulePicker";
import { splitScheduleVerb, whenOptions, type WhenOption } from "./store/when";
import { ProjectPicker } from "./components/ProjectPicker";
import { EstimatePicker } from "./components/EstimatePicker";
import { CalendarPicker } from "./components/CalendarPicker";
import { gcalTemplateUrl } from "./store/calendar";
import { ConfirmModal, type ConfirmRequest } from "./components/ConfirmModal";
import { BackupPicker } from "./components/BackupPicker";
import { backupKind, backupWhen } from "./ui/backups";
import { coerceState, type BackupFile } from "./store/persistence";
import { runAgentRequest } from "./store/agent";

const THEMES: ThemeName[] = ["slate", "ivory", "carbon", "bordeaux"];

// What the folds read as while the view filter is on: nothing folded.
const NOTHING_COLLAPSED: Set<TaskId> = new Set();
const NO_PROJECTS_COLLAPSED: Set<ProjectId> = new Set();

/**
 * When the task review offers to move the whole overdue pile to the Inbox: a
 * pile this big, or this many days unopened. Either alone is enough — ten
 * overdue tasks is daunting whether you earned them by being away or by
 * over-committing while you were here.
 */
const CATCH_UP_PILE = 10;
const CATCH_UP_DAYS = 3;

interface OutlineProjectRow {
  kind: "project";
  id: OutlineId;
  projectId: ProjectId;
}

interface OutlineTaskRow {
  kind: "task";
  id: OutlineId;
  taskId: TaskId;
  /**
   * Which *render section* the row sits in — a project group, one day inside a
   * multi-day tab, one bucket of Later's by-date layout, the zoom subtree. The
   * point of the key: inside a single section the rendered order IS the tree
   * order, so a reorder can bubble a task through it and have the screen agree.
   *
   * `null` marks rows that belong to no order at all: the passive bands that
   * trail the outline (waiting-on) and the Recurring view's templates. They're focusable, but their tasks were
   * filtered *out* of their group and re-listed at the foot of the view.
   *
   * Reorder has to know the difference. A task in a band is still a sibling in
   * the *tree*, so counting it as a neighbour makes ⌥↑/↓ swap into it — a move
   * that changes the data and nothing on screen. Two horizon children sitting
   * between two of today's, and the shortcut reads as broken until the third
   * press finally clears the run. Same for tasks rendered in another bucket or
   * under another day heading.
   */
  section: string | null;
}

type OutlineRow = OutlineProjectRow | OutlineTaskRow;

export function App() {
  const { state, ready, loadError, saveError } = useStore();
  // Loaded *successfully*. After a failed load `ready` is true too, but the
  // state is the empty placeholder: nothing below may write it or report it.
  const loaded = ready && loadError == null;
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
  // Same idea for "waiting on whom?" — an inline field opened by `b`.
  const [waitingEditId, setWaitingEditId] = useState<TaskId | null>(null);
  // In-place preview (`p`): the row unwraps its full title and shows its notes
  // inline — a lighter look than the side panel. Pinned to one task; moving the
  // cursor or Esc closes it.
  const [peekId, setPeekId] = useState<TaskId | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<ProjectId | null>(null);
  const [collapsedSaved, setCollapsed] = useState<Set<TaskId>>(new Set());
  const [collapsedProjectsSaved, setCollapsedProjects] = useState<Set<ProjectId>>(new Set());
  // The view filter (⌘f): null while its bar is closed. A non-blank query
  // narrows the current view to the tasks that match plus their ancestors, and
  // opens every collapsed parent and project while it does — a match hidden
  // under a fold is a match you can't see. The saved folds come back with the
  // filter's end; nothing about them is written while it's on.
  const [viewFilter, setViewFilter] = useState<string | null>(null);
  const filterQuery = viewFilter?.trim() ?? "";
  const filtering = filterQuery !== "";
  const filterInputRef = useRef<HTMLInputElement>(null);
  const collapsed = filtering ? NOTHING_COLLAPSED : collapsedSaved;
  const collapsedProjects = filtering ? NO_PROJECTS_COLLAPSED : collapsedProjectsSaved;
  const [zoom, setZoom] = useState<ZoomTarget | null>(null);
  // Persisted (per device) — it used to reset on every launch.
  const hideCompleted = state.hideCompleted;
  // Bumped on a keyboard reorder so the focused row scrolls back into view.
  const [scrollTick, setScrollTick] = useState(0);
  const bumpScroll = () => setScrollTick((n) => n + 1);
  // The task currently being dragged (mouse DnD), or null.
  const [dragId, setDragId] = useState<TaskId | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  // The history panel's cursor lives here, like every other list's: the keymap's
  // "history" context drives it, the panel just renders it.
  const [showHistory, setShowHistory] = useState(false);
  // The weekly look-back — everything the app already knew and never told you.
  const [showLookBack, setShowLookBack] = useState(false);
  const [historySel, setHistorySel] = useState(0);
  const [showPalette, setShowPalette] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showProject, setShowProject] = useState(false);
  const [showEstimate, setShowEstimate] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  // The task the calendar picker is acting on — captured at open so it can't
  // shift under the modal (the picker owns the keyboard, but be explicit).
  const [calendarTargetId, setCalendarTargetId] = useState<TaskId | null>(null);
  // Desktop only: whether a service-account key is present so events create
  // silently (vs. opening a prefilled Google Calendar link). Drives the picker's
  // hint and which path `onConfirm` takes.
  const [calendarConnected, setCalendarConnected] = useState(false);
  // A pending *postponement*: the schedule picker opened from the task review
  // (`s`). On a task that came due (overdue or today's) picking a day bumps
  // postponedCount and logs it, where plain rescheduling doesn't; on a week
  // task it is plain rescheduling.
  const [postponeReq, setPostponeReq] = useState<{ ids: TaskId[]; counted: boolean } | null>(null);
  const [repeatTarget, setRepeatTarget] = useState<{ recId: RecurrenceId; taskId: TaskId } | null>(
    null
  );
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  // "Restore a backup…" (desktop): the list being picked from, and what the
  // last restore did (or why it didn't), shown in a banner until dismissed.
  const [backupList, setBackupList] = useState<BackupFile[] | null>(null);
  const [restoreNotice, setRestoreNotice] = useState<{ text: string; failed: boolean } | null>(null);
  const [laterLayout, setLaterLayout] = useState<"date" | "project">("date");
  const [showPanel, setShowPanel] = useState(false);
  // Bumped to ask an open detail panel to dive from preview into its notes editor
  // (Tab from the list). The panel reacts to changes only, so the value is opaque.
  const [editNotesSignal, setEditNotesSignal] = useState(0);
  // Bumped by ⌘k → "Currently…" to open the in-progress banner's note.
  const [workNoteSignal, setWorkNoteSignal] = useState(0);
  // Read by DetailPanel only when it mounts: whether that open was a → dive.
  const [panelEditOnOpen, setPanelEditOnOpen] = useState(false);
  // One-shot: true only for the commit that mounts the panel (DetailPanel seeds
  // its ref then). Left on, any later remount — the cursor passing over a
  // project row and `n` making a task — would dive into the notes and steal the
  // focus from the new task's title.
  useEffect(() => {
    if (panelEditOnOpen) setPanelEditOnOpen(false);
  }, [panelEditOnOpen]);
  const [breakingDownId, setBreakingDownId] = useState<TaskId | null>(null);
  // The task review: every task waiting on a decision, opened from ⌘k or the
  // overdue banner — never on its own.
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewCursorId, setReviewCursorId] = useState<TaskId | null>(null);
  // An optional "why", attached to whichever verb comes next.
  const [reviewReason, setReviewReason] = useState("");
  // Set aside in this pass ("later"): not a decision the app records anywhere
  // (no count, no log line), it only lets the pass move on. Lives as long as
  // this review does.
  const [reviewLater, setReviewLater] = useState<ReadonlySet<string>>(() => new Set());
  // Bumped to ask the focused row to open (and focus) its optional reason field.
  const [reviewReasonTick, setReviewReasonTick] = useState(0);

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
  // Closing the window or quitting inside the 200 ms save debounce would drop
  // the last edit: write it on the way out.
  useEffect(() => {
    window.addEventListener("pagehide", flushPendingSave);
    window.addEventListener("beforeunload", flushPendingSave);
    return () => {
      window.removeEventListener("pagehide", flushPendingSave);
      window.removeEventListener("beforeunload", flushPendingSave);
    };
  }, []);
  // Auto cloud-sync (desktop only; no-op elsewhere). Rides the store's persist
  // hook, so every change syncs without per-action wiring.
  useEffect(() => initAutoSync(), []);
  // Does "Add to calendar" create events silently (service-account key present)
  // or fall back to opening a prefilled link? Ask the desktop bridge once.
  useEffect(() => {
    const bridge = window.execute;
    if (bridge?.calendarStatus == null) return;
    void bridge
      .calendarStatus()
      .then((s) => setCalendarConnected(s?.connected === true))
      .catch(() => setCalendarConnected(false));
  }, []);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", state.theme);
  }, [state.theme]);
  // How long the app went unopened. Captured *before* markOpened overwrites the
  // stamp, and deliberately not depending on `lastOpenedDate` — this must read
  // the pre-mark value exactly once per day change, or it would always see zero.
  const [daysAway, setDaysAway] = useState(0);
  useEffect(() => {
    if (!loaded) return;
    const last = state.lastOpenedDate;
    setDaysAway(last == null || last >= today ? 0 : daysBetween(last, today) - 1);
    markOpened(today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, today]);
  // Recurring tasks are real tasks: on each day one fires, its task is created.
  // Only on load and day change — a repeat made today starts out untitled, so
  // its first task comes tomorrow (`t` in Recurring takes it on today).
  useEffect(() => {
    if (!loaded) return;
    autoAcceptRecurrences(today);
  }, [loaded, today]);

  // ── Overdue ───────────────────────────────────────────────────────
  // Work left on an earlier day. Nothing gates on it any more: it stays in
  // Today, marked with how late it is, and the banner over Today offers the
  // task review.
  const leftovers = useMemo(
    () => leftoverLeaves(state.tasks, today),
    [state.tasks, today]
  );
  const breakdownTask =
    breakingDownId != null ? findById(state.tasks, breakingDownId) ?? null : null;

  // ── Coming back to a pile ─────────────────────────────────────────
  // After a week away the overdue pile is exactly what makes people quit, at
  // the moment motivation is lowest. So past either threshold the review
  // offers one recorded decision that clears the pile into the Inbox.
  const lapseOffered = leftovers.length >= CATCH_UP_PILE || daysAway >= CATCH_UP_DAYS;
  const catchUp = () => {
    const ids = leftovers.map((t) => t.id);
    if (ids.length === 0) return;
    setConfirm({
      title: `Move ${ids.length} overdue task${ids.length === 1 ? "" : "s"} to the Inbox?`,
      body: "Each keeps its history and its postpone count — that's the difference between an amnesty and a leak. Today starts clean, and ⌘Z undoes this.",
      confirmLabel: "Move them",
      cancelLabel: "One at a time",
      tone: "neutral",
      enterAction: "cancel",
      onConfirm: () => {
        postponeManyTo(
          ids,
          { plannedFor: null, horizon: null },
          daysAway > 0 ? `catching up after ${daysAway} days away` : "catching up"
        );
      },
    });
  };

  const capacity = useMemo(
    () => todayCapacity(state.tasks, today, state.dailyCapacityBlocks),
    [state.tasks, today, state.dailyCapacityBlocks]
  );
  // Open work committed to today — the menu bar's count and the review's list.
  const todayOpenLeaves = useMemo(
    () => todayLeaves(state.tasks, today).filter(isOpen),
    [state.tasks, today]
  );
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
  const visibleTasks = useMemo(() => {
    const shown = hideCompleted
      ? filterTreeEffective(filtered, (t) => viewPredicate(view, today, period)(t) && isOpen(t))
      : filtered;
    // The row being edited stays whatever its title says, so a task made with
    // `n` under the filter doesn't vanish before you've named it.
    return filtering
      ? filterTree(shown, (t) => t.id === editingId || matchesFilter(t, filterQuery))
      : shown;
  }, [filtered, hideCompleted, view, today, period, filtering, filterQuery, editingId]);
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
  const projectIndex = useMemo(() => {
    const all = projectSummaries(state.tasks, state.projects, today);
    return filtering
      ? all.filter((s) => subsequenceMatch(filterQuery, s.project.name) != null)
      : all;
  }, [state.tasks, state.projects, today, filtering, filterQuery]);
  // Zoom (Workflowy-style hoist) overrides the project-grouped outline: when set,
  // the view shows only the focused subtree, with breadcrumbs back out.
  const zoomFocus = useMemo(() => {
    if (zoom == null) return null;
    const z = resolveZoom(state.tasks, state.projects, zoom, VIEW_TITLES[view]);
    if (z == null || (!hideCompleted && !filtering)) return z;
    return {
      ...z,
      subtree: filterTree(
        z.subtree,
        (t) =>
          (!hideCompleted || isOpen(t)) && (t.id === editingId || matchesFilter(t, filterQuery))
      ),
    };
  }, [zoom, state.tasks, state.projects, view, hideCompleted, filtering, filterQuery, editingId]);
  // Blocked work, trailing Today like the other passive groups. Kept visible so
  // stepping out of the day's maths can't also mean stepping off the screen.
  const waitingTasks = useMemo(
    () =>
      view === "today" && period === "today" && zoom == null
        ? waitingOnOthers(state.tasks, today).filter((t) => matchesFilter(t, filterQuery))
        : [],
    [view, period, zoom, state.tasks, today, filterQuery]
  );
  // Recurrence definitions, grouped by pattern for the Recurring view.
  const recurrenceGroups = useMemo(
    () =>
      view === "recurring"
        ? groupRecurrencesByRule(
            // A template stays whole when anything in it matches: its steps
            // are one routine, not tasks of their own.
            state.recurrences.filter(
              (rec) => filterTree([rec.template], (t) => matchesFilter(t, filterQuery)).length > 0
            )
          )
        : [],
    [view, state.recurrences, filterQuery]
  );
  const outlineRows = useMemo<OutlineRow[]>(() => {
    /** Flatten one render section's tasks into rows, all stamped with its key. */
    const sectionRows = (tasks: Task[], section: string | null): OutlineTaskRow[] =>
      flattenRows(tasks, collapsed).map((row) => ({
        kind: "task" as const,
        id: row.task.id,
        taskId: row.task.id,
        section,
      }));

    if (zoomFocus != null) return sectionRows(zoomFocus.subtree, "zoom");
    if (view === "projects") {
      // The index navigates over project rows only — no task rows.
      return projectIndex.map(({ project }) => ({
        kind: "project" as const,
        id: projectRowId(project.id),
        projectId: project.id,
      }));
    }
    if (view === "recurring") {
      // Navigate over the recurrence templates (roots + their steps). These
      // aren't tasks in the tree, so there is no order for ⌥↑/↓ to move in.
      return recurrenceGroups.flatMap((group) =>
        group.recurrences.flatMap((rec) => sectionRows([rec.template], null))
      );
    }
    if (usingBuckets) {
      // By-date "Later": bucket headers aren't focusable; navigate the tasks.
      // Each bucket is its own section — a task's raw neighbour often sits in a
      // different bucket entirely, and swapping into it moves nothing on screen.
      return bucketGroups.flatMap((group) =>
        sectionRows(group.tasks, `bucket:${group.meta.id}`)
      );
    }
    const rows: OutlineRow[] = displayGroups.flatMap((group) => {
      const key = `project:${group.project.id}`;
      // Multi-day tabs re-sort a group under day headings, so each day is its
      // own section; a single-day tab renders the group in tree order as-is.
      const parts =
        group.sections != null
          ? group.sections.map((s) => ({ key: `${key}:${s.day ?? "anytime"}`, tasks: s.tasks }))
          : [{ key, tasks: group.tasks }];
      return [
        {
          kind: "project" as const,
          id: projectRowId(group.project.id),
          projectId: group.project.id,
        },
        ...(collapsedProjects.has(group.project.id)
          ? []
          : parts.flatMap((part) => sectionRows(part.tasks, part.key))),
      ];
    });
    // Blocked rows trail the project groups, matching their render order.
    // Sectionless: focusable, but in no sibling order.
    for (const t of waitingTasks) {
      rows.push({ kind: "task" as const, id: t.id, taskId: t.id, section: null });
    }
    return rows;
  }, [zoomFocus, view, projectIndex, displayGroups, usingBuckets, bucketGroups, collapsed, collapsedProjects, waitingTasks, recurrenceGroups]);
  const flatIds = useMemo(() => outlineRows.map((r) => r.id), [outlineRows]);
  const flatKey = flatIds.join(",");
  /**
   * The neighbourhood a keyboard reorder may move `anchorId` through: every task
   * rendered in the same section as it (see `section` on OutlineTaskRow), which
   * is exactly the run of rows whose on-screen order matches their tree order.
   * Empty when the cursor is on a sectionless row — a blocked task, a
   * recurrence template — where there is no order to move in and the
   * only honest answer is to do nothing.
   *
   * Reorder passes this as its `visible` set, so filtered-out siblings stay
   * pinned and ⌥↑/↓ always lands one *visible* slot away.
   */
  const reorderScopeFor = (anchorId: TaskId | null): Set<TaskId> => {
    const anchor =
      anchorId == null
        ? undefined
        : outlineRows.find(
            (r): r is OutlineTaskRow => r.kind === "task" && r.taskId === anchorId
          );
    if (anchor?.section == null) return new Set();
    return new Set(
      outlineRows.flatMap((r) =>
        r.kind === "task" && r.section === anchor.section ? [r.taskId] : []
      )
    );
  };
  // Crossing the divider into the neighbouring project is only meaningful where
  // the outline *is* the project groups, top to bottom. Zoom shows one subtree,
  // Later's buckets and the multi-day day headings re-sort the groups into runs
  // that stop short of them — in those, ⌥↑/↓ stays inside the section.
  const reorderCrossesProjects = zoomFocus == null && !usingBuckets && !multiDayPeriod;

  const progress = useMemo(() => todayProgress(state.tasks, today), [state.tasks, today]);
  const backlog = useMemo(() => backlogCount(state.tasks), [state.tasks]);

  // ── The closing streak ────────────────────────────────────────────
  // A day is *closed* when every commitment it carried has an outcome and
  // nothing is overdue — not when everything got finished. Recorded as the day
  // is lived, because it can't be reconstructed afterwards: once a leftover is
  // postponed to next Tuesday, nothing left in the tree remembers it was ever
  // promised to today.
  const tally = useMemo(() => todayTally(state.tasks, today), [state.tasks, today]);
  const tomorrow = addDays(today, 1);
  // "Did today ask anything of you" has to read the *recorded* high-water mark,
  // not the live tally: deciding the day's remaining work moves it
  // off today, which empties the live count. Reading it live would mean the more
  // thoroughly you closed the day, the less it looked like you'd had one.
  const everCommitted = Math.max(
    tally.committed,
    state.days.find((d) => d.date === today)?.committed ?? 0
  );
  const dayClosed = leftovers.length === 0 && everCommitted > 0 && tally.open === 0;
  useEffect(() => {
    // recordDay is a no-op when nothing moved — which is what keeps this effect
    // from re-triggering itself forever through the store.
    if (loaded) recordDay(today, tally, dayClosed);
  }, [loaded, today, tally, dayClosed]);
  const run = useMemo(() => currentRun(state.days, today), [state.days, today]);
  // What the last two weeks say a day of yours holds — null until the records
  // say enough, and null when they already agree with the current setting.
  const suggestedCapacity = useMemo(
    () => suggestedCapacityBlocks(state.days, today, state.dailyCapacityBlocks),
    [state.days, today, state.dailyCapacityBlocks]
  );

  // ── Task review ───────────────────────────────────────────────────
  const reviewActive = reviewOpen;
  // One list, in the order you'd want to decide it: what's overdue, what's
  // still open today, then the week's work that never got a day.
  const reviewRows = useMemo<ReviewRow[]>(() => {
    if (!reviewActive) return [];
    const week: ReviewRow[] = [];
    walk(state.tasks, (t) => {
      if (isLeaf(t) && isLive(t) && t.plannedFor == null && taskBucket(t, today) === "thisWeek") {
        week.push({ id: t.id, task: t, section: "week" });
      }
    });
    return [
      ...leftovers.map((task): ReviewRow => ({ id: task.id, task, section: "overdue" })),
      ...todayOpenLeaves.filter(isLive).map((task): ReviewRow => ({ id: task.id, task, section: "today" })),
      ...week,
    ];
  }, [reviewActive, state.tasks, leftovers, todayOpenLeaves, today]);
  /** The next row after `fromId` (wrapping) not yet set aside, `fromId` itself counted as decided. */
  const nextReviewRow = (fromId: TaskId): TaskId | null => {
    const i = reviewRows.findIndex((r) => r.id === fromId);
    for (let k = 1; k < reviewRows.length; k++) {
      const r = reviewRows[(i + k + reviewRows.length) % reviewRows.length];
      if (r != null && r.id !== fromId && !reviewLater.has(r.id)) return r.id;
    }
    return null;
  };
  const advanceReviewPast = (id: TaskId) => setReviewCursorId(nextReviewRow(id));
  useEffect(() => {
    if (!reviewActive) {
      if (reviewCursorId !== null) setReviewCursorId(null);
      if (reviewLater.size > 0) setReviewLater(new Set());
      return;
    }
    if (reviewCursorId === null || !reviewRows.some((r) => r.id === reviewCursorId)) {
      const first = reviewRows.find((r) => !reviewLater.has(r.id)) ?? reviewRows[0] ?? null;
      setReviewCursorId(first?.id ?? null);
    }
  }, [reviewActive, reviewRows, reviewCursorId, reviewLater]);
  useEffect(() => setReviewReason(""), [reviewCursorId]);
  /** Set aside for this pass ↔ back in the queue. */
  const toggleReviewLater = (id: TaskId | null) => {
    if (id == null) return;
    if (reviewLater.has(id)) {
      setReviewLater((prev) => withoutId(prev, id));
      return;
    }
    setReviewLater((prev) => new Set([...prev, id]));
    advanceReviewPast(id);
  };

  // Habits still unanswered for today — the sidebar badge and the menu bar
  // count the same thing.
  const habitsLeftToday = useMemo(
    () => state.habits.filter((h) => pendingOn(h, today)),
    [state.habits, today]
  );
  const yesterday = addDays(today, -1);
  const [habitLogDate, setHabitLogDate] = useState<ISODate | null>(null);
  // Today's habits still in play (pending, or already answered today) — the
  // strip under Today's header and the ⌘k check-ins.
  const habitsTodayList = useMemo(() => habitsToLog(state.habits, today), [state.habits, today]);

  // ── Habits ────────────────────────────────────────────────────────
  // Its own list, cursor and keys: nothing here is a task, so none of the
  // outline's machinery (selection, editing, the panel) is involved.
  const [habitCursorId, setHabitCursorId] = useState<HabitId | null>(null);
  // Days back from today the day cursor sits on (0 = today). Shared across rows
  // so ↑/↓ keep the column — checking a week of backfill down a list is fast.
  const [habitDayOffset, setHabitDayOffset] = useState(0);
  const [habitEditing, setHabitEditing] = useState<HabitEditing | null>(null);
  // How many days the strip shows (it grows with the window): ←/→ reach that far.
  const [habitStripDays, setHabitStripDays] = useState(HABIT_STRIP_DAYS);
  useEffect(() => setHabitDayOffset((o) => Math.min(o, habitStripDays - 1)), [habitStripDays]);
  const [habitTrendRange, setHabitTrendRange] = useState<TrendRange>("3m");
  const habitsActive = view === "habits" && !reviewActive;
  // The order the view shows them in: habits, then KPIs, then the archive.
  const habitList = useMemo(
    () => [
      ...state.habits.filter((h) => h.archivedAt == null && h.measure == null),
      ...state.habits.filter((h) => h.archivedAt == null && h.measure != null),
      ...state.habits.filter((h) => h.archivedAt != null),
    ],
    [state.habits]
  );
  useEffect(() => {
    const ids = habitList.map((h) => h.id);
    if (habitCursorId === null || !ids.includes(habitCursorId)) {
      const next = ids[0] ?? null;
      if (next !== habitCursorId) setHabitCursorId(next);
    }
    if (habitEditing != null && !ids.includes(habitEditing.id)) setHabitEditing(null);
  }, [habitList, habitCursorId, habitEditing]);
  const focusedHabit = habitsActive ? habitList.find((h) => h.id === habitCursorId) ?? null : null;
  const habitDay = addDays(today, -habitDayOffset);
  const moveHabitCursor = (dir: 1 | -1) => {
    const i = habitList.findIndex((h) => h.id === habitCursorId);
    const next = habitList[Math.max(0, Math.min(habitList.length - 1, i + dir))];
    if (next != null) setHabitCursorId(next.id);
  };
  const newHabit = () => {
    const id = createHabit("");
    setHabitCursorId(id);
    setHabitDayOffset(0);
    setHabitEditing({ id, field: "name" });
  };
  const newKpi = () => {
    const id = createHabit("", 7, DEFAULT_MEASURE);
    setHabitCursorId(id);
    setHabitDayOffset(0);
    setHabitEditing({ id, field: "name" });
  };
  const commitHabitField = (id: HabitId, field: HabitField, value: string, then: HabitField | null) => {
    const habit = state.habits.find((h) => h.id === id);
    if (habit == null) return setHabitEditing(null);
    if (field === "name") {
      const kpi = habit.measure != null ? parseKpiName(value) : null;
      const { name, perWeek } = kpi != null ? { name: kpi.name, perWeek: null } : parseHabitName(value);
      // A habit left nameless at birth is a slip of the `n` key: take it back.
      const blank =
        Object.keys(habit.checks).length === 0 &&
        Object.keys(habit.values).length === 0 &&
        Object.keys(habit.notes).length === 0;
      if (name === "" && habit.name === "" && then == null && blank) {
        deleteHabit(id);
        setHabitEditing(null);
        return;
      }
      if (name !== habit.name) renameHabit(id, name);
      if (perWeek != null && perWeek !== habit.perWeek) setHabitPerWeek(id, perWeek);
      if (kpi != null && habit.measure != null && (kpi.range != null || kpi.every != null)) {
        setHabitMeasure(id, { ...habit.measure, ...kpi.range, every: kpi.every ?? habit.measure.every });
      }
    } else if (field === "value") {
      // Values are committed by the value field itself (commitKpiValue).
    } else if (field === "note") {
      if (value.trim() !== noteOn(habit, habitDay)) setHabitNote(id, habitDay, value);
    } else if (value.trim() !== habit.cue) {
      setHabitCue(id, value);
    }
    setHabitEditing(then == null ? null : { id, field: then });
  };
  const commitKpiValue = (id: HabitId, date: ISODate, value: number | null) => {
    setKpiValue(id, date, value);
    setHabitEditing(null);
  };
  const archiveOrDeleteHabit = () => {
    const h = focusedHabit;
    if (h == null) return;
    if (h.archivedAt == null) return setHabitArchived(h.id, true);
    const noun = h.measure == null ? "habit" : "KPI";
    setConfirm({
      title: `Delete this ${noun}?`,
      body: `“${h.name || `Untitled ${noun}`}” and its whole history go. ⌘z can still bring it back.`,
      confirmLabel: `Delete ${noun}`,
      onConfirm: () => deleteHabit(h.id),
    });
  };

  // ── Trash ─────────────────────────────────────────────────────────
  // A cursor of its own, like Habits: deleted tasks aren't outline rows, so the
  // outline's selection can't point at them.
  const trashActive = view === "trash" && !reviewActive;
  const [trashCursorId, setTrashCursorId] = useState<TaskId | null>(null);
  // Where the cursor last stood, so restoring or deleting a row leaves it on the
  // row that slid into its place instead of jumping back to the top.
  const trashIndexRef = useRef(0);
  useEffect(() => {
    const i = state.trash.findIndex((e) => e.task.id === trashCursorId);
    if (i >= 0) {
      trashIndexRef.current = i;
      return;
    }
    const next = state.trash[Math.min(trashIndexRef.current, state.trash.length - 1)]?.task.id ?? null;
    if (next !== trashCursorId) setTrashCursorId(next);
  }, [state.trash, trashCursorId]);
  // Arriving in Trash starts at the top: the newest deletion, the one you most
  // likely came for. New deletions are added above, so a cursor kept from the
  // last visit would sit wherever they have since pushed it.
  const trashTopId = state.trash[0]?.task.id ?? null;
  const prevViewRef = useRef(view);
  useEffect(() => {
    if (view === "trash" && prevViewRef.current !== "trash") setTrashCursorId(trashTopId);
    prevViewRef.current = view;
  }, [view, trashTopId]);
  const moveTrashCursor = (to: 1 | -1 | "first" | "last") => {
    const i = state.trash.findIndex((e) => e.task.id === trashCursorId);
    const last = state.trash.length - 1;
    const target = to === "first" ? 0 : to === "last" ? last : Math.max(0, Math.min(last, i + to));
    const next = state.trash[target];
    if (next != null) setTrashCursorId(next.task.id);
  };
  const confirmPurge = (id: TaskId) => {
    const entry = state.trash.find((e) => e.task.id === id);
    if (entry == null) return;
    const text = entry.task.text.trim();
    const name = text === "" ? "this untitled task" : `“${text.length > 60 ? `${text.slice(0, 59)}…` : text}”`;
    const kids = entry.task.children.length;
    setTrashCursorId(id);
    setConfirm({
      title: "Delete forever?",
      body: `This permanently removes ${name}${kids > 0 ? ` and its ${kids === 1 ? "subtask" : `${kids} subtasks`}` : ""} from Trash — it can’t be undone.`,
      confirmLabel: "Delete forever",
      onConfirm: () => purgeFromTrash(id),
    });
  };

  // The task in progress (store/work): at most one, synced, and retired by the
  // store itself when it's finished, declined, blocked or trashed.
  const activeCurrentTask = useMemo(() => workingOn(state.tasks), [state.tasks]);
  // ── Presence (desktop shell) ──────────────────────────────────────
  // Push what's left today down to the main process, which turns it into a
  // menu-bar count and a dock badge. Renderer counts,
  // shell renders — so there is exactly one definition of "left today".
  useEffect(() => {
    if (!loaded) return;
    void window.execute?.updatePresence?.(
      presenceSnapshot(state.presence, todayOpenLeaves, habitsLeftToday, activeCurrentTask)
    );
  }, [loaded, state.presence, todayOpenLeaves, habitsLeftToday, activeCurrentTask]);
  // The global capture shortcut lands here: the window is already shown by the
  // main process, all that's left is to put the cursor where a thought can go.
  useEffect(() => window.execute?.onFocusCapture?.(() => captureRef.current?.focus()), []);
  // Commands from a local script (Claude in a task review): store/agent.ts.
  useEffect(() => window.execute?.onAgentRequest?.(runAgentRequest), []);
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

  // When the visible set changes, keep the cursor sensible. If the focused row
  // left the view (planned away with `t`, rescheduled, completed+hidden…), land
  // on the nearest surviving neighbor — preferring the row above — instead of
  // snapping to the top. `prevFlatIdsRef` holds the order before this change.
  // What the last ⌘a selected — see `selectAll` (ui/selection) for why the ring
  // can't be read back off the selection itself.
  const selectAllRingRef = useRef<OutlineId[] | null>(null);
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
    if (waitingEditId === null) return;
    const t = findById(state.tasks, waitingEditId);
    if (t == null || t.waitingOn == null || !flatIds.includes(waitingEditId)) {
      setWaitingEditId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatKey, state.tasks, waitingEditId]);
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
  // Time nobody was there for — the Mac asleep or locked, the app quit — comes
  // off the clock: the running session closes where that began, paused.
  useWorkAwake(loaded, state.tasks, pauseWorkAt);

  const didInitialFocus = useRef(false);
  useEffect(() => {
    if (loaded && !didInitialFocus.current && state.tasks.length === 0) {
      didInitialFocus.current = true;
      captureRef.current?.focus();
    }
  }, [loaded, state.tasks.length]);

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
  // `r` / `s` in the Recurring view opens the repeat picker for whichever
  // recurrence the cursor belongs to.
  const openRepeatFocused = () => {
    if (focusedRecurrence != null) {
      openRepeatFor(focusedRecurrence.id, focusedRecurrence.template.id);
    }
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
    if (focusedTaskId == null) return;
    setPanelEditOnOpen(false);
    setShowPanel(true);
  };
  // → on a task: open the panel straight into its notes (or, if it's already
  // open, dive into them — the same as Tab).
  const openPanelEditing = () => {
    if (focusedTaskId == null) return;
    if (showPanel) {
      setEditNotesSignal((n) => n + 1);
      return;
    }
    setPanelEditOnOpen(true);
    setShowPanel(true);
  };
  const openDetailFor = (id: TaskId) => {
    setFocus(id);
    setPanelEditOnOpen(false);
    setShowPanel(true);
  };

  const actionTargets = (): TaskId[] =>
    selectedTaskIds.length > 0
      ? selectedTaskIds
      : focusedTaskId != null
        ? [focusedTaskId]
        : [];

  /** ⌥↑/⌥↓ — move the selection one *rendered* slot within the cursor's section. */
  const applyReorder = (dir: "up" | "down") => {
    const targets = actionTargets();
    const scope = reorderScopeFor(focusedTaskId ?? targets[0] ?? null);
    if (targets.length === 0 || scope.size === 0) return;
    if (reorderCrossesProjects) reorderAcrossProjects(targets, dir, scope);
    else reorder(targets, dir, scope);
    bumpScroll();
  };

  // ── Scheduling (the ⌘k "Schedule…" picker + the detail panel's chips) ──
  /** A picker choice as the two mutually-exclusive fields it actually sets. */
  const scheduleFieldsFor = (choice: ScheduleChoice): PostponeTarget => {
    if (typeof choice === "object") return { plannedFor: choice.date, horizon: null };
    switch (choice) {
      case "today":
        return { plannedFor: today, horizon: null };
      case "tomorrow":
        return { plannedFor: addDays(today, 1), horizon: null };
      case "inbox":
        return { plannedFor: null, horizon: null };
      case "someday":
        return { plannedFor: null, horizon: { unit: "someday", anchor: null } };
      case "thisWeek":
        return { plannedFor: null, horizon: { unit: "week", anchor: weekKey(today) } };
      case "nextWeek":
        return { plannedFor: null, horizon: { unit: "week", anchor: weekKeyOffset(today, 1) } };
      case "thisMonth":
        return { plannedFor: null, horizon: { unit: "month", anchor: monthKey(today) } };
      case "nextMonth":
        return { plannedFor: null, horizon: { unit: "month", anchor: monthKeyOffset(today, 1) } };
    }
  };

  const applyScheduleTo = (ids: TaskId[], choice: ScheduleChoice) => {
    if (ids.length === 0) return;
    const { plannedFor, horizon } = scheduleFieldsFor(choice);
    // setPlannedForMany / setHorizonMany each clear the other field, which is the
    // invariant: a concrete date and a fuzzy horizon are mutually exclusive.
    if (plannedFor != null) setPlannedForMany(ids, plannedFor);
    else setHorizonMany(ids, horizon);
  };

  /**
   * The same choice, applied as a *postponement* — the task review's `s` on a
   * task that came due (overdue, or today's) and didn't get done, so the move is
   * counted (postponedCount) and logged, unlike rescheduling work never due.
   *
   * Picking "Today" here is not a postponement at all: it's the same
   * re-commitment `t` makes, so it routes to the carry counter instead. Otherwise
   * `s → Today` would be a laundering path — a free way to keep a task for today
   * without the carry showing up on it.
   */
  const applyPostponeTo = (ids: TaskId[], choice: ScheduleChoice) => {
    if (ids.length === 0) return;
    const target = scheduleFieldsFor(choice);
    if (target.plannedFor === today) keepManyForToday(ids, reviewReason || null);
    else postponeManyTo(ids, target, reviewReason || null);
  };

  // Deliberate schedule sets (picker, palette, panel) on a task with subtasks
  // offer to carry the subtree along, and the *default* is yes: a parent's date
  // is a bound over its subtree (see store/bounds), so moving the parent while
  // its subtasks stay put is the answer that leaves the two disagreeing — and
  // it was the one Enter picked. Esc still applies the choice to just the
  // targeted task(s). Each branch is one store update, so a single ⌘z reverts
  // it entirely.
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
      body: "Esc moves just this task and leaves their own schedules alone.",
      confirmLabel: "Subtasks too",
      cancelLabel: "Just this task",
      tone: "neutral",
      enterAction: "confirm",
      onConfirm: () => applyScheduleTo([...ids, ...subtree], choice),
      onCancel: () => applyScheduleTo(ids, choice),
    });
  };
  const applySchedule = (choice: ScheduleChoice) => applyScheduleAsking(actionTargets(), choice);

  // t / ⇧t walk the schedule ladder (the s-picker's options in order, wrapping).
  // In Recurring, t takes on today's occurrence instead. Steppers never
  // prompt about subtasks; they're rapid-fire keys, and the picker is the
  // deliberate path.
  const stepFocusedSchedule = (dir: 1 | -1) => {
    if (view === "recurring") {
      if (dir === 1 && focusedRecurrence != null) acceptRecurrence(focusedRecurrence.id, today);
      return;
    }
    const ids = actionTargets();
    if (ids.length === 0) return;
    // Group by destination rung so a multi-selection stays one update per rung.
    const groups = new Map<ScheduleStep, TaskId[]>();
    for (const id of ids) {
      const t = findById(state.tasks, id);
      if (t == null) continue;
      const next = stepSchedule(scheduleStep(t, today), dir);
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
  // Who the schedule picker acts on: a pending postponement's targets while one
  // is open, otherwise the normal outline selection/cursor.
  const scheduleTargetIds =
    postponeReq != null
      ? postponeReq.ids.filter((id) => findById(state.tasks, id) != null)
      : actionTargets();
  const openPostponePicker = (ids: TaskId[], counted: boolean) => {
    if (ids.length === 0) return;
    setPostponeReq({ ids, counted });
    setShowSchedule(true);
  };

  // ── Filing under a project (the ⌘k "File under a project…" picker) ──
  // The cursor can be sitting on a recurrence *template* rather than a task,
  // in the Recurring view. Filing there
  // moves the whole definition, so every occurrence it spawns lands in that
  // project too. Everywhere else it files the selected tasks.
  const filingRecurrence = focusedRecurrence;
  const filingTargetCount = filingRecurrence != null ? 1 : actionTargets().length;
  const filingCurrentProjectId =
    filingRecurrence != null
      ? filingRecurrence.template.projectId
      : focusedTask?.projectId ?? null;
  const fileUnderProject = (projectId: ProjectId) => {
    if (filingRecurrence != null) {
      setRecurrenceProject(filingRecurrence.id, projectId);
      return;
    }
    const ids = actionTargets();
    if (ids.length > 0) setProjectForMany(ids, projectId);
  };

  // ── Commands ──────────────────────────────────────────────────────
  const moveReviewCursor = (dir: "up" | "down") => {
    if (reviewRows.length === 0) return;
    const i = reviewRows.findIndex((r) => r.id === reviewCursorId);
    const next = i < 0 ? 0 : Math.min(Math.max(i + (dir === "down" ? 1 : -1), 0), reviewRows.length - 1);
    setReviewCursorId(reviewRows[next]?.id ?? null);
  };

  const cmd = {
    cursorDown: () => {
      if (reviewActive) return moveReviewCursor("down");
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
      if (reviewActive) return moveReviewCursor("up");
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
    // ⌘a — this project's tasks, then (pressed again) every project's. Project
    // *headers* are never selected: every bulk action reads `selectedTaskIds`,
    // and a header in the set would only ever be a row the action skips.
    selectAll: () => {
      const taskIds = outlineRows.flatMap((r) => (r.kind === "task" ? [r.taskId] : []));
      const scoped =
        currentProjectId == null
          ? taskIds
          : taskIds.filter(
              (id) => findById(state.tasks, id)?.projectId === currentProjectId
            );
      setSelection((s) => {
        const next = selectAll(s, flatIds, scoped, taskIds, selectAllRingRef.current);
        // Remember what this press produced: it's how the next one knows it is
        // the *second* ⌘a and should widen. Anything else that moves the
        // selection leaves this stale, and a stale ring simply fails to match.
        selectAllRingRef.current = next.selectedIds;
        return next;
      });
    },
    reorderUp: () => applyReorder("up"),
    reorderDown: () => applyReorder("down"),
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
      openPanelEditing();
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
      if (view === "recurring") {
        if (focusedTaskId != null) indentRecurringInView(focusedTaskId);
        return;
      }
      // With the detail panel open (preview), Tab dives into the notes editor
      // instead of indenting — focus leaves the list and lands in the panel.
      if (showPanel && focusedTaskId != null && !reviewActive && view !== "trash") {
        setEditNotesSignal((n) => n + 1);
        return;
      }
      if (focusedTaskId != null) indentInView(focusedTaskId);
    },
    taskOutdent: () => {
      if (view === "recurring") {
        if (focusedTaskId != null) outdentRecurrenceNode(focusedTaskId);
        return;
      }
      if (focusedTaskId != null) outdent(focusedTaskId);
    },
    taskTrash: () => {
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
    // `s`: start work on the focused task, resume it when paused, stop it when
    // running. Starting one stops whatever else was in progress.
    taskWork: () => {
      // Definitions aren't real tasks — nothing to time.
      if (view === "recurring") return;
      if (focusedTaskId == null) return;
      toggleWorking(focusedTaskId);
    },
    workStop: () => {
      if (activeCurrentTask != null) stopWorking(activeCurrentTask.id);
    },
    workNote: () => {
      if (activeCurrentTask == null) return;
      setWorkNoteSignal((n) => n + 1);
    },
    // `w` = "won't do · why": edit the skip reason inline. On an open task it
    // first marks it won't-do (a reason presupposes the state); on a completed or
    // non-task row it's inert.
    taskReason: () => {
      if (view === "recurring") return;
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
    // `b` = blocked. On an open task it marks it waiting and opens the inline
    // "on whom?" field; on an already-blocked one it unblocks. Inert on
    // definitions and resolved tasks — none of them can be waiting.
    taskWaiting: () => {
      if (view === "recurring") return;
      if (focusedTaskId == null) return;
      const t = findById(state.tasks, focusedTaskId);
      if (t == null || !isOpen(t)) return;
      if (t.waitingOn != null) {
        clearWaiting(focusedTaskId);
        setWaitingEditId(null);
        return;
      }
      setFocus(focusedTaskId);
      markWaiting(focusedTaskId, null);
      setWaitingEditId(focusedTaskId);
    },
    zoomIn: () => {
      if (view === "recurring") return; // no zoom into recurrence definitions (v1)
      if (focusedProjectId != null) zoomInto({ kind: "project", id: focusedProjectId });
      else if (focusedTaskId != null) zoomInto({ kind: "task", id: focusedTaskId });
    },
    captureFocus: () => captureRef.current?.focus(),
    toggleHideCompleted: () => setHideCompleted(!hideCompleted),
    helpToggle: () => setShowHelp((v) => !v),
    paletteOpen: () => setShowPalette(true),
    scheduleOpen: () => {
      // In the Recurring view, `s` sets the repeat.
      if (view === "recurring") return openRepeatFocused();
      if (actionTargets().length > 0) setShowSchedule(true);
    },
    projectOpen: () => {
      if (filingTargetCount > 0) setShowProject(true);
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
      else if (habitLogDate != null) setHabitLogDate(null);
      else if (repeatTarget != null) setRepeatTarget(null);
      else if (showHelp) setShowHelp(false);
      else if (showHistory) setShowHistory(false);
      else if (showLookBack) setShowLookBack(false);
      else if (showPalette) setShowPalette(false);
      else if (showSearch) setShowSearch(false);
      else if (showSchedule) {
        setShowSchedule(false);
        setPostponeReq(null);
      } else if (showProject) setShowProject(false);
      else if (showEstimate) setShowEstimate(false);
      else if (showCalendar) {
        setShowCalendar(false);
        setCalendarTargetId(null);
      } else if (breakingDownId != null) setBreakingDownId(null);
      else if (reviewOpen) setReviewOpen(false);
      else if (waitingEditId != null) setWaitingEditId(null);
      else if (reasonEditId != null) setReasonEditId(null);
      else if (editingProjectId != null) setEditingProjectId(null);
      else if (editingId != null) setEditingId(null);
      else if (peekId != null) setPeekId(null);
      else if (showPanel) setShowPanel(false);
      else if (viewFilter != null) setViewFilter(null);
      else if (zoom != null) {
        // Climb one level out of the zoom; land focus on the node we just left.
        const prevRootId = zoomFocus?.rootId ?? null;
        setZoom(zoomParent(state.tasks, zoom));
        if (prevRootId != null) setFocus(prevRootId);
      }
    },
    // ── Task review ───────────────────────────────────────────────
    // One set of verbs on every row. On a task that came due (overdue, or
    // today's) a move is a deferral and is counted on the task; on the week's
    // undated work it's a fresh commitment or plain rescheduling.
    reviewOpen: () => setReviewOpen(true),
    reviewComplete: (id?: TaskId) => {
      const target = id ?? reviewCursorId;
      if (target == null) return;
      advanceReviewPast(target);
      setCompleted(target, true, reviewReason || null);
    },
    // Keeping an overdue task for today is legitimate — until it becomes the
    // answer every day. Past the threshold the review offers the honest
    // alternative as the *default* (Enter breaks it down), the keep one
    // deliberate key away.
    reviewToday: (id?: TaskId) => {
      const target = id ?? reviewCursorId;
      const row = reviewRows.find((r) => r.id === target);
      if (target == null || row == null || row.section === "today") return;
      if (row.section === "week") {
        advanceReviewPast(target);
        setPlannedForMany([target], today);
        return;
      }
      const doKeep = () => {
        advanceReviewPast(target);
        keepManyForToday([target], reviewReason || null);
      };
      if (!willPromptOnKeep(row.task)) return doKeep();
      setConfirm({
        title: `Kept for today ${row.task.carriedCount} times already`,
        body: "Re-committing to it unchanged hasn't worked yet. Break it into the smallest piece you'd actually finish today.",
        confirmLabel: "Break it down",
        cancelLabel: "Keep it anyway",
        tone: "neutral",
        onConfirm: () => setBreakingDownId(target),
        onCancel: doKeep,
      });
    },
    reviewTomorrow: (id?: TaskId) => {
      const target = id ?? reviewCursorId;
      const row = reviewRows.find((r) => r.id === target);
      if (target == null || row == null) return;
      advanceReviewPast(target);
      if (row.section === "week") setPlannedForMany([target], tomorrow);
      else carryManyTo([target], tomorrow, reviewReason || null);
    },
    // `s` opens the picker, so a postponement has to name a day. Past the
    // threshold it first asks whether this is ever happening, with "won't do"
    // as the default answer (reversible, and a decision either way beats a
    // fifth silent deferral).
    reviewPostpone: (id?: TaskId) => {
      const target = id ?? reviewCursorId;
      const row = reviewRows.find((r) => r.id === target);
      if (target == null || row == null) return;
      const counted = row.section !== "week";
      if (!counted || !willPromptOnPostpone(row.task)) return openPostponePicker([target], counted);
      setConfirm({
        title: `Postponed ${row.task.postponedCount} times already`,
        body: "Pushing the date again is a decision too. If it isn't going to happen, saying so is the honest version — you can always reopen it.",
        confirmLabel: "Won’t do",
        cancelLabel: "Postpone anyway",
        tone: "neutral",
        onConfirm: () => {
          advanceReviewPast(target);
          markWontDo(target, reviewReason || null);
        },
        onCancel: () => openPostponePicker([target], counted),
      });
    },
    reviewWontDo: (id?: TaskId) => {
      const target = id ?? reviewCursorId;
      if (target == null) return;
      advanceReviewPast(target);
      markWontDo(target, reviewReason || null);
    },
    reviewDrop: (id?: TaskId) => {
      const target = id ?? reviewCursorId;
      if (target == null) return;
      advanceReviewPast(target);
      trashTask(target, { reason: reviewReason || null, log: true });
    },
    // Also reachable from the list (⌘k → "Break it down…"): the same panel.
    breakDown: (id?: TaskId) => {
      const target = id ?? (reviewActive ? reviewCursorId : focusedTaskId);
      if (target != null) setBreakingDownId(target);
    },
  };

  const openEstimatePicker = () => {
    if (actionTargets().length > 0) setShowEstimate(true);
  };
  const openCalendarPicker = () => {
    if (focusedTask == null) return;
    setCalendarTargetId(focusedTask.id);
    setShowCalendar(true);
  };

  // ── History panel ─────────────────────────────────────────────────
  // The persisted log paired with the snapshots still in memory: only lines
  // whose step survived this session can be rewound to.
  const historyRows = useMemo(
    () => (showHistory ? buildHistoryRows(state.actionLog, getUndoSteps(), getRedoSteps()) : []),
    // The stacks aren't part of the store snapshot, so they can't be a dep — but
    // every push/pop notifies with a new state, which re-runs this. Gated on the
    // panel being open: this app re-renders on every keystroke, and pairing up to
    // 200 log lines with the stacks is pure waste while nothing is showing them.
    [state, showHistory],
  );
  const openHistory = () => {
    setHistorySel(0);
    setShowHistory(true);
  };
  const jumpHistory = (row: HistoryRow) => {
    if (row.reach === "undo") undoThrough(row.entry.id);
    else if (row.reach === "redo") redoThrough(row.entry.id);
    // Rewinding rewrites the log; put the cursor back on the newest line so the
    // panel doesn't strand it in the middle of a list that just changed shape.
    setHistorySel(0);
  };
  // ── Restore a backup… (desktop) ───────────────────────────────────
  // The daily copies in backups/ were only good with the cloud cut off: put
  // back over the store file, the first sync deleted again whatever the cloud
  // had a deletion record for. This restores through the store instead
  // (store/restore), as one undoable step the cloud then follows, after
  // keeping a copy of what the app holds now beside the backups.
  const bridge = window.execute;
  const canRestore =
    bridge?.listBackups != null && bridge.readBackup != null && bridge.keepCopyBeforeRestore != null;
  const openBackups = () => {
    const list = window.execute?.listBackups;
    if (list == null) return;
    list().then(
      (files) => {
        if (files.length === 0) setRestoreNotice({ text: "There are no backups yet.", failed: true });
        else setBackupList(files);
      },
      (e: unknown) =>
        setRestoreNotice({ text: `Couldn't list the backups: ${e instanceof Error ? e.message : String(e)}`, failed: true }),
    );
  };
  const runRestore = async (file: BackupFile) => {
    const b = window.execute;
    if (b?.readBackup == null || b.keepCopyBeforeRestore == null) return;
    const when = backupWhen(file);
    try {
      const backup = coerceState(await b.readBackup(file.name));
      // Never restore without the copy: it is what undoes this after a restart.
      const kept = await b.keepCopyBeforeRestore(getStoreState());
      const changed = restoreBackup(backup, `Restore the backup of ${when}`);
      setRestoreNotice({
        text: changed
          ? `Restored the backup of ${when}. ⌘z undoes it; what you had is kept as backups/${kept}.`
          : `The backup of ${when} holds nothing you don't have: nothing changed.`,
        failed: false,
      });
    } catch (e: unknown) {
      setRestoreNotice({
        text: `Nothing was restored: ${e instanceof Error ? e.message : String(e)}`,
        failed: true,
      });
    }
  };
  const askRestore = (file: BackupFile) => {
    setConfirm({
      title: `Restore the backup of ${backupWhen(file)}?`,
      body:
        `Every task, project, recurring task and habit in this ${backupKind(file)} goes back to how it was ` +
        "then, deleted ones included, on every device. What's been added since stays. A copy of what " +
        "you have now is kept in backups/ first, and ⌘z undoes the restore.",
      confirmLabel: "Restore",
      enterAction: "cancel",
      tone: "neutral",
      onConfirm: () => void runRestore(file),
    });
  };

  const moveHistoryCursor = (dir: "up" | "down") => {
    setHistorySel((i) =>
      dir === "down" ? Math.min(i + 1, historyRows.length - 1) : Math.max(i - 1, 0),
    );
  };

  // ── View filter (⌘f) ──────────────────────────────────────────────
  // The views the filter has rows to narrow. Habits and Trash have none of its
  // kind; the rituals own the screen.
  const filterable =
    !reviewActive && view !== "habits" && view !== "trash";
  const openFilter = () => {
    if (!filterable) return openSearch(); // nothing here to narrow: find instead
    if (viewFilter == null) setViewFilter("");
    // Already open: back into the field, query selected, ready to retype.
    const input = filterInputRef.current;
    if (input != null) {
      input.focus();
      input.select();
    }
  };
  // The filter belongs to the view it was typed in.
  useEffect(() => setViewFilter(null), [view]);
  // From the field to the list: the first task that matched, else the first row.
  const leaveFilter = () => {
    filterInputRef.current?.blur();
    const first =
      outlineRows.find((r) => {
        if (r.kind !== "task") return false;
        const task = findById(state.tasks, r.taskId);
        return task != null && matchesFilter(task, filterQuery);
      }) ?? outlineRows[0];
    if (first != null) setFocus(first.id);
  };

  // ── Task finder (⌘⇧f) ─────────────────────────────────────────────
  const openSearch = () => {
    // Only from a settled outline: the rituals own the screen, and a jump would
    // land in a view they'd immediately paint over. (In "normal" none of these
    // hold; the guard is for the ⌘⇧f-while-editing binding.)
    if (reviewActive) return;
    setShowSearch(true);
  };
  // Jump to any task from the finder: leave focus mode, show it in All (which
  // filters by nothing), un-collapse its project and every ancestor so the row
  // actually renders, reveal completed tasks if that's what we're jumping to,
  // then select it — TaskRow scrolls the focused row into view on its own.
  const jumpToTask = (id: TaskId) => {
    const task = findById(state.tasks, id);
    if (task == null) return; // vanished between opening the finder and picking
    setShowSearch(false);
    setZoom(null);
    setShowPanel(false);
    setView("all");
    setProjectCollapsed(task.projectId, false);
    const ancestorIds = getAncestorPath(state.tasks, id)
      .slice(0, -1) // drop the task itself; keep root→parent
      .map((t) => t.id);
    if (ancestorIds.length > 0) {
      setCollapsed((prev) => {
        const next = new Set(prev);
        for (const aid of ancestorIds) next.delete(aid);
        return next;
      });
    }
    if (!isOpen(task) && hideCompleted) setHideCompleted(false);
    setFocus(id);
  };

  // ── Keyboard wiring ───────────────────────────────────────────────
  const dispatchState: ContextState = {
    showHelp,
    showPalette,
    showSearch,
    showHistory,
    showLookBack,
    showSchedule,
    showProject,
    showEstimate,
    showCalendar,
    showRepeat: repeatTarget != null,
    // The habit log panel and the backup list are modal like a confirm:
    // nothing fires beneath them.
    showConfirm: confirm != null || habitLogDate != null || backupList != null,
    reviewActive,
    habitsActive,
    trashActive,
  };
  // Only actions the keymap actually binds. Everything the outline used to fire
  // from a bare letter (schedule, won't-do, blocked, estimate, project, repeat,
  // the rituals…) is reached through the ⌘k palette, which calls `cmd.*`
  // directly — so it never needs an entry here.
  const actionMap: Record<string, () => void> = {
    "cursor.down": cmd.cursorDown,
    "cursor.up": cmd.cursorUp,
    "cursor.first": cmd.cursorFirst,
    "cursor.last": cmd.cursorLast,
    "select.down": cmd.selectDown,
    "select.up": cmd.selectUp,
    "select.all": cmd.selectAll,
    "reorder.down": cmd.reorderDown,
    "reorder.up": cmd.reorderUp,
    "panel.open": cmd.panelOpen,
    "panel.back": cmd.panelBack,
    "edit.start": cmd.editStart,
    "task.new": cmd.taskNew,
    "task.toggle": cmd.taskToggle,
    "task.peek": cmd.taskPeek,
    "task.work": cmd.taskWork,
    "period.next": cmd.periodNext,
    "period.prev": cmd.periodPrev,
    "task.indent": cmd.taskIndent,
    "task.outdent": cmd.taskOutdent,
    "task.trash": cmd.taskTrash,
    "zoom.in": cmd.zoomIn,
    "capture.focus": cmd.captureFocus,
    "undo": undo,
    "redo": redo,
    "help.toggle": cmd.helpToggle,
    "history.toggle": () => (showHistory ? setShowHistory(false) : openHistory()),
    "history.down": () => moveHistoryCursor("down"),
    "history.up": () => moveHistoryCursor("up"),
    "history.jump": () => {
      const row = historyRows[historySel];
      if (row != null && row.reach !== "gone") jumpHistory(row);
    },
    "palette.open": cmd.paletteOpen,
    "search.open": openSearch,
    "filter.open": openFilter,
    "view.today": cmd.gotoView("today"),
    "view.backlog": cmd.gotoView("backlog"),
    "view.all": cmd.gotoView("all"),
    "view.projects": cmd.gotoView("projects"),
    "view.recurring": cmd.gotoView("recurring"),
    "view.habits": cmd.gotoView("habits"),
    "view.trash": cmd.gotoView("trash"),
    "habits.down": () => moveHabitCursor(1),
    "habits.up": () => moveHabitCursor(-1),
    "habits.dayPrev": () => setHabitDayOffset((o) => Math.min(habitStripDays - 1, o + 1)),
    "habits.dayNext": () => setHabitDayOffset((o) => Math.max(0, o - 1)),
    "habits.toggle": () => {
      if (focusedHabit == null) return;
      if (focusedHabit.measure != null) setHabitEditing({ id: focusedHabit.id, field: "value" });
      else toggleHabitDone(focusedHabit.id, habitDay);
    },
    "habits.note": () => {
      if (focusedHabit != null) setHabitEditing({ id: focusedHabit.id, field: "note" });
    },
    "habits.rename": () => {
      if (focusedHabit != null) setHabitEditing({ id: focusedHabit.id, field: "name" });
    },
    "habits.new": newHabit,
    "habits.moveUp": () => {
      if (focusedHabit != null) moveHabit(focusedHabit.id, -1);
    },
    "habits.moveDown": () => {
      if (focusedHabit != null) moveHabit(focusedHabit.id, 1);
    },
    "habits.newKpi": newKpi,
    "habits.archive": archiveOrDeleteHabit,
    "habits.trendRange": () => setHabitTrendRange(nextTrendRange),
    "trash.down": () => moveTrashCursor(1),
    "trash.up": () => moveTrashCursor(-1),
    "trash.first": () => moveTrashCursor("first"),
    "trash.last": () => moveTrashCursor("last"),
    "trash.restore": () => {
      if (trashCursorId != null) restoreFromTrash(trashCursorId);
    },
    "trash.purge": () => {
      if (trashCursorId != null) confirmPurge(trashCursorId);
    },
    "dismiss": cmd.dismiss,
    // Arg-less wrappers: the keyboard engine calls handlers with the dispatch
    // state, so these must ignore it and act on the cursor (not a stray object).
    "review.complete": () => cmd.reviewComplete(),
    "review.today": () => cmd.reviewToday(),
    "review.tomorrow": () => cmd.reviewTomorrow(),
    "review.postpone": () => cmd.reviewPostpone(),
    "review.wontDo": () => cmd.reviewWontDo(),
    "review.drop": () => cmd.reviewDrop(),
    "review.breakdown": () => cmd.breakDown(),
    "review.later": () => toggleReviewLater(reviewCursorId),
    "review.reason": () => {
      if (reviewCursorId != null) setReviewReasonTick((n) => n + 1);
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
    currentId: activeCurrentTask?.id ?? null,
    selectedIds: selectedTaskIds,
    editingId,
    reasonEditId,
    peekId,
    wrapAll: state.wrapAll,
    collapsed,
    scrollTick,
    filterQuery,
    select: setFocus,
    toggleSelect: (id) => setSelection((s) => toggleSelected(s, id, flatIds)),
    rangeSelect: (id) => setSelection((s) => rangeTo(s, id, flatIds)),
    canDrag: true,
    touch: false,
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
    waitingEditId,
    startWaiting: (id) => {
      setFocus(id);
      markWaiting(id, null);
      setWaitingEditId(id);
    },
    commitWaiting: (id, who) => {
      const clean = who.trim();
      markWaiting(id, clean === "" ? null : clean);
      setWaitingEditId(null);
    },
    clearWaiting,
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
    wrapAll: state.wrapAll,
    togglePeek: () => {},
    collapsed,
    scrollTick,
    filterQuery,
    select: setFocus,
    toggleSelect: setFocus, // recurrence view navigates one template at a time
    rangeSelect: setFocus,
    canDrag: false,
    touch: false,
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
    waitingEditId: null, // recurrence templates are never blocked on anyone
    startWaiting: () => {},
    commitWaiting: () => {},
    clearWaiting: () => {},
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
    onToggleWork: (id) => toggleWorking(id),
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

  // Copy every task shown in the current outline to the clipboard as markdown:
  // one `## ` section per project (or Later bucket when the by-date layout is on),
  // each task recursing through its (visible) subtree. Silent, matching the
  // other copy-* commands.
  const copyView = () => {
    const sections: MarkdownSection[] = usingBuckets
      ? bucketGroups.map((g) => ({ heading: g.meta.label, tasks: g.tasks }))
      : displayGroups.map((g) => ({ heading: g.project.name, tasks: g.tasks }));
    const body = sectionsToMarkdown(sections, { includeNotes: false });
    if (body.trim() === "") return;
    const title =
      view === "today"
        ? period === "today"
          ? "Today"
          : PERIOD_LABELS[period]
        : VIEW_TITLES[view];
    void copyText(`# ${title}\n\n${body}`);
  };

  // "Copy task data" on a task copies its subtree; on a project row it copies
  // every task shown under that row (each with its subtree), headed by the
  // project's name — the row has no task of its own, so "underneath" is the
  // outline group it heads. Silent, like the other copy-* commands.
  const copyFocused = (includeNotes: boolean) => {
    if (focusedTask != null) {
      void copyText(taskToMarkdown(focusedTask, { includeNotes }));
      return;
    }
    if (focusedProjectId == null) return;
    const group = displayGroups.find((g) => g.project.id === focusedProjectId);
    if (group == null || group.tasks.length === 0) return;
    const items = group.tasks.map((t) => taskToMarkdown(t, { includeNotes })).join("\n");
    void copyText(`# ${group.project.name}\n\n${items}`);
  };

  // Anything the "when" grammar can read becomes a command of its own, so the
  // palette lands the day in one pass instead of handing you the picker. Each
  // entry names the day it resolves to — "Saturday, October 3 · in 2d" — so a
  // date is never applied on a guess you couldn't see.
  //
  // Two doors, and the difference is how sure the query is:
  //   · "reschedule sat", "postpone end of month" — a verb said what you wanted,
  //     so the days lead the list.
  //   · "in two days", "next monday", "weekend" — the words only *read* as a
  //     day, so they trail the commands whose letters also match. ("mon" still
  //     offers This/Next month first; Monday waits below it.)
  const scheduleQueryCommands = (raw: string): { lead?: Command[]; trail?: Command[] } => {
    const targets = actionTargets();
    if (targets.length === 0) return {};
    const suffix = targets.length > 1 ? ` · ${targets.length} tasks` : "";
    const toCommands = (options: WhenOption[]): Command[] =>
      options.map((o) => ({
        id: `when:${o.key}`,
        label: `Schedule: ${o.label}${suffix}`,
        hint: o.sub ?? undefined,
        ephemeral: true,
        run: () => applyScheduleAsking(targets, o.choice),
      }));

    const after = splitScheduleVerb(raw);
    if (after != null) return { lead: toCommands(whenOptions(after, today)) };
    // Bare: concrete dates only. The ladder's rungs are already commands of
    // their own ("Schedule: Next week"), and listing them twice helps nobody.
    const dates = whenOptions(raw, today).filter((o) => o.key.startsWith("date:"));
    return { trail: toCommands(dates) };
  };

  // The focused habit's commands — only while the Habits view is up, so they
  // never crowd the palette from a task view.
  const habitCommands = (): Command[] => {
    const h = focusedHabit;
    if (h == null) return [];
    const day = habitDay === today ? "today" : habitDay === addDays(today, -1) ? "yesterday" : habitDay;
    if (h.measure != null) return kpiCommands(h, h.measure, day);
    const marked = h.checks[habitDay];
    const targets: Command[] = [7, 6, 5, 4, 3, 2, 1].map((n) => ({
      id: `habit-target-${n}`,
      label: `Habit target: ${cadenceLabel(n).toLowerCase()}${h.perWeek === n ? " ✓" : ""}`,
      aliases: ["target", "frequency", "times a week", `${n}x`, n === 7 ? "daily" : "weekly"],
      run: () => setHabitPerWeek(h.id, n),
    }));
    return [
      {
        id: "habit-check",
        label: marked === "done" ? `Habit: undo the check-in for ${day}` : `Habit: check in for ${day}`,
        aliases: ["done", "check", "tick", "complete"],
        hint: "space",
        run: () => toggleHabitDone(h.id, habitDay),
      },
      {
        id: "habit-missed",
        label: marked === "missed" ? `Habit: clear the “not today” on ${day}` : `Habit: not today on ${day} (didn’t do it)`,
        aliases: ["missed", "not today", "didn't", "no", "fail", "x"],
        run: () => toggleHabitMissed(h.id, habitDay),
      },
      {
        id: "habit-skip",
        label: marked === "skip" ? `Habit: clear the rest day on ${day}` : `Habit: rest day on ${day} (skip, no penalty)`,
        aliases: ["skip", "rest", "excuse", "sick", "vacation", "day off"],
        run: () => toggleHabitSkip(h.id, habitDay),
      },
      noteCommand(h, day),
      {
        id: "habit-cue",
        label: h.cue === "" ? "Habit: set a cue (when / after what)…" : "Habit: edit the cue…",
        aliases: ["cue", "trigger", "after", "when", "stack"],
        run: () => setHabitEditing({ id: h.id, field: "cue" }),
      },
      ...targets,
      {
        id: "habit-archive",
        label: h.archivedAt == null ? "Habit: archive (keep its history)" : "Habit: restore from the archive",
        aliases: ["archive", "pause", "retire", "restore", "unarchive"],
        hint: h.archivedAt == null ? "⌫" : undefined,
        run: () => setHabitArchived(h.id, h.archivedAt == null),
      },
      {
        id: "habit-delete",
        label: "Habit: delete it and its history…",
        aliases: ["delete", "remove"],
        run: () =>
          setConfirm({
            title: "Delete this habit?",
            body: `“${h.name || "Untitled habit"}” and its whole history go. ⌘z can still bring it back.`,
            confirmLabel: "Delete habit",
            onConfirm: () => deleteHabit(h.id),
          }),
      },
    ];
  };

  const noteCommand = (h: Habit, day: string): Command => ({
    id: "habit-note",
    label: noteOn(h, habitDay) === "" ? `Note on ${day}…` : `Edit ${day}’s note…`,
    aliases: ["note", "comment", "describe", "explain", "diary", "journal", "why"],
    hint: "c",
    run: () => setHabitEditing({ id: h.id, field: "note" }),
  });

  const kpiCommands = (h: Habit, m: HabitMeasure, day: string): Command[] => {
    const logged = valueOn(h, habitDay);
    const cadences: KpiEvery[] = ["day", "week", "month"];
    return [
      {
        id: "kpi-log",
        label: logged == null ? `KPI: log a value for ${day}…` : `KPI: change ${day}’s value (${formatValue(m, logged)})…`,
        aliases: ["log", "value", "number", "measure"],
        hint: "space",
        run: () => setHabitEditing({ id: h.id, field: "value" }),
      },
      ...(logged != null
        ? [{
            id: "kpi-clear",
            label: `KPI: clear ${day}’s value`,
            aliases: ["clear", "remove value", "unlog"],
            run: () => setKpiValue(h.id, habitDay, null),
          }]
        : []),
      noteCommand(h, day),
      {
        id: "kpi-cue",
        label: h.cue === "" ? "KPI: set a cue (when to log it)…" : "KPI: edit the cue…",
        aliases: ["cue", "trigger", "after", "when"],
        run: () => setHabitEditing({ id: h.id, field: "cue" }),
      },
      {
        id: "kpi-range",
        label: `KPI: change the range (now ${rangeLabel(m)}) — type it after the name…`,
        aliases: ["range", "scale", "min", "max"],
        run: () => setHabitEditing({ id: h.id, field: "name" }),
      },
      ...cadences.map((every) => ({
        id: `kpi-every-${every}`,
        label: `KPI: ask ${everyLabel(every).toLowerCase()}${m.every === every ? " ✓" : ""}`,
        aliases: ["cadence", "frequency", every === "day" ? "daily" : every === "week" ? "weekly" : "monthly"],
        run: () => setHabitMeasure(h.id, { ...m, every }),
      })),
      {
        id: "kpi-open-top",
        label: m.openTop ? `KPI: ${m.max} is just ${m.max} (not “${m.max}+”)` : `KPI: ${m.max} means “${m.max} or more”`,
        aliases: ["open", "plus", "or more", "bucket"],
        run: () => setHabitMeasure(h.id, { ...m, openTop: !m.openTop }),
      },
      {
        id: "kpi-archive",
        label: h.archivedAt == null ? "KPI: archive (keep its history)" : "KPI: restore from the archive",
        aliases: ["archive", "pause", "retire", "restore", "unarchive"],
        hint: h.archivedAt == null ? "⌫" : undefined,
        run: () => setHabitArchived(h.id, h.archivedAt == null),
      },
      {
        id: "kpi-delete",
        label: "KPI: delete it and its history…",
        aliases: ["delete", "remove"],
        run: () =>
          setConfirm({
            title: "Delete this KPI?",
            body: `“${h.name || "Untitled KPI"}” and its whole history go. ⌘z can still bring it back.`,
            confirmLabel: "Delete KPI",
            onConfirm: () => deleteHabit(h.id),
          }),
      },
    ];
  };

  const commands: Command[] = [
    { id: "search", label: "Search all tasks", aliases: ["find"], hint: "⌘⇧f", run: openSearch },
    { id: "filter", label: "Filter this view", aliases: ["search", "narrow"], hint: "⌘f", run: openFilter },
    { id: "today", label: "Go to Today", hint: "1", run: cmd.gotoView("today") },
    { id: "backlog", label: "Go to Backlog", hint: "2", run: cmd.gotoView("backlog") },
    { id: "all", label: "Go to All", hint: "3", run: cmd.gotoView("all") },
    { id: "projects", label: "Go to Projects", hint: "4", run: cmd.gotoView("projects") },
    { id: "recurring", label: "Go to Recurring", hint: "5", run: cmd.gotoView("recurring") },
    {
      id: "habits",
      label: "Go to Habits & KPIs",
      hint: "6",
      aliases: ["habit", "streak", "routine", "kpi", "metrics", "measure"],
      run: cmd.gotoView("habits"),
    },
    { id: "trash", label: "Go to Trash", hint: "7", run: cmd.gotoView("trash") },
    {
      id: "habit-new",
      label: "New habit",
      aliases: ["add habit", "create habit", "track habit"],
      run: () => {
        cmd.gotoView("habits")();
        newHabit();
      },
    },
    {
      id: "kpi-new",
      label: "New KPI",
      aliases: ["add kpi", "track a number", "measure", "metric"],
      run: () => {
        cmd.gotoView("habits")();
        newKpi();
      },
    },
    ...habitCommands(),
    // Check in from anywhere: "check med" → ✓ Meditate, without visiting the view.
    // A KPI asks for its number in the log panel instead.
    ...habitsTodayList.map((h): Command =>
      h.measure != null
        ? {
            id: `habit-checkin:${h.id}`,
            label:
              valueOn(h, today) != null
                ? `Log: ${h.name || "Untitled KPI"} (today, ${formatValue(h.measure, valueOn(h, today) ?? 0)})…`
                : `Log: ${h.name || "Untitled KPI"} (today)…`,
            aliases: ["kpi", "log", "measure", "value"],
            run: () => setHabitLogDate(today),
          }
        : {
            id: `habit-checkin:${h.id}`,
            label:
              h.checks[today] === "done"
                ? `Undo today’s check-in: ${h.name || "Untitled habit"}`
                : `Check in: ${h.name || "Untitled habit"} (today)`,
            aliases: ["habit", "check in", "did", "done"],
            run: () => toggleHabitDone(h.id, today),
          },
    ),
    ...(habitsTodayList.length > 0
      ? [{
          id: "habit-log-today",
          label: "Log habits: today…",
          aliases: ["habits", "log habits", "check in", "did i", "kpis"],
          run: () => setHabitLogDate(today),
        }]
      : []),
    ...(habitsToLog(state.habits, yesterday).length > 0
      ? [{
          id: "habit-log-yesterday",
          label: "Log habits: yesterday…",
          aliases: ["habits", "log habits", "yesterday", "backfill"],
          run: () => setHabitLogDate(yesterday),
        }]
      : []),
    { id: "new", label: "New task", hint: "n", run: cmd.taskNew },
    { id: "details", label: "Open details panel", hint: "→", run: openPanel },
    { id: "peek", label: "Peek: unwrap task in place", aliases: ["preview"], hint: "p", run: cmd.taskPeek },
    {
      id: "wrap-all",
      // Always leads with "Toggle wrap" — the words you search for — and says
      // which way it'll flip, rather than renaming itself by state.
      label: state.wrapAll
        ? "Toggle wrap — turn off (one line per task)"
        : "Toggle wrap — turn on (peek every task)",
      aliases: ["toggle wrap", "wrap", "unwrap", "peek all", "expand all", "show notes"],
      run: () => setWrapAll(!state.wrapAll),
    },
    { id: "toggle", label: "Complete / uncomplete task", hint: "⌘↵", run: cmd.taskToggle },
    {
      id: "wontdo",
      label:
        focusedTask?.wontDo != null
          ? "Won’t do · edit the reason"
          : "Won’t do (skip) · add a reason",
      aliases: ["wont do", "skip", "reason"],
      run: cmd.taskReason,
    },
    { id: "sched-later", label: "Schedule: one step later", aliases: ["defer", "postpone"], run: cmd.scheduleLater },
    { id: "sched-earlier", label: "Schedule: one step sooner", aliases: ["advance"], run: cmd.scheduleEarlier },
    {
      // Keeps the old "current" id so its learned ranking carries over.
      id: "current",
      label:
        focusedTask != null && activeCurrentTask?.id === focusedTask.id
          ? isRunning(focusedTask)
            ? "Stop working on it (the time stays)"
            : "Resume working on it"
          : "Start working on it — in progress, timer on",
      aliases: ["in progress", "start", "work", "timer", "doing", "now", "current", "focus", "track time"],
      hint: "s",
      run: cmd.taskWork,
    },
    ...(activeCurrentTask != null
      ? [
          {
            id: "work-note",
            label: "Currently… — say where you are in the task in progress",
            aliases: ["currently", "progress note", "where am i", "status"],
            run: cmd.workNote,
          },
          {
            id: "work-stop",
            label: `No longer in progress: ${activeCurrentTask.text.trim() === "" ? "Untitled" : activeCurrentTask.text}`,
            aliases: ["stop", "stop working", "stop timer", "pause"],
            run: cmd.workStop,
          },
        ]
      : []),
    // Scheduling. All act on the focused/selected task(s); no-op when nothing
    // is targeted.
    { id: "sched-open", label: "Schedule… (type a day or a date)", aliases: ["schedule", "reschedule", "when", "defer", "postpone", "snooze", "delay", "move", "push", "due", "plan"], run: cmd.scheduleOpen },
    { id: "sched-today", label: "Schedule: Today", aliases: ["schedule"], run: () => applySchedule("today") },
    { id: "sched-tomorrow", label: "Schedule: Tomorrow", aliases: ["schedule"], run: () => applySchedule("tomorrow") },
    { id: "sched-this-week", label: "Schedule: This week", aliases: ["schedule"], run: () => applySchedule("thisWeek") },
    { id: "sched-next-week", label: "Schedule: Next week", aliases: ["schedule"], run: () => applySchedule("nextWeek") },
    { id: "sched-this-month", label: "Schedule: This month", aliases: ["schedule"], run: () => applySchedule("thisMonth") },
    { id: "sched-next-month", label: "Schedule: Next month", aliases: ["schedule"], run: () => applySchedule("nextMonth") },
    { id: "sched-someday", label: "Schedule: Someday", aliases: ["schedule"], run: () => applySchedule("someday") },
    { id: "sched-inbox", label: "Schedule: Inbox (untriage)", aliases: ["schedule"], run: () => applySchedule("inbox") },
    { id: "estimate", label: "Estimate effort (blocks of ~20m)…", aliases: ["estimate", "effort", "blocks", "time", "size"], run: openEstimatePicker },
    { id: "add-to-calendar", label: "Add to calendar…", aliases: ["calendar", "cal", "event", "gcal", "schedule event", "block time"], run: openCalendarPicker },
    { id: "capacity-up", label: `Daily capacity: raise (${state.dailyCapacityBlocks} → ${state.dailyCapacityBlocks + 1} blocks)`, aliases: ["capacity", "budget"], run: () => setDailyCapacityBlocks(state.dailyCapacityBlocks + 1) },
    { id: "capacity-down", label: `Daily capacity: lower (${state.dailyCapacityBlocks} → ${Math.max(1, state.dailyCapacityBlocks - 1)} blocks)`, aliases: ["capacity", "budget"], run: () => setDailyCapacityBlocks(state.dailyCapacityBlocks - 1) },
    // Offered only when the day records actually say something, and only when
    // they disagree with the current setting by enough to be worth a change.
    ...(suggestedCapacity != null
      ? [
          {
            id: "capacity-calibrate",
            label: `Daily capacity: calibrate to what you actually finish (${state.dailyCapacityBlocks} → ${suggestedCapacity} blocks)`,
            aliases: ["capacity", "budget", "calibrate", "realistic", "actual"],
            run: () => setDailyCapacityBlocks(suggestedCapacity),
          },
        ]
      : []),
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
      run: () => copyFocused(true),
    },
    {
      id: "copy-md-titles",
      label: "Copy task data (markdown, titles only)",
      aliases: ["copy", "markdown", "export", "task data"],
      run: () => copyFocused(false),
    },
    {
      id: "copy-view",
      label: "Copy this view (markdown)",
      aliases: ["copy view", "copy today", "copy list", "copy panel", "copy all tasks", "export view"],
      run: copyView,
    },
    {
      id: "task-review",
      label: "Review tasks…",
      aliases: [
        "review", "task review", "triage", "plan", "plan the day", "morning", "shutdown",
        "close the day", "end of day", "overdue", "leftovers", "what stays",
      ],
      run: cmd.reviewOpen,
    },
    {
      id: "look-back",
      label: "Weekly look-back",
      aliases: ["look back", "week", "weekly", "digest", "reasons", "why", "stats", "report"],
      run: () => setShowLookBack(true),
    },
    ...(focusedTask != null && !reviewActive && view !== "trash"
      ? [{
          id: "break-down",
          label: "Break it down…",
          aliases: ["break down", "breakdown", "split", "smaller", "steps", "subtasks"],
          run: () => cmd.breakDown(focusedTask.id),
        }]
      : []),
    { id: "zoom", label: "Zoom in / focus", hint: "⌥↵", run: cmd.zoomIn },
    {
      id: "waiting",
      label:
        focusedTask?.waitingOn != null
          ? "Unblock — no longer waiting on anyone"
          : "Blocked: waiting on someone else…",
      aliases: ["waiting", "blocked", "block", "waiting on", "stuck", "unblock"],
      run: cmd.taskWaiting,
    },
    {
      id: "repeat",
      label: "Set repeat (recurring)…",
      aliases: ["repeat", "recurring", "recur", "every", "daily", "weekly"],
      run: cmd.repeatOpen,
    },
    {
      id: "later-layout",
      label: "Later: group by date / project",
      aliases: ["later", "layout", "group", "group by", "backlog layout"],
      run: cmd.toggleLaterLayout,
    },
    {
      id: "hide-completed",
      label: hideCompleted ? "Show completed & won't-do tasks" : "Hide completed & won't-do tasks",
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
    {
      id: "project-set",
      label: "File under a project…",
      aliases: ["project", "move to project", "file"],
      run: cmd.projectOpen,
    },
    ...state.projects.map((project) => ({
      id: `project-set-${project.id}`,
      label: `Set project: ${project.name}`,
      run: () => fileUnderProject(project.id),
    })),
    { id: "p1", label: "Priority: Urgent", run: () => focusedTaskId && setPriority(focusedTaskId, 1) },
    { id: "p2", label: "Priority: High", run: () => focusedTaskId && setPriority(focusedTaskId, 2) },
    { id: "p3", label: "Priority: Medium", run: () => focusedTaskId && setPriority(focusedTaskId, 3) },
    { id: "p4", label: "Priority: None", run: () => focusedTaskId && setPriority(focusedTaskId, 4) },
    { id: "undo", label: "Undo", hint: "⌘z", run: undo },
    { id: "redo", label: "Redo", hint: "⌘⇧z", run: redo },
    {
      id: "history",
      label: "History: everything you just did",
      aliases: ["history", "log", "audit", "recent", "undo history"],
      hint: "⌘y",
      run: openHistory,
    },
    ...(canRestore
      ? [
          {
            id: "restore-backup",
            label: "Restore a backup…",
            aliases: ["backup", "restore", "recover", "undelete", "bring back", "lost"],
            run: openBackups,
          },
        ]
      : []),
    // Presence — desktop only; on the web companion there's no menu bar to own.
    ...(window.execute?.isElectron === true
      ? [
          {
            id: "presence-tray",
            label: state.presence.tray
              ? "Menu bar count: hide"
              : "Menu bar count: show what's left today",
            aliases: ["menu bar", "menubar", "tray", "status", "presence"],
            run: () => setPresence({ tray: !state.presence.tray }),
          },
          {
            id: "presence-login",
            label: state.presence.openAtLogin
              ? "Launch at login: off"
              : "Launch at login: on (the menu bar count needs the app running)",
            aliases: ["login", "startup", "start up", "autostart", "launch", "boot"],
            run: () => setPresence({ openAtLogin: !state.presence.openAtLogin }),
          },
        ]
      : []),
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
  const panelOpen = showPanel && focusedTask != null && !reviewActive && view !== "trash";

  return (
    <div className="relative flex h-full overflow-hidden bg-bg text-ink" spellCheck={false}>
      <div className="drag-region absolute inset-x-0 top-0 z-20 h-7" />

      <Sidebar
        view={view}
        todayRemaining={progress.remaining}
        backlog={backlog}
        projectCount={state.projects.length}
        recurring={state.recurrences.length}
        habitsPending={habitsLeftToday.length}
        trash={state.trash.length}
        onSelect={setView}
        onOpenHelp={() => setShowHelp(true)}
        onCycleTheme={cycleTheme}
        themeName={state.theme}
        hideWhenNarrow={panelOpen}
        streak={<DayStreak days={state.days} today={today} onOpenLookBack={() => setShowLookBack(true)} />}
      >
        {activeCurrentTask != null && (
          <SidebarWork
            task={activeCurrentTask}
            onFocus={() => {
              const id = activeCurrentTask.id;
              if (view === "habits" || view === "trash" || view === "recurring") setView("all");
              setFocus(id);
            }}
          />
        )}
        {import.meta.env.DEV && (
          <DevControls today={today} override={state.devDateOverride} onSet={setDevDateOverride} />
        )}
        <SyncButton />
      </Sidebar>

      <main className="flex flex-1 flex-col overflow-hidden">
        {saveError != null && (
          // Stays up until a save lands; the store retries by itself meanwhile.
          <div
            role="alert"
            title={saveError}
            className="flex items-center gap-2 border-b border-bad bg-bad-soft px-4 py-1.5 text-[12px]"
          >
            <span className="shrink-0 font-medium text-bad">Not saved to disk — retrying</span>
            <span className="truncate text-ink-soft">{saveError}</span>
          </div>
        )}
        {restoreNotice != null && (
          <div
            role="status"
            className={[
              "flex items-center gap-2 border-b px-4 py-1.5 text-[12px]",
              restoreNotice.failed ? "border-bad bg-bad-soft" : "border-line bg-surface-2",
            ].join(" ")}
          >
            <span className={["min-w-0 flex-1", restoreNotice.failed ? "text-bad" : "text-ink-soft"].join(" ")}>
              {restoreNotice.text}
            </span>
            <button
              type="button"
              onClick={() => setRestoreNotice(null)}
              className="shrink-0 rounded border border-line bg-surface px-2 py-0.5 text-[11px] hover:bg-surface-3"
            >
              Dismiss
            </button>
          </div>
        )}
        <div className="flex flex-1 overflow-hidden">
          <div className="flex flex-1 flex-col overflow-hidden">
            {viewFilter != null && filterable && (
              <FilterBar
                inputRef={filterInputRef}
                query={viewFilter}
                matches={
                  filtering
                    ? outlineRows.filter((r) => (view === "projects" && zoomFocus == null) === (r.kind === "project")).length
                    : null
                }
                onChange={setViewFilter}
                onLeave={leaveFilter}
                onClose={() => setViewFilter(null)}
              />
            )}
            <div className="min-h-0 flex-1">
            {breakdownTask != null ? (
              <div className="mx-auto flex h-full w-full page-width flex-col px-10 py-10">
                <BreakdownPanel
                  task={breakdownTask}
                  stepDate={today}
                  when="today"
                  onAddStep={(text) => addChild(breakdownTask.id, parseCapture(text).text, today)}
                  onFinish={() => {
                    // Only a breakdown that produced a step is one; esc on an
                    // empty panel just backs out.
                    if (breakdownTask.children.some((c) => c.plannedFor === today)) logBreakdown(breakdownTask.id);
                    setBreakingDownId(null);
                  }}
                />
              </div>
            ) : reviewActive ? (
              <TaskReviewView
                rows={reviewRows}
                cursorId={reviewCursorId}
                later={reviewLater}
                today={today}
                contextOf={(id) => {
                  const path = getAncestorPath(state.tasks, id).slice(0, -1).map((t) => t.text || "Untitled");
                  const task = findById(state.tasks, id);
                  const project = state.projects.find((p) => p.id === task?.projectId) ?? null;
                  return { project, path };
                }}
                catchUp={lapseOffered ? { count: leftovers.length, onCatchUp: catchUp } : null}
                reason={reviewReason}
                reasonTick={reviewReasonTick}
                onReasonChange={setReviewReason}
                onSelect={setReviewCursorId}
                onComplete={cmd.reviewComplete}
                onToday={cmd.reviewToday}
                onTomorrow={cmd.reviewTomorrow}
                onPostpone={cmd.reviewPostpone}
                onWontDo={cmd.reviewWontDo}
                onDrop={cmd.reviewDrop}
                onStartBreakdown={cmd.breakDown}
                onLater={toggleReviewLater}
                onExit={() => setReviewOpen(false)}
              />
            ) : view === "habits" ? (
              <HabitsView
                habits={habitList}
                today={today}
                cursorId={habitCursorId}
                dayOffset={habitDayOffset}
                editing={habitEditing}
                onSelect={setHabitCursorId}
                onSelectDay={(id, date) => {
                  setHabitCursorId(id);
                  setHabitDayOffset(Math.max(0, daysBetween(date, today)));
                }}
                onMark={markHabit}
                onValue={commitKpiValue}
                onCommit={commitHabitField}
                onEdit={(id, field) => {
                  setHabitCursorId(id);
                  setHabitEditing({ id, field });
                }}
                onNew={newHabit}
                onNewKpi={newKpi}
                trendRange={habitTrendRange}
                onTrendRange={setHabitTrendRange}
                onStripDays={setHabitStripDays}
              />
            ) : view === "trash" ? (
              <TrashView
                trash={state.trash}
                cursorId={trashCursorId}
                onSelect={setTrashCursorId}
                onRestore={restoreFromTrash}
                onPurge={confirmPurge}
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
                filterQuery={filterQuery}
              />
            ) : view === "recurring" ? (
              <EditorProvider value={recurrenceEditor}>
                <RecurringView
                  groups={recurrenceGroups}
                  projects={state.projects}
                  captureRef={captureRef}
                  onAdd={onCapture}
                  onCaptureArrowDown={() => flatIds[0] != null && setFocus(flatIds[0])}
                  onCaptureFocus={() => setSelection(emptySelection)}
                  onEditRule={openRepeatFor}
                  onEditProject={(_recId, taskId) => {
                    setFocus(taskId); // the picker files whatever the cursor is on
                    setShowProject(true);
                  }}
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
                  waiting={waitingTasks}
                  current={activeCurrentTask}
                  onFocusCurrent={() => {
                    if (activeCurrentTask != null) setFocus(activeCurrentTask.id);
                  }}
                  onToggleCurrent={() => {
                    if (activeCurrentTask != null) toggleWorking(activeCurrentTask.id);
                  }}
                  onStopCurrent={() => {
                    if (activeCurrentTask != null) stopWorking(activeCurrentTask.id);
                  }}
                  onCurrentNote={(text) => {
                    if (activeCurrentTask != null) setProgressNote(activeCurrentTask.id, text);
                  }}
                  currentNoteSignal={workNoteSignal}
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
                  run={run}
                  capacity={capacity}
                  overdue={leftovers.length > 0 ? { count: leftovers.length, onReview: cmd.reviewOpen } : null}
                  habitStrip={{
                    habits: habitsTodayList,
                    today,
                    // A KPI wants a number, not a tick: ask in the log panel.
                    onToggle: (id) =>
                      state.habits.find((h) => h.id === id)?.measure != null
                        ? setHabitLogDate(today)
                        : toggleHabitDone(id, today),
                    onOpen: cmd.gotoView("habits"),
                  }}
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
          </div>

          {panelOpen && focusedTask != null && (
            <DetailPanel
              task={focusedTask}
              scheduleTag={scheduleTag}
              log={panelTaskLog}
              projects={state.projects}
              handlers={detailHandlers}
              editSignal={editNotesSignal}
              editOnMount={panelEditOnOpen}
            />
          )}
        </div>
        <StatusBar
          review={reviewActive}
          habits={habitsActive}
          view={view === "trash" ? "trash" : view === "projects" && zoomFocus == null ? "projects" : null}
        />
      </main>

      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
      {showLookBack && (
        <LookBackPanel
          review={buildLookBack(state, today)}
          today={today}
          onClose={() => setShowLookBack(false)}
        />
      )}
      {showHistory && (
        <HistoryPanel
          rows={historyRows}
          sel={historySel}
          undoCount={undoDepth()}
          today={today}
          onHover={setHistorySel}
          onJump={jumpHistory}
          onClose={() => setShowHistory(false)}
        />
      )}
      {showPalette && (
        <CommandPalette
          commands={commands}
          dynamic={scheduleQueryCommands}
          usage={state.commandUsage}
          onUse={recordCommandUse}
          onResetRanking={resetCommandRanking}
          onClose={() => setShowPalette(false)}
          subject={
            reviewActive || habitsActive
              ? undefined
              : selection.selectedIds.length > 1
                ? `${selection.selectedIds.length} selected`
                : focusedTask != null
                  ? focusedTask.text.trim() === "" ? "Untitled" : focusedTask.text
                  : undefined
          }
        />
      )}
      {showSearch && (
        <SearchPalette
          tasks={state.tasks}
          projects={state.projects}
          hideResolved={hideCompleted}
          onPick={jumpToTask}
          onClose={() => setShowSearch(false)}
        />
      )}
      {showSchedule && scheduleTargetIds.length > 0 && (
        <SchedulePicker
          today={today}
          count={scheduleTargetIds.length}
          current={postponeReq != null ? null : scheduleTag}
          verb={postponeReq != null ? "Postpone" : "Schedule"}
          onPick={(choice) => {
            if (postponeReq == null) return applySchedule(choice);
            // From the review: move the cursor forward first so the pass keeps
            // flowing, then apply — counted and logged on a task that came
            // due, plain rescheduling on the week's undated work.
            const { ids, counted } = postponeReq;
            if (ids[0] != null) advanceReviewPast(ids[0]);
            if (counted) applyPostponeTo(ids, choice);
            else applyScheduleTo(ids, choice);
            setPostponeReq(null);
          }}
          onClose={() => {
            setShowSchedule(false);
            setPostponeReq(null);
          }}
        />
      )}
      {backupList != null && (
        <BackupPicker backups={backupList} onPick={askRestore} onClose={() => setBackupList(null)} />
      )}
      {showProject && filingTargetCount > 0 && (
        <ProjectPicker
          projects={state.projects}
          count={filingTargetCount}
          current={filingCurrentProjectId}
          subject={filingRecurrence != null ? "recurring task" : undefined}
          onPick={fileUnderProject}
          onClose={() => setShowProject(false)}
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
      {showCalendar &&
        (() => {
          const target =
            calendarTargetId != null ? findById(state.tasks, calendarTargetId) : null;
          if (target == null) return null;
          return (
            <CalendarPicker
              title={target.text}
              today={today}
              initialDayISO={target.plannedFor ?? today}
              estimatedMinutes={target.estimatedMinutes}
              nowMs={Date.now()}
              silent={calendarConnected}
              onConfirm={({ startMs, durationMin }) => {
                // Decoupled export — never linked back to the task; one task can
                // spawn many events. Prefer a SILENT create via the service-account
                // bridge (desktop, key present); fall back to opening a prefilled
                // Google Calendar link (web, or if the silent create fails). Either
                // way, stamp the task for its row badge.
                const bridge = window.execute;
                const fallbackLink = () => {
                  const url = gcalTemplateUrl({
                    title: target.text,
                    details: target.notes,
                    startMs,
                    durationMin,
                  });
                  window.open(url, "_blank", "noopener,noreferrer");
                };
                if (bridge?.createCalendarEvent != null) {
                  void bridge
                    .createCalendarEvent({
                      summary: target.text,
                      description: target.notes,
                      startMs,
                      durationMin,
                    })
                    .then((res) => {
                      if (res?.ok !== true) fallbackLink();
                    })
                    .catch(() => fallbackLink());
                } else {
                  fallbackLink();
                }
                setScheduledAt(target.id, startMs);
              }}
              onClose={() => {
                setShowCalendar(false);
                setCalendarTargetId(null);
              }}
            />
          );
        })()}
      {repeatTarget != null && (
        <RepeatPicker
          anchor={today}
          current={state.recurrences.find((r) => r.id === repeatTarget.recId)?.rule ?? null}
          onPick={(rule) => setRecurrenceRule(repeatTarget.recId, rule)}
          onClose={() => setRepeatTarget(null)}
        />
      )}
      {habitLogDate != null && (
        <HabitLogPanel
          habits={habitsToLog(state.habits, habitLogDate)}
          date={habitLogDate}
          title={
            habitLogDate === today
              ? "Today’s habits"
              : habitLogDate === yesterday
                ? "Yesterday’s habits"
                : `Habits · ${habitLogDate}`
          }
          onAnswer={(id, mark) => markHabit(id, habitLogDate, mark)}
          onValue={(id, value) => setKpiValue(id, habitLogDate, value)}
          onClose={() => setHabitLogDate(null)}
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
