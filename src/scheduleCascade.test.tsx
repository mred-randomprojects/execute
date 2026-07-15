import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { App } from "./App";
import { initStore } from "./store/store";

afterEach(cleanup);
beforeEach(async () => {
  localStorage.clear();
  await initStore();
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

describe("schedule cascade", () => {
  it("does not cascade a schedule onto a completed subtask", async () => {
    render(<App />);
    await addTask("parent");
    await addTask("done child");
    blurActive();
    fireEvent.keyDown(document.body, { key: "Tab" }); // done child → subtask of parent
    fireEvent.keyDown(document.body, { key: " " }); // complete it
    fireEvent.keyDown(document.body, { key: "ArrowUp" }); // focus the parent

    // The parent's only subtask is completed → there are no OPEN subtasks to
    // carry, so the "Also schedule its subtasks?" prompt must NOT appear. Before
    // the fix it did, stamping the done child with the new date and resurfacing
    // it in Today as if it had just been completed.
    fireEvent.keyDown(document.body, { key: "ArrowRight" }); // open the panel
    fireEvent.click(await within(panel()).findByText("Tomorrow"));

    await waitFor(() => expect(screen.queryByText("parent")).toBeNull()); // left Today
    expect(screen.queryByText(/Also schedule/)).toBeNull();
  });
});
