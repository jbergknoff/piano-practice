import { useRef } from "preact/hooks";
import {
  type PlaybackNote,
  playbackNoteId,
} from "../../lib/musicxml/musicxml-playback";
import { type MeasureRange, measureInRange } from "../selection";
import type { NoteHighlight } from "./mode-control";

/**
 * The notes sounding at `currentBeat`, as score highlights — the shared basis
 * for listen mode's highlighting and playalong's idle/count-in highlighting. A
 * note is sounding when the beat falls in its half-open
 * `[startBeat, startBeat + durationBeats)` span AND its rendered measure lies
 * within the focus range.
 *
 * The `range` parameter is mandatory on purpose. The measure filter is what
 * keeps a note ending exactly on the barline where the focus range begins from
 * leaking in as a phantom first chord: that note's end beat can float-overshoot
 * the range-start beat by an ULP (the end is summed over a different division
 * sequence than `computeMeasureStartBeats` accumulates), so the raw sounding
 * test alone highlights it. Funnelling every "what is sounding now" highlight
 * through this one function — with the range as a required argument, not an
 * optional afterthought — is what stops the bug from being reintroduced the
 * next time a mode needs sounding highlights. Filtering by measure (see
 * `measureInRange`) mirrors how wait mode constrains its wait points.
 */
export function soundingHighlights(
  notes: PlaybackNote[],
  currentBeat: number,
  range: MeasureRange | null,
  accent: string,
): NoteHighlight[] {
  const highlights: NoteHighlight[] = [];
  for (const note of notes) {
    if (!measureInRange(note.measureIndex + 1, range)) {
      continue;
    }
    if (
      note.startBeat <= currentBeat &&
      currentBeat < note.startBeat + note.durationBeats
    ) {
      highlights.push({
        kind: "score",
        id: playbackNoteId(note),
        color: accent,
      });
    }
  }
  return highlights;
}

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
