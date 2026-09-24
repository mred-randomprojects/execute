import { describe, expect, it } from "vitest";
import { jsonEqual, mergeStates } from "./merge";
import { placeTasks } from "../store/placement";
import { makeTask } from "../store/tasks";
import { emptyState, type AppState, type Project, type ProjectId, type Task, type TaskId } from "../types";

// v18: placement (parent + sibling rank) is merged per task by `movedAt`,
// independently of content. These drive two "devices" as pure trees, stamping
// placement exactly as the store's choke point does (placeTasks), then merge.

/** Build a tree from a nested spec; ids are the texts, so tests read plainly. */
type Spec = string | [string, Spec[]];
function build(specs: Spec[]): Task[] {
  return specs.map((s) => {
    const [text, kids] = typeof s === "string" ? [s, []] : s;
    return { ...makeTask(text), id: text as TaskId, createdAt: 0, updatedAt: 0, children: build(kids) };
  });
}

/** One device's state, as the store would hold it after `tasks` landed at `now`. */
function device(prev: Task[], next: Task[], now: number): AppState {
  return { ...emptyState(), tasks: placeTasks(prev, next, now) };
}

/** The tree shape only: nested ids in order. */
type Shape = [string, Shape[]];
const shape = (tasks: Task[]): Shape[] => tasks.map((t) => [t.id, shape(t.children)]);

function without(tasks: Task[], id: TaskId): [Task[], Task | null] {
  let found: Task | null = null;
  const out: Task[] = [];
  for (const t of tasks) {
    if (t.id === id) {
      found = t;
      continue;
    }
    const [children, f] = without(t.children, id);
    if (f != null) found = f;
    out.push(children === t.children ? t : { ...t, children });
  }
  return [found != null ? out : tasks, found];
}

/** Move `id` to `index` under `parent` (null = top level). */
function move(tasks: Task[], id: TaskId, parent: TaskId | null, index: number): Task[] {
  const [rest, node] = without(tasks, id);
  if (node == null) throw new Error(`no ${id}`);
  const put = (list: Task[]): Task[] => {
    const i = Math.max(0, Math.min(index, list.length));
    return [...list.slice(0, i), node, ...list.slice(i)];
  };
  if (parent == null) return put(rest);
  const into = (list: Task[]): Task[] =>
    list.map((t) => (t.id === parent ? { ...t, children: put(t.children) } : { ...t, children: into(t.children) }));
  return into(rest);
}

function edit(tasks: Task[], id: TaskId, text: string, at: number): Task[] {
  return tasks.map((t) =>
    t.id === id ? { ...t, text, updatedAt: at } : { ...t, children: edit(t.children, id, text, at) },
  );
}

const base = build(["a", "b", "c", ["p", ["x", "y"]]]);
const start = device([], base, 1).tasks;

describe("merging placement per task", () => {
  it("a move on one device and an edit on the other both survive", () => {
    const moved = device(start, move(start, "c" as TaskId, null, 0), 10); // phone: c to the top
    const edited = { ...emptyState(), tasks: edit(start, "a" as TaskId, "A!", 20) }; // desktop edits a, later
    const merged = mergeStates(edited, moved);
    expect(shape(merged.tasks).map(([id]) => id)).toEqual(["c", "a", "b", "p"]);
    expect(merged.tasks[1].text).toBe("A!");
  });

  it("the writer's older shape no longer overrides the other device's move", () => {
    const moved = device(start, move(start, "x" as TaskId, null, 1), 10); // x out of p
    const stale = { ...emptyState(), tasks: start }; // the writer never saw it
    const merged = mergeStates(stale, moved);
    expect(shape(merged.tasks)).toEqual([["a", []], ["x", []], ["b", []], ["c", []], ["p", [["y", []]]]]);
  });

  it("a newer move beats an older one of the same task", () => {
    const older = device(start, move(start, "a" as TaskId, "p" as TaskId, 0), 10);
    const newer = device(start, move(start, "a" as TaskId, null, 2), 20);
    for (const merged of [mergeStates(older, newer), mergeStates(newer, older)]) {
      expect(shape(merged.tasks).map(([id]) => id)).toEqual(["b", "c", "a", "p"]);
    }
  });

  it("opposite moves that would form a loop resolve, and nothing is lost", () => {
    const tree = device([], build(["m", "n"]), 1).tasks;
    const here = device(tree, move(tree, "m" as TaskId, "n" as TaskId, 0), 10); // m under n
    const there = device(tree, move(tree, "n" as TaskId, "m" as TaskId, 0), 20); // n under m, later
    for (const merged of [mergeStates(here, there), mergeStates(there, here)]) {
      // The older move (m under n) loses: m is back at the top, holding n.
      expect(shape(merged.tasks)).toEqual([["m", [["n", []]]]]);
    }
  });

  it("an add nested on the other device lands where it was made", () => {
    const added = device(start, move([...start, { ...makeTask("z"), id: "z" as TaskId }], "z" as TaskId, "p" as TaskId, 1), 10);
    const merged = mergeStates({ ...emptyState(), tasks: start }, added);
    expect(shape(merged.tasks)[3]).toEqual(["p", [["x", []], ["z", []], ["y", []]]]);
  });

  it("children of a task deleted before tombstones stay deleted", () => {
    // A pre-v17 Trash entry records only the root of what it buried.
    const p = start[3];
    const trashedHere: AppState = {
      ...emptyState(),
      tasks: start.slice(0, 3),
      trash: [{ task: p, deletedAt: 50 }],
    };
    const merged = mergeStates(trashedHere, { ...emptyState(), tasks: start });
    expect(shape(merged.tasks).map(([id]) => id)).toEqual(["a", "b", "c"]);
  });

  it("projects: the newer rename wins on either side", () => {
    const proj = (name: string, updatedAt: number): Project => ({
      id: "w" as ProjectId,
      name,
      color: "#000",
      createdAt: 0,
      updatedAt,
    });
    const a = { ...emptyState(), projects: [proj("Work", 5)] };
    const b = { ...emptyState(), projects: [proj("Job", 9)] };
    expect(mergeStates(a, b).projects.find((p) => p.id === "w")?.name).toBe("Job");
    expect(mergeStates(b, a).projects.find((p) => p.id === "w")?.name).toBe("Job");
  });
});

// ─── Randomized: two devices, interleaved moves and edits ────────────

/** Deterministic PRNG (mulberry32), so a failure reproduces. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ids(tasks: Task[], out: TaskId[] = []): TaskId[] {
  for (const t of tasks) {
    out.push(t.id);
    ids(t.children, out);
  }
  return out;
}
function subtreeIds(tasks: Task[], id: TaskId): Set<TaskId> {
  const [, node] = without(tasks, id);
  return new Set(node == null ? [] : [id, ...ids(node.children)]);
}
function siblingsOf(tasks: Task[], parent: TaskId | null): Task[] {
  if (parent == null) return tasks;
  for (const t of tasks) {
    if (t.id === parent) return t.children;
    const hit = siblingsOf(t.children, parent);
    if (hit.length > 0 || ids(t.children).includes(parent)) return hit;
  }
  return [];
}

/** Apply `n` random moves/edits; clocks come from `clock` so the two devices never tie. */
function randomOps(state: AppState, n: number, rand: () => number, clock: () => number): AppState {
  let tasks = state.tasks;
  for (let k = 0; k < n; k++) {
    const all = ids(tasks);
    const id = all[Math.floor(rand() * all.length)];
    const now = clock();
    if (rand() < 0.35) {
      tasks = edit(tasks, id, `${id}@${now}`, now);
      continue;
    }
    const banned = subtreeIds(tasks, id);
    const parents = [null, ...all.filter((p) => !banned.has(p))];
    const parent = parents[Math.floor(rand() * parents.length)];
    const index = Math.floor(rand() * (siblingsOf(tasks, parent).length + 1));
    tasks = placeTasks(tasks, move(tasks, id, parent, index), now);
  }
  return { ...state, tasks };
}

describe("two devices always converge", () => {
  const seed0 = build(["a", "b", ["c", ["c1", "c2"]], "d", ["e", ["e1", ["e2", ["e3"]]]], "f"]);
  const shared = device([], seed0, 1);

  for (let seed = 1; seed <= 200; seed++) {
    it(`seed ${seed}`, () => {
      const rand = rng(seed);
      let tA = 100;
      let tB = 101;
      const A = randomOps(shared, 1 + Math.floor(rand() * 6), rand, () => (tA += 2));
      const B = randomOps(shared, 1 + Math.floor(rand() * 6), rand, () => (tB += 2));

      const ab = mergeStates(A, B);
      const ba = mergeStates(B, A);
      // Same tree whichever device writes…
      expect(shape(ab.tasks)).toEqual(shape(ba.tasks));
      // …nothing lost or duplicated…
      expect(ids(ab.tasks).sort()).toEqual(ids(shared.tasks).sort());
      // …and a fixed point: merging again changes nothing (no push↔pull loop).
      expect(jsonEqual(mergeStates(ab, B), ab)).toBe(true);
      expect(jsonEqual(mergeStates(ab, A), ab)).toBe(true);
    });
  }
});
