// Screen ⇄ music coordinate inverses for the editor, plus note picking. These
// reuse the vendored renderer's forward maps (`computeCursorX`, `noteY`,
// `resolveLayout`) so a click resolves to exactly the beat/pitch the renderer
// would have drawn.

import type { NoteHandle } from "./dom-edit";
import {
  BASS_BOTTOM,
  type ChordGroup,
  computeMeasureStartBeats,
  diatonicIndex,
  isRest,
  type ParsedScore,
  type Pitch,
  type ResolvedLayout,
  TREBLE_BOTTOM,
} from "./sheet-music/index";

// Finest editing grid: a quarter of a beat (a 16th note).
export const SNAP_BEATS = 0.25;

const STEPS: Pitch["step"][] = ["C", "D", "E", "F", "G", "A", "B"];

function beatsPerMeasureOf(score: ParsedScore): number {
  const timeSig = score.parts[0]?.timeSig ?? { beats: 4, beatType: 4 };
  return timeSig.beats * (4 / timeSig.beatType);
}

// Invert the renderer's measure x layout + per-measure beat span to turn an
// SVG x into an absolute quarter-note beat, snapped to the 16th-note grid and
// kept inside the clicked measure. Ports the inverse in SheetMusicDisplay's
// context-menu handler.
export function beatFromX(
  svgX: number,
  score: ParsedScore,
  layout: ResolvedLayout,
  measureStartBeats: number[],
): number {
  let measureIndex = 0;
  for (let i = 0; i < layout.measureXs.length; i++) {
    if (layout.measureXs[i] <= svgX) {
      measureIndex = i;
    }
  }
  const beatsPerMeasure = beatsPerMeasureOf(score);
  const measureX = layout.measureXs[measureIndex];
  const measureWidth = layout.measureWidths[measureIndex];
  const fraction = Math.max(0, Math.min(1, (svgX - measureX) / measureWidth));
  const measureStart =
    measureStartBeats[measureIndex] ?? measureIndex * beatsPerMeasure;
  const measureEnd =
    measureStartBeats[measureIndex + 1] ?? measureStart + beatsPerMeasure;

  const beat = measureStart + fraction * (measureEnd - measureStart);
  const snapped = Math.round(beat / SNAP_BEATS) * SNAP_BEATS;
  // Keep the onset strictly inside the clicked measure (a click at the far edge
  // would otherwise round up onto the next measure's downbeat).
  return Math.max(measureStart, Math.min(snapped, measureEnd - SNAP_BEATS));
}

// Split an absolute beat into its measure index + onset within that measure.
export function locateBeat(
  beat: number,
  measureStartBeats: number[],
): { measureIndex: number; onsetBeatInMeasure: number } {
  let measureIndex = 0;
  for (let i = 0; i < measureStartBeats.length; i++) {
    if (measureStartBeats[i] <= beat + 1e-9) {
      measureIndex = i;
    }
  }
  return {
    measureIndex,
    onsetBeatInMeasure: beat - measureStartBeats[measureIndex],
  };
}

// Invert `noteY` (a linear diatonic-step map) to turn an SVG y into a pitch,
// snapping to the nearest half staff-space (natural staff-line/space position).
// `alter` is 0 in step 1 (no key-signature or accidental inference yet).
export function pitchFromY(
  svgY: number,
  staffBottomY: number,
  staffSpace: number,
  clef: { sign: "G" | "F" },
): Pitch {
  const bottomRef = clef.sign === "G" ? TREBLE_BOTTOM : BASS_BOTTOM;
  const stepsFromBottom = Math.round((staffBottomY - svgY) / (staffSpace / 2));
  const diatonic = stepsFromBottom + bottomRef;
  const octave = Math.floor(diatonic / 7);
  const stepIndex = ((diatonic % 7) + 7) % 7;
  return { step: STEPS[stepIndex], alter: 0, octave };
}

// One pickable parsed note, with everything needed to select it and to edit it.
interface PickableNote {
  id: string;
  beat: number;
  pitch: Pitch;
  handle: NoteHandle;
}

// Enumerate every parsed note with its absolute beat, renderer id, and source
// handle. Notes without `source` provenance (e.g. multi-staff reductions) are
// skipped — the editor's scope is the single-staff path that populates it.
function pickableNotes(score: ParsedScore): PickableNote[] {
  const measureStartBeats = computeMeasureStartBeats(score);
  const result: PickableNote[] = [];
  score.parts.forEach((part, partIndex) => {
    part.measures.forEach((measure, measureIndex) => {
      let beatCursor = measureStartBeats[measureIndex] ?? 0;
      const divisions = measure.divisions || 4;
      for (const event of measure.events) {
        if (isRest(event)) {
          beatCursor += event.duration / divisions;
          continue;
        }
        const group = event as ChordGroup;
        group.notes.forEach((note, voiceIndex) => {
          if (!note.source) {
            return;
          }
          result.push({
            id: `p${partIndex}-m${measure.number}-n${group.noteIndex}-v${voiceIndex}`,
            beat: beatCursor,
            pitch: note.pitch,
            handle: note.source,
          });
        });
        beatCursor += group.duration / divisions;
      }
    });
  });
  return result;
}

// Find the parsed note nearest a clicked (beat, pitch), within a small
// tolerance. Returns its renderer id (for the selection highlight) and source
// handle (for dom-edit), or null when nothing is close enough.
export function pickNote(
  score: ParsedScore,
  beat: number,
  pitch: Pitch,
): { id: string; handle: NoteHandle } | null {
  const targetDiatonic = diatonicIndex(pitch);
  // Tolerances: within ~a quarter note horizontally, ~a third vertically.
  const beatTolerance = 0.75;
  const pitchTolerance = 3;
  let best: PickableNote | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of pickableNotes(score)) {
    const beatDistance = Math.abs(candidate.beat - beat);
    const pitchDistance = Math.abs(
      diatonicIndex(candidate.pitch) - targetDiatonic,
    );
    if (beatDistance > beatTolerance || pitchDistance > pitchTolerance) {
      continue;
    }
    // Weight beats more heavily so two stacked pitches at the same onset resolve
    // by which is vertically closer, but distinct onsets win first.
    const score_ = beatDistance * 4 + pitchDistance;
    if (score_ < bestScore) {
      bestScore = score_;
      best = candidate;
    }
  }
  return best ? { id: best.id, handle: best.handle } : null;
}

// The renderer id + handle for a known note handle, used to keep a selection
// highlight attached to a note across edits. Returns null if the handle no
// longer resolves (e.g. the note was removed).
export function idForHandle(
  score: ParsedScore,
  handle: NoteHandle,
): string | null {
  for (const note of pickableNotes(score)) {
    if (
      note.handle.measureIndex === handle.measureIndex &&
      note.handle.noteElementIndex === handle.noteElementIndex
    ) {
      return note.id;
    }
  }
  return null;
}
