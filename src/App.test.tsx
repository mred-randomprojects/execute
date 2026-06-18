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

    fireEvent.keyDown(document.body, { key: "4" }); // Trash view
    expect(await screen.findByText("disposable")).toBeTruthy();

    fireEvent.click(screen.getByText("Restore"));
    fireEvent.keyDown(document.body, { key: "3" }); // All view
    expect(await screen.findByText("disposable")).toBeTruthy();
  });
});

describe("Trivial editing", () => {
  it("ArrowUp while editing moves editing to the previous task", async () => {
    render(<App />);
    await addTask("first");
    await addTask("second");
    blurActive();

    fireEvent.keyDown(document.body, { key: "Enter" }); // edit focused (second)
    const editingSecond = await screen.findByDisplayValue("second");
    fireEvent.keyDown(editingSecond, { key: "ArrowUp" });

    const editingFirst = await screen.findByDisplayValue("first");
    fireEvent.change(editingFirst, { target: { value: "first edited" } });
    fireEvent.keyDown(editingFirst, { key: "Escape" });
    expect(await screen.findByText("first edited")).toBeTruthy();
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

  it("ArrowDown on an empty last project row creates its first task", async () => {
    render(<App />);
    await screen.findByPlaceholderText("Add a task for today…");

    act(() => createProject("Empty Project"));
    expect(await screen.findByText("Empty Project")).toBeTruthy();
    blurActive();

    fireEvent.keyDown(document.body, { key: "ArrowDown" });
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

  it("creates a project from the toolbar button and starts its first task", async () => {
    render(<App />);
    await screen.findByPlaceholderText("Add a task for today…");

    fireEvent.click(screen.getByText("+ Project"));

    expect(await screen.findByText("New project")).toBeTruthy();
    const rowInput = await screen.findByPlaceholderText("Task…");
    fireEvent.change(rowInput, { target: { value: "button project task" } });
    fireEvent.keyDown(rowInput, { key: "Escape" });

    expect(await screen.findByText("button project task")).toBeTruthy();
  });

  it("renames a project row with the mouse", async () => {
    render(<App />);
    await screen.findByPlaceholderText("Add a task for today…");

    fireEvent.click(screen.getByText("+ Project"));
    expect(await screen.findByText("New project")).toBeTruthy();

    fireEvent.doubleClick(screen.getByText("New project"));
    const projectName = await screen.findByDisplayValue("New project");
    fireEvent.change(projectName, { target: { value: "Mouse Project" } });
    fireEvent.keyDown(projectName, { key: "Enter" });

    expect(await screen.findByText("Mouse Project")).toBeTruthy();
  });
});
