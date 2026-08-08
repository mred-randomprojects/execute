import type { Config } from "tailwindcss";

// Colors map to CSS variables defined in src/theme.css so that switching the
// `data-theme` attribute on <html> re-themes the whole app instantly, while we
// still get Tailwind utility ergonomics (bg-surface, text-ink, border-line, …).

/**
 * A themed color that also honours the opacity modifier (`bg-good/45`).
 *
 * Plain `"var(--x)"` does NOT: Tailwind can't split a variable into channels, so
 * it silently generates *no rule at all* and the element renders with no
 * background or border whatsoever. That quietly killed ~50 intended styles here
 * — every `hover:bg-surface-2/60`, the accent ring on the current task, the
 * chip borders in the Reckoning, and all nine `bg-ink/30` modal backdrops, which
 * meant the dialogs had been dimming nothing at all. A missing rule fails
 * invisibly, which is why it survived so long.
 *
 * Returning a function keeps the variables and honours the modifier: bare, we
 * emit the variable; with an alpha, we mix it toward transparent. `color-mix` is
 * available everywhere this ships (Chrome 111+ / Safari 16.2+; Electron 32 is
 * Chrome 128).
 *
 * The alpha goes through `calc(… * 100%)` rather than being multiplied here,
 * because a *bare* utility doesn't pass a number: Tailwind hands us the string
 * `var(--tw-bg-opacity)`. Doing the arithmetic in JS turns that into NaN and the
 * plain `bg-good` you'd swear was fine renders transparent. `calc` handles the
 * literal and the variable identically.
 */
const themed =
  (variable: string) =>
  ({ opacityValue }: { opacityValue?: string }): string =>
    opacityValue == null
      ? `var(${variable})`
      : `color-mix(in srgb, var(${variable}) calc(${opacityValue} * 100%), transparent)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: themed("--bg"),
        surface: themed("--surface"),
        "surface-2": themed("--surface-2"),
        "surface-3": themed("--surface-3"),
        ink: themed("--ink"),
        "ink-soft": themed("--ink-soft"),
        "ink-faint": themed("--ink-faint"),
        line: themed("--line"),
        "line-strong": themed("--line-strong"),
        accent: themed("--accent"),
        "accent-soft": themed("--accent-soft"),
        "btn-bg": themed("--btn-bg"),
        "btn-fg": themed("--btn-fg"),
        good: themed("--s-good"),
        "good-soft": themed("--s-good-soft"),
        mid: themed("--s-mid"),
        "mid-soft": themed("--s-mid-soft"),
        bad: themed("--s-bad"),
        "bad-soft": themed("--s-bad-soft"),
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
