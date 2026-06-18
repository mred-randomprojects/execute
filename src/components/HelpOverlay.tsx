import { keymap } from "../keyboard/keymap";

interface HelpItem {
  keys: string;
  description: string;
}

// Auto-generated from the keymap: every binding with a `description` shows up.
function buildSections(): Array<{ title: string; items: HelpItem[] }> {
  const order: string[] = [];
  const bySection = new Map<string, HelpItem[]>();
  for (const b of keymap) {
    if (b.description == null || b.displayKey == null) continue;
    const section = b.section ?? "Other";
    if (!bySection.has(section)) {
      bySection.set(section, []);
      order.push(section);
    }
    bySection.get(section)?.push({ keys: b.displayKey, description: b.description });
  }
  return order.map((title) => ({ title, items: bySection.get(title) ?? [] }));
}

// Capture keys are handled locally by the row input, so they're documented here.
const CAPTURE_SECTION = {
  title: "Capture (while typing a task)",
  items: [
    { keys: "↵", description: "save + new task below" },
    { keys: "tab", description: "indent into a subtask" },
    { keys: "⇧ tab", description: "outdent" },
    { keys: "esc", description: "save + stop editing" },
    { keys: "⌫", description: "delete when empty" },
    { keys: "[] / - / [x]", description: "checkbox & bullet shortcuts" },
  ],
};

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  const sections = [...buildSections(), CAPTURE_SECTION];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-8 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="max-h-full w-full max-w-3xl overflow-auto rounded border border-line bg-surface p-7 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-baseline justify-between">
          <h2 className="font-serif text-2xl font-medium tracking-tight text-ink">
            Keyboard
          </h2>
          <button
            onClick={onClose}
            className="kbd"
            aria-label="Close help"
          >
            esc
          </button>
        </div>

        <div className="columns-1 gap-8 sm:columns-2">
          {sections.map((section) => (
            <div key={section.title} className="mb-6 break-inside-avoid">
              <div className="eyebrow mb-2">{section.title}</div>
              <div className="flex flex-col gap-1.5">
                {section.items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between gap-4">
                    <span className="text-[13px] text-ink-soft">
                      {item.description}
                    </span>
                    <span className="kbd shrink-0">{item.keys}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
