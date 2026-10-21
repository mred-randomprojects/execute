import { beforeEach, describe, expect, it } from "vitest";
import { DocSync, type EngineHost } from "./engine";
import { MemoryStore } from "./memoryStore";
import { ViewerSync } from "./viewer";
import {
  addTaskAfter,
  adoptRemote,
  canUndo,
  getLoaded,
  getState,
  initStore,
  purgeFromTrash,
  restoreBackup,
  setText,
  trashTask,
  undo,
} from "../../store/store";
import { coerceState } from "../../store/persistence";
import { findById, makeTask } from "../../store/tasks";
import type { AppState } from "../../types";

// Restoring a daily backup, end to end: the real store, the desktop's engine
// and the phone over one in-memory cloud. Copying a backup over the store file
// used to bring nothing back: the cloud's deletion record deleted the task
// again on the first sync, and the cloud's newer copy of an edit won.

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

function desktop(store: MemoryStore) {
  let version = 0;
  const host: EngineHost = { ready: getLoaded, getLocal: getState, version: () => version, adopt: adoptRemote };
  let watermark = 0;
  const engine = new DocSync(store, host, { get: () => watermark, set: (at) => void (watermark = at) }, {
    deliveryTimeoutMs: 30,
    echoGraceMs: 50,
    backoffMs: [60_000],
  });
  engine.start();
  return { engine, edited: () => void version++ };
}

function phone(store: MemoryStore): ViewerSync {
  const sync = new ViewerSync(store, () => {}, () => {});
  sync.start();
  return sync;
}

const phoneTasks = (p: ViewerSync): AppState["tasks"] => {
  const s = p.snapshot();
  return s.phase === "ready" ? s.state.tasks : [];
};

beforeEach(async () => {
  delete window.execute;
  localStorage.clear();
  await initStore();
  while (canUndo()) undo();
});

describe("restoring a backup, with the cloud", () => {
  it("brings back a task deleted everywhere, in the cloud and on the phone, and keeps the phone's newer capture", async () => {
    const store = new MemoryStore();
    const desk = desktop(store);
    const a = addTaskAfter(null, "pay rent");
    const x = addTaskAfter(a, "call the bank");
    desk.edited();
    await desk.engine.syncNow();
    const backup = coerceState(JSON.parse(JSON.stringify(getState()))); // backups/execute-store.<date>.json

    // The loss: X deleted for good and A overwritten, and both reach the cloud.
    await tick();
    trashTask(x);
    await tick();
    purgeFromTrash(x);
    setText(a, "overwritten");
    desk.edited();
    await tick(250);
    await desk.engine.syncNow();
    expect(store.read("tasks", x)).toBeUndefined();
    expect(store.read("tombstones", x)).toBeDefined();

    // Meanwhile the phone captures something new.
    const p = phone(store);
    const y = makeTask("captured on the phone");
    await p.apply((s) => ({ ...s, tasks: [...s.tasks, y] }));
    await desk.engine.syncNow();

    await tick();
    expect(restoreBackup(backup, "Restore the backup")).toBe(true);
    desk.edited();
    await tick(250);
    await desk.engine.syncNow();

    expect((store.read("tasks", x) as { text: string } | undefined)?.text).toBe("call the bank");
    expect(store.read("tombstones", x)).toBeUndefined();
    expect((store.read("tasks", a) as { text: string }).text).toBe("pay rent");
    expect(store.read("tasks", y.id)).toBeDefined();
    expect(findById(getState().tasks, y.id)?.text).toBe("captured on the phone");
    expect(phoneTasks(p).map((t) => t.text).sort()).toEqual(["call the bank", "captured on the phone", "pay rent"]);

    // And it stays: the next rounds write nothing back over it.
    const writes = store.writes;
    await desk.engine.syncNow();
    expect(store.writes).toBe(writes);
    expect(desk.engine.getStatus().kind).toBe("inSync");
    p.stop();
  });
});
