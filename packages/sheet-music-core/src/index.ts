// Public surface of the shared MusicXML domain: parsing a MusicXML string into
// a structured score, and deriving playback timing/notes from it. Used by both
// the MIDI→MusicXML conversion package and the sheet-music display package.
export { diatonicIndex, isRest, parseScore } from "./musicxml-parser";
export {
  DEFAULT_VELOCITY,
  GRACE_NOTE_BEATS,
  computeMeasureStartBeats,
  getMusicXmlTempo,
  musicXmlToConversion,
  pitchToMidiNumber,
} from "./musicxml-playback";
export type {
  PlaybackNote,
  RepeatSection,
  ScoreConversion,
} from "./musicxml-playback";
export { extractMusicXmlFromMxl } from "./mxl";
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
