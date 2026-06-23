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
  selectedIds: TaskId[];
  editingId: TaskId | null;
  collapsed: Set<TaskId>;
  mode: AppMode;
  movingId: TaskId | null;

  select: (id: TaskId) => void;
  toggle: (id: TaskId) => void;
  togglePlan: (id: TaskId) => void;
  toggleCollapse: (id: TaskId) => void;
  startEdit: (id: TaskId) => void;
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
}

const EditorContext = createContext<Editor | null>(null);

export const EditorProvider = EditorContext.Provider;

export function useEditor(): Editor {
  const ctx = useContext(EditorContext);
  if (ctx == null) throw new Error("useEditor must be used within EditorProvider");
  return ctx;
}
