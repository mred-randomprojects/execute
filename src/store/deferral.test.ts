import { describe, it, expect } from "vitest";
import type { Task } from "../types";
import { makeTask } from "./tasks";
import {
  CARRY_PROMPT_AT,
  POSTPONE_PROMPT_AT,
  deferralBadges,
  willPromptOnKeep,
  willPromptOnPostpone,
} from "./deferral";

const t = (carried: number, postponed: number): Task => ({
  ...makeTask("a task"),
  carriedCount: carried,
  postponedCount: postponed,
});

describe("deferralBadges", () => {
  it("says nothing about a task nobody has deferred", () => {
    expect(deferralBadges(t(0, 0))).toEqual([]);
  });

  it("shows a carry from the very first one", () => {
    const [badge] = deferralBadges(t(1, 0));
    expect(badge.kind).toBe("carried");
    expect(badge.label).toBe("carried 1×");
    expect(badge.tone).toBe("quiet");
  });

  it("stays quiet about a single postponement — once is just life", () => {
    expect(deferralBadges(t(0, 1))).toEqual([]);
  });

  it("shows a postponement from the second, when it becomes a pattern", () => {
    const [badge] = deferralBadges(t(0, 2));
    expect(badge.kind).toBe("postponed");
    expect(badge.label).toBe("postponed 2×");
    expect(badge.tone).toBe("quiet");
  });

  it("escalates the tone once a count reaches its prompt threshold", () => {
    expect(deferralBadges(t(CARRY_PROMPT_AT, 0))[0].tone).toBe("loud");
    expect(deferralBadges(t(0, POSTPONE_PROMPT_AT))[0].tone).toBe("loud");
  });

  it("shows both counts when both happened — they are different failures", () => {
    const badges = deferralBadges(t(2, 3));
    expect(badges.map((b) => b.kind)).toEqual(["postponed", "carried"]);
  });

  it("writes a title that reads as a sentence, singular and plural", () => {
    expect(deferralBadges(t(1, 0))[0].title).toBe(
      "Kept for today 1 time without finishing"
    );
    expect(deferralBadges(t(0, 2))[0].title).toBe(
      "Pushed to another day 2 times without being done"
    );
  });
});

describe("prompt thresholds", () => {
  it("prompts on the keep that would make it the CARRY_PROMPT_AT-th", () => {
    expect(willPromptOnKeep(t(CARRY_PROMPT_AT - 2, 0))).toBe(false);
    expect(willPromptOnKeep(t(CARRY_PROMPT_AT - 1, 0))).toBe(true);
  });

  it("keeps prompting past the threshold — the friction doesn't wear off", () => {
    expect(willPromptOnKeep(t(CARRY_PROMPT_AT + 5, 0))).toBe(true);
  });

  it("prompts on the postponement that would make it the POSTPONE_PROMPT_AT-th", () => {
    expect(willPromptOnPostpone(t(0, POSTPONE_PROMPT_AT - 2))).toBe(false);
    expect(willPromptOnPostpone(t(0, POSTPONE_PROMPT_AT - 1))).toBe(true);
  });

  it("tolerates postponing longer than carrying — plans legitimately change", () => {
    expect(POSTPONE_PROMPT_AT).toBeGreaterThan(CARRY_PROMPT_AT);
  });

  it("keeps the two counters independent", () => {
    expect(willPromptOnKeep(t(0, 9))).toBe(false);
    expect(willPromptOnPostpone(t(9, 0))).toBe(false);
  });
});
