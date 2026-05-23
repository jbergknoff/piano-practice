import { diatonicIndex } from "./musicxml-parser";
import { isRest } from "./musicxml-parser";
import type {
  ChordGroup,
  LayoutConfig,
  MeasureEvent,
  ParsedMeasure,
  ParsedNote,
  ParsedPart,
  ParsedScore,
  Pitch,
  ResolvedLayout,
} from "./sheet-music-types";

// MusicXML divisions per quarter note (matches the generator constant)
export const DIVISIONS = 4;

// Accidental glyphs sit left of the noteheads. Column 0 is this far from the
// notehead center; each additional column (for chords whose accidentals would
// collide) steps a further COLUMN_WIDTH to the left. Both factors are × the
// staff space and are shared with the renderer so padding and glyph placement
// stay in sync.
export const ACCIDENTAL_BASE_OFFSET_FACTOR = 1.4;
export const ACCIDENTAL_COLUMN_WIDTH_FACTOR = 1.1;

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

  // Compute width of each measure (shared across all parts). All parts share
  // the same key signature and key changes, so the first part's widths apply.
  const measureWidths =
    firstPart?.measures.map((m, i) =>
      measureWidth(m, i === 0, staffSpace, noteUnitWidth),
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

/**
 * Assign each note in a chord the column its accidental glyph occupies, left of
 * the noteheads: 0 is nearest, higher numbers step further left. Notes without
 * an accidental get -1. Working from the top pitch down, an accidental reuses
 * the nearest column whose previous glyph clears it vertically (~a seventh),
 * otherwise it starts a new column. Uses diatonic position only, so it is
 * independent of clef and absolute layout — letting the layout estimate padding
 * and the renderer place glyphs from the same rule.
 */
export function accidentalColumns(
  notes: ParsedNote[],
  staffSpace: number,
): number[] {
  const cols = notes.map(() => -1);
  const minGap = staffSpace * 3; // vertical clearance to share a column
  const halfStep = staffSpace / 2; // one diatonic step
  const order = notes
    .map((_, i) => i)
    .filter((i) => notes[i].accidental !== "none")
    .sort(
      (a, b) => diatonicIndex(notes[b].pitch) - diatonicIndex(notes[a].pitch),
    );

  const lastByCol: number[] = []; // diatonic index of the last glyph in each col
  for (const i of order) {
    const di = diatonicIndex(notes[i].pitch);
    let col = 0;
    while (
      col < lastByCol.length &&
      (lastByCol[col] - di) * halfStep < minGap
    ) {
      col++;
    }
    cols[i] = col;
    lastByCol[col] = di;
  }
  return cols;
}

// Highest accidental column the measure's first event needs (-1 if none).
function firstEventMaxAccidentalColumn(
  events: MeasureEvent[],
  staffSpace: number,
): number {
  if (events.length === 0 || isRest(events[0])) {
    return -1;
  }
  return accidentalColumns((events[0] as ChordGroup).notes, staffSpace).reduce(
    (max, c) => Math.max(max, c),
    -1,
  );
}

function measureLeftPad(
  events: MeasureEvent[],
  isFirst: boolean,
  staffSpace: number,
): number {
  if (isFirst) {
    return MEASURE_PADDING_LEFT;
  }
  const maxCol = firstEventMaxAccidentalColumn(events, staffSpace);
  if (maxCol < 0) {
    return MEASURE_PADDING_LEFT;
  }
  // staffSpace*2 keeps a single accidental clear of the barline; each extra
  // column shifts the noteheads further right by its own width plus a little
  // breathing room, so the further-left accidentals also sit clear of the
  // barline with some margin.
  const colWidth = staffSpace * ACCIDENTAL_COLUMN_WIDTH_FACTOR;
  return staffSpace * 2 + maxCol * (colWidth + staffSpace * 0.5);
}

function measureWidth(
  measure: ParsedMeasure,
  isFirst: boolean,
  staffSpace: number,
  noteUnitWidth: number,
): number {
  const hdrW = isFirst ? headerWidth(measure.activeFifths) : 0;
  const keyChangeW =
    !isFirst && measure.keyChange
      ? keyChangeWidth(measure.keyChange, staffSpace)
      : 0;
  let contentW = 0;
  for (const event of measure.events) {
    const dur = isRest(event) ? event.duration : (event as ChordGroup).duration;
    contentW += Math.max((dur / DIVISIONS) * noteUnitWidth, MIN_EVENT_ADVANCE);
  }
  return (
    hdrW +
    keyChangeW +
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

// ── Mid-staff key changes ─────────────────────────────────────────────────────

// Lead and trailing gaps (× staffSpace) bracketing the key-change glyphs so they
// clear the barline on the left and the noteheads on the right.
export const KEY_CHANGE_LEAD_FACTOR = 0.8;
const KEY_CHANGE_TRAIL_FACTOR = 0.8;
// Horizontal step between successive key-signature glyphs (× staffSpace). Shared
// with the renderer so width estimation and glyph placement stay in sync.
export const KEY_CHANGE_GLYPH_SPACING_FACTOR = 1.1;

const ACCIDENTAL_GLYPH_PITCHES = (fifths: number, sign: "G" | "F"): Pitch[] => {
  if (fifths > 0) {
    return SHARP_POSITIONS[sign].slice(0, fifths);
  }
  if (fifths < 0) {
    return FLAT_POSITIONS[sign].slice(0, -fifths);
  }
  return [];
};

/**
 * Resolve the glyphs drawn for a mid-staff key change: naturals that cancel the
 * outgoing accidentals no longer in the new key, followed by the new key's
 * accidentals. Pitches give staff positions (their alter is ignored for the
 * naturals — a natural sits on the same line as the sharp/flat it cancels).
 */
export function keyChangeGlyphs(
  keyChange: { fifths: number; prevFifths: number },
  sign: "G" | "F",
): { naturals: Pitch[]; accidentals: Pitch[] } {
  const { fifths, prevFifths } = keyChange;
  const prev = ACCIDENTAL_GLYPH_PITCHES(prevFifths, sign);
  const accidentals = ACCIDENTAL_GLYPH_PITCHES(fifths, sign);
  const sameSign =
    prevFifths !== 0 &&
    fifths !== 0 &&
    Math.sign(prevFifths) === Math.sign(fifths);
  let naturals: Pitch[];
  if (sameSign && Math.abs(fifths) >= Math.abs(prevFifths)) {
    // Adding more accidentals of the same kind — nothing to cancel.
    naturals = [];
  } else if (sameSign) {
    // Fewer accidentals of the same kind — cancel the trailing ones.
    naturals = prev.slice(Math.abs(fifths));
  } else {
    // Sign flip or a return to C/A — cancel all the previous accidentals.
    naturals = prev;
  }
  return { naturals, accidentals };
}

export function keyChangeWidth(
  keyChange: { fifths: number; prevFifths: number },
  staffSpace: number,
): number {
  // Glyph count is clef-independent, so either sign yields the same width.
  const { naturals, accidentals } = keyChangeGlyphs(keyChange, "G");
  const glyphs = naturals.length + accidentals.length;
  if (glyphs === 0) {
    return 0;
  }
  return (
    (KEY_CHANGE_LEAD_FACTOR + KEY_CHANGE_TRAIL_FACTOR) * staffSpace +
    glyphs * (staffSpace * KEY_CHANGE_GLYPH_SPACING_FACTOR)
  );
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
  keyChange?: { fifths: number; prevFifths: number },
): number[] {
  const hdrW = isFirstMeasure ? headerWidth(fifths) : 0;
  const keyChangeW =
    !isFirstMeasure && keyChange ? keyChangeWidth(keyChange, staffSpace) : 0;
  const xs: number[] = [];
  let x =
    measureX +
    hdrW +
    keyChangeW +
    measureLeftPad(events, isFirstMeasure, staffSpace);
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
 *
 * When `beatDivisions` is given, beams are also broken at beat boundaries so a
 * long run is split into per-beat sub-beams (the conventional engraving) rather
 * than one beam spanning the whole measure. Omit it to disable beat breaking.
 */
export function groupBeamableEvents(
  events: MeasureEvent[],
  beatDivisions?: number,
): number[][] {
  // Onset position (in divisions) of each event within the measure.
  const starts: number[] = [];
  let pos = 0;
  for (const ev of events) {
    starts.push(pos);
    pos += isRest(ev) ? ev.duration : (ev as ChordGroup).duration;
  }

  const isBeamable = (ev: MeasureEvent): boolean =>
    !isRest(ev) &&
    ((ev as ChordGroup).type === "eighth" ||
      (ev as ChordGroup).type === "16th");

  const sameBeat = (a: number, b: number): boolean =>
    beatDivisions === undefined ||
    Math.floor(starts[a] / beatDivisions) ===
      Math.floor(starts[b] / beatDivisions);

  const groups: number[][] = [];
  let i = 0;
  while (i < events.length) {
    if (!isBeamable(events[i])) {
      i++;
      continue;
    }
    const runStart = i;
    i++;
    while (i < events.length && isBeamable(events[i]) && sameBeat(i - 1, i)) {
      i++;
    }
    if (i - runStart >= 2) {
      groups.push(Array.from({ length: i - runStart }, (_, j) => runStart + j));
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
