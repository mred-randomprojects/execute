import type {
  AppState,
  DayRecord,
  Habit,
  HabitId,
  HabitMark,
  HabitMeasure,
  Horizon,
  ISODate,
  LogAction,
  LogEntry,
  Presence,
  ProjectId,
  Recurrence,
  RecurrenceId,
  RecurrenceRule,
  Task,
  TaskId,
  TaskPriority,
  ThemeName,
  WontDo,
} from "../types";
import { DEFAULT_PROJECT_ID, MAX_DAY_RECORDS, PROJECT_COLORS } from "../types";
import {
  assignProjectDeep,
  findById,
  findParentId,
  getAncestorPath,
  indentTask,
  indentUnder,
  isOpen,
  makeTask,
  mapById,
  moveSibling,
  normalizeChildProjects,
  outdentTask,
  relocateAfter,
  relocateAsChild,
  relocateTask,
  removeById,
  reorderSelected,
  reorderSelectedAcrossProjects,
  setProjectForIds,
} from "../store/tasks";
import { normalizeRule } from "../store/recurrence";
import { noteProgress, pauseWork, startWork, stopAll, stopWork, workingOn } from "../store/work";
import {
  everyLabel,
  formatValue,
  moveHabitRank,
  normalizePerWeek,
  rangeLabel,
  sameMeasure,
  sortHabits,
  withMark,
  withNote,
  withValue,
} from "../store/habits";
import { horizonWords } from "../selectors";
import { buryTrashed, commit, todayFor } from "./commit";

// ─── Commands: every change to the state, as data ───────────────────
//
// The one way the state changes. Each command is a plain, serializable value
// (no Sets, no functions), so any client can send one: the desktop's keyboard
// and mouse, the phone, a script, an MCP server. `applyCommand` is what it
// does — pure, given a context that supplies the time and fresh ids — and
// `describeCommand` is the line it goes down as in the history.
//
// Commands that create something carry the new id, chosen by the caller:
// the caller needs it (to focus the row, to report it back), and a command
// that names its own result is the same command when it's retried.

/**
 * Where a postponement sends a task. Exactly one of the two is meaningful at a
 * time (a concrete date and a fuzzy horizon are mutually exclusive); both null
 * is the undated backlog.
 */
export interface PostponeTarget {
  plannedFor: ISODate | null;
  horizon: Horizon | null;
}

export interface DayTally {
  committed: number;
  done: number;
  doneMinutes: number;
  skipped: number;
}

export type Command =
  // App-level settings and bookkeeping (never undoable)
  | { type: "setTheme"; theme: ThemeName }
  | { type: "setDevDateOverride"; date: ISODate | null }
  | { type: "markOpened"; date: ISODate }
  | { type: "recordDay"; date: ISODate; tally: DayTally; closed: boolean }
  | { type: "setDailyCapacityBlocks"; blocks: number }
  | { type: "setBoardPreferred"; preferred: boolean }
  | { type: "setWrapAll"; on: boolean }
  | { type: "setHideCompleted"; on: boolean }
  | { type: "setPresence"; patch: Partial<Presence> }
  | { type: "recordCommandUse"; commandId: string }
  | { type: "resetCommandRanking"; commandId: string }
  // In progress
  | { type: "startWork"; id: TaskId }
  | { type: "stopWork"; id: TaskId }
  | { type: "pauseWorkAt"; at: number }
  | { type: "setProgressNote"; id: TaskId; text: string }
  // Insert
  | { type: "addTaskAfter"; id: TaskId; afterId: TaskId | null; text: string; plannedFor: ISODate | null; projectId?: ProjectId }
  | { type: "addTaskAtProjectStart"; id: TaskId; projectId: ProjectId; text: string; plannedFor: ISODate | null }
  | { type: "addChild"; id: TaskId; parentId: TaskId; text: string; plannedFor: ISODate | null }
  // Projects
  | { type: "createProject"; id: ProjectId; name: string }
  | { type: "renameProject"; id: ProjectId; name: string }
  | { type: "cycleProjectColor"; id: ProjectId }
  // Task content and status
  | { type: "setText"; id: TaskId; text: string }
  | { type: "setNotes"; id: TaskId; notes: string }
  | { type: "toggleComplete"; id: TaskId }
  | { type: "setCompleted"; id: TaskId; completed: boolean; reason: string | null }
  | { type: "setCompletedMany"; ids: TaskId[]; completed: boolean }
  | { type: "markWontDo"; id: TaskId; reason: string | null }
  | { type: "markWontDoMany"; ids: TaskId[]; reason: string | null }
  | { type: "clearWontDo"; id: TaskId }
  | { type: "setWontDoReason"; id: TaskId; reason: string }
  | { type: "markWaiting"; id: TaskId; who: string | null }
  | { type: "clearWaiting"; id: TaskId }
  | { type: "setPriority"; id: TaskId; priority: TaskPriority }
  | { type: "setEstimatedMinutesMany"; ids: TaskId[]; minutes: number | null }
  | { type: "logBreakdown"; id: TaskId }
  // Scheduling
  | { type: "setPlannedFor"; id: TaskId; plannedFor: ISODate | null }
  | { type: "setPlannedForMany"; ids: TaskId[]; date: ISODate | null }
  | { type: "setHorizonMany"; ids: TaskId[]; horizon: Horizon | null }
  | { type: "postponeMany"; ids: TaskId[]; target: PostponeTarget; reason: string | null }
  | { type: "carryMany"; ids: TaskId[]; date: ISODate; reason: string | null }
  | { type: "setScheduledAt"; id: TaskId; at: number | null }
  // Trash
  | { type: "trashTask"; id: TaskId; reason: string | null; log: boolean }
  | { type: "trashMany"; ids: TaskId[] }
  | { type: "dropManyWithLog"; ids: TaskId[]; reason: string | null }
  | { type: "restoreFromTrash"; id: TaskId }
  | { type: "purgeFromTrash"; id: TaskId }
  | { type: "emptyTrash" }
  // Outline structure
  | { type: "reorder"; ids: TaskId[]; dir: "up" | "down"; visible: TaskId[] | null }
  | { type: "reorderAcrossProjects"; ids: TaskId[]; dir: "up" | "down"; visible: TaskId[] | null }
  | { type: "setProjectForMany"; ids: TaskId[]; projectId: ProjectId }
  | { type: "indent"; id: TaskId; underId: TaskId | null }
  | { type: "outdent"; id: TaskId }
  | { type: "reorderSibling"; activeId: TaskId; overId: TaskId }
  | { type: "moveBefore"; id: TaskId; beforeId: TaskId }
  | { type: "moveAfter"; id: TaskId; afterId: TaskId }
  | { type: "moveAsChild"; id: TaskId; parentId: TaskId }
  // Recurrences
  | { type: "createRecurrence"; id: RecurrenceId; taskId: TaskId; text: string; rule: RecurrenceRule; projectId: ProjectId }
  | { type: "setRecurrenceRule"; id: RecurrenceId; rule: RecurrenceRule }
  | { type: "setRecurrenceProject"; id: RecurrenceId; projectId: ProjectId }
  | { type: "deleteRecurrence"; id: RecurrenceId }
  | { type: "setRecurrenceText"; taskId: TaskId; text: string }
  | { type: "addRecurrenceStep"; taskId: TaskId; stepId: TaskId; mode: "child" | "sibling" }
  | { type: "indentRecurrenceNode"; taskId: TaskId; underId: TaskId | null }
  | { type: "outdentRecurrenceNode"; taskId: TaskId }
  | { type: "removeRecurrenceNode"; taskId: TaskId }
  | { type: "acceptRecurrence"; recurrenceId: RecurrenceId; id: TaskId; today: ISODate }
  // Habits
  | { type: "createHabit"; id: HabitId; name: string; perWeek: number; measure: HabitMeasure | null }
  | { type: "renameHabit"; id: HabitId; name: string }
  | { type: "setHabitCue"; id: HabitId; cue: string }
  | { type: "setHabitPerWeek"; id: HabitId; perWeek: number }
  | { type: "markHabit"; id: HabitId; date: ISODate; mark: HabitMark | null }
  | { type: "setHabitMeasure"; id: HabitId; measure: HabitMeasure }
  | { type: "setKpiValue"; id: HabitId; date: ISODate; value: number | null }
  | { type: "setHabitNote"; id: HabitId; date: ISODate; note: string }
  | { type: "moveHabit"; id: HabitId; dir: 1 | -1 }
  | { type: "setHabitArchived"; id: HabitId; archived: boolean }
  | { type: "deleteHabit"; id: HabitId };

/** What a command may not decide for itself: the time, and fresh ids for what it records. */
export interface CommandContext {
  now: number;
  newId: () => string;
}

// ─── Helpers ────────────────────────────────────────────────────────

/** A new, empty task with the caller's id, created `now`. */
function newTask(id: TaskId, text: string, projectId: ProjectId, now: number): Task {
  return { ...makeTask(text, projectId), id, createdAt: now, updatedAt: now, movedAt: now };
}

function insertAfterSibling(tasks: Task[], afterId: TaskId | null, task: Task): Task[] {
  if (afterId == null) return [...tasks, task];
  const parentId = findParentId(tasks, afterId);
  if (parentId == null) {
    const idx = tasks.findIndex((t) => t.id === afterId);
    const r = [...tasks];
    r.splice(idx + 1, 0, task);
    return r;
  }
  return mapById(tasks, parentId, (p) => {
    const idx = p.children.findIndex((c) => c.id === afterId);
    const ch = [...p.children];
    ch.splice(idx + 1, 0, task);
    return { ...p, children: ch };
  });
}

function insertAtProjectStart(tasks: Task[], projects: AppState["projects"], projectId: ProjectId, task: Task): Task[] {
  const existingProjectTaskIndex = tasks.findIndex((t) => t.projectId === projectId);
  if (existingProjectTaskIndex !== -1) {
    const next = [...tasks];
    next.splice(existingProjectTaskIndex, 0, task);
    return next;
  }
  const order = new Map(projects.map((project, index) => [project.id, index]));
  const targetIndex = order.get(projectId) ?? 0;
  const laterProjectTaskIndex = tasks.findIndex((t) => (order.get(t.projectId) ?? Number.MAX_SAFE_INTEGER) > targetIndex);
  if (laterProjectTaskIndex === -1) return [...tasks, task];
  const next = [...tasks];
  next.splice(laterProjectTaskIndex, 0, task);
  return next;
}

function makeLog(s: AppState, task: Task, action: LogAction, reason: string | null, ctx: CommandContext): LogEntry {
  return {
    id: ctx.newId(),
    taskId: task.id,
    taskText: task.text,
    action,
    reason,
    at: ctx.now,
    date: todayFor(s, ctx.now),
  };
}

/** The newest "skipped" log entry for `taskId`, patched with a reason. */
function patchLatestSkip(log: LogEntry[], taskId: TaskId, reason: string | null): LogEntry[] {
  const idx = log.findIndex((e) => e.taskId === taskId && e.action === "skipped");
  if (idx === -1) return log;
  const next = [...log];
  next[idx] = { ...next[idx], reason };
  return next;
}

function withCompleted(x: Task, completed: boolean, now: number): Task {
  return {
    ...x,
    completed,
    completedAt: completed ? now : null,
    // Completing resolves the task positively — clear any "won't do", and any
    // wait: a finished task isn't blocked on anyone.
    wontDo: completed ? null : x.wontDo,
    waitingOn: completed ? null : x.waitingOn,
  };
}

function applyWontDo(task: Task, reason: string | null, now: number): Task {
  const wontDo: WontDo = { reason, at: now };
  // Declining settles it too, so the wait ends here.
  return { ...task, completed: false, completedAt: null, wontDo, waitingOn: null };
}

function topLevelIdFor(tasks: Task[], id: TaskId): TaskId {
  return getAncestorPath(tasks, id)[0]?.id ?? id;
}

function withTasks(s: AppState, tasks: Task[]): AppState {
  return { ...s, tasks };
}

/** Move a subtree to `targetId`'s project, wherever `relocate` put it. */
function relocated(s: AppState, id: TaskId, targetId: TaskId, tasks: Task[]): AppState {
  const projectId = findById(s.tasks, targetId)?.projectId ?? DEFAULT_PROJECT_ID;
  return withTasks(s, normalizeChildProjects(setProjectForIds(tasks, new Set([id]), projectId)));
}

/** Update whichever recurrence's template contains `taskId`. */
function mapRecurrenceOfNode(recurrences: Recurrence[], taskId: TaskId, fn: (template: Task) => Task): Recurrence[] {
  return recurrences.map((r) => (findById([r.template], taskId) != null ? { ...r, template: fn(r.template) } : r));
}

/** Deep-copy a template with fresh ids (the root gets `rootId`): new work, with no history. */
function cloneFresh(task: Task, id: TaskId, ctx: CommandContext): Task {
  return {
    ...task,
    id,
    updatedAt: ctx.now,
    clocks: {},
    inProgress: null,
    sessions: [],
    progress: [],
    children: task.children.map((c) => cloneFresh(c, ctx.newId() as TaskId, ctx)),
  };
}

/** Clone a recurrence's template into a concrete, dated-for-today commitment. */
function materialize(rec: Recurrence, id: TaskId, today: ISODate, ctx: CommandContext): Task {
  const planAll = (t: Task): Task => ({
    ...t,
    plannedFor: today,
    horizon: null,
    completed: false,
    completedAt: null,
    wontDo: null,
    children: t.children.map(planAll),
  });
  const planned = planAll(cloneFresh(rec.template, id, ctx));
  return { ...planned, recurrenceId: rec.id, occurrenceDate: today };
}

function mapHabit(s: AppState, id: HabitId, fn: (h: Habit) => Habit): AppState {
  let hit = false;
  const habits = s.habits.map((h) => {
    if (h.id !== id) return h;
    const next = fn(h);
    if (next !== h) hit = true;
    return next;
  });
  return hit ? { ...s, habits } : s;
}

/** Apply `fn` to each id that still exists, logging each; `s` itself if none did. */
function eachLogged(
  s: AppState,
  ids: TaskId[],
  fn: (x: Task) => Task,
  log: ((t: Task) => LogEntry) | null,
  skip: (t: Task) => boolean = () => false,
): { tasks: Task[]; logs: LogEntry[]; hit: number } {
  let tasks = s.tasks;
  const logs: LogEntry[] = [];
  let hit = 0;
  for (const id of ids) {
    const t = findById(tasks, id);
    if (t == null || skip(t)) continue;
    tasks = mapById(tasks, id, fn);
    if (log != null) logs.push(log(t));
    hit++;
  }
  return { tasks, logs, hit };
}

// ─── What each command does ─────────────────────────────────────────

/**
 * The state with `cmd` applied — or `s` itself when it changes nothing (a
 * guard bailed: the task is gone, already in that state…). Not yet
 * committed: see {@link runCommand}.
 */
export function applyCommand(s: AppState, cmd: Command, ctx: CommandContext): AppState {
  const { now } = ctx;
  switch (cmd.type) {
    // App-level settings
    case "setTheme":
      return { ...s, theme: cmd.theme };
    case "setDevDateOverride":
      return { ...s, devDateOverride: cmd.date };
    case "markOpened":
      return { ...s, lastOpenedDate: cmd.date };
    case "recordDay": {
      // Every field is a high-water mark, and `closedAt` is write-once: see the
      // store's recordDay. MUST return `s` when nothing moved — it runs from a
      // render effect, and that bail is what stops an infinite render loop.
      const prev = s.days.find((d) => d.date === cmd.date);
      const { tally } = cmd;
      const next: DayRecord = {
        date: cmd.date,
        committed: Math.max(prev?.committed ?? 0, tally.committed),
        done: Math.max(prev?.done ?? 0, tally.done),
        doneMinutes: Math.max(prev?.doneMinutes ?? 0, tally.doneMinutes),
        skipped: Math.max(prev?.skipped ?? 0, tally.skipped),
        closedAt: prev?.closedAt ?? (cmd.closed ? now : null),
      };
      if (
        prev != null &&
        prev.committed === next.committed &&
        prev.done === next.done &&
        prev.doneMinutes === next.doneMinutes &&
        prev.skipped === next.skipped &&
        prev.closedAt === next.closedAt
      ) {
        return s;
      }
      const days = [...s.days.filter((d) => d.date !== cmd.date), next]
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-MAX_DAY_RECORDS);
      return { ...s, days };
    }
    case "setDailyCapacityBlocks":
      return { ...s, dailyCapacityBlocks: Math.max(1, Math.round(cmd.blocks)) };
    case "setBoardPreferred":
      return { ...s, boardPreferred: cmd.preferred };
    case "setWrapAll":
      return { ...s, wrapAll: cmd.on };
    case "setHideCompleted":
      return s.hideCompleted === cmd.on ? s : { ...s, hideCompleted: cmd.on };
    case "setPresence":
      return { ...s, presence: { ...s.presence, ...cmd.patch } };
    case "recordCommandUse": {
      const prev = s.commandUsage[cmd.commandId];
      return {
        ...s,
        commandUsage: { ...s.commandUsage, [cmd.commandId]: { count: (prev?.count ?? 0) + 1, lastUsedAt: now } },
      };
    }
    case "resetCommandRanking": {
      if (s.commandUsage[cmd.commandId] == null) return s;
      const next = { ...s.commandUsage };
      delete next[cmd.commandId];
      return { ...s, commandUsage: next };
    }

    // In progress
    case "startWork":
      return withTasks(s, startWork(s.tasks, cmd.id, now));
    case "stopWork":
      return withTasks(s, stopWork(s.tasks, cmd.id, now));
    case "pauseWorkAt": {
      const tasks = pauseWork(s.tasks, cmd.at);
      return tasks === s.tasks ? s : withTasks(s, tasks);
    }
    case "setProgressNote":
      return withTasks(s, noteProgress(s.tasks, cmd.id, cmd.text.trim(), now));

    // Insert
    case "addTaskAfter": {
      const after = cmd.afterId == null ? null : findById(s.tasks, cmd.afterId);
      const projectId = cmd.projectId ?? after?.projectId ?? DEFAULT_PROJECT_ID;
      const t = { ...newTask(cmd.id, cmd.text, projectId, now), plannedFor: cmd.plannedFor };
      return withTasks(s, insertAfterSibling(s.tasks, cmd.afterId, t));
    }
    case "addTaskAtProjectStart": {
      const t = { ...newTask(cmd.id, cmd.text, cmd.projectId, now), plannedFor: cmd.plannedFor };
      return withTasks(s, insertAtProjectStart(s.tasks, s.projects, cmd.projectId, t));
    }
    case "addChild": {
      const parent = findById(s.tasks, cmd.parentId);
      const child = {
        ...newTask(cmd.id, cmd.text, parent?.projectId ?? DEFAULT_PROJECT_ID, now),
        plannedFor: cmd.plannedFor,
      };
      return withTasks(s, mapById(s.tasks, cmd.parentId, (p) => ({ ...p, children: [...p.children, child] })));
    }

    // Projects
    case "createProject":
      return {
        ...s,
        projects: [
          ...s.projects,
          {
            id: cmd.id,
            name: cmd.name.trim() || "New project",
            color: PROJECT_COLORS[s.projects.length % PROJECT_COLORS.length],
            createdAt: now,
            updatedAt: now,
          },
        ],
      };
    case "renameProject": {
      const name = cmd.name.trim();
      if (name === "") return s;
      return { ...s, projects: s.projects.map((p) => (p.id === cmd.id ? { ...p, name } : p)) };
    }
    case "cycleProjectColor":
      return {
        ...s,
        projects: s.projects.map((p) => {
          if (p.id !== cmd.id) return p;
          const i = PROJECT_COLORS.indexOf(p.color as (typeof PROJECT_COLORS)[number]);
          return { ...p, color: PROJECT_COLORS[(i + 1) % PROJECT_COLORS.length] };
        }),
      };

    // Task content and status
    case "setText":
      return withTasks(s, mapById(s.tasks, cmd.id, (t) => ({ ...t, text: cmd.text })));
    case "setNotes":
      return withTasks(s, mapById(s.tasks, cmd.id, (t) => ({ ...t, notes: cmd.notes })));
    case "toggleComplete": {
      const t = findById(s.tasks, cmd.id);
      if (t == null) return s;
      const completed = !t.completed;
      return {
        ...s,
        tasks: mapById(s.tasks, cmd.id, (x) => withCompleted(x, completed, now)),
        log: [makeLog(s, t, completed ? "completed" : "uncompleted", null, ctx), ...s.log],
      };
    }
    case "setCompleted": {
      const t = findById(s.tasks, cmd.id);
      if (t == null) return s;
      return {
        ...s,
        tasks: mapById(s.tasks, cmd.id, (x) => withCompleted(x, cmd.completed, now)),
        log: cmd.completed ? [makeLog(s, t, "completed", cmd.reason, ctx), ...s.log] : s.log,
      };
    }
    case "setCompletedMany": {
      const { tasks, logs } = eachLogged(
        s,
        cmd.ids,
        (x) => withCompleted(x, cmd.completed, now),
        cmd.completed ? (t) => makeLog(s, t, "completed", null, ctx) : null,
      );
      return { ...s, tasks, log: [...logs, ...s.log] };
    }
    case "markWontDo":
    case "markWontDoMany": {
      const ids = cmd.type === "markWontDo" ? [cmd.id] : cmd.ids;
      const { tasks, logs, hit } = eachLogged(
        s,
        ids,
        (x) => applyWontDo(x, cmd.reason, now),
        (t) => makeLog(s, t, "skipped", cmd.reason, ctx),
        (t) => t.wontDo != null,
      );
      if (hit === 0 && cmd.type === "markWontDo") return s;
      return { ...s, tasks, log: [...logs, ...s.log] };
    }
    case "clearWontDo": {
      const t = findById(s.tasks, cmd.id);
      if (t == null || t.wontDo == null) return s;
      return {
        ...s,
        tasks: mapById(s.tasks, cmd.id, (x) => ({ ...x, wontDo: null })),
        log: [makeLog(s, t, "uncompleted", null, ctx), ...s.log],
      };
    }
    case "setWontDoReason": {
      const t = findById(s.tasks, cmd.id);
      if (t == null || t.wontDo == null) return s;
      const clean = cmd.reason.trim();
      const reason = clean === "" ? null : clean;
      return {
        ...s,
        tasks: mapById(s.tasks, cmd.id, (x) => (x.wontDo == null ? x : { ...x, wontDo: { ...x.wontDo, reason } })),
        log: patchLatestSkip(s.log, cmd.id, reason),
      };
    }
    case "markWaiting": {
      const t = findById(s.tasks, cmd.id);
      if (t == null || !isOpen(t)) return s;
      // Re-marking keeps the original `since`: the wait started when it
      // started, and naming who you're waiting on shouldn't reset the clock.
      return withTasks(
        s,
        mapById(s.tasks, cmd.id, (x) => ({ ...x, waitingOn: { who: cmd.who, since: x.waitingOn?.since ?? now } })),
      );
    }
    case "clearWaiting": {
      const t = findById(s.tasks, cmd.id);
      if (t == null || t.waitingOn == null) return s;
      return withTasks(s, mapById(s.tasks, cmd.id, (x) => ({ ...x, waitingOn: null })));
    }
    case "setPriority":
      return withTasks(s, mapById(s.tasks, cmd.id, (t) => ({ ...t, priority: cmd.priority })));
    case "setEstimatedMinutesMany": {
      const value = estimateValue(cmd.minutes);
      let tasks = s.tasks;
      for (const id of cmd.ids) tasks = mapById(tasks, id, (t) => ({ ...t, estimatedMinutes: value }));
      return withTasks(s, tasks);
    }
    case "logBreakdown": {
      const t = findById(s.tasks, cmd.id);
      if (t == null) return s;
      return { ...s, log: [makeLog(s, t, "brokeDown", null, ctx), ...s.log] };
    }

    // Scheduling — a concrete date and a fuzzy horizon are mutually exclusive.
    case "setPlannedFor":
      return withTasks(s, mapById(s.tasks, cmd.id, (t) => ({ ...t, plannedFor: cmd.plannedFor, horizon: null })));
    case "setPlannedForMany": {
      let tasks = s.tasks;
      for (const id of cmd.ids) tasks = mapById(tasks, id, (x) => ({ ...x, plannedFor: cmd.date, horizon: null }));
      return withTasks(s, tasks);
    }
    case "setHorizonMany": {
      let tasks = s.tasks;
      for (const id of cmd.ids) tasks = mapById(tasks, id, (x) => ({ ...x, plannedFor: null, horizon: cmd.horizon }));
      return withTasks(s, tasks);
    }
    case "postponeMany": {
      // A deliberate postponement — the task already came due and didn't get
      // done — is counted (postponedCount) and logged. Plain rescheduling isn't.
      const { target } = cmd;
      const { tasks, logs } = eachLogged(
        s,
        cmd.ids,
        (x) => ({
          ...x,
          plannedFor: target.plannedFor,
          horizon: target.plannedFor != null ? null : target.horizon,
          postponedCount: x.postponedCount + 1,
        }),
        (t) => makeLog(s, t, "postponed", cmd.reason, ctx),
      );
      if (logs.length === 0) return s;
      return { ...s, tasks, log: [...logs, ...s.log] };
    }
    case "carryMany": {
      // Re-committed unchanged — the Reckoning's "Keep for today", Shutdown's
      // "→ Tomorrow": counted (carriedCount) and logged.
      const { tasks, logs } = eachLogged(
        s,
        cmd.ids,
        (x) => ({ ...x, plannedFor: cmd.date, horizon: null, carriedCount: x.carriedCount + 1 }),
        (t) => makeLog(s, t, "kept", cmd.reason, ctx),
      );
      if (logs.length === 0) return s;
      return { ...s, tasks, log: [...logs, ...s.log] };
    }
    case "setScheduledAt":
      return withTasks(s, mapById(s.tasks, cmd.id, (t) => ({ ...t, scheduledAt: cmd.at })));

    // Trash
    case "trashTask": {
      const t = findById(s.tasks, cmd.id);
      if (t == null) return s;
      return {
        ...s,
        tasks: removeById(s.tasks, cmd.id),
        trash: [{ task: t, deletedAt: now }, ...s.trash],
        log: cmd.log ? [makeLog(s, t, "dropped", cmd.reason, ctx), ...s.log] : s.log,
      };
    }
    case "trashMany":
    case "dropManyWithLog": {
      let tasks = s.tasks;
      const trashed: AppState["trash"] = [];
      const logs: LogEntry[] = [];
      for (const id of cmd.ids) {
        const t = findById(tasks, id);
        if (t == null) continue; // already removed via a selected ancestor
        tasks = removeById(tasks, id);
        trashed.push({ task: t, deletedAt: now });
        if (cmd.type === "dropManyWithLog") logs.push(makeLog(s, t, "dropped", cmd.reason, ctx));
      }
      return { ...s, tasks, trash: [...trashed, ...s.trash], log: logs.length === 0 ? s.log : [...logs, ...s.log] };
    }
    case "restoreFromTrash": {
      const entry = s.trash.find((e) => e.task.id === cmd.id);
      if (entry == null) return s;
      return {
        ...s,
        // In progress when it was trashed: its timer stopped then, not now.
        tasks: [...s.tasks, stopAll([entry.task], entry.deletedAt)[0]],
        trash: s.trash.filter((e) => e.task.id !== cmd.id),
      };
    }
    case "purgeFromTrash": {
      const purged = s.trash.filter((e) => e.task.id === cmd.id);
      if (purged.length === 0) return s;
      return { ...s, trash: s.trash.filter((e) => e.task.id !== cmd.id), tombstones: buryTrashed(s, purged, now) };
    }
    case "emptyTrash":
      if (s.trash.length === 0) return s;
      return { ...s, trash: [], tombstones: buryTrashed(s, s.trash, now) };

    // Outline structure. `visible` is the ids rendered in the cursor's section,
    // so a move hops over filtered-out siblings instead of swapping past them.
    case "reorder":
      return withTasks(
        s,
        reorderSelected(s.tasks, new Set(cmd.ids), cmd.dir, cmd.visible == null ? undefined : new Set(cmd.visible)),
      );
    case "reorderAcrossProjects":
      return withTasks(
        s,
        reorderSelectedAcrossProjects(
          s.tasks,
          new Set(cmd.ids),
          cmd.dir,
          s.projects,
          cmd.visible == null ? undefined : new Set(cmd.visible),
        ),
      );
    case "setProjectForMany": {
      const topLevelIds = new Set(cmd.ids.map((id) => topLevelIdFor(s.tasks, id)));
      return withTasks(s, normalizeChildProjects(setProjectForIds(s.tasks, topLevelIds, cmd.projectId)));
    }
    case "indent":
      return withTasks(
        s,
        normalizeChildProjects(
          cmd.underId == null ? indentTask(s.tasks, cmd.id) : indentUnder(s.tasks, cmd.id, cmd.underId),
        ),
      );
    case "outdent":
      return withTasks(s, normalizeChildProjects(outdentTask(s.tasks, cmd.id)));
    case "reorderSibling":
      return withTasks(s, moveSibling(s.tasks, cmd.activeId, cmd.overId));
    case "moveBefore":
      return relocated(s, cmd.id, cmd.beforeId, relocateTask(s.tasks, cmd.id, cmd.beforeId));
    case "moveAfter":
      return relocated(s, cmd.id, cmd.afterId, relocateAfter(s.tasks, cmd.id, cmd.afterId));
    case "moveAsChild":
      return relocated(s, cmd.id, cmd.parentId, relocateAsChild(s.tasks, cmd.id, cmd.parentId));

    // Recurrences — templates live only here, never in `tasks`, so they can't
    // reckon or be counted.
    case "createRecurrence": {
      const template = newTask(cmd.taskId, cmd.text, cmd.projectId, now);
      return {
        ...s,
        recurrences: [
          ...s.recurrences,
          { id: cmd.id, template, rule: normalizeRule(cmd.rule), createdAt: now, updatedAt: now },
        ],
      };
    }
    case "setRecurrenceRule":
      return {
        ...s,
        recurrences: s.recurrences.map((r) => (r.id === cmd.id ? { ...r, rule: normalizeRule(cmd.rule) } : r)),
      };
    case "setRecurrenceProject":
      // The whole template moves together: that's what an accepted occurrence clones.
      return {
        ...s,
        recurrences: s.recurrences.map((r) =>
          r.id === cmd.id ? { ...r, template: assignProjectDeep(r.template, cmd.projectId) } : r,
        ),
      };
    case "deleteRecurrence":
      return { ...s, recurrences: s.recurrences.filter((r) => r.id !== cmd.id) };
    case "setRecurrenceText":
      return {
        ...s,
        recurrences: mapRecurrenceOfNode(
          s.recurrences,
          cmd.taskId,
          (tpl) => mapById([tpl], cmd.taskId, (t) => ({ ...t, text: cmd.text }))[0],
        ),
      };
    case "addRecurrenceStep":
      return {
        ...s,
        recurrences: mapRecurrenceOfNode(s.recurrences, cmd.taskId, (tpl) => {
          const step = newTask(cmd.stepId, "", tpl.projectId, now);
          if (cmd.mode === "child") {
            return mapById([tpl], cmd.taskId, (t) => ({ ...t, children: [...t.children, step] }))[0];
          }
          return insertAfterSibling([tpl], cmd.taskId, step)[0];
        }),
      };
    case "indentRecurrenceNode":
      return {
        ...s,
        recurrences: mapRecurrenceOfNode(s.recurrences, cmd.taskId, (tpl) => {
          const forest =
            cmd.underId == null ? indentTask([tpl], cmd.taskId) : indentUnder([tpl], cmd.taskId, cmd.underId);
          return forest[0] ?? tpl;
        }),
      };
    case "outdentRecurrenceNode":
      return {
        ...s,
        recurrences: mapRecurrenceOfNode(s.recurrences, cmd.taskId, (tpl) => {
          const parentId = findParentId([tpl], cmd.taskId);
          // Never lift a node to become a second root of the template.
          if (parentId == null || parentId === tpl.id) return tpl;
          return outdentTask([tpl], cmd.taskId)[0] ?? tpl;
        }),
      };
    case "removeRecurrenceNode": {
      const rec = s.recurrences.find((r) => findById([r.template], cmd.taskId) != null);
      if (rec == null) return s;
      // Removing the template root deletes the whole recurrence.
      if (rec.template.id === cmd.taskId) return { ...s, recurrences: s.recurrences.filter((r) => r.id !== rec.id) };
      return {
        ...s,
        recurrences: s.recurrences.map((r) =>
          r.id === rec.id ? { ...r, template: removeById([r.template], cmd.taskId)[0] } : r,
        ),
      };
    }
    case "acceptRecurrence": {
      const rec = s.recurrences.find((r) => r.id === cmd.recurrenceId);
      if (rec == null) return s;
      const instance = materialize(rec, cmd.id, cmd.today, ctx);
      return withTasks(s, insertAtProjectStart(s.tasks, s.projects, instance.projectId, instance));
    }

    // Habits — their own array, like recurrences: nothing here reaches `tasks`.
    case "createHabit": {
      const habit: Habit = {
        id: cmd.id,
        name: cmd.name.trim(),
        cue: "",
        perWeek: normalizePerWeek(cmd.perWeek),
        checks: {},
        measure: cmd.measure,
        values: {},
        notes: {},
        checkedAt: {},
        archivedAt: null,
        rank: now,
        createdAt: now,
        updatedAt: now,
      };
      // Kept in the canonical order the cloud and the merge produce, or a
      // same-ms pair would read back swapped and look like a change.
      return { ...s, habits: sortHabits([...s.habits, habit]) };
    }
    case "renameHabit": {
      const name = cmd.name.trim();
      return mapHabit(s, cmd.id, (h) => (h.name === name ? h : { ...h, name }));
    }
    case "setHabitCue": {
      const cue = cmd.cue.trim();
      return mapHabit(s, cmd.id, (h) => (h.cue === cue ? h : { ...h, cue }));
    }
    case "setHabitPerWeek": {
      const n = normalizePerWeek(cmd.perWeek);
      return mapHabit(s, cmd.id, (h) => (h.perWeek === n ? h : { ...h, perWeek: n }));
    }
    case "markHabit":
      return mapHabit(s, cmd.id, (h) => withMark(h, cmd.date, cmd.mark));
    case "setHabitMeasure":
      return mapHabit(s, cmd.id, (h) =>
        h.measure == null || sameMeasure(h.measure, cmd.measure) ? h : { ...h, measure: cmd.measure },
      );
    case "setKpiValue":
      return mapHabit(s, cmd.id, (h) => (h.measure == null ? h : withValue(h, cmd.date, cmd.value)));
    case "setHabitNote":
      return mapHabit(s, cmd.id, (h) => withNote(h, cmd.date, cmd.note));
    case "moveHabit": {
      const habits = moveHabitRank(s.habits, cmd.id, cmd.dir);
      return habits === s.habits ? s : { ...s, habits: sortHabits(habits) };
    }
    case "setHabitArchived":
      return mapHabit(s, cmd.id, (h) =>
        (h.archivedAt != null) === cmd.archived ? h : { ...h, archivedAt: cmd.archived ? now : null },
      );
    case "deleteHabit":
      return { ...s, habits: s.habits.filter((h) => h.id !== cmd.id) };
  }
}

/** A minutes estimate as stored: a positive whole number, or none. */
function estimateValue(minutes: number | null): number | null {
  return minutes == null || minutes <= 0 ? null : Math.round(minutes);
}

/**
 * Apply `cmd` and commit it (core/commit): the state any client should adopt.
 * `s` itself when the command changed nothing.
 */
export function runCommand(s: AppState, cmd: Command, ctx: CommandContext): AppState {
  return commit(s, applyCommand(s, cmd, ctx), ctx.now);
}

// ─── History lines ──────────────────────────────────────────────────
//
// Every undoable command names itself, here (at the effect, not at the
// keybinding), so a change made with the mouse, the palette, a keystroke or
// another client lands the same line. `null` = an incidental change, neither
// undoable nor worth a history line: preferences, the dev date, bookkeeping.

const LABEL_TITLE_MAX = 40;

/** A task title, trimmed and quoted for a history line. */
function quoteText(text: string): string {
  const clean = text.trim();
  if (clean === "") return "an untitled task";
  const short = clean.length > LABEL_TITLE_MAX ? `${clean.slice(0, LABEL_TITLE_MAX - 1)}…` : clean;
  return `“${short}”`;
}

function quote(task: Task | null | undefined): string {
  return quoteText(task?.text ?? "");
}

/** `New task “Buy milk”` — or just `New task`, for something not yet named. */
function titled(prefix: string, text: string): string {
  return text.trim() === "" ? prefix : `${prefix} ${quoteText(text)}`;
}

/** "to tomorrow" / "to next week" / "to the backlog". */
function postponeWords(target: PostponeTarget, today: ISODate): string {
  if (target.plannedFor != null) return `to ${target.plannedFor}`;
  if (target.horizon != null) return `to ${horizonWords(target.horizon, today)}`;
  return "to the backlog";
}

/**
 * The history line for `cmd`, read against the state *before* it runs — or
 * `null` for a change that is neither undoable nor worth a line.
 */
export function describeCommand(s: AppState, cmd: Command, now: number): string | null {
  const task = (id: TaskId) => quote(findById(s.tasks, id));
  /** `“Buy milk”` for a single id, `3 tasks` for several — a line's subject. */
  const subject = (ids: TaskId[]) => (ids.length === 1 ? task(ids[0]) : `${ids.length} tasks`);
  const habit = (id: HabitId) => quoteText(s.habits.find((h) => h.id === id)?.name ?? "");
  const project = (id: ProjectId) => quoteText(s.projects.find((p) => p.id === id)?.name ?? "another project");
  const recurrence = (id: RecurrenceId) => quote(s.recurrences.find((r) => r.id === id)?.template);
  const today = todayFor(s, now);

  switch (cmd.type) {
    // Settings and bookkeeping; the pause on waking (nothing the user did, and
    // undo putting the time back would be the wrong number); the calendar
    // stamp (the event lives in the calendar: undo would only desync the badge).
    case "setTheme":
    case "setDevDateOverride":
    case "markOpened":
    case "recordDay":
    case "setDailyCapacityBlocks":
    case "setBoardPreferred":
    case "setWrapAll":
    case "setHideCompleted":
    case "setPresence":
    case "recordCommandUse":
    case "resetCommandRanking":
    case "pauseWorkAt":
    case "setScheduledAt":
      return null;

    case "startWork":
      return `${findById(s.tasks, cmd.id)?.inProgress != null ? "Resume" : "Start"} work on ${task(cmd.id)}`;
    case "stopWork":
      return `Stop work on ${task(cmd.id)}`;
    case "setProgressNote": {
      const clean = cmd.text.trim();
      return clean === "" ? `Clear what you’re on in ${task(cmd.id)}` : `Currently ${quoteText(clean)}`;
    }

    case "addTaskAfter":
    case "addTaskAtProjectStart":
      return titled("New task", cmd.text);
    case "addChild":
      return `New subtask of ${task(cmd.parentId)}`;

    case "createProject":
      return titled("New project", cmd.name.trim() || "New project");
    case "renameProject":
      return titled("Rename project to", cmd.name.trim());
    case "cycleProjectColor":
      return "Change a project’s colour";

    case "setText": {
      const before = findById(s.tasks, cmd.id);
      // A brand-new row starts empty, so its first commit is a naming, not a rename.
      const named = (before?.text ?? "").trim() !== "";
      if (cmd.text.trim() === "") return `Clear the title of ${quote(before)}`;
      return `${named ? "Rename" : "Name"} ${quoteText(cmd.text)}`;
    }
    case "setNotes":
      return `Edit the notes on ${task(cmd.id)}`;
    case "toggleComplete": {
      const before = findById(s.tasks, cmd.id);
      return `${before != null && !before.completed ? "Complete" : "Uncomplete"} ${quote(before)}`;
    }
    case "setCompleted":
      return `${cmd.completed ? "Complete" : "Uncomplete"} ${task(cmd.id)}`;
    case "setCompletedMany":
      return `${cmd.completed ? "Complete" : "Uncomplete"} ${subject(cmd.ids)}`;
    case "markWontDo":
      return `Won’t do ${task(cmd.id)}`;
    case "markWontDoMany":
      return `Won’t do ${subject(cmd.ids)}`;
    case "clearWontDo":
      return `Reopen ${task(cmd.id)}`;
    case "setWontDoReason":
      return `Give a reason for not doing ${task(cmd.id)}`;
    case "markWaiting":
      return `Waiting on ${cmd.who == null || cmd.who.trim() === "" ? "someone" : quoteText(cmd.who)} for ${task(cmd.id)}`;
    case "clearWaiting":
      return `No longer waiting on ${task(cmd.id)}`;
    case "setPriority":
      return `Set ${task(cmd.id)} to priority ${cmd.priority}`;
    case "setEstimatedMinutesMany": {
      const value = estimateValue(cmd.minutes);
      return value == null ? `Clear the estimate on ${subject(cmd.ids)}` : `Estimate ${subject(cmd.ids)} at ${value} min`;
    }
    case "logBreakdown":
      return `Break down ${task(cmd.id)}`;

    case "setPlannedFor":
      return cmd.plannedFor == null ? `Unschedule ${task(cmd.id)}` : `Schedule ${task(cmd.id)} for ${cmd.plannedFor}`;
    case "setPlannedForMany":
      return cmd.date == null ? `Unschedule ${subject(cmd.ids)}` : `Schedule ${subject(cmd.ids)} for ${cmd.date}`;
    case "setHorizonMany":
      return cmd.horizon == null
        ? `Unschedule ${subject(cmd.ids)}`
        : `Schedule ${subject(cmd.ids)} for ${horizonWords(cmd.horizon, today)}`;
    case "postponeMany":
      return `Postpone ${subject(cmd.ids)} ${postponeWords(cmd.target, today)}`;
    case "carryMany":
      return `Carry ${subject(cmd.ids)} to ${cmd.date}`;

    case "trashTask":
      return `Trash ${task(cmd.id)}`;
    case "trashMany":
      return `Trash ${subject(cmd.ids)}`;
    case "dropManyWithLog":
      return `Drop ${subject(cmd.ids)}`;
    case "restoreFromTrash":
      return `Restore ${quote(s.trash.find((e) => e.task.id === cmd.id)?.task)} from the trash`;
    case "purgeFromTrash":
      return `Delete ${quote(s.trash.find((e) => e.task.id === cmd.id)?.task)} for good`;
    case "emptyTrash":
      return `Empty the trash (${s.trash.length})`;

    case "reorder":
    case "reorderAcrossProjects":
      return `Move ${subject(cmd.ids)} ${cmd.dir}`;
    case "setProjectForMany":
      return `Move ${subject(cmd.ids)} to ${project(cmd.projectId)}`;
    case "indent":
      return `Indent ${task(cmd.id)}`;
    case "outdent":
      return `Outdent ${task(cmd.id)}`;
    case "reorderSibling":
      return `Move ${task(cmd.activeId)}`;
    case "moveBefore":
    case "moveAfter":
      return `Move ${task(cmd.id)}`;
    case "moveAsChild":
      return `Move ${task(cmd.id)} under ${task(cmd.parentId)}`;

    case "createRecurrence":
      return titled("New recurring task", cmd.text);
    case "setRecurrenceRule":
      return "Change a repeat schedule";
    case "setRecurrenceProject":
      return `Move the recurring task ${recurrence(cmd.id)} to ${project(cmd.projectId)}`;
    case "deleteRecurrence":
      return `Delete the recurring task ${recurrence(cmd.id)}`;
    case "setRecurrenceText":
      return titled("Rename a recurring step", cmd.text);
    case "addRecurrenceStep":
      return "New recurring step";
    case "indentRecurrenceNode":
      return "Indent a recurring step";
    case "outdentRecurrenceNode":
      return "Outdent a recurring step";
    case "removeRecurrenceNode":
      return "Delete a recurring step";
    case "acceptRecurrence":
      return `Take on today’s ${recurrence(cmd.recurrenceId)}`;

    case "createHabit": {
      const noun = cmd.measure == null ? "habit" : "KPI";
      return cmd.name.trim() === "" ? `New ${noun}` : `New ${noun} ${quoteText(cmd.name)}`;
    }
    case "renameHabit":
      return `Rename a habit to ${quoteText(cmd.name.trim())}`;
    case "setHabitCue": {
      const clean = cmd.cue.trim();
      return clean === "" ? `Clear the cue of ${habit(cmd.id)}` : `Cue ${habit(cmd.id)}: ${quoteText(clean)}`;
    }
    case "setHabitPerWeek": {
      const n = normalizePerWeek(cmd.perWeek);
      return `Set ${habit(cmd.id)} to ${n === 7 ? "every day" : `${n}× a week`}`;
    }
    case "markHabit": {
      const verb = cmd.mark === "done" ? "Check in" : cmd.mark === "skip" ? "Rest day for" : "Clear";
      return `${verb} ${habit(cmd.id)} · ${cmd.date}`;
    }
    case "setHabitMeasure":
      return `Set ${habit(cmd.id)} to ${rangeLabel(cmd.measure)}, ${everyLabel(cmd.measure.every).toLowerCase()}`;
    case "setKpiValue": {
      const measure = s.habits.find((h) => h.id === cmd.id)?.measure ?? null;
      if (cmd.value == null || measure == null) return `Clear ${habit(cmd.id)} · ${cmd.date}`;
      return `${habit(cmd.id)} = ${formatValue(measure, cmd.value)} · ${cmd.date}`;
    }
    case "setHabitNote": {
      const clean = cmd.note.trim();
      return clean === "" ? `Clear the note on ${habit(cmd.id)} · ${cmd.date}` : `Note on ${habit(cmd.id)} · ${cmd.date}: ${quoteText(clean)}`;
    }
    case "moveHabit":
      return `Move ${habit(cmd.id)} ${cmd.dir === 1 ? "down" : "up"}`;
    case "setHabitArchived":
      return `${cmd.archived ? "Archive" : "Restore"} the habit ${habit(cmd.id)}`;
    case "deleteHabit":
      return `Delete the habit ${habit(cmd.id)}`;
  }
}

// ─── Toggles: which command a toggle means right now ────────────────

/**
 * `s` on a task: start what isn't in progress, resume what's paused, stop
 * what's running. The command to run and what it did, or null when the task
 * can't be worked on (gone, settled, or waiting on someone).
 */
export function toggleWorkCommand(
  s: AppState,
  id: TaskId,
): { command: Command; result: "started" | "resumed" | "stopped" } | null {
  const t = findById(s.tasks, id);
  if (t == null || !isOpen(t) || t.waitingOn != null) return null;
  if (workingOn(s.tasks)?.id === id && t.inProgress != null) {
    const last = t.sessions[t.sessions.length - 1];
    if (last != null && last.end == null) return { command: { type: "stopWork", id }, result: "stopped" };
    return { command: { type: "startWork", id }, result: "resumed" };
  }
  return { command: { type: "startWork", id }, result: "started" };
}
