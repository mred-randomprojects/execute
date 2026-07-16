// Declarative keyboard engine. Inspired by Zed's binding system: bindings are
// data, contexts decide *when* they fire, actions decide *what* they do. The
// three concerns stay fully separate. Adapted from i0-todo/src/keyboard.

// ─── Contexts ────────────────────────────────────────────────────────
// Exactly one context is active at a time (the resolver picks the highest
// priority). Bindings marked "global" fire in every context.

export type KeyContext =
  | "global"
  | "help"
  | "palette"
  | "schedule"
  | "repeat"
  | "confirm"
  | "reckoning"
  | "editing"
  | "move"
  | "normal";

export type AppMode = "normal" | "move";

/** The slice of app state the context resolver needs. */
export interface ContextState {
  showHelp: boolean;
  showPalette: boolean;
  showSchedule: boolean;
  showRepeat: boolean;
  showConfirm: boolean;
  reckoningActive: boolean;
  mode: AppMode;
}

// ─── Keymap ──────────────────────────────────────────────────────────

export interface KeyBinding {
  /** Normalized combo, e.g. "Meta+Enter", "ArrowDown", "o", "Shift+Tab". */
  key: string;
  /** Action id, resolved against the action map, e.g. "cursor.down". */
  action: string;
  context: KeyContext | KeyContext[];
  /** Human label for the help overlay (omit to hide from help). */
  description?: string;
  /** Pretty key for the help overlay, e.g. "⌘ ↵". */
  displayKey?: string;
  /** Section grouping in the help overlay. */
  section?: string;
  /**
   * Ignore key auto-repeat (holding the key down). Off by default so held keys
   * still stream — that's what walks the cursor to the bottom of the list on a
   * held ArrowDown. Set on one-shot/destructive actions like trash, where a held
   * key would otherwise cascade through the whole list.
   */
  noRepeat?: boolean;
}

// ─── Normalizer ──────────────────────────────────────────────────────

export function toCombo(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey) parts.push("Meta");
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");

  // Caps Lock flips the case of an alphabetic e.key independently of Shift, so
  // pressing "n" with Caps Lock on arrives as "N" and misses its lowercase
  // binding. This keymap uses letter case purely as a proxy for Shift (t vs. T
  // = schedule later vs. earlier), so derive the case from the real Shift state
  // rather than the raw key. That fixes Caps Lock while keeping the Shift pairs
  // distinct. Non-letters ("?", "[", numbers…) are untouched — their shifted
  // forms are different characters, not a case swap.
  let key = e.key;
  if (key.length === 1 && ((key >= "a" && key <= "z") || (key >= "A" && key <= "Z"))) {
    key = e.shiftKey ? key.toUpperCase() : key.toLowerCase();
  }

  // Shift only matters for non-printable keys (Tab, Enter, Arrows…). For a
  // printable single char the character itself already reflects shift
  // (e.g. "?" from shift+/, "!" from shift+1), so adding "Shift+" would make
  // the combo unmatchable against a "?" binding.
  if (e.shiftKey && key.length > 1) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

// ─── Resolution ──────────────────────────────────────────────────────

function contextMatches(
  bindingCtx: KeyContext | KeyContext[],
  activeCtx: KeyContext
): boolean {
  if (Array.isArray(bindingCtx)) return bindingCtx.includes(activeCtx);
  if (bindingCtx === "global") return true;
  return bindingCtx === activeCtx;
}

/** Best binding for a combo in a context. Exact matches beat "global". */
export function findBinding(
  keymap: KeyBinding[],
  combo: string,
  activeContext: KeyContext
): KeyBinding | undefined {
  let globalMatch: KeyBinding | undefined;
  for (const binding of keymap) {
    if (binding.key !== combo) continue;
    if (!contextMatches(binding.context, activeContext)) continue;
    if (binding.context === "global") {
      if (globalMatch == null) globalMatch = binding;
      continue;
    }
    return binding;
  }
  return globalMatch;
}
