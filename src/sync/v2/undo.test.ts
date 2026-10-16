import { beforeEach, describe, expect, it } from "vitest";
import { DocSync, type EngineHost } from "./engine";
import { MemoryStore } from "./memoryStore";
import { ViewerSync } from "./viewer";
import {
  addTaskAfter,
  adoptRemote,
  canUndo,
  createHabit,
  getLoaded,
  getState,
  initStore,
  redo,
  toggleComplete,
  undo,
  undoThrough,
  getUndoSteps,
} from "../../store/store";
import { findById, makeTask } from "../../store/tasks";
import { setHabitMark } from "../../viewer/intents";
import { todayISO } from "../../store/dates";
import type { AppState, HabitId } from "../../types";

// ⌘z on the desktop after the phone did something, end to end: the real store
// singleton, the desktop's engine and the phone's ViewerSync over one in-memory
// cloud. Undo used to restore the whole snapshot from before the undone action,
// so a task captured on the phone in between was tombstoned — its document
// deleted in the cloud, gone from the phone too, and not in the Trash — and a
// phone check-in was stamped back to unmarked everywhere.

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

/** The desktop as src/sync/desktopSync wires it, over the real store. */
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

describe("⌘z on the desktop after the phone changed something", () => {
  it("keeps a task captured on the phone, in the cloud and on both devices", async () => {
    const store = new MemoryStore();
    const desk = desktop(store);
    const a = addTaskAfter(null, "A");
    await tick();
    toggleComplete(a); // an undoable step on the desktop
    desk.edited();
    await desk.engine.syncNow();
    expect(desk.engine.getStatus().kind).toBe("inSync");

    // On the phone: capture X, exactly as ViewerRoot.onAdd does.
    const p = phone(store);
    const x = makeTask("captured on the phone");
    await p.apply((s) => (findById(s.tasks, x.id) != null ? s : { ...s, tasks: [...s.tasks, x] }));
    expect(store.read("tasks", x.id)).toBeDefined();

    // The desktop picks it up (adoptRemote: no undo step of its own).
    await desk.engine.syncNow();
    expect(findById(getState().tasks, x.id)).toBeDefined();

    // ⌘z: reopen A.
    await tick();
    undo();
    desk.edited();
    await tick(250); // the debounced save
    await desk.engine.syncNow();

    expect(findById(getState().tasks, a)?.completed).toBe(false);
    expect(findById(getState().tasks, x.id)?.text).toBe("captured on the phone");
    expect(getState().tombstones.some((t) => t.id === x.id)).toBe(false);
    expect(store.read("tasks", x.id)).toBeDefined();
    expect(store.read("tombstones", x.id)).toBeUndefined();
    expect((store.read("tasks", a) as { completed: boolean }).completed).toBe(false);
    await tick(20);
    expect(phoneTasks(p).some((t) => t.id === x.id)).toBe(true);

    // ⌘⇧z and ⌘z again: A goes back and forth, X stays put.
    redo();
    desk.edited();
    await tick(250);
    await desk.engine.syncNow();
    expect((store.read("tasks", a) as { completed: boolean }).completed).toBe(true);
    expect(store.read("tasks", x.id)).toBeDefined();
    undo();
    desk.edited();
    await tick(250);
    await desk.engine.syncNow();
    expect((store.read("tasks", a) as { completed: boolean }).completed).toBe(false);
    expect(store.read("tasks", x.id)).toBeDefined();
    expect(desk.engine.getStatus().kind).toBe("inSync");
  });

  it("keeps a habit check-in made on the phone, in the cloud and on the desktop", async () => {
    const store = new MemoryStore();
    const desk = desktop(store);
    const h: HabitId = createHabit("read", 3);
    const a = addTaskAfter(null, "A");
    await tick();
    toggleComplete(a);
    desk.edited();
    await desk.engine.syncNow();

    const p = phone(store);
    const today = todayISO(null);
    await p.apply((s) => ({ ...s, habits: setHabitMark(s.habits, h, today, "done") }));
    await desk.engine.syncNow();
    expect(getState().habits.find((x) => x.id === h)?.checks[today]).toBe("done");

    await tick();
    undo(); // reopen A
    desk.edited();
    await tick(250);
    await desk.engine.syncNow();

    const cloud = store.read("habits", h) as { checks: Record<string, string> };
    expect(cloud.checks[today]).toBe("done");
    expect(getState().habits.find((x) => x.id === h)?.checks[today]).toBe("done");
    expect(findById(getState().tasks, a)?.completed).toBe(false);
  });

  it("a History jump back over a phone capture keeps it", async () => {
    const store = new MemoryStore();
    const desk = desktop(store);
    const a = addTaskAfter(null, "A");
    await tick();
    toggleComplete(a);
    desk.edited();
    await desk.engine.syncNow();
    const p = phone(store);
    const x = makeTask("captured on the phone");
    await p.apply((s) => ({ ...s, tasks: [...s.tasks, x] }));
    await desk.engine.syncNow();
    await tick();
    const b = addTaskAfter(a, "B");
    desk.edited();
    await tick();

    const target = getUndoSteps().find((s) => s.label.startsWith("Complete"));
    if (target == null) throw new Error("fixture");
    undoThrough(target.id); // undoes "New task B" and "Complete A"
    desk.edited();
    await tick(250);
    await desk.engine.syncNow();

    expect(findById(getState().tasks, b)).toBeUndefined();
    expect(findById(getState().tasks, a)?.completed).toBe(false);
    expect(store.read("tasks", x.id)).toBeDefined();
    expect(findById(getState().tasks, x.id)).toBeDefined();
  });
});
