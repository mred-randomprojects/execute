import { describe, it, expect, afterEach } from "vitest";
import { toCombo, findBinding } from "./types";
import type { KeyBinding } from "./types";
import { getActiveContext } from "./useKeyboard";
import { keymap } from "./keymap";

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
    showSearch: false,
    showHistory: false,
    showSchedule: false,
    showProject: false,
    showEstimate: false,
    showCalendar: false,
    showRepeat: false,
    showConfirm: false,
    reckoningActive: false,
    boardMode: false,
    shutdownActive: false,
    planActive: false,
    showReview: false,
  };

  it("defaults to normal", () => {
    expect(getActiveContext(base)).toBe("normal");
  });
  it("shutdown owns the keyboard when it's open", () => {
    expect(getActiveContext({ ...base, shutdownActive: true })).toBe("shutdown");
  });
  it("the gate outranks shutdown — clear yesterday before closing tonight", () => {
    expect(
      getActiveContext({ ...base, shutdownActive: true, reckoningActive: true })
    ).toBe("reckoning");
  });
  it("typing still beats shutdown, so a breakdown step isn't eaten by its verbs", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    expect(getActiveContext({ ...base, shutdownActive: true })).toBe("editing");
    input.remove();
  });
  it("reckoning shows the board when boardMode is on", () => {
    expect(getActiveContext({ ...base, reckoningActive: true, boardMode: true })).toBe("board");
  });
  it("reckoning shows cards when boardMode is off", () => {
    expect(getActiveContext({ ...base, reckoningActive: true, boardMode: false })).toBe("reckoning");
  });
  it("estimate picker owns the keyboard", () => {
    expect(getActiveContext({ ...base, showEstimate: true })).toBe("estimate");
  });
  it("calendar picker owns the keyboard", () => {
    expect(getActiveContext({ ...base, showCalendar: true })).toBe("calendar");
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
  it("reckoning beats normal", () => {
    expect(getActiveContext({ ...base, reckoningActive: true })).toBe("reckoning");
  });
});

describe("getActiveContext — focus zones", () => {
  const base = {
    showHelp: false,
    showPalette: false,
    showSearch: false,
    showHistory: false,
    showSchedule: false,
    showProject: false,
    showEstimate: false,
    showCalendar: false,
    showRepeat: false,
    showConfirm: false,
    reckoningActive: false,
    boardMode: false,
    shutdownActive: false,
    planActive: false,
    showReview: false,
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

// ─── The bare-letter rule ────────────────────────────────────────────
// A single unmodified letter in the outline fires while you are *browsing*, so
// it lands on a real task with no warning. Those keys are therefore limited to
// things that change nothing you'd have to undo. Anything that mutates a task
// or takes over the keyboard lives behind ⌘k instead.
//
// This is a guard, not a style preference: `m` (move mode) used to swallow the
// keyboard with no on-screen exit, and `t` / `w` / `b` / `c` all mutated the
// focused task on one keypress. Adding a letter here should take a deliberate
// argument, which is what failing this test forces.
describe("the bare-letter rule", () => {
  /** Bare letters allowed in the outline, and why each one is harmless. */
  const ALLOWED_IN_NORMAL: Record<string, string> = {
    n: "new task — creates an empty row you're immediately editing; esc discards it",
    p: "peek — a pure view toggle, presses again to close",
  };

  const bareLetters = (context: string) =>
    keymap
      .filter((b) => {
        const ctx = Array.isArray(b.context) ? b.context : [b.context];
        return ctx.includes(context as never);
      })
      .filter((b) => /^[a-zA-Z]$/.test(b.key))
      .map((b) => b.key);

  it("the outline binds only the letters on the allowlist", () => {
    const unexpected = bareLetters("normal").filter(
      (k) => !(k in ALLOWED_IN_NORMAL)
    );
    expect(unexpected).toEqual([]);
  });

  it("keeps ritual letters out of the outline, so no letter has two meanings", () => {
    // The rituals (Reckoning, Shutdown, Plan, board) are modal takeovers that
    // print their letters on the action chips, so a bare letter is safe there —
    // but only as long as the same letter means nothing in the outline.
    // Case-folded: `t` in the outline would still collide with the rituals' `⇧t`.
    const ritual = new Set(
      ["reckoning", "shutdown", "plan", "board"]
        .flatMap(bareLetters)
        .map((k) => k.toLowerCase())
    );
    const clashes = bareLetters("normal").filter((k) =>
      ritual.has(k.toLowerCase())
    );
    expect(clashes).toEqual([]);
  });

  it("every context can always be escaped", () => {
    const escape = keymap.find(
      (b) => b.key === "Escape" && b.context === "global"
    );
    expect(escape).toBeDefined();
  });
});
