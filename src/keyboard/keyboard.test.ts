import { describe, it, expect } from "vitest";
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
    expect(
      toCombo(fakeEvent({ key: "k", metaKey: true, shiftKey: true }))
    ).toBe("Meta+Shift+k");
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
    reckoningActive: false,
    mode: "normal" as const,
  };

  it("defaults to normal", () => {
    expect(getActiveContext(base)).toBe("normal");
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
