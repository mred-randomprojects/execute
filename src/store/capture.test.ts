import { describe, it, expect } from "vitest";
import { parseCapture } from "./capture";

describe("parseCapture", () => {
  it("passes plain text through", () => {
    expect(parseCapture("buy milk")).toEqual({ text: "buy milk", completed: false });
  });
  it("strips an empty checkbox", () => {
    expect(parseCapture("[] buy milk")).toEqual({ text: "buy milk", completed: false });
    expect(parseCapture("[ ] buy milk")).toEqual({ text: "buy milk", completed: false });
  });
  it("treats [x] as a completed task", () => {
    expect(parseCapture("[x] shipped")).toEqual({ text: "shipped", completed: true });
    expect(parseCapture("[X] shipped")).toEqual({ text: "shipped", completed: true });
  });
  it("strips bullets", () => {
    expect(parseCapture("- item")).toEqual({ text: "item", completed: false });
    expect(parseCapture("* item")).toEqual({ text: "item", completed: false });
  });
  it("trims surrounding whitespace", () => {
    expect(parseCapture("   hello   ")).toEqual({ text: "hello", completed: false });
  });
  it("does not treat a lone dash as a bullet", () => {
    expect(parseCapture("-nope")).toEqual({ text: "-nope", completed: false });
  });
});
