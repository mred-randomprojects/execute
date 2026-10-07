import { useEffect, useRef, useState } from "react";
import type { HabitMeasure } from "../types";
import { formatValue, parseValue, rangeLabel } from "../store/habits";
import { NO_SPELLCHECK } from "../ui/noSpellcheck";

/** A range small enough to answer with one click per value: 0–3+, 0–10. */
const MAX_CHIPS = 11;

function chipValues(m: HabitMeasure): number[] {
  if (!Number.isInteger(m.min) || !Number.isInteger(m.max) || m.max - m.min + 1 > MAX_CHIPS) return [];
  const out: number[] = [];
  for (let v = m.min; v <= m.max; v++) out.push(v);
  return out;
}

/**
 * One KPI's number for one day: type it and press ↵ (an empty ↵ clears a
 * logged value), or click a chip when the range is small. Owns its keys while
 * focused — digits never reach the view underneath — except ↑/↓, which move
 * on, and `l` in a shutdown, which sets the row aside for later.
 */
export function KpiValueInput({
  measure,
  value,
  autoFocus = false,
  onCommit,
  onMove,
  onLater,
  onCancel,
}: {
  measure: HabitMeasure;
  value: number | null;
  autoFocus?: boolean;
  onCommit: (value: number | null) => void;
  onMove?: (dir: 1 | -1) => void;
  onLater?: () => void;
  onCancel?: () => void;
}) {
  const [text, setText] = useState(value == null ? "" : formatValue(measure, value));
  const [bad, setBad] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const commit = () => {
    if (text.trim() === "") {
      if (value != null) onCommit(null);
      return;
    }
    const v = parseValue(measure, text);
    if (v == null) return setBad(true);
    onCommit(v);
  };

  const chips = chipValues(measure);
  return (
    <div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <input
        ref={ref}
        {...NO_SPELLCHECK}
        inputMode="decimal"
        value={text}
        placeholder={rangeLabel(measure)}
        aria-label={`Value, ${rangeLabel(measure)}`}
        aria-invalid={bad}
        onChange={(e) => {
          setText(e.target.value);
          setBad(false);
        }}
        onKeyDown={(e) => {
          if (e.metaKey || e.ctrlKey) return; // ⌘k, ⌘z & co. still reach the app
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            ref.current?.blur();
            onCancel?.();
          } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && onMove != null) {
            e.preventDefault();
            onMove(e.key === "ArrowDown" ? 1 : -1);
          } else if (e.key.toLowerCase() === "l" && onLater != null) {
            e.preventDefault();
            onLater();
          }
        }}
        className={[
          "mono w-[72px] rounded-sm border bg-bg px-2 py-0.5 text-[13px] text-ink outline-none placeholder:text-ink-faint",
          bad ? "border-bad" : "border-line-strong focus:border-accent",
        ].join(" ")}
      />
      {chips.map((v) => (
        <button
          key={v}
          type="button"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onCommit(v)}
          className={[
            "mono min-w-[26px] rounded-sm border px-1.5 py-0.5 text-[12px]",
            value === v ? "border-accent bg-accent text-bg" : "border-line text-ink-soft hover:border-accent hover:text-ink",
          ].join(" ")}
        >
          {formatValue(measure, v)}
        </button>
      ))}
      <span className="text-[11px] text-ink-faint">
        <span className="kbd">↵</span>
        {value != null && " · empty ↵ clears"}
      </span>
    </div>
  );
}
