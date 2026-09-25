import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReadOnlyApp } from "./ReadOnlyApp";
import { makeTask } from "../store/tasks";
import { todayISO, addDays } from "../store/dates";
import { emptyState, type AppState } from "../types";

afterEach(cleanup);

function renderApp(state: AppState, extra: Partial<Parameters<typeof ReadOnlyApp>[0]> = {}) {
  return render(
    <ReadOnlyApp
      state={state}
      cloudUpdatedAt={null}
      notice={null}
      email="me@example.com"
      onSignOut={() => {}}
      onToggle={() => {}}
      onAdd={() => {}}
      onUpdate={() => {}}
      {...extra}
    />,
  );
}

describe("the phone's Today", () => {
  it("shows tasks left on a past day under Earlier instead of reading as empty", () => {
    const today = todayISO(null);
    const state: AppState = {
      ...emptyState(),
      tasks: [
        { ...makeTask("planned today"), plannedFor: today },
        { ...makeTask("left over"), plannedFor: addDays(today, -3) },
      ],
    };
    renderApp(state);
    expect(screen.getByText("planned today")).toBeTruthy();
    expect(screen.getByText("Earlier")).toBeTruthy();
    expect(screen.getByText("left over")).toBeTruthy();
  });

  it("says how fresh the cloud copy is", () => {
    renderApp(emptyState(), { cloudUpdatedAt: Date.now() - 9 * 86_400_000 });
    expect(screen.getByText("updated 9d ago")).toBeTruthy();
  });

  it("shows a notice with its action", () => {
    const onAction = vi.fn();
    renderApp(emptyState(), { notice: { text: "Couldn't save: offline", action: "Dismiss", onAction } });
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledOnce();
  });
});

describe("the phone's details sheet and account menu", () => {
  it("tapping a task opens its details; picking a day saves it", () => {
    const onUpdate = vi.fn();
    const today = todayISO(null);
    const t = { ...makeTask("water the plants"), plannedFor: today };
    renderApp({ ...emptyState(), tasks: [t] }, { onUpdate });
    fireEvent.click(screen.getByText("water the plants"));
    expect(screen.getByRole("dialog", { name: "Task details" })).toBeTruthy();
    fireEvent.click(screen.getByText("Tomorrow"));
    expect(onUpdate).toHaveBeenCalledWith(t.id, { plannedFor: addDays(today, 1) });
  });

  it("edits the title when the field is left, not on every keystroke", () => {
    const onUpdate = vi.fn();
    const t = { ...makeTask("old title"), plannedFor: todayISO(null) };
    renderApp({ ...emptyState(), tasks: [t] }, { onUpdate });
    fireEvent.click(screen.getByText("old title"));
    const field = screen.getByLabelText("Title");
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "new title" } });
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.blur(field);
    expect(onUpdate).toHaveBeenCalledWith(t.id, { text: "new title" });
  });

  it("sign out lives in the account menu", () => {
    const onSignOut = vi.fn();
    renderApp(emptyState(), { onSignOut });
    expect(screen.queryByText("Sign out")).toBeNull();
    fireEvent.click(screen.getByLabelText("Account"));
    fireEvent.click(screen.getByText("Sign out"));
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
