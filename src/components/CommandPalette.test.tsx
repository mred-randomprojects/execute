import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CommandPalette, type Command } from "./CommandPalette";
import type { CommandUsage } from "../types";

afterEach(cleanup);

const cmds: Command[] = [
  { id: "sched-step", label: "Schedule: one step later", run: () => {} },
  { id: "sched-today", label: "Schedule: Today", run: () => {} },
  { id: "goto-today", label: "Go to Today", run: () => {} },
  { id: "trash", label: "Empty trash", run: () => {} },
];

const NOW = 1_000_000_000_000;
const usedAt = (count: number, ago = 0): CommandUsage => ({ count, lastUsedAt: NOW - ago });

const type = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText("Type a command…"), { target: { value } });

const input = () => screen.getByPlaceholderText("Type a command…");
const rowLabels = () =>
  screen.getAllByRole("option").map((el) => el.querySelector("span")?.textContent ?? "");

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

describe("CommandPalette frecency ranking", () => {
  it("keeps the authored order when nothing has been used", () => {
    render(<CommandPalette commands={cmds} onClose={() => {}} now={NOW} />);
    expect(rowLabels()).toEqual([
      "Schedule: one step later",
      "Schedule: Today",
      "Go to Today",
      "Empty trash",
    ]);
  });

  it("floats a used command to the top (empty query)", () => {
    render(
      <CommandPalette
        commands={cmds}
        usage={{ "goto-today": usedAt(5) }}
        onClose={() => {}}
        now={NOW}
      />,
    );
    expect(rowLabels()[0]).toBe("Go to Today");
  });

  it("ranks by frecency: recent-frequent over stale-frequent", () => {
    render(
      <CommandPalette
        commands={cmds}
        usage={{
          trash: usedAt(3, 0), // just now → weight 4 → 12
          "sched-today": usedAt(10, 60 * 24 * 3_600_000), // 60d old → weight 0.25 → 2.5
        }}
        onClose={() => {}}
        now={NOW}
      />,
    );
    const labels = rowLabels();
    expect(labels[0]).toBe("Empty trash");
    expect(labels[1]).toBe("Schedule: Today");
  });

  it("still ranks within a filtered search", () => {
    // Both contain "today"; the used one should come first.
    render(
      <CommandPalette
        commands={cmds}
        usage={{ "goto-today": usedAt(4) }}
        onClose={() => {}}
        now={NOW}
      />,
    );
    type("today");
    expect(rowLabels()).toEqual(["Go to Today", "Schedule: Today"]);
  });
});

describe("CommandPalette usage recording", () => {
  it("reports the run command via onUse on Enter", () => {
    const onUse = vi.fn();
    render(<CommandPalette commands={cmds} onClose={() => {}} onUse={onUse} now={NOW} />);
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onUse).toHaveBeenCalledWith("sched-step"); // first row
  });

  it("reports the clicked command via onUse", () => {
    const onUse = vi.fn();
    render(<CommandPalette commands={cmds} onClose={() => {}} onUse={onUse} now={NOW} />);
    fireEvent.click(screen.getByText("Go to Today"));
    expect(onUse).toHaveBeenCalledWith("goto-today");
  });
});

describe("CommandPalette reset ranking", () => {
  it("⌘⌫ on an empty query resets the highlighted command's ranking", () => {
    const onReset = vi.fn();
    render(
      <CommandPalette
        commands={cmds}
        usage={{ "goto-today": usedAt(5) }}
        onClose={() => {}}
        onResetRanking={onReset}
        now={NOW}
      />,
    );
    // "Go to Today" is ranked first (sel = 0) and has a ranking.
    fireEvent.keyDown(input(), { key: "Backspace", metaKey: true });
    expect(onReset).toHaveBeenCalledWith("goto-today");
  });

  it("does not reset (lets ⌘⌫ edit text) while a query is present", () => {
    const onReset = vi.fn();
    render(
      <CommandPalette
        commands={cmds}
        usage={{ "goto-today": usedAt(5) }}
        onClose={() => {}}
        onResetRanking={onReset}
        now={NOW}
      />,
    );
    type("today");
    fireEvent.keyDown(input(), { key: "Backspace", metaKey: true });
    expect(onReset).not.toHaveBeenCalled();
  });

  it("does nothing when the highlighted command has no ranking", () => {
    const onReset = vi.fn();
    render(
      <CommandPalette commands={cmds} onClose={() => {}} onResetRanking={onReset} now={NOW} />,
    );
    fireEvent.keyDown(input(), { key: "Backspace", metaKey: true });
    expect(onReset).not.toHaveBeenCalled();
  });

  it("shows a reset button on the highlighted ranked row that resets on click", () => {
    const onReset = vi.fn();
    render(
      <CommandPalette
        commands={cmds}
        usage={{ "goto-today": usedAt(5) }}
        onClose={() => {}}
        onResetRanking={onReset}
        now={NOW}
      />,
    );
    const btn = screen.getByRole("button", { name: "Reset ranking" });
    fireEvent.click(btn);
    expect(onReset).toHaveBeenCalledWith("goto-today");
  });
});
