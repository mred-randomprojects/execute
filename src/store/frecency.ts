import type { CommandUsage } from "../types";

// ─── Command-palette frecency ("frequency" × "recency") ─────────────
//
// The palette ranks commands the way Raycast does: something you reach for a
// lot AND used recently should sit at the top, while a command you ran once
// last month barely nudges. We keep only a running count + the last-used
// timestamp per command (see CommandUsage), so the score is that count scaled
// by a recency multiplier bucketed on the age of the last use. Bucketing (vs.
// a continuous decay) keeps it cheap, stable within a session, and easy to
// reason about: two commands with equal counts are ordered by who was touched
// more recently, and a fresh single use can still leapfrog a stale pile.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;

/** Recency multiplier for a last-use `ageMs` old. Monotonically non-increasing. */
export function recencyWeight(ageMs: number): number {
  if (ageMs < HOUR) return 4;
  if (ageMs < DAY) return 2;
  if (ageMs < WEEK) return 1;
  if (ageMs < MONTH) return 0.5;
  return 0.25;
}

/**
 * Frecency score for a command's usage as of `now`. `0` for a command that has
 * never been run (no entry, or a non-positive count), so unused commands all
 * tie and keep their deliberate default order.
 */
export function frecencyScore(usage: CommandUsage | undefined, now: number): number {
  if (usage == null || usage.count <= 0) return 0;
  const age = Math.max(0, now - usage.lastUsedAt);
  return usage.count * recencyWeight(age);
}
