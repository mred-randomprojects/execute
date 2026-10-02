import type { ISODate, Presence } from "../types";
import { isoWeekday } from "./dates";

// When the day gets closed. A shutdown happens when work stops — which for
// some people is 18:00 and for others 14:15 on weekdays and never on a
// Saturday — so it's a time per kind of day, each with its own switch. The
// time is when the notification fires and the in-app banner appears; the
// ritual itself can always be run later (⌘k, the menu bar), never only then.

/** "HH:MM", 24-hour. */
export type Clock = string;

/**
 * A time as typed: "14:15", "14.15", "1415", "14h", "14", "2:15pm", "2pm",
 * "2:15 p.m.". Null for anything that isn't one.
 */
export function parseClock(raw: string): Clock | null {
  const m = /^\s*(\d{1,2})(?:[:.h]?(\d{2}))?\s*(?:h\s*)?(a\.?m\.?|p\.?m\.?)?\s*$/i.exec(raw);
  if (m == null) return null;
  let hour = Number(m[1]);
  const minute = m[2] == null ? 0 : Number(m[2]);
  const ampm = m[3]?.toLowerCase().replace(/\./g, "");
  if (ampm != null) {
    if (hour < 1 || hour > 12) return null;
    if (ampm === "pm" && hour !== 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
  }
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Minutes since midnight. */
export function clockMinutes(clock: Clock): number {
  const [h, m] = clock.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export const isWeekend = (date: ISODate): boolean => isoWeekday(date) >= 6;

/** Today's shutdown time, or null when that kind of day has it switched off. */
export function shutdownTimeOn(p: Presence, date: ISODate): Clock | null {
  if (isWeekend(date)) return p.shutdownWeekendOn ? p.shutdownWeekendAt : null;
  return p.shutdownWeekdayOn ? p.shutdownWeekdayAt : null;
}

/** Has today's shutdown time arrived (by the local clock `now`)? */
export function isShutdownTime(p: Presence, date: ISODate, now: Date): boolean {
  const at = shutdownTimeOn(p, date);
  return at != null && now.getHours() * 60 + now.getMinutes() >= clockMinutes(at);
}

/** "weekdays 14:15 · weekends off" — for labels. */
export function shutdownScheduleLabel(p: Presence): string {
  const one = (on: boolean, at: Clock) => (on ? at : "off");
  if (p.shutdownWeekdayOn && p.shutdownWeekendOn && p.shutdownWeekdayAt === p.shutdownWeekendAt) {
    return `every day ${p.shutdownWeekdayAt}`;
  }
  return `weekdays ${one(p.shutdownWeekdayOn, p.shutdownWeekdayAt)} · weekends ${one(p.shutdownWeekendOn, p.shutdownWeekendAt)}`;
}
