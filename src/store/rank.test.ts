import { describe, expect, it } from "vitest";
import { isValidRank, rankList, ranksBetween } from "./rank";

const increasing = (xs: readonly string[]) => xs.every((x, i) => i === 0 || xs[i - 1] < x);

describe("ranksBetween", () => {
  it("fits any number of valid ranks strictly between two bounds", () => {
    for (const [lo, hi] of [["", null], ["", "1"], ["V", "W"], ["V", "V1"], ["az", "b"]] as const) {
      const rs = ranksBetween(lo, hi, 50);
      expect(rs).toHaveLength(50);
      expect(increasing([lo, ...rs])).toBe(true);
      if (hi != null) expect(rs[49] < hi).toBe(true);
      expect(rs.every(isValidRank)).toBe(true);
    }
  });

  it("stays short for a long list", () => {
    const rs = ranksBetween("", null, 1000);
    expect(Math.max(...rs.map((r) => r.length))).toBeLessThanOrEqual(4);
  });

  it("keeps finding room after many inserts at the same spot", () => {
    let lo = "";
    const hi = "V";
    for (let i = 0; i < 200; i++) {
      const [r] = ranksBetween(lo, hi, 1);
      expect(lo < r && r < hi).toBe(true);
      lo = r;
    }
  });

  it("is deterministic", () => {
    expect(ranksBetween("", null, 7)).toEqual(ranksBetween("", null, 7));
  });
});

describe("rankList", () => {
  it("returns the same array when the order is already right", () => {
    const rs = ranksBetween("", null, 5);
    expect(rankList(rs)).toBe(rs);
  });

  it("re-ranks only the one sibling that moved", () => {
    const [a, b, c, d] = ranksBetween("", null, 4);
    const out = rankList([d, a, b, c]); // d dragged to the top
    expect(out.slice(1)).toEqual([a, b, c]);
    expect(out[0] < a).toBe(true);
  });

  it("ranks unranked and invalid siblings in place", () => {
    const [a, b] = ranksBetween("", null, 2);
    const out = rankList(["", a, "x0", b, ""]);
    expect(increasing(out)).toBe(true);
    expect(out[1]).toBe(a);
    expect(out[3]).toBe(b);
  });

  it("breaks ties", () => {
    const out = rankList(["V", "V", "V"]);
    expect(increasing(out)).toBe(true);
  });

  it("never keeps an ineligible sibling's rank", () => {
    const rs = ranksBetween("", null, 3);
    const out = rankList(rs, (i) => i !== 1);
    expect(out[0]).toBe(rs[0]);
    expect(out[2]).toBe(rs[2]);
    expect(out[1]).not.toBe(rs[1]);
    expect(increasing(out)).toBe(true);
  });
});
