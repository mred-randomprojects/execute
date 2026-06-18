import type { OutlineId } from "../types";

// Multi-selection over the flat visible order. Ported from nutriapp's
// dailyLogKeyboard selection model (focused + anchor + selected range).

export interface Selection {
  focusedId: OutlineId | null;
  anchorId: OutlineId | null;
  selectedIds: OutlineId[];
}

export const emptySelection: Selection = {
  focusedId: null,
  anchorId: null,
  selectedIds: [],
};

function uniqueVisible(
  ids: readonly OutlineId[],
  visible: readonly OutlineId[]
): OutlineId[] {
  const visibleSet = new Set(visible);
  const seen = new Set<OutlineId>();
  const result: OutlineId[] = [];
  for (const id of ids) {
    if (!visibleSet.has(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  result.sort((a, b) => visible.indexOf(a) - visible.indexOf(b));
  return result;
}

function rangeIds(visible: readonly OutlineId[], a: number, b: number): OutlineId[] {
  return visible.slice(Math.min(a, b), Math.max(a, b) + 1);
}

function clamp(i: number, len: number): number {
  return Math.max(0, Math.min(i, len - 1));
}

export function normalize(sel: Selection, visible: readonly OutlineId[]): Selection {
  if (visible.length === 0) return emptySelection;
  const selectedIds = uniqueVisible(sel.selectedIds, visible);
  const focusedId =
    sel.focusedId != null && visible.includes(sel.focusedId)
      ? sel.focusedId
      : selectedIds[0] ?? null;
  const anchorId =
    sel.anchorId != null && visible.includes(sel.anchorId) ? sel.anchorId : focusedId;
  if (focusedId == null) return emptySelection;
  return {
    focusedId,
    anchorId,
    selectedIds: selectedIds.length > 0 ? selectedIds : [focusedId],
  };
}

export function selectOne(id: OutlineId | null, visible: readonly OutlineId[]): Selection {
  if (id == null || !visible.includes(id)) {
    return visible.length > 0
      ? { focusedId: visible[0], anchorId: visible[0], selectedIds: [visible[0]] }
      : emptySelection;
  }
  return { focusedId: id, anchorId: id, selectedIds: [id] };
}

export function moveSelection(
  sel: Selection,
  visible: readonly OutlineId[],
  dir: "up" | "down",
  extend: boolean
): Selection {
  if (visible.length === 0) return emptySelection;
  const norm = normalize(sel, visible);
  const currentIndex =
    norm.focusedId == null
      ? dir === "down"
        ? -1
        : visible.length
      : visible.indexOf(norm.focusedId);
  const nextIndex = clamp(currentIndex + (dir === "down" ? 1 : -1), visible.length);
  const nextFocused = visible[nextIndex];

  if (!extend || norm.focusedId == null || norm.anchorId == null) {
    return { focusedId: nextFocused, anchorId: nextFocused, selectedIds: [nextFocused] };
  }
  const anchorIndex = visible.indexOf(norm.anchorId);
  return {
    focusedId: nextFocused,
    anchorId: norm.anchorId,
    selectedIds: rangeIds(visible, anchorIndex, nextIndex),
  };
}

export function selectAfterRemoving(
  sel: Selection,
  visible: readonly OutlineId[],
  removed: ReadonlySet<OutlineId>
): Selection {
  const remaining = visible.filter((id) => !removed.has(id));
  if (remaining.length === 0) return emptySelection;
  const norm = normalize(sel, visible);
  const indexes = norm.selectedIds
    .map((id) => visible.indexOf(id))
    .filter((i) => i >= 0);
  const fallback = indexes.length > 0 ? Math.min(...indexes) : 0;
  return selectOne(remaining[clamp(fallback, remaining.length)], remaining);
}
