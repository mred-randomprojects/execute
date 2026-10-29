import { describe, expect, it } from "vitest";
import { withFreshIds } from "./agent";

describe("withFreshIds", () => {
  it("fills a new task's missing id", () => {
    const item = withFreshIds({ type: "addChild", parentId: "p", text: "x", plannedFor: null });
    expect(item).toMatchObject({ type: "addChild", parentId: "p" });
    expect(typeof (item as { id: unknown }).id).toBe("string");
  });

  it("fills both ids of a new recurrence, keeping the caller's", () => {
    const fresh = withFreshIds({ type: "createRecurrence", text: "x" }) as { id: string; taskId: string };
    expect(fresh.id).not.toBe(fresh.taskId);
    expect(withFreshIds({ type: "createRecurrence", id: "r", taskId: "t" })).toEqual({
      type: "createRecurrence",
      id: "r",
      taskId: "t",
    });
  });

  it("leaves other commands alone", () => {
    const item = { type: "setText", id: "a", text: "x" };
    expect(withFreshIds(item)).toBe(item);
  });
});
