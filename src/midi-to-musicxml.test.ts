/**
 * Tests for midiToMusicXml using two complementary strategies:
 *
 * 1. Programmatic MidiData fixtures – constructed in-process so that note
 *    timings are exact and assertions can be precise.
 *
 * 2. Real-world MIDI file fixtures from two open-source projects:
 *
 *    a) g-major-melody.mid — from the music21 project
 *       (https://github.com/cuthbertLab/music21, BSD licence).
 *       Encodes a G-major melody in 4/4 time with clean eighth-note
 *       spacing at 480 ticks-per-beat.
 *
 *    b) c-major-melody.{mid,expected.musicxml} — MIDI from the partitura project
 *       (https://github.com/CPJKU/partitura, Apache 2.0 licence).
 *       A tiny 2-measure, 8-note C-major melody exported from notation software
 *       with near-perfect quarter-note timing; the paired expected MusicXML is
 *       hand-written to verify exact converter output.
 *
 *    c) mozart-k265-var1.mid — from the partitura project (Apache 2.0).
 *       Mozart K.265 Variation 1 ("Ah vous dirai-je Maman"), 24 measures,
 *       C major, 4/4, with live-performance timing (~219 notes).
 *       Used to verify the converter handles irregular timing and produces a
 *       structurally valid multi-measure score.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { MidiData, MidiEvent } from "midi-file";
import { parseMidi } from "midi-file";
import { midiToMusicXml } from "./midi-to-musicxml";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TPB = 480; // ticks per beat used in all programmatic fixtures

/** Build a minimal MidiData with a single track from a list of events. */
function makeMidi(events: MidiEvent[], tpb = TPB): MidiData {
  return {
    header: { format: 0, numTracks: 1, ticksPerBeat: tpb },
    tracks: [events],
  };
}

/** Assemble deltaTime events from (absoluteTick, event) pairs. */
function withDeltas(
  pairs: Array<[number, Record<string, unknown>]>,
): MidiEvent[] {
  const events: MidiEvent[] = [];
  let prev = 0;
  for (const [tick, ev] of pairs) {
    events.push({ ...ev, deltaTime: tick - prev } as unknown as MidiEvent);
    prev = tick;
  }
  return events;
}

/** Return all <note> blocks (as raw strings) from MusicXML output. */
function noteBlocks(xml: string): string[] {
  return [...xml.matchAll(/<note>[\s\S]*?<\/note>/g)].map((m) => m[0]);
}

/** Extract the text content of every occurrence of <tag>…</tag>. */
function tags(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, "g"))].map(
    (m) => m[1],
  );
}

/** True when the XML contains a <chord/> element at least once. */
const hasChordElement = (xml: string) => xml.includes("<chord/>");

/** Convert a MusicXML pitch to a MIDI note number, collapsing enharmonics. */
function pitchToMidi(step: string, alter: number, octave: number): number {
  const semitones: Record<string, number> = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
  };
  return (octave + 1) * 12 + semitones[step] + alter;
}

/**
 * Parse every measure in an XML string into a sorted list of
 * { midi, beats } objects (rests excluded).
 * `beats` is duration / divisions so it is comparable across files with
 * different <divisions> values.
 */
function parseMeasureNotes(
  xml: string,
): Array<Array<{ midi: number; beats: number }>> {
  const divs = Number(xml.match(/<divisions>(\d+)<\/divisions>/)?.[1] ?? 1);
  return [...xml.matchAll(/<measure[^>]*>([\s\S]*?)<\/measure>/g)].map((m) =>
    [...m[1].matchAll(/<note[^>]*>([\s\S]*?)<\/note>/g)]
      .filter((n) => !n[1].includes("<rest"))
      .map((n) => {
        const c = n[1];
        const step = c.match(/<step>([^<]+)<\/step>/)?.[1] ?? "C";
        const oct = Number(c.match(/<octave>([^<]+)<\/octave>/)?.[1] ?? 4);
        const alt = Number(c.match(/<alter>([^<]+)<\/alter>/)?.[1] ?? 0);
        const dur = Number(c.match(/<duration>(\d+)<\/duration>/)?.[1] ?? 0);
        return { midi: pitchToMidi(step, alt, oct), beats: dur / divs };
      })
      .sort((a, b) => a.midi - b.midi || a.beats - b.beats),
  );
}

// ---------------------------------------------------------------------------
// Programmatic fixtures
// ---------------------------------------------------------------------------

describe("midiToMusicXml – programmatic fixtures", () => {
  // ── C major scale: 8 quarter notes, two full 4/4 measures ──────────────
  test("C major scale produces two measures of four quarter notes each", () => {
    // C4 D4 E4 F4 | G4 A4 B4 C5
    const noteNumbers = [60, 62, 64, 65, 67, 69, 71, 72];
    const pairs: Array<[number, Record<string, unknown>]> = [
      [0, { type: "setTempo", meta: true, microsecondsPerBeat: 500000 }],
      [
        0,
        {
          type: "timeSignature",
          meta: true,
          numerator: 4,
          denominator: 4,
          metronome: 24,
          thirtyseconds: 8,
        },
      ],
      [0, { type: "keySignature", meta: true, key: 0, scale: 0 }],
    ];
    for (let i = 0; i < noteNumbers.length; i++) {
      const tick = i * TPB;
      pairs.push([
        tick,
        {
          type: "noteOn",
          channel: 0,
          noteNumber: noteNumbers[i],
          velocity: 64,
        },
      ]);
      pairs.push([
        tick + TPB,
        {
          type: "noteOff",
          channel: 0,
          noteNumber: noteNumbers[i],
          velocity: 0,
        },
      ]);
    }

    const xml = midiToMusicXml(makeMidi(withDeltas(pairs)));

    // Two measures
    expect(xml).toContain('number="1"');
    expect(xml).toContain('number="2"');
    expect(xml).not.toContain('number="3"');

    // Key: C major (0 fifths)
    expect(xml).toContain("<fifths>0</fifths>");
    expect(xml).toContain("<mode>major</mode>");

    // Time signature: 4/4
    expect(xml).toContain("<beats>4</beats>");
    expect(xml).toContain("<beat-type>4</beat-type>");

    // Every note is a quarter
    const types = tags(xml, "type");
    expect(types.every((t) => t === "quarter")).toBe(true);
    expect(types).toHaveLength(8);

    // Note pitches in order (no sharps/flats in C major scale played as white keys)
    const steps = tags(xml, "step");
    expect(steps).toEqual(["C", "D", "E", "F", "G", "A", "B", "C"]);

    // No rests (notes fill the measures exactly)
    expect(xml).not.toContain("<rest/>");

    // No chords (monophonic)
    expect(hasChordElement(xml)).toBe(false);
  });

  // ── C major triad chord ─────────────────────────────────────────────────
  test("simultaneous notes are grouped as a chord", () => {
    // C4+E4+G4 held for one quarter beat
    const chord = [60, 64, 67];
    const pairs: Array<[number, Record<string, unknown>]> = [
      [
        0,
        {
          type: "timeSignature",
          meta: true,
          numerator: 4,
          denominator: 4,
          metronome: 24,
          thirtyseconds: 8,
        },
      ],
    ];
    for (const n of chord) {
      pairs.push([
        0,
        { type: "noteOn", channel: 0, noteNumber: n, velocity: 64 },
      ]);
    }
    for (const n of chord) {
      pairs.push([
        TPB,
        { type: "noteOff", channel: 0, noteNumber: n, velocity: 0 },
      ]);
    }

    const xml = midiToMusicXml(makeMidi(withDeltas(pairs)));

    // Three <note> blocks, two of which have <chord/>
    const blocks = noteBlocks(xml);
    const pitchBlocks = blocks.filter((b) => !b.includes("<rest/>"));
    expect(pitchBlocks).toHaveLength(3);
    const chordBlocks = pitchBlocks.filter((b) => b.includes("<chord/>"));
    expect(chordBlocks).toHaveLength(2);

    // All are quarter notes
    expect(tags(xml, "type").filter((t) => t === "quarter")).toHaveLength(3);

    // Pitches present: C, E, G
    const steps = tags(xml, "step");
    expect(steps).toContain("C");
    expect(steps).toContain("E");
    expect(steps).toContain("G");
  });

  // ── Rest between two notes ──────────────────────────────────────────────
  test("gap between notes is filled with a rest", () => {
    // C4 quarter | rest quarter | D4 quarter | rest quarter
    const pairs: Array<[number, Record<string, unknown>]> = [
      [
        0,
        {
          type: "timeSignature",
          meta: true,
          numerator: 4,
          denominator: 4,
          metronome: 24,
          thirtyseconds: 8,
        },
      ],
      [0, { type: "noteOn", channel: 0, noteNumber: 60, velocity: 64 }],
      [TPB, { type: "noteOff", channel: 0, noteNumber: 60, velocity: 0 }],
      // skip one beat then D4
      [2 * TPB, { type: "noteOn", channel: 0, noteNumber: 62, velocity: 64 }],
      [3 * TPB, { type: "noteOff", channel: 0, noteNumber: 62, velocity: 0 }],
    ];

    const xml = midiToMusicXml(makeMidi(withDeltas(pairs)));

    // Two pitch notes and at least one rest
    const blocks = noteBlocks(xml);
    const pitchBlocks = blocks.filter((b) => !b.includes("<rest/>"));
    const restBlocks = blocks.filter((b) => b.includes("<rest/>"));
    expect(pitchBlocks).toHaveLength(2);
    expect(restBlocks.length).toBeGreaterThanOrEqual(1);

    // Both rests and notes are quarter-type
    const types = tags(xml, "type");
    expect(types.every((t) => t === "quarter")).toBe(true);
  });

  // ── Barline-crossing note becomes a tied pair ───────────────────────────
  test("note crossing a barline is split with tie markers", () => {
    // In 4/4 / 480 TPB, measure 1 is ticks 0-1920.
    // Note starts at tick 960 (beat 3) with duration 1200 ticks (2.5 beats):
    //   – in measure 1: 960 ticks remaining → half note (8 grid units)
    //   – in measure 2: 240 ticks → eighth note (2 grid units)
    const pairs: Array<[number, Record<string, unknown>]> = [
      [
        0,
        {
          type: "timeSignature",
          meta: true,
          numerator: 4,
          denominator: 4,
          metronome: 24,
          thirtyseconds: 8,
        },
      ],
      [960, { type: "noteOn", channel: 0, noteNumber: 60, velocity: 64 }],
      [2160, { type: "noteOff", channel: 0, noteNumber: 60, velocity: 0 }],
    ];

    const xml = midiToMusicXml(makeMidi(withDeltas(pairs)));

    // Two measures
    expect(xml).toContain('number="1"');
    expect(xml).toContain('number="2"');

    // Tie markers present
    expect(xml).toContain('type="start"');
    expect(xml).toContain('type="stop"');

    // <tied> notation elements
    expect(xml).toContain("<tied");

    // Both segments are C4
    const steps = tags(xml, "step");
    const cSteps = steps.filter((s) => s === "C");
    expect(cSteps.length).toBeGreaterThanOrEqual(2);
  });

  // ── Accidentals: sharps ─────────────────────────────────────────────────
  test("sharp notes carry alter=1", () => {
    // F#4 = MIDI 66
    const pairs: Array<[number, Record<string, unknown>]> = [
      [
        0,
        {
          type: "timeSignature",
          meta: true,
          numerator: 4,
          denominator: 4,
          metronome: 24,
          thirtyseconds: 8,
        },
      ],
      [0, { type: "noteOn", channel: 0, noteNumber: 66, velocity: 64 }],
      [TPB, { type: "noteOff", channel: 0, noteNumber: 66, velocity: 0 }],
    ];

    const xml = midiToMusicXml(makeMidi(withDeltas(pairs)));

    expect(tags(xml, "step")).toContain("F");
    expect(tags(xml, "alter")).toContain("1");
  });

  // ── 3/4 time signature ──────────────────────────────────────────────────
  test("3/4 time signature is preserved and measures have three beats", () => {
    // G4 A4 B4 in one 3/4 measure, then G4 A4 B4 in a second
    const noteNumbers = [67, 69, 71, 67, 69, 71];
    const pairs: Array<[number, Record<string, unknown>]> = [
      [
        0,
        {
          type: "timeSignature",
          meta: true,
          numerator: 3,
          denominator: 4,
          metronome: 24,
          thirtyseconds: 8,
        },
      ],
    ];
    for (let i = 0; i < noteNumbers.length; i++) {
      const tick = i * TPB;
      pairs.push([
        tick,
        {
          type: "noteOn",
          channel: 0,
          noteNumber: noteNumbers[i],
          velocity: 64,
        },
      ]);
      pairs.push([
        tick + TPB,
        {
          type: "noteOff",
          channel: 0,
          noteNumber: noteNumbers[i],
          velocity: 0,
        },
      ]);
    }

    const xml = midiToMusicXml(makeMidi(withDeltas(pairs)));

    expect(xml).toContain("<beats>3</beats>");
    expect(xml).toContain("<beat-type>4</beat-type>");

    // Two measures
    expect(xml).toContain('number="1"');
    expect(xml).toContain('number="2"');
    expect(xml).not.toContain('number="3"');

    // Six quarter notes total (no rests)
    const types = tags(xml, "type");
    expect(types.filter((t) => t === "quarter")).toHaveLength(6);
  });

  // ── G major key signature ───────────────────────────────────────────────
  test("G major key signature (1 sharp) is preserved", () => {
    const pairs: Array<[number, Record<string, unknown>]> = [
      [0, { type: "keySignature", meta: true, key: 1, scale: 0 }],
      [
        0,
        {
          type: "timeSignature",
          meta: true,
          numerator: 4,
          denominator: 4,
          metronome: 24,
          thirtyseconds: 8,
        },
      ],
      [0, { type: "noteOn", channel: 0, noteNumber: 67, velocity: 64 }],
      [TPB, { type: "noteOff", channel: 0, noteNumber: 67, velocity: 0 }],
    ];

    const xml = midiToMusicXml(makeMidi(withDeltas(pairs)));

    expect(xml).toContain("<fifths>1</fifths>");
    expect(xml).toContain("<mode>major</mode>");
  });

  // ── Eb minor key signature ──────────────────────────────────────────────
  test("flat key signature and minor mode are preserved", () => {
    // 3 flats, minor = Eb minor / Cb major; key=-3, scale=1
    const pairs: Array<[number, Record<string, unknown>]> = [
      [0, { type: "keySignature", meta: true, key: -3, scale: 1 }],
      [
        0,
        {
          type: "timeSignature",
          meta: true,
          numerator: 4,
          denominator: 4,
          metronome: 24,
          thirtyseconds: 8,
        },
      ],
      [0, { type: "noteOn", channel: 0, noteNumber: 60, velocity: 64 }],
      [TPB, { type: "noteOff", channel: 0, noteNumber: 60, velocity: 0 }],
    ];

    const xml = midiToMusicXml(makeMidi(withDeltas(pairs)));

    expect(xml).toContain("<fifths>-3</fifths>");
    expect(xml).toContain("<mode>minor</mode>");
  });

  // ── Empty MIDI (no notes) ───────────────────────────────────────────────
  test("MIDI with no notes produces a valid empty-measure score", () => {
    const xml = midiToMusicXml(
      makeMidi([{ deltaTime: 0, type: "endOfTrack", meta: true }]),
    );

    expect(xml).toContain("<?xml");
    expect(xml).toContain("<score-partwise");
    expect(xml).toContain("<measure");
    expect(xml).toContain('<rest measure="yes"');
  });

  // ── Dotted quarter note ─────────────────────────────────────────────────
  test("dotted quarter note (6 grid units) produces <dot/> element", () => {
    // 6 grid units = 6 × (TPB/4) = 6 × 120 = 720 ticks
    const dur = (TPB / 4) * 6; // dotted quarter
    const pairs: Array<[number, Record<string, unknown>]> = [
      [
        0,
        {
          type: "timeSignature",
          meta: true,
          numerator: 4,
          denominator: 4,
          metronome: 24,
          thirtyseconds: 8,
        },
      ],
      [0, { type: "noteOn", channel: 0, noteNumber: 60, velocity: 64 }],
      [dur, { type: "noteOff", channel: 0, noteNumber: 60, velocity: 0 }],
    ];

    const xml = midiToMusicXml(makeMidi(withDeltas(pairs)));

    expect(xml).toContain("<dot/>");
    expect(xml).toContain("<type>quarter</type>");
  });

  // ── Whole note ──────────────────────────────────────────────────────────
  test("note spanning a full 4/4 measure becomes a whole note", () => {
    // 4 beats × 480 ticks = 1920 ticks = 16 grid units
    const pairs: Array<[number, Record<string, unknown>]> = [
      [
        0,
        {
          type: "timeSignature",
          meta: true,
          numerator: 4,
          denominator: 4,
          metronome: 24,
          thirtyseconds: 8,
        },
      ],
      [0, { type: "noteOn", channel: 0, noteNumber: 60, velocity: 64 }],
      [4 * TPB, { type: "noteOff", channel: 0, noteNumber: 60, velocity: 0 }],
    ];

    const xml = midiToMusicXml(makeMidi(withDeltas(pairs)));

    expect(tags(xml, "type")).toContain("whole");
  });
});

// ---------------------------------------------------------------------------
// Real-world MIDI fixture: g-major-melody.mid
//
// Source: https://github.com/cuthbertLab/music21 (BSD licence)
// Path in repo: music21/midi/testPrimitive/test06.mid
//
// Contents (as parsed): key=G major (1 sharp), time=4/4, 120 BPM, 480 TPB.
// All notes are spaced 240 ticks apart (eighth notes at 480 TPB).
// First note is MIDI 78 = F#5.
// ---------------------------------------------------------------------------

describe("midiToMusicXml – g-major-melody.mid fixture", () => {
  const midiData = parseMidi(
    readFileSync("src/test-fixtures/g-major-melody.mid"),
  );
  const xml = midiToMusicXml(midiData);

  test("produces well-formed MusicXML wrapper", () => {
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain("<score-partwise");
    expect(xml).toContain("<part-list>");
    expect(xml).toContain("<part ");
    expect(xml).toContain("<measure ");
  });

  test("key signature is G major (1 sharp)", () => {
    expect(xml).toContain("<fifths>1</fifths>");
    expect(xml).toContain("<mode>major</mode>");
  });

  test("time signature is 4/4", () => {
    expect(xml).toContain("<beats>4</beats>");
    expect(xml).toContain("<beat-type>4</beat-type>");
  });

  test("notes are eighth notes (240-tick spacing at 480 TPB)", () => {
    // Dominant note type should be eighth
    const types = tags(xml, "type");
    const eighth = types.filter((t) => t === "eighth").length;
    // Overwhelmingly eighth notes (some may quantize to quarter for held notes)
    expect(eighth).toBeGreaterThan(types.length / 2);
  });

  test("first pitch note is F# (MIDI 78 = F#5)", () => {
    const blocks = noteBlocks(xml);
    const firstPitch = blocks.find((b) => !b.includes("<rest/>"));
    expect(firstPitch).toBeDefined();
    expect(firstPitch).toContain("<step>F</step>");
    expect(firstPitch).toContain("<alter>1</alter>");
    expect(firstPitch).toContain("<octave>5</octave>");
  });

  test("produces multiple measures", () => {
    // At 120 BPM / 4/4 / all eighth notes, 120 note-ons ≈ 15 measures
    const measureNums = [...xml.matchAll(/number="(\d+)"/g)].map((m) =>
      Number(m[1]),
    );
    expect(Math.max(...measureNums)).toBeGreaterThan(5);
  });

  test("contains no negative octave numbers", () => {
    // Sanity: all octave values should be non-negative
    for (const octave of tags(xml, "octave")) {
      expect(Number(octave)).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Real-world MIDI+MusicXML fixture pair: partitura test_basic_midi
//
// Source: https://github.com/CPJKU/partitura (Apache 2.0 licence)
// Files: tests/data/midi/test_basic_midi.mid
//        tests/data/musicxml/test_basic_midi.musicxml
//
// The MIDI file is a tiny synthetic 8-note melody exported from notation
// software at 480 TPB with near-perfect quarter-note timing.  The reference
// MusicXML (created by the same software) gives us ground-truth key and time
// signatures to check.
//
// Notes (MIDI note numbers and names):
//   64=E4, 72=C5, 76=E5, 71=B4, 67=G4, 72=C5, 74=D5, 65=F4
// All note-offs arrive ~25 ticks early (common notation-software practice),
// so after 16th-note quantization every note rounds to exactly one quarter.
// ---------------------------------------------------------------------------

describe("midiToMusicXml – partitura test_basic_midi fixture", () => {
  const midiData = parseMidi(
    readFileSync("src/test-fixtures/c-major-melody.mid"),
  );
  const xml = midiToMusicXml(midiData);

  test("produces well-formed MusicXML", () => {
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain("<score-partwise");
    expect(xml).toContain("<part-list>");
    expect(xml).toContain("<measure ");
  });

  test("key signature matches reference: C major (0 fifths)", () => {
    expect(xml).toContain("<fifths>0</fifths>");
    expect(xml).toContain("<mode>major</mode>");
  });

  test("time signature matches reference: 4/4", () => {
    expect(xml).toContain("<beats>4</beats>");
    expect(xml).toContain("<beat-type>4</beat-type>");
  });

  test("all 8 notes quantize to quarter notes (no rests)", () => {
    const types = tags(xml, "type");
    expect(types.every((t) => t === "quarter")).toBe(true);
    expect(types).toHaveLength(8);
    expect(xml).not.toContain("<rest/>");
  });

  test("note pitches match the MIDI note numbers", () => {
    // MIDI: 64=E4, 72=C5, 76=E5, 71=B4, 67=G4, 72=C5, 74=D5, 65=F4
    // None of these require accidentals (all natural notes)
    const steps = tags(xml, "step");
    expect(steps).toEqual(["E", "C", "E", "B", "G", "C", "D", "F"]);
    expect(xml).not.toContain("<alter>");
  });

  test("fills exactly two 4/4 measures", () => {
    expect(xml).toContain('number="1"');
    expect(xml).toContain('number="2"');
    expect(xml).not.toContain('number="3"');
  });
});

// ---------------------------------------------------------------------------
// Real-world MIDI+MusicXML fixture pair: partitura mozart_k265_var1
//
// Source: https://github.com/CPJKU/partitura (Apache 2.0 licence)
// Files: tests/data/midi/mozart_k265_var1.mid
//        tests/data/musicxml/mozart_k265_var1.musicxml
//
// Mozart "Ah vous dirai-je Maman" K.265, Variation 1.
// 219 note events with live-performance (non-quantized) timing, C major, 4/4,
// 480 TPB.  Tests that the converter handles irregular timing gracefully and
// produces a multi-measure score that agrees with the reference on key and
// time signature.
// ---------------------------------------------------------------------------

describe("midiToMusicXml – partitura mozart_k265_var1 fixture", () => {
  const midiData = parseMidi(
    readFileSync("src/test-fixtures/mozart-k265-var1.mid"),
  );
  const xml = midiToMusicXml(midiData);

  test("produces well-formed MusicXML", () => {
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain("<score-partwise");
    expect(xml).toContain("<measure ");
  });

  test("key signature matches reference: C major (0 fifths)", () => {
    expect(xml).toContain("<fifths>0</fifths>");
    expect(xml).toContain("<mode>major</mode>");
  });

  test("time signature matches reference: 4/4", () => {
    expect(xml).toContain("<beats>4</beats>");
    expect(xml).toContain("<beat-type>4</beat-type>");
  });

  test("produces a multi-measure score (~23 measures of 4/4)", () => {
    const measureNums = [...xml.matchAll(/number="(\d+)"/g)].map((m) =>
      Number(m[1]),
    );
    expect(Math.max(...measureNums)).toBeGreaterThan(10);
  });

  test("contains a mix of note types (irregular timing → varied quantization)", () => {
    const types = tags(xml, "type");
    const unique = new Set(types);
    // After quantization of 219 live-performance notes we expect at least two
    // distinct note types (e.g. eighth + sixteenth, or quarter + eighth)
    expect(unique.size).toBeGreaterThan(1);
  });

  test("contains no negative octave numbers", () => {
    for (const octave of tags(xml, "octave")) {
      expect(Number(octave)).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture comparison: our converter output vs. hand-written expected MusicXML
//
// c-major-melody.expected.musicxml was written by hand to capture
// the correct output for c-major-melody.mid: 8 quarter notes
// (E4 C5 E5 B4 | G4 C5 D5 F4) in C major, 4/4, across two measures.
// The MIDI has near-perfect quarter-note timing (note-offs 25 ticks early),
// so after 16th-note quantization every note rounds unambiguously to a quarter.
// ---------------------------------------------------------------------------

describe("fixture comparison – c-major-melody.mid vs hand-written expected", () => {
  const ourXml = midiToMusicXml(
    parseMidi(readFileSync("src/test-fixtures/c-major-melody.mid")),
  );
  const expected = readFileSync(
    "src/test-fixtures/c-major-melody.expected.musicxml",
    "utf8",
  ).trimEnd();

  test("output matches expected MusicXML exactly", () => {
    expect(ourXml).toEqual(expected);
  });
});

describe("fixture comparison – underwater theme midi from ninsheetmusic.org vs. Audiveris-generated MusicXML", () => {
  const ourXml = midiToMusicXml(
    parseMidi(readFileSync("src/test-fixtures/underwater-theme.mid")),
  );
  const expected = readFileSync(
    "src/test-fixtures/underwater-theme.musicxml",
    "utf8",
  );

  const ourMeasures = parseMeasureNotes(ourXml);
  const expMeasures = parseMeasureNotes(expected);

  // The MIDI plays through the 32-measure piece twice; the score has it once.
  test("our output has twice as many measures as the reference score", () => {
    expect(ourMeasures.length).toBe(expMeasures.length * 2);
  });

  test("3/4 time signature", () => {
    expect(ourXml).toContain("<beats>3</beats>");
    expect(ourXml).toContain("<beat-type>4</beat-type>");
  });

  test("C major key signature", () => {
    expect(ourXml).toContain("<fifths>0</fifths>");
    expect(ourXml).toContain("<mode>major</mode>");
  });

  test("each measure has the same notes as the reference (enharmonics treated as equal)", () => {
    for (let i = 0; i < expMeasures.length; i++) {
      const ourPitches = ourMeasures[i].map((n) => n.midi);
      const expPitches = expMeasures[i].map((n) => n.midi);
      expect(ourPitches).toEqual(expPitches);
    }
  });

  test("note durations are within one note-value step of the reference (e.g. eighth vs. quarter is ok)", () => {
    for (let i = 0; i < expMeasures.length; i++) {
      expect(ourMeasures[i]).toHaveLength(expMeasures[i].length);
      for (let j = 0; j < expMeasures[i].length; j++) {
        const ratio = ourMeasures[i][j].beats / expMeasures[i][j].beats;
        expect(ratio).toBeGreaterThanOrEqual(0.5);
        expect(ratio).toBeLessThanOrEqual(2);
      }
    }
  });
});
