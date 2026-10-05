import { describe, it, expect } from "vitest";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { occurrences, renderInline, tokenizeInline } from "./markdown";

describe("tokenizeInline", () => {
  it("returns plain text untouched", () => {
    expect(tokenizeInline("hello world")).toEqual([
      { type: "text", value: "hello world", start: 0 },
    ]);
  });
  it("parses inline code", () => {
    expect(tokenizeInline("run `int main`")).toEqual([
      { type: "text", value: "run ", start: 0 },
      { type: "code", value: "int main", start: 5 },
    ]);
  });
  it("parses bold and italic", () => {
    expect(tokenizeInline("**big** and *small*")).toEqual([
      { type: "bold", value: "big", start: 2 },
      { type: "text", value: " and ", start: 7 },
      { type: "italic", value: "small", start: 13 },
    ]);
  });
  it("parses strikethrough and links", () => {
    expect(tokenizeInline("~~old~~ [docs](https://x.y)")).toEqual([
      { type: "strike", value: "old", start: 2 },
      { type: "text", value: " ", start: 7 },
      { type: "link", value: "docs", href: "https://x.y", start: 9 },
    ]);
  });
  it("does not treat a lone backtick as code", () => {
    expect(tokenizeInline("a ` b")).toEqual([{ type: "text", value: "a ` b", start: 0 }]);
  });
  it("prefers bold over italic for **", () => {
    expect(tokenizeInline("**x**")).toEqual([{ type: "bold", value: "x", start: 2 }]);
  });
});

describe("occurrences", () => {
  it("marks every case-insensitive occurrence, char by char", () => {
    expect(occurrences("Milk and more MILK", "milk")).toEqual([0, 1, 2, 3, 14, 15, 16, 17]);
  });
  it("marks nothing for a blank query", () => {
    expect(occurrences("anything", " ")).toEqual([]);
  });
});

describe("renderInline hits", () => {
  const html = (text: string, hits: number[]) =>
    renderToStaticMarkup(createElement(Fragment, null, renderInline(text, hits)));
  it("marks raw indices on the rendered chars, through the markdown syntax", () => {
    // "**big** deal": b=2 i=3 sit inside the bold; d=8 in the plain tail.
    const out = html("**big** deal", [2, 3, 8]);
    expect(out).toContain('<strong class="font-semibold"><mark class="rounded-[2px] bg-accent-soft text-accent">bi</mark>g</strong>');
    expect(out).toContain('<mark class="rounded-[2px] bg-accent-soft text-accent">d</mark>eal');
  });
  it("drops a hit that lands on syntax", () => {
    expect(html("**x**", [0])).not.toContain("<mark");
  });
});
