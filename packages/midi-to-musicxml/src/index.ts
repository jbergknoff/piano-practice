// Public surface of the MIDI→MusicXML conversion package: turn a parsed MIDI
// file into a MusicXML string plus the derived playback ScoreConversion.
export {
  getMidiTempo,
  getMidiTracks,
  midiToMusicXmlWithTracks,
} from "./midi-to-musicxml";
export type {
  PlaybackNote,
  ScoreConversion,
  TrackInfo,
} from "./midi-to-musicxml";
