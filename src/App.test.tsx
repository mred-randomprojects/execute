import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { act } from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { App } from "./App";
import { initStore, setDevDateOverride } from "./store/store";
import { addDays, todayISO } from "./store/dates";

afterEach(cleanup);
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
});
