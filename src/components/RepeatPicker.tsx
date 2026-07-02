import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ISODate, RecurrenceEnds, RecurrenceFreq, RecurrenceRule } from "../types";
import { presetsFor, ruleLabel } from "../store/recurrence";
import { addDays, WEEKDAY_SHORT } from "../store/dates";
import { NO_SPELLCHECK } from "../ui/noSpellcheck";

const FREQS: { value: RecurrenceFreq; label: string }[] = [
  { value: "day", label: "day" },
  { value: "week", label: "week" },
  { value: "month", label: "month" },
  { value: "year", label: "year" },
];

/**
 * The calendar-style "Repeat" picker: a keyboard-navigable list of presets plus
 * a Custom… panel (every N days/weeks/…, weekday pills, an end condition).
 * Resolves to a normalized {@link RecurrenceRule}.
 */
export function RepeatPicker({
  anchor,
  current,
  onPick,
  onClose,
}: {
  anchor: ISODate;
  current: RecurrenceRule | null;
  onPick: (rule: RecurrenceRule) => void;
  onClose: () => void;
}) {
  const presets = presetsFor(anchor);
  const [custom, setCustom] = useState(false);
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  // Custom-panel working state, seeded from the current rule when present.
  const [freq, setFreq] = useState<RecurrenceFreq>(current?.freq ?? "week");
  const [interval, setIntervalN] = useState(current?.interval ?? 1);
  const [weekdays, setWeekdays] = useState<number[]>(current?.weekdays ?? []);
  const [ends, setEnds] = useState<RecurrenceEnds>(current?.ends ?? { kind: "never" });

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const pick = (rule: RecurrenceRule) => {
    onClose();
    onPick(rule);
  };

  const customRule: RecurrenceRule = { freq, interval, weekdays, anchor, ends };

  const toggleWeekday = (d: number) =>
    setWeekdays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)
    );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-8 pt-[14vh] backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        ref={ref}
        tabIndex={-1}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            if (custom) setCustom(false);
            else onClose();
          } else if (!custom) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, presets.length)); // last slot = Custom…
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (sel === presets.length) setCustom(true);
              else pick(presets[sel].rule);
            }
          }
        }}
        className="w-full max-w-sm overflow-hidden rounded border border-line bg-surface shadow-lg outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mono border-b border-line px-4 py-2.5 text-[11px] uppercase tracking-[0.14em] text-ink-faint">
          Repeat
        </div>

        {!custom ? (
          <div className="py-1">
            {presets.map((p, i) => (
              <button
                key={p.label}
                onMouseMove={() => setSel(i)}
                onClick={() => pick(p.rule)}
                className={[
                  "flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-[14px]",
                  i === sel ? "bg-surface-2 text-ink" : "text-ink-soft",
                ].join(" ")}
              >
                <span>{p.label}</span>
                {current != null && ruleLabel(current) === p.label && (
                  <span className="text-[11px] text-accent">●</span>
                )}
              </button>
            ))}
            <button
              onMouseMove={() => setSel(presets.length)}
              onClick={() => setCustom(true)}
              className={[
                "mt-1 flex w-full items-center justify-between gap-3 border-t border-line px-4 py-2 text-left text-[14px]",
                sel === presets.length ? "bg-surface-2 text-ink" : "text-ink-soft",
              ].join(" ")}
            >
              <span>Custom…</span>
              <span className="kbd">↵</span>
            </button>
          </div>
        ) : (
          <div className="px-4 py-3">
            <div className="flex items-center gap-2 text-[14px] text-ink">
              <span className="text-ink-soft">Every</span>
              <input
                {...NO_SPELLCHECK}
                type="number"
                min={1}
                value={interval}
                onChange={(e) => setIntervalN(Math.max(1, Math.trunc(Number(e.target.value) || 1)))}
                className="w-14 rounded-sm border border-line bg-transparent px-2 py-1 text-[13px] text-ink outline-none"
              />
              <select
                value={freq}
                onChange={(e) => setFreq(e.target.value as RecurrenceFreq)}
                className="rounded-sm border border-line bg-transparent px-2 py-1 text-[13px] text-ink outline-none"
              >
                {FREQS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                    {interval > 1 ? "s" : ""}
                  </option>
                ))}
              </select>
            </div>

            {freq === "week" && (
              <div className="mt-3 flex items-center gap-1.5">
                <span className="mr-1 text-[13px] text-ink-soft">On</span>
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <button
                    key={d}
                    onClick={() => toggleWeekday(d)}
                    className={[
                      "grid h-8 w-8 place-items-center rounded-full text-[11px] transition-colors",
                      weekdays.includes(d)
                        ? "bg-accent text-white"
                        : "bg-surface-2 text-ink-soft hover:text-ink",
                    ].join(" ")}
                  >
                    {WEEKDAY_SHORT[d].slice(0, 2)}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-4">
              <div className="eyebrow mb-2">Ends</div>
              <div className="flex flex-col gap-2 text-[13px]">
                <EndsRow
                  active={ends.kind === "never"}
                  onSelect={() => setEnds({ kind: "never" })}
                  label="Never"
                />
                <EndsRow
                  active={ends.kind === "on"}
                  onSelect={() => setEnds({ kind: "on", date: addDays(anchor, 30) })}
                  label="On"
                >
                  <input
                    {...NO_SPELLCHECK}
                    type="date"
                    disabled={ends.kind !== "on"}
                    value={ends.kind === "on" ? ends.date : ""}
                    onChange={(e) => setEnds({ kind: "on", date: e.target.value as ISODate })}
                    className="rounded-sm border border-line bg-transparent px-2 py-1 text-[12px] text-ink outline-none disabled:opacity-40"
                  />
                </EndsRow>
                <EndsRow
                  active={ends.kind === "after"}
                  onSelect={() => setEnds({ kind: "after", count: 4 })}
                  label="After"
                >
                  <input
                    {...NO_SPELLCHECK}
                    type="number"
                    min={1}
                    disabled={ends.kind !== "after"}
                    value={ends.kind === "after" ? ends.count : 4}
                    onChange={(e) =>
                      setEnds({ kind: "after", count: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })
                    }
                    className="w-16 rounded-sm border border-line bg-transparent px-2 py-1 text-[12px] text-ink outline-none disabled:opacity-40"
                  />
                  <span className="text-ink-faint">times</span>
                </EndsRow>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3">
              <span className="text-[12px] text-ink-faint">{ruleLabel(customRule)}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setCustom(false)}
                  className="rounded-sm border border-line px-3 py-1 text-[13px] text-ink-soft hover:text-ink"
                >
                  Back
                </button>
                <button
                  onClick={() => pick(customRule)}
                  className="rounded-sm bg-accent px-3 py-1 text-[13px] font-medium text-white"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EndsRow({
  active,
  onSelect,
  label,
  children,
}: {
  active: boolean;
  onSelect: () => void;
  label: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={onSelect} className="flex items-center gap-2 text-ink-soft">
        <span
          className={[
            "grid h-4 w-4 place-items-center rounded-full border",
            active ? "border-accent" : "border-line-strong",
          ].join(" ")}
        >
          {active && <span className="h-2 w-2 rounded-full bg-accent" />}
        </span>
        <span className={active ? "text-ink" : ""}>{label}</span>
      </button>
      {children}
    </div>
  );
}
