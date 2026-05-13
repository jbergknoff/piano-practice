import { diatonicIndex } from "./musicxml-parser";
import { isRest } from "./musicxml-parser";
import type {
  ChordGroup,
  LayoutConfig,
  MeasureEvent,
  ParsedMeasure,
  ParsedPart,
  ParsedScore,
  Pitch,
  ResolvedLayout,
} from "./sheet-music-types";

// MusicXML divisions per quarter note (matches the generator constant)
export const DIVISIONS = 4;

// Minimum horizontal advance per event regardless of duration, so that
// dense 16th-note runs don't collapse noteheads into each other.
export const MIN_EVENT_ADVANCE = 18;

export const MEASURE_PADDING_LEFT = 14;
export const MEASURE_PADDING_RIGHT = 4;

export function resolveLayout(
  score: ParsedScore,
  config: LayoutConfig = {},
): ResolvedLayout {
  const staffSpace = config.staffLineSpacing ?? 10;
  const noteUnitWidth = config.noteUnitWidth ?? 48;
  const partGap = config.partGap ?? 40;
  const canvasPadding = config.canvasPadding ?? 20;
  const ledgerMargin = config.ledgerMargin ?? 35;

  const firstPart = score.parts[0];
  const firstKeySig = firstPart?.keySig ?? { fifths: 0 };

  // Compute width of each measure (shared across all parts)
  const measureWidths =
    firstPart?.measures.map((m, i) =>
      measureWidth(m, i === 0, firstKeySig.fifths, staffSpace, noteUnitWidth),
    ) ?? [];

  // Accumulate measure X positions
  const measureXs: number[] = [];
  let x = 0;
  for (const w of measureWidths) {
    measureXs.push(x);
    x += w;
  }

  const totalWidth = x;
  const staffStride = 4 * staffSpace + partGap;

  const staffBottomYs = score.parts.map(
    (_, p) => canvasPadding + ledgerMargin + p * staffStride + 4 * staffSpace,
  );

  const totalHeight =
    canvasPadding +
    ledgerMargin +
    score.parts.length * staffStride -
    partGap +
    ledgerMargin +
    canvasPadding;

  return {
    staffSpace,
    noteUnitWidth,
    measureXs,
    measureWidths,
    staffBottomYs,
    totalWidth,
    totalHeight,
  };
}

function firstEventHasAccidental(events: MeasureEvent[]): boolean {
  if (events.length === 0 || isRest(events[0])) {
    return false;
  }
  return (events[0] as ChordGroup).notes.some((n) => n.showAccidental);
}

function measureLeftPad(
  events: MeasureEvent[],
  isFirst: boolean,
  staffSpace: number,
): number {
  if (!isFirst && firstEventHasAccidental(events)) {
    return staffSpace * 2;
  }
  return MEASURE_PADDING_LEFT;
}

function measureWidth(
  measure: ParsedMeasure,
  isFirst: boolean,
  fifths: number,
  staffSpace: number,
  noteUnitWidth: number,
): number {
  const hdrW = isFirst ? headerWidth(fifths) : 0;
  let contentW = 0;
  for (const event of measure.events) {
    const dur = isRest(event) ? event.duration : (event as ChordGroup).duration;
    contentW += Math.max((dur / DIVISIONS) * noteUnitWidth, MIN_EVENT_ADVANCE);
  }
  return (
    hdrW +
    measureLeftPad(measure.events, isFirst, staffSpace) +
    contentW +
    MEASURE_PADDING_RIGHT
  );
}

export function headerWidth(fifths: number): number {
  const clefWidth = 32;
  const keySigWidth = Math.abs(fifths) * 10;
  const timeSigWidth = 20;
  return clefWidth + keySigWidth + timeSigWidth + 8;
}

// ── Pitch / position helpers ──────────────────────────────────────────────────

// Line 1 (bottom) of each clef, as a diatonic index
const TREBLE_BOTTOM = diatonicIndex({ step: "E", alter: 0, octave: 4 }); // E4
const BASS_BOTTOM = diatonicIndex({ step: "G", alter: 0, octave: 2 }); // G2

// Middle line of each clef
const TREBLE_MIDDLE = diatonicIndex({ step: "B", alter: 0, octave: 4 }); // B4
const BASS_MIDDLE = diatonicIndex({ step: "D", alter: 0, octave: 3 }); // D3

export function noteY(
  pitch: Pitch,
  clef: { sign: "G" | "F" },
  staffBottomY: number,
  staffSpace: number,
): number {
  const bottomRef = clef.sign === "G" ? TREBLE_BOTTOM : BASS_BOTTOM;
  const stepsFromBottom = diatonicIndex(pitch) - bottomRef;
  return staffBottomY - stepsFromBottom * (staffSpace / 2);
}

export function stemDirection(
  group: ChordGroup,
  clef: { sign: "G" | "F" },
): "up" | "down" {
  const middleRef = clef.sign === "G" ? TREBLE_MIDDLE : BASS_MIDDLE;
  let farthestSteps = 0;
  for (const note of group.notes) {
    const steps = diatonicIndex(note.pitch) - middleRef;
    if (Math.abs(steps) > Math.abs(farthestSteps)) {
      farthestSteps = steps;
    }
  }
  return farthestSteps <= 0 ? "up" : "down";
}

export function ledgerLineYs(
  pitch: Pitch,
  clef: { sign: "G" | "F" },
  staffBottomY: number,
  staffSpace: number,
): number[] {
  const bottomRef = clef.sign === "G" ? TREBLE_BOTTOM : BASS_BOTTOM;
  const stepsFromBottom = diatonicIndex(pitch) - bottomRef;
  const ys: number[] = [];
  if (stepsFromBottom < 0) {
    // Lines below the staff: at steps -2, -4, …
    for (let s = -2; s >= stepsFromBottom; s -= 2) {
      ys.push(staffBottomY - s * (staffSpace / 2));
    }
  } else if (stepsFromBottom > 8) {
    // Lines above the staff: at steps 10, 12, …
    for (let s = 10; s <= stepsFromBottom; s += 2) {
      ys.push(staffBottomY - s * (staffSpace / 2));
    }
  }
  return ys;
}

// ── Horizontal layout within a measure ───────────────────────────────────────

export function eventXPositions(
  events: MeasureEvent[],
  measureX: number,
  isFirstMeasure: boolean,
  fifths: number,
  noteUnitWidth: number,
  staffSpace: number,
): number[] {
  const hdrW = isFirstMeasure ? headerWidth(fifths) : 0;
  const xs: number[] = [];
  let x = measureX + hdrW + measureLeftPad(events, isFirstMeasure, staffSpace);
  for (const event of events) {
    xs.push(x);
    const dur = isRest(event) ? event.duration : (event as ChordGroup).duration;
    x += Math.max((dur / DIVISIONS) * noteUnitWidth, MIN_EVENT_ADVANCE);
  }
  return xs;
}

// Sharps order by clef for key signature rendering
export const SHARP_POSITIONS: Record<"G" | "F", Pitch[]> = {
  G: [
    { step: "F", alter: 1, octave: 5 },
    { step: "C", alter: 1, octave: 5 },
    { step: "G", alter: 1, octave: 5 },
    { step: "D", alter: 1, octave: 5 },
    { step: "A", alter: 1, octave: 4 },
    { step: "E", alter: 1, octave: 5 },
    { step: "B", alter: 1, octave: 4 },
  ],
  F: [
    { step: "F", alter: 1, octave: 3 },
    { step: "C", alter: 1, octave: 3 },
    { step: "G", alter: 1, octave: 3 },
    { step: "D", alter: 1, octave: 3 },
    { step: "A", alter: 1, octave: 2 },
    { step: "E", alter: 1, octave: 3 },
    { step: "B", alter: 1, octave: 2 },
  ],
};

export const FLAT_POSITIONS: Record<"G" | "F", Pitch[]> = {
  G: [
    { step: "B", alter: 0, octave: 4 },
    { step: "E", alter: 0, octave: 5 },
    { step: "A", alter: 0, octave: 4 },
    { step: "D", alter: 0, octave: 5 },
    { step: "G", alter: 0, octave: 4 },
    { step: "C", alter: 0, octave: 5 },
    { step: "F", alter: 0, octave: 4 },
  ],
  F: [
    { step: "B", alter: 0, octave: 2 },
    { step: "E", alter: 0, octave: 3 },
    { step: "A", alter: 0, octave: 2 },
    { step: "D", alter: 0, octave: 3 },
    { step: "G", alter: 0, octave: 2 },
    { step: "C", alter: 0, octave: 3 },
    { step: "F", alter: 0, octave: 2 },
  ],
};

export function partClef(part: ParsedPart): { sign: "G" | "F"; line: number } {
  return part.clef;
}

// ── Beaming helpers ───────────────────────────────────────────────────────────

/**
 * Identify which events in a measure should be beamed together.
 * Returns arrays of event indices; each inner array is one beam group (2+
 * consecutive beamable events with no intervening rests or non-beamable notes).
 * A single isolated eighth/16th keeps its flag and is not returned here.
 */
export function groupBeamableEvents(events: MeasureEvent[]): number[][] {
  const groups: number[][] = [];
  let i = 0;
  while (i < events.length) {
    const ev = events[i];
    if (
      !isRest(ev) &&
      ((ev as ChordGroup).type === "eighth" ||
        (ev as ChordGroup).type === "16th")
    ) {
      const runStart = i;
      while (
        i < events.length &&
        !isRest(events[i]) &&
        ((events[i] as ChordGroup).type === "eighth" ||
          (events[i] as ChordGroup).type === "16th")
      ) {
        i++;
      }
      if (i - runStart >= 2) {
        groups.push(
          Array.from({ length: i - runStart }, (_, j) => runStart + j),
        );
      }
    } else {
      i++;
    }
  }
  return groups;
}

/**
 * Determine a unified stem direction for a beam group by finding the note
 * farthest from the clef's middle line across all chords in the group.
 */
export function beamStemDirection(
  groups: ChordGroup[],
  clef: { sign: "G" | "F" },
): "up" | "down" {
  const middleRef = clef.sign === "G" ? TREBLE_MIDDLE : BASS_MIDDLE;
  let farthestSteps = 0;
  for (const group of groups) {
    for (const note of group.notes) {
      const steps = diatonicIndex(note.pitch) - middleRef;
      if (Math.abs(steps) > Math.abs(farthestSteps)) {
        farthestSteps = steps;
      }
    }
  }
  return farthestSteps <= 0 ? "up" : "down";
}
