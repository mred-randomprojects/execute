import type { ReactNode } from "react";

// Tiny inline-markdown support for task titles & notes: `code`, **bold**,
// *italic* / _italic_, ~~strike~~, and [text](url). Intentionally minimal and
// dependency-free (a full md parser would be overkill and a CSP/bundle cost).

export type InlineToken =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "strike"; value: string }
  | { type: "link"; value: string; href: string };

const RULES: Array<{ type: InlineToken["type"]; re: RegExp }> = [
  { type: "code", re: /`([^`]+)`/ },
  { type: "link", re: /\[([^\]]+)\]\(([^)\s]+)\)/ },
  { type: "bold", re: /\*\*([^*]+)\*\*/ },
  { type: "strike", re: /~~([^~]+)~~/ },
  { type: "italic", re: /\*([^*]+)\*/ },
  { type: "italic", re: /_([^_]+)_/ },
];

export function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let rest = text;
  while (rest.length > 0) {
    let best: { idx: number; len: number; token: InlineToken } | null = null;
    for (const rule of RULES) {
      const m = rule.re.exec(rest);
      if (m == null) continue;
      if (best == null || m.index < best.idx) {
        const token: InlineToken =
          rule.type === "link"
            ? { type: "link", value: m[1], href: m[2] }
            : { type: rule.type, value: m[1] };
        best = { idx: m.index, len: m[0].length, token };
      }
    }
    if (best == null) {
      tokens.push({ type: "text", value: rest });
      break;
    }
    if (best.idx > 0) tokens.push({ type: "text", value: rest.slice(0, best.idx) });
    tokens.push(best.token);
    rest = rest.slice(best.idx + best.len);
  }
  return tokens;
}

/** Multi-line markdown (each line rendered with inline rules; blanks add space). */
export function renderBlock(text: string): ReactNode {
  return text.split("\n").map((line, i) =>
    line.trim() === "" ? (
      <div key={i} className="h-3" />
    ) : (
      <div key={i}>{renderInline(line)}</div>
    )
  );
}

export function renderInline(text: string): ReactNode {
  return tokenizeInline(text).map((t, i) => {
    switch (t.type) {
      case "text":
        return <span key={i}>{t.value}</span>;
      case "code":
        return (
          <code
            key={i}
            className="rounded-sm bg-surface-3 px-1 py-[1px] font-mono text-[0.85em]"
          >
            {t.value}
          </code>
        );
      case "bold":
        return (
          <strong key={i} className="font-semibold">
            {t.value}
          </strong>
        );
      case "italic":
        return (
          <em key={i} className="italic">
            {t.value}
          </em>
        );
      case "strike":
        return (
          <span key={i} className="line-through">
            {t.value}
          </span>
        );
      case "link":
        return (
          <a
            key={i}
            href={t.href}
            target="_blank"
            rel="noreferrer"
            className="text-accent underline underline-offset-2"
            onClick={(e) => e.stopPropagation()}
          >
            {t.value}
          </a>
        );
    }
  });
}
