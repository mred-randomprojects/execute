import { useEffect } from "react";
import type { KeyBinding, KeyContext, ContextState } from "./types";
import { toCombo, findBinding } from "./types";

// ─── Context resolver ────────────────────────────────────────────────
// Priority: help > palette > editing > reckoning > move > normal.
// `editing` beats `reckoning` so typing a breakdown subtask doesn't trigger
// reckoning shortcuts; `palette` beats `editing` so the palette's own input
// still responds to arrows/enter.

// True when focus sits somewhere that should own the keyboard, so the global
// outline shortcuts stay dormant and native behavior is preserved. Two cases:
//   1. A text-entry element (input / textarea / select / contenteditable).
//   2. Anything inside a region that opts in via `data-keyzone` — e.g. the
//      detail panel. That lets a cluster of plain <button>s keep native
//      Tab / Shift+Tab focus traversal instead of having Tab swallowed by
//      `task.indent` (and Backspace by `task.trash`, etc.).
// Scoping by region rather than element type matters: sidebar buttons keep
// focus after a click and must stay in "normal" context so the mouse→keyboard
// handoff still works.
function isInteractiveElementFocused(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return el.closest("[data-keyzone]") != null;
}

export function getActiveContext(state: ContextState): KeyContext {
  // A confirmation dialog is modal: it owns the keyboard above everything else.
  if (state.showConfirm) return "confirm";
  if (state.showHelp) return "help";
  // The history panel is modal like the help overlay: it owns the keyboard while
  // it's up, so ↑/↓/↵ walk and rewind the history rather than the outline.
  if (state.showHistory) return "history";
  // The review is a read-only panel; it owns the keyboard so esc closes it
  // rather than unwinding whatever sits beneath.
  if (state.showReview) return "review";
  if (state.showPalette) return "palette";
  // The schedule picker owns the keyboard while open (it has no app bindings),
  // so normal/editing shortcuts stay dormant beneath it.
  if (state.showSchedule) return "schedule";
  // Likewise the project picker.
  if (state.showProject) return "project";
  // Likewise the estimate picker.
  if (state.showEstimate) return "estimate";
  // Likewise the "add to calendar" picker.
  if (state.showCalendar) return "calendar";
  // Likewise the repeat picker.
  if (state.showRepeat) return "repeat";
  if (isInteractiveElementFocused()) return "editing";
  // The reckoning gate owns the keyboard while any leftover remains. Its two
  // presentations share the gate but bind keys differently: the spatial board
  // has its own context ("board"), the card review the classic one.
  if (state.reckoningActive) return state.boardMode ? "board" : "reckoning";
  // Shutdown sits *below* the gate on purpose: you can't close tonight while
  // yesterday is still unresolved, so the Reckoning always wins the keyboard.
  if (state.shutdownActive) return "shutdown";
  if (state.planActive) return "plan";
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

      // Let text fields keep native undo/redo while focused. ⌘⇧z normalizes to
      // "Meta+Z" — `toCombo` folds shift into the letter's case for single chars.
      if (combo === "Meta+z" || combo === "Meta+Z") {
        const tag = document.activeElement?.tagName;
        if (tag === "TEXTAREA" || tag === "INPUT") return;
      }

      const binding = findBinding(keymap, combo, context);
      if (binding == null) return;

      // Swallow auto-repeat for one-shot bindings (e.g. trash): holding the key
      // would otherwise re-fire the action on each repeat. preventDefault too, so
      // the held key can't trigger any native behavior on the repeats.
      if (e.repeat && binding.noRepeat) {
        e.preventDefault();
        return;
      }

      const handler = actionMap[binding.action];
      if (handler == null) return;

      e.preventDefault();
      handler(dispatch);
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [keymap, actionMap, dispatch]);
}
