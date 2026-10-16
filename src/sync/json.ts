/**
 * Deep structural equality for JSON-safe values. AppState is fully JSON
 * (primitives, plain objects, arrays, null — no Dates/functions), so this is a
 * sound equality for it. The pull loop uses it to detect a no-op merge: an
 * unchanged result means "the remote added nothing new" → don't re-render, and
 * a result equal to the remote means "the cloud is already current" → don't echo
 * a pointless push. Both together are what keep pull↔push from looping.
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || a === null) return false;
  if (typeof b !== "object" || b === null) return false;
  const aArr = Array.isArray(a);
  if (aArr !== Array.isArray(b)) return false;
  if (aArr) {
    const ar = a as unknown[];
    const br = b as unknown[];
    if (ar.length !== br.length) return false;
    for (let i = 0; i < ar.length; i++) if (!jsonEqual(ar[i], br[i])) return false;
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = Object.keys(ao);
  if (keys.length !== Object.keys(bo).length) return false;
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
    if (!jsonEqual(ao[k], bo[k])) return false;
  }
  return true;
}
