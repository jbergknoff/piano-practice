import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseMidi } from "midi-file";
import {
  getMidiTracks,
  midiToMusicXmlWithTracks,
} from "../midi/midi-to-musicxml";
import { isRest, parseScore } from "./musicxml-parser";
import {
  GRACE_NOTE_BEATS,
  musicXmlToConversion,
  pitchToMidiNumber,
} from "./musicxml-playback";

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

// Minimal MusicXML helpers for grace-note timing tests.
function makeScoreXml(measureContent: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      ${measureContent}
    </measure>
  </part>
</score-partwise>`;
}

describe("grace note timing", () => {
  test("single grace note plays before the main note", () => {
    // E5 quarter at beat 0, then grace D5 before C5 quarter at beat 1.
    const xml = makeScoreXml(`
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note>
      <note><grace/><pitch><step>D</step><octave>5</octave></pitch><type>eighth</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note>
    `);
    const { notes } = musicXmlToConversion(xml);

    const grace = notes.find((n) => n.isGrace);
    const main = notes.find(
      (n) =>
        !n.isGrace &&
        n.noteNumber === pitchToMidiNumber({ step: "C", alter: 0, octave: 5 }),
    );

    expect(grace).toBeDefined();
    expect(main).toBeDefined();
    if (!grace || !main) {
      throw new Error("notes not found");
    }
    // Grace note must start before the main note it precedes.
    expect(grace.startBeat).toBeLessThan(main.startBeat);
    // Grace note starts exactly GRACE_NOTE_BEATS before the main note.
    expect(grace.startBeat).toBeCloseTo(main.startBeat - GRACE_NOTE_BEATS);
  });

  test("multiple grace notes are staggered before the main note", () => {
    // E5 quarter at beat 0, then grace notes D5 and C#5 before C5 quarter at beat 1.
    const xml = makeScoreXml(`
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note>
      <note><grace/><pitch><step>D</step><octave>5</octave></pitch><type>sixteenth</type></note>
      <note><grace/><pitch><step>C</step><alter>1</alter><octave>5</octave></pitch><type>sixteenth</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note>
    `);
    const { notes } = musicXmlToConversion(xml);

    const graces = notes.filter((n) => n.isGrace);
    const main = notes.find(
      (n) =>
        !n.isGrace &&
        n.noteNumber === pitchToMidiNumber({ step: "C", alter: 0, octave: 5 }),
    );

    expect(graces).toHaveLength(2);
    expect(main).toBeDefined();
    if (!main) {
      throw new Error("main note not found");
    }

    // Both grace notes must start before the main note.
    for (const g of graces) {
      expect(g.startBeat).toBeLessThan(main.startBeat);
    }
    // They must be staggered (not simultaneous).
    const starts = graces.map((g) => g.startBeat).sort((a, b) => a - b);
    expect(starts[0]).toBeCloseTo(main.startBeat - 2 * GRACE_NOTE_BEATS);
    expect(starts[1]).toBeCloseTo(main.startBeat - GRACE_NOTE_BEATS);
  });

  test("grace note at the very start of a score is clamped to beat 0", () => {
    // Grace D5 immediately before C5 at beat 0 — can't go negative.
    const xml = makeScoreXml(`
      <note><grace/><pitch><step>D</step><octave>5</octave></pitch><type>eighth</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note>
    `);
    const { notes } = musicXmlToConversion(xml);

    const grace = notes.find((n) => n.isGrace);
    expect(grace).toBeDefined();
    expect(grace?.startBeat).toBeGreaterThanOrEqual(0);
  });
});

describe("staccato chord – uniform durationBeats", () => {
  // In MusicXML, articulations (staccato) are only on the primary note of a
  // chord; <chord/> members don't repeat the notation.  All voices within the
  // same chord must receive the same durationBeats so they are highlighted and
  // un-highlighted together.
  test("both notes of a staccato chord expire at the same time", () => {
    // Chord: F#5 (staccato notation) + A5 (chord member, no notation).
    // Both are eighth notes at divisions=4, so displayBeats=0.5.
    // With the fix, both should get durationBeats = 0.5 * STACCATO_PLAYBACK_RATIO = 0.25.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN"
  "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <time><beats>2</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch><step>F</step><alter>1</alter><octave>5</octave></pitch>
        <duration>2</duration><type>eighth</type>
        <notations><articulations><staccato/></articulations></notations>
      </note>
      <note>
        <chord/>
        <pitch><step>A</step><octave>5</octave></pitch>
        <duration>2</duration><type>eighth</type>
      </note>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>2</duration><type>eighth</type>
      </note>
      <note>
        <chord/>
        <pitch><step>E</step><octave>5</octave></pitch>
        <duration>2</duration><type>eighth</type>
        <notations><articulations><staccato/></articulations></notations>
      </note>
    </measure>
  </part>
</score-partwise>`;

    const { notes } = musicXmlToConversion(xml);
    // All notes are at noteIndex 0 (F#5+A5) or noteIndex 1 (C5+E5).
    const chord0 = notes.filter((n) => n.noteIndex === 0);
    const chord1 = notes.filter((n) => n.noteIndex === 1);

    expect(chord0).toHaveLength(2);
    expect(chord1).toHaveLength(2);

    // Both notes in chord0 should have the same durationBeats (staccato applied
    // to the whole chord even though only F#5 carries the notation element).
    expect(chord0[0].durationBeats).toBe(chord0[1].durationBeats);
    expect(chord0[0].durationBeats).toBeLessThan(0.5); // staccato shortens it

    // Both notes in chord1 should have the same durationBeats.
    expect(chord1[0].durationBeats).toBe(chord1[1].durationBeats);
    expect(chord1[0].durationBeats).toBeLessThan(0.5); // staccato shortens it
  });
});
