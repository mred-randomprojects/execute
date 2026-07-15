import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CommandPalette, type Command } from "./CommandPalette";

afterEach(cleanup);

const cmds: Command[] = [
  { id: "sched-step", label: "Schedule: one step later", run: () => {} },
  { id: "sched-today", label: "Schedule: Today", run: () => {} },
  { id: "goto-today", label: "Go to Today", run: () => {} },
  { id: "trash", label: "Empty trash", run: () => {} },
];

const type = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText("Type a command…"), { target: { value } });

describe("CommandPalette subsequence filter", () => {
  it("matches multi-token subsequences: 'sche tod' finds 'Schedule: Today' only", () => {
    render(<CommandPalette commands={cmds} onClose={() => {}} />);
    type("sche tod");
    expect(screen.getByText("Schedule: Today")).toBeTruthy();
    expect(screen.queryByText("Schedule: one step later")).toBeNull();
    expect(screen.queryByText("Go to Today")).toBeNull();
  });

  it("keeps single-token substring behavior unchanged", () => {
    render(<CommandPalette commands={cmds} onClose={() => {}} />);
    type("today");
    expect(screen.getByText("Schedule: Today")).toBeTruthy();
    expect(screen.getByText("Go to Today")).toBeTruthy();
    expect(screen.queryByText("Empty trash")).toBeNull();
  });

  it("requires tokens in order (subsequence, not just any-order AND)", () => {
    render(<CommandPalette commands={cmds} onClose={() => {}} />);
    type("today sche"); // reversed order → no match against "Schedule: Today"
    expect(screen.queryByText("Schedule: Today")).toBeNull();
  });
});
