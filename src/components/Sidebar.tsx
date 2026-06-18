import type { ReactNode } from "react";
import type { ViewKind } from "../selectors";

interface NavDef {
  key: ViewKind;
  label: string;
  hint: string;
  badge?: number;
}

export function Sidebar({
  view,
  todayRemaining,
  backlog,
  trash,
  onSelect,
  onOpenHelp,
  onCycleTheme,
  children,
}: {
  view: ViewKind;
  todayRemaining: number;
  backlog: number;
  trash: number;
  onSelect: (v: ViewKind) => void;
  onOpenHelp: () => void;
  onCycleTheme: () => void;
  children?: ReactNode;
}) {
  const items: NavDef[] = [
    { key: "today", label: "Today", hint: "1", badge: todayRemaining },
    { key: "backlog", label: "Backlog", hint: "2", badge: backlog },
    { key: "all", label: "All", hint: "3" },
    { key: "trash", label: "Trash", hint: "4", badge: trash },
  ];

  return (
    <aside className="flex w-[230px] shrink-0 flex-col border-r border-line bg-surface px-3 pb-3 pt-8">
      <div className="flex items-center gap-2 px-2 pb-5 pt-2">
        <div className="grid h-8 w-8 place-items-center rounded-sm border border-line-strong bg-ink font-serif text-[18px] text-bg">
          e
        </div>
        <span className="font-serif text-[17px] font-medium tracking-tight text-ink">
          execute
        </span>
      </div>

      <div className="eyebrow px-2 pb-2">Views</div>
      <nav className="flex flex-col gap-[2px]">
        {items.map((it) => {
          const active = view === it.key;
          return (
            <button
              key={it.key}
              onClick={() => onSelect(it.key)}
              className={[
                "relative flex items-center gap-2 rounded-sm px-2.5 py-[7px] text-left text-[14px] transition-colors",
                active
                  ? "bg-surface-2 font-semibold text-ink"
                  : "text-ink-soft hover:bg-surface-2/60 hover:text-ink",
              ].join(" ")}
            >
              {active && (
                <span className="absolute left-0 top-2 bottom-2 w-[2px] bg-accent" />
              )}
              <span className="flex-1">{it.label}</span>
              {it.badge != null && it.badge > 0 && (
                <span className="mono text-[11px] text-ink-faint">{it.badge}</span>
              )}
              <span className="mono text-[10px] text-ink-faint">{it.hint}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-1 border-t border-line pt-3">
        <button
          onClick={onOpenHelp}
          className="flex items-center justify-between rounded-sm px-2.5 py-1.5 text-[13px] text-ink-soft hover:bg-surface-2/60 hover:text-ink"
        >
          <span>Keyboard help</span>
          <span className="kbd">?</span>
        </button>
        <button
          onClick={onCycleTheme}
          className="flex items-center justify-between rounded-sm px-2.5 py-1.5 text-[13px] text-ink-soft hover:bg-surface-2/60 hover:text-ink"
        >
          <span>Theme</span>
          <span className="h-[14px] w-[14px] rounded-full border border-line-strong bg-accent" />
        </button>
        {children}
      </div>
    </aside>
  );
}
