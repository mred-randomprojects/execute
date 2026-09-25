import { beforeEach, describe, expect, it } from "vitest";
import { asRaw, diffDocs, fromDocs, toDocs } from "./docs";
import { jsonEqual, mergeStates } from "./merge";
import {
  addChild,
  addTaskAfter,
  createProject,
  createRecurrence,
  emptyTrash,
  getState,
  indent,
  initStore,
  setText,
  trashTask,
} from "../store/store";
import { defaultRule } from "../store/recurrence";
import { emptyState, type AppState, type TaskId } from "../types";

const tick = () => new Promise((r) => setTimeout(r, 3));
const roundTrip = (s: AppState, base: AppState = s) => fromDocs(asRaw(toDocs(s)), base);

beforeEach(async () => {
  localStorage.clear();
  await initStore();
});

/** A state exercising every synced collection. */
async function busyState(): Promise<AppState> {
  createProject("Home");
  const a = addTaskAfter(null, "a");
  const b = addTaskAfter(a, "b");
  addChild(b, "b1");
  const c = addTaskAfter(b, "c");
  addChild(c, "c1");
  addChild(c, "c2");
  indent(c); // c (with children) under b
  const junk = addTaskAfter(a, "junk");
  addChild(junk, "junk child");
  trashTask(junk);
  const gone = addTaskAfter(a, "gone");
  trashTask(gone);
  await tick();
  emptyTrash(); // tombstones, purged
  const kept = addTaskAfter(a, "trashed later");
  addChild(kept, "its child");
  trashTask(kept);
  createRecurrence("water plants", defaultRule("2026-01-01"));
  setText(a, "a, edited");
  return getState();
}

describe("the per-item document format", () => {
  it("round-trips a state exactly", async () => {
    const s = await busyState();
    expect(s.trash.length).toBeGreaterThan(0);
    expect(s.tombstones.length).toBeGreaterThan(0);
    expect(jsonEqual(roundTrip(s), s)).toBe(true);
  });

  it("keeps per-device fields out of the documents", async () => {
    const s = { ...(await busyState()), theme: "slate" as const, dailyCapacityBlocks: 7 };
    const onPhone = roundTrip(s, { ...emptyState(), theme: s.theme === "slate" ? "ivory" : "slate" });
    expect(onPhone.theme).not.toBe(s.theme);
    expect(onPhone.dailyCapacityBlocks).not.toBe(7);
    expect(jsonEqual(onPhone.tasks, s.tasks)).toBe(true);
    expect(JSON.stringify([...toDocs(s).tasks.values()])).not.toContain("commandUsage");
  });

  it("is a fixed point of the merge: merging the cloud copy changes nothing", async () => {
    const s = await busyState();
    expect(jsonEqual(mergeStates(s, roundTrip(s)), s)).toBe(true);
  });

  it("one edit is one write", async () => {
    await busyState();
    const before = toDocs(getState());
    const id = getState().tasks[0].id;
    await tick();
    setText(id, "only this");
    const writes = diffDocs(before, toDocs(getState()));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ collection: "tasks", id, op: "patch" });
    // Only the fields that changed — not the whole task.
    expect(Object.keys(writes[0].op === "patch" ? writes[0].fields : {}).sort()).toEqual(["text", "updatedAt"]);
  });

  it("nothing changed, nothing written", async () => {
    const s = await busyState();
    expect(diffDocs(toDocs(s), toDocs(roundTrip(s)))).toEqual([]);
  });

  it("a delete removes the task's document and writes its tombstone", async () => {
    const id = addTaskAfter(null, "doomed");
    const before = toDocs(getState());
    trashTask(id);
    await tick();
    emptyTrash();
    const writes = diffDocs(before, toDocs(getState()));
    expect(writes).toContainEqual({ collection: "tasks", id, op: "delete" });
    expect(writes.find((w) => w.collection === "tombstones" && w.id === id)).toMatchObject({
      op: "set",
      data: { purged: true },
    });
  });

  it("a partial view (the phone's query) never writes its detached orphans back as moves", async () => {
    const p = addTaskAfter(null, "parent, completed long ago");
    const child = addChild(p, "open child");
    const all = toDocs(getState());
    const subset = { ...asRaw(all), tasks: new Map([[child, all.tasks.get(child)]]) };
    const onPhone = fromDocs(subset, emptyState());
    expect(onPhone.tasks.map((t) => t.id)).toEqual([child]); // detached, in this view only

    const edited: AppState = {
      ...onPhone,
      tasks: onPhone.tasks.map((t) => ({ ...t, completed: true, completedAt: 5, updatedAt: t.updatedAt + 1 })),
    };
    const writes = diffDocs(toDocs(onPhone), toDocs(edited));
    expect(writes).toEqual([
      {
        collection: "tasks",
        id: child,
        op: "patch",
        fields: { completed: true, completedAt: 5, updatedAt: edited.tasks[0].updatedAt },
      },
    ]); // no parentId, no rank: the cloud keeps the real placement
  });

  it("reads the same documents the same way every time (no 'now' defaults)", async () => {
    // A value that changes between two reads of one document looks like an
    // edit, and the engine would write it back every round.
    const raw = {
      ...asRaw(toDocs(emptyState())),
      tasks: new Map<string, unknown>([
        ["partial", { text: "no timestamps", rank: "V", wontDo: { reason: "nope" } }],
      ]),
      projects: new Map<string, unknown>([["p1", { name: "No dates" }]]),
      recurrences: new Map<string, unknown>([["r1", { template: { text: "t" }, rule: {} }]]),
    };
    const first = fromDocs(raw, emptyState());
    await tick();
    const second = fromDocs(raw, emptyState());
    expect(jsonEqual(first, second)).toBe(true);
  });

  it("reads defensively: junk documents are skipped or coerced, not trusted", () => {
    const raw = {
      ...asRaw(toDocs(emptyState())),
      tasks: new Map<string, unknown>([
        ["t1", { text: 42, rank: "V", parentId: null }],
        ["t2", "not an object"],
      ]),
      meta: null,
    };
    const s = fromDocs(raw, emptyState());
    expect(s.tasks.map((t) => [t.id, t.text])).toEqual([["t1" as TaskId, ""]]);
  });
});

