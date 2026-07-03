import {
  type Pitch,
  computeMeasureStartBeats,
  isRest,
  parseScore,
} from "@jbergknoff/sheet-music-display";
import {
  type RepeatSection,
  expandRepeatsMusicXml,
  extractRepeatSections,
} from "./expand-repeats";

// Standard MusicXML carries no per-note dynamics, so playback uses a single
// default velocity for every note.
export const DEFAULT_VELOCITY = 80;

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
  /** 0-based positional index of this measure in the score (same across all parts). */
  measureIndex: number;
  noteIndex: number; // chord index within measure (matches display noteIndex)
  voiceIndex: number; // note index within chord (0 = lowest pitch)
  /** True when this note is a grace note (appoggiatura or acciaccatura). */
  isGrace?: boolean;
  /**
   * True when this note is a slashed grace note (acciaccatura). Only set when
   * `isGrace` is also true. Slashed grace notes are ornamental and optional —
   * wait mode does not require them as their own wait points.
   */
  isGraceSlash?: boolean;
  /**
   * Only set on grace notes: the exact `beatCursor` value of the main note
   * this grace ornaments. Use `graceMainBeat ?? startBeat` anywhere you need the
   * beat that determines which measure or range a note belongs to.
   *
   * Stored separately from `startBeat` because `startBeat` is derived via
   * `beatCursor - k * GRACE_NOTE_BEATS` (subtraction), which may yield a
   * slightly different IEEE 754 double than the main note's accumulated
   * `beatCursor`. `graceMainBeat` is that accumulated value directly, so measure
   * boundary comparisons are immune to floating-point drift.
   */
  graceMainBeat?: number;
}

export type { RepeatSection } from "./expand-repeats";

export interface ScoreConversion {
  musicxml: string;
  notes: PlaybackNote[];
  timeSigNum: number;
  timeSigDen: number;
  totalBeats: number;
  /** Repeat-bounded sections extracted from the original score, in expanded
   *  measure coordinates.  Empty for scores with no repeat markers (including
   *  all MIDI-sourced scores). */
  repeatSections: RepeatSection[];
  /**
   * Quarter-note beat at which each measure begins (index 0 = measure 1).
   * Computed from the parsed score's actual event durations, so pickup
   * measures and time-signature changes are handled correctly. Use this — not
   * `(measureNumber - 1) * timeSigNum` — whenever you need to convert a
   * 1-indexed measure number to a beat offset.
   */
  measureStartBeats: number[];
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
  // Expand repeat sections into a flat linear measure sequence so both
  // the display and playback see the fully-unrolled score.
  const expandedXml = expandRepeatsMusicXml(xml);
  const score = parseScore(expandedXml);
  // Computed once from a single part's event durations (see
  // `computeMeasureStartBeats`), so every part shares the exact same beat for
  // a given measure boundary rather than each re-deriving its own.
  const measureStartBeats = computeMeasureStartBeats(score);
  const notes: PlaybackNote[] = [];

  score.parts.forEach((part, partIndex) => {
    let measureIndex = 0;
    for (const measure of part.measures) {
      const divisions = measure.divisions || 4;
      const measureStart = measureStartBeats[measureIndex] ?? 0;
      // Walk this measure's onsets in exact integer ticks (the file's own
      // division units) instead of accumulating a running float beat across
      // the whole part. Ticks add up exactly; combined with the shared
      // `measureStart` above, every part lands on a bit-identical beat for
      // notes at the same onset. The previous per-part float accumulation let
      // two staves whose events summed to the same beat via a different
      // sequence of additions drift apart by an ULP or more — e.g. a rest of
      // duration 2 then a note of duration 2 in one staff rounds differently
      // than a single note of duration 4 in another, even though both reach
      // beat 0.5 — which silently split chord wait points into single notes.
      let tickCursor = 0;
      for (const event of measure.events) {
        if (isRest(event)) {
          tickCursor += event.duration;
          continue;
        }

        const beatCursor = measureStart + tickCursor / divisions;
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
              measureIndex,
              noteIndex: graceGroup.noteIndex,
              voiceIndex,
              isGrace: true,
              isGraceSlash: graceGroup.slash,
              graceMainBeat: beatCursor,
            });
          });
        });

        // `event.duration` is the display duration (space to next onset in this
        // part); it drives tickCursor so subsequent notes start at the right beat.
        // `event.playbackDuration`, when present, is the actual sounding length
        // (set by the MIDI-to-MusicXML converter via <play-duration>); use it for
        // durationBeats so highlight timing reflects the true note length rather
        // than the potentially larger slot size.
        const displayBeats = event.duration / divisions;
        const playBeats =
          event.playbackDuration != null
            ? event.playbackDuration / divisions
            : null;
        event.notes.forEach((note, voiceIndex) => {
          // Use the display duration for highlighting — staccato shortens the
          // audible sound but the note should remain highlighted for its full
          // notated slot so the display stays in sync with the cursor.
          const durationBeats = playBeats ?? displayBeats;
          notes.push({
            noteNumber: pitchToMidiNumber(note.pitch),
            startBeat: beatCursor,
            durationBeats,
            velocity: DEFAULT_VELOCITY,
            tieStop: note.tieStop,
            partIndex,
            measureNumber: measure.number,
            measureIndex,
            noteIndex: event.noteIndex,
            voiceIndex,
          });
        });
        tickCursor += event.duration;
      }
      measureIndex++;
    }
  });

  const timeSig = score.parts[0]?.timeSig ?? { beats: 4, beatType: 4 };
  // The formula-based estimate overcounts for pickup (anacrusis) measures,
  // because it assumes every measure is full. Derive the actual total from
  // the notes themselves when available; fall back to the formula for empty
  // scores (no notes). A loop is used instead of Math.max(...spread) to
  // avoid stack overflows on very large scores.
  const formulaTotalBeats =
    (score.numMeasures * timeSig.beats * 4) / timeSig.beatType;
  let totalBeats = formulaTotalBeats;
  for (const note of notes) {
    const end = note.startBeat + note.durationBeats;
    if (end > totalBeats) {
      totalBeats = end;
    }
  }

  return {
    musicxml: expandedXml,
    notes,
    timeSigNum: timeSig.beats,
    timeSigDen: timeSig.beatType,
    totalBeats,
    repeatSections: extractRepeatSections(xml),
    measureStartBeats,
  };
}
