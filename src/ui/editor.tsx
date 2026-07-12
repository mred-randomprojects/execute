import { createContext, useContext } from "react";
import type { ISODate, TaskId } from "../types";
import type { AppMode } from "../keyboard/types";
import type { ViewKind } from "../selectors";

/**
 * Interaction surface for the outline rows. Titles are edited *inline in the
 * row*; the side panel handles the longer content/notes. State lives in App;
 * rows and the keyboard action map both drive it through these handlers, so
 * mouse and keyboard always agree.
 */
export interface Editor {
  view: ViewKind;
  today: ISODate;
  /** True in the by-date "Later" layout, where the bucket header already says the horizon. */
  bucketed: boolean;
  cursorId: TaskId | null;
  /** The "right now" task, highlighted with a marker. `null` when none is set. */
  currentId: TaskId | null;
  selectedIds: TaskId[];
  editingId: TaskId | null;
  /** Task whose "won't do" reason is being captured inline (empty field). */
  reasonEditId: TaskId | null;
  /** Task peeked in place (`p`): full unwrapped title + notes under the row. */
  peekId: TaskId | null;
  collapsed: Set<TaskId>;
  mode: AppMode;
  movingId: TaskId | null;

  select: (id: TaskId) => void;
  /** Cmd/Ctrl-click: toggle this row in/out of a discontiguous multi-selection. */
  toggleSelect: (id: TaskId) => void;
  /** Shift-click: extend the selection as a range from the anchor to this row. */
  rangeSelect: (id: TaskId) => void;
  toggle: (id: TaskId) => void;
  /** Clear a "won't do" back to open (clicking the ✕ checkbox). */
  reopen: (id: TaskId) => void;
  toggleCollapse: (id: TaskId) => void;
  startEdit: (id: TaskId) => void;
  /** Toggle the in-place peek (the ¶ glyph / `p`). Selects the row too. */
  togglePeek: (id: TaskId) => void;
  /** Begin editing the "won't do" reason inline (on an already-skipped task). */
  startReason: (id: TaskId) => void;
  openDetail: (id: TaskId) => void;
  zoomInto: (id: TaskId) => void;

  // Inline-edit input callbacks (raw = current input value, parsed on commit).
  commit: (id: TaskId, raw: string) => void;
  indentEditing: (id: TaskId, raw: string) => void;
  outdentEditing: (id: TaskId, raw: string) => void;
  // ↑/↓ in an input: save, leave edit mode, and move focus one row in normal
  // mode (so panel/collapse keys work immediately on the landing row).
  exitUp: (id: TaskId, raw: string) => void;
  exitDown: (id: TaskId, raw: string) => void;
  toggleFromEdit: (id: TaskId, raw: string) => void;
  exitEdit: (id: TaskId, raw: string) => void;
  removeAndExit: (id: TaskId) => void;

  // Inline "won't do" reason field: save the typed reason (empty saves none). The
  // task stays "won't do" regardless of whether a reason is given.
  commitReason: (id: TaskId, reason: string) => void;
}

const EditorContext = createContext<Editor | null>(null);

export const EditorProvider = EditorContext.Provider;

export function useEditor(): Editor {
  const ctx = useContext(EditorContext);
  if (ctx == null) throw new Error("useEditor must be used within EditorProvider");
  return ctx;
}
