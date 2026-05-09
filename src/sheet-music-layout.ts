import { diatonicIndex } from "./musicxml-parser";
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
import { isRest } from "./musicxml-parser";

// MusicXML divisions per quarter note (matches the generator constant)
const DIVISIONS = 4;

export function resolveLayout(
  score: ParsedScore,
  config: LayoutConfig = {},
): ResolvedLayout {
  const sls = config.staffLineSpacing ?? 10;
  const noteUnitWidth = config.noteUnitWidth ?? 28;
  const partGap = config.partGap ?? 40;
  const canvasPadding = config.canvasPadding ?? 20;
  const ledgerMargin = config.ledgerMargin ?? 35;

  const firstPart = score.parts[0];
  const firstKeySig = firstPart?.keySig ?? { fifths: 0 };

  // Compute width of each measure (shared across all parts)
  const measureWidths = firstPart?.measures.map((m, i) =>
    measureWidth(m, i === 0, firstKeySig.fifths, sls, noteUnitWidth),
  ) ?? [];

  // Accumulate measure X positions
  const measureXs: number[] = [];
  let x = 0;
  for (const w of measureWidths) {
    measureXs.push(x);
    x += w;
  }

  const totalWidth = x;
  const staffStride = 4 * sls + partGap;

  const staffBottomYs = score.parts.map(
    (_, p) =>
      canvasPadding + ledgerMargin + p * staffStride + 4 * sls,
  );

  const totalHeight =
    canvasPadding +
    ledgerMargin +
    score.parts.length * staffStride -
    partGap +
    ledgerMargin +
    canvasPadding;

  return {
    sls,
    noteUnitWidth,
    measureXs,
    measureWidths,
    staffBottomYs,
    totalWidth,
    totalHeight,
  };
}

function measureWidth(
  measure: ParsedMeasure,
  isFirst: boolean,
  fifths: number,
  sls: number,
  noteUnitWidth: number,
): number {
  const clefWidth = 32;
  const keySigWidth = Math.abs(fifths) * 10;
  const timeSigWidth = 20;
  const headerWidth = isFirst ? clefWidth + keySigWidth + timeSigWidth + 8 : 0;
  const totalDivisions = measureTotalDivisions(measure);
  return (
    headerWidth +
    8 + // MEASURE_PADDING_LEFT
    (totalDivisions / DIVISIONS) * noteUnitWidth +
    4 // MEASURE_PADDING_RIGHT
  );
}

function measureTotalDivisions(measure: ParsedMeasure): number {
  let total = 0;
  for (const event of measure.events) {
    total += isRest(event) ? event.duration : (event as ChordGroup).duration;
  }
  return total;
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
const BASS_BOTTOM = diatonicIndex({ step: "G", alter: 0, octave: 2 });   // G2

// Middle line of each clef
const TREBLE_MIDDLE = diatonicIndex({ step: "B", alter: 0, octave: 4 }); // B4
const BASS_MIDDLE = diatonicIndex({ step: "D", alter: 0, octave: 3 });   // D3

export function noteY(
  pitch: Pitch,
  clef: { sign: "G" | "F" },
  staffBottomY: number,
  sls: number,
): number {
  const bottomRef = clef.sign === "G" ? TREBLE_BOTTOM : BASS_BOTTOM;
  const stepsFromBottom = diatonicIndex(pitch) - bottomRef;
  return staffBottomY - stepsFromBottom * (sls / 2);
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
  sls: number,
): number[] {
  const bottomRef = clef.sign === "G" ? TREBLE_BOTTOM : BASS_BOTTOM;
  const stepsFromBottom = diatonicIndex(pitch) - bottomRef;
  const ys: number[] = [];
  if (stepsFromBottom < 0) {
    // Lines below the staff: at steps -2, -4, …
    for (let s = -2; s >= stepsFromBottom; s -= 2) {
      ys.push(staffBottomY - s * (sls / 2));
    }
  } else if (stepsFromBottom > 8) {
    // Lines above the staff: at steps 10, 12, …
    for (let s = 10; s <= stepsFromBottom; s += 2) {
      ys.push(staffBottomY - s * (sls / 2));
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
): number[] {
  const hdrWidth = isFirstMeasure ? headerWidth(fifths) : 0;
  const PADDING_LEFT = 8;
  const xs: number[] = [];
  let offset = 0;
  for (const event of events) {
    xs.push(measureX + hdrWidth + PADDING_LEFT + (offset / DIVISIONS) * noteUnitWidth);
    const dur = isRest(event) ? event.duration : (event as ChordGroup).duration;
    offset += dur;
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
