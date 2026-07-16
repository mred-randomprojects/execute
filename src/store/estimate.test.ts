import { describe, it, expect } from "vitest";
import {
  blocksFromMinutes,
  minutesFromBlocks,
  formatMinutes,
  estimateLabel,
} from "./estimate";

describe("blocksFromMinutes", () => {
  it("treats no estimate as zero blocks", () => {
    expect(blocksFromMinutes(null)).toBe(0);
    expect(blocksFromMinutes(0)).toBe(0);
  });
  it("maps the shallow scale: 20m=1, 40m=2, 60m=3", () => {
    expect(blocksFromMinutes(20)).toBe(1);
    expect(blocksFromMinutes(40)).toBe(2);
    expect(blocksFromMinutes(60)).toBe(3);
  });
  it("rounds a sub-block guess up to one, never to zero", () => {
    expect(blocksFromMinutes(5)).toBe(1);
    expect(blocksFromMinutes(9)).toBe(1);
  });
});

describe("minutesFromBlocks", () => {
  it("clears the estimate at zero or below", () => {
    expect(minutesFromBlocks(0)).toBeNull();
    expect(minutesFromBlocks(-3)).toBeNull();
  });
  it("scales blocks by the 20-minute unit", () => {
    expect(minutesFromBlocks(1)).toBe(20);
    expect(minutesFromBlocks(3)).toBe(60);
    expect(minutesFromBlocks(8)).toBe(160);
  });
  it("round-trips with blocksFromMinutes", () => {
    for (const b of [1, 2, 3, 4, 6, 8]) {
      expect(blocksFromMinutes(minutesFromBlocks(b))).toBe(b);
    }
  });
});

describe("formatMinutes / estimateLabel", () => {
  it("formats compact hour/minute labels", () => {
    expect(formatMinutes(40)).toBe("40m");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(80)).toBe("1h 20m");
  });
  it("spells out the estimate for tooltips", () => {
    expect(estimateLabel(null)).toBe("No estimate");
    expect(estimateLabel(20)).toBe("1 block · 20m");
    expect(estimateLabel(60)).toBe("3 blocks · 1h");
  });
});
