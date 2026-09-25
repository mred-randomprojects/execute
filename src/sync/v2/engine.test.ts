import { beforeEach, describe, expect, it } from "vitest";
import { DocSync, FORMAT_DOC_ID, canonicalDocs, type EngineHost, type Watermark } from "./engine";
import { MemoryStore } from "./memoryStore";
import type { DocWrite } from "../docs";
import { jsonEqual } from "../merge";
import { placeTasks, repairRanks } from "../../store/placement";
import { makeTask } from "../../store/tasks";
import {
  addChild,
  addTaskAfter,
  createRecurrence,
  emptyTrash,
  getState,
  initStore,
  toggleComplete,
  trashTask,
} from "../../store/store";
import { defaultRule } from "../../store/recurrence";
import { emptyState, type AppState, type LogEntry, type Task, type TaskId } from "../../types";

// ─── A device: local state + engine, over a shared in-memory cloud ──

interface Device extends EngineHost {
  state: AppState;
  engine: DocSync;
  edit(fn: (s: AppState) => AppState): void;
  adopted: number;
}

function memoryWatermark(): Watermark {
  let v = 0;
  return { get: () => v, set: (at) => void (v = at) };
}

function device(
  store: MemoryStore,
  initial: AppState,
  opts: { v1?: AppState | null; frozen?: { count: number }; now?: () => number } = {},
): Device {
  let version = 0;
  const d: Device = {
    state: initial,
    adopted: 0,
    ready: () => true,
    getLocal: () => d.state,
    version: () => version,
    adopt: (next) => {
      d.state = next;
      d.adopted++;
    },
    edit: (fn) => {
      d.state = fn(d.state);
      version++;
    },
    engine: undefined as unknown as DocSync, // replaced just below
  };
  d.engine = new DocSync(store, d, memoryWatermark(), {
    migration:
      opts.v1 === undefined
        ? undefined
        : {
            loadV1: async () => opts.v1 ?? null,
            freezeV1: async () => {
              if (opts.frozen) opts.frozen.count++;
            },
          },
    now: opts.now,
    deliveryTimeoutMs: 30,
    backoffMs: [60_000],
  });
  d.engine.start();
  return d;
}

const synced = (s: AppState) => {
  const docs = canonicalDocs(s);
  return {
    tasks: [...docs.tasks.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
    projects: [...docs.projects.entries()],
    recurrences: [...docs.recurrences.entries()],
    tombstones: [...docs.tombstones.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
  };
};

async function busy(): Promise<AppState> {
  const a = addTaskAfter(null, "a");
  const b = addTaskAfter(a, "b");
  addChild(b, "b1");
  const junk = addTaskAfter(b, "junk");
  trashTask(junk);
  const gone = addTaskAfter(b, "gone");
  trashTask(gone);
  await new Promise((r) => setTimeout(r, 3));
  emptyTrash();
  createRecurrence("water plants", defaultRule("2026-01-01"));
  toggleComplete(a);
  return getState();
}

function renamed(tasks: Task[], id: TaskId, text: string, at: number): Task[] {
  return tasks.map((t) =>
    t.id === id
      ? { ...t, text, updatedAt: Math.max(at, t.updatedAt + 1) }
      : { ...t, children: renamed(t.children, id, text, at) },
  );
}

beforeEach(async () => {
  localStorage.clear();
  await initStore();
});

describe("migration", () => {
  it("uploads everything, checks it reads back, then switches the cloud over", async () => {
    const store = new MemoryStore();
    const frozen = { count: 0 };
    const desk = device(store, await busy(), { v1: null, frozen });
    await desk.engine.syncNow();

    expect(desk.engine.getStatus().kind).toBe("inSync");
    const format = store.read("meta", FORMAT_DOC_ID);
    expect(format).toMatchObject({ version: 2, v1Frozen: true });
    expect(frozen.count).toBe(1);
    expect(store.data.get("tasks")?.size).toBe(3); // a, b, b1 (the Trash was emptied)

    const writes = store.writes;
    await desk.engine.syncNow();
    expect(store.writes).toBe(writes); // settled: nothing more to write
  });

  it("merges the v1 document in first, so the phone's last check-offs survive", async () => {
    const local = await busy();
    const phoneAdded = { ...makeTask("added on the phone, via v1"), rank: "zz" };
    const v1: AppState = { ...local, tasks: [...local.tasks, phoneAdded] };
    const store = new MemoryStore();
    const desk = device(store, local, { v1 });
    await desk.engine.syncNow();

    expect(desk.state.tasks.map((t) => t.text)).toContain("added on the phone, via v1");
    expect(store.read("tasks", phoneAdded.id)).toBeDefined();
  });

  it("writes a renamed Inbox whole — the reader's default is not a cloud document", async () => {
    // The reader fills in a default Inbox when the cloud has none, so a diff
    // against it saw an "existing" Inbox and sent a patch — which fails on a
    // document that isn't there. (Found rehearsing on real data.)
    const s = await busy();
    const renamedInbox: AppState = {
      ...s,
      projects: s.projects.map((p) => (p.id === "project-inbox" ? { ...p, name: "Work", updatedAt: 5 } : p)),
    };
    const store = new MemoryStore();
    const desk = device(store, renamedInbox, { v1: null });
    await desk.engine.syncNow();
    expect(desk.engine.getStatus().kind).toBe("inSync");
    expect(store.read("projects", "project-inbox")).toMatchObject({ name: "Work" });
  });

  it("a failure after the log went up doesn't send the whole log again", async () => {
    const line = (id: string, at: number): LogEntry => ({
      id,
      taskId: "t" as TaskId,
      taskText: "t",
      action: "completed",
      reason: null,
      at,
      date: "2026-09-24",
    });
    const log = Array.from({ length: 50 }, (_, i) => line(`l${i}`, 1000 + i)).reverse();
    let logWrites = 0;
    class Counting extends MemoryStore {
      override async commit(writes: readonly DocWrite[], expect?: Parameters<MemoryStore["commit"]>[1]) {
        const result = super.commit(writes, expect);
        await result;
        logWrites += writes.filter((w) => w.collection === "log").length;
      }
    }
    const store = new Counting();
    store.failNextGuarded = new Error("UNAVAILABLE"); // the switch-over marker fails once
    const desk = device(store, { ...(await busy()), log }, { v1: null });
    await desk.engine.syncNow();
    desk.engine.kick();
    await desk.engine.syncNow();
    expect(desk.engine.getStatus().kind).toBe("inSync");
    expect(store.read("meta", FORMAT_DOC_ID)).toBeDefined();
    expect(store.failNextGuarded).toBeNull(); // the failure did happen…
    expect(logWrites).toBe(50); // …and each line still went up exactly once
  });

  it("does not switch over until the upload reads back", async () => {
    // A cloud that drops every task's text never reads back as written.
    class Lossy extends MemoryStore {
      override async commit(writes: readonly DocWrite[], expect?: Parameters<MemoryStore["commit"]>[1]) {
        const strip = (o: object): Record<string, unknown> => {
          const c: Record<string, unknown> = { ...o };
          if ("text" in c) c.text = "";
          return c;
        };
        return super.commit(
          writes.map((w) =>
            w.collection !== "tasks"
              ? w
              : w.op === "set"
                ? { ...w, data: strip(w.data) }
                : w.op === "patch"
                  ? { ...w, fields: strip(w.fields) }
                  : w,
          ),
          expect,
        );
      }
    }
    const store = new Lossy();
    const desk = device(store, await busy(), { v1: null });
    await desk.engine.syncNow();
    expect(desk.engine.getStatus().kind).toBe("halted");
    expect(store.read("meta", FORMAT_DOC_ID)).toBeUndefined(); // never switched over
  });
});

describe("two devices", () => {
  async function pair() {
    const store = new MemoryStore();
    const desk = device(store, await busy(), { v1: null });
    await desk.engine.syncNow();
    const other = device(store, emptyState());
    await other.engine.syncNow();
    return { store, desk, other };
  }

  it("a device with nothing local downloads everything (and deletes nothing)", async () => {
    const { store, desk, other } = await pair();
    expect(jsonEqual(synced(other.state), synced(desk.state))).toBe(true);
    expect(store.read("tasks", desk.state.tasks[0].id)).toBeDefined();
  });

  it("an edit on one device reaches the other", async () => {
    const { desk, other } = await pair();
    const id = desk.state.tasks[0].id;
    other.edit((s) => ({ ...s, tasks: renamed(s.tasks, id, "from the other device", Date.now() + 5) }));
    await other.engine.syncNow();
    await desk.engine.syncNow();
    expect(desk.state.tasks[0].text).toBe("from the other device");
  });

  it("concurrent edits to different tasks both survive, even with a lagging view", async () => {
    const { store, desk, other } = await pair();
    const [x, y] = desk.state.tasks.map((t) => t.id);
    store.hold(); // neither device hears the other for a while
    desk.edit((s) => ({ ...s, tasks: renamed(s.tasks, x, "desk edit", Date.now() + 5) }));
    other.edit((s) => ({ ...s, tasks: renamed(s.tasks, y, "other edit", Date.now() + 6) }));
    await desk.engine.syncNow();
    await other.engine.syncNow();
    store.release();
    await desk.engine.syncNow();
    await other.engine.syncNow();
    await desk.engine.syncNow();

    for (const d of [desk, other]) {
      expect(d.state.tasks.find((t) => t.id === x)?.text).toBe("desk edit");
      expect(d.state.tasks.find((t) => t.id === y)?.text).toBe("other edit");
    }
  });

  it("a stale write to the same task is refused, merged, and never overwrites the newer copy", async () => {
    const { store, desk, other } = await pair();
    const x = desk.state.tasks[0].id;
    const t0 = Date.now();
    store.hold();
    desk.edit((s) => ({ ...s, tasks: renamed(s.tasks, x, "older edit", t0 + 5) }));
    other.edit((s) => ({ ...s, tasks: renamed(s.tasks, x, "newer edit", t0 + 50) }));
    await other.engine.syncNow(); // lands first
    await desk.engine.syncNow(); // its view predates that: refused
    expect(desk.engine.getStatus().kind).toBe("waiting");
    expect(store.refused).toBeGreaterThanOrEqual(1);
    expect((store.read("tasks", x) as { text: string }).text).toBe("newer edit");

    store.release();
    await desk.engine.syncNow();
    await other.engine.syncNow();
    for (const d of [desk, other]) expect(d.state.tasks[0].text).toBe("newer edit");
    expect((store.read("tasks", x) as { text: string }).text).toBe("newer edit");
  });
});

// ─── Randomized: two devices editing, moving, adding and deleting ────

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function allIds(tasks: Task[], out: TaskId[] = []): TaskId[] {
  for (const t of tasks) {
    out.push(t.id);
    allIds(t.children, out);
  }
  return out;
}

function detach(tasks: Task[], id: TaskId): [Task[], Task | null] {
  let found: Task | null = null;
  const out: Task[] = [];
  for (const t of tasks) {
    if (t.id === id) {
      found = t;
      continue;
    }
    const [children, f] = detach(t.children, id);
    if (f != null) found = f;
    out.push(children === t.children ? t : { ...t, children });
  }
  return [found != null ? out : tasks, found];
}

function insert(tasks: Task[], node: Task, parent: TaskId | null, index: number): Task[] {
  const put = (list: Task[]) => {
    const i = Math.max(0, Math.min(index, list.length));
    return [...list.slice(0, i), node, ...list.slice(i)];
  };
  if (parent == null) return put(tasks);
  return tasks.map((t) =>
    t.id === parent ? { ...t, children: put(t.children) } : { ...t, children: insert(t.children, node, parent, index) },
  );
}

function randomEdit(s: AppState, rand: () => number, at: number): AppState {
  const ids = allIds(s.tasks);
  const roll = rand();
  if (ids.length === 0 || roll < 0.2) {
    const parent = ids.length > 0 && rand() < 0.5 ? ids[Math.floor(rand() * ids.length)] : null;
    const next = insert(s.tasks, { ...makeTask(`new@${at}`), createdAt: at, updatedAt: at }, parent, 0);
    return { ...s, tasks: placeTasks(s.tasks, next, at) };
  }
  const id = ids[Math.floor(rand() * ids.length)];
  if (roll < 0.5) return { ...s, tasks: renamed(s.tasks, id, `${id}@${at}`, at) };
  if (roll < 0.65) {
    // Delete: the subtree goes, every id in it gets a tombstone.
    const [rest, node] = detach(s.tasks, id);
    if (node == null) return s;
    const gone = [node.id, ...allIds(node.children)];
    return {
      ...s,
      tasks: rest,
      tombstones: [...gone.map((g) => ({ id: g, deletedAt: at, purged: false })), ...s.tombstones],
    };
  }
  const [rest, node] = detach(s.tasks, id);
  if (node == null) return s;
  const banned = new Set([node.id, ...allIds(node.children)]);
  const parents = [null, ...allIds(rest).filter((p) => !banned.has(p))];
  const parent = parents[Math.floor(rand() * parents.length)];
  const next = insert(rest, node, parent, Math.floor(rand() * 4));
  return { ...s, tasks: placeTasks(s.tasks, next, at) };
}

describe("two devices, randomized", () => {
  for (let seed = 1; seed <= 100; seed++) {
    it(`seed ${seed}: converge, nothing duplicated, nothing halted`, async () => {
      const rand = rng(seed);
      const store = new MemoryStore();
      const start: AppState = {
        ...emptyState(),
        tasks: repairRanks(["a", "b", "c", "d"].map((t) => makeTask(t))),
      };
      const one = device(store, start, { v1: null });
      await one.engine.syncNow();
      const two = device(store, emptyState());
      await two.engine.syncNow();

      let clock = Date.now();
      for (let step = 0; step < 12; step++) {
        const who = rand() < 0.5 ? one : two;
        who.edit((s) => randomEdit(s, rand, (clock += 7)));
        if (rand() < 0.3) store.hold();
        if (rand() < 0.6) await who.engine.syncNow();
        if (rand() < 0.4) store.release();
      }
      store.release();
      for (let i = 0; i < 4; i++) {
        await one.engine.syncNow();
        await two.engine.syncNow();
      }

      for (const d of [one, two]) {
        expect(["inSync"]).toContain(d.engine.getStatus().kind);
        const ids = allIds(d.state.tasks);
        expect(new Set(ids).size).toBe(ids.length);
      }
      expect(jsonEqual(synced(one.state), synced(two.state))).toBe(true);
      // Settled for real: another round on each writes nothing. (Two devices
      // can each look in sync while overwriting one another forever.)
      const writes = store.writes;
      one.engine.request();
      await one.engine.syncNow();
      await two.engine.syncNow();
      expect(store.writes).toBe(writes);
    });
  }
});

describe("guards", () => {
  it("never writes before the local store has loaded", async () => {
    const store = new MemoryStore();
    const d = device(store, await busy(), { v1: null });
    d.ready = () => false;
    await d.engine.syncNow();
    expect(store.writes).toBe(0);
  });

  it("stops writing when the cloud was written by a newer schema", async () => {
    const store = new MemoryStore();
    await store.commit([{ collection: "meta", id: "state", op: "set", data: { schemaVersion: 999 } }]);
    const d = device(store, await busy(), { v1: null });
    await d.engine.syncNow();
    expect(d.engine.getStatus()).toEqual({ kind: "outdated", remoteVersion: 999 });
    expect(store.writes).toBe(1); // only the setup write above
  });

  it("a failed commit is reported with a retry, and a kick recovers", async () => {
    const store = new MemoryStore();
    const d = device(store, await busy(), { v1: null });
    store.failNext = new Error("UNAVAILABLE");
    await d.engine.syncNow();
    expect(d.engine.getStatus()).toMatchObject({ kind: "error", message: "UNAVAILABLE" });
    d.engine.kick();
    await d.engine.syncNow();
    expect(d.engine.getStatus().kind).toBe("inSync");
  });

  it("garbage-collects expired tombstones and junk, without looping", async () => {
    const store = new MemoryStore();
    const d = device(store, await busy(), { v1: null });
    await d.engine.syncNow();
    await store.commit([
      { collection: "tombstones", id: "ancient", op: "set", data: { deletedAt: 1, purged: false } },
      { collection: "tasks", id: "junk", op: "set", data: { nonsense: true, text: 42 } },
    ]);
    await d.engine.syncNow();
    expect(store.read("tombstones", "ancient")).toBeUndefined();
    // Junk that coerces to an (empty) task is adopted as one, not deleted —
    // coercion is the reader's contract; it just must not loop.
    expect(d.engine.getStatus().kind).toBe("inSync");
    const writes = store.writes;
    await d.engine.syncNow();
    expect(store.writes).toBe(writes);
  });

  it("writes log lines once, past the watermark", async () => {
    const store = new MemoryStore();
    const line = (id: string, at: number): LogEntry => ({
      id,
      taskId: "t" as TaskId,
      taskText: "t",
      action: "completed",
      reason: null,
      at,
      date: "2026-09-24",
    });
    const d = device(store, { ...(await busy()), log: [line("l2", 200), line("l1", 100)] }, { v1: null });
    await d.engine.syncNow();
    expect(store.data.get("log")?.size).toBe(2);
    const writes = store.writes;
    d.edit((s) => ({ ...s, log: [line("l3", 300), ...s.log] }));
    await d.engine.syncNow();
    expect(store.writes - writes).toBe(1);
  });

  it("touches the heartbeat at most once an hour", async () => {
    let now = Date.now();
    const store = new MemoryStore();
    const d = device(store, await busy(), { v1: null, now: () => now });
    await d.engine.syncNow();
    const first = (store.read("meta", "heartbeat") as { at: number }).at;
    now += 10 * 60_000;
    d.engine.request();
    await d.engine.syncNow();
    expect((store.read("meta", "heartbeat") as { at: number }).at).toBe(first);
    now += 60 * 60_000;
    await d.engine.syncNow();
    expect((store.read("meta", "heartbeat") as { at: number }).at).toBe(now);
  });
});
