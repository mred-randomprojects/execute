import { nanoid } from "nanoid";
import type { Project, ProjectId, Task, TaskId } from "../types";
import { DEFAULT_PROJECT_ID } from "../types";

// ─── Construction ───────────────────────────────────────────────────

export function makeTask(
  text: string,
  projectId: ProjectId = DEFAULT_PROJECT_ID
): Task {
  return {
    id: nanoid() as TaskId,
    projectId,
    text,
    notes: "",
    completed: false,
    completedAt: null,
    wontDo: null,
    children: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    priority: 4,
    plannedFor: null,
    horizon: null,
    labels: [],
    estimatedMinutes: null,
    carriedCount: 0,
    recurrenceId: null,
    occurrenceDate: null,
  };
}

/** Deep-copy a task subtree with fresh ids throughout (for spawning instances). */
export function cloneWithNewIds(task: Task): Task {
  return {
    ...task,
    id: nanoid() as TaskId,
    updatedAt: Date.now(),
    children: task.children.map(cloneWithNewIds),
  };
}

// ─── Pure tree helpers (ported from i0-todo/src/useTasks.ts) ─────────

export function mapById(
  tasks: Task[],
  id: TaskId,
  fn: (t: Task) => Task
): Task[] {
  return tasks.map((t) => {
    if (t.id === id) return fn(t);
    return { ...t, children: mapById(t.children, id, fn) };
  });
}

export function removeById(tasks: Task[], id: TaskId): Task[] {
  return tasks
    .filter((t) => t.id !== id)
    .map((t) => ({ ...t, children: removeById(t.children, id) }));
}

export function findById(tasks: Task[], id: TaskId): Task | undefined {
  for (const t of tasks) {
    if (t.id === id) return t;
    const found = findById(t.children, id);
    if (found != null) return found;
  }
  return undefined;
}

export function findParentId(tasks: Task[], id: TaskId): TaskId | null {
  for (const t of tasks) {
    if (t.children.some((c) => c.id === id)) return t.id;
    const found = findParentId(t.children, id);
    if (found != null) return found;
  }
  return null;
}

export function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const result = [...arr];
  const [item] = result.splice(from, 1);
  result.splice(to, 0, item);
  return result;
}

export function moveSibling(
  tasks: Task[],
  activeId: TaskId,
  overId: TaskId
): Task[] {
  if (activeId === overId) return tasks;

  const activeParentId = findParentId(tasks, activeId);
  const overParentId = findParentId(tasks, overId);

  if (activeParentId !== overParentId) return tasks;

  if (activeParentId == null) {
    const activeIdx = tasks.findIndex((t) => t.id === activeId);
    const overIdx = tasks.findIndex((t) => t.id === overId);
    if (activeIdx === -1 || overIdx === -1) return tasks;
    return arrayMove(tasks, activeIdx, overIdx);
  }

  return mapById(tasks, activeParentId, (parent) => {
    const activeIdx = parent.children.findIndex((c) => c.id === activeId);
    const overIdx = parent.children.findIndex((c) => c.id === overId);
    if (activeIdx === -1 || overIdx === -1) return parent;
    return {
      ...parent,
      children: arrayMove(parent.children, activeIdx, overIdx),
    };
  });
}

export function getAncestorPath(tasks: Task[], targetId: TaskId): Task[] {
  function search(nodes: Task[], path: Task[]): Task[] | null {
    for (const node of nodes) {
      if (node.id === targetId) return [...path, node];
      const found = search(node.children, [...path, node]);
      if (found != null) return found;
    }
    return null;
  }
  return search(tasks, []) ?? [];
}

export function countAll(task: Task): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const c of task.children) {
    total += 1;
    if (c.completed) done += 1;
    const sub = countAll(c);
    done += sub.done;
    total += sub.total;
  }
  return { done, total };
}

export function assignProjectDeep(task: Task, projectId: ProjectId): Task {
  return {
    ...task,
    projectId,
    children: task.children.map((child) => assignProjectDeep(child, projectId)),
  };
}

export function setProjectForIds(
  tasks: Task[],
  selected: Set<TaskId>,
  projectId: ProjectId
): Task[] {
  return tasks.map((task) =>
    selected.has(task.id)
      ? assignProjectDeep(task, projectId)
      : { ...task, children: setProjectForIds(task.children, selected, projectId) }
  );
}

export function normalizeChildProjects(tasks: Task[]): Task[] {
  return tasks.map((task) => assignProjectDeep(task, task.projectId));
}

/** Flat, ordered list of visible task ids, respecting collapsed nodes. */
export function flattenVisible(
  tasks: Task[],
  collapsedIds: Set<TaskId>
): TaskId[] {
  const result: TaskId[] = [];
  for (const t of tasks) {
    result.push(t.id);
    if (t.children.length > 0 && !collapsedIds.has(t.id)) {
      result.push(...flattenVisible(t.children, collapsedIds));
    }
  }
  return result;
}

/** Place `taskId` immediately before `beforeId`, as its sibling. */
export function relocateTask(
  tasks: Task[],
  taskId: TaskId,
  beforeId: TaskId
): Task[] {
  if (taskId === beforeId) return tasks;

  const taskNode = findById(tasks, taskId);
  if (taskNode == null) return tasks;
  if (findById(taskNode.children, beforeId) != null) return tasks; // own subtree

  const withoutTask = removeById(tasks, taskId);
  const targetParentId = findParentId(withoutTask, beforeId);

  if (targetParentId == null) {
    const targetIdx = withoutTask.findIndex((t) => t.id === beforeId);
    if (targetIdx === -1) return tasks;
    const result = [...withoutTask];
    result.splice(targetIdx, 0, taskNode);
    return result;
  }

  return mapById(withoutTask, targetParentId, (parent) => {
    const targetIdx = parent.children.findIndex((c) => c.id === beforeId);
    if (targetIdx === -1) return parent;
    const newChildren = [...parent.children];
    newChildren.splice(targetIdx, 0, taskNode);
    return { ...parent, children: newChildren };
  });
}

/** Move `taskId` to sit immediately *after* `afterId` (same parent as it). */
export function relocateAfter(
  tasks: Task[],
  taskId: TaskId,
  afterId: TaskId
): Task[] {
  if (taskId === afterId) return tasks;

  const taskNode = findById(tasks, taskId);
  if (taskNode == null) return tasks;
  if (findById(taskNode.children, afterId) != null) return tasks; // own subtree

  const withoutTask = removeById(tasks, taskId);
  const targetParentId = findParentId(withoutTask, afterId);

  if (targetParentId == null) {
    const targetIdx = withoutTask.findIndex((t) => t.id === afterId);
    if (targetIdx === -1) return tasks; // target vanished → leave the tree untouched
    const result = [...withoutTask];
    result.splice(targetIdx + 1, 0, taskNode);
    return result;
  }

  return mapById(withoutTask, targetParentId, (parent) => {
    const targetIdx = parent.children.findIndex((c) => c.id === afterId);
    if (targetIdx === -1) return parent;
    const newChildren = [...parent.children];
    newChildren.splice(targetIdx + 1, 0, taskNode);
    return { ...parent, children: newChildren };
  });
}

/** Make `taskId` the first child of `newParentId`. */
export function relocateAsChild(
  tasks: Task[],
  taskId: TaskId,
  newParentId: TaskId
): Task[] {
  if (taskId === newParentId) return tasks;

  const taskNode = findById(tasks, taskId);
  if (taskNode == null) return tasks;
  if (findById(taskNode.children, newParentId) != null) return tasks; // own subtree

  const withoutTask = removeById(tasks, taskId);

  return mapById(withoutTask, newParentId, (parent) => ({
    ...parent,
    children: [taskNode, ...parent.children],
  }));
}

// ─── Outline editing (capture UX: Tab / Shift+Tab) ──────────────────

interface LevelResult {
  list: Task[];
  /** Whether the target id was located at (or under) this level. */
  done: boolean;
}

/**
 * Indent: make `id` the last child of its previous sibling. No-op if `id` has
 * no previous sibling (nothing to nest under) or isn't found.
 */
export function indentTask(tasks: Task[], id: TaskId): Task[] {
  function recur(list: Task[]): LevelResult {
    const idx = list.findIndex((t) => t.id === id);
    if (idx > 0) {
      const target = list[idx];
      const prev = list[idx - 1];
      const newPrev: Task = { ...prev, children: [...prev.children, target] };
      const newList = [...list];
      newList.splice(idx - 1, 2, newPrev);
      return { list: newList, done: true };
    }
    if (idx === 0) return { list, done: true }; // found, but no previous sibling

    let changed = false;
    const newList = list.map((t) => {
      if (changed) return t;
      const res = recur(t.children);
      if (res.done) {
        changed = true;
        return { ...t, children: res.list };
      }
      return t;
    });
    return { list: newList, done: changed };
  }
  return recur(tasks).list;
}

/**
 * Indent `id` to become the last child of `underId`. Unlike {@link indentTask},
 * the caller names the new parent, so the outline can nest under the previous
 * *visible* sibling and ignore rows the current view filters out (e.g. tasks not
 * planned for today). No-op unless `underId` is an earlier sibling of `id`.
 */
export function indentUnder(tasks: Task[], id: TaskId, underId: TaskId): Task[] {
  function recur(list: Task[]): LevelResult {
    const idx = list.findIndex((t) => t.id === id);
    if (idx !== -1) {
      const underIdx = list.findIndex((t) => t.id === underId);
      // underId must be a sibling that sits before id; otherwise leave as-is.
      if (underIdx === -1 || underIdx >= idx) return { list, done: true };
      const target = list[idx];
      const under = list[underIdx];
      const newUnder: Task = { ...under, children: [...under.children, target] };
      const newList = list.filter((t) => t.id !== id);
      newList[newList.findIndex((t) => t.id === underId)] = newUnder;
      return { list: newList, done: true };
    }

    let changed = false;
    const newList = list.map((t) => {
      if (changed) return t;
      const res = recur(t.children);
      if (res.done) {
        changed = true;
        return { ...t, children: res.list };
      }
      return t;
    });
    return { list: newList, done: changed };
  }
  return recur(tasks).list;
}

/**
 * Outdent: lift `id` out of its parent to become the parent's next sibling.
 * No-op if `id` is already top-level or isn't found.
 */
export function outdentTask(tasks: Task[], id: TaskId): Task[] {
  if (tasks.some((t) => t.id === id)) return tasks; // already top-level

  function recur(list: Task[]): LevelResult {
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const childIdx = p.children.findIndex((c) => c.id === id);
      if (childIdx !== -1) {
        const target = p.children[childIdx];
        const newParent: Task = {
          ...p,
          children: p.children.filter((c) => c.id !== id),
        };
        const newList = [...list];
        newList.splice(i, 1, newParent);
        newList.splice(i + 1, 0, target);
        return { list: newList, done: true };
      }
    }

    let changed = false;
    const newList = list.map((t) => {
      if (changed) return t;
      const res = recur(t.children);
      if (res.done) {
        changed = true;
        return { ...t, children: res.list };
      }
      return t;
    });
    return { list: newList, done: changed };
  }
  return recur(tasks).list;
}

// ─── Reorder (multi-select; adapted from nutriapp moveSelectedItems) ─

/**
 * Bubble selected items one slot up/down within a single array, skipping over
 * other selected items so a contiguous block moves together.
 *
 * With `visible`, the bubble happens only among the *visible* items while hidden
 * ones stay pinned to their slots — so a reorder in a filtered view never
 * silently swaps a task past a sibling the view is hiding (which looks like a
 * no-op). Omit `visible` to reorder the raw list.
 */
export function moveSelectedItems<T extends { id: TaskId }>(
  items: T[],
  selected: Set<TaskId>,
  dir: "up" | "down",
  visible?: Set<TaskId>
): T[] {
  if (selected.size === 0) return items;

  if (visible != null) {
    const slots: number[] = [];
    const visibleItems: T[] = [];
    items.forEach((item, i) => {
      if (visible.has(item.id)) {
        slots.push(i);
        visibleItems.push(item);
      }
    });
    const moved = moveSelectedItems(visibleItems, selected, dir); // raw bubble of the visible subsequence
    const next = [...items];
    slots.forEach((slot, k) => {
      next[slot] = moved[k];
    });
    return next;
  }

  const next = [...items];
  if (dir === "up") {
    for (let i = 1; i < next.length; i++) {
      if (selected.has(next[i].id) && !selected.has(next[i - 1].id)) {
        [next[i - 1], next[i]] = [next[i], next[i - 1]];
      }
    }
    return next;
  }
  for (let i = next.length - 2; i >= 0; i--) {
    if (selected.has(next[i].id) && !selected.has(next[i + 1].id)) {
      [next[i], next[i + 1]] = [next[i + 1], next[i]];
    }
  }
  return next;
}

function replaceProjectRootOrder(
  tasks: Task[],
  projectId: ProjectId,
  desiredIds: TaskId[]
): Task[] {
  const desired = new Set(desiredIds);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  let cursor = 0;
  return tasks.map((task) => {
    if (task.projectId !== projectId || !desired.has(task.id)) return task;
    const replacement = byId.get(desiredIds[cursor]);
    cursor += 1;
    return replacement ?? task;
  });
}

function insertIndexForEmptyProject(
  tasks: Task[],
  projects: Project[],
  targetProjectId: ProjectId
): number {
  const order = new Map(projects.map((project, index) => [project.id, index]));
  const targetIndex = order.get(targetProjectId) ?? 0;
  const laterIndex = tasks.findIndex(
    (task) => (order.get(task.projectId) ?? Number.MAX_SAFE_INTEGER) > targetIndex
  );
  return laterIndex === -1 ? tasks.length : laterIndex;
}

function moveRootBlockToProject(
  tasks: Task[],
  selectedIds: TaskId[],
  targetProjectId: ProjectId,
  projects: Project[],
  position: "start" | "end"
): Task[] {
  const selected = new Set(selectedIds);
  const block = tasks
    .filter((task) => selected.has(task.id))
    .map((task) => assignProjectDeep(task, targetProjectId));
  if (block.length === 0) return tasks;

  const rest = tasks.filter((task) => !selected.has(task.id));
  const targetIndexes = rest
    .map((task, index) => (task.projectId === targetProjectId ? index : -1))
    .filter((index) => index !== -1);

  const insertAt =
    targetIndexes.length === 0
      ? insertIndexForEmptyProject(rest, projects, targetProjectId)
      : position === "start"
        ? targetIndexes[0]
        : targetIndexes[targetIndexes.length - 1] + 1;

  return [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)];
}

export function reorderSelectedAcrossProjects(
  tasks: Task[],
  selected: Set<TaskId>,
  dir: "up" | "down",
  projects: Project[],
  visible?: Set<TaskId>
): Task[] {
  if (selected.size === 0) return tasks;
  if (![...selected].every((id) => tasks.some((task) => task.id === id))) {
    return reorderSelected(tasks, selected, dir, visible);
  }

  const groupIndex = projects.findIndex((project) =>
    tasks.some((task) => task.projectId === project.id && selected.has(task.id))
  );
  if (groupIndex === -1) return reorderSelected(tasks, selected, dir, visible);

  const project = projects[groupIndex];
  const groupIds = tasks
    .filter((task) => task.projectId === project.id)
    .map((task) => task.id);
  // Position/boundary decisions run over the *visible* siblings: moving "down"
  // past the last visible task should cross into the next project even if hidden
  // tasks trail behind it in the raw order.
  const groupVisibleIds = groupIds.filter((id) => visible == null || visible.has(id));
  const selectedIndexes = groupVisibleIds
    .map((id, index) => (selected.has(id) ? index : -1))
    .filter((index) => index !== -1);

  if (selectedIndexes.length !== selected.size) return reorderSelected(tasks, selected, dir, visible);

  const first = selectedIndexes[0];
  const last = selectedIndexes[selectedIndexes.length - 1];
  const isContiguous = selectedIndexes.every((index, offset) => index === first + offset);
  if (!isContiguous) return reorderSelected(tasks, selected, dir, visible);

  const block = groupVisibleIds.slice(first, last + 1);

  if (dir === "up") {
    if (first > 0) {
      const desired = moveSelectedItems(groupIds.map((id) => ({ id })), selected, "up", visible).map(
        (item) => item.id
      );
      return replaceProjectRootOrder(tasks, project.id, desired);
    }
    const target = projects[groupIndex - 1];
    if (target == null) return tasks;
    return moveRootBlockToProject(tasks, block, target.id, projects, "end");
  }

  if (last < groupVisibleIds.length - 1) {
    const desired = moveSelectedItems(groupIds.map((id) => ({ id })), selected, "down", visible).map(
      (item) => item.id
    );
    return replaceProjectRootOrder(tasks, project.id, desired);
  }
  const target = projects[groupIndex + 1];
  if (target == null) return tasks;
  return moveRootBlockToProject(tasks, block, target.id, projects, "start");
}

/** Apply the sibling bubble at every level, so selection reorders within each parent. */
export function reorderSelected(
  tasks: Task[],
  selected: Set<TaskId>,
  dir: "up" | "down",
  visible?: Set<TaskId>
): Task[] {
  const moved = moveSelectedItems(tasks, selected, dir, visible);
  return moved.map((t) => ({
    ...t,
    children: reorderSelected(t.children, selected, dir, visible),
  }));
}

// ─── Traversal utilities ────────────────────────────────────────────

export function walk(tasks: Task[], fn: (t: Task, parent: Task | null) => void): void {
  function go(list: Task[], parent: Task | null) {
    for (const t of list) {
      fn(t, parent);
      go(t.children, t);
    }
  }
  go(tasks, null);
}

export function isLeaf(t: Task): boolean {
  return t.children.length === 0;
}

/**
 * A task is *resolved* once it's either completed or intentionally skipped
 * ("won't do"). Resolved leaves never reckon and drop out of the done/total
 * counts. `isOpen` is the complement — still awaiting a decision.
 */
export function isResolved(t: Task): boolean {
  return t.completed || t.wontDo != null;
}

export function isOpen(t: Task): boolean {
  return !isResolved(t);
}

export function countPending(tasks: Task[]): number {
  let count = 0;
  walk(tasks, (t) => {
    if (!t.completed) count++;
  });
  return count;
}

/** All leaf tasks matching a predicate, in tree order. */
export function leavesWhere(tasks: Task[], pred: (t: Task) => boolean): Task[] {
  const out: Task[] = [];
  walk(tasks, (t) => {
    if (isLeaf(t) && pred(t)) out.push(t);
  });
  return out;
}
