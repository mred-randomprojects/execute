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
