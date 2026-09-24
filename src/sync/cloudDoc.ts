import type { AppState } from "../types";

// ─── What goes into the one cloud document ───────────────────────────
//
// The whole AppState lives in a single Firestore document, and Firestore caps a
// document at 1 MiB. The one part of the state that grows without bound is the
// accountability `log` (one line per completion, keep, postpone… forever) — in
// September 2026 it was ~45% of an ~785 KB document. So the cloud carries only
// its recent end. The desktop's local file keeps the whole history, and the
// merge unions logs by id, so trimming the cloud copy never trims a device.
//
// The cost: a device starting from the cloud alone (a new laptop, the phone)
// sees only the last CLOUD_LOG_DAYS of history. Nothing on the phone reads the
// log, and the desktop that wrote it still has all of it.

/** How much of the accountability log the cloud document carries. */
export const CLOUD_LOG_DAYS = 45;

/** Firestore's hard per-document limit. */
export const FIRESTORE_MAX_DOC_BYTES = 1_048_576;

/**
 * Refuse to write above this. Leaves room for the document name, the
 * `updatedAt` stamp and estimation slop, and turns "the write silently
 * started failing" into an error that says what to do.
 */
export const CLOUD_DOC_BUDGET_BYTES = 1_000_000;

/** The projection of a state that is actually written to the cloud. */
export function toCloud(state: AppState, now: number = Date.now()): AppState {
  const horizon = now - CLOUD_LOG_DAYS * 86_400_000;
  const log = state.log.filter((e) => e.at >= horizon);
  return log.length === state.log.length ? state : { ...state, log };
}

/**
 * Firestore's documented storage size of a value: strings are UTF-8 bytes + 1,
 * numbers 8, booleans and null 1, map keys their bytes + 1, arrays and maps the
 * sum of their parts. Close enough to the server's own accounting to budget by.
 */
export function firestoreSize(value: unknown): number {
  if (value === null || value === undefined || typeof value === "boolean") return 1;
  if (typeof value === "number") return 8;
  if (typeof value === "string") return new TextEncoder().encode(value).length + 1;
  if (Array.isArray(value)) {
    let n = 0;
    for (const v of value) n += firestoreSize(v);
    return n;
  }
  if (typeof value === "object") {
    let n = 0;
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue; // dropped on write (ignoreUndefinedProperties)
      n += new TextEncoder().encode(k).length + 1 + firestoreSize(v);
    }
    return n;
  }
  return 0;
}

export class CloudDocTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super(
      `The cloud copy is too big to save (${Math.round(bytes / 1024)} KB of ` +
        `${Math.round(FIRESTORE_MAX_DOC_BYTES / 1024)} KB). Empty the Trash or ` +
        `delete old completed tasks, then sync again.`,
    );
    this.name = "CloudDocTooLargeError";
  }
}

/**
 * Thrown instead of writing when the cloud document was written by a newer
 * build. An older client can't round-trip fields it doesn't know about — it
 * would coerce them away and write the result back, silently undoing whatever
 * the newer schema added (this is how the phone's v16 build kept stripping the
 * desktop's v17 tombstones).
 */
export class OutdatedClientError extends Error {
  constructor(readonly remoteVersion: number, readonly ownVersion: number) {
    super(
      `The cloud copy was saved by a newer version of Execute (data v${remoteVersion}, ` +
        `this app v${ownVersion}). Update this app — it won't write until then.`,
    );
    this.name = "OutdatedClientError";
  }
}
