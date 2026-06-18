import { describe, it, expect } from "vitest";
import { tokenizeInline } from "./markdown";

describe("tokenizeInline", () => {
  it("returns plain text untouched", () => {
    expect(tokenizeInline("hello world")).toEqual([
      { type: "text", value: "hello world" },
    ]);
  });
  it("parses inline code", () => {
    expect(tokenizeInline("run `int main`")).toEqual([
      { type: "text", value: "run " },
      { type: "code", value: "int main" },
    ]);
  });
  it("parses bold and italic", () => {
    expect(tokenizeInline("**big** and *small*")).toEqual([
      { type: "bold", value: "big" },
      { type: "text", value: " and " },
      { type: "italic", value: "small" },
    ]);
  });
  it("parses strikethrough and links", () => {
    expect(tokenizeInline("~~old~~ [docs](https://x.y)")).toEqual([
      { type: "strike", value: "old" },
      { type: "text", value: " " },
      { type: "link", value: "docs", href: "https://x.y" },
    ]);
  });
  it("does not treat a lone backtick as code", () => {
    expect(tokenizeInline("a ` b")).toEqual([{ type: "text", value: "a ` b" }]);
  });
  it("prefers bold over italic for **", () => {
    expect(tokenizeInline("**x**")).toEqual([{ type: "bold", value: "x" }]);
  });
});
