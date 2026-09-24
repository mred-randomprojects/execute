// ─── Sibling order as data ───────────────────────────────────────────
//
// A task's position among its siblings is a `rank` string, and siblings sort by
// it. Ranks are fractional: there is always another string between any two, so
// moving one task gives it a new rank between its new neighbours and leaves
// every other task alone. That is what lets sync treat a move as an edit to ONE
// task — resolvable per task by `movedAt` — instead of "whoever wrote last owns
// the whole tree shape".
//
// Digits are base 62 in ASCII order (0-9 < A-Z < a-z), so plain string `<`
// compares ranks. A valid rank is non-empty and never ends in "0" (a trailing
// zero would leave no room below it at that length). The empty string means
// "no rank yet", and the store assigns one.
//
// `midpoint` is rocicorp/fractional-indexing's, minus the integer part.

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const VALID = /^[0-9A-Za-z]*[1-9A-Za-z]$/;

export function isValidRank(rank: string): boolean {
  return VALID.test(rank);
}

/** A rank strictly between `a` and `b`. `a = ""` is "no lower bound", `b = null` "no upper". */
function midpoint(a: string, b: string | null): string {
  if (b != null) {
    let n = 0;
    while ((a[n] ?? "0") === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a !== "" ? DIGITS.indexOf(a[0]) : 0;
  const digitB = b != null ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (digitB - digitA > 1) return DIGITS[Math.round((digitA + digitB) / 2)];
  if (b != null && b.length > 1) return b.slice(0, 1);
  return DIGITS[digitA] + midpoint(a.slice(1), null);
}

/**
 * `n` increasing ranks strictly between `lo` and `hi`, split evenly so their
 * length grows with log(n) rather than n. Deterministic: the same bounds and
 * count always give the same ranks, which is what makes two devices migrating
 * the same unranked list agree.
 */
export function ranksBetween(lo: string, hi: string | null, n: number): string[] {
  if (n <= 0) return [];
  if (hi != null && lo >= hi) throw new Error(`rank bounds out of order: "${lo}" ≥ "${hi}"`);
  const mid = midpoint(lo, hi);
  const left = Math.floor((n - 1) / 2);
  return [...ranksBetween(lo, mid, left), mid, ...ranksBetween(mid, hi, n - 1 - left)];
}

/**
 * Indices of a longest strictly-increasing run (not necessarily contiguous) of
 * `ranks`, among the indices `eligible` allows. These are the siblings that can
 * keep their rank; everyone else gets a new one between them. After a drag, the
 * dragged task is the one left out — so a move re-ranks one task, not a list.
 */
function keepable(ranks: readonly string[], eligible: (i: number) => boolean): Set<number> {
  // Patience sorting: tails[k] = index ending the best run of length k + 1.
  const tails: number[] = [];
  const prevOf = new Map<number, number>();
  for (let i = 0; i < ranks.length; i++) {
    if (!eligible(i)) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ranks[tails[mid]] < ranks[i]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prevOf.set(i, tails[lo - 1]);
    tails[lo] = i;
  }
  const keep = new Set<number>();
  let at: number | undefined = tails[tails.length - 1];
  while (at != null) {
    keep.add(at);
    at = prevOf.get(at);
  }
  return keep;
}

/**
 * Ranks for a sibling list in its current order: every rank strictly
 * increasing. Siblings `eligible` to keep theirs do so where they can (a valid
 * rank that fits the order); the rest get fresh ranks between their kept
 * neighbours. Returns the input array itself when nothing needs to change.
 */
export function rankList(
  ranks: readonly string[],
  eligible: (i: number) => boolean = () => true,
): readonly string[] {
  const keep = keepable(ranks, (i) => isValidRank(ranks[i]) && eligible(i));
  if (keep.size === ranks.length) return ranks;
  const out = [...ranks];
  let i = 0;
  while (i < out.length) {
    if (keep.has(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j < out.length && !keep.has(j)) j++;
    const lo = i > 0 ? out[i - 1] : "";
    const hi = j < out.length ? out[j] : null;
    const fresh = ranksBetween(lo, hi, j - i);
    for (let k = 0; k < fresh.length; k++) out[i + k] = fresh[k];
    i = j;
  }
  return out;
}
