import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act } from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { App } from "./App";
import { createProject, initStore, setDevDateOverride } from "./store/store";
import { addDays, todayISO } from "./store/dates";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
// Reset the singleton store to empty between tests for full isolation.
beforeEach(async () => {
  localStorage.clear();
  await initStore();
});

describe("App integration", () => {
  it("captures a task in Today and completes it", async () => {
    render(<App />);

    const input = await screen.findByPlaceholderText("Add a task for today…");
    fireEvent.change(input, { target: { value: "write the readme" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText("write the readme")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Mark complete"));
    await waitFor(() =>
      expect(screen.getByLabelText("Mark incomplete")).toBeTruthy()
    );
  });

  it("captures a completed task via [x] markdown", async () => {
    render(<App />);
    const input = await screen.findByPlaceholderText("Add a task for today…");
    fireEvent.change(input, { target: { value: "[x] already done" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText("already done")).toBeTruthy();
    // A completed task exposes the "Mark incomplete" affordance.
    await waitFor(() =>
      expect(screen.getByLabelText("Mark incomplete")).toBeTruthy()
    );
  });

  it("completes the cursor task with the space key", async () => {
    render(<App />);
    const input = await screen.findByPlaceholderText("Add a task for today…");
    fireEvent.change(input, { target: { value: "keyboard task" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("keyboard task");

    (input as HTMLInputElement).blur(); // leave the capture bar → normal context
    fireEvent.keyDown(document.body, { key: " " });

    await waitFor(() =>
      expect(screen.getByLabelText("Mark incomplete")).toBeTruthy()
    );
  });

  it("unplanning with 't' removes the task from Today", async () => {
    render(<App />);
    const input = await screen.findByPlaceholderText("Add a task for today…");
    fireEvent.change(input, { target: { value: "planned today" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("planned today");

    (input as HTMLInputElement).blur();
    fireEvent.keyDown(document.body, { key: "t" });

    await waitFor(() => expect(screen.queryByText("planned today")).toBeNull());
  });

  it("disables browser spellcheck on editable fields", async () => {
    render(<App />);
    const capture = await screen.findByPlaceholderText("Add a task for today…");
    expect(capture.getAttribute("spellcheck")).toBe("false");
    expect(capture.getAttribute("autocorrect")).toBe("off");

    fireEvent.change(capture, { target: { value: "mispelled wrd" } });
    fireEvent.keyDown(capture, { key: "Enter" });
    await screen.findByText("mispelled wrd");
    blurActive();

    fireEvent.keyDown(document.body, { key: "Enter" });
    const titleInput = await screen.findByDisplayValue("mispelled wrd");
    expect(titleInput.getAttribute("spellcheck")).toBe("false");
    expect(titleInput.getAttribute("autocorrect")).toBe("off");
    fireEvent.keyDown(titleInput, { key: "Escape" });

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    const notes = await screen.findByPlaceholderText(NOTES_PLACEHOLDER);
    expect(notes.getAttribute("spellcheck")).toBe("false");
    expect(notes.getAttribute("autocorrect")).toBe("off");
    fireEvent.keyDown(notes, { key: "Escape" });

    fireEvent.keyDown(document.body, { key: "k", metaKey: true });
    const palette = await screen.findByPlaceholderText("Type a command…");
    expect(palette.getAttribute("spellcheck")).toBe("false");
    expect(palette.getAttribute("autocorrect")).toBe("off");
  });
});

describe("The Reckoning (rollover ritual)", () => {
  async function seedTodayTaskThenRollOver(text: string) {
    render(<App />);
    const input = await screen.findByPlaceholderText("Add a task for today…");
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText(text);
    // Advance a day → yesterday's unfinished task is now a leftover.
    act(() => setDevDateOverride(addDays(todayISO(null), 1)));
    expect(await screen.findByText("Unfinished from before today")).toBeTruthy();
  }

  it("blocks Today with the gate until the leftover is completed", async () => {
    await seedTodayTaskThenRollOver("ship the thing");
    expect(screen.getByText("ship the thing")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Done"));

    await waitFor(() =>
      expect(screen.queryByText("Unfinished from before today")).toBeNull()
    );
  });

  it("resolves a leftover by breaking it into a smaller step for today", async () => {
    await seedTodayTaskThenRollOver("write the book");

    fireEvent.click(screen.getByLabelText("Break down"));
    const stepInput = await screen.findByPlaceholderText(
      "A small step you'll finish today…"
    );
    fireEvent.change(stepInput, { target: { value: "write chapter 1 outline" } });
    fireEvent.keyDown(stepInput, { key: "Enter" }); // add step
    fireEvent.keyDown(stepInput, { key: "Enter" }); // empty → finish

    await waitFor(() =>
      expect(screen.queryByText("Unfinished from before today")).toBeNull()
    );
    // The smaller step now lives in Today.
    expect(await screen.findByText("write chapter 1 outline")).toBeTruthy();
  });

  it("can send a leftover to the backlog to clear the gate", async () => {
    await seedTodayTaskThenRollOver("maybe later task");
    fireEvent.click(screen.getByLabelText("Backlog"));
    await waitFor(() =>
      expect(screen.queryByText("Unfinished from before today")).toBeNull()
    );
  });

  it("keeps a leftover for today, clearing the gate and re-listing it in Today", async () => {
    await seedTodayTaskThenRollOver("revise the draft");
    fireEvent.click(screen.getByLabelText("Keep for today"));
    await waitFor(() =>
      expect(screen.queryByText("Unfinished from before today")).toBeNull()
    );
    expect(await screen.findByText("revise the draft")).toBeTruthy();
  });

  it("a kept leftover returns tagged 'carried' if still unfinished the next day", async () => {
    await seedTodayTaskThenRollOver("revise the draft");
    fireEvent.click(screen.getByLabelText("Keep for today"));
    await waitFor(() =>
      expect(screen.queryByText("Unfinished from before today")).toBeNull()
    );
    // Advance another day without finishing → it reckons again, now carried once.
    act(() => setDevDateOverride(addDays(todayISO(null), 2)));
    expect(await screen.findByText("Unfinished from before today")).toBeTruthy();
    expect(screen.getByText(/carried 1×/)).toBeTruthy();
  });

  it("keeps the capture front door open during the gate (new task → today)", async () => {
    await seedTodayTaskThenRollOver("ship the thing");
    blurActive();

    // '/' focuses the always-present capture bar, even mid-Reckoning.
    fireEvent.keyDown(document.body, { key: "/" });
    const capture = screen.getByPlaceholderText("Add a task for today…");
    expect(document.activeElement).toBe(capture);

    fireEvent.change(capture, { target: { value: "remembered errand" } });
    fireEvent.keyDown(capture, { key: "Enter" });

    // Capturing neither cleared nor lengthened the gate.
    expect(screen.getByText("Unfinished from before today")).toBeTruthy();
    expect(screen.getByText("ship the thing")).toBeTruthy();

    // Clear the gate → the dump is waiting in Today.
    fireEvent.click(screen.getByLabelText("Done"));
    await waitFor(() =>
      expect(screen.queryByText("Unfinished from before today")).toBeNull()
    );
    expect(await screen.findByText("remembered errand")).toBeTruthy();
  });

  it("shows a stranded subtask under its top-level parent in the card", async () => {
    render(<App />);
    await addTask("kitchen reno");
    await addTask("order tiles");
    blurActive();
    fireEvent.keyDown(document.body, { key: "Tab" }); // nest "order tiles" under "kitchen reno"
    act(() => setDevDateOverride(addDays(todayISO(null), 1)));
    expect(await screen.findByText("Unfinished from before today")).toBeTruthy();

    // The card surfaces both the parent (context) and the stranded child.
    expect(screen.getByText("kitchen reno")).toBeTruthy();
    expect(screen.getByText("order tiles")).toBeTruthy();

    // Resolving the only leftover leaf clears the whole card.
    fireEvent.click(screen.getByLabelText("Done"));
    await waitFor(() =>
      expect(screen.queryByText("Unfinished from before today")).toBeNull()
    );
  });
});

async function addTask(text: string) {
  const input = await screen.findByPlaceholderText("Add a task for today…");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
  await screen.findByText(text);
}

function blurActive() {
  (document.activeElement as HTMLElement | null)?.blur();
}

describe("Trash", () => {
  it("Backspace trashes a task; Trash view restores it", async () => {
    render(<App />);
    await addTask("disposable");
    blurActive();

    fireEvent.keyDown(document.body, { key: "Backspace" });
    await waitFor(() => expect(screen.queryByText("disposable")).toBeNull());

    fireEvent.keyDown(document.body, { key: "5" }); // Trash view
    expect(await screen.findByText("disposable")).toBeTruthy();

    fireEvent.click(screen.getByText("Restore"));
    fireEvent.keyDown(document.body, { key: "3" }); // All view
    expect(await screen.findByText("disposable")).toBeTruthy();
  });

  it("confirms before deleting a task that has subtasks", async () => {
    render(<App />);
    await addTask("parent");
    await addTask("child");
    blurActive();
    fireEvent.keyDown(document.body, { key: "Tab" }); // child → subtask of parent
    fireEvent.keyDown(document.body, { key: "ArrowUp" }); // focus parent

    // Backspace on a task with subtasks asks first — nothing is gone yet.
    fireEvent.keyDown(document.body, { key: "Backspace" });
    expect(await screen.findByText("Delete this task and its subtasks?")).toBeTruthy();
    expect(screen.getByText("parent")).toBeTruthy();

    // Confirm with Enter → the whole subtree goes to Trash.
    fireEvent.keyDown(screen.getByText("Delete"), { key: "Enter" });
    await waitFor(() => {
      expect(screen.queryByText("parent")).toBeNull();
      expect(screen.queryByText("child")).toBeNull();
    });
  });

  it("keeps the task when the delete confirmation is cancelled", async () => {
    render(<App />);
    await addTask("keep me");
    await addTask("sub");
    blurActive();
    fireEvent.keyDown(document.body, { key: "Tab" }); // sub → subtask of keep me
    fireEvent.keyDown(document.body, { key: "ArrowUp" }); // focus keep me

    fireEvent.keyDown(document.body, { key: "Backspace" });
    const dialog = await screen.findByText("Delete this task and its subtasks?");
    fireEvent.keyDown(dialog, { key: "Escape" }); // cancel

    await waitFor(() =>
      expect(screen.queryByText("Delete this task and its subtasks?")).toBeNull()
    );
    expect(screen.getByText("keep me")).toBeTruthy();
  });
});

describe("Trivial editing", () => {
  it("ArrowUp while editing saves, leaves edit mode, and focuses the previous task", async () => {
    render(<App />);
    await addTask("first");
    await addTask("second");
    blurActive();

    fireEvent.keyDown(document.body, { key: "Enter" }); // edit focused (second)
    const editingSecond = await screen.findByDisplayValue("second");
    fireEvent.change(editingSecond, { target: { value: "second edited" } });
    fireEvent.keyDown(editingSecond, { key: "ArrowUp" });

    // The edit is saved and we drop out of edit mode (no inline input left).
    expect(await screen.findByText("second edited")).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByDisplayValue("second edited")).toBeNull()
    );
    expect(screen.queryByPlaceholderText("Task…")).toBeNull();

    // Focus landed on "first" in normal mode — Enter now edits it.
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(await screen.findByDisplayValue("first")).toBeTruthy();
  });

  it("discards a new untitled task when you move off it (Escape)", async () => {
    render(<App />);
    await addTask("anchor");
    blurActive();

    fireEvent.keyDown(document.body, { key: "o" }); // new empty task below
    const empty = await screen.findByPlaceholderText("Task…");
    fireEvent.keyDown(empty, { key: "Escape" }); // leave it untitled

    await waitFor(() => expect(screen.queryByText("Untitled")).toBeNull());
    expect(screen.getByText("anchor")).toBeTruthy();
  });
});

describe("Indent respects the filtered view", () => {
  it("Tab nests under the previous *visible* task, not one the view is hiding", async () => {
    render(<App />);
    // Today view: three sibling tasks, all planned for today.
    await addTask("first");
    await addTask("mid");
    await addTask("second");
    blurActive();

    // Unplan the middle one so it drops out of Today — now hidden *between* the
    // two visible tasks. This is the trap: "second"'s raw previous sibling is
    // the hidden "mid".
    fireEvent.keyDown(document.body, { key: "ArrowUp" }); // second → mid
    fireEvent.keyDown(document.body, { key: "t" }); // unplan mid
    await waitFor(() => expect(screen.queryByText("mid")).toBeNull());

    // Focus reconciles to the project header; descend to "second" and indent.
    fireEvent.keyDown(document.body, { key: "ArrowDown" }); // header → first
    fireEvent.keyDown(document.body, { key: "ArrowDown" }); // first → second
    fireEvent.keyDown(document.body, { key: "Tab" });

    // It nested under the visible "first" (which now shows a 0/1 child count),
    // and the hidden "mid" never resurfaces as a surprise parent.
    expect(await screen.findByText("0/1")).toBeTruthy();
    expect(screen.queryByText("mid")).toBeNull();
    expect(screen.getByText("second")).toBeTruthy();
  });
});

describe("Reorder", () => {
  it("Cmd+ArrowUp moves the focused task up", async () => {
    render(<App />);
    await addTask("a");
    await addTask("b"); // focused = b, order a,b
    blurActive();

    fireEvent.keyDown(document.body, { key: "ArrowUp", metaKey: true });

    const a = screen.getByText("a");
    const b = screen.getByText("b");
    // After moving b up, b precedes a in the document.
    expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("⌘↓ hops over a task the view is hiding instead of an invisible no-op", async () => {
    render(<App />);
    await addTask("first");
    await addTask("mid");
    await addTask("second");
    blurActive();

    // Hide "mid" between the two visible tasks (raw order: first, mid, second).
    fireEvent.keyDown(document.body, { key: "ArrowUp" }); // second → mid
    fireEvent.keyDown(document.body, { key: "t" }); // unplan mid
    await waitFor(() => expect(screen.queryByText("mid")).toBeNull());

    // Focus "first" and move it down. The raw next sibling is the hidden "mid";
    // view-aware reorder must move it past the visible "second" instead.
    fireEvent.keyDown(document.body, { key: "ArrowDown" }); // header → first
    fireEvent.keyDown(document.body, { key: "ArrowDown", metaKey: true }); // reorder down

    await waitFor(() => {
      const first = screen.getByText("first");
      const second = screen.getByText("second");
      // "first" now follows "second" in the document.
      expect(
        second.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });
    expect(screen.queryByText("mid")).toBeNull();
  });
});

describe("Multi-select", () => {
  it("Shift+ArrowDown selects a range and Backspace trashes all of it", async () => {
    render(<App />);
    await addTask("one");
    await addTask("two");
    await addTask("three"); // order: one, two, three; focus = three
    blurActive();

    fireEvent.keyDown(document.body, { key: "ArrowUp" }); // → two
    fireEvent.keyDown(document.body, { key: "ArrowUp" }); // → one
    fireEvent.keyDown(document.body, { key: "ArrowDown", shiftKey: true }); // one..two

    fireEvent.keyDown(document.body, { key: "Backspace" });
    await waitFor(() => {
      expect(screen.queryByText("one")).toBeNull();
      expect(screen.queryByText("two")).toBeNull();
    });
    expect(screen.getByText("three")).toBeTruthy();
  });
});

describe("Detail panel", () => {
  it("opens with the right arrow and edits notes", async () => {
    render(<App />);
    await addTask("with notes");
    blurActive();

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    const notes = await screen.findByPlaceholderText(
      "Add details, links, context… (markdown supported)"
    );
    fireEvent.change(notes, { target: { value: "some detail" } });
    expect((notes as HTMLTextAreaElement).value).toBe("some detail");
  });

  it("shows a created timestamp", async () => {
    render(<App />);
    await addTask("stamped");
    blurActive();
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(await screen.findByText(/^Created /)).toBeTruthy();
  });
});

describe("Markdown", () => {
  it("renders inline code in a task title", async () => {
    render(<App />);
    const input = await screen.findByPlaceholderText("Add a task for today…");
    fireEvent.change(input, { target: { value: "use `int` here" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const code = await screen.findByText("int");
    expect(code.tagName).toBe("CODE");
  });
});

describe("Capture ↔ list navigation", () => {
  it("ArrowDown in the capture bar moves into the list", async () => {
    render(<App />);
    await addTask("alpha");
    const input = screen.getByPlaceholderText("Add a task for today…");
    input.focus();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(document.body, { key: "ArrowDown" }); // project row → first task

    fireEvent.keyDown(document.body, { key: " " }); // complete focused task
    await waitFor(() =>
      expect(screen.getByLabelText("Mark incomplete")).toBeTruthy()
    );
  });

  it("ArrowUp at the top of the list focuses the capture bar", async () => {
    render(<App />);
    await addTask("top");
    blurActive();
    fireEvent.keyDown(document.body, { key: "ArrowUp" }); // task → project row
    fireEvent.keyDown(document.body, { key: "ArrowUp" }); // project row → capture
    expect(document.activeElement).toBe(
      screen.getByPlaceholderText("Add a task for today…")
    );
  });
});

const NOTES_PLACEHOLDER = "Add details, links, context… (markdown supported)";

describe("Keyboard-only outline control", () => {
  it("a and n add editable tasks below the focused row", async () => {
    render(<App />);
    await addTask("first");
    blurActive();

    fireEvent.keyDown(document.body, { key: "n" });
    const secondInput = await screen.findByPlaceholderText("Task…");
    fireEvent.change(secondInput, { target: { value: "second" } });
    fireEvent.keyDown(secondInput, { key: "Escape" });
    expect(await screen.findByText("second")).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "a" });
    const thirdInput = await screen.findByPlaceholderText("Task…");
    fireEvent.change(thirdInput, { target: { value: "third" } });
    fireEvent.keyDown(thirdInput, { key: "Escape" });
    expect(await screen.findByText("third")).toBeTruthy();

    const first = screen.getByText("first");
    const second = screen.getByText("second");
    const third = screen.getByText("third");
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(second.compareDocumentPosition(third) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("opens an empty project from the index and adds its first task", async () => {
    render(<App />);
    await screen.findByPlaceholderText("Add a task for today…");
    blurActive();
    act(() => createProject("Empty Project"));
    fireEvent.keyDown(document.body, { key: "4" }); // Projects index

    const label = await screen.findByText("Empty Project");
    fireEvent.click(label); // focus the project row
    fireEvent.keyDown(document.body, { key: "ArrowRight" }); // → opens (zooms into) it

    fireEvent.keyDown(document.body, { key: "a" }); // add the first task
    const taskInput = await screen.findByPlaceholderText("Task…");
    fireEvent.change(taskInput, { target: { value: "first project task" } });
    fireEvent.keyDown(taskInput, { key: "Escape" });

    expect(await screen.findByText("first project task")).toBeTruthy();
  });

  it("indents, collapses, and re-expands with the keyboard (→ expands, not panel)", async () => {
    render(<App />);
    await addTask("parent");
    await addTask("child"); // order: parent, child; focus = child
    blurActive();

    // Tab indents "child" under "parent".
    fireEvent.keyDown(document.body, { key: "Tab" });
    expect(screen.getByText("child")).toBeTruthy();

    // Move to parent and collapse it → child hidden.
    fireEvent.keyDown(document.body, { key: "ArrowUp" });
    fireEvent.keyDown(document.body, { key: "c" });
    await waitFor(() => expect(screen.queryByText("child")).toBeNull());

    // → must EXPAND the collapsed task, not open the panel.
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(await screen.findByText("child")).toBeTruthy();
    expect(screen.queryByPlaceholderText(NOTES_PLACEHOLDER)).toBeNull();
  });

  it("collapses with ← and expands with → repeatedly", async () => {
    render(<App />);
    await addTask("p");
    await addTask("k");
    blurActive();
    fireEvent.keyDown(document.body, { key: "Tab" }); // k under p
    fireEvent.keyDown(document.body, { key: "ArrowUp" }); // focus p

    fireEvent.keyDown(document.body, { key: "ArrowLeft" }); // collapse
    await waitFor(() => expect(screen.queryByText("k")).toBeNull());
    fireEvent.keyDown(document.body, { key: "ArrowRight" }); // expand
    expect(await screen.findByText("k")).toBeTruthy();
  });

  it("→ opens the panel on a leaf and esc closes it", async () => {
    render(<App />);
    await addTask("leaf");
    blurActive();

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    const notes = await screen.findByPlaceholderText(NOTES_PLACEHOLDER);
    fireEvent.keyDown(notes, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(NOTES_PLACEHOLDER)).toBeNull()
    );
  });

  it("collapse/expand still work after opening & closing the panel", async () => {
    render(<App />);
    await addTask("par");
    await addTask("kid");
    blurActive();
    fireEvent.keyDown(document.body, { key: "Tab" }); // kid under par
    fireEvent.keyDown(document.body, { key: "ArrowUp" }); // focus par (expanded)

    // → on an expanded parent opens the panel…
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    const notes = await screen.findByPlaceholderText(NOTES_PLACEHOLDER);
    fireEvent.keyDown(notes, { key: "Escape" }); // …esc returns to the list
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(NOTES_PLACEHOLDER)).toBeNull()
    );

    fireEvent.keyDown(document.body, { key: "c" }); // collapse
    await waitFor(() => expect(screen.queryByText("kid")).toBeNull());
    fireEvent.keyDown(document.body, { key: "c" }); // expand
    expect(await screen.findByText("kid")).toBeTruthy();
  });
});

describe("Command palette", () => {
  it("opens with Cmd+K and runs a theme command", async () => {
    render(<App />);
    await screen.findByPlaceholderText("Add a task for today…");

    fireEvent.keyDown(document.body, { key: "k", metaKey: true });
    const palette = await screen.findByPlaceholderText("Type a command…");

    fireEvent.change(palette, { target: { value: "carbon" } });
    fireEvent.keyDown(palette, { key: "Enter" });

    await waitFor(() =>
      expect(document.documentElement.getAttribute("data-theme")).toBe("carbon")
    );
  });

  it("selects a project row and renames it with Enter", async () => {
    render(<App />);
    await screen.findByPlaceholderText("Add a task for today…");

    fireEvent.keyDown(document.body, { key: "k", metaKey: true });
    const palette = await screen.findByPlaceholderText("Type a command…");
    fireEvent.change(palette, { target: { value: "new project Work" } });
    fireEvent.keyDown(palette, { key: "Enter" });

    expect(await screen.findByText("Work")).toBeTruthy();

    const rowInput = await screen.findByPlaceholderText("Task…");
    fireEvent.change(rowInput, { target: { value: "project task" } });
    fireEvent.keyDown(rowInput, { key: "Escape" });

    expect(await screen.findByText("project task")).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "ArrowUp" });
    fireEvent.keyDown(document.body, { key: "Enter" });
    const projectName = await screen.findByDisplayValue("Work");
    fireEvent.change(projectName, { target: { value: "Deep Work" } });
    fireEvent.keyDown(projectName, { key: "Enter" });

    expect(await screen.findByText("Deep Work")).toBeTruthy();
  });

  it("creates a project from the index and drops into rename mode", async () => {
    render(<App />);
    await screen.findByPlaceholderText("Add a task for today…");
    blurActive();
    fireEvent.keyDown(document.body, { key: "4" }); // Projects index

    fireEvent.click(await screen.findByText("+ Project"));

    // New project is created and immediately editable (no first task is added).
    const nameInput = await screen.findByDisplayValue("New project");
    fireEvent.change(nameInput, { target: { value: "Side Quests" } });
    fireEvent.keyDown(nameInput, { key: "Enter" });

    expect(await screen.findByText("Side Quests")).toBeTruthy();
  });

  it("renames a project row with a double-click in the index", async () => {
    render(<App />);
    await screen.findByPlaceholderText("Add a task for today…");
    blurActive();
    act(() => createProject("Work"));
    fireEvent.keyDown(document.body, { key: "4" }); // Projects index

    fireEvent.doubleClick(await screen.findByText("Work"));
    const projectName = await screen.findByDisplayValue("Work");
    fireEvent.change(projectName, { target: { value: "Mouse Project" } });
    fireEvent.keyDown(projectName, { key: "Enter" });

    expect(await screen.findByText("Mouse Project")).toBeTruthy();
  });
});

describe("Project collapse", () => {
  it("collapses a project with ← and expands it with →", async () => {
    render(<App />);
    await addTask("alpha");
    blurActive();
    fireEvent.keyDown(document.body, { key: "3" }); // All view (grouped by project)

    fireEvent.keyDown(document.body, { key: "ArrowUp" }); // focus the project header row
    fireEvent.keyDown(document.body, { key: "ArrowLeft" }); // collapse
    await waitFor(() => expect(screen.queryByText("alpha")).toBeNull());

    fireEvent.keyDown(document.body, { key: "ArrowRight" }); // expand
    expect(await screen.findByText("alpha")).toBeTruthy();
  });
});

describe("Hide completed", () => {
  it("h hides completed tasks and toggles them back", async () => {
    render(<App />);
    await addTask("keep me");
    await addTask("finish me"); // focus = finish me
    blurActive();

    fireEvent.keyDown(document.body, { key: " " }); // complete "finish me"
    fireEvent.keyDown(document.body, { key: "h" }); // hide completed

    await waitFor(() => expect(screen.queryByText("finish me")).toBeNull());
    expect(screen.getByText("keep me")).toBeTruthy();
    expect(screen.getByText(/completed hidden/)).toBeTruthy(); // indicator pill

    fireEvent.keyDown(document.body, { key: "h" }); // show again
    expect(await screen.findByText("finish me")).toBeTruthy();
  });
});

describe("Zoom / focus (hoisting)", () => {
  it("Alt+Enter hoists a task; siblings vanish; Esc climbs back out", async () => {
    render(<App />);
    await addTask("parent");
    await addTask("child");
    blurActive();
    fireEvent.keyDown(document.body, { key: "Tab" }); // child becomes a subtask of parent

    // A separate top-level sibling, captured from the bar.
    const cap = screen.getByPlaceholderText("Add a task for today…");
    fireEvent.change(cap, { target: { value: "sibling" } });
    fireEvent.keyDown(cap, { key: "Enter" });
    await screen.findByText("sibling");
    blurActive();

    // Focus "parent" (flat order: parent, child, sibling) and zoom in.
    fireEvent.keyDown(document.body, { key: "ArrowUp" }); // child
    fireEvent.keyDown(document.body, { key: "ArrowUp" }); // parent
    fireEvent.keyDown(document.body, { key: "Enter", altKey: true });

    // Hoisted onto "parent": its child shows, the sibling is out of view.
    expect(await screen.findByText(/Focused on this task/)).toBeTruthy();
    expect(screen.getByText("child")).toBeTruthy();
    expect(screen.queryByText("sibling")).toBeNull();

    // Esc climbs: parent (top-level) → its project → back to the normal view.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(await screen.findByText(/Focused on this project/)).toBeTruthy();
    expect(screen.getByText("sibling")).toBeTruthy(); // sibling back in the project view

    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText(/Focused on this/)).toBeNull());
    expect(await screen.findByPlaceholderText("Add a task for today…")).toBeTruthy();
  });
});

describe("Scheduling (the s picker)", () => {
  it("schedules 'this week' and the task lands in the by-date Later bucket", async () => {
    render(<App />);
    await addTask("write spec"); // planned today by default
    blurActive();

    fireEvent.keyDown(document.body, { key: "s" }); // open the scheduler
    fireEvent.click(await screen.findByText("This week")); // pick the bucket

    // It leaves Today (now a fuzzy horizon, not a concrete date).
    await waitFor(() => expect(screen.queryByText("write spec")).toBeNull());

    blurActive();
    fireEvent.keyDown(document.body, { key: "2" }); // Later view (by-date default)
    expect(await screen.findByText("write spec")).toBeTruthy();
    expect(screen.getByText("This week")).toBeTruthy(); // the bucket header
  });

  it("toggles the Later view between by-date and by-project", async () => {
    render(<App />);
    await addTask("later thing");
    blurActive();
    fireEvent.keyDown(document.body, { key: "s" });
    fireEvent.click(await screen.findByText("Someday"));

    blurActive();
    fireEvent.keyDown(document.body, { key: "2" }); // Later view
    expect(await screen.findByText("Someday")).toBeTruthy(); // by-date bucket

    fireEvent.click(screen.getByText("By project"));
    await waitFor(() => expect(screen.queryByText("Someday")).toBeNull()); // bucket gone
    expect(screen.getByText("later thing")).toBeTruthy(); // still listed, now by project
  });
});
