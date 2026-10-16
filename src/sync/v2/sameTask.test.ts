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
  pauseWorkAt,
  setNotes,
  setText,
  toggleComplete,
  toggleWorking,
  undo,
} from "../../store/store";
import { findById } from "../../store/tasks";
import { setCompleted, updateTask } from "../../viewer/intents";
import type { Task, TaskId } from "../../types";

// The desktop and the phone changing the SAME task while they can't hear each
// other: the Mac asleep, or the laptop offline. Each task used to merge as one
// unit — whichever copy had the newer `updatedAt` won every field — so:
//
//   • the timer's pause on waking (stamped "now", before the cloud had been
//     heard from) wrote the pre-sleep task back over a completion or a note
//     made on the phone during the night;
//   • a task completed on an offline laptop reopened when the phone later
//     added a note to it.
//
// Since v24 a task merges by field group, each with its own clock (status,
// work, text, notes, schedule…), so each side keeps what it changed.

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

const cloudTask = (store: MemoryStore, id: TaskId) => store.read("tasks", id) as Task;
const localTask = (id: TaskId) => findById(getState().tasks, id);

beforeEach(async () => {
  delete window.execute;
  localStorage.clear();
  await initStore();
  while (canUndo()) undo();
});

describe("the timer's pause on waking vs. the phone's edit made while the Mac slept", () => {
  for (const kind of ["completed", "annotated"] as const) {
    it(`keeps a task ${kind} on the phone, and still ends the stretch at the sleep`, async () => {
      const store = new MemoryStore();
      const desk = desktop(store);
      const t = addTaskAfter(null, "write the report");
      await tick();
      expect(toggleWorking(t)).toBe("started");
      desk.edited();
      await tick(250);
      await desk.engine.syncNow();

      // Lid closed: the engine is suspended with the renderer. (After over a
      // second of work: a shorter stretch isn't kept at all.)
      await tick(1100);
      desk.engine.stop();
      const sleptAt = Date.now();
      await tick(20);

      // On the phone the task shows as in progress; Max finishes or annotates it.
      const p = phone(store);
      await p.apply((s) => ({
        ...s,
        tasks: kind === "completed" ? setCompleted(s.tasks, t, true) : updateTask(s.tasks, t, { notes: "sent to Ana" }),
      }));
      await tick(20);

      // Lid opened: the pause lands before the stream reconnects.
      pauseWorkAt(sleptAt);
      const desk2 = desktop(store);
      desk2.edited();
      await tick(250);
      await desk2.engine.syncNow();

      const cloud = cloudTask(store, t);
      const local = localTask(t);
      if (kind === "completed") {
        expect(cloud.completed).toBe(true);
        expect(local?.completed).toBe(true);
      } else {
        expect(cloud.notes).toBe("sent to Ana");
        expect(local?.notes).toBe("sent to Ana");
      }
      // …and the stretch still ends where the Mac went to sleep.
      expect(local?.sessions.at(-1)?.end).toBe(sleptAt);
      expect(cloud.sessions.at(-1)?.end).toBe(sleptAt);
      expect(desk2.engine.getStatus().kind).toBe("inSync");
    });
  }
});

describe("an offline desktop vs. the phone, on different fields of one task", () => {
  it("a completion made offline survives a later note from the phone", async () => {
    const store = new MemoryStore();
    const desk = desktop(store);
    const t = addTaskAfter(null, "pay rent");
    desk.edited();
    await tick(250);
    await desk.engine.syncNow();
    desk.engine.stop(); // on a plane

    await tick(5);
    toggleComplete(t); // done, offline
    desk.edited();
    await tick(5);

    const p = phone(store);
    await p.apply((s) => ({ ...s, tasks: updateTask(s.tasks, t, { notes: "transfer ref 123" }) }));

    const desk2 = desktop(store); // back online
    desk2.edited();
    await tick(250);
    await desk2.engine.syncNow();
    for (const task of [localTask(t), cloudTask(store, t)]) {
      expect(task?.completed).toBe(true);
      expect(task?.notes).toBe("transfer ref 123");
    }
  });

  it("an offline rename and a later completion on the phone both survive", async () => {
    const store = new MemoryStore();
    const desk = desktop(store);
    const t = addTaskAfter(null, "call the bank");
    desk.edited();
    await tick(250);
    await desk.engine.syncNow();
    desk.engine.stop();

    const p = phone(store);
    await p.apply((s) => ({ ...s, tasks: setCompleted(s.tasks, t, true) }));
    await tick(5);
    setText(t, "call the bank about the card"); // later, offline
    setNotes(t, "ask for a new PIN");
    desk.edited();

    const desk2 = desktop(store);
    desk2.edited();
    await tick(250);
    await desk2.engine.syncNow();
    for (const task of [localTask(t), cloudTask(store, t)]) {
      expect(task?.completed).toBe(true);
      expect(task?.text).toBe("call the bank about the card");
      expect(task?.notes).toBe("ask for a new PIN");
    }
  });

  it("the same field edited on both: the newer edit wins, as before", async () => {
    const store = new MemoryStore();
    const desk = desktop(store);
    const t = addTaskAfter(null, "x");
    desk.edited();
    await tick(250);
    await desk.engine.syncNow();
    desk.engine.stop();

    setNotes(t, "older, from the laptop");
    desk.edited();
    await tick(5);
    const p = phone(store);
    await p.apply((s) => ({ ...s, tasks: updateTask(s.tasks, t, { notes: "newer, from the phone" }) }));

    const desk2 = desktop(store);
    desk2.edited();
    await tick(250);
    await desk2.engine.syncNow();
    expect(localTask(t)?.notes).toBe("newer, from the phone");
    expect(cloudTask(store, t).notes).toBe("newer, from the phone");
  });
});
