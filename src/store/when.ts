import type { ISODate } from "../types";
import {
  addDays,
  formatLong,
  isoWeekday,
  monthDayLabel,
  monthKey,
  monthKeyOffset,
  monthLabel,
  parseISO,
  relativeLabel,
  toISO,
  weekKey,
  weekKeyOffset,
  weekLabel,
  weekStart,
} from "./dates";

// The "when" engine: turns whatever you type in the schedule picker into the
// options worth offering. Pure — every answer is derived from the query plus the
// day passed in, never from the clock — so it stays trivially testable and is
// the obvious place a smarter/AI parser could later hook in (mirroring the
// recurrence and suggested-day engines).
//
// Two kinds of answer, in order of specificity:
//   1. A *parsed date* — "friday", "aug 20", "in 3 days", "12/25", "20th".
//   2. A *preset* — the fuzzy ladder (today → tomorrow → this week → … → inbox),
//      matched by name or alias so "next w" still finds "Next week".
// Anything the grammar can't read simply yields nothing, so the picker can say
// so rather than guessing.

/** What the user picked in the scheduler; App resolves it to plannedFor/horizon. */
export type ScheduleChoice =
  | "today"
  | "tomorrow"
  | "thisWeek"
  | "nextWeek"
  | "thisMonth"
  | "nextMonth"
  | "someday"
  | "inbox"
  | { date: ISODate };

/** The named rungs of the ladder — every choice that isn't a concrete date. */
export type SchedulePreset = Exclude<ScheduleChoice, { date: ISODate }>;

/** One offer in the picker: what it says, and what picking it means. */
export interface WhenOption {
  /** Stable identity — a preset key, or `date:YYYY-MM-DD`. */
  key: string;
  label: string;
  sub: string | null;
  choice: ScheduleChoice;
}

interface PresetSpec {
  key: SchedulePreset;
  label: string;
  /** Extra words that should find this rung (matched as a prefix of the query). */
  aliases: string[];
  sub: (today: ISODate) => string | null;
}

// Display order = the schedule ladder's order, so an empty query reads as the
// familiar list (and `t` / ⇧t walk the same rungs).
const PRESETS: PresetSpec[] = [
  { key: "today", label: "Today", aliases: ["now"], sub: (t) => monthDayLabel(t) },
  {
    key: "tomorrow",
    label: "Tomorrow",
    aliases: ["tmr", "tmrw", "tom"],
    sub: (t) => monthDayLabel(addDays(t, 1)),
  },
  { key: "thisWeek", label: "This week", aliases: [], sub: (t) => weekLabel(weekKey(t)) },
  {
    key: "nextWeek",
    label: "Next week",
    aliases: [],
    sub: (t) => weekLabel(weekKeyOffset(t, 1)),
  },
  { key: "thisMonth", label: "This month", aliases: [], sub: (t) => monthLabel(monthKey(t)) },
  {
    key: "nextMonth",
    label: "Next month",
    aliases: [],
    sub: (t) => monthLabel(monthKeyOffset(t, 1)),
  },
  {
    key: "someday",
    label: "Someday",
    aliases: ["later", "maybe", "eventually", "sometime"],
    sub: () => null,
  },
  {
    key: "inbox",
    label: "Inbox",
    aliases: ["none", "no date", "clear", "unschedule", "unplan", "untriage"],
    sub: () => null,
  },
];

// Three letters minimum: two-letter forms ("we", "th") collide with the words
// people type at the presets ("week", "this…") and would bury them under a date.
const WEEKDAY_WORDS: Record<string, number> = {
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
  sun: 7, sunday: 7,
};

const MONTH_WORDS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/** Alternation of the keys, longest first so "sept" wins over "sep". */
function wordsPattern(words: Record<string, number>): string {
  return Object.keys(words)
    .sort((a, b) => b.length - a.length)
    .join("|");
}

const WEEKDAY_RE = new RegExp(`^(?:(this|next|coming) )?(${wordsPattern(WEEKDAY_WORDS)})$`);
const MONTH_DAY_RE = new RegExp(
  `^(${wordsPattern(MONTH_WORDS)})\\.? (\\d{1,2})(?:st|nd|rd|th)?(?: (\\d{4}))?$`
);
const DAY_MONTH_RE = new RegExp(
  `^(\\d{1,2})(?:st|nd|rd|th)? (?:of )?(${wordsPattern(MONTH_WORDS)})\\.?(?: (\\d{4}))?$`
);
const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const OFFSET_RE = /^(?:in )?(\d{1,4}) ?(d|day|days|w|wk|wks|week|weeks|m|mo|mon|month|months|y|yr|yrs|year|years)$/;
const NUMERIC_RE = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/;
const BARE_DAY_RE = /^(\d{1,2})(?:st|nd|rd|th)?$/;

function daysIn(year: number, month: number): number {
  return new Date(year, month, 0).getDate(); // day 0 of the next month
}

/** A calendar date, or null when the triple isn't one (Feb 30, month 13…). */
function makeISO(year: number, month: number, day: number): ISODate | null {
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysIn(year, month)) return null;
  return toISO(new Date(year, month - 1, day));
}

/** A bare month/day means the next one that hasn't passed: this year, else next. */
function resolveYear(today: ISODate, month: number, day: number): ISODate | null {
  const year = parseISO(today).getFullYear();
  const thisYear = makeISO(year, month, day);
  if (thisYear != null && thisYear >= today) return thisYear;
  return makeISO(year + 1, month, day);
}

/**
 * The soonest `wd` *strictly after* today. In a re-scheduling picker "friday"
 * on a Friday means the next one — "today" is already its own rung, one key away.
 */
function nextWeekday(today: ISODate, wd: number): ISODate {
  const delta = ((wd - isoWeekday(today) + 7) % 7) || 7;
  return addDays(today, delta);
}

/** That weekday in the *following* ISO week — what "next friday" reads as. */
function weekdayNextWeek(today: ISODate, wd: number): ISODate {
  return addDays(weekStart(weekKeyOffset(today, 1)), wd - 1);
}

/** `n` months/years out, clamping the day (Jan 31 + 1 month → Feb 28). */
function addMonths(today: ISODate, n: number): ISODate | null {
  const t = parseISO(today);
  const target = new Date(t.getFullYear(), t.getMonth() + n, 1);
  const year = target.getFullYear();
  const month = target.getMonth() + 1;
  return makeISO(year, month, Math.min(t.getDate(), daysIn(year, month)));
}

/** Strip the noise words and punctuation people type around a date. */
export function normalizeWhenQuery(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^(?:on|the|by|due) /, "")
    .trim();
}

/**
 * Every concrete date the query could mean, best first. Usually one — but a
 * slash date like "4/5" is genuinely ambiguous, so both readings are offered
 * (month/day first) rather than one being guessed silently.
 */
export function parseWhenDates(query: string, today: ISODate): ISODate[] {
  const q = normalizeWhenQuery(query);
  if (q === "") return [];

  const out: ISODate[] = [];
  const push = (iso: ISODate | null) => {
    if (iso != null && !out.includes(iso)) out.push(iso);
  };

  const iso = ISO_RE.exec(q);
  if (iso != null) {
    push(makeISO(Number(iso[1]), Number(iso[2]), Number(iso[3])));
    return out;
  }

  const offset = OFFSET_RE.exec(q);
  if (offset != null) {
    const n = Number(offset[1]);
    const unit = offset[2][0]; // d | w | m | y
    if (unit === "d") push(addDays(today, n));
    else if (unit === "w") push(addDays(today, n * 7));
    else if (unit === "m") push(addMonths(today, n));
    else push(addMonths(today, n * 12));
    return out;
  }

  const weekday = WEEKDAY_RE.exec(q);
  if (weekday != null) {
    const wd = WEEKDAY_WORDS[weekday[2]];
    push(weekday[1] === "next" ? weekdayNextWeek(today, wd) : nextWeekday(today, wd));
    return out;
  }
  if (q === "weekend" || q === "this weekend") {
    push(nextWeekday(today, 6));
    return out;
  }
  if (q === "next weekend") {
    push(weekdayNextWeek(today, 6));
    return out;
  }

  const monthDay = MONTH_DAY_RE.exec(q) ?? null;
  if (monthDay != null) {
    const month = MONTH_WORDS[monthDay[1]];
    const day = Number(monthDay[2]);
    const year = monthDay[3];
    push(year != null ? makeISO(Number(year), month, day) : resolveYear(today, month, day));
    return out;
  }

  const dayMonth = DAY_MONTH_RE.exec(q) ?? null;
  if (dayMonth != null) {
    const day = Number(dayMonth[1]);
    const month = MONTH_WORDS[dayMonth[2]];
    const year = dayMonth[3];
    push(year != null ? makeISO(Number(year), month, day) : resolveYear(today, month, day));
    return out;
  }

  const numeric = NUMERIC_RE.exec(q);
  if (numeric != null) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const rawYear = numeric[3];
    const year =
      rawYear == null ? null : rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
    const at = (month: number, day: number) =>
      year == null ? resolveYear(today, month, day) : makeISO(year, month, day);
    push(at(a, b)); // month/day — the app speaks US English elsewhere
    push(at(b, a)); // …but d/m is just as common, so offer it too when it's valid
    return out;
  }

  const bareDay = BARE_DAY_RE.exec(q);
  if (bareDay != null) {
    const day = Number(bareDay[1]);
    const t = parseISO(today);
    // The next time that day-of-month comes round (skipping months too short
    // for it, e.g. the 31st).
    for (let i = 0; i < 14 && out.length === 0; i++) {
      const probe = new Date(t.getFullYear(), t.getMonth() + i, 1);
      const candidate = makeISO(probe.getFullYear(), probe.getMonth() + 1, day);
      if (candidate != null && candidate > today) push(candidate);
    }
    return out;
  }

  return out;
}

/** Do the query's words appear in `text`, in order? (The palette's rule.) */
function matchesTokens(text: string, tokens: string[]): boolean {
  const lower = text.toLowerCase();
  let from = 0;
  for (const token of tokens) {
    const at = lower.indexOf(token, from);
    if (at === -1) return false;
    from = at + token.length;
  }
  return true;
}

function matchesPreset(preset: PresetSpec, q: string, tokens: string[]): boolean {
  if (matchesTokens(preset.label, tokens)) return true;
  return preset.aliases.some((alias) => alias.startsWith(q));
}

/** A concrete date's title — with the year when it isn't this one. */
export function whenDateLabel(iso: ISODate, today: ISODate): string {
  const long = formatLong(iso);
  const year = parseISO(iso).getFullYear();
  return year === parseISO(today).getFullYear() ? long : `${long}, ${year}`;
}

/**
 * What to offer for `query`: parsed dates first (they're the specific answer),
 * then the matching rungs of the ladder. An empty query is the whole ladder.
 */
export function whenOptions(query: string, today: ISODate): WhenOption[] {
  const q = normalizeWhenQuery(query);
  const presetOption = (p: PresetSpec): WhenOption => ({
    key: p.key,
    label: p.label,
    sub: p.sub(today),
    choice: p.key,
  });

  if (q === "") return PRESETS.map(presetOption);

  const tokens = q.split(" ").filter(Boolean);
  const dates: WhenOption[] = parseWhenDates(q, today).map((iso) => ({
    key: `date:${iso}`,
    label: whenDateLabel(iso, today),
    sub: relativeLabel(iso, today),
    choice: { date: iso },
  }));
  const presets = PRESETS.filter((p) => matchesPreset(p, q, tokens)).map(presetOption);
  return [...dates, ...presets];
}
