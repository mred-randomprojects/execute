// ─── Effort estimates as "blocks" ───────────────────────────────────
//
// A task carries `estimatedMinutes` (the canonical, sync-friendly field). The UI
// speaks in whole *blocks* of BLOCK_MINUTES each — a shallow, low-friction scale
// (1 = 20m, 3 = 1h). These pure helpers translate between the two and never
// touch state, so they're safe to call from selectors, rows, and pickers alike.

import { BLOCK_MINUTES } from "../types";

/** The preset block counts the estimate picker offers (0 = clear). */
export const ESTIMATE_PRESETS = [1, 2, 3, 4, 6, 8] as const;

/** The largest block count a single keystroke / preset can set. */
export const MAX_ESTIMATE_BLOCKS = 8;

/**
 * How many blocks a minute estimate represents. `null` (no estimate) → 0. Any
 * positive estimate rounds to at least one block, so a sub-block guess never
 * disappears to "unestimated".
 */
export function blocksFromMinutes(minutes: number | null): number {
  if (minutes == null || minutes <= 0) return 0;
  return Math.max(1, Math.round(minutes / BLOCK_MINUTES));
}

/** Blocks → minutes, or `null` for a non-positive count (clears the estimate). */
export function minutesFromBlocks(blocks: number): number | null {
  return blocks <= 0 ? null : Math.round(blocks) * BLOCK_MINUTES;
}

/** "40m" / "1h" / "1h 20m" — a compact human label for a minute count. */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return "0m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** "3 blocks · 1h" — the estimate spelled out (for tooltips / the picker). */
export function estimateLabel(minutes: number | null): string {
  const blocks = blocksFromMinutes(minutes);
  if (blocks === 0) return "No estimate";
  const plural = blocks === 1 ? "block" : "blocks";
  return `${blocks} ${plural} · ${formatMinutes(blocks * BLOCK_MINUTES)}`;
}
