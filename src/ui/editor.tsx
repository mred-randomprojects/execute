import { createContext, useContext } from "react";
import type { ISODate, TaskId } from "../types";
import type { AppMode } from "../keyboard/types";
import type { ViewKind } from "../selectors";

/**
 * Interaction surface shared by the outline rows. State lives in App; rows and
 * the keyboard action map both drive it through these handlers, so there is one
 * source of truth for every interaction (mouse and keyboard agree).
 */
export interface Editor {
  view: ViewKind;
  today: ISODate;
  cursorId: TaskId | null;
  editingId: TaskId | null;
  collapsed: Set<TaskId>;
  mode: AppMode;
  movingId: TaskId | null;

  select: (id: TaskId) => void;
  toggle: (id: TaskId) => void;
  togglePlan: (id: TaskId) => void;
  toggleCollapse: (id: TaskId) => void;
  startEdit: (id: TaskId) => void;

  // Inline-edit input callbacks (raw = current input value, parsed on commit).
  commit: (id: TaskId, raw: string) => void;
  commitAndNew: (id: TaskId, raw: string) => void;
  indentEditing: (id: TaskId, raw: string) => void;
  outdentEditing: (id: TaskId, raw: string) => void;
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
