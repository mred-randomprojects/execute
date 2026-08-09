import type { DayRecord, ISODate } from "../types";
import { addDays } from "./dates";
import { blocksFromMinutes } from "./estimate";

// What a day of yours actually holds, as opposed to what you think it holds.
//
// `dailyCapacityBlocks` has always been a number the user typed — 12 by default,
// about four hours of task-work. The Reckoning then spends every morning
// discovering that yesterday's plan didn't fit. But over-commitment is the
// *cause* and the gate is only the symptom: the fix belongs at the moment of
// committing, and the evidence has been sitting in the day records the whole
// time.
//
// So: read back what actually got finished, and offer the number. Never impose
// it — a capacity you didn't choose is just another thing nagging you — and say
// nothing at all until there's enough evidence to be worth saying.

/** Days of history the suggestion reads. Two working weeks. */
export const CAPACITY_WINDOW_DAYS = 14;

/**
 * Below this many usable days the suggestion stays silent. Three is the point
 * where a number stops being an anecdote; guessing from one good Tuesday would
 * be worse than the default.
 */
export const MIN_CAPACITY_SAMPLES = 3;

export interface CapacityEvidence {
  /** The median day's finished load, in blocks. */
  medianBlocks: number;
  /** How many days in the window actually contributed. */
  samples: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * What the last {@link CAPACITY_WINDOW_DAYS} days say a day holds, or `null`
 * when they don't say enough.
 *
 * The median rather than the mean, because one heroic Saturday shouldn't become
 * the standard you're measured against every weekday. Only days that both asked
 * something *and* finished something estimated count: a day with no commitments
 * is not evidence of a small capacity, and a day of unestimated work is not
 * evidence of an empty one.
 */
export function capacityEvidence(
  days: DayRecord[],
  today: ISODate,
  window: number = CAPACITY_WINDOW_DAYS
): CapacityEvidence | null {
  const from = addDays(today, -(window - 1));
  const blocks = days
    .filter((d) => d.date >= from && d.date <= today && d.committed > 0 && d.doneMinutes > 0)
    .map((d) => blocksFromMinutes(d.doneMinutes));
  if (blocks.length < MIN_CAPACITY_SAMPLES) return null;
  return { medianBlocks: median(blocks), samples: blocks.length };
}

/**
 * The capacity worth *offering*, or `null` to stay quiet. Silent when the
 * evidence is thin, and silent when the current setting is already close enough
 * — a suggestion to change 12 to 11 is noise, and an app that always has a
 * correction for you gets tuned out.
 */
export function suggestedCapacityBlocks(
  days: DayRecord[],
  today: ISODate,
  currentBlocks: number,
  window: number = CAPACITY_WINDOW_DAYS
): number | null {
  const evidence = capacityEvidence(days, today, window);
  if (evidence == null) return null;
  const suggested = Math.max(1, evidence.medianBlocks);
  return Math.abs(suggested - currentBlocks) >= 2 ? suggested : null;
}
