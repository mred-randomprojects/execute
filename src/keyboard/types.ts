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
  | "reckoning"
  | "editing"
  | "move"
  | "normal";

export type AppMode = "normal" | "move";

/** The slice of app state the context resolver needs. */
export interface ContextState {
  showHelp: boolean;
  showPalette: boolean;
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
}

// ─── Normalizer ──────────────────────────────────────────────────────

export function toCombo(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey) parts.push("Meta");
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(e.key);
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
