import { useRef } from "preact/hooks";
import type { NoteHighlight } from "./mode-control";

function sameHighlight(a: NoteHighlight, b: NoteHighlight): boolean {
  if (a.kind !== b.kind || a.color !== b.color) {
    return false;
  }
  if (a.kind === "score" && b.kind === "score") {
    return a.id === b.id;
  }
  if (a.kind === "marker" && b.kind === "marker") {
    return a.noteNumber === b.noteNumber && a.beat === b.beat;
  }
  return false;
}

function sameHighlights(
  a: ReadonlyArray<NoteHighlight>,
  b: ReadonlyArray<NoteHighlight>,
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (!sameHighlight(a[i], b[i])) {
      return false;
    }
  }
  return true;
}

/**
 * Preserve the previous highlight-list reference when its contents are
 * unchanged. The mode hooks recompute the list whenever currentBeat advances
 * (many times per second), but the visible set only changes a few times per
 * second. Returning a stable reference lets the memoized overlay components in
 * SheetMusicDisplay skip re-rendering between actual changes.
 */
export function useStableHighlights(
  highlights: ReadonlyArray<NoteHighlight>,
): ReadonlyArray<NoteHighlight> {
  const ref = useRef(highlights);
  if (ref.current !== highlights && !sameHighlights(ref.current, highlights)) {
    ref.current = highlights;
  }
  return ref.current;
}
