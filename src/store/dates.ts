import type { ISODate } from "../types";

// Everything reasons in local-calendar days. ISODate is "YYYY-MM-DD".

export function toISO(d: Date): ISODate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Today's date — honouring the dev override used to exercise rollover. */
export function todayISO(override: ISODate | null): ISODate {
  if (override != null && override !== "") return override;
  return toISO(new Date());
}

export function parseISO(iso: ISODate): Date {
  const [y, m, d] = iso.split("-").map((n) => Number(n));
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(iso: ISODate, n: number): ISODate {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** A planned date is a "leftover" if it's strictly before today. */
export function isLeftover(plannedFor: ISODate | null, today: ISODate): boolean {
  return plannedFor != null && plannedFor < today;
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "Tuesday, June 17" */
export function formatLong(iso: ISODate): string {
  const d = parseISO(iso);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Relative label for a planned date vs today: "today", "yesterday", "3d ago", "in 2d". */
export function relativeLabel(plannedFor: ISODate, today: ISODate): string {
  const a = parseISO(plannedFor).getTime();
  const b = parseISO(today).getTime();
  const days = Math.round((a - b) / 86_400_000);
  if (days === 0) return "today";
  if (days === -1) return "yesterday";
  if (days === 1) return "tomorrow";
  if (days < 0) return `${-days}d ago`;
  return `in ${days}d`;
}
