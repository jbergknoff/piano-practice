// Public surface of the MusicXML display package: parsing a MusicXML string
// into a structured score, the Preact renderer, the beat→x cursor helper, the
// layout primitives, and the highlight entry types.
export type {
  MarkerHighlight,
  NoteHighlight,
  ScoreHighlight,
} from "./highlights";
export { computeMeasureStartBeats } from "./measure-beats";
export { diatonicIndex, isRest, parseScore } from "./musicxml-parser";
export type {
  AccidentalKind,
  ChordGroup,
  GraceGroup,
  LayoutConfig,
  MeasureEvent,
  MeasureSpine,
  NoteType,
  ParsedMeasure,
  ParsedNote,
  ParsedPart,
  ParsedRest,
  ParsedScore,
  Pitch,
  ResolvedLayout,
} from "./sheet-music-types";
export {
  ACCIDENTAL_BASE_OFFSET_FACTOR,
  ACCIDENTAL_COLUMN_WIDTH_FACTOR,
  BASS_BOTTOM,
  DIVISIONS,
  FLAT_POSITIONS,
  GRACE_NOTE_ADVANCE,
  KEY_CHANGE_GLYPH_SPACING_FACTOR,
  KEY_CHANGE_LEAD_FACTOR,
  MEASURE_PADDING_LEFT,
  MEASURE_PADDING_RIGHT,
  MIN_EVENT_ADVANCE,
  SHARP_POSITIONS,
  TREBLE_BOTTOM,
  accidentalColumns,
  beamStemDirection,
  buildMeasureSpine,
  eventXsFromSpine,
  groupBeamableEvents,
  headerWidth,
  keyChangeGlyphs,
  keyChangeWidth,
  ledgerLineYs,
  noteY,
  partClef,
  resolveLayout,
  stemDirection,
} from "./sheet-music-layout";
export type { StagePointerInfo } from "./SheetMusicDisplay";
export { SheetMusicDisplay, computeCursorX } from "./SheetMusicDisplay";
