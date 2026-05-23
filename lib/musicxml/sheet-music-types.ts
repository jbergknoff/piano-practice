export interface Pitch {
  step: "C" | "D" | "E" | "F" | "G" | "A" | "B";
  alter: 0 | 1;
  octave: number;
}

export type NoteType = "whole" | "half" | "quarter" | "eighth" | "16th";

// Which accidental glyph (if any) to draw before the notehead. Computed per
// measure from the running accidental state, not just the pitch's alter:
// a sharp is only drawn the first time it appears, and a natural is drawn to
// cancel a sharp earlier in the same measure.
export type AccidentalKind = "none" | "sharp" | "flat" | "natural";

export interface ParsedNote {
  kind: "note";
  pitch: Pitch;
  duration: number;
  type: NoteType;
  dot: boolean;
  tieStart: boolean;
  tieStop: boolean;
  isChordMember: boolean;
  accidental: AccidentalKind;
  staccato: boolean;
}

export interface ParsedRest {
  kind: "rest";
  duration: number;
  type: NoteType;
  dot: boolean;
  fullMeasure: boolean;
}

export interface ChordGroup {
  notes: ParsedNote[];
  duration: number;
  type: NoteType;
  dot: boolean;
  noteIndex: number;
}

export type MeasureEvent = ChordGroup | ParsedRest;

export interface ParsedMeasure {
  number: number;
  events: MeasureEvent[];
  timeSig?: { beats: number; beatType: number };
  keySig?: { fifths: number; mode: string };
  clef?: { sign: "G" | "F"; line: number };
}

export interface ParsedPart {
  id: string;
  measures: ParsedMeasure[];
  clef: { sign: "G" | "F"; line: number };
  timeSig: { beats: number; beatType: number };
  keySig: { fifths: number; mode: string };
}

export interface ParsedScore {
  parts: ParsedPart[];
  numMeasures: number;
}

export interface LayoutConfig {
  staffLineSpacing?: number;
  noteUnitWidth?: number;
  partGap?: number;
  canvasPadding?: number;
  ledgerMargin?: number;
}

export interface ResolvedLayout {
  staffSpace: number;
  noteUnitWidth: number;
  measureXs: number[];
  measureWidths: number[];
  staffBottomYs: number[];
  totalWidth: number;
  totalHeight: number;
}
