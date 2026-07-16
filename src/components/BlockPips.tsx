import { blocksFromMinutes, estimateLabel } from "../store/estimate";

/**
 * A task's effort estimate as a compact row of pips — one filled square per
 * ~20m block. Renders nothing when there's no estimate. Caps the pip run so a
 * huge estimate stays a chip, spelling the count out past the cap.
 */
export function BlockPips({
  minutes,
  max = 8,
  className = "",
}: {
  minutes: number | null;
  max?: number;
  className?: string;
}) {
  const blocks = blocksFromMinutes(minutes);
  if (blocks === 0) return null;
  const shown = Math.min(blocks, max);
  return (
    <span
      title={estimateLabel(minutes)}
      className={`inline-flex shrink-0 items-center gap-[2px] align-middle text-ink-faint ${className}`}
      aria-label={estimateLabel(minutes)}
    >
      {Array.from({ length: shown }).map((_, i) => (
        <span key={i} className="h-[6px] w-[6px] rounded-[1px] bg-current" />
      ))}
      {blocks > max && <span className="mono text-[10px] leading-none">+{blocks - max}</span>}
    </span>
  );
}
