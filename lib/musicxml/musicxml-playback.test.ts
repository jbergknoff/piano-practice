import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseMidi } from "midi-file";
import {
  getMidiTracks,
  midiToMusicXmlWithTracks,
} from "../midi/midi-to-musicxml";
import { isRest, parseScore } from "./musicxml-parser";
import { musicXmlToConversion, pitchToMidiNumber } from "./musicxml-playback";

// The set of note IDs the renderer assigns from a parsed score, built exactly
// as SheetMusicDisplay does: chords and their preceding grace groups, keyed by
// part index, measure number, noteIndex and the low→high voice index.
function renderedNoteIds(xml: string): Set<string> {
  const score = parseScore(xml);
  const ids = new Set<string>();
  score.parts.forEach((part, p) => {
    for (const measure of part.measures) {
      for (const event of measure.events) {
        if (isRest(event)) {
          continue;
        }
        for (const gg of event.gracesBefore ?? []) {
          gg.notes.forEach((_, vi) => {
            ids.add(`p${p}-m${measure.number}-n${gg.noteIndex}-v${vi}`);
          });
        }
        event.notes.forEach((_, vi) => {
          ids.add(`p${p}-m${measure.number}-n${event.noteIndex}-v${vi}`);
        });
      }
    }
  });
  return ids;
}

const FIXTURES = [
  "c-major-melody.mid",
  "g-major-melody.mid",
  "mozart-k265-var1.mid",
  "underwater-theme.mid",
];

describe("musicXmlToConversion – playback/render ID contract", () => {
  for (const fixture of FIXTURES) {
    test(`${fixture}: every derived playback note matches a rendered note`, () => {
      const midiData = parseMidi(readFileSync(`test-fixtures/${fixture}`));
      const trackIndices = getMidiTracks(midiData).map((t) => t.index);
      const { musicxml, notes } = midiToMusicXmlWithTracks(
        midiData,
        trackIndices,
      );

      const rendered = renderedNoteIds(musicxml);
      // Re-deriving straight from the XML must reproduce the same notes that
      // midiToMusicXmlWithTracks returned (it now routes through this function).
      const reDerived = musicXmlToConversion(musicxml).notes;
      expect(reDerived.length).toBe(notes.length);
      expect(notes.length).toBeGreaterThan(0);

      // The derived IDs must be a subset of (in practice, equal to) the IDs the
      // renderer assigns — otherwise highlighting would silently drift.
      for (const note of notes) {
        const id = `p${note.partIndex}-m${note.measureNumber}-n${note.noteIndex}-v${note.voiceIndex}`;
        expect(rendered.has(id)).toBe(true);
      }
      const derivedIds = new Set(
        notes.map(
          (n) =>
            `p${n.partIndex}-m${n.measureNumber}-n${n.noteIndex}-v${n.voiceIndex}`,
        ),
      );
      expect(derivedIds.size).toBe(rendered.size);
    });
  }
});

describe("pitchToMidiNumber", () => {
  test("maps natural, sharp and flat pitches", () => {
    expect(pitchToMidiNumber({ step: "C", alter: 0, octave: 4 })).toBe(60);
    expect(pitchToMidiNumber({ step: "A", alter: 0, octave: 4 })).toBe(69);
    expect(pitchToMidiNumber({ step: "C", alter: 1, octave: 4 })).toBe(61);
    expect(pitchToMidiNumber({ step: "D", alter: -1, octave: 4 })).toBe(61);
    expect(pitchToMidiNumber({ step: "C", alter: 0, octave: -1 })).toBe(0);
  });
});
