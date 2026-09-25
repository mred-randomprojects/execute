import { beforeEach, describe, expect, it } from "vitest";
import { ShadowSync, type ShadowStatus, type Watermark } from "./shadow";
import { MemoryStore } from "./memoryStore";
import type { DocWrite } from "../docs";
import {
  addChild,
  addTaskAfter,
  createRecurrence,
  emptyTrash,
  getState,
  initStore,
  setText,
  toggleComplete,
  trashTask,
} from "../../store/store";
import { defaultRule } from "../../store/recurrence";
import { makeTask } from "../../store/tasks";
import type { AppState, LogEntry, TaskId } from "../../types";

const tick = () => new Promise((r) => setTimeout(r, 3));

function memoryWatermark(): Watermark & { value: number } {
  const w = {
    value: 0,
    get: () => w.value,
    set: (at: number) => {
      w.value = at;
    },
  };
  return w;
}

function setup(store = new MemoryStore()) {
  const statuses: ShadowStatus[] = [];
  const watermark = memoryWatermark();
  const shadow = new ShadowSync(store, watermark, (s) => statuses.push(s));
  shadow.start();
  return { store, shadow, statuses, watermark, last: () => statuses[statuses.length - 1] };
}

async function busy(): Promise<AppState> {
  const a = addTaskAfter(null, "a");
  const b = addTaskAfter(a, "b");
  addChild(b, "b1");
  const junk = addTaskAfter(b, "junk");
  trashTask(junk);
  const gone = addTaskAfter(b, "gone");
  trashTask(gone);
  await tick();
  emptyTrash();
  createRecurrence("water plants", defaultRule("2026-01-01"));
  toggleComplete(a);
  return getState();
}

const logLine = (id: string, at: number): LogEntry => ({
  id,
  taskId: "t" as TaskId,
  taskText: "t",
  action: "completed",
  reason: null,
  at,
  date: "2026-09-24",
});

beforeEach(async () => {
  localStorage.clear();
  await initStore();
});

describe("shadow sync", () => {
  it("seeds empty collections, then reads back as the local state", async () => {
    const { store, shadow, last } = setup();
    const s = await busy();
    await shadow.sync(s);
    expect(store.writes).toBeGreaterThan(5);
    expect(shadow.matches(s)).toBe(true);
    expect(last().kind).toBe("inSync");

    const before = store.writes;
    await shadow.sync(s);
    expect(store.writes).toBe(before); // nothing to do, nothing written
  });

  it("one edit is one small patch", async () => {
    const { store, shadow } = setup();
    await shadow.sync(await busy());
    const before = { commits: store.commits, writes: store.writes };
    const id = getState().tasks[0].id;
    await tick();
    setText(id, "renamed");
    await shadow.sync(getState());
    expect(store.writes - before.writes).toBe(1);
    expect(store.commits - before.commits).toBe(1);
  });

  it("writes log lines once, past the watermark", async () => {
    const { store, shadow, watermark } = setup();
    const s = { ...(await busy()), log: [logLine("l2", 200), logLine("l1", 100)] };
    await shadow.sync(s);
    expect(store.data.get("log")?.size).toBe(2);
    expect(watermark.value).toBe(200);

    const before = store.writes;
    await shadow.sync({ ...s, log: [logLine("l3", 300), ...s.log] });
    expect(store.writes - before).toBe(1);
    expect(store.data.get("log")?.has("l3")).toBe(true);
  });

  it("splits a big seed into batches of at most 500", async () => {
    const { store, shadow } = setup();
    const many = { ...getState(), tasks: Array.from({ length: 700 }, (_, i) => makeTask(`t${i}`)) };
    // Rank them the way the store would.
    const ranked = { ...many, tasks: (await import("../../store/placement")).repairRanks(many.tasks) };
    await shadow.sync(ranked);
    expect(store.commits).toBeGreaterThanOrEqual(2);
    expect(store.data.get("tasks")?.size).toBe(700);
    expect(shadow.matches(ranked)).toBe(true);
  });

  it("a failed commit is reported, and the next sync recovers", async () => {
    const { store, shadow, last } = setup();
    const s = await busy();
    store.failNext = new Error("UNAVAILABLE");
    await shadow.sync(s);
    expect(last()).toEqual({ kind: "error", message: "UNAVAILABLE" });
    await shadow.sync(s);
    expect(last().kind).toBe("inSync");
    expect(shadow.matches(s)).toBe(true);
  });

  it("puts back a document deleted behind its back (local is the source of truth)", async () => {
    const { store, shadow } = setup();
    const s = await busy();
    await shadow.sync(s);
    const id = s.tasks[0].id;
    await store.commit([{ collection: "tasks", id, op: "delete" }]);
    await shadow.sync(s);
    expect(store.data.get("tasks")?.has(id)).toBe(true);
    expect(shadow.matches(s)).toBe(true);
  });

  it("an expired tombstone can't cause a write loop", async () => {
    const { store, shadow, last } = setup();
    const s: AppState = {
      ...(await busy()),
      tombstones: [{ id: "ancient", deletedAt: Date.now() - 400 * 86_400_000, purged: false }],
    };
    await shadow.sync(s);
    const before = store.writes;
    await shadow.sync(s);
    expect(store.writes).toBe(before);
    expect(last().kind).toBe("inSync");
  });

  it("halts instead of looping when documents don't read back as written", async () => {
    // A store that silently drops `text` — the kind of bug the check exists for.
    class LossyStore extends MemoryStore {
      override async commit(writes: readonly DocWrite[]): Promise<void> {
        const strip = (o: object): Record<string, unknown> => {
          const copy: Record<string, unknown> = { ...o };
          delete copy.text;
          return copy;
        };
        return super.commit(
          writes.map((w) =>
            w.op === "set" ? { ...w, data: strip(w.data) } : w.op === "patch" ? { ...w, fields: strip(w.fields) } : w,
          ),
        );
      }
    }
    const { store, shadow, last } = setup(new LossyStore());
    await shadow.sync(await busy());
    expect(last().kind).toBe("halted");
    const commits = store.commits;
    await shadow.sync(getState());
    expect(store.commits).toBe(commits); // stays stopped
  });
});
