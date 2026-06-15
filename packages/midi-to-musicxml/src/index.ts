// Public surface of the MIDI→MusicXML conversion package: turn a parsed MIDI
// file into a MusicXML string (the app derives playback data from it).
export {
  getMidiTempo,
  getMidiTracks,
  midiToMusicXmlWithTracks,
} from "./midi-to-musicxml";
export type { TrackInfo } from "./midi-to-musicxml";
