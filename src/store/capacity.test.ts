import { describe, it, expect } from "vitest";
import type { DayRecord, ISODate } from "../types";
import { addDays } from "./dates";
import {
  MIN_CAPACITY_SAMPLES,
  capacityEvidence,
  suggestedCapacityBlocks,
} from "./capacity";

const TODAY: ISODate = "2026-08-09";
const ago = (n: number): ISODate => addDays(TODAY, -n);

/** A day that committed to something and finished `blocks` worth of it. */
const day = (n: number, blocks: number, committed = 4): DayRecord => ({
  date: ago(n),
  committed,
  done: blocks,
  doneMinutes: blocks * 20,
  skipped: 0,
  closedAt: 1,
});

describe("capacityEvidence", () => {
  it("says nothing without enough days to be more than an anecdote", () => {
    expect(capacityEvidence([day(1, 5), day(2, 6)], TODAY)).toBeNull();
    expect(capacityEvidence([day(1, 5), day(2, 6), day(3, 7)], TODAY)).not.toBeNull();
    expect(MIN_CAPACITY_SAMPLES).toBe(3);
  });

  it("takes the median, so one heroic day doesn't become the standard", () => {
    const days = [day(1, 4), day(2, 5), day(3, 6), day(4, 5), day(5, 30)];
    expect(capacityEvidence(days, TODAY)?.medianBlocks).toBe(5);
  });

  it("ignores days that asked nothing — an empty day isn't a small capacity", () => {
    const days = [
      day(1, 5),
      day(2, 6),
      day(3, 7),
      { ...day(4, 0), committed: 0, doneMinutes: 0 },
    ];
    expect(capacityEvidence(days, TODAY)?.samples).toBe(3);
  });

  it("ignores days of unestimated work — that isn't evidence of an empty day", () => {
    const days = [day(1, 5), day(2, 6), day(3, 7), { ...day(4, 3), doneMinutes: 0 }];
    expect(capacityEvidence(days, TODAY)?.samples).toBe(3);
  });

  it("only reads inside the window", () => {
    const days = [day(1, 4), day(2, 4), day(3, 4), day(40, 99)];
    const evidence = capacityEvidence(days, TODAY);
    expect(evidence?.samples).toBe(3);
    expect(evidence?.medianBlocks).toBe(4);
  });

  it("does not count days that haven't happened yet", () => {
    const future: DayRecord = { ...day(1, 20), date: addDays(TODAY, 3) };
    const days = [day(1, 4), day(2, 4), day(3, 4), future];
    expect(capacityEvidence(days, TODAY)?.samples).toBe(3);
  });
});

describe("suggestedCapacityBlocks", () => {
  const steady = [day(1, 5), day(2, 5), day(3, 6), day(4, 4)];

  it("offers the learned number when the setting is badly wrong", () => {
    expect(suggestedCapacityBlocks(steady, TODAY, 12)).toBe(5);
  });

  it("stays quiet when the setting is already about right", () => {
    // An app that always has a correction for you gets tuned out.
    expect(suggestedCapacityBlocks(steady, TODAY, 5)).toBeNull();
    expect(suggestedCapacityBlocks(steady, TODAY, 6)).toBeNull();
  });

  it("stays quiet without evidence, rather than guessing at the default", () => {
    expect(suggestedCapacityBlocks([], TODAY, 12)).toBeNull();
    expect(suggestedCapacityBlocks([day(1, 2)], TODAY, 12)).toBeNull();
  });

  it("never offers a capacity of zero", () => {
    const barely = [day(1, 0, 3), day(2, 0, 3), day(3, 0, 3)].map((d) => ({
      ...d,
      doneMinutes: 5, // sub-block work still rounds up to one block
    }));
    const suggestion = suggestedCapacityBlocks(barely, TODAY, 12);
    expect(suggestion).toBe(1);
  });
});
