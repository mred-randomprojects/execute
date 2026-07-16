import { describe, it, expect, afterEach } from "vitest";
import { toCombo, findBinding } from "./types";
import type { KeyBinding } from "./types";
import { getActiveContext } from "./useKeyboard";

function fakeEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("toCombo", () => {
  it("normalizes a plain letter", () => {
    expect(toCombo(fakeEvent({ key: "o" }))).toBe("o");
  });
  it("normalizes modifiers in a fixed order", () => {
    expect(toCombo(fakeEvent({ key: "Enter", metaKey: true }))).toBe("Meta+Enter");
    expect(toCombo(fakeEvent({ key: "Tab", shiftKey: true }))).toBe("Shift+Tab");
  });
  it("ignores Caps Lock for letters (case follows Shift, not the raw key)", () => {
    // Caps Lock on: "n" arrives as "N" with shiftKey false → still matches "n".
    expect(toCombo(fakeEvent({ key: "N" }))).toBe("n");
    // Caps Lock + Shift: "n" arrives lowercase with shiftKey true → "N".
    expect(toCombo(fakeEvent({ key: "n", shiftKey: true }))).toBe("N");
    // The Shift pair stays distinct: plain t vs. Shift+t.
    expect(toCombo(fakeEvent({ key: "t" }))).toBe("t");
    expect(toCombo(fakeEvent({ key: "T", shiftKey: true }))).toBe("T");
    // Caps Lock must not masquerade as Shift: Caps+t is "t", not "T".
    expect(toCombo(fakeEvent({ key: "T" }))).toBe("t");
  });
  it("keeps Shift only for non-printable keys", () => {
    // shift+/ → "?" (printable): Shift dropped so it matches a "?" binding.
    expect(toCombo(fakeEvent({ key: "?", shiftKey: true }))).toBe("?");
    // shift+letter: Shift dropped, the case encodes it (a real browser delivers
    // Shift+k as "K"). Plain ⌘k below stays lowercase and reaches the palette.
    expect(toCombo(fakeEvent({ key: "K", metaKey: true, shiftKey: true }))).toBe("Meta+K");
    expect(toCombo(fakeEvent({ key: "k", metaKey: true }))).toBe("Meta+k");
    // Shift kept for arrows (multi-select) and Tab (outdent).
    expect(toCombo(fakeEvent({ key: "ArrowUp", shiftKey: true }))).toBe("Shift+ArrowUp");
    expect(toCombo(fakeEvent({ key: "ArrowDown", metaKey: true }))).toBe("Meta+ArrowDown");
    expect(toCombo(fakeEvent({ key: "ArrowDown", altKey: true }))).toBe("Alt+ArrowDown");
  });
});

describe("findBinding", () => {
  const keymap: KeyBinding[] = [
    { key: "Escape", action: "dismiss", context: "global" },
    { key: "j", action: "cursor.down", context: "normal" },
    { key: "Enter", action: "open", context: "normal" },
    { key: "Enter", action: "palette.run", context: "palette" },
  ];

  it("matches an exact-context binding", () => {
    expect(findBinding(keymap, "j", "normal")?.action).toBe("cursor.down");
  });
  it("prefers an exact context over global", () => {
    const km: KeyBinding[] = [
      { key: "x", action: "g", context: "global" },
      { key: "x", action: "n", context: "normal" },
    ];
    expect(findBinding(km, "x", "normal")?.action).toBe("n");
  });
  it("falls back to global when no exact match", () => {
    expect(findBinding(keymap, "Escape", "reckoning")?.action).toBe("dismiss");
  });
  it("disambiguates the same key across contexts", () => {
    expect(findBinding(keymap, "Enter", "normal")?.action).toBe("open");
    expect(findBinding(keymap, "Enter", "palette")?.action).toBe("palette.run");
  });
  it("returns undefined when nothing matches", () => {
    expect(findBinding(keymap, "z", "normal")).toBeUndefined();
  });
});

describe("getActiveContext", () => {
  const base = {
    showHelp: false,
    showPalette: false,
    showSchedule: false,
    showRepeat: false,
    showConfirm: false,
    reckoningActive: false,
    mode: "normal" as const,
  };

  it("defaults to normal", () => {
    expect(getActiveContext(base)).toBe("normal");
  });
  it("confirm wins over everything", () => {
    expect(
      getActiveContext({ ...base, showConfirm: true, showHelp: true })
    ).toBe("confirm");
  });
  it("help wins over everything", () => {
    expect(
      getActiveContext({ ...base, showHelp: true, showPalette: true })
    ).toBe("help");
  });
  it("palette beats reckoning", () => {
    expect(
      getActiveContext({ ...base, showPalette: true, reckoningActive: true })
    ).toBe("palette");
  });
  it("reckoning beats move and normal", () => {
    expect(
      getActiveContext({ ...base, reckoningActive: true, mode: "move" })
    ).toBe("reckoning");
  });
  it("move when reordering", () => {
    expect(getActiveContext({ ...base, mode: "move" })).toBe("move");
  });
});

describe("getActiveContext — focus zones", () => {
  const base = {
    showHelp: false,
    showPalette: false,
    showSchedule: false,
    showRepeat: false,
    showConfirm: false,
    reckoningActive: false,
    mode: "normal" as const,
  };

  afterEach(() => {
    document.body.innerHTML = "";
  });

  function focus(html: string): void {
    document.body.innerHTML = html;
    (document.body.querySelector("[data-test]") as HTMLElement).focus();
  }

  it("a focused text input owns the keyboard (editing)", () => {
    focus(`<input data-test />`);
    expect(getActiveContext(base)).toBe("editing");
  });

  it("a button inside a data-keyzone region owns the keyboard, so Tab stays native", () => {
    focus(`<aside data-keyzone="panel"><button data-test>Urgent</button></aside>`);
    expect(getActiveContext(base)).toBe("editing");
  });

  it("a plain button outside any keyzone stays normal (mouse→keyboard handoff)", () => {
    focus(`<button data-test>Backlog</button>`);
    expect(getActiveContext(base)).toBe("normal");
  });
});
