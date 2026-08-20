import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act } from "react";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { App } from "./App";
import {
  addChild,
  addTaskAfter,
  createProject,
  initStore,
  setDevDateOverride,
  setHorizonMany,
} from "./store/store";
import { addDays, monthKeyOffset, todayISO, weekKey } from "./store/dates";

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

  it("'t' defers a today task one step, removing it from Today", async () => {
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

describe("The morning plan", () => {
  const openPlan = () => {
    blurActive();
    fireEvent.keyDown(document.body, { key: "Q", shiftKey: true });
  };

  it("offers this week's undated work, and commits it with one key", async () => {
    render(<App />);
    await addTask("draft the memo");
    blurActive();
    // Push it to "this week" — chosen for the week, but given no day.
    fireEvent.keyDown(document.body, { key: "s" });
    const when = await screen.findByLabelText("When");
    fireEvent.change(when, { target: { value: "this week" } });
    fireEvent.keyDown(when, { key: "Enter" });
    await waitFor(() => expect(screen.queryByLabelText("When")).toBeNull());

    openPlan();
    expect(await screen.findByText("What is today?")).toBeTruthy();
    expect(screen.getByText("draft the memo")).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "t" }); // take it on
    expect(await screen.findByText("Nothing waiting to be planned.")).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(await screen.findByText("1 to go · 0/1 done")).toBeTruthy();
  });

  it("shows the cost of the next yes while you're saying it", async () => {
    render(<App />);
    await addTask("draft the memo");
    blurActive();
    fireEvent.keyDown(document.body, { key: "s" });
    const when = await screen.findByLabelText("When");
    fireEvent.change(when, { target: { value: "this week" } });
    fireEvent.keyDown(when, { key: "Enter" });
    await waitFor(() => expect(screen.queryByLabelText("When")).toBeNull());

    openPlan();
    // The meter is the point of the ritual, so it's above the list.
    expect(await screen.findByText(/0 \/ 12 blocks/)).toBeTruthy();
  });

  it("doesn't re-offer work you already gave a day to", async () => {
    render(<App />);
    await addTask("already chosen"); // capture lands it on today
    openPlan();
    expect(await screen.findByText("Nothing waiting to be planned.")).toBeTruthy();
  });

  it("refuses to open while the gate is up — clear yesterday before choosing today", async () => {
    render(<App />);
    await addTask("yesterday's problem");
    act(() => setDevDateOverride(addDays(todayISO(null), 1)));
    await screen.findByText("Unfinished from before today");

    openPlan();
    expect(screen.getByText("Unfinished from before today")).toBeTruthy();
    expect(screen.queryByText("What is today?")).toBeNull();
  });
});

describe("The weekly review", () => {
  it("reads back the reasons it has been collecting all along", async () => {
    render(<App />);
    await addTask("chase the invoice");
    // Decline it with a reason — the app has always recorded these and never
    // shown them anywhere but one task's own history.
    blurActive();
    fireEvent.keyDown(document.body, { key: "w" });
    const why = await screen.findByPlaceholderText(/why\?/);
    fireEvent.change(why, { target: { value: "waiting on finance" } });
    fireEvent.keyDown(why, { key: "Enter" });

    fireEvent.click(screen.getByTitle("Review your week"));
    const dialog = await screen.findByRole("dialog", { name: "Review" });
    expect(within(dialog).getByText("Why things didn't happen")).toBeTruthy();
    expect(within(dialog).getByText("waiting on finance")).toBeTruthy();
  });

  it("names the tasks you keep putting off", async () => {
    render(<App />);
    await addTask("vague big thing");
    // Two rounds of keeping it for today → carried 2×.
    for (const day of [1, 2]) {
      act(() => setDevDateOverride(addDays(todayISO(null), day)));
      await screen.findByText("Unfinished from before today");
      fireEvent.click(screen.getByLabelText("Keep for today"));
      await waitFor(() =>
        expect(screen.queryByText("Unfinished from before today")).toBeNull()
      );
    }

    fireEvent.click(screen.getByTitle("Review your week"));
    const dialog = await screen.findByRole("dialog", { name: "Review" });
    expect(within(dialog).getByText("Kept putting off")).toBeTruthy();
    expect(within(dialog).getByText("vague big thing")).toBeTruthy();
  });

  it("says so plainly when there's nothing to review yet", async () => {
    render(<App />);
    await screen.findByPlaceholderText("Add a task for today…");
    fireEvent.click(screen.getByTitle("Review your week"));
    const dialog = await screen.findByRole("dialog", { name: "Review" });
    expect(within(dialog).getByText(/Nothing to review yet/)).toBeTruthy();
  });
});

describe("Waiting on someone else", () => {
  it("lets the day close — it isn't work you failed to do", async () => {
    render(<App />);
    await addTask("hear back from Ana");
    blurActive();
    fireEvent.keyDown(document.body, { key: "b" });

    const field = await screen.findByLabelText("Waiting on");
    fireEvent.change(field, { target: { value: "Ana" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(await screen.findByText(/waiting: Ana/)).toBeTruthy();
    // Nothing left that's yours to do → the day closes.
    expect(await screen.findByText("1 day running")).toBeTruthy();
  });

  it("never holds the morning gate shut", async () => {
    // The whole point: being blocked on someone else must not become a debt the
    // app collects from you tomorrow.
    render(<App />);
    await addTask("hear back from legal");
    blurActive();
    fireEvent.keyDown(document.body, { key: "b" });
    fireEvent.keyDown(await screen.findByLabelText("Waiting on"), { key: "Enter" });
    await screen.findByText(/waiting/);

    act(() => setDevDateOverride(addDays(todayISO(null), 1)));
    await waitFor(() =>
      expect(screen.queryByText("Unfinished from before today")).toBeNull()
    );
    // Still there, still unresolved — visible, not forgotten.
    expect(await screen.findByText("hear back from legal")).toBeTruthy();
  });

  it("unblocks with a second press, and the task counts again", async () => {
    render(<App />);
    await addTask("hear back from Ana");
    blurActive();
    fireEvent.keyDown(document.body, { key: "b" });
    fireEvent.keyDown(await screen.findByLabelText("Waiting on"), { key: "Enter" });
    await screen.findByText(/waiting/);

    fireEvent.keyDown(document.body, { key: "b" });
    await waitFor(() => expect(screen.queryByText(/waiting/)).toBeNull());
    expect(screen.getByText("1 to go · 0/1 done")).toBeTruthy();
  });

  it("clears the wait when the task is finally done", async () => {
    render(<App />);
    await addTask("hear back from Ana");
    blurActive();
    fireEvent.keyDown(document.body, { key: "b" });
    fireEvent.keyDown(await screen.findByLabelText("Waiting on"), { key: "Enter" });
    await screen.findByText(/waiting/);

    fireEvent.click(screen.getByLabelText("Mark complete"));
    await waitFor(() => expect(screen.queryByText(/waiting/)).toBeNull());
  });
});

describe("Coming back to a wall", () => {
  async function seedOverdue(n: number) {
    render(<App />);
    for (let i = 0; i < n; i++) await addTask(`overdue ${i}`);
    act(() => setDevDateOverride(addDays(todayISO(null), 1)));
    await screen.findByText("Unfinished from before today");
  }

  it("offers no amnesty for a pile you can just work through", async () => {
    await seedOverdue(2);
    expect(screen.queryByLabelText("Move them all to the Inbox")).toBeNull();
  });

  it("offers a way out once the pile is a wall", async () => {
    await seedOverdue(10);
    expect(screen.getByText(/10 commitments went past/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Move them all to the Inbox"));
    // Bulk and irreversible-feeling, so it asks — and defaults to *not* doing it.
    expect(await screen.findByText("Move 10 overdue tasks to the Inbox?")).toBeTruthy();
    fireEvent.click(screen.getByText("Move them"));

    await waitFor(() =>
      expect(screen.queryByText("Unfinished from before today")).toBeNull()
    );
  });

  it("keeps every task's history — an amnesty, not a leak", async () => {
    await seedOverdue(10);
    fireEvent.click(screen.getByLabelText("Move them all to the Inbox"));
    fireEvent.click(await screen.findByText("Move them"));
    await waitFor(() =>
      expect(screen.queryByText("Unfinished from before today")).toBeNull()
    );

    // They're in the Inbox, not gone, and the deferral is on the record.
    fireEvent.keyDown(document.body, { key: "2" });
    expect(await screen.findByText("overdue 0")).toBeTruthy();
  });
});

describe("Over-commitment", () => {
  /** `e` → the estimate picker → N blocks, on whatever the cursor is on. */
  async function estimateCursor(blocks: number) {
    fireEvent.keyDown(document.body, { key: "e" });
    const dialog = await screen.findByRole("dialog", { name: "Estimate" });
    fireEvent.keyDown(dialog, { key: String(blocks) });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Estimate" })).toBeNull()
    );
  }

  it("says so while you're committing, not the next morning", async () => {
    render(<App />);
    await addTask("a big one");
    await addTask("another big one");
    blurActive();

    await estimateCursor(8);
    fireEvent.keyDown(document.body, { key: "k" }); // up to the first task
    await estimateCursor(8); // 16 blocks against a 12-block day

    expect(await screen.findByText(/16 of 12 blocks committed/)).toBeTruthy();
    expect(screen.getByText(/isn't going to happen/)).toBeTruthy();
  });

  it("stays quiet while the day still fits", async () => {
    render(<App />);
    await addTask("a small one");
    blurActive();
    await estimateCursor(3);

    expect(screen.queryByText(/blocks committed/)).toBeNull();
  });
});

describe("The evening shutdown", () => {
  const openShutdown = () => {
    blurActive();
    fireEvent.keyDown(document.body, { key: "q" });
  };

  it("carries an unfinished task to tomorrow, closing today", async () => {
    render(<App />);
    await addTask("finish the deck");
    openShutdown();
    expect(await screen.findByText("Close the day")).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "t" }); // → tomorrow
    expect(await screen.findByText("The day is closed.")).toBeTruthy();

    // Today is closed, so the run starts…
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(await screen.findByText("1 day running")).toBeTruthy();
    // …and the task is waiting on tomorrow, not overdue.
    fireEvent.keyDown(document.body, { key: "]" });
    expect(await screen.findByText("finish the deck")).toBeTruthy();
  });

  it("means the morning gate has nothing left to catch", async () => {
    // The whole bargain: the Reckoning doesn't go away, you earn your way past
    // it the night before.
    render(<App />);
    await addTask("write the memo");
    openShutdown();
    fireEvent.keyDown(document.body, { key: "t" });
    await screen.findByText("The day is closed.");
    fireEvent.keyDown(document.body, { key: "Escape" });

    act(() => setDevDateOverride(addDays(todayISO(null), 1)));
    await waitFor(() =>
      expect(screen.queryByText("Unfinished from before today")).toBeNull()
    );
    expect(await screen.findByText("write the memo")).toBeTruthy();
  });

  it("counts a carry to tomorrow the same as a carry to today", async () => {
    // Facing it at 6pm is better behaviour, and it's rewarded by closing the day
    // — but the task really has been promised twice, whichever hour you admit it.
    render(<App />);
    await addTask("chase the quote");
    openShutdown();
    fireEvent.keyDown(document.body, { key: "t" });
    await screen.findByText("The day is closed.");
    fireEvent.keyDown(document.body, { key: "Escape" });

    fireEvent.keyDown(document.body, { key: "]" }); // tomorrow's tab
    expect(await screen.findByText(/carried 1×/)).toBeTruthy();
  });

  it("declines a task outright with w — a decision, not a failure", async () => {
    render(<App />);
    await addTask("that thing I never wanted");
    openShutdown();
    fireEvent.keyDown(document.body, { key: "w" });
    expect(await screen.findByText("The day is closed.")).toBeTruthy();
  });

  it("refuses to open while the gate is up — clear yesterday first", async () => {
    render(<App />);
    await addTask("yesterday's problem");
    act(() => setDevDateOverride(addDays(todayISO(null), 1)));
    await screen.findByText("Unfinished from before today");

    openShutdown();
    // Still the gate: two full-screen rituals fighting over the keyboard is
    // worse than either.
    expect(screen.getByText("Unfinished from before today")).toBeTruthy();
    expect(screen.queryByText("Close the day")).toBeNull();
  });

  it("carries everything left in one move", async () => {
    render(<App />);
    await addTask("one");
    await addTask("two");
    openShutdown();
    await screen.findByText("Close the day");

    fireEvent.keyDown(document.body, { key: "T", shiftKey: true }); // ⇧t — carry all
    expect(await screen.findByText("The day is closed.")).toBeTruthy();
  });
});

describe("The closing streak", () => {
  it("starts a run only once the day's commitments are all resolved", async () => {
    render(<App />);
    expect(await screen.findByText("Close today to start a run.")).toBeTruthy();

    await addTask("one thing");
    // Committed but unresolved — nothing earned yet.
    expect(screen.getByText("Close today to start a run.")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Mark complete"));
    expect(await screen.findByText("1 day running")).toBeTruthy();
  });

  it("counts a conscious 'won't do' as closing the day, not as a failure", async () => {
    render(<App />);
    await addTask("not doing this after all");
    blurActive();
    fireEvent.keyDown(document.body, { key: "Backspace" }); // open → won't do

    expect(await screen.findByText("1 day running")).toBeTruthy();
  });

  it("hands out nothing for a day that asked nothing — no run from avoiding work", async () => {
    render(<App />);
    await screen.findByPlaceholderText("Add a task for today…");
    // The incentive that matters: if empty days counted, the safest way to grow
    // a streak would be to stop committing to anything.
    expect(screen.getByText("Close today to start a run.")).toBeTruthy();
  });

  it("re-opens the day's work without retracting the close it already earned", async () => {
    render(<App />);
    await addTask("one thing");
    fireEvent.click(screen.getByLabelText("Mark complete"));
    await screen.findByText("1 day running");

    // Taking something back on is new work, not a retraction of the moment you
    // reached zero.
    fireEvent.click(screen.getByLabelText("Mark incomplete"));
    await waitFor(() => expect(screen.getByLabelText("Mark complete")).toBeTruthy());
    expect(screen.getByText("1 day running")).toBeTruthy();
  });
});

describe("Presence (the desktop shell)", () => {
  /**
   * Stub only the presence half of the bridge. `isElectron: false` keeps
   * persistence on its localStorage path, so the store still behaves as it does
   * in the browser — we're testing the wiring, not the shell.
   */
  function stubBridge() {
    const updates: Array<{ remaining: number; titles: string[] }> = [];
    let fire: (() => void) | null = null;
    window.execute = {
      isElectron: false,
      loadStore: async () => null,
      saveStore: async () => true,
      updatePresence: async (snap) => {
        updates.push({ remaining: snap.remaining, titles: snap.titles });
        return true;
      },
      onFocusCapture: (fn) => {
        fire = fn;
        return () => {
          fire = null;
        };
      },
    };
    return { updates, focusCapture: () => fire?.() };
  }

  afterEach(() => {
    delete window.execute;
  });

  it("tells the shell what's left today, so the menu bar can say so", async () => {
    const { updates } = stubBridge();
    render(<App />);
    await addTask("water the plants");

    await waitFor(() => {
      const last = updates[updates.length - 1];
      expect(last.remaining).toBe(1);
      expect(last.titles).toEqual(["water the plants"]);
    });

    // Finishing it is what makes the count fall — the whole point of the badge.
    fireEvent.click(screen.getByLabelText("Mark complete"));
    await waitFor(() =>
      expect(updates[updates.length - 1].remaining).toBe(0)
    );
  });

  it("the global capture shortcut lands the cursor in the capture bar", async () => {
    const { focusCapture } = stubBridge();
    render(<App />);
    const capture = await screen.findByPlaceholderText("Add a task for today…");
    blurActive();
    expect(document.activeElement).not.toBe(capture);

    act(() => focusCapture());
    expect(document.activeElement).toBe(capture);
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

  it("postponing a leftover makes you name a day rather than dropping it in a void", async () => {
    await seedTodayTaskThenRollOver("maybe later task");
    fireEvent.click(screen.getByLabelText("Postpone…"));

    // `s` used to unplan the task in one keystroke, uncounted. Now it asks when.
    const when = await screen.findByLabelText("When");
    fireEvent.change(when, { target: { value: "next week" } });
    fireEvent.keyDown(when, { key: "Enter" });

    await waitFor(() =>
      expect(screen.queryByText("Unfinished from before today")).toBeNull()
    );
    // …and it landed on the named rung, not in the undated backlog.
    fireEvent.keyDown(document.body, { key: "2" });
    expect(await screen.findByText("Next week")).toBeTruthy();
  });

  it("the undated backlog is still reachable — as a named choice", async () => {
    await seedTodayTaskThenRollOver("someday maybe");
    fireEvent.click(screen.getByLabelText("Postpone…"));
    const when = await screen.findByLabelText("When");
    fireEvent.change(when, { target: { value: "inbox" } });
    fireEvent.keyDown(when, { key: "Enter" });
    await waitFor(() =>
      expect(screen.queryByText("Unfinished from before today")).toBeNull()
    );
  });

  it("does not let a stale `s ↵` reflex quietly mean 'keep for today'", async () => {
    // `s` used to be a one-key backlog. It's a picker now, so whatever sits
    // under Enter inherits that reflex — and "Today" must not be it.
    await seedTodayTaskThenRollOver("old reflex");
    fireEvent.click(screen.getByLabelText("Postpone…"));
    const when = await screen.findByLabelText("When");
    fireEvent.keyDown(when, { key: "Enter" });

    await waitFor(() =>
      expect(screen.queryByText("Unfinished from before today")).toBeNull()
    );
    // Landed on Tomorrow: out of Today, and not counted as a carry.
    expect(screen.queryByText("old reflex")).toBeNull();
    expect(screen.queryByText(/carried/)).toBeNull();
  });

  it("postponing to Today is recorded as a carry, not a postponement", async () => {
    // Otherwise `s → Today` would launder a keep: same outcome as `t`, but with
    // the carry counter left untouched.
    await seedTodayTaskThenRollOver("sneaky keep");
    fireEvent.click(screen.getByLabelText("Postpone…"));
    const when = await screen.findByLabelText("When");
    fireEvent.change(when, { target: { value: "today" } });
    fireEvent.keyDown(when, { key: "Enter" });
    await waitFor(() =>
      expect(screen.queryByText("Unfinished from before today")).toBeNull()
    );
    expect(await screen.findByText(/carried 1×/)).toBeTruthy();
  });

  it("asks you to break a task down once it has been kept twice already", async () => {
    await seedTodayTaskThenRollOver("vague big thing");
    fireEvent.click(screen.getByLabelText("Keep for today"));
    await waitFor(() =>
      expect(screen.queryByText("Unfinished from before today")).toBeNull()
    );

    act(() => setDevDateOverride(addDays(todayISO(null), 2)));
    await screen.findByText("Unfinished from before today");
    fireEvent.click(screen.getByLabelText("Keep for today"));
    await waitFor(() =>
      expect(screen.queryByText("Unfinished from before today")).toBeNull()
    );

    // Third time: the bare keep is no longer free.
    act(() => setDevDateOverride(addDays(todayISO(null), 3)));
    await screen.findByText("Unfinished from before today");
    fireEvent.click(screen.getByLabelText("Keep for today"));
    expect(await screen.findByText("Kept for today 2 times already")).toBeTruthy();

    // …but it's a prompt, never a block: declining keeps it anyway.
    fireEvent.click(screen.getByText("Keep it anyway"));
    await waitFor(() =>
      expect(screen.queryByText("Unfinished from before today")).toBeNull()
    );
    expect(await screen.findByText(/carried 3×/)).toBeTruthy();
  });

  it("asks whether it's ever happening once a task has been postponed three times", async () => {
    await seedTodayTaskThenRollOver("chase the invoice");
    const postponeToTomorrow = async () => {
      fireEvent.click(screen.getByLabelText("Postpone…"));
      const when = await screen.findByLabelText("When");
      fireEvent.change(when, { target: { value: "tomorrow" } });
      fireEvent.keyDown(when, { key: "Enter" });
      await waitFor(() =>
        expect(screen.queryByText("Unfinished from before today")).toBeNull()
      );
    };
    // Each round: postpone to tomorrow, then let that day pass unfinished.
    for (const day of [1, 3, 5]) {
      if (day > 1) {
        act(() => setDevDateOverride(addDays(todayISO(null), day)));
        await screen.findByText("Unfinished from before today");
      }
      await postponeToTomorrow();
    }

    act(() => setDevDateOverride(addDays(todayISO(null), 7)));
    await screen.findByText("Unfinished from before today");
    expect(screen.getByText(/postponed 3×/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Postpone…"));
    expect(await screen.findByText("Postponed 3 times already")).toBeTruthy();

    // Accepting resolves it as "won't do" — a decision, and a reversible one.
    fireEvent.click(screen.getByText("Won’t do"));
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

  it("postpones a whole over-committed group in one move", async () => {
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

    // The bulk escape still exists — it just can't be an unnamed dump any more.
    fireEvent.click(screen.getByLabelText("Postpone all…"));
    const when = await screen.findByLabelText("When");
    expect(within(screen.getByRole("dialog")).getByText(/2 tasks/)).toBeTruthy();
    fireEvent.change(when, { target: { value: "next week" } });
    fireEvent.keyDown(when, { key: "Enter" });

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

function panel(): HTMLElement {
  const el = document.querySelector('[data-keyzone="panel"]');
  if (!(el instanceof HTMLElement)) throw new Error("detail panel is not open");
  return el;
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
    fireEvent.keyDown(document.body, { key: "t" }); // defer → leaves Today, focus → bravo
    await waitFor(() => expect(screen.queryByText("charlie")).toBeNull());

    fireEvent.keyDown(document.body, { key: "ArrowDown" }); // bravo → delta (charlie's old slot)
    fireEvent.keyDown(document.body, { key: "t" }); // defer delta
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

describe("Today view: drops done-only subtrees", () => {
  it("removes a not-for-today parent from Today once its only today child is completed", async () => {
    render(<App />);
    await addTask("umbrella");
    await addTask("do today");
    blurActive();
    fireEvent.keyDown(document.body, { key: "Tab" }); // "do today" → child of "umbrella"
    fireEvent.keyDown(document.body, { key: "ArrowUp" }); // focus the parent
    fireEvent.keyDown(document.body, { key: "t" }); // defer the parent (not for today)
    fireEvent.keyDown(document.body, { key: "ArrowDown" }); // back to the child

    // While the child is open, the parent shows as context.
    expect(screen.getByText("umbrella")).toBeTruthy();

    // Completing it leaves no open today-work under the parent → the whole
    // subtree drops from Today (no hide-completed needed).
    fireEvent.keyDown(document.body, { key: " " });
    await waitFor(() => {
      expect(screen.queryByText("do today")).toBeNull();
      expect(screen.queryByText("umbrella")).toBeNull();
    });
  });

  it("keeps a completed top-level task planned for today (a direct commitment)", async () => {
    render(<App />);
    await addTask("shipped it");
    blurActive();
    fireEvent.keyDown(document.body, { key: " " }); // complete it
    // A top-level today task lingers when done (progress / satisfaction), unlike a
    // done sub-step of a non-today epic.
    await waitFor(() => expect(screen.getByLabelText("Mark incomplete")).toBeTruthy());
    expect(screen.getByText("shipped it")).toBeTruthy();
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
    fireEvent.keyDown(document.body, { key: "t" }); // defer mid
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
    fireEvent.keyDown(document.body, { key: "t" }); // defer mid → cursor lands on "first" (row above)
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

  /** True when `a` is rendered before `b`. */
  function precedes(a: string, b: string): boolean {
    return Boolean(
      screen.getByText(a).compareDocumentPosition(screen.getByText(b)) &
        Node.DOCUMENT_POSITION_FOLLOWING
    );
  }

  it("⌥↓ clears a whole run of suggested-band siblings in one press", async () => {
    // The reported bug. A parent with four children: two planned for today (in
    // the outline) and two on soft horizons, which Today re-lists at the foot
    // under "Suggested for today". All four are on screen, so every one of them
    // counted as a neighbour — and the two presses that swapped into a suggestion
    // moved the tree without moving anything visible. ⌥↓ looked broken until the
    // third press. A month anchor in the past always suggests today.
    render(<App />);
    await screen.findByPlaceholderText("Add a task for today…");
    const today = todayISO(null);
    act(() => {
      const parent = addTaskAfter(null, "parent", null);
      addChild(parent, "kid-one", today);
      const soft1 = addChild(parent, "soft-one", null);
      const soft2 = addChild(parent, "soft-two", null);
      addChild(parent, "kid-two", today);
      setHorizonMany([soft1, soft2], { unit: "month", anchor: "2020-01" });
    });
    await screen.findByText("kid-one");
    // Both soft children render — in the band, below the outline.
    expect(precedes("kid-two", "soft-one")).toBe(true);
    blurActive();

    // Rows top to bottom: the Inbox header, parent, kid-one, kid-two, the band.
    fireEvent.keyDown(document.body, { key: "ArrowUp", metaKey: true }); // → Inbox header
    fireEvent.keyDown(document.body, { key: "ArrowDown" }); // parent
    fireEvent.keyDown(document.body, { key: "ArrowDown" }); // kid-one
    fireEvent.keyDown(document.body, { key: "ArrowDown", altKey: true });

    await waitFor(() => expect(precedes("kid-two", "kid-one")).toBe(true));
    // …and back, in one press too.
    fireEvent.keyDown(document.body, { key: "ArrowUp", altKey: true });
    await waitFor(() => expect(precedes("kid-one", "kid-two")).toBe(true));
  });

  it("⌥↓ on a suggested-band row moves nothing, rather than shuffling the tree", async () => {
    // The band is a derived list of soft picks, not an order anyone curated —
    // and a "move" there lands on the task's real siblings, out of sight. The
    // honest answer is to do nothing.
    render(<App />);
    await screen.findByPlaceholderText("Add a task for today…");
    const today = todayISO(null);
    act(() => {
      const parent = addTaskAfter(null, "parent", null);
      addChild(parent, "kid-one", today);
      const soft1 = addChild(parent, "soft-one", null);
      const soft2 = addChild(parent, "soft-two", null);
      setHorizonMany([soft1, soft2], { unit: "month", anchor: "2020-01" });
    });
    await screen.findByText("soft-one");
    blurActive();

    // Rows: the Inbox header, parent, kid-one, then soft-one / soft-two in the band.
    fireEvent.keyDown(document.body, { key: "ArrowUp", metaKey: true }); // → Inbox header
    for (let i = 0; i < 3; i++) fireEvent.keyDown(document.body, { key: "ArrowDown" });
    fireEvent.keyDown(document.body, { key: "ArrowDown", altKey: true });

    await waitFor(() => expect(precedes("soft-one", "soft-two")).toBe(true));
    expect(precedes("kid-one", "soft-one")).toBe(true);
  });

  it("⌥↓ in Later's by-date layout moves inside the bucket, not past it", async () => {
    // Same failure, different cause: Later groups roots by horizon, so a task's
    // raw next sibling is often rendered in another bucket entirely. Swapping
    // into it changed nothing on screen.
    render(<App />);
    await screen.findByPlaceholderText("Add a task for today…");
    const today = todayISO(null);
    act(() => {
      const a = addTaskAfter(null, "week-one", null);
      const b = addTaskAfter(a, "month-later", null);
      const c = addTaskAfter(b, "week-two", null);
      setHorizonMany([a, c], { unit: "week", anchor: weekKey(today) });
      setHorizonMany([b], { unit: "month", anchor: monthKeyOffset(today, 1) });
    });
    blurActive();
    fireEvent.keyDown(document.body, { key: "2" }); // → Later, by date
    await screen.findByText("week-one");
    // The two week tasks share a bucket; the month one renders below, in its own.
    expect(precedes("week-two", "month-later")).toBe(true);

    fireEvent.keyDown(document.body, { key: "ArrowUp", metaKey: true }); // → week-one
    fireEvent.keyDown(document.body, { key: "ArrowDown", altKey: true });

    await waitFor(() => expect(precedes("week-two", "week-one")).toBe(true));
    // The other bucket stayed put.
    expect(precedes("week-one", "month-later")).toBe(true);
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

  it("schedules by clicking a chip: Tomorrow moves the task out of Today", async () => {
    render(<App />);
    await addTask("clicky");
    blurActive();

    fireEvent.keyDown(document.body, { key: "ArrowRight" }); // open the panel
    fireEvent.click(await within(panel()).findByText("Tomorrow"));
    await waitFor(() => expect(screen.queryByText("clicky")).toBeNull());
  });

  it("clicking the active chip clears the schedule back to Inbox", async () => {
    render(<App />);
    await addTask("undone"); // planned today → the Today chip is the active one
    blurActive();

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    fireEvent.click(await within(panel()).findByText("Today"));
    await waitFor(() => expect(screen.queryByText("undone")).toBeNull()); // left Today
  });

  it("schedules an exact date from the panel's date field", async () => {
    render(<App />);
    await addTask("dated");
    blurActive();

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    const dateInput = await screen.findByLabelText("Schedule date");
    fireEvent.change(dateInput, { target: { value: addDays(todayISO(null), 3) } });
    fireEvent.blur(dateInput);
    await waitFor(() => expect(screen.queryByText("dated")).toBeNull()); // left Today

    blurActive();
    fireEvent.keyDown(document.body, { key: "3" }); // All
    expect(await screen.findByText("dated")).toBeTruthy();
    expect(screen.getByText("in 3d")).toBeTruthy(); // the date chip
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

describe("Task IDs", () => {
  it("shows a 4-char id chip on the row and copies the full id on click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<App />);
    await addTask("chip me");
    blurActive();

    const chip = screen.getByRole("button", { name: /task id .* click to copy/i });
    expect(chip.textContent).toHaveLength(4); // first 4 chars of the id
    fireEvent.click(chip);

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const full = writeText.mock.calls[0][0] as string;
    expect(full.startsWith(chip.textContent as string)).toBe(true);
    expect(full.length).toBeGreaterThan(4);
  });

  it("copies the focused task's id via the Cmd+K command", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<App />);
    await addTask("bug here");
    blurActive();

    fireEvent.keyDown(document.body, { key: "k", metaKey: true });
    const palette = await screen.findByPlaceholderText("Type a command…");
    fireEvent.change(palette, { target: { value: "copy task id" } });
    fireEvent.keyDown(palette, { key: "Enter" });

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect((writeText.mock.calls[0][0] as string).length).toBeGreaterThan(4);
  });
});

describe("Schedule picker (s)", () => {
  it("offers Tomorrow and schedules the task for it (leaves Today)", async () => {
    render(<App />);
    await addTask("call the bank"); // captured into Today
    blurActive();

    fireEvent.keyDown(document.body, { key: "s" }); // open the schedule picker
    const picker = await screen.findByRole("dialog", { name: "Schedule" });
    fireEvent.click(within(picker).getByText("Tomorrow"));

    // Planned for tomorrow (a future date) → drops out of Today…
    await waitFor(() => expect(screen.queryByText("call the bank")).toBeNull());
    // …and is still there in All.
    fireEvent.keyDown(document.body, { key: "3" });
    expect(await screen.findByText("call the bank")).toBeTruthy();
  });

  it("takes typed words: “next week” filters to that rung, ↵ picks it", async () => {
    render(<App />);
    await screen.findByPlaceholderText("Add a task for today…");
    // Pin to a Monday, or the suggested-day engine projects a this/next-week
    // horizon back onto today and the task never leaves the list.
    act(() => setDevDateOverride("2026-06-15"));
    await addTask("draft the proposal");
    blurActive();

    fireEvent.keyDown(document.body, { key: "s" });
    const picker = await screen.findByRole("dialog", { name: "Schedule" });
    const when = within(picker).getByLabelText("When");
    fireEvent.change(when, { target: { value: "next week" } });

    // The list narrows to the one rung that matches — no mnemonic letter needed.
    const options = within(picker).getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("Next week");

    fireEvent.keyDown(when, { key: "Enter" });
    await waitFor(() => expect(screen.queryByText("draft the proposal")).toBeNull());
    fireEvent.keyDown(document.body, { key: "2" }); // Later
    expect(await screen.findByText("draft the proposal")).toBeTruthy();
    expect(screen.getByText("Next week")).toBeTruthy(); // its bucket header
  });

  it("reads a typed date and schedules the exact day", async () => {
    render(<App />);
    await screen.findByPlaceholderText("Add a task for today…");
    act(() => setDevDateOverride("2026-06-15")); // a Monday
    await addTask("dentist");
    blurActive();

    fireEvent.keyDown(document.body, { key: "s" });
    const picker = await screen.findByRole("dialog", { name: "Schedule" });
    const when = within(picker).getByLabelText("When");
    fireEvent.change(when, { target: { value: "friday" } });

    // The concrete date leads, spelled out so there's nothing to second-guess.
    const options = within(picker).getAllByRole("option");
    expect(options[0].textContent).toContain("Friday, June 19");
    fireEvent.keyDown(when, { key: "Enter" });

    await waitFor(() => expect(screen.queryByText("dentist")).toBeNull()); // left Today
    fireEvent.keyDown(document.body, { key: "3" }); // All
    expect(await screen.findByText("dentist")).toBeTruthy();
    expect(screen.getByText("in 4d")).toBeTruthy(); // the date chip
  });

  it("says so rather than guessing when the query means nothing", async () => {
    render(<App />);
    await addTask("something");
    blurActive();

    fireEvent.keyDown(document.body, { key: "s" });
    const picker = await screen.findByRole("dialog", { name: "Schedule" });
    fireEvent.change(within(picker).getByLabelText("When"), { target: { value: "zzz" } });

    expect(within(picker).queryAllByRole("option")).toHaveLength(0);
    expect(within(picker).getByText(/Nothing matches/)).toBeTruthy();
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
    // Pin to a Monday: later in the week, the suggested-day engine would clamp a
    // "this week" task's suggestion to *today* and resurface it in Today.
    await screen.findByPlaceholderText("Add a task for today…");
    act(() => setDevDateOverride("2026-06-15"));
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
    expect(screen.getByText(/resolved hidden/)).toBeTruthy(); // indicator pill

    fireEvent.keyDown(document.body, { key: "h" }); // show again
    expect(await screen.findByText("finish me")).toBeTruthy();
  });

  it("h hides won't-do tasks too — both are resolved states", async () => {
    render(<App />);
    await addTask("keep me");
    await addTask("skip me"); // focus = skip me
    blurActive();

    fireEvent.keyDown(document.body, { key: "Backspace" }); // → won't do
    expect(await screen.findByLabelText(/won.t do/i)).toBeTruthy();
    blurActive(); // leave the inline reason field
    fireEvent.keyDown(document.body, { key: "h" });

    await waitFor(() => expect(screen.queryByText("skip me")).toBeNull());
    expect(screen.getByText("keep me")).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "h" }); // show again
    expect(await screen.findByText("skip me")).toBeTruthy();
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
    // Pin to a Monday: later in the week, the suggested-day engine would clamp a
    // "this week" task's suggestion to *today* and resurface it in Today.
    await screen.findByPlaceholderText("Add a task for today…");
    act(() => setDevDateOverride("2026-06-15"));
    await addTask("write spec"); // planned today by default
    blurActive();

    fireEvent.keyDown(document.body, { key: "s" }); // open the scheduler
    const picker = await screen.findByRole("dialog", { name: "Schedule" });
    fireEvent.click(within(picker).getByText("This week")); // pick the bucket

    // It leaves Today (now a fuzzy horizon, not a concrete date).
    await waitFor(() => expect(screen.queryByText("write spec")).toBeNull());

    blurActive();
    fireEvent.keyDown(document.body, { key: "2" }); // Later view (by-date default)
    expect(await screen.findByText("write spec")).toBeTruthy();
    expect(screen.getByText("This week")).toBeTruthy(); // the bucket header
  });

  it("t defers a today task to tomorrow (it leaves Today, gains the chip)", async () => {
    render(<App />);
    await addTask("prep slides"); // planned today by default
    blurActive();

    fireEvent.keyDown(document.body, { key: "t" }); // today → tomorrow
    await waitFor(() => expect(screen.queryByText("prep slides")).toBeNull());

    fireEvent.keyDown(document.body, { key: "3" }); // All
    expect(await screen.findByText("prep slides")).toBeTruthy();
    expect(screen.getByText("tomorrow")).toBeTruthy(); // the date chip
  });

  it("t and ⇧t walk the schedule ladder, wrapping at the ends", async () => {
    render(<App />);
    await addTask("stepper"); // planned today
    blurActive();

    fireEvent.keyDown(document.body, { key: "3" }); // All — stays visible while stepping
    await screen.findByText("stepper");

    fireEvent.keyDown(document.body, { key: "t" }); // today → tomorrow
    expect(await screen.findByText("tomorrow")).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "t" }); // tomorrow → this week (fuzzy)
    await waitFor(() => expect(screen.queryByText("tomorrow")).toBeNull());

    fireEvent.keyDown(document.body, { key: "T", shiftKey: true }); // this week → back to tomorrow
    expect(await screen.findByText("tomorrow")).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "T", shiftKey: true }); // tomorrow → today
    expect(await screen.findByText("today")).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "T", shiftKey: true }); // today → inbox (wrap = unplan)
    await waitFor(() => expect(screen.queryByText("today")).toBeNull());
  });

  it("toggles the Later view between by-date and by-project", async () => {
    render(<App />);
    await addTask("later thing");
    blurActive();
    fireEvent.keyDown(document.body, { key: "s" });
    const picker = await screen.findByRole("dialog", { name: "Schedule" });
    fireEvent.click(within(picker).getByText("Someday"));

    blurActive();
    fireEvent.keyDown(document.body, { key: "2" }); // Later view
    expect(await screen.findByText("Someday")).toBeTruthy(); // by-date bucket

    fireEvent.click(screen.getByText("By project"));
    await waitFor(() => expect(screen.queryByText("Someday")).toBeNull()); // bucket gone
    expect(screen.getByText("later thing")).toBeTruthy(); // still listed, now by project
  });
});

describe("Cascade a schedule change to subtasks", () => {
  // A parent ("big rock") planned today with one subtask ("pebble"), parent focused.
  async function seedParentChild() {
    render(<App />);
    // Pin to a Monday: later in the week, the suggested-day engine would clamp a
    // "this week" task's suggestion to *today* and resurface it in Today.
    await screen.findByPlaceholderText("Add a task for today…");
    act(() => setDevDateOverride("2026-06-15"));
    await addTask("big rock");
    await addTask("pebble");
    blurActive();
    fireEvent.keyDown(document.body, { key: "Tab" }); // pebble → subtask of big rock
    fireEvent.keyDown(document.body, { key: "ArrowUp" }); // focus the parent
  }

  it("y applies the choice to the whole subtree, and one ⌘z reverts it all", async () => {
    await seedParentChild();

    fireEvent.keyDown(document.body, { key: "s" }); // the deliberate path prompts
    const picker = await screen.findByRole("dialog", { name: "Schedule" });
    fireEvent.click(within(picker).getByText("This week"));
    await screen.findByText("Also schedule its subtask?");
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "y" });

    // Both now carry the This-week horizon → they appear in Later together.
    blurActive();
    fireEvent.keyDown(document.body, { key: "2" });
    expect(await screen.findByText("big rock")).toBeTruthy();
    expect(await screen.findByText("pebble")).toBeTruthy();

    // The cascade was one store update, so a single undo restores everything.
    fireEvent.keyDown(document.body, { key: "z", metaKey: true });
    await waitFor(() => expect(screen.queryByText("big rock")).toBeNull()); // left Later
    fireEvent.keyDown(document.body, { key: "1" }); // Today
    expect(await screen.findByText("big rock")).toBeTruthy();
    expect(screen.getByText("pebble")).toBeTruthy();
  });

  it("Enter keeps the safe default: only the task itself is rescheduled", async () => {
    await seedParentChild();

    fireEvent.keyDown(document.body, { key: "s" });
    const picker = await screen.findByRole("dialog", { name: "Schedule" });
    fireEvent.click(within(picker).getByText("This week"));
    await screen.findByText("Also schedule its subtask?");
    // The Enter default is spelled out (and visually emphasized) as its own button.
    expect(screen.getByText("Just this task")).toBeTruthy();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Enter" });

    // The subtask stays planned for today…
    expect(await screen.findByText("pebble")).toBeTruthy();
    // …while the parent moved to the This-week bucket in Later.
    blurActive();
    fireEvent.keyDown(document.body, { key: "2" });
    expect(await screen.findByText("big rock")).toBeTruthy();
    expect(screen.getByText("This week")).toBeTruthy();
  });
});

describe("Period tabs (home view)", () => {
  const heading = () => screen.getByRole("heading", { level: 1 }).textContent;

  it("] and [ walk the tabs; a deferred task shows up under Tomorrow", async () => {
    render(<App />);
    await addTask("pack bags"); // planned today
    blurActive();

    fireEvent.keyDown(document.body, { key: "t" }); // defer → tomorrow, leaves Today
    await waitFor(() => expect(screen.queryByText("pack bags")).toBeNull());

    fireEvent.keyDown(document.body, { key: "]" }); // Today → Tomorrow tab
    await waitFor(() => expect(heading()).toBe("Tomorrow"));
    expect(screen.getByText("pack bags")).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "[" }); // back home
    await waitFor(() => expect(heading()).toBe("Today"));
  });

  it("capturing inside the Tomorrow tab schedules the new task for tomorrow", async () => {
    render(<App />);
    await screen.findByPlaceholderText("Add a task for today…");
    blurActive();

    fireEvent.keyDown(document.body, { key: "]" });
    const capture = await screen.findByPlaceholderText("Add a task for tomorrow…");
    fireEvent.change(capture, { target: { value: "buy tickets" } });
    fireEvent.keyDown(capture, { key: "Enter" });
    expect(await screen.findByText("buy tickets")).toBeTruthy();

    (capture as HTMLInputElement).blur();
    fireEvent.keyDown(document.body, { key: "[" }); // Today shouldn't have it
    await waitFor(() => expect(heading()).toBe("Today"));
    expect(screen.queryByText("buy tickets")).toBeNull();
  });

  it("This week nests day separators inside the project, fuzzy tasks under Anytime", async () => {
    render(<App />);
    await screen.findByPlaceholderText("Add a task for today…");
    act(() => setDevDateOverride("2026-06-17")); // Wednesday of ISO week 25
    await addTask("dated one"); // planned today (Jun 17)
    await addTask("fuzzy one");
    blurActive();

    // "fuzzy one" (focused) → soft this-week horizon, via the palette.
    fireEvent.keyDown(document.body, { key: "k", metaKey: true });
    const palette = await screen.findByPlaceholderText("Type a command…");
    fireEvent.change(palette, { target: { value: "this week" } });
    fireEvent.keyDown(palette, { key: "Enter" });

    blurActive();
    fireEvent.keyDown(document.body, { key: "]" });
    fireEvent.keyDown(document.body, { key: "]" }); // Today → Tomorrow → This week
    await waitFor(() => expect(heading()).toBe("This week"));

    expect(screen.getByText("dated one")).toBeTruthy(); // under its day…
    expect(screen.getByText("Wednesday · Jun 17 · today")).toBeTruthy();
    expect(screen.getByText("fuzzy one")).toBeTruthy(); // …and the fuzz trails
    expect(screen.getByText("Anytime this week")).toBeTruthy();
  });

  it("pressing 1 returns to the Today tab from any period", async () => {
    render(<App />);
    await screen.findByPlaceholderText("Add a task for today…");
    blurActive();

    fireEvent.keyDown(document.body, { key: "]" });
    fireEvent.keyDown(document.body, { key: "]" });
    await waitFor(() => expect(heading()).toBe("This week"));

    fireEvent.keyDown(document.body, { key: "1" });
    await waitFor(() => expect(heading()).toBe("Today"));
  });
});

describe("Peek (in-place preview, p)", () => {
  async function addTaskWithNotes(text: string, notesText: string) {
    render(<App />);
    await addTask(text);
    blurActive();
    fireEvent.keyDown(document.body, { key: "ArrowRight" }); // panel (preview)
    fireEvent.keyDown(document.body, { key: "Tab" }); // dive into notes
    const notes = await screen.findByPlaceholderText(NOTES_PLACEHOLDER);
    fireEvent.change(notes, { target: { value: notesText } });
    fireEvent.keyDown(notes, { key: "Escape" }); // save, back to the list
    fireEvent.keyDown(document.body, { key: "Escape" }); // close the panel
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(NOTES_PLACEHOLDER)).toBeNull()
    );
  }

  it("p unwraps the focused task in place, showing its notes; p again closes", async () => {
    await addTaskWithNotes("dense task", "the deep details");
    expect(screen.queryByText("the deep details")).toBeNull(); // panel closed

    fireEvent.keyDown(document.body, { key: "p" });
    expect(await screen.findByText("the deep details")).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "p" });
    await waitFor(() => expect(screen.queryByText("the deep details")).toBeNull());
  });

  it("the peek is pinned to its row: moving the cursor closes it", async () => {
    await addTaskWithNotes("annotated", "hidden context");
    await addTask("plain sibling"); // focus moves here
    blurActive();
    fireEvent.keyDown(document.body, { key: "ArrowUp" }); // focus "annotated"

    fireEvent.keyDown(document.body, { key: "p" });
    expect(await screen.findByText("hidden context")).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "ArrowDown" }); // leave the row
    await waitFor(() => expect(screen.queryByText("hidden context")).toBeNull());
  });
});

describe("Schedule inheritance in the views", () => {
  it("scheduling only the parent still shows its subtasks in that window", async () => {
    render(<App />);
    await addTask("compras de la semana");
    await addTask("frutas");
    blurActive();
    fireEvent.keyDown(document.body, { key: "Tab" }); // frutas → subtask
    fireEvent.keyDown(document.body, { key: "T", shiftKey: true }); // unplan the child (own schedule: none)
    fireEvent.keyDown(document.body, { key: "ArrowUp" }); // focus the parent

    fireEvent.keyDown(document.body, { key: "s" });
    const picker = await screen.findByRole("dialog", { name: "Schedule" });
    fireEvent.click(within(picker).getByText("This week"));
    await screen.findByText("Also schedule its subtask?");
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Enter" }); // just the parent

    blurActive();
    fireEvent.keyDown(document.body, { key: "]" });
    fireEvent.keyDown(document.body, { key: "]" }); // → This week tab
    expect(await screen.findByText("compras de la semana")).toBeTruthy();
    expect(screen.getByText("frutas")).toBeTruthy(); // inherited membership
    expect(screen.getByText("Anytime this week")).toBeTruthy();

    // Hiding resolved must not prune the inherited (open) child either.
    fireEvent.keyDown(document.body, { key: "h" });
    expect(await screen.findByText("frutas")).toBeTruthy();
  });

  it("an unscheduled subtask stays visible under its today parent", async () => {
    render(<App />);
    await addTask("parent today");
    await addTask("loose end");
    blurActive();
    fireEvent.keyDown(document.body, { key: "Tab" }); // nest under the parent
    fireEvent.keyDown(document.body, { key: "T", shiftKey: true }); // unplan the child

    // It inherits the parent's today deadline, so Today still lists it.
    expect(await screen.findByText("loose end")).toBeTruthy();
    expect(screen.getByText("parent today")).toBeTruthy();
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

  it("files a recurrence under a project, and its occurrences land there", async () => {
    render(<App />);
    await screen.findByPlaceholderText("Add a task for today…");
    blurActive();
    act(() => createProject("Health"));

    fireEvent.keyDown(document.body, { key: "5" }); // Recurring
    const cap = await screen.findByPlaceholderText(/New recurring task/);
    fireEvent.change(cap, { target: { value: "Stretch" } });
    fireEvent.keyDown(cap, { key: "Enter" });
    await screen.findByText("Stretch");

    // ⇧p files whatever the cursor is on — here, the recurrence template.
    blurActive();
    fireEvent.keyDown(document.body, { key: "P", shiftKey: true });
    const picker = await screen.findByRole("dialog", { name: "Project" });
    const name = within(picker).getByLabelText("Project name");
    fireEvent.change(name, { target: { value: "heal" } });
    fireEvent.keyDown(name, { key: "Enter" });

    // The row now says where it's filed.
    expect(await screen.findByTitle(/Filed under Health/)).toBeTruthy();

    // In Today the suggestion advertises where taking it on will put it…
    blurActive();
    fireEvent.keyDown(document.body, { key: "1" });
    await screen.findByText("Recurring today");
    expect(screen.getByTitle("Lands in Health")).toBeTruthy();

    // …and accepting it files the real task under that project, not the Inbox.
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    fireEvent.keyDown(document.body, { key: "t" });
    await waitFor(() => expect(screen.queryByText("Recurring today")).toBeNull());
    expect(screen.getByText("Health")).toBeTruthy(); // its project group header
    expect(screen.queryByText("Inbox")).toBeNull(); // nothing landed there
  });

  it("keeps ⇧p on a task filing the task, not the recurrence", async () => {
    render(<App />);
    await screen.findByPlaceholderText("Add a task for today…");
    blurActive();
    act(() => createProject("Errands"));
    await addTask("post the parcel");
    blurActive();

    fireEvent.keyDown(document.body, { key: "P", shiftKey: true });
    const picker = await screen.findByRole("dialog", { name: "Project" });
    fireEvent.click(within(picker).getByText("Errands"));

    // It moves out of the Inbox group and under Errands.
    expect(await screen.findByText("Errands")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Inbox")).toBeNull());
    expect(screen.getByText("post the parcel")).toBeTruthy();
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

describe("Estimates & the planning board", () => {
  it("sets an effort estimate on a task via the `e` picker", async () => {
    render(<App />);
    await addTask("estimate me");
    blurActive();

    fireEvent.keyDown(document.body, { key: "e" }); // open the estimate picker
    const dialog = await screen.findByRole("dialog", { name: "Estimate" });
    fireEvent.keyDown(dialog, { key: "3" }); // 3 blocks = 1h

    // The row shows the estimate (BlockPips carries the spelled-out label).
    await waitFor(() =>
      expect(screen.getByLabelText("3 blocks · 1h")).toBeTruthy()
    );
  });

  it("switches the reckoning to the board and pulls leftovers into today", async () => {
    render(<App />);
    await addTask("overdue one");
    await addTask("overdue two");
    blurActive();

    // Roll the day forward → both become leftovers → the reckoning gate opens.
    act(() => setDevDateOverride(addDays(todayISO(null), 1)));
    expect(await screen.findByText("Unfinished from before today")).toBeTruthy();

    // Flip to the board skin (persisted preference), then pull both in.
    fireEvent.keyDown(document.body, { key: "v" });
    expect(await screen.findByText("Pull what you can into today")).toBeTruthy();
    expect(screen.getByText("Today's load")).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "ArrowRight" }); // pull the first
    fireEvent.keyDown(document.body, { key: "ArrowRight" }); // pull the second

    // Both triaged → the gate clears and we're back in the normal Today view.
    await waitFor(() =>
      expect(screen.queryByText("Pull what you can into today")).toBeNull()
    );
    expect(screen.getByText("overdue one")).toBeTruthy();
    expect(screen.getByText("overdue two")).toBeTruthy();
  });

  it("sends an over-pulled task back off today (Tab to Today, then ←)", async () => {
    render(<App />);
    await addTask("alpha");
    await addTask("bravo");
    blurActive();

    act(() => setDevDateOverride(addDays(todayISO(null), 1)));
    await screen.findByText("Unfinished from before today");
    fireEvent.keyDown(document.body, { key: "v" });
    await screen.findByText("Pull what you can into today");

    // Today starts empty (both are overdue leftovers).
    expect(screen.getByText(/Nothing committed yet/)).toBeTruthy();

    // Pull the first leftover into today → the empty-state goes away.
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    await waitFor(() => expect(screen.queryByText(/Nothing committed yet/)).toBeNull());

    // Tab into the Today column, then ← to send it back off today.
    fireEvent.keyDown(document.body, { key: "Tab" });
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });

    // Today is empty again, and the gate is still open (bravo remains).
    await waitFor(() => expect(screen.getByText(/Nothing committed yet/)).toBeTruthy());
    expect(screen.getByText("Pull what you can into today")).toBeTruthy();
  });
});

describe("Undo, redo and the history panel", () => {
  /** Capture a task from the bar, then step back out to the normal context. */
  async function capture(text: string): Promise<HTMLInputElement> {
    const input = (await screen.findByPlaceholderText(
      "Add a task for today…"
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText(text);
    input.blur();
    return input;
  }

  it("⌘⇧z redoes what ⌘z just undid", async () => {
    render(<App />);
    await capture("redo me");

    fireEvent.keyDown(document.body, { key: " " }); // complete it
    await waitFor(() => expect(screen.getByLabelText("Mark incomplete")).toBeTruthy());

    fireEvent.keyDown(document.body, { key: "z", metaKey: true });
    await waitFor(() => expect(screen.getByLabelText("Mark complete")).toBeTruthy());

    // ⌘⇧z arrives as an uppercase "Z" — shift is folded into the letter's case.
    fireEvent.keyDown(document.body, { key: "Z", metaKey: true, shiftKey: true });
    await waitFor(() => expect(screen.getByLabelText("Mark incomplete")).toBeTruthy());
  });

  it("⌘y opens the history, naming what was done", async () => {
    render(<App />);
    await capture("buy oat milk");
    fireEvent.keyDown(document.body, { key: " " });
    await waitFor(() => expect(screen.getByLabelText("Mark incomplete")).toBeTruthy());

    fireEvent.keyDown(document.body, { key: "y", metaKey: true });

    const list = await screen.findByRole("listbox", { name: "Action history" });
    expect(within(list).getByText("Complete “buy oat milk”")).toBeTruthy();
    expect(within(list).getByText("New task “buy oat milk”")).toBeTruthy();
  });

  it("rewinds through the selected history line and records the undo", async () => {
    render(<App />);
    await capture("first");
    fireEvent.keyDown(document.body, { key: " " }); // complete
    await waitFor(() => expect(screen.getByLabelText("Mark incomplete")).toBeTruthy());

    fireEvent.keyDown(document.body, { key: "y", metaKey: true });
    await screen.findByRole("listbox", { name: "Action history" });

    // The cursor starts on the newest line ("Complete …"); ↵ rewinds through it.
    fireEvent.keyDown(document.body, { key: "Enter" });
    await waitFor(() => expect(screen.getByLabelText("Mark complete")).toBeTruthy());

    const list = screen.getByRole("listbox", { name: "Action history" });
    expect(within(list).getByText("Undid complete “first”")).toBeTruthy();
  });

  it("closes on esc", async () => {
    render(<App />);
    await capture("anything");
    fireEvent.keyDown(document.body, { key: "y", metaKey: true });
    await screen.findByRole("listbox", { name: "Action history" });

    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("listbox", { name: "Action history" })).toBeNull()
    );
  });
});
