import { describe, expect, it } from "vitest";
import { CLOUD_LOG_DAYS, firestoreSize, toCloud } from "./cloudDoc";
import { mergeStates } from "./merge";
import { emptyState, type AppState, type LogEntry, type TaskId } from "../types";

const DAY = 86_400_000;
const now = 1_790_000_000_000;
const entry = (id: string, at: number): LogEntry => ({
  id,
  taskId: "t" as TaskId,
  taskText: "t",
  action: "completed",
  reason: null,
  at,
  date: "2026-09-01",
});

describe("toCloud", () => {
  it("carries only the recent end of the log", () => {
    const s: AppState = {
      ...emptyState(),
      log: [entry("new", now - DAY), entry("old", now - (CLOUD_LOG_DAYS + 1) * DAY)],
    };
    expect(toCloud(s, now).log.map((e) => e.id)).toEqual(["new"]);
  });

  it("returns the same object when there's nothing to trim", () => {
    const s: AppState = { ...emptyState(), log: [entry("new", now)] };
    expect(toCloud(s, now)).toBe(s);
  });

  it("never trims a device: merging a trimmed cloud keeps the local history", () => {
    const local: AppState = {
      ...emptyState(),
      log: [entry("new", now - DAY), entry("old", now - 200 * DAY)],
    };
    const merged = mergeStates(local, toCloud(local, now));
    expect(merged.log.map((e) => e.id)).toEqual(["new", "old"]);
  });
});

describe("firestoreSize", () => {
  it("follows Firestore's documented accounting", () => {
    expect(firestoreSize("héllo")).toBe(7); // 6 UTF-8 bytes + 1
    expect(firestoreSize(3)).toBe(8);
    expect(firestoreSize(null)).toBe(1);
    expect(firestoreSize({ a: true, b: [1, 2] })).toBe(2 + 1 + 2 + 16);
    expect(firestoreSize({ a: undefined })).toBe(0);
  });
});
