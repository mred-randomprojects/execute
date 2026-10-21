import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RETRY_BACKOFF_MS, ViewerSync, type ViewerSnapshot } from "./viewer";
import { DocSync, type EngineHost } from "./engine";
import { MemoryStore } from "./memoryStore";
import { initStore } from "../../store/store";
import { repairRanks } from "../../store/placement";
import { findById, makeTask, mapById } from "../../store/tasks";
import { emptyState, type AppState, type Habit, type HabitId, type Task, type TaskId } from "../../types";
import { markStamped } from "../../store/habits";
import { setHabitMark } from "../../viewer/intents";

const DAY = 86_400_000;

function desktop(store: MemoryStore, initial: AppState) {
  let version = 0;
  const host: EngineHost & { state: AppState; edit(fn: (s: AppState) => AppState): void } = {
    state: initial,
    ready: () => true,
    getLocal: () => host.state,
    version: () => version,
    adopt: (next) => {
      host.state = next;
    },
    edit: (fn) => {
      host.state = fn(host.state);
      version++;
    },
  };
  let v = 0;
  const engine = new DocSync(store, host, { get: () => v, set: (at) => void (v = at) }, {
    migration: { loadV1: async () => null, freezeV1: async () => {} },
    deliveryTimeoutMs: 30,
  });
  engine.start();
  return { host, engine };
}

function phone(store: MemoryStore) {
  const seen: ViewerSnapshot[] = [];
  const errors: unknown[] = [];
  const sync = new ViewerSync(store, (s) => seen.push(s), (e) => errors.push(e));
  sync.start();
  return { sync, seen, errors, last: () => sync.snapshot() };
}

const texts = (s: ViewerSnapshot) => (s.phase === "ready" ? s.state.tasks.map((t) => t.text).sort() : []);

function setCompleted(tasks: Task[], id: TaskId, completed: boolean): Task[] {
  return mapById(tasks, id, (t) => ({
    ...t,
    completed,
    completedAt: completed ? Date.now() : null,
    updatedAt: Math.max(Date.now(), t.updatedAt + 1),
  }));
}

function sample(): AppState {
  const now = Date.now();
  return {
    ...emptyState(),
    tasks: repairRanks([
      makeTask("open"),
      { ...makeTask("done yesterday"), completed: true, completedAt: now - DAY },
      { ...makeTask("done last month"), completed: true, completedAt: now - 30 * DAY },
      { ...makeTask("parent"), children: repairRanks([makeTask("open child")]) },
    ]),
  };
}

beforeEach(async () => {
  localStorage.clear();
  await initStore();
});

describe("the phone's view", () => {
  it("waits for the desktop to finish moving the data", async () => {
    const store = new MemoryStore();
    const p = phone(store);
    expect(p.last().phase).toBe("notMigrated");
    const d = desktop(store, sample());
    await d.engine.syncNow();
    expect(p.last().phase).toBe("ready");
  });

  it("loads open and recently completed tasks, not the whole history", async () => {
    const store = new MemoryStore();
    const d = desktop(store, sample());
    await d.engine.syncNow();
    const p = phone(store);
    expect(texts(p.last())).toEqual(["done yesterday", "open", "parent"]);
    const parent = p.last().phase === "ready" ? (p.last() as { state: AppState }).state.tasks.find((t) => t.text === "parent") : undefined;
    expect(parent?.children.map((t) => t.text)).toEqual(["open child"]);
  });

  it("a check-off is one small guarded write, and the desktop picks it up", async () => {
    const store = new MemoryStore();
    const d = desktop(store, sample());
    await d.engine.syncNow();
    const p = phone(store);
    const id = d.host.state.tasks.find((t) => t.text === "open")?.id as TaskId;

    const writes = store.writes;
    await p.sync.apply((s) => ({ ...s, tasks: setCompleted(s.tasks, id, true) }));
    expect(store.writes - writes).toBe(1);

    await d.engine.syncNow();
    expect(findById(d.host.state.tasks, id)?.completed).toBe(true);
  });

  it("a task added on the phone lands on the desktop, ranked and in place", async () => {
    const store = new MemoryStore();
    const d = desktop(store, sample());
    await d.engine.syncNow();
    const p = phone(store);
    const task = makeTask("captured on the phone");
    const add = (s: AppState) => (findById(s.tasks, task.id) != null ? s : { ...s, tasks: [...s.tasks, task] });
    await p.sync.apply(add);
    await p.sync.apply(add); // idempotent: a retry adds nothing

    await d.engine.syncNow();
    const landed = d.host.state.tasks.filter((t) => t.text === "captured on the phone");
    expect(landed).toHaveLength(1);
    expect(landed[0].rank).not.toBe("");
    expect(d.host.state.tasks[d.host.state.tasks.length - 1].id).toBe(task.id);
  });

  it("retries on a refreshed view when the desktop changed the same task first", async () => {
    const store = new MemoryStore();
    const d = desktop(store, sample());
    await d.engine.syncNow();
    const p = phone(store);
    const id = d.host.state.tasks.find((t) => t.text === "open")?.id as TaskId;

    store.hold(); // the phone's view goes stale…
    d.host.edit((s) => ({
      ...s,
      tasks: mapById(s.tasks, id, (t) => ({ ...t, notes: "desk note", updatedAt: t.updatedAt + 1 })),
    }));
    await d.engine.syncNow(); // …while the desktop writes the same task
    const applying = p.sync.apply((s) => ({ ...s, tasks: setCompleted(s.tasks, id, true) }));
    store.release();
    await applying;
    expect(store.refused).toBe(1); // the stale write was refused, not applied

    await d.engine.syncNow();
    const t = findById(d.host.state.tasks, id);
    expect(t?.completed).toBe(true); // the phone's intent, re-applied on the fresh view…
    expect(t?.notes).toBe("desk note"); // …over the desktop's edit, not instead of it
  });

  it("refuses to write data saved by a newer schema", async () => {
    const store = new MemoryStore();
    const d = desktop(store, sample());
    await d.engine.syncNow();
    await store.commit([{ collection: "meta", id: "state", op: "patch", fields: { schemaVersion: 999 } }]);
    const p = phone(store);
    const snap = p.last();
    expect(snap.phase === "ready" && snap.outdated).toBe(true);
    await expect(p.sync.apply((s) => ({ ...s, tasks: [...s.tasks, makeTask("x")] }))).rejects.toThrow(/newer version/);
  });

  it("habits: the phone checks in, the desktop marks another day, both keep both", async () => {
    const store = new MemoryStore();
    const habit: Habit = {
      id: "habit-1" as HabitId,
      name: "Stretch",
      cue: "",
      perWeek: 7,
      checks: {},
      checkedAt: {},
      measure: null,
      values: {},
      notes: {},
      archivedAt: null,
      rank: 0,
      createdAt: Date.now() - 10 * DAY,
      updatedAt: Date.now() - 10 * DAY,
    };
    const d = desktop(store, { ...sample(), habits: [habit] });
    await d.engine.syncNow();
    const p = phone(store);
    const snap = p.last();
    expect(snap.phase === "ready" ? snap.state.habits.map((h) => h.name) : []).toEqual(["Stretch"]);

    store.hold(); // neither hears the other for a while
    d.host.edit((s) => ({
      ...s,
      habits: s.habits.map((h) => markStamped(h, "2026-10-01", "done", Date.now())),
    }));
    await d.engine.syncNow();
    const writes = store.writes;
    const applying = p.sync.apply((s) => ({ ...s, habits: setHabitMark(s.habits, habit.id, "2026-10-02", "done") }));
    store.release();
    await applying;
    expect(store.writes - writes).toBeGreaterThanOrEqual(1);
    await p.sync.apply((s) => ({ ...s, habits: setHabitMark(s.habits, habit.id, "2026-10-02", "done") })); // idempotent

    await d.engine.syncNow();
    expect(d.host.state.habits[0].checks).toEqual({ "2026-10-01": "done", "2026-10-02": "done" });
    const after = p.last();
    expect(after.phase === "ready" ? after.state.habits[0].checks : null).toEqual({
      "2026-10-01": "done",
      "2026-10-02": "done",
    });
  });
});

describe("a phone edit whose write fails", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const ready = (snap: ViewerSnapshot) => {
    if (snap.phase !== "ready") throw new Error(`not ready: ${snap.phase}`);
    return snap;
  };
  const add = (task: Task) => (s: AppState) =>
    findById(s.tasks, task.id) != null ? s : { ...s, tasks: [...s.tasks, task] };

  it("stays on screen as unsaved, says why, and lands once when retried", async () => {
    const store = new MemoryStore();
    const d = desktop(store, sample());
    await d.engine.syncNow();
    const p = phone(store);
    const task = makeTask("typed on the subway");

    store.failNext = new Error("The cloud didn't answer in time");
    await expect(p.sync.apply(add(task))).rejects.toThrow(/didn't answer/);
    expect(store.read("tasks", task.id)).toBeUndefined();
    const failed = ready(p.last());
    expect(failed.unsaved).toBe(1);
    expect(failed.saveError).toMatch(/didn't answer/);
    expect(failed.state.tasks.some((t) => t.id === task.id)).toBe(true); // not lost

    p.sync.retryNow();
    await vi.waitFor(() => expect(ready(p.last()).unsaved).toBe(0));
    expect(store.read("tasks", task.id)).toBeDefined();
    const saved = ready(p.last());
    expect(saved.unsaved).toBe(0);
    expect(saved.saveError).toBeNull();
    expect(saved.state.tasks.filter((t) => t.id === task.id)).toHaveLength(1);

    await d.engine.syncNow();
    expect(d.host.state.tasks.filter((t) => t.text === "typed on the subway")).toHaveLength(1);
    p.sync.stop();
  });

  it("is retried by itself, with backoff", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const store = new MemoryStore();
    const d = desktop(store, sample());
    await d.engine.syncNow();
    const p = phone(store);
    const task = makeTask("retried by the timer");

    store.failNext = new Error("offline");
    await expect(p.sync.apply(add(task))).rejects.toThrow("offline");
    store.failNext = new Error("still offline");
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[0]);
    expect(store.read("tasks", task.id)).toBeUndefined();
    expect(ready(p.last()).saveError).toBe("still offline");

    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[1]);
    expect(store.read("tasks", task.id)).toBeDefined();
    expect(ready(p.last()).unsaved).toBe(0);
    p.sync.stop();
  });

  it("holds back every later edit, so the cloud ends up in the order they were made", async () => {
    const store = new MemoryStore();
    const d = desktop(store, sample());
    await d.engine.syncNow();
    const p = phone(store);
    const id = d.host.state.tasks.find((t) => t.text === "open")?.id as TaskId;
    const complete = (done: boolean) => (s: AppState) => ({ ...s, tasks: setCompleted(s.tasks, id, done) });

    store.failNext = new Error("offline");
    const first = p.sync.apply(complete(true)).catch(() => "failed");
    const second = p.sync.apply(complete(false)); // made after the first, on screen
    expect(await first).toBe("failed");
    expect(ready(p.last()).unsaved).toBe(2);
    expect((store.read("tasks", id) as Task).completed).toBe(false);
    expect(findById(ready(p.last()).state.tasks, id)?.completed).toBe(false); // the newest intent shows

    p.sync.retryNow();
    await second;
    expect(ready(p.last()).unsaved).toBe(0);
    // Both were written, oldest first: the later "not done" is what stands.
    expect((store.read("tasks", id) as Task).completed).toBe(false);
    expect(store.writes).toBeGreaterThan(0);
    await d.engine.syncNow();
    expect(findById(d.host.state.tasks, id)?.completed).toBe(false);
    p.sync.stop();
  });

  it("an edit after a failed one is not written ahead of it", async () => {
    const store = new MemoryStore();
    const d = desktop(store, sample());
    await d.engine.syncNow();
    const p = phone(store);
    const a = makeTask("first capture");
    const b = makeTask("second capture");

    store.failNext = new Error("offline");
    await expect(p.sync.apply(add(a))).rejects.toThrow("offline");
    // A new edit tries the failed one again first; that fails too, so the new
    // one waits behind it instead of going out ahead.
    store.failNext = new Error("still offline");
    const later = p.sync.apply(add(b));
    await vi.waitFor(() => expect(ready(p.last()).saveError).toBe("still offline"));
    expect(ready(p.last()).unsaved).toBe(2);
    expect(store.read("tasks", a.id)).toBeUndefined();
    expect(store.read("tasks", b.id)).toBeUndefined();
    expect(ready(p.last()).state.tasks.map((t) => t.text)).toEqual(
      expect.arrayContaining(["first capture", "second capture"]),
    );

    p.sync.retryNow();
    await later;
    expect(store.read("tasks", a.id)).toBeDefined();
    expect(store.read("tasks", b.id)).toBeDefined();
    p.sync.stop();
  });
});
