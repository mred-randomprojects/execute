import type { Config } from "tailwindcss";

// Colors map to CSS variables defined in src/theme.css so that switching the
// `data-theme` attribute on <html> re-themes the whole app instantly, while we
// still get Tailwind utility ergonomics (bg-surface, text-ink, border-line, …).
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        "surface-3": "var(--surface-3)",
        ink: "var(--ink)",
        "ink-soft": "var(--ink-soft)",
        "ink-faint": "var(--ink-faint)",
        line: "var(--line)",
        "line-strong": "var(--line-strong)",
        accent: "var(--accent)",
        "accent-soft": "var(--accent-soft)",
        "btn-bg": "var(--btn-bg)",
        "btn-fg": "var(--btn-fg)",
        good: "var(--s-good)",
        "good-soft": "var(--s-good-soft)",
        mid: "var(--s-mid)",
        "mid-soft": "var(--s-mid-soft)",
        bad: "var(--s-bad)",
        "bad-soft": "var(--s-bad-soft)",
      },
      fontFamily: {
        sans: "var(--sans)",
        serif: "var(--serif)",
        mono: "var(--mono)",
      },
      borderRadius: {
        DEFAULT: "var(--r)",
        sm: "var(--r-sm)",
      },
      boxShadow: {
        soft: "var(--shadow)",
        lg: "var(--shadow-lg)",
      },
    },
  },
  plugins: [],
} satisfies Config;
