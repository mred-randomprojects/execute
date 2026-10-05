import type { ReactNode } from "react";

// Tiny inline-markdown support for task titles & notes: `code`, **bold**,
// *italic* / _italic_, ~~strike~~, and [text](url). Intentionally minimal and
// dependency-free (a full md parser would be overkill and a CSP/bundle cost).

export type InlineToken = (
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "strike"; value: string }
  | { type: "link"; value: string; href: string }
) & {
  /** Where `value` begins in the raw source text, past any markdown syntax. */
  start: number;
};

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
  let offset = 0; // where `rest` begins in `text`
  while (rest.length > 0) {
    let best: { idx: number; len: number; token: InlineToken } | null = null;
    for (const rule of RULES) {
      const m = rule.re.exec(rest);
      if (m == null) continue;
      if (best == null || m.index < best.idx) {
        // The captured value sits right after the opening syntax.
        const start = offset + m.index + m[0].indexOf(m[1]);
        const token: InlineToken =
          rule.type === "link"
            ? { type: "link", value: m[1], href: m[2], start }
            : { type: rule.type, value: m[1], start };
        best = { idx: m.index, len: m[0].length, token };
      }
    }
    if (best == null) {
      tokens.push({ type: "text", value: rest, start: offset });
      break;
    }
    if (best.idx > 0) tokens.push({ type: "text", value: rest.slice(0, best.idx), start: offset });
    tokens.push(best.token);
    rest = rest.slice(best.idx + best.len);
    offset += best.idx + best.len;
  }
  return tokens;
}

/**
 * Multi-line markdown (each line rendered with inline rules; blanks add space).
 * `find`, when non-blank, marks every case-insensitive occurrence of it.
 */
export function renderBlock(text: string, find = ""): ReactNode {
  return text.split("\n").map((line, i) =>
    line.trim() === "" ? (
      <div key={i} className="h-3" />
    ) : (
      <div key={i}>{renderInline(line, occurrences(line, find))}</div>
    )
  );
}

/** Indices of every char inside a case-insensitive occurrence of `find` in `text`. */
export function occurrences(text: string, find: string): number[] {
  const needle = find.trim().toLowerCase();
  if (needle === "") return [];
  const hay = text.toLowerCase();
  const out: number[] = [];
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
    for (let k = 0; k < needle.length; k++) out.push(at + k);
  }
  return out;
}

/** `value` (starting at raw offset `start`) with the chars in `hits` marked. */
export function marked(value: string, start: number, hits: ReadonlySet<number>): ReactNode {
  if (hits.size === 0) return value;
  const parts: ReactNode[] = [];
  let i = 0;
  while (i < value.length) {
    const hit = hits.has(start + i);
    let j = i + 1;
    while (j < value.length && hits.has(start + j) === hit) j++;
    const piece = value.slice(i, j);
    parts.push(
      hit ? (
        <mark key={i} className="rounded-[2px] bg-accent-soft text-accent">
          {piece}
        </mark>
      ) : (
        piece
      )
    );
    i = j;
  }
  return parts;
}

/**
 * Inline markdown. `hits` are indices into the raw `text` to mark — a filter's
 * match — mapped through the markdown so they land on the rendered chars; a
 * hit on syntax itself (an asterisk, a bracket) has nothing to mark and is
 * dropped.
 */
export function renderInline(text: string, hits: readonly number[] = []): ReactNode {
  const hitSet: ReadonlySet<number> = new Set(hits);
  return tokenizeInline(text).map((t, i) => {
    const value = marked(t.value, t.start, hitSet);
    switch (t.type) {
      case "text":
        return <span key={i}>{value}</span>;
      case "code":
        return (
          <code
            key={i}
            className="rounded-sm bg-surface-3 px-1 py-[1px] font-mono text-[0.85em]"
          >
            {value}
          </code>
        );
      case "bold":
        return (
          <strong key={i} className="font-semibold">
            {value}
          </strong>
        );
      case "italic":
        return (
          <em key={i} className="italic">
            {value}
          </em>
        );
      case "strike":
        return (
          <span key={i} className="line-through">
            {value}
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
            {value}
          </a>
        );
    }
  });
}
