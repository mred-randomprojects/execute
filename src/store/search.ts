import type { Project, ProjectId, Task } from "../types";

// ─── Subsequence matching ───────────────────────────────────────────
//
// "Subsequence" = every character of the query appears in the target, in order,
// but not necessarily adjacent: "byml" matches "Buy milk", "sched" matches
// "Reschedule the launch". Matching is case-insensitive.
//
// Membership ("does it match at all") is decided by a cheap greedy left-to-right
// scan. Only for the matches does a small dynamic program find the *best-looking*
// alignment — the one a person would highlight — so ranking rewards contiguous
// runs and word-boundary starts. Greedy alone would mis-highlight "app" in
// "a purple apple" (it grabs the stray p's), so the DP earns its keep.

export interface SubseqMatch {
  /** Indices into the target string that were matched, ascending. */
  indices: number[];
  /** Higher is a better-looking match. Only comparable within one target field. */
  score: number;
}

const NEG = Number.NEGATIVE_INFINITY;

/** Every matched char is worth a little on its own. */
const BASE_CHAR = 1;
/**
 * A run of matched chars scores well above a scattered one — kept larger than
 * {@link WORD_START_BONUS} so a solid substring match always beats one that
 * fragments itself just to land an extra word-boundary hit.
 */
const CONTIGUOUS_BONUS = 8;
/** Matching the first letter of a word (or the string) is what people scan for. */
const WORD_START_BONUS = 9;
/** Skipping chars to reach the next match (breaking a run) costs something. */
const GAP_PENALTY = 3;
/** A gentle nudge so an earlier match outranks an equal one further in. */
const LEADING_GAP_PENALTY = 0.5;

/** How a matched char sits relative to the previously matched one. */
type Step = "first" | "run" | "gap";

function isWordChar(ch: string): boolean {
  return /[a-z0-9]/i.test(ch);
}

/** True when position `i` begins a word — string start, or after a non-word char. */
function isWordStart(text: string, i: number): boolean {
  return i === 0 || !isWordChar(text[i - 1]);
}

/** Per-char score at position `i`, given how it follows the previous match. */
function charScore(text: string, i: number, step: Step): number {
  let s = BASE_CHAR;
  if (step === "run") s += CONTIGUOUS_BONUS;
  else if (step === "gap") s -= GAP_PENALTY;
  if (isWordStart(text, i)) s += WORD_START_BONUS;
  return s;
}

/** Cheap "is `query` a subsequence of `text`" test on already-lowercased input. */
function isSubsequence(queryLower: string, textLower: string): boolean {
  let qi = 0;
  for (let ti = 0; ti < textLower.length && qi < queryLower.length; ti++) {
    if (textLower[ti] === queryLower[qi]) qi++;
  }
  return qi === queryLower.length;
}

/**
 * Best subsequence alignment of `query` within `text`, or `null` if `query`
 * isn't a subsequence at all. An empty query matches nothing (callers treat an
 * empty search as "no results", not "everything").
 */
export function subsequenceMatch(query: string, text: string): SubseqMatch | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const k = q.length;
  const n = t.length;
  if (k === 0 || k > n) return null;
  if (!isSubsequence(q, t)) return null;

  // dp[j] = best score for matching q[0..i] with q[i] placed at text position j
  // (NEG where q[i] can't sit at j). parent[i][j] = the text position of q[i-1]
  // in that best alignment, for reconstruction.
  let prev: number[] = new Array(n).fill(NEG);
  const parent: number[][] = [];

  for (let i = 0; i < k; i++) {
    const cur: number[] = new Array(n).fill(NEG);
    const par: number[] = new Array(n).fill(-1);
    // Running best of prev[0..j-1] and the position that achieved it, so the
    // "any earlier match" case stays O(n) rather than O(n²).
    let bestPrev = NEG;
    let bestPrevAt = -1;
    for (let j = 0; j < n; j++) {
      if (t[j] === q[i]) {
        if (i === 0) {
          cur[j] = charScore(t, j, "first");
          par[j] = -1;
        } else {
          // Gap: chain onto the best match strictly before j (a run was broken).
          if (bestPrev > NEG) {
            const cand = bestPrev + charScore(t, j, "gap");
            if (cand > cur[j]) {
              cur[j] = cand;
              par[j] = bestPrevAt;
            }
          }
          // Run: chain onto a match at exactly j-1 (worth the contiguity bonus).
          if (j > 0 && prev[j - 1] > NEG) {
            const cand = prev[j - 1] + charScore(t, j, "run");
            if (cand > cur[j]) {
              cur[j] = cand;
              par[j] = j - 1;
            }
          }
        }
      }
      // Fold prev[j] into the running max for the next column's "earlier" case.
      if (prev[j] > bestPrev) {
        bestPrev = prev[j];
        bestPrevAt = j;
      }
    }
    parent.push(par);
    prev = cur;
  }

  // Best final cell = end of the alignment; reconstruct indices backwards.
  let endJ = -1;
  let best = NEG;
  for (let j = 0; j < n; j++) {
    if (prev[j] > best) {
      best = prev[j];
      endJ = j;
    }
  }
  if (endJ === -1) return null; // unreachable given the subsequence pre-check

  const indices: number[] = [];
  let j = endJ;
  for (let i = k - 1; i >= 0; i--) {
    indices.push(j);
    j = parent[i][j];
  }
  indices.reverse();

  const score = best - indices[0] * LEADING_GAP_PENALTY;
  return { indices, score };
}

// ─── Searching the task tree ────────────────────────────────────────

/** Which field a result matched on. Titles rank above notes. */
export type MatchField = "text" | "notes";

export interface TaskSearchResult {
  task: Task;
  /** The task's project, if it still exists. */
  project: Project | undefined;
  /** Ancestors from root down to the immediate parent (never the task itself). */
  ancestors: Task[];
  field: MatchField;
  /** Match on the field named by `field` — its `indices` point into that string. */
  match: SubseqMatch;
  /** Overall rank key; higher is better. */
  score: number;
}

/** Notes matches are real but weaker signal than a title match. */
const NOTES_FIELD_PENALTY = 40;

/**
 * Every task in `tasks` (at any depth) whose title — or, failing that, notes —
 * matches `query` as a subsequence, best matches first. Trashed tasks live in a
 * separate array and are intentionally not searched. An empty/blank query
 * returns nothing.
 *
 * Ranking: title matches over notes matches, then by match score, then most
 * recently touched, then shorter title — so the closest, freshest thing wins
 * ties predictably.
 */
export function searchTasks(
  tasks: Task[],
  projects: Project[],
  query: string,
  limit = 50,
): TaskSearchResult[] {
  const trimmed = query.trim();
  if (trimmed === "") return [];

  const byId = new Map<ProjectId, Project>(projects.map((p) => [p.id, p]));
  const results: TaskSearchResult[] = [];

  const visit = (node: Task, ancestors: Task[]): void => {
    const textMatch = subsequenceMatch(trimmed, node.text);
    let field: MatchField | null = null;
    let match: SubseqMatch | null = null;
    if (textMatch != null) {
      field = "text";
      match = textMatch;
    } else if (node.notes !== "") {
      const notesMatch = subsequenceMatch(trimmed, node.notes);
      if (notesMatch != null) {
        field = "notes";
        match = notesMatch;
      }
    }
    if (field != null && match != null) {
      const score = match.score - (field === "notes" ? NOTES_FIELD_PENALTY : 0);
      results.push({
        task: node,
        project: byId.get(node.projectId),
        ancestors,
        field,
        match,
        score,
      });
    }
    if (node.children.length > 0) {
      const childPath = [...ancestors, node];
      for (const child of node.children) visit(child, childPath);
    }
  };

  for (const root of tasks) visit(root, []);

  results.sort(
    (a, b) =>
      b.score - a.score ||
      b.task.updatedAt - a.task.updatedAt ||
      a.task.text.length - b.task.text.length,
  );
  return results.slice(0, limit);
}

/**
 * Split `text` into alternating unmatched / matched segments for highlighting,
 * from a match's `indices`. Adjacent matched chars coalesce into one run.
 */
export function highlightSegments(
  text: string,
  indices: number[],
): { text: string; hit: boolean }[] {
  if (indices.length === 0) return text === "" ? [] : [{ text, hit: false }];
  const hit = new Set(indices);
  const segments: { text: string; hit: boolean }[] = [];
  let buf = "";
  let bufHit = hit.has(0);
  for (let i = 0; i < text.length; i++) {
    const isHit = hit.has(i);
    if (isHit === bufHit) {
      buf += text[i];
    } else {
      if (buf !== "") segments.push({ text: buf, hit: bufHit });
      buf = text[i];
      bufHit = isHit;
    }
  }
  if (buf !== "") segments.push({ text: buf, hit: bufHit });
  return segments;
}
