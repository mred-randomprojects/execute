import { useEffect, useRef, useState, type ReactNode } from "react";
import { useElementWidth } from "../ui/useElementWidth";
import type { Habit, HabitMeasure, ISODate } from "../types";
import { addDays, daysBetween, formatLong, monthDayLabel, parseISO } from "../store/dates";
import { DEFAULT_MEASURE, formatValue, markOn, type DatedValue } from "../store/habits";
import { TREND_RANGES, trendFrom, trendOf, type HabitTrend, type KpiTrend, type TrendRange } from "../store/habitTrend";

const HEIGHT = 168;
const M = { l: 36, r: 10, t: 10, b: 22 };
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface Scale {
  from: ISODate;
  span: number;
  width: number;
  x: (d: ISODate) => number;
  /** Half a day, in pixels. */
  half: number;
  y: (v: number) => number;
}

function makeScale(from: ISODate, today: ISODate, width: number, lo: number, hi: number): Scale {
  const span = daysBetween(from, today) + 1;
  const inner = Math.max(1, width - M.l - M.r);
  const day = inner / span;
  const innerH = HEIGHT - M.t - M.b;
  return {
    from,
    span,
    width,
    x: (d) => M.l + (daysBetween(from, d) + 0.5) * day,
    half: day / 2,
    y: (v) => M.t + innerH * (1 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo || 1)),
  };
}

/** A line through dated points, broken wherever a day is missing between two of them. */
function linePath(points: DatedValue[], s: Scale): string {
  let d = "";
  let prev: ISODate | null = null;
  for (const p of points) {
    const joined = prev != null && addDays(prev, 1) === p.date;
    d += `${joined ? "L" : "M"}${s.x(p.date).toFixed(1)},${s.y(p.value).toFixed(1)}`;
    prev = p.date;
  }
  return d;
}

/** Points joined in order, gaps or not — weekly and monthly KPIs. */
function joinPath(points: DatedValue[], s: Scale): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${s.x(p.date).toFixed(1)},${s.y(p.value).toFixed(1)}`).join("");
}

/** A bar standing on the baseline, its top corners rounded. */
function barPath(x0: number, x1: number, top: number, base: number): string {
  const r = Math.min(3, (x1 - x0) / 2, base - top);
  if (r <= 0) return "";
  return `M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x1 - r}Q${x1},${top} ${x1},${top + r}V${base}Z`;
}

/** Month starts for a long range, Mondays for a short one — thinned so labels don't collide. */
function xTicks(s: Scale, today: ISODate): { date: ISODate; label: string }[] {
  const out: { date: ISODate; label: string }[] = [];
  const months = s.span > 70;
  for (let d = s.from; d <= today; d = addDays(d, 1)) {
    const date = parseISO(d);
    if (months ? date.getDate() === 1 : date.getDay() === 1) {
      const m = date.getMonth();
      out.push({
        date: d,
        label: months ? (m === 0 ? String(date.getFullYear()) : SHORT_MONTHS[m]) : monthDayLabel(d),
      });
    }
  }
  const room = months ? 34 : 48;
  const step = out.length < 2 ? 1 : Math.max(1, Math.ceil(room / (s.x(out[1].date) - s.x(out[0].date))));
  return out.filter((_, i) => i % step === 0);
}

/** Every value on a short integer range; otherwise a round step (1, 2, 5 × 10ⁿ, and 2.5 off integers) giving about four bands. */
function yTicks(lo: number, hi: number): number[] {
  const range = hi - lo;
  if (range <= 6 && Number.isInteger(lo) && Number.isInteger(hi)) {
    return Array.from({ length: range + 1 }, (_, i) => lo + i);
  }
  const raw = range / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const steps = Number.isInteger(lo) && Number.isInteger(hi) ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  const step = (steps.find((m) => m * pow >= raw) ?? 10) * pow;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

function Axes({ s, today, ticks, label }: { s: Scale; today: ISODate; ticks: number[]; label: (v: number) => string }) {
  return (
    <g className="text-ink-faint" fontSize={10}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={M.l} x2={s.width - M.r} y1={s.y(v)} y2={s.y(v)} stroke="var(--line)" strokeWidth={1} />
          <text x={M.l - 6} y={s.y(v)} dy="0.32em" textAnchor="end" fill="currentColor" className="mono">
            {label(v)}
          </text>
        </g>
      ))}
      {xTicks(s, today).map((t) => (
        <text key={t.date} x={s.x(t.date)} y={HEIGHT - 6} textAnchor="middle" fill="currentColor">
          {t.label}
        </text>
      ))}
    </g>
  );
}

function markWord(h: Habit, d: ISODate, today: ISODate): string {
  const m = markOn(h, d);
  return m === "done" ? "Done" : m === "missed" ? "Not done" : m === "skip" ? "Rest day" : d === today ? "Open" : "Not logged";
}

interface Hover {
  date: ISODate;
  x: number;
}

function Tooltip({ hover, width, children }: { hover: Hover; width: number; children: ReactNode }) {
  const flip = hover.x > width - 190;
  return (
    <div
      className="pointer-events-none absolute top-1 z-10 w-[176px] rounded border border-line bg-surface px-2.5 py-1.5 text-[11px] leading-snug text-ink shadow-sm"
      style={flip ? { left: hover.x - 186 } : { left: hover.x + 10 }}
    >
      {children}
    </div>
  );
}

function HabitChart({
  habit,
  trend,
  s,
  today,
  hover,
}: {
  habit: Habit;
  trend: HabitTrend;
  s: Scale;
  today: ISODate;
  hover: Hover | null;
}) {
  const base = s.y(0);
  const week = hover == null ? null : trend.weeks.find((w) => w.start <= hover.date && hover.date <= addDays(w.start, 6));
  const point = hover == null ? null : trend.strength.find((p) => p.date === hover.date);
  return (
    <>
      <svg width={s.width} height={HEIGHT} className="block overflow-visible">
        <Axes s={s} today={today} ticks={[0, 0.5, 1]} label={(v) => `${Math.round(v * 100)}%`} />
        {trend.weeks.map((w) => {
          if (w.target === 0) return null;
          const first = w.start < s.from ? s.from : w.start;
          const lastDay = addDays(w.start, 6);
          const last = lastDay > today ? today : lastDay;
          const x0 = s.x(first) - s.half + 1;
          const x1 = s.x(last) + s.half - 1;
          return (
            <path
              key={w.start}
              d={barPath(x0, x1, s.y(Math.min(1, w.done / w.target)), base)}
              fill="color-mix(in srgb, var(--accent) 22%, transparent)"
            />
          );
        })}
        <path d={linePath(trend.strength, s)} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
        {hover != null && <line x1={hover.x} x2={hover.x} y1={M.t} y2={base} stroke="var(--line-strong)" />}
        {point != null && (
          <circle cx={s.x(point.date)} cy={s.y(point.value)} r={4} fill="var(--accent)" stroke="var(--bg)" strokeWidth={2} />
        )}
      </svg>
      {hover != null && (
        <Tooltip hover={hover} width={s.width}>
          <div className="text-ink-soft">{formatLong(hover.date)}</div>
          <div>{markWord(habit, hover.date, today)}</div>
          {point != null && <div>Strength {Math.round(point.value * 100)}%</div>}
          {week != null && week.target > 0 && (
            <div>
              That week {week.done}/{week.target}
            </div>
          )}
          {habit.notes[hover.date] != null && <div className="mt-1 italic text-ink-soft">{habit.notes[hover.date]}</div>}
        </Tooltip>
      )}
    </>
  );
}

function KpiChart({
  measure,
  trend,
  s,
  today,
  hover,
}: {
  measure: HabitMeasure;
  trend: KpiTrend;
  s: Scale;
  today: ISODate;
  hover: Hover | null;
}) {
  const point = hover == null ? null : trend.points.find((p) => p.date === hover.date);
  const avg = hover == null ? null : trend.average?.find((p) => p.date === hover.date);
  const label = (v: number) => formatValue(measure, v);
  return (
    <>
      <svg width={s.width} height={HEIGHT} className="block overflow-visible">
        <Axes s={s} today={today} ticks={yTicks(measure.min, measure.max)} label={label} />
        {trend.average != null ? (
          <path d={linePath(trend.average, s)} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
        ) : (
          <path d={joinPath(trend.points, s)} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
        )}
        {hover != null && <line x1={hover.x} x2={hover.x} y1={M.t} y2={s.y(measure.min)} stroke="var(--line-strong)" />}
        {trend.points.map((p) => (
          <circle
            key={p.date}
            cx={s.x(p.date)}
            cy={s.y(p.value)}
            r={p.date === point?.date ? 5 : 3.5}
            fill={trend.average != null ? "color-mix(in srgb, var(--accent) 50%, var(--bg))" : "var(--accent)"}
            stroke="var(--bg)"
            strokeWidth={1.5}
          />
        ))}
      </svg>
      {hover != null && (
        <Tooltip hover={hover} width={s.width}>
          <div className="text-ink-soft">{formatLong(hover.date)}</div>
          <div>{point != null ? `Logged ${label(point.value)}` : "Not logged"}</div>
          {avg != null && <div>7-day average {Math.round(avg.value * 10) / 10}</div>}
          {point != null && point.note !== "" && <div className="mt-1 italic text-ink-soft">{point.note}</div>}
        </Tooltip>
      )}
    </>
  );
}

function Legend({ kind, daily }: { kind: "habit" | "kpi"; daily: boolean }) {
  const swatch = (el: ReactNode, text: string) => (
    <span className="flex items-center gap-1.5">
      {el}
      {text}
    </span>
  );
  const line = <span className="inline-block h-[2px] w-3 rounded bg-accent" />;
  return (
    <span className="flex shrink-0 items-center gap-3 whitespace-nowrap text-[11px] text-ink-soft">
      {kind === "habit" ? (
        <>
          {swatch(line, "Strength")}
          {swatch(<span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-accent/25" />, "Week vs target")}
        </>
      ) : daily ? (
        <>
          {swatch(line, "7-day average")}
          {swatch(<span className="inline-block h-2 w-2 rounded-full bg-accent/50" />, "Logged")}
        </>
      ) : (
        swatch(line, "Logged")
      )}
    </span>
  );
}

/**
 * The focused habit or KPI over time: a habit's strength day by day over its
 * weeks against target, a KPI's values with their 7-day average. ↑/↓ pick
 * what it shows (it follows the row cursor); g or the buttons pick the range.
 */
export function HabitTrendPanel({
  habit,
  today,
  range,
  onRange,
}: {
  habit: Habit | null;
  today: ISODate;
  range: TrendRange;
  onRange: (r: TrendRange) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(boxRef);
  const [hover, setHover] = useState<Hover | null>(null);
  useEffect(() => setHover(null), [habit?.id, range]);
  const trend = habit == null ? null : trendOf(habit, today, range);
  const measure = habit?.measure ?? DEFAULT_MEASURE;
  const s =
    habit == null || width === 0
      ? null
      : habit.measure != null
        ? makeScale(trendFrom(habit, today, range), today, width, measure.min, measure.max)
        : makeScale(trendFrom(habit, today, range), today, width, 0, 1);
  const empty = trend?.kind === "kpi" && trend.points.length === 0;

  return (
    <section aria-label="Trend" className="mt-6 shrink-0 border-t border-line px-3 pt-3">
      <div className="mb-2 flex items-center gap-4">
        <span className="eyebrow min-w-0 truncate">
          Trend{habit != null && habit.name !== "" ? ` · ${habit.name}` : ""}
        </span>
        {trend != null && <Legend kind={trend.kind} daily={measure.every === "day"} />}
        <span className="flex-1" />
        <span className="flex shrink-0 items-center gap-1">
          {TREND_RANGES.map((r) => (
            <button
              key={r.key}
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onRange(r.key);
              }}
              aria-pressed={r.key === range}
              className={[
                "rounded-sm px-1.5 py-0.5 text-[11px]",
                r.key === range ? "bg-surface-3 text-ink" : "text-ink-faint hover:text-ink-soft",
              ].join(" ")}
            >
              {r.label}
            </button>
          ))}
          <span className="kbd ml-1" title="Next range (g)">
            g
          </span>
        </span>
      </div>
      <div
        ref={boxRef}
        className="relative"
        style={{ height: HEIGHT }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          if (s == null) return;
          const mx = e.clientX - e.currentTarget.getBoundingClientRect().left;
          const i = Math.round((mx - M.l) / (s.half * 2) - 0.5);
          const date = addDays(s.from, Math.max(0, Math.min(s.span - 1, i)));
          setHover({ date, x: s.x(date) });
        }}
      >
        {habit == null ? (
          <div className="grid h-full place-items-center text-[12px] text-ink-faint">Pick a habit or a KPI to see how it’s going.</div>
        ) : s == null || trend == null ? null : (
          <>
            {trend.kind === "habit" ? (
              <HabitChart habit={habit} trend={trend} s={s} today={today} hover={hover} />
            ) : (
              <KpiChart measure={measure} trend={trend} s={s} today={today} hover={hover} />
            )}
            {empty && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-[12px] text-ink-faint">
                Nothing logged in this range yet.
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
