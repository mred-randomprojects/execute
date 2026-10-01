import type { ISODate } from "../types";
import {
  addDays,
  formatLong,
  isoWeekday,
  monthDayLabel,
  monthEnd,
  monthKey,
  monthKeyOffset,
  monthLabel,
  monthStart,
  parseISO,
  relativeLabel,
  toISO,
  weekKey,
  weekKeyOffset,
  weekLabel,
  weekStart,
} from "./dates";

// The "when" engine: turns whatever you type in the schedule picker — or after a
// verb in the command palette ("reschedule sat") — into the options worth
// offering. Pure — every answer is derived from the query plus the day passed
// in, never from the clock — so it stays trivially testable and is the obvious
// place a smarter/AI parser could later hook in (mirroring the recurrence and
// suggested-day engines).
//
// Two kinds of answer, in order of specificity:
//   1. A *parsed date* — "friday", "sat", "aug 20", "in 3 days", "12/25",
//      "end of month", "late august". A phrase may mean more than one day
//      ("weekend" is Saturday *or* Sunday); then every reading is offered,
//      nearest first, instead of one being guessed.
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
  {
    key: "today",
    label: "Today",
    aliases: ["now", "tonight", "end of day", "eod", "asap", "right away", "immediately"],
    sub: (t) => monthDayLabel(t),
  },
  {
    key: "tomorrow",
    label: "Tomorrow",
    aliases: ["tmr", "tmrw", "tmo", "tom", "next day"],
    sub: (t) => monthDayLabel(addDays(t, 1)),
  },
  {
    key: "thisWeek",
    label: "This week",
    aliases: ["week", "wk"],
    sub: (t) => weekLabel(weekKey(t)),
  },
  {
    key: "nextWeek",
    label: "Next week",
    aliases: ["next wk"],
    sub: (t) => weekLabel(weekKeyOffset(t, 1)),
  },
  {
    key: "thisMonth",
    label: "This month",
    aliases: ["month"],
    sub: (t) => monthLabel(monthKey(t)),
  },
  {
    key: "nextMonth",
    label: "Next month",
    aliases: ["next mo"],
    sub: (t) => monthLabel(monthKeyOffset(t, 1)),
  },
  {
    key: "someday",
    label: "Someday",
    aliases: ["later", "maybe", "eventually", "sometime", "whenever", "backlog"],
    sub: () => null,
  },
  {
    key: "inbox",
    label: "Inbox",
    aliases: [
      "none",
      "no date",
      "clear",
      "clear date",
      "remove date",
      "unschedule",
      "unplan",
      "untriage",
    ],
    sub: () => null,
  },
];

// Weekdays and months are matched by *prefix* (three letters minimum), so
// "sat", "satu", "saturd" and "saturday" are all the same word and nobody has
// to remember which abbreviation the app wanted. Two-letter forms ("we", "th")
// collide with the words people type at the presets ("week", "this…"), so they
// stay out.
const WEEKDAY_NAMES = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

/** Short forms that aren't a prefix of the full name. */
const WEEKDAY_ALIASES: Record<string, number> = { tues: 2, weds: 3, thur: 4, thurs: 4 };

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const MONTH_ALIASES: Record<string, number> = { sept: 9 };

/** ISO weekday (Mon=1…Sun=7) for a word, or null when it isn't one. */
function matchWeekday(word: string): number | null {
  if (word.length < 3) return null;
  const alias = WEEKDAY_ALIASES[word];
  if (alias != null) return alias;
  const i = WEEKDAY_NAMES.findIndex((n) => n.startsWith(word));
  return i === -1 ? null : i + 1;
}

/** Month number (1–12) for a word, or null when it isn't one. */
function matchMonth(word: string): number | null {
  if (word.length < 3) return null;
  const alias = MONTH_ALIASES[word];
  if (alias != null) return alias;
  const i = MONTH_NAMES.findIndex((n) => n.startsWith(word));
  return i === -1 ? null : i + 1;
}

const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const NUMERIC_RE = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/;
const BARE_DAY_RE = /^(\d{1,2})(?:st|nd|rd|th)?$/;

// "in 3 days", "2 weeks", "a fortnight", "couple of days", "3 business days",
// "5 days from now" — the count may be a numeral or a word.
const OFFSET_RE =
  /^(?:in|after|within)? ?([a-z]+|\d{1,4}) ?(business ?days?|work(?:ing)? ?days?|week ?days?|wd|days?|d|weeks?|wks?|w|months?|mos?|mon|m|years?|yrs?|y|fortnights?)(?: from (?:now|today))?$/;

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  couple: 2,
  few: 3,
  several: 3,
};

/** Which calendar step a unit word means. Order matters: "weekday" isn't "week". */
function unitKind(unit: string): "day" | "workday" | "week" | "fortnight" | "month" | "year" {
  if (/^(business|work|week ?day|wd)/.test(unit)) return "workday";
  if (unit.startsWith("fortnight")) return "fortnight";
  if (unit.startsWith("d")) return "day";
  if (unit.startsWith("w")) return "week";
  if (unit.startsWith("m")) return "month";
  return "year";
}

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

/** `n` Mon–Fri days out, so "in 2 business days" from a Friday is Tuesday. */
function addWorkdays(today: ISODate, n: number): ISODate {
  let d = today;
  for (let left = n; left > 0; ) {
    d = addDays(d, 1);
    if (isoWeekday(d) <= 5) left--;
  }
  return d;
}

/**
 * The days of the nearest weekend still ahead — Saturday *and* Sunday, because
 * "weekend" genuinely means either. On a Saturday only the Sunday is left, so
 * that's all it offers; on a Sunday the weekend is spent and it rolls on.
 */
function weekendDays(today: ISODate, offset: 0 | 1): ISODate[] {
  if (offset === 1) {
    const sat = weekdayNextWeek(today, 6);
    return [sat, addDays(sat, 1)];
  }
  if (isoWeekday(today) === 6) return [addDays(today, 1)];
  const sat = nextWeekday(today, 6);
  return [sat, addDays(sat, 1)];
}

/** "End of week" is Friday to most people and Sunday on the calendar: both. */
function endOfWeek(today: ISODate, offset: 0 | 1): ISODate[] {
  const fri = offset === 1 ? weekdayNextWeek(today, 5) : nextWeekday(today, 5);
  return [fri, addDays(fri, 2)];
}

/** This month's last day while it's still ahead, else next month's. */
function endOfMonth(today: ISODate): ISODate[] {
  const end = monthEnd(monthKey(today));
  return [end > today ? end : monthEnd(monthKeyOffset(today, 1))];
}

/** The next 1st of a month that's still ahead. */
function startOfMonth(today: ISODate): ISODate[] {
  const start = monthStart(monthKey(today));
  return [start > today ? start : monthStart(monthKeyOffset(today, 1))];
}

function endOfYear(today: ISODate, offset: 0 | 1): ISODate[] {
  const year = parseISO(today).getFullYear() + offset;
  const dec31 = makeISO(year, 12, 31);
  if (dec31 != null && (offset === 1 || dec31 > today)) return [dec31];
  return [makeISO(year + 1, 12, 31)].filter((d): d is ISODate => d != null);
}

/** The next Mon–Fri day — "the next working day". */
function nextWorkday(today: ISODate): ISODate[] {
  return [addWorkdays(today, 1)];
}

/**
 * Phrases that name a day without naming a date. Keys are the normalized query
 * with "the" and "of" dropped, so "end of the week" and "end week" both land on
 * "end week".
 */
const PHRASES: Record<string, (today: ISODate) => ISODate[]> = {
  "day after tomorrow": (t) => [addDays(t, 2)],
  "day after tmr": (t) => [addDays(t, 2)],
  overmorrow: (t) => [addDays(t, 2)],
  weekend: (t) => weekendDays(t, 0),
  "this weekend": (t) => weekendDays(t, 0),
  "coming weekend": (t) => weekendDays(t, 0),
  "next weekend": (t) => weekendDays(t, 1),
  "weekend after next": (t) => weekendDays(addDays(t, 7), 1),
  "end week": (t) => endOfWeek(t, 0),
  "end this week": (t) => endOfWeek(t, 0),
  eow: (t) => endOfWeek(t, 0),
  "week end": (t) => endOfWeek(t, 0),
  "end next week": (t) => endOfWeek(t, 1),
  "start week": (t) => [nextWeekday(t, 1)],
  "beginning week": (t) => [nextWeekday(t, 1)],
  "top week": (t) => [nextWeekday(t, 1)],
  sow: (t) => [nextWeekday(t, 1)],
  "start next week": (t) => [weekdayNextWeek(t, 1)],
  "beginning next week": (t) => [weekdayNextWeek(t, 1)],
  "top next week": (t) => [weekdayNextWeek(t, 1)],
  midweek: (t) => [nextWeekday(t, 3)],
  "mid week": (t) => [nextWeekday(t, 3)],
  "end month": endOfMonth,
  "end this month": endOfMonth,
  eom: endOfMonth,
  "end next month": (t) => [monthEnd(monthKeyOffset(t, 1))],
  "start month": startOfMonth,
  "beginning month": startOfMonth,
  "first month": startOfMonth,
  som: startOfMonth,
  "start next month": (t) => [monthStart(monthKeyOffset(t, 1))],
  "beginning next month": (t) => [monthStart(monthKeyOffset(t, 1))],
  "first next month": (t) => [monthStart(monthKeyOffset(t, 1))],
  "end year": (t) => endOfYear(t, 0),
  "end this year": (t) => endOfYear(t, 0),
  eoy: (t) => endOfYear(t, 0),
  "end next year": (t) => endOfYear(t, 1),
  fortnight: (t) => [addDays(t, 14)],
  "next fortnight": (t) => [addDays(t, 14)],
  weekday: nextWorkday,
  "week day": nextWorkday,
  workday: nextWorkday,
  "work day": nextWorkday,
  "working day": nextWorkday,
  "business day": nextWorkday,
  "next weekday": nextWorkday,
  "next workday": nextWorkday,
  "next work day": nextWorkday,
  "next working day": nextWorkday,
  "next business day": nextWorkday,
};

/** Where in a month "early/mid/late august" lands. 0 means "the last day". */
const MONTH_PART: Record<string, number> = {
  early: 1,
  start: 1,
  beginning: 1,
  top: 1,
  first: 1,
  mid: 15,
  middle: 15,
  late: 25,
  end: 0,
  last: 0,
};

const RELATIVE_THIS = new Set(["this", "coming", "upcoming"]);
const RELATIVE_NEXT = new Set(["next", "following"]);

/** Leading words people type at a date that carry no meaning of their own. */
const LEADING_NOISE = new Set(["on", "the", "by", "due", "at", "for", "until", "till"]);

/** Strip the noise words and punctuation people type around a date. */
export function normalizeWhenQuery(query: string): string {
  let q = query
    .trim()
    .toLowerCase()
    .replace(/,/g, " ")
    .replace(/([a-z])\./g, "$1") // "aug." → "aug", leaving "4.5" alone
    .replace(/\s+/g, " ")
    .trim();
  for (;;) {
    const space = q.indexOf(" ");
    if (space === -1) break;
    if (!LEADING_NOISE.has(q.slice(0, space))) break;
    q = q.slice(space + 1);
  }
  return q;
}

/**
 * Every concrete date the query could mean, best first. Often one — but some
 * readings are genuinely plural: "weekend" is Saturday or Sunday, and a slash
 * date like "4/5" is month/day or day/month, so both are offered rather than
 * one being guessed silently.
 */
export function parseWhenDates(query: string, today: ISODate): ISODate[] {
  const q = normalizeWhenQuery(query);
  if (q === "") return [];

  const out: ISODate[] = [];
  const push = (iso: ISODate | null | undefined) => {
    if (iso != null && !out.includes(iso)) out.push(iso);
  };
  const pushAll = (isos: ISODate[]) => {
    for (const iso of isos) push(iso);
  };

  const iso = ISO_RE.exec(q);
  if (iso != null) {
    push(makeISO(Number(iso[1]), Number(iso[2]), Number(iso[3])));
    return out;
  }

  // Word-shaped readings work off tokens, with the filler dropped and ordinal
  // suffixes shaved ("20th" → "20"); hyphens join words, not dates, here.
  const words = q.replace(/[-/]/g, " ").replace(/\s+/g, " ").split(" ").filter(Boolean);
  const terms = words
    .filter((w) => w !== "of" && w !== "the")
    .map((w) => w.replace(/^(\d{1,2})(?:st|nd|rd|th)$/, "$1"));

  const phrase = PHRASES[terms.join(" ")];
  if (phrase != null) {
    pushAll(phrase(today));
    return out;
  }

  // "a couple of days" has already lost its "of"; the article goes too, so the
  // count word is where the pattern expects it.
  const offsetSrc = terms.join(" ").replace(/^((?:in|after|within) )?(?:a|an) (?=couple|few|several)/, "$1");
  const offset = OFFSET_RE.exec(offsetSrc);
  if (offset != null) {
    const raw = offset[1];
    const n = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
    if (n != null && n > 0) {
      const kind = unitKind(offset[2]);
      if (kind === "day") push(addDays(today, n));
      else if (kind === "workday") push(addWorkdays(today, n));
      else if (kind === "week") push(addDays(today, n * 7));
      else if (kind === "fortnight") push(addDays(today, n * 14));
      else if (kind === "month") push(addMonths(today, n));
      else push(addMonths(today, n * 12));
      return out;
    }
  }

  // A weekday, alone or with this/next/coming in front.
  if (terms.length === 1 || (terms.length === 2 && (RELATIVE_THIS.has(terms[0]) || RELATIVE_NEXT.has(terms[0])))) {
    const wd = matchWeekday(terms[terms.length - 1]);
    if (wd != null) {
      push(RELATIVE_NEXT.has(terms[0]) && terms.length === 2
        ? weekdayNextWeek(today, wd)
        : nextWeekday(today, wd));
      return out;
    }
  }

  // Month-shaped readings: "aug 20", "20 aug", "aug 20 2027", "late august",
  // "august", "august 2027".
  const monthAt = terms.findIndex((w) => matchMonth(w) != null);
  if (monthAt !== -1 && terms.length <= 3) {
    const month = matchMonth(terms[monthAt]);
    const rest = terms.filter((_, i) => i !== monthAt);
    const nums = rest.filter((w) => /^\d+$/.test(w)).map(Number);
    const yearAt = rest.findIndex((w) => /^\d{4}$/.test(w));
    const year = yearAt === -1 ? null : Number(rest[yearAt]);
    const days = nums.filter((n) => n !== year && n >= 1 && n <= 31);
    const part = rest.length === 1 && month != null ? MONTH_PART[rest[0]] : undefined;

    if (month != null && rest.length === 0) {
      push(resolveYear(today, month, 1));
      return out;
    }
    if (month != null && part !== undefined) {
      if (part !== 0) {
        push(resolveYear(today, month, part));
      } else {
        // "end of august" — that month's last day, in whichever year it lands.
        const y = parseISO(today).getFullYear();
        const here = makeISO(y, month, daysIn(y, month));
        push(here != null && here >= today ? here : makeISO(y + 1, month, daysIn(y + 1, month)));
      }
      return out;
    }
    if (month != null && days.length === 1) {
      push(year != null ? makeISO(year, month, days[0]) : resolveYear(today, month, days[0]));
      return out;
    }
    if (month != null && days.length === 0 && year != null) {
      push(makeISO(year, month, 1));
      return out;
    }
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

// ---------------------------------------------------------------------------
// The command palette's door into the same grammar.

/**
 * Verbs that mean "put this on a day". Typing one of them with something after
 * it ("reschedule sat", "postpone end of month") goes straight to the dates,
 * so the palette never makes you open the picker as a second step.
 */
const SCHEDULE_VERBS = [
  "reschedule",
  "schedule",
  "resched",
  "sched",
  "postpone",
  "snooze",
  "defer",
  "delay",
  "when",
  "due",
  "plan",
  "move",
  "push",
];

/** Is `word` an (ordinary, slightly fat-fingered) attempt at `verb`? */
function looksLikeVerb(word: string, verb: string): boolean {
  if (word.length < 3) return false;
  if (verb.startsWith(word) || word.startsWith(verb)) return true;
  // Typed-through-it misses like "reschedu"/"reshedule": the letters of what
  // was typed appear in the verb, in order. Long words only — short ones would
  // match far too much.
  if (word.length < 5) return false;
  let from = 0;
  for (const ch of word) {
    const at = verb.indexOf(ch, from);
    if (at === -1) return false;
    from = at + 1;
  }
  return true;
}

/**
 * The date part of a "<verb> <when>" query, or null when it isn't one. Pure and
 * exported so the palette's behaviour is testable without React.
 */
export function splitScheduleVerb(query: string): string | null {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  const space = q.indexOf(" ");
  if (space === -1) return null;
  const head = q.slice(0, space);
  const rest = q.slice(space + 1).trim();
  if (rest === "") return null;
  if (!SCHEDULE_VERBS.some((verb) => looksLikeVerb(head, verb))) return null;
  // "move to friday", "push to sat" — the preposition belongs to the verb.
  const stripped = rest.replace(/^(?:to|it|this|that|for) /, "").trim();
  return stripped === "" ? rest : stripped;
}
