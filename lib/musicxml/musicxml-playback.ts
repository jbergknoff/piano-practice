import { isRest, parseScore } from "./musicxml-parser";
import type { Pitch } from "./sheet-music-types";

// Standard MusicXML carries no per-note dynamics, so playback uses a single
// default velocity for every note.
export const DEFAULT_VELOCITY = 80;

// A staccato note sounds for this fraction of its notated length.
export const STACCATO_PLAYBACK_RATIO = 0.5;

// Grace notes take no rhythmic space in the score; give them a short nominal
// sounding length so they're audible without displacing the main note.
export const GRACE_NOTE_BEATS = 0.1;

export interface PlaybackNote {
  noteNumber: number;
  startBeat: number; // quarter-note beats from start
  durationBeats: number;
  velocity: number;
  tieStop: boolean;
  partIndex: number;
  measureNumber: number;
  noteIndex: number; // chord index within measure (matches display noteIndex)
  voiceIndex: number; // note index within chord (0 = lowest pitch)
  /** True when this note is a grace note (appoggiatura or acciaccatura). */
  isGrace?: boolean;
}

export interface ScoreConversion {
  musicxml: string;
  notes: PlaybackNote[];
  timeSigNum: number;
  timeSigDen: number;
  totalBeats: number;
}

const STEP_SEMITONE: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

export function pitchToMidiNumber(pitch: Pitch): number {
  return (pitch.octave + 1) * 12 + STEP_SEMITONE[pitch.step] + pitch.alter;
}

// Read the first <sound tempo="..."> in the score; default to 120 BPM.
export function getMusicXmlTempo(xml: string): number {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const tempo = doc.querySelector("sound[tempo]")?.getAttribute("tempo");
  const bpm = tempo ? Number.parseFloat(tempo) : Number.NaN;
  return Number.isFinite(bpm) && bpm > 0 ? Math.round(bpm) : 120;
}

/**
 * Derive playback data (notes, timing, totals) from a MusicXML string. This is
 * the single source of playback metadata for both MIDI-converted and directly
 * loaded scores: the IDs built here
 * (`p{partIndex}-m{measureNumber}-n{noteIndex}-v{voiceIndex}`) match the IDs the
 * renderer assigns from the same parsed score, so highlighting stays in sync.
 */
export function musicXmlToConversion(xml: string): ScoreConversion {
  const score = parseScore(xml);
  const notes: PlaybackNote[] = [];

  score.parts.forEach((part, partIndex) => {
    let beatCursor = 0;
    for (const measure of part.measures) {
      const divisions = measure.divisions || 4;
      for (const event of measure.events) {
        if (isRest(event)) {
          beatCursor += event.duration / divisions;
          continue;
        }

        const gracesBefore = event.gracesBefore ?? [];
        gracesBefore.forEach((graceGroup, groupIndex) => {
          // Grace notes are played slightly before the main note. When there
          // are multiple grace groups, each group is staggered so the earliest
          // one starts furthest before the main beat. All offsets are clamped
          // to zero so no note gets a negative start time.
          const graceOffset =
            (gracesBefore.length - groupIndex) * GRACE_NOTE_BEATS;
          const graceStartBeat = Math.max(0, beatCursor - graceOffset);
          graceGroup.notes.forEach((note, voiceIndex) => {
            notes.push({
              noteNumber: pitchToMidiNumber(note.pitch),
              startBeat: graceStartBeat,
              durationBeats: GRACE_NOTE_BEATS,
              velocity: DEFAULT_VELOCITY,
              tieStop: false,
              partIndex,
              measureNumber: measure.number,
              noteIndex: graceGroup.noteIndex,
              voiceIndex,
              isGrace: true,
            });
          });
        });

        // `event.duration` is the display duration (space to next onset in this
        // part); it drives beatCursor so subsequent notes start at the right beat.
        // `event.playbackDuration`, when present, is the actual sounding length
        // (set by the MIDI-to-MusicXML converter via <play-duration>); use it for
        // durationBeats so highlight timing reflects the true note length rather
        // than the potentially larger slot size.
        const displayBeats = event.duration / divisions;
        const playBeats =
          event.playbackDuration != null
            ? event.playbackDuration / divisions
            : null;
        // In MusicXML, articulations like staccato are placed on the primary
        // note of a chord; chord members (<chord/>) don't repeat the notation.
        // Use chord-level staccato so all notes in the group expire together.
        const chordStaccato = event.notes.some((n) => n.staccato);
        event.notes.forEach((note, voiceIndex) => {
          const durationBeats =
            playBeats != null
              ? playBeats
              : chordStaccato
                ? displayBeats * STACCATO_PLAYBACK_RATIO
                : displayBeats;
          notes.push({
            noteNumber: pitchToMidiNumber(note.pitch),
            startBeat: beatCursor,
            durationBeats,
            velocity: DEFAULT_VELOCITY,
            tieStop: note.tieStop,
            partIndex,
            measureNumber: measure.number,
            noteIndex: event.noteIndex,
            voiceIndex,
          });
        });
        beatCursor += displayBeats;
      }
    }
  });

  const timeSig = score.parts[0]?.timeSig ?? { beats: 4, beatType: 4 };
  const totalBeats = (score.numMeasures * timeSig.beats * 4) / timeSig.beatType;

  return {
    musicxml: xml,
    notes,
    timeSigNum: timeSig.beats,
    timeSigDen: timeSig.beatType,
    totalBeats,
  };
}
