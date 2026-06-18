// Normalizes typed/pasted text into a task. Lets Notion/Markdown-style input
// "just work": "[] buy milk" / "- buy milk" / "* buy milk" → "buy milk", and
// "[x] done thing" → a completed task.

export interface ParsedCapture {
  text: string;
  completed: boolean;
}

const CHECKBOX = /^\[(\s|x|X)?\]\s*/;
const BULLET = /^[-*]\s+/;

export function parseCapture(raw: string): ParsedCapture {
  let text = raw.replace(/^\s+/, "");
  let completed = false;

  const checkbox = text.match(CHECKBOX);
  if (checkbox != null) {
    completed = (checkbox[1] ?? "").toLowerCase() === "x";
    text = text.slice(checkbox[0].length);
  } else if (BULLET.test(text)) {
    text = text.replace(BULLET, "");
  }

  return { text: text.trim(), completed };
}
