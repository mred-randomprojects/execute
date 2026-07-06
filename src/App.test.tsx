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

  it("backlogs a whole over-committed group in one move", async () => {
    render(<App />);
    await addTask("trip");
    await addTask("book flights");
    blurActive();
    fireEvent.keyDown(document.body, { key: "Tab" }); // book flights → under trip
    fireEvent.keyDown(document.body, { key: "o" }); // new sibling under trip
    const sub = await screen.findByPlaceholderText("Task…");
    fireEvent.change(sub, { target: { value: "reserve hotel" } });
    fireEvent.keyDown(sub, { key: "Escape" });
    await screen.findByText("reserve hotel");

    act(() => setDevDateOverride(addDays(todayISO(null), 1)));
    expect(await screen.findByText("Unfinished from before today")).toBeTruthy();

    // Both stranded subtasks show, with a one-shot group action.
    expect(screen.getByText("book flights")).toBeTruthy();
    expect(screen.getByText("reserve hotel")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Backlog all"));
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

describe("Cursor after a task leaves the view", () => {
  it("lands on the row above when `t` unplans the focused task (not the top)", async () => {
    render(<App />);
    await addTask("alpha");
    await addTask("bravo");
    await addTask("charlie");
    await addTask("delta"); // top→bottom: alpha, bravo, charlie, delta; focus on delta
    blurActive();

    fireEvent.keyDown(document.body, { key: "ArrowUp" }); // focus charlie
    fireEvent.keyDown(document.body, { key: "t" }); // unplan → leaves Today, focus → bravo
    await waitFor(() => expect(screen.queryByText("charlie")).toBeNull());

    fireEvent.keyDown(document.body, { key: "ArrowDown" }); // bravo → delta (charlie's old slot)
    fireEvent.keyDown(document.body, { key: "t" }); // unplan delta
    await waitFor(() => expect(screen.queryByText("delta")).toBeNull());

    // Had the cursor snapped to the top, the second `t` would have unplanned alpha/bravo.
    expect(screen.getByText("alpha")).toBeTruthy();
    expect(screen.getByText("bravo")).toBeTruthy();
  });
});

describe("Jump navigation (⌘↑ / ⌘↓)", () => {
  it("jumps to the first/last item instead of reordering", async () => {
    render(<App />);
    await addTask("alpha");
    await addTask("bravo");
    await addTask("charlie"); // rows: project, alpha, bravo, charlie; focus charlie
    blurActive();

    // ⌘↑ → first row (project header); ↓ → alpha; `t` removes it.
    fireEvent.keyDown(document.body, { key: "ArrowUp", metaKey: true });
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    fireEvent.keyDown(document.body, { key: "t" });
    await waitFor(() => expect(screen.queryByText("alpha")).toBeNull());
    // Had ⌘↑ reordered instead of jumping, alpha would still be here.
    expect(screen.getByText("bravo")).toBeTruthy();
    expect(screen.getByText("charlie")).toBeTruthy();

    // ⌘↓ → last item (charlie); `t` removes it.
    fireEvent.keyDown(document.body, { key: "ArrowDown", metaKey: true });
    fireEvent.keyDown(document.body, { key: "t" });
    await waitFor(() => expect(screen.queryByText("charlie")).toBeNull());
    expect(screen.getByText("bravo")).toBeTruthy();
  });
});

describe("Trash", () => {
  it("Backspace marks won't-do, then trashes; Trash view restores it", async () => {
    render(<App />);
    await addTask("disposable");
    blurActive();

    // First Backspace: intentionally skip — the task stays listed as "won't do".
    fireEvent.keyDown(document.body, { key: "Backspace" });
    expect(await screen.findByText("disposable")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" }); // dismiss the inline reason field

    // Second Backspace (already resolved) sends it to the Trash.
    fireEvent.keyDown(document.body, { key: "Backspace" });
    await waitFor(() => expect(screen.queryByText("disposable")).toBeNull());

    fireEvent.keyDown(document.body, { key: "6" }); // Trash view
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

    // First Backspace marks the parent "won't do" — the subtree is untouched.
    fireEvent.keyDown(document.body, { key: "Backspace" });
    expect(screen.getByText("parent")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" }); // leave the reason field

    // A second Backspace on the (now resolved) task with subtasks asks first.
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

    fireEvent.keyDown(document.body, { key: "Backspace" }); // → won't do
    fireEvent.keyDown(document.body, { key: "Escape" }); // leave the reason field
    fireEvent.keyDown(document.body, { key: "Backspace" }); // → delete confirmation
    const dialog = await screen.findByText("Delete this task and its subtasks?");
    fireEvent.keyDown(dialog, { key: "Escape" }); // cancel

    await waitFor(() =>
      expect(screen.queryByText("Delete this task and its subtasks?")).toBeNull()
    );
    expect(screen.getByText("keep me")).toBeTruthy();
  });
});

describe("Won't do (intentionally skipped)", () => {
  it("Backspace marks won't-do, captures an inline reason, and stays listed", async () => {
    render(<App />);
    await addTask("skip me");
    await addTask("keep me"); // order: skip me, keep me; selection = keep me
    blurActive();
    fireEvent.keyDown(document.body, { key: "ArrowUp" }); // focus skip me

    // One Backspace: skip it (not trashed — the row is still there, now a ✕).
    fireEvent.keyDown(document.body, { key: "Backspace" });
    expect(await screen.findByLabelText(/won.t do/i)).toBeTruthy();
    expect(screen.getByText("skip me")).toBeTruthy();

    // The inline reason field is focused; type a reason and save it.
    const reasonInput = screen.getByPlaceholderText(/why\?/i);
    fireEvent.change(reasonInput, { target: { value: "changed my mind" } });
    fireEvent.keyDown(reasonInput, { key: "Enter" });
    expect(await screen.findByText(/changed my mind/)).toBeTruthy();

    // Clicking the ✕ checkbox reopens it — back to an ordinary open task.
    fireEvent.click(screen.getByLabelText(/won.t do/i));
    await waitFor(() => expect(screen.queryByLabelText(/won.t do/i)).toBeNull());
    expect(screen.getByText("skip me")).toBeTruthy();
  });

  it("`w` skips an open task and re-edits the reason — all from the keyboard", async () => {
    render(<App />);
    await addTask("maybe later");
    blurActive(); // focus it, still open

    // `w` on an open task marks it won't-do and opens the reason field.
    fireEvent.keyDown(document.body, { key: "w" });
    expect(await screen.findByLabelText(/won.t do/i)).toBeTruthy();
    const field = screen.getByPlaceholderText(/why\?/i);
    fireEvent.change(field, { target: { value: "too busy" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(await screen.findByText(/too busy/)).toBeTruthy();

    // `w` again re-opens the same reason for editing — no click needed.
    fireEvent.keyDown(document.body, { key: "w" });
    const field2 = screen.getByPlaceholderText(/why\?/i);
    fireEvent.change(field2, { target: { value: "not a priority" } });
    fireEvent.keyDown(field2, { key: "Enter" });
    expect(await screen.findByText(/not a priority/)).toBeTruthy();
    expect(screen.queryByText(/too busy/)).toBeNull();
  });
});

describe("Today view: no stranded parents", () => {
  it("hides a not-for-today parent whose only today child is completed (hide-completed on)", async () => {
    render(<App />);
    await addTask("umbrella");
    await addTask("do today");
    blurActive();
    fireEvent.keyDown(document.body, { key: "Tab" }); // "do today" → child of "umbrella"
    fireEvent.keyDown(document.body, { key: "ArrowUp" }); // focus the parent
    fireEvent.keyDown(document.body, { key: "t" }); // unplan the parent (not for today)
    fireEvent.keyDown(document.body, { key: "ArrowDown" }); // back to the child
    fireEvent.keyDown(document.body, { key: " " }); // complete the child

    // Without hiding, the parent still shows as context for the completed child.
    expect(screen.getByText("umbrella")).toBeTruthy();

    // Hiding completed removes the child — and the parent must not linger alone,
    // since it isn't planned for today and now has nothing under it.
    fireEvent.keyDown(document.body, { key: "h" });
    await waitFor(() => {
      expect(screen.queryByText("do today")).toBeNull();
      expect(screen.queryByText("umbrella")).toBeNull();
    });
  });

  it("keeps a not-for-today parent while an open today child remains", async () => {
    render(<App />);
    await addTask("umbrella");
    await addTask("do today");
    blurActive();
    fireEvent.keyDown(document.body, { key: "Tab" }); // nest child
    fireEvent.keyDown(document.body, { key: "ArrowUp" }); // focus parent
    fireEvent.keyDown(document.body, { key: "t" }); // unplan parent

    // Child is still open, so even with completed hidden the parent stays (context).
    fireEvent.keyDown(document.body, { key: "h" });
    await waitFor(() => expect(screen.getByText("umbrella")).toBeTruthy());
    expect(screen.getByText("do today")).toBeTruthy();
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
  it("Option+ArrowUp moves the focused task up", async () => {
    render(<App />);
    await addTask("a");
    await addTask("b"); // focused = b, order a,b
    blurActive();

    fireEvent.keyDown(document.body, { key: "ArrowUp", altKey: true });

    const a = screen.getByText("a");
    const b = screen.getByText("b");
    // After moving b up, b precedes a in the document.
    expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("⌥↓ hops over a task the view is hiding instead of an invisible no-op", async () => {
    render(<App />);
    await addTask("first");
    await addTask("mid");
    await addTask("second");
    blurActive();

    // Hide "mid" between the two visible tasks (raw order: first, mid, second).
    fireEvent.keyDown(document.body, { key: "ArrowUp" }); // second → mid
    fireEvent.keyDown(document.body, { key: "t" }); // unplan mid → cursor lands on "first" (row above)
    await waitFor(() => expect(screen.queryByText("mid")).toBeNull());

    // Cursor is on "first" now. Its raw next sibling is the hidden "mid";
    // view-aware reorder must move it past the visible "second" instead.
    fireEvent.keyDown(document.body, { key: "ArrowDown", altKey: true }); // reorder down

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
  it("Shift+ArrowDown selects a range; Backspace skips all, then trashes all", async () => {
    render(<App />);
    await addTask("one");
    await addTask("two");
    await addTask("three"); // order: one, two, three; focus = three
    blurActive();

    fireEvent.keyDown(document.body, { key: "ArrowUp" }); // → two
    fireEvent.keyDown(document.body, { key: "ArrowUp" }); // → one
    fireEvent.keyDown(document.body, { key: "ArrowDown", shiftKey: true }); // one..two

    // A bulk skip leaves the selection in place (no inline reason prompt).
    fireEvent.keyDown(document.body, { key: "Backspace" });
    expect(screen.getByText("one")).toBeTruthy();
    expect(screen.getByText("two")).toBeTruthy();

    // Second Backspace (both resolved) trashes the whole range.
    fireEvent.keyDown(document.body, { key: "Backspace" });
    await waitFor(() => {
      expect(screen.queryByText("one")).toBeNull();
      expect(screen.queryByText("two")).toBeNull();
    });
    expect(screen.getByText("three")).toBeTruthy();
  });
});

describe("Detail panel", () => {
  it("opens in preview, then Tab dives into the notes editor", async () => {
    render(<App />);
    await addTask("with notes");
    blurActive();

    fireEvent.keyDown(document.body, { key: "ArrowRight" }); // open (preview)
    fireEvent.keyDown(document.body, { key: "Tab" }); // dive into notes
    const notes = await screen.findByPlaceholderText(
      "Add details, links, context… (markdown supported)"
    );
    expect(document.activeElement).toBe(notes); // focus moved into the panel
    fireEvent.change(notes, { target: { value: "some detail" } });
    expect((notes as HTMLTextAreaElement).value).toBe("some detail");
  });

  it("previews while navigating: the panel follows ↑/↓ with focus on the list", async () => {
    render(<App />);
    await addTask("alpha");
    await addTask("beta"); // order: alpha, beta; focus = beta
    blurActive();

    const panel = () =>
      document.querySelector('[data-keyzone="panel"]') as HTMLElement | null;

    fireEvent.keyDown(document.body, { key: "ArrowRight" }); // preview beta
    await waitFor(() => expect(panel()?.textContent).toContain("beta"));

    // Focus is still on the list, so ↑ moves the selection and the panel follows —
    // no need to close/reopen between tasks.
    fireEvent.keyDown(document.body, { key: "ArrowUp" });
    await waitFor(() => expect(panel()?.textContent).toContain("alpha"));
    expect(panel()).not.toBeNull(); // still open
  });

  it("esc from the notes returns to preview; a second esc closes the panel", async () => {
    render(<App />);
    await addTask("solo");
    blurActive();

    fireEvent.keyDown(document.body, { key: "ArrowRight" }); // preview
    fireEvent.keyDown(document.body, { key: "Tab" }); // into notes
    const notes = await screen.findByPlaceholderText(NOTES_PLACEHOLDER);
    expect(document.activeElement).toBe(notes);

    // First esc (in the notes) hands focus back to the list but keeps the panel.
    fireEvent.keyDown(notes, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).not.toBe(notes));
    expect(screen.queryByPlaceholderText(NOTES_PLACEHOLDER)).not.toBeNull();

    // Second esc (on the list) closes the panel.
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(NOTES_PLACEHOLDER)).toBeNull()
    );
  });

  it("shows a created timestamp", async () => {
    render(<App />);
    await addTask("stamped");
    blurActive();
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(await screen.findByText(/^Created /)).toBeTruthy();
  });

  it("lists subtasks in the panel even when the list is hiding completed ones", async () => {
    render(<App />);
    await addTask("parent");
    await addTask("child");
    blurActive();
    fireEvent.keyDown(document.body, { key: "Tab" }); // child → subtask of parent
    fireEvent.keyDown(document.body, { key: " " }); // complete the (focused) child

    // Hide completed: the child vanishes from the outline, and the parent — its
    // only child now hidden — looks childless in the list.
    fireEvent.keyDown(document.body, { key: "h" });
    await waitFor(() => expect(screen.queryByText("child")).toBeNull());

    // → opens the parent's detail panel, which still shows the whole subtree.
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(await screen.findByText("Subtasks")).toBeTruthy();
    expect(screen.getByText("child")).toBeTruthy();
  });
});

describe("Suggested for today", () => {
  it("surfaces a this-week task as a suggestion and `t` accepts it into Today", async () => {
    render(<App />);
    // Set the date only once init has settled (App's load effect would reset it).
    await screen.findByPlaceholderText("Add a task for today…");
    act(() => setDevDateOverride("2026-06-17")); // Wednesday of ISO week 25
    await addTask("water plants");
    blurActive();

    // Schedule "this week": it leaves Today (soft horizon) but its suggested day
    // is Wednesday === today, so it reappears under "Suggested for today".
    fireEvent.keyDown(document.body, { key: "k", metaKey: true });
    const palette = await screen.findByPlaceholderText("Type a command…");
    fireEvent.change(palette, { target: { value: "this week" } });
    fireEvent.keyDown(palette, { key: "Enter" });

    expect(await screen.findByText("Suggested for today")).toBeTruthy();
    expect(screen.getByText("water plants")).toBeTruthy();

    // The task kept focus (still in the outline flow), so `t` accepts it: it
    // becomes a real Today commitment and the suggestion group disappears.
    fireEvent.keyDown(document.body, { key: "t" });
    await waitFor(() =>
      expect(screen.queryByText("Suggested for today")).toBeNull()
    );
    expect(screen.getByText("water plants")).toBeTruthy();
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
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
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
    await screen.findByPlaceholderText(NOTES_PLACEHOLDER); // open (preview)
    // Focus stays on the list in preview, so esc on the list closes the panel.
    fireEvent.keyDown(document.body, { key: "Escape" });
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
    await screen.findByPlaceholderText(NOTES_PLACEHOLDER);
    fireEvent.keyDown(document.body, { key: "Escape" }); // …esc on the list closes it
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(NOTES_PLACEHOLDER)).toBeNull()
    );

    fireEvent.keyDown(document.body, { key: "ArrowLeft" }); // collapse
    await waitFor(() => expect(screen.queryByText("kid")).toBeNull());
    fireEvent.keyDown(document.body, { key: "ArrowRight" }); // expand
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

  it("schedules the focused task to a horizon via Cmd+K (leaves Today)", async () => {
    render(<App />);
    await addTask("groceries"); // captured into Today (plannedFor === today)
    blurActive();

    fireEvent.keyDown(document.body, { key: "k", metaKey: true });
    const palette = await screen.findByPlaceholderText("Type a command…");
    // "this week" matches only "Schedule: This week" by label substring.
    fireEvent.change(palette, { target: { value: "this week" } });
    fireEvent.keyDown(palette, { key: "Enter" });

    // It becomes a soft horizon, so it drops out of Today…
    await waitFor(() => expect(screen.queryByText("groceries")).toBeNull());
    // …and surfaces in the Later/Backlog view (non-dated tasks).
    fireEvent.keyDown(document.body, { key: "2" });
    expect(await screen.findByText("groceries")).toBeTruthy();
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

describe("Recurring tasks", () => {
  it("defines a recurrence with a step, suggests it in Today, and accepts it", async () => {
    render(<App />);
    await screen.findByPlaceholderText("Add a task for today…");
    blurActive(); // the Today capture bar auto-focuses on mount

    // Go to the Recurring view and capture a recurrence (defaults to Every day).
    fireEvent.keyDown(document.body, { key: "5" });
    const cap = await screen.findByPlaceholderText(/New recurring task/);
    fireEvent.change(cap, { target: { value: "Morning ritual" } });
    fireEvent.keyDown(cap, { key: "Enter" });
    expect(await screen.findByText("Morning ritual")).toBeTruthy();
    expect(screen.getByText("Every day")).toBeTruthy(); // pattern group header

    // Add a step under the (focused) root, name it, commit.
    blurActive();
    fireEvent.keyDown(document.body, { key: "o" });
    const stepInput = await screen.findByPlaceholderText("Task…");
    fireEvent.change(stepInput, { target: { value: "Brush teeth" } });
    fireEvent.keyDown(stepInput, { key: "Enter" });
    expect(await screen.findByText("Brush teeth")).toBeTruthy();

    // In Today it surfaces as a passive suggestion (not a committed task yet).
    blurActive();
    fireEvent.keyDown(document.body, { key: "1" });
    expect(await screen.findByText("Recurring today")).toBeTruthy();
    expect(screen.getByText("Morning ritual")).toBeTruthy();
    // No real task exists yet → no completion checkbox for its leaf.
    expect(screen.queryByLabelText("Mark complete")).toBeNull();

    // Accept it: focus the suggestion and press `t`.
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    fireEvent.keyDown(document.body, { key: "t" });

    // The suggestion is now suppressed and a real, checkable task exists.
    await waitFor(() => expect(screen.queryByText("Recurring today")).toBeNull());
    expect(screen.getByText("Morning ritual")).toBeTruthy();
    expect(screen.getAllByLabelText("Mark complete").length).toBeGreaterThan(0);
  });

  it("does not let recurrences leak into Today's counts or the Reckoning", async () => {
    render(<App />);
    await screen.findByPlaceholderText("Add a task for today…");
    blurActive();
    fireEvent.keyDown(document.body, { key: "5" });
    const cap = await screen.findByPlaceholderText(/New recurring task/);
    fireEvent.change(cap, { target: { value: "Standup" } });
    fireEvent.keyDown(cap, { key: "Enter" });
    await screen.findByText("Standup");

    // Back to Today: the daily recurrence surfaces as a suggestion, but it's not
    // a commitment — "0 to go" (never counted) and no completion checkbox exists.
    blurActive();
    fireEvent.keyDown(document.body, { key: "1" });
    expect(await screen.findByText("Recurring today")).toBeTruthy();
    expect(screen.getByText(/0 to go/)).toBeTruthy();
    expect(screen.queryByLabelText("Mark complete")).toBeNull();
  });

  it("changes a recurrence's rule via the repeat picker, regrouping it", async () => {
    render(<App />);
    await screen.findByPlaceholderText("Add a task for today…");
    blurActive();

    fireEvent.keyDown(document.body, { key: "5" });
    const cap = await screen.findByPlaceholderText(/New recurring task/);
    fireEvent.change(cap, { target: { value: "Laundry" } });
    fireEvent.keyDown(cap, { key: "Enter" });
    await screen.findByText("Laundry");
    expect(screen.getByText("Every day")).toBeTruthy();

    // Open the repeat picker and choose a preset.
    blurActive();
    fireEvent.keyDown(document.body, { key: "r" });
    expect(await screen.findByText("Repeat")).toBeTruthy();
    fireEvent.click(screen.getByText("Every weekend day"));

    // The recurrence regroups under its new pattern.
    await waitFor(() => expect(screen.queryByText("Every day")).toBeNull());
    expect(screen.getByText("Every weekend day")).toBeTruthy();
  });
});

describe("Current (focus) task", () => {
  it("c sets a banner + row marker, and c again clears it", async () => {
    render(<App />);
    await addTask("focus me");
    blurActive();
    expect(screen.queryByText("Right now")).toBeNull();

    fireEvent.keyDown(document.body, { key: "c" });
    expect(await screen.findByText("Right now")).toBeTruthy(); // banner
    expect(screen.getByText("Now")).toBeTruthy(); // row marker pill

    fireEvent.keyDown(document.body, { key: "c" }); // toggle off
    await waitFor(() => expect(screen.queryByText("Right now")).toBeNull());
  });

  it("retires the banner once the current task is completed", async () => {
    render(<App />);
    await addTask("do this");
    blurActive();
    fireEvent.keyDown(document.body, { key: "c" });
    await screen.findByText("Right now");

    fireEvent.keyDown(document.body, { key: " " }); // complete the focused task
    await waitFor(() => expect(screen.queryByText("Right now")).toBeNull());
  });

  it("clears the pointer when the current task is deleted", async () => {
    render(<App />);
    await addTask("temp focus");
    blurActive();
    fireEvent.keyDown(document.body, { key: "c" });
    await screen.findByText("Right now");

    fireEvent.keyDown(document.body, { key: "Backspace" }); // trash the leaf
    await waitFor(() => expect(screen.queryByText("Right now")).toBeNull());
  });
});
