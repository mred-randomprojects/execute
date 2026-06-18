import { useEffect, useMemo, useRef, useState } from "react";
import type { TaskId, ThemeName } from "./types";
import {
  addChild,
  addTaskAfter,
  deleteTask,
  indent,
  initStore,
  markOpened,
  moveAsChild,
  moveBefore,
  outdent,
  setCompleted,
  setDevDateOverride,
  setPlannedFor,
  setPriority,
  setText,
  setTheme,
  toggleComplete,
  undo,
  useStore,
} from "./store/store";
import { findById, findParentId } from "./store/tasks";
import { todayISO } from "./store/dates";
import { parseCapture } from "./store/capture";
import {
  backlogCount,
  flattenRows,
  leftoverLeaves,
  todayProgress,
  viewTasks,
  type ViewKind,
} from "./selectors";
import { keymap } from "./keyboard/keymap";
import { useKeyboard } from "./keyboard/useKeyboard";
import type { AppMode, ContextState } from "./keyboard/types";
import { EditorProvider, type Editor } from "./ui/editor";
import { Sidebar } from "./components/Sidebar";
import { OutlineView } from "./views/OutlineView";
import { ReckoningView } from "./views/ReckoningView";
import { HelpOverlay } from "./components/HelpOverlay";
import { DevControls } from "./components/DevControls";
import { StatusBar } from "./components/StatusBar";
import { CommandPalette, type Command } from "./components/CommandPalette";

const THEMES: ThemeName[] = ["slate", "ivory", "carbon", "bordeaux"];

export function App() {
  const { state, ready } = useStore();
  // Re-render every minute so a real midnight rollover is noticed.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const today = todayISO(state.devDateOverride);

  // ── UI state ──────────────────────────────────────────────────────
  const [view, setView] = useState<ViewKind>("today");
  const [cursorId, setCursorId] = useState<TaskId | null>(null);
  const [editingId, setEditingId] = useState<TaskId | null>(null);
  const [collapsed, setCollapsed] = useState<Set<TaskId>>(new Set());
  const [mode, setMode] = useState<AppMode>("normal");
  const [movingId, setMovingId] = useState<TaskId | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [reckCursorId, setReckCursorId] = useState<TaskId | null>(null);
  const [breakingDownId, setBreakingDownId] = useState<TaskId | null>(null);

  const captureRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void initStore();
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", state.theme);
  }, [state.theme]);

  useEffect(() => {
    if (ready) markOpened(today);
  }, [ready, today]);

  // ── Reckoning (the hard gate) ─────────────────────────────────────
  const leftovers = useMemo(
    () => leftoverLeaves(state.tasks, today),
    [state.tasks, today]
  );
  const reckoningActive = ready && leftovers.length > 0;
  const breakdownTask =
    breakingDownId != null ? findById(state.tasks, breakingDownId) ?? null : null;

  const leftoverKey = leftovers.map((t) => t.id).join(",");
  useEffect(() => {
    if (!reckoningActive) {
      if (reckCursorId !== null) setReckCursorId(null);
      return;
    }
    const ids = leftovers.map((t) => t.id);
    if (reckCursorId === null || !ids.includes(reckCursorId)) {
      setReckCursorId(ids[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftoverKey, reckoningActive]);

  useEffect(() => {
    if (breakingDownId != null && findById(state.tasks, breakingDownId) == null) {
      setBreakingDownId(null);
    }
  }, [state.tasks, breakingDownId]);

  // ── Derived (outline) ─────────────────────────────────────────────
  const filtered = useMemo(
    () => viewTasks(state.tasks, view, today),
    [state.tasks, view, today]
  );
  const rows = useMemo(() => flattenRows(filtered, collapsed), [filtered, collapsed]);
  const flatIds = useMemo(() => rows.map((r) => r.task.id), [rows]);
  const flatKey = flatIds.join(",");

  const progress = useMemo(
    () => todayProgress(state.tasks, today),
    [state.tasks, today]
  );
  const backlog = useMemo(() => backlogCount(state.tasks), [state.tasks]);

  useEffect(() => {
    if (flatIds.length === 0) {
      if (cursorId !== null) setCursorId(null);
      return;
    }
    if (cursorId === null || !flatIds.includes(cursorId)) setCursorId(flatIds[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatKey]);

  useEffect(() => {
    if (editingId !== null && !flatIds.includes(editingId)) setEditingId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatKey]);

  // ── Helpers ───────────────────────────────────────────────────────
  const indexOfCursor = () => (cursorId == null ? -1 : flatIds.indexOf(cursorId));
  const defaultPlannedFor = () => (view === "today" ? today : null);

  const toggleCollapsedFor = (id: TaskId) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exitMove = () => {
    setMode("normal");
    setMovingId(null);
  };

  const planToggle = (id: TaskId) => {
    const t = findById(state.tasks, id);
    setPlannedFor(id, t?.plannedFor === today ? null : today);
  };

  const removeWithNeighbor = (id: TaskId) => {
    const i = flatIds.indexOf(id);
    const neighbor = flatIds[i - 1] ?? flatIds[i + 1] ?? null;
    deleteTask(id);
    setCursorId(neighbor);
  };

  // ── Commands (shared by keyboard + mouse) ─────────────────────────
  const cmd = {
    cursorDown: () => {
      if (reckoningActive) {
        const ids = leftovers.map((t) => t.id);
        if (ids.length === 0) return;
        const i = reckCursorId == null ? -1 : ids.indexOf(reckCursorId);
        setReckCursorId(ids[i < 0 ? 0 : Math.min(i + 1, ids.length - 1)]);
        return;
      }
      if (flatIds.length === 0) return;
      const i = indexOfCursor();
      setCursorId(flatIds[i < 0 ? 0 : Math.min(i + 1, flatIds.length - 1)]);
    },
    cursorUp: () => {
      if (reckoningActive) {
        const ids = leftovers.map((t) => t.id);
        if (ids.length === 0) return;
        const i = reckCursorId == null ? -1 : ids.indexOf(reckCursorId);
        setReckCursorId(ids[i < 0 ? 0 : Math.max(i - 1, 0)]);
        return;
      }
      if (flatIds.length === 0) return;
      const i = indexOfCursor();
      setCursorId(flatIds[i < 0 ? 0 : Math.max(i - 1, 0)]);
    },
    navLeft: () => {
      if (cursorId == null) return;
      const t = findById(filtered, cursorId);
      if (t != null && t.children.length > 0 && !collapsed.has(cursorId)) {
        toggleCollapsedFor(cursorId);
        return;
      }
      const parent = findParentId(filtered, cursorId);
      if (parent != null) setCursorId(parent);
    },
    navRight: () => {
      if (cursorId == null) return;
      const t = findById(filtered, cursorId);
      if (t == null || t.children.length === 0) return;
      if (collapsed.has(cursorId)) toggleCollapsedFor(cursorId);
      else setCursorId(t.children[0].id);
    },
    editStart: () => {
      if (cursorId != null) setEditingId(cursorId);
    },
    taskNew: () => {
      const newId = addTaskAfter(cursorId, "", defaultPlannedFor());
      setCursorId(newId);
      setEditingId(newId);
    },
    taskToggle: () => {
      if (cursorId != null) toggleComplete(cursorId);
    },
    taskPlanToday: () => {
      if (cursorId != null) planToggle(cursorId);
    },
    taskIndent: () => {
      if (cursorId != null) indent(cursorId);
    },
    taskOutdent: () => {
      if (cursorId != null) outdent(cursorId);
    },
    taskDelete: () => {
      if (cursorId != null) removeWithNeighbor(cursorId);
    },
    taskCollapse: () => {
      if (cursorId == null) return;
      const t = findById(filtered, cursorId);
      if (t != null && t.children.length > 0) toggleCollapsedFor(cursorId);
    },
    setPrio: (p: 1 | 2 | 3 | 4) => () => {
      if (cursorId != null) setPriority(cursorId, p);
    },
    moveEnter: () => {
      if (cursorId != null) {
        setMovingId(cursorId);
        setMode("move");
      }
    },
    moveDropSibling: () => {
      if (movingId != null && cursorId != null) moveBefore(movingId, cursorId);
      exitMove();
    },
    moveDropChild: () => {
      if (movingId != null && cursorId != null) moveAsChild(movingId, cursorId);
      exitMove();
    },
    captureFocus: () => captureRef.current?.focus(),
    helpToggle: () => setShowHelp((v) => !v),
    paletteOpen: () => setShowPalette(true),
    gotoView: (v: ViewKind) => () => setView(v),
    dismiss: () => {
      if (showHelp) setShowHelp(false);
      else if (showPalette) setShowPalette(false);
      else if (mode === "move") exitMove();
      else if (editingId != null) setEditingId(null);
      // Note: does NOT dismiss the reckoning gate — it's a hard gate.
    },
    // reckoning
    reckComplete: () => {
      if (reckCursorId != null) setCompleted(reckCursorId, true);
    },
    reckBacklog: () => {
      if (reckCursorId != null) setPlannedFor(reckCursorId, null);
    },
    reckDrop: () => {
      if (reckCursorId != null) deleteTask(reckCursorId);
    },
    reckBreakdown: () => {
      if (reckCursorId != null) setBreakingDownId(reckCursorId);
    },
  };

  // ── Keyboard wiring ───────────────────────────────────────────────
  const dispatchState: ContextState = {
    showHelp,
    showPalette,
    reckoningActive,
    mode,
  };

  const actionMap: Record<string, () => void> = {
    "cursor.down": cmd.cursorDown,
    "cursor.up": cmd.cursorUp,
    "nav.left": cmd.navLeft,
    "nav.right": cmd.navRight,
    "edit.start": cmd.editStart,
    "task.new": cmd.taskNew,
    "task.toggle": cmd.taskToggle,
    "task.planToday": cmd.taskPlanToday,
    "task.indent": cmd.taskIndent,
    "task.outdent": cmd.taskOutdent,
    "task.delete": cmd.taskDelete,
    "task.collapse": cmd.taskCollapse,
    "priority.1": cmd.setPrio(1),
    "priority.2": cmd.setPrio(2),
    "priority.3": cmd.setPrio(3),
    "priority.4": cmd.setPrio(4),
    "move.enter": cmd.moveEnter,
    "move.dropSibling": cmd.moveDropSibling,
    "move.dropChild": cmd.moveDropChild,
    "move.cancel": cmd.dismiss,
    "capture.focus": cmd.captureFocus,
    "undo": undo,
    "help.toggle": cmd.helpToggle,
    "palette.open": cmd.paletteOpen,
    "view.today": cmd.gotoView("today"),
    "view.backlog": cmd.gotoView("backlog"),
    "view.all": cmd.gotoView("all"),
    "dismiss": cmd.dismiss,
    "reck.complete": cmd.reckComplete,
    "reck.breakdown": cmd.reckBreakdown,
    "reck.backlog": cmd.reckBacklog,
    "reck.drop": cmd.reckDrop,
  };

  useKeyboard(keymap, actionMap, dispatchState);

  // ── Editor surface for rows ───────────────────────────────────────
  const editor: Editor = {
    view,
    today,
    cursorId,
    editingId,
    collapsed,
    mode,
    movingId,
    select: (id) => setCursorId(id),
    toggle: (id) => toggleComplete(id),
    togglePlan: planToggle,
    toggleCollapse: toggleCollapsedFor,
    startEdit: (id) => {
      setCursorId(id);
      setEditingId(id);
    },
    commit: (id, raw) => {
      const p = parseCapture(raw);
      setText(id, p.text);
      if (p.completed) setCompleted(id, true);
    },
    commitAndNew: (id, raw) => {
      const p = parseCapture(raw);
      if (p.text === "") {
        removeWithNeighbor(id);
        setEditingId(null);
        return;
      }
      setText(id, p.text);
      if (p.completed) setCompleted(id, true);
      const t = findById(state.tasks, id);
      const newId = addTaskAfter(id, "", t?.plannedFor ?? null);
      setCursorId(newId);
      setEditingId(newId);
    },
    indentEditing: (id, raw) => {
      const p = parseCapture(raw);
      setText(id, p.text);
      if (p.completed) setCompleted(id, true);
      indent(id);
    },
    outdentEditing: (id, raw) => {
      const p = parseCapture(raw);
      setText(id, p.text);
      if (p.completed) setCompleted(id, true);
      outdent(id);
    },
    exitEdit: (id, raw) => {
      const p = parseCapture(raw);
      setText(id, p.text);
      if (p.completed) setCompleted(id, true);
      setEditingId(null);
    },
    removeAndExit: (id) => {
      removeWithNeighbor(id);
      setEditingId(null);
    },
  };

  const onCapture = (raw: string) => {
    const p = parseCapture(raw);
    if (p.text === "") return;
    const id = addTaskAfter(null, p.text, defaultPlannedFor());
    if (p.completed) setCompleted(id, true);
    setCursorId(id);
  };

  const cycleTheme = () => {
    const i = THEMES.indexOf(state.theme);
    setTheme(THEMES[(i + 1) % THEMES.length]);
  };

  const commands: Command[] = [
    { id: "today", label: "Go to Today", hint: "⌘1", run: () => setView("today") },
    { id: "backlog", label: "Go to Backlog", hint: "⌘2", run: () => setView("backlog") },
    { id: "all", label: "Go to All", hint: "⌘3", run: () => setView("all") },
    { id: "new", label: "New task", hint: "o", run: cmd.taskNew },
    { id: "toggle", label: "Complete / uncomplete task", hint: "space", run: cmd.taskToggle },
    { id: "plan", label: "Plan / unplan for today", hint: "t", run: cmd.taskPlanToday },
    { id: "move", label: "Move task", hint: "m", run: cmd.moveEnter },
    { id: "undo", label: "Undo", hint: "⌘z", run: undo },
    { id: "help", label: "Keyboard help", hint: "?", run: () => setShowHelp(true) },
    { id: "theme-slate", label: "Theme: Slate", run: () => setTheme("slate") },
    { id: "theme-ivory", label: "Theme: Ivory", run: () => setTheme("ivory") },
    { id: "theme-carbon", label: "Theme: Carbon", run: () => setTheme("carbon") },
    { id: "theme-bordeaux", label: "Theme: Bordeaux", run: () => setTheme("bordeaux") },
  ];

  if (!ready) {
    return <div className="grid h-full place-items-center bg-bg text-ink-faint" />;
  }

  return (
    <div className="relative flex h-full overflow-hidden bg-bg text-ink">
      {/* Draggable strip under the macOS traffic lights (hiddenInset titlebar). */}
      <div className="drag-region absolute inset-x-0 top-0 z-20 h-7" />

      <Sidebar
        view={view}
        todayRemaining={progress.remaining}
        backlog={backlog}
        onSelect={setView}
        onOpenHelp={() => setShowHelp(true)}
        onCycleTheme={cycleTheme}
      >
        {import.meta.env.DEV && (
          <DevControls
            today={today}
            override={state.devDateOverride}
            onSet={setDevDateOverride}
          />
        )}
      </Sidebar>

      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-hidden">
          {reckoningActive ? (
            <ReckoningView
              leftovers={leftovers}
              cursorId={reckCursorId}
              today={today}
              breakdownTask={breakdownTask}
              onSelect={setReckCursorId}
              onComplete={(id) => setCompleted(id, true)}
              onBacklog={(id) => setPlannedFor(id, null)}
              onDrop={(id) => deleteTask(id)}
              onStartBreakdown={(id) => setBreakingDownId(id)}
              onAddStep={(parentId, text) =>
                addChild(parentId, parseCapture(text).text, today)
              }
              onFinishBreakdown={() => setBreakingDownId(null)}
            />
          ) : (
            <EditorProvider value={editor}>
              <OutlineView
                view={view}
                today={today}
                filtered={filtered}
                progress={progress}
                captureRef={captureRef}
                onAdd={onCapture}
              />
            </EditorProvider>
          )}
        </div>
        <StatusBar reckoning={reckoningActive} />
      </main>

      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
      {showPalette && (
        <CommandPalette commands={commands} onClose={() => setShowPalette(false)} />
      )}
    </div>
  );
}
