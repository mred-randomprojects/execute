import { useEffect } from "react";
import type { KeyBinding, KeyContext, ContextState } from "./types";
import { toCombo, findBinding } from "./types";

// ─── Context resolver ────────────────────────────────────────────────
// Priority: help > palette > editing > reckoning > move > normal.
// `editing` beats `reckoning` so typing a breakdown subtask doesn't trigger
// reckoning shortcuts; `palette` beats `editing` so the palette's own input
// still responds to arrows/enter.

function isInteractiveElementFocused(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement;
  if (el == null) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el instanceof HTMLElement && el.isContentEditable;
}

export function getActiveContext(state: ContextState): KeyContext {
  // A confirmation dialog is modal: it owns the keyboard above everything else.
  if (state.showConfirm) return "confirm";
  if (state.showHelp) return "help";
  if (state.showPalette) return "palette";
  // The schedule picker owns the keyboard while open (it has no app bindings),
  // so normal/editing shortcuts stay dormant beneath it.
  if (state.showSchedule) return "schedule";
  if (isInteractiveElementFocused()) return "editing";
  if (state.reckoningActive) return "reckoning";
  if (state.mode === "move") return "move";
  return "normal";
}

// ─── Dispatcher hook ─────────────────────────────────────────────────

export function useKeyboard<D extends ContextState>(
  keymap: KeyBinding[],
  actionMap: Record<string, (d: D) => void>,
  dispatch: D
) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const combo = toCombo(e);
      const context = getActiveContext(dispatch);

      // Let text fields keep native undo while focused.
      if (combo === "Meta+z") {
        const tag = document.activeElement?.tagName;
        if (tag === "TEXTAREA" || tag === "INPUT") return;
      }

      const binding = findBinding(keymap, combo, context);
      if (binding == null) return;

      const handler = actionMap[binding.action];
      if (handler == null) return;

      e.preventDefault();
      handler(dispatch);
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [keymap, actionMap, dispatch]);
}
