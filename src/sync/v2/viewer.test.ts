import { beforeEach, describe, expect, it } from "vitest";
import { ViewerSync, type ViewerSnapshot } from "./viewer";
import { DocSync, type EngineHost } from "./engine";
import { MemoryStore } from "./memoryStore";
import { initStore } from "../../store/store";
import { repairRanks } from "../../store/placement";
import { findById, makeTask, mapById } from "../../store/tasks";
import { emptyState, type AppState, type Task, type TaskId } from "../../types";

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
});
