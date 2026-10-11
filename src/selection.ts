// Shared helpers for a measure-range selection (the app's "focus range").
// `null` means the whole piece. Centralized here because the start/end-beat
// conversion, the localStorage key, and the human-readable label are each
// computed independently by the three mode hooks, PracticeScreen, and the
// bookmarks UI — those strings and beat conversions must agree exactly
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
 * Whether a note or event belongs to a selection, tested by its 1-based
 * rendered measure number (`measureIndex + 1`) — the same coordinate the focus
 * range's `from`/`to` are expressed in. `null` (whole piece) contains every
 * measure.
 *
 * Membership is deliberately by *measure*, not by comparing beats against the
 * range's start/end beat. A beat comparison is fragile at a range boundary:
 * `startBeat + durationBeats` for a note ending exactly on a barline can
 * overshoot the true beat by a floating-point ULP (the sum is accumulated over
 * a different sequence of divisions than `computeMeasureStartBeats` walks), so a
 * note that ends precisely where the focus range begins reads as still sounding
 * and leaks in. Keying on the integer measure number sidesteps that entirely —
 * the same reason wait mode's `rangeBounds` filters wait points by `measure`.
 */
export function measureInRange(
  measure: number,
  range: MeasureRange | null,
): boolean {
  if (!range) {
    return true;
  }
  return measure >= range.from && measure <= range.to;
}

/**
 * localStorage key fragment identifying a selection. Shared by wait-mode and
 * playalong attempt history and bookmarks — must stay stable, since it is
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

/** A measure range with a display name — a preset, section, or bookmark. */
export interface NamedRange extends MeasureRange {
  name: string;
}

/**
 * The built-in halves and quarters presets offered in the ranges drawer. A
 * piece too short to split (fewer than 2 measures for halves, 4 for quarters)
 * gets an empty list rather than presets with empty ranges.
 */
export function presetRanges(totalMeasures: number): {
  halves: NamedRange[];
  quarters: NamedRange[];
} {
  const n = totalMeasures;
  const half = Math.floor(n / 2);
  const quarter = Math.floor(n / 4);
  const threeQuarters = Math.floor((3 * n) / 4);
  return {
    halves:
      n >= 2
        ? [
            { name: "First half", from: 1, to: half },
            { name: "Second half", from: half + 1, to: n },
          ]
        : [],
    quarters:
      n >= 4
        ? [
            { name: "Q1", from: 1, to: quarter },
            { name: "Q2", from: quarter + 1, to: half },
            { name: "Q3", from: half + 1, to: threeQuarters },
            { name: "Q4", from: threeQuarters + 1, to: n },
          ]
        : [],
  };
}

/**
 * The selection to move to for "previous"/"next" section navigation, or null
 * when there is nowhere to go (whole piece selected, or already at the edge).
 *
 * - If the current range is one of an ordered series (`orderedSeries`: halves,
 *   quarters, repeat sections), step to its neighbour within that series —
 *   Q1 → Q2, not to some unrelated range that happens to start next.
 * - Otherwise, if a bookmark sits immediately next to the current range (starts
 *   at `to + 1` for next, ends at `from − 1` for previous), go there. Several
 *   candidates: the one closest in length to the current range wins (ties go to
 *   the shorter one).
 * - Otherwise slide the window by its own length (19–20 → 21–22), clamped to
 *   the piece. (A bookmark exactly matching the slid window is adjacent, so it
 *   would already have been picked above.)
 */
export function adjacentSection(
  range: MeasureRange | null,
  direction: "previous" | "next",
  totalMeasures: number,
  bookmarks: NamedRange[],
  orderedSeries: NamedRange[][],
): NamedRange | null {
  if (!range) {
    return null;
  }
  const step = direction === "next" ? 1 : -1;

  for (const series of orderedSeries) {
    const index = series.findIndex(
      (member) => member.from === range.from && member.to === range.to,
    );
    if (index !== -1) {
      return series[index + step] ?? null;
    }
  }

  const length = range.to - range.from + 1;
  const adjacentBookmarks = bookmarks
    .filter((bookmark) =>
      direction === "next"
        ? bookmark.from === range.to + 1
        : bookmark.to === range.from - 1,
    )
    .sort((a, b) => {
      const lengthA = a.to - a.from + 1;
      const lengthB = b.to - b.from + 1;
      return (
        Math.abs(lengthA - length) - Math.abs(lengthB - length) ||
        lengthA - lengthB
      );
    });
  if (adjacentBookmarks.length > 0) {
    return adjacentBookmarks[0];
  }

  const slid =
    direction === "next"
      ? { from: range.to + 1, to: Math.min(totalMeasures, range.to + length) }
      : { from: Math.max(1, range.from - length), to: range.from - 1 };
  if (slid.from > slid.to || slid.from < 1 || slid.to > totalMeasures) {
    return null;
  }
  return { ...slid, name: selectionLabelForRange(slid) };
}
