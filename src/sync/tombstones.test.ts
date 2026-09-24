import { beforeEach, describe, expect, it } from "vitest";
import {
  addChild,
  addTaskAfter,
  createRecurrence,
  deleteRecurrence,
  emptyTrash,
  getState,
  initStore,
  purgeFromTrash,
  redo,
  restoreFromTrash,
  trashTask,
  undo,
} from "../store/store";
import { jsonEqual, mergeStates } from "./merge";
import { defaultRule } from "../store/recurrence";
import { emptyState, type AppState, type TaskId } from "../types";
import { makeTask } from "../store/tasks";

// The merge cannot tell another device's ADD from this device's DELETE unless
// something recorded the delete. Three ways of deleting never recorded one, so
// the cloud handed the thing straight back on the next sync. These tests are the
// round trip: mutate locally, snapshot what the cloud would hold, mutate again,
// then merge the way desktopSync does — `mergeStates(local, remote)`.

/** Let wall-clock time move, so `deletedAt` vs `updatedAt` isn't a same-ms tie. */
const tick = () => new Promise((r) => setTimeout(r, 5));

/** What a push would have left in the cloud at this moment. */
const pushed = (): AppState => structuredClone(getState());

/** The pull loop: merge the cloud back into whatever is local now. */
const pull = (remote: AppState): AppState => mergeStates(getState(), remote);

const texts = (s: AppState) => s.tasks.map((t) => t.text);

beforeEach(async () => {
  localStorage.clear();
  await initStore();
});

describe("undoing a create", () => {
  it("stays undone after the cloud answers", async () => {
    addTaskAfter(null, "oops");
    const remote = pushed();
    await tick();
    undo();

    expect(texts(getState())).toEqual([]);
    expect(texts(pull(remote))).toEqual([]);
  });

  it("stays undone for a nested create too", async () => {
    const parent = addTaskAfter(null, "parent");
    addChild(parent, "child");
    const remote = pushed();
    await tick();
    undo();

    const merged = pull(remote);
    expect(merged.tasks).toHaveLength(1);
    expect(merged.tasks[0].children).toEqual([]);
  });

  it("and redoing the create brings it back", async () => {
    addTaskAfter(null, "oops");
    const remote = pushed();
    await tick();
    undo();
    await tick();
    redo();

    expect(texts(pull(remote))).toEqual(["oops"]);
  });
});

describe("emptying the trash", () => {
  it("stays empty after the cloud answers", async () => {
    const id = addTaskAfter(null, "junk");
    trashTask(id);
    const remote = pushed(); // the cloud holds the trash entry
    await tick();
    emptyTrash();

    const merged = pull(remote);
    expect(merged.trash).toEqual([]);
    expect(texts(merged)).toEqual([]);
  });

  it("purging one entry leaves the others alone", async () => {
    const a = addTaskAfter(null, "a");
    const b = addTaskAfter(null, "b");
    trashTask(a);
    trashTask(b);
    const remote = pushed();
    await tick();
    purgeFromTrash(a);

    const merged = pull(remote);
    expect(merged.trash.map((e) => e.task.text)).toEqual(["b"]);
  });

  it("undoing it locally brings the entries back without a purge left behind", async () => {
    const id = addTaskAfter(null, "junk");
    trashTask(id);
    await tick();
    emptyTrash();
    expect(getState().tombstones.find((t) => t.id === id)?.purged).toBe(true);
    undo();

    expect(getState().trash.map((e) => e.task.id)).toEqual([id]);
    expect(getState().tombstones.find((t) => t.id === id)?.purged).toBe(false);
    // …and this device's own merge doesn't empty it again.
    expect(mergeStates(getState(), getState()).trash).toHaveLength(1);
  });

  it("works on a document written before tombstones existed", async () => {
    // A pre-v17 cloud doc: a trash entry, and no `tombstones` field at all.
    const gone = makeTask("trashed last year");
    const legacyRemote: AppState = {
      ...emptyState(),
      trash: [{ task: gone, deletedAt: Date.now() - 400 * 86_400_000 }],
    };
    // Adopt it locally, then empty the trash.
    const local = mergeStates(getState(), legacyRemote);
    expect(local.trash).toHaveLength(1);

    // `buryTrashed` stamps `now`, precisely so an entry older than the tombstone
    // TTL still leaves a record that outlives it.
    const afterEmpty: AppState = {
      ...local,
      trash: [],
      tombstones: [{ id: gone.id, deletedAt: Date.now(), purged: true }],
    };
    const merged = mergeStates(afterEmpty, legacyRemote);
    expect(merged.trash).toEqual([]);
    expect(merged.tasks).toEqual([]);
  });
});

describe("deleting a recurrence", () => {
  it("stays deleted after the cloud answers", async () => {
    const { id } = createRecurrence("water the plants", defaultRule("2026-01-01"));
    const remote = pushed();
    await tick();
    deleteRecurrence(id);

    expect(pull(remote).recurrences).toEqual([]);
  });

  it("and an unrelated recurrence added on the other device still arrives", async () => {
    const { id } = createRecurrence("water the plants", defaultRule("2026-01-01"));
    const remote = pushed();
    // The other device adds one of its own, while this one deletes.
    const otherDevice: AppState = {
      ...remote,
      recurrences: [
        ...remote.recurrences,
        {
          id: "rec-from-phone" as never,
          template: makeTask("take the bins out"),
          rule: defaultRule("2026-01-01"),
          createdAt: Date.now(),
        },
      ],
    };
    await tick();
    deleteRecurrence(id);

    const merged = pull(otherDevice);
    expect(merged.recurrences.map((r) => r.template.text)).toEqual(["take the bins out"]);
  });
});

// ─── The other half: what must NOT change ───────────────────────────

describe("deletes that were already meant to be reversible", () => {
  it("undoing a trash still brings the task back", async () => {
    const id = addTaskAfter(null, "keep me");
    trashTask(id);
    const remote = pushed();
    await tick();
    undo();

    expect(texts(pull(remote))).toEqual(["keep me"]);
  });

  it("restoring from the trash still brings the task back", async () => {
    const id = addTaskAfter(null, "keep me");
    trashTask(id);
    const remote = pushed();
    await tick();
    restoreFromTrash(id);

    const merged = pull(remote);
    expect(texts(merged)).toEqual(["keep me"]);
    expect(merged.trash).toEqual([]);
    // …and no stale record is left lying around to re-fight the next sync.
    expect(merged.tombstones.map((t) => t.id)).not.toContain(id);
  });

  it("an edit on the other device after a delete here still resurrects it", async () => {
    const id = addTaskAfter(null, "still wanted");
    const remote = pushed();
    trashTask(id);
    // The phone edits it a beat later, not knowing it was deleted.
    const edited: AppState = {
      ...remote,
      tasks: remote.tasks.map((t) => ({ ...t, text: "still wanted!", updatedAt: Date.now() + 5_000 })),
    };
    expect(texts(pull(edited))).toEqual(["still wanted!"]);
  });
});

describe("adds from the other device", () => {
  it("a genuinely new remote task is still grafted in", async () => {
    addTaskAfter(null, "mine");
    const remote: AppState = { ...pushed(), tasks: [...getState().tasks, makeTask("theirs")] };
    expect(texts(pull(remote)).sort()).toEqual(["mine", "theirs"]);
  });

  it("a remote add nested under a surviving parent is still grafted in", async () => {
    const parent = addTaskAfter(null, "parent");
    const base = pushed();
    const remote: AppState = {
      ...base,
      tasks: base.tasks.map((t) =>
        t.id === parent ? { ...t, children: [...t.children, makeTask("from the phone")] } : t,
      ),
    };
    const merged = pull(remote);
    expect(merged.tasks[0].children.map((c) => c.text)).toEqual(["from the phone"]);
  });
});

describe("the merge stays well-behaved", () => {
  it("is idempotent — merging the same remote twice changes nothing", async () => {
    const id = addTaskAfter(null, "junk");
    trashTask(id);
    const remote = pushed();
    await tick();
    emptyTrash();

    const once = pull(remote);
    const twice = mergeStates(once, remote);
    expect(jsonEqual(twice, once)).toBe(true);
  });

  it("expired tombstones are pruned, so the list can't grow forever", () => {
    const ancient = {
      id: "long-gone" as TaskId,
      deletedAt: Date.now() - 200 * 86_400_000,
      purged: false,
    };
    const recent = { id: "just-went" as TaskId, deletedAt: Date.now(), purged: false };
    const merged = mergeStates(
      { ...emptyState(), tombstones: [ancient, recent] },
      emptyState(),
    );
    expect(merged.tombstones.map((t) => t.id)).toEqual(["just-went"]);
  });

  it("keeps Trash entries older than the tombstone TTL", () => {
    // The TTL bounds bare records only. A Trash entry is its own record, and
    // expiring it would quietly empty the old end of the Trash on every sync.
    const old = makeTask("trashed long ago");
    const trash = [{ task: old, deletedAt: Date.now() - 200 * 86_400_000 }];
    const withTrash: AppState = { ...emptyState(), trash };
    expect(mergeStates(withTrash, emptyState()).trash).toEqual(trash);
    expect(mergeStates(emptyState(), withTrash).trash).toEqual(trash);
    expect(mergeStates(withTrash, withTrash).trash).toEqual(trash);
  });

  it("a tombstone is recorded once, not once per sync", async () => {
    const id = addTaskAfter(null, "junk");
    trashTask(id);
    await tick();
    emptyTrash();
    const remote = pushed();
    const merged = mergeStates(mergeStates(getState(), remote), remote);
    expect(merged.tombstones.filter((t) => t.id === id)).toHaveLength(1);
  });
});
