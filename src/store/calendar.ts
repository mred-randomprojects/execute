// Pure helpers behind "Add to calendar" — the one-keystroke path from a todo to
// a real, blocked-out event. Deliberately mechanism-light: we build a Google
// Calendar "create event" template URL and let the user confirm it. Nothing here
// touches the network or the store; it's all arithmetic on minutes and dates so
// it stays trivially testable. See src/components/CalendarPicker for the UI and
// src/types Task.scheduledAt for the (decoupled) stamp we leave behind.

import type { ISODate } from "../types";
import { toISO } from "./dates";

/** Time is chosen in whole quarter-hours — the picker's ↑/↓ step. */
export const CAL_STEP_MIN = 15;
/** An event is at least this long (no zero-length blocks). */
export const MIN_DURATION_MIN = 15;
export const DAY_MIN = 24 * 60;
/** Latest start we let you pick, so an event never spills to the next day. */
export const MAX_START_MIN = DAY_MIN - CAL_STEP_MIN; // 23:45
/** Default length when the task carries no effort estimate. */
export const FALLBACK_DURATION_MIN = 30;

/** Clamp a value into [min, max] after adding `delta` (the ↑/↓ steppers). */
export function stepClamped(value: number, delta: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value + delta));
}

/**
 * The pre-filled start time so "Enter, Enter, Enter" lands somewhere sane:
 * scheduling *today* snaps to the next free quarter-hour; any future day opens
 * at 9:00, a neutral "start of the workday" anchor.
 */
export function defaultStartMinutes(nowMs: number, dayISO: ISODate, todayISO: ISODate): number {
  if (dayISO !== todayISO) return 9 * 60;
  const d = new Date(nowMs);
  const m = d.getHours() * 60 + d.getMinutes();
  // Strictly the *next* boundary (+1), so a click never schedules "right now"
  // in the past by the time you hit Save.
  const next = Math.ceil((m + 1) / CAL_STEP_MIN) * CAL_STEP_MIN;
  return Math.min(next, MAX_START_MIN);
}

/** Default event length: the task's effort estimate (snapped to a quarter-hour), else 30m. */
export function defaultDurationMinutes(estimatedMinutes: number | null): number {
  if (estimatedMinutes == null || estimatedMinutes <= 0) return FALLBACK_DURATION_MIN;
  return Math.max(MIN_DURATION_MIN, Math.round(estimatedMinutes / CAL_STEP_MIN) * CAL_STEP_MIN);
}

/** Minutes-since-midnight → a 12-hour clock label, e.g. 870 → "2:30 PM". */
export function formatClock(minutes: number): string {
  const m = ((Math.round(minutes) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const ampm = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;
}

/** A duration in minutes → a compact label, e.g. 40 → "40m", 90 → "1h 30m". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** A local day + minutes-since-midnight → an absolute epoch ms (local time). */
export function toEpochMs(dayISO: ISODate, startMinutes: number): number {
  const [y, mo, d] = dayISO.split("-").map((n) => Number(n));
  return new Date(y, (mo ?? 1) - 1, d ?? 1, Math.floor(startMinutes / 60), startMinutes % 60, 0, 0).getTime();
}

/** Does an epoch ms fall on the given local calendar day? */
export function isOnDay(ms: number, dayISO: ISODate): boolean {
  return toISO(new Date(ms)) === dayISO;
}

/** A 12-hour clock label for the local time of an epoch ms, e.g. "2:30 PM". */
export function clockLabelFromMs(ms: number): string {
  const d = new Date(ms);
  return formatClock(d.getHours() * 60 + d.getMinutes());
}

function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

/** Google Calendar's `dates=` wants a local wall-clock stamp: YYYYMMDDTHHMMSS. */
function gcalStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/**
 * The Google Calendar "create event" template URL, pre-filled with the task's
 * title, time and length. Opening it drops the user on a ready-to-save event in
 * their primary calendar. We send wall-clock times plus `ctz` (their IANA zone)
 * so the event lands at the intended local time regardless of the browser's zone.
 */
export function gcalTemplateUrl(opts: {
  title: string;
  details?: string;
  startMs: number;
  durationMin: number;
  timeZone?: string;
}): string {
  const start = new Date(opts.startMs);
  const end = new Date(opts.startMs + opts.durationMin * 60_000);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: opts.title.trim() === "" ? "Untitled task" : opts.title,
    dates: `${gcalStamp(start)}/${gcalStamp(end)}`,
  });
  const details = opts.details?.trim();
  if (details != null && details !== "") params.set("details", details);
  const tz = opts.timeZone ?? localTimeZone();
  if (tz !== "") params.set("ctz", tz);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
