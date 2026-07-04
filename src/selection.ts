// Shared helpers for a measure-range selection (the app's "focus range").
// `null` means the whole piece. Centralized here because the start/end-beat
// conversion, the localStorage key, and the human-readable label are each
// computed independently by the three mode hooks, PracticeScreen, and the
// custom-ranges UI — those strings and beat conversions must agree exactly
// (the key is a persisted storage key; the beat conversion feeds the player
// and cursor), so one implementation is load-bearing, not just tidiness.

export interface MeasureRange {
  from: number;
  to: number;
}

/** Quarter-note beat where a selection begins — 0 for the whole piece. */
export function selectionStartBeat(
  range: MeasureRange | null,
  measureStartBeats: number[],
): number {
  return range ? (measureStartBeats[range.from - 1] ?? 0) : 0;
}

/**
 * Quarter-note beat where a selection ends — `totalBeats` for the whole
 * piece.
 */
export function selectionEndBeat(
  range: MeasureRange | null,
  measureStartBeats: number[],
  totalBeats: number,
): number {
  return range ? (measureStartBeats[range.to] ?? totalBeats) : totalBeats;
}

/**
 * localStorage key fragment identifying a selection. Shared by wait-mode and
 * playalong attempt history and custom ranges — must stay stable, since it is
 * itself persisted as (part of) a storage key.
 */
export function selectionKeyForRange(range: MeasureRange | null): string {
  return range ? `m${range.from}-m${range.to}` : "full";
}

/** Human-readable label for a selection, e.g. "Measures 3–5" or "Full piece". */
export function selectionLabelForRange(range: MeasureRange | null): string {
  if (!range) {
    return "Full piece";
  }
  return range.from === range.to
    ? `Measure ${range.from}`
    : `Measures ${range.from}–${range.to}`;
}
