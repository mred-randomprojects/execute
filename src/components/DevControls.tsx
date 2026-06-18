import type { ISODate } from "../types";
import { addDays } from "../store/dates";

// Dev-only: pretend it's another day so the rollover ritual can be exercised
// without waiting. Hidden in packaged builds (import.meta.env.DEV === false).
export function DevControls({
  today,
  override,
  onSet,
}: {
  today: ISODate;
  override: ISODate | null;
  onSet: (date: ISODate | null) => void;
}) {
  return (
    <div className="mt-2 rounded-sm border border-dashed border-line-strong px-2.5 py-2">
      <div className="eyebrow mb-1.5">Dev · time travel</div>
      <div className="mono mb-1.5 text-[11px] text-ink-soft">
        {today}
        {override != null ? " (override)" : ""}
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onSet(addDays(today, -1))}
          className="kbd flex-1"
        >
          −1d
        </button>
        <button onClick={() => onSet(addDays(today, 1))} className="kbd flex-1">
          +1d
        </button>
        <button
          onClick={() => onSet(null)}
          className="kbd flex-1"
          disabled={override == null}
        >
          reset
        </button>
      </div>
    </div>
  );
}
