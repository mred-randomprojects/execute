import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CalendarPicker } from "./CalendarPicker";
import type { ISODate } from "../types";

afterEach(cleanup);

const TODAY = "2026-07-21" as ISODate;
// 10:07 local on TODAY → the default start snaps to the next quarter-hour (10:15).
const NOW = new Date(2026, 6, 21, 10, 7).getTime();

function setup(over: Partial<Parameters<typeof CalendarPicker>[0]> = {}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <CalendarPicker
      title="Ship the pipeline"
      today={TODAY}
      initialDayISO={TODAY}
      estimatedMinutes={40}
      nowMs={NOW}
      onConfirm={onConfirm}
      onClose={onClose}
      {...over}
    />,
  );
  return { onConfirm, onClose, dialog: () => screen.getByRole("dialog") };
}

const press = (el: HTMLElement, key: string, shiftKey = false) =>
  fireEvent.keyDown(el, { key, shiftKey });

describe("CalendarPicker — keyboard-first quick add", () => {
  it("Enter · Enter · Enter confirms with sensible defaults", () => {
    const { onConfirm, onClose, dialog } = setup();
    // Defaults are visible before any input: today, 10:15 AM, 45m (40m estimate snapped).
    expect(screen.getAllByText(/10:15 AM/).length).toBeGreaterThan(0);
    expect(screen.getByText("45m")).toBeTruthy();

    press(dialog(), "Enter"); // day → time
    press(dialog(), "Enter"); // time → length
    press(dialog(), "Enter"); // confirm

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.durationMin).toBe(45);
    expect(arg.startMs).toBe(new Date(2026, 6, 21, 10, 15).getTime());
  });

  it("↑/↓ steps the active field by 15 minutes", () => {
    const { onConfirm, dialog } = setup();
    press(dialog(), "ArrowRight"); // day → time
    press(dialog(), "ArrowUp"); // 10:15 → 10:30
    expect(screen.getAllByText(/10:30 AM/).length).toBeGreaterThan(0);
    press(dialog(), "ArrowRight"); // time → length
    press(dialog(), "ArrowUp"); // 45m → 60m
    expect(screen.getByText("1h")).toBeTruthy();
    press(dialog(), "Enter"); // confirm from the last field

    const arg = onConfirm.mock.calls[0][0];
    expect(arg.durationMin).toBe(60);
    expect(arg.startMs).toBe(new Date(2026, 6, 21, 10, 30).getTime());
  });

  it("never lets the day slip before today", () => {
    const { onConfirm, dialog } = setup();
    press(dialog(), "ArrowDown"); // day −1 → clamped at today
    press(dialog(), "Enter");
    press(dialog(), "Enter");
    press(dialog(), "Enter");
    const arg = onConfirm.mock.calls[0][0];
    // Still today (10:15), not yesterday.
    expect(arg.startMs).toBe(new Date(2026, 6, 21, 10, 15).getTime());
  });

  it("Escape cancels without scheduling", () => {
    const { onConfirm, onClose, dialog } = setup();
    press(dialog(), "Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("a future planned date seeds the day and anchors time at 9:00", () => {
    const { onConfirm, dialog } = setup({ initialDayISO: "2026-07-25" as ISODate });
    expect(screen.getAllByText(/9:00 AM/).length).toBeGreaterThan(0);
    press(dialog(), "Enter");
    press(dialog(), "Enter");
    press(dialog(), "Enter");
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.startMs).toBe(new Date(2026, 6, 25, 9, 0).getTime());
  });
});
