import { describe, it, expect } from "vitest";
import { recencyWeight, frecencyScore } from "./frecency";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("recencyWeight", () => {
  it("is highest within the hour and never increases with age", () => {
    const ages = [0, HOUR - 1, HOUR, DAY, 7 * DAY, 30 * DAY, 400 * DAY];
    const weights = ages.map(recencyWeight);
    expect(weights[0]).toBe(4); // just now
    // monotonically non-increasing as things get older
    for (let i = 1; i < weights.length; i++) {
      expect(weights[i]).toBeLessThanOrEqual(weights[i - 1]);
    }
    expect(weights[weights.length - 1]).toBe(0.25); // ancient floor
  });
});

describe("frecencyScore", () => {
  const now = 1_000 * DAY; // arbitrary fixed clock

  it("scores an unused command (no entry) as 0", () => {
    expect(frecencyScore(undefined, now)).toBe(0);
  });

  it("scores a non-positive count as 0 (defensive)", () => {
    expect(frecencyScore({ count: 0, lastUsedAt: now }, now)).toBe(0);
  });

  it("weights frequency by recency: recent beats stale at equal counts", () => {
    const recent = frecencyScore({ count: 3, lastUsedAt: now - HOUR / 2 }, now);
    const stale = frecencyScore({ count: 3, lastUsedAt: now - 40 * DAY }, now);
    expect(recent).toBeGreaterThan(stale);
  });

  it("lets a fresh single use leapfrog a stale pile", () => {
    const freshOnce = frecencyScore({ count: 1, lastUsedAt: now }, now); // 1 * 4 = 4
    const staleMany = frecencyScore({ count: 5, lastUsedAt: now - 60 * DAY }, now); // 5 * 0.25 = 1.25
    expect(freshOnce).toBeGreaterThan(staleMany);
  });

  it("clamps a future timestamp to age 0 (weight 4)", () => {
    expect(frecencyScore({ count: 2, lastUsedAt: now + DAY }, now)).toBe(8);
  });
});
