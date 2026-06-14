import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { MidiData, MidiEvent } from "midi-file";
import { parseMidi } from "midi-file";
import {
  getMidiTracks,
  midiToMusicXmlWithTracks,
} from "@piano-practice/midi-to-musicxml";
import {
  type ChordGroup,
  type MeasureEvent,
  type ParsedMeasure,
  type ParsedRest,
  type Pitch,
  diatonicIndex,
  isRest,
  parseScore,
} from "@piano-practice/sheet-music-core";
import {
  DIVISIONS,
  beamStemDirection,
  buildMeasureSpine,
  eventXsFromSpine,
  groupBeamableEvents,
  headerWidth,
  keyChangeGlyphs,
  keyChangeWidth,
  ledgerLineYs,
  noteY,
  resolveLayout,
  stemDirection,
} from "@piano-practice/sheet-music-display";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

// Full pipeline: MIDI file → MusicXML string → ParsedScore
function parseMidiFixture(filename: string, trackIndices: number[]) {
  const midiData = parseMidi(readFileSync(`tests/fixtures/${filename}`));
  const { musicxml } = midiToMusicXmlWithTracks(midiData, trackIndices);
  return parseScore(musicxml);
}

// Serialize the pitch sequence of a measure's events for snapshot assertions.
// Derived from raw MIDI note numbers — fully independent of our converter logic.
// Format: "step+octave[#]" tokens in onset order, separated by spaces.
// Chords list all voices low→high with a comma. Rests are omitted (they have
// no pitch to verify independently from the MIDI).
function pitchSnapshot(measure: {
  events: ReturnType<typeof parseScore>["parts"][0]["measures"][0]["events"];
}): string {
  return measure.events
    .flatMap((ev) => {
      if (isRest(ev)) {
        return [];
      }
      return [
        (ev as ChordGroup).notes
          .map(
            (n) =>
              `${n.pitch.step}${n.pitch.octave}${n.pitch.alter ? "#" : ""}`,
          )
          .join(","),
      ];
    })
    .join(" ");
}

function p(step: Pitch["step"], octave: number, alter: 0 | 1 = 0): Pitch {
  return { step, alter, octave };
}

function chord(
  pitches: Pitch[],
  type: ChordGroup["type"] = "quarter",
  duration = 4,
  noteIndex = 0,
): ChordGroup {
  return {
    notes: pitches.map((pitch) => ({
      kind: "note" as const,
      pitch,
      duration,
      type,
      dot: false,
      tieStart: false,
      tieStop: false,
      isChordMember: false,
      accidental: "none" as const,
      staccato: false,
    })),
    duration,
    type,
    dot: false,
    noteIndex,
  };
}

function rest(duration = 4, type: ParsedRest["type"] = "quarter"): ParsedRest {
  return { kind: "rest", duration, type, dot: false, fullMeasure: false };
}

const TREBLE = { sign: "G" as const };
const BASS = { sign: "F" as const };
const SLS = 10;
const BOTTOM_Y = 200;

// ---------------------------------------------------------------------------
// diatonicIndex
// ---------------------------------------------------------------------------

describe("diatonicIndex", () => {
  test("each step within octave 4 is consecutive", () => {
    const steps = ["C", "D", "E", "F", "G", "A", "B"] as const;
    const indices = steps.map((s) => diatonicIndex(p(s, 4)));
    expect(indices).toEqual([28, 29, 30, 31, 32, 33, 34]);
  });

  test("octave change adds 7", () => {
    expect(diatonicIndex(p("C", 5))).toBe(diatonicIndex(p("C", 4)) + 7);
    expect(diatonicIndex(p("G", 5))).toBe(diatonicIndex(p("G", 4)) + 7);
  });

  test("specific reference pitches", () => {
    expect(diatonicIndex(p("E", 4))).toBe(30); // treble bottom line
    expect(diatonicIndex(p("B", 4))).toBe(34); // treble middle line
    expect(diatonicIndex(p("G", 2))).toBe(18); // bass bottom line
    expect(diatonicIndex(p("D", 3))).toBe(22); // bass middle line
  });
});

// ---------------------------------------------------------------------------
// isRest
// ---------------------------------------------------------------------------

describe("isRest", () => {
  test("returns true for ParsedRest", () => {
    expect(isRest(rest())).toBe(true);
  });

  test("returns false for ChordGroup", () => {
    expect(isRest(chord([p("C", 4)]))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseScore — c-major-melody MIDI fixture (full pipeline)
// ---------------------------------------------------------------------------

describe("parseScore (via MIDI pipeline)", () => {
  // c-major-melody.mid: 2 measures, 4/4, C major, 8 quarter notes in 1 track
  const score = parseMidiFixture("c-major-melody.mid", [0]);

  test("parses one part and two measures", () => {
    expect(score.parts).toHaveLength(1);
    expect(score.numMeasures).toBe(2);
  });

  test("part-level clef, key sig, time sig", () => {
    const { parts } = score;
    expect(parts[0].clef).toMatchObject({ sign: "G", line: 2 });
    expect(parts[0].keySig).toMatchObject({ fifths: 0, mode: "major" });
    expect(parts[0].timeSig).toMatchObject({ beats: 4, beatType: 4 });
  });

  // Pitch order derived directly from raw MIDI note numbers at ticks 0,480,960,1440
  // and 1920,2400,2880,3360 (480 tpb, 4/4 → 1 measure = 1920 ticks).
  test("measure 1 pitch sequence: E4 C5 E5 B4", () => {
    expect(pitchSnapshot(score.parts[0].measures[0])).toBe("E4 C5 E5 B4");
  });

  test("measure 2 pitch sequence: G4 C5 D5 F4", () => {
    expect(pitchSnapshot(score.parts[0].measures[1])).toBe("G4 C5 D5 F4");
  });

  // Note types are unambiguous here: all 480-tick gaps → quarter notes.
  test("all events in both measures are quarter-note chords", () => {
    for (const measure of score.parts[0].measures) {
      for (const ev of measure.events) {
        expect(isRest(ev)).toBe(false);
        expect((ev as ChordGroup).type).toBe("quarter");
      }
    }
  });

  test("noteIndex is assigned sequentially per measure (rests not counted)", () => {
    // Measure 1: four consecutive notes → noteIndex 0..3
    const m1 = score.parts[0].measures[0].events as ChordGroup[];
    expect(m1.map((e) => e.noteIndex)).toEqual([0, 1, 2, 3]);
    // Measure 2: starts fresh at 0
    const m2 = score.parts[0].measures[1].events as ChordGroup[];
    expect(m2.map((e) => e.noteIndex)).toEqual([0, 1, 2, 3]);
  });

  test("measure number comes from the MusicXML attribute", () => {
    expect(score.parts[0].measures[0].number).toBe(1);
    expect(score.parts[0].measures[1].number).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// parseScore — g-major-melody MIDI fixture
// ---------------------------------------------------------------------------

describe("parseScore (g-major-melody via MIDI pipeline)", () => {
  // g-major-melody.mid: G major (1 sharp), 4/4, 16-measure melody
  const score = parseMidiFixture("g-major-melody.mid", [0]);
  const measures = score.parts[0].measures;

  test("parses one part with 16 measures", () => {
    expect(score.parts).toHaveLength(1);
    expect(score.numMeasures).toBe(16);
  });

  test("key signature is G major (1 sharp)", () => {
    expect(score.parts[0].keySig).toMatchObject({ fifths: 1, mode: "major" });
  });

  test("time signature is 4/4", () => {
    expect(score.parts[0].timeSig).toMatchObject({ beats: 4, beatType: 4 });
  });

  // Expected pitch sequences read directly from raw MIDI noteOn events, grouped
  // by measure (480 tpb, 4/4 → 1920 ticks/measure). Each token is the MIDI
  // note name at that onset. F# and C# come from the note number (e.g. note 90
  // = F#5, note 85 = C#5).
  // Pitch tokens use step+octave+alter format matching pitchSnapshot() output,
  // e.g. F#5 → "F5#", C#5 → "C5#". Values read from raw MIDI note numbers.
  const EXPECTED_PITCHES: string[] = [
    "F5# E5 D5 C5 A4 G4 E4",
    "E4 D4 A4 F4# A4 D4 A4",
    "F4# A4 D5 B4 C5 A4 G4 E4",
    "E4 A4 B4 C5# D5 E5 F5# G5",
    "F5# E5 D5 C5 A4 G4 E4",
    "E4 D4 A4 F4# A4 D4 A4",
    "F4# A4 D5 B4 C5 A4 G4 E4",
    "E4 A4 B4 C5# D5 E5 C5# D5",
    "F5# E5 F5# G5 A5 F5# D5",
    "D5 E5 F5# G5 A5 F5# G5 B5",
    "A5 G5 F5# G5 A5 F5# D5 C5",
    "A4 B4 C5 A4 A4 G5",
    "F5# E5 F5# G5 A5 F5# D5",
    "D5 E5 F5# G5 A5 F5# G5 B5",
    "A5 G5 F5# A4 E5 A4 D5 C5",
    "A4 D5 B4 C5# D5 E5 F5# G5",
  ];

  for (let i = 0; i < EXPECTED_PITCHES.length; i++) {
    const measureNum = i + 1;
    test(`measure ${measureNum} pitch sequence`, () => {
      expect(pitchSnapshot(measures[i])).toBe(EXPECTED_PITCHES[i]);
    });
  }

  // Measures with only clean eighth/quarter durations (no ~160-tick notes):
  // all notes should parse as eighth or quarter, none as 16th.
  const CLEAN_MEASURES = [1, 2, 3, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15].map(
    (n) => measures[n - 1],
  );
  test("clean measures contain only eighth and quarter notes (no 16th)", () => {
    for (const m of CLEAN_MEASURES) {
      for (const ev of m.events) {
        if (!isRest(ev)) {
          expect(["eighth", "quarter"]).toContain((ev as ChordGroup).type);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// parseScore — mozart-k265-var1 MIDI fixture (multi-part)
// ---------------------------------------------------------------------------

describe("parseScore (mozart-k265-var1 via MIDI pipeline)", () => {
  // mozart-k265-var1.mid: C major, 4/4, single track with all notes
  const score = parseMidiFixture("mozart-k265-var1.mid", [0]);

  test("parses one part", () => {
    expect(score.parts).toHaveLength(1);
  });

  test("key signature is C major (0 fifths)", () => {
    expect(score.parts[0].keySig).toMatchObject({ fifths: 0 });
  });

  test("has multiple measures", () => {
    expect(score.numMeasures).toBeGreaterThan(4);
  });

  test("note IDs are stable and unique across all parts", () => {
    const ids = new Set<string>();
    for (let p = 0; p < score.parts.length; p++) {
      for (const measure of score.parts[p].measures) {
        for (const ev of measure.events) {
          if (!isRest(ev)) {
            const group = ev as ChordGroup;
            for (let v = 0; v < group.notes.length; v++) {
              const id = `p${p}-m${measure.number}-n${group.noteIndex}-v${v}`;
              expect(ids.has(id)).toBe(false);
              ids.add(id);
            }
          }
        }
      }
    }
    expect(ids.size).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// Integration — simple-grand-piano exercises all four notation features
// ---------------------------------------------------------------------------

describe("parseScore (simple-grand-piano via MIDI pipeline)", () => {
  const midiData = parseMidi(
    readFileSync("tests/fixtures/simple-grand-piano.mid"),
  );
  const trackIndices = getMidiTracks(midiData).map((t) => t.index);
  const { musicxml } = midiToMusicXmlWithTracks(midiData, trackIndices);
  const score = parseScore(musicxml);

  const allNotes = score.parts.flatMap((part) =>
    part.measures.flatMap((m) =>
      m.events.flatMap((ev) => (isRest(ev) ? [] : (ev as ChordGroup).notes)),
    ),
  );

  test("it is a 3/4, C-major piece with two staves", () => {
    expect(score.parts.length).toBe(2);
    expect(score.parts[0].timeSig).toMatchObject({ beats: 3, beatType: 4 });
    expect(score.parts[0].keySig).toMatchObject({ fifths: 0 });
  });

  test("at least one note carries a natural to cancel an earlier sharp", () => {
    expect(allNotes.some((n) => n.accidental === "natural")).toBe(true);
  });

  test("the detached bass accompaniment produces staccato notes", () => {
    expect(allNotes.some((n) => n.staccato)).toBe(true);
  });

  test("a long eighth run is split into per-beat beam groups", () => {
    // Some measure must contain more than one beam group once beats break the
    // run (a single all-encompassing beam would yield exactly one group).
    const splitSomewhere = score.parts.some((part) =>
      part.measures.some(
        (m) => groupBeamableEvents(m.events, DIVISIONS).length > 1,
      ),
    );
    expect(splitSomewhere).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rondo Alla Turca opening excerpt (programmatic, full pipeline)
//
// Mozart, Piano Sonata No. 11 in A, K.331, 3rd movement ("Alla Turca").
// The note data below is the public-domain composition (the actual opening four
// measures, both hands) transcribed from the score — we intentionally do NOT
// vendor the copyrighted piano-midi.de MIDI file. 480 tpb, 2/4, A minor (no
// accidentals). Every note is a sixteenth (120 ticks). This drives the two
// features the piece exercised: the no-accidentals opening key (the converter
// used to show the later 3-sharp section's key at bar 1) and cross-staff note
// alignment in measure 2, where the right-hand sixteenth run plays against the
// left-hand chords.
// ---------------------------------------------------------------------------

describe("Rondo Alla Turca opening excerpt (K.331 III)", () => {
  const TPB_AT = 480;
  const SIXTEENTH = 120;

  // Right hand, [absoluteTick, midiNote]; measures 1–4.
  const RH: Array<[number, number]> = [
    // m1: beat-1 rest, then B4 A4 G#4 A4
    [480, 71],
    [600, 69],
    [720, 68],
    [840, 69],
    // m2: C5 D5 C5 B4 C5
    [960, 72],
    [1440, 74],
    [1560, 72],
    [1680, 71],
    [1800, 72],
    // m3: E5 F5 E5 D#5 E5
    [1920, 76],
    [2400, 77],
    [2520, 76],
    [2640, 75],
    [2760, 76],
    // m4: B5 A5 G#5 A5 B5 A5 G#5 A5
    [2880, 83],
    [3000, 81],
    [3120, 80],
    [3240, 81],
    [3360, 83],
    [3480, 81],
    [3600, 80],
    [3720, 81],
  ];

  // Left hand, [absoluteTick, midiNote]; measure 1 is silent.
  const LH: Array<[number, number]> = [
    // m2: A3, then C4+E4 chords
    [960, 57],
    [1200, 60],
    [1200, 64],
    [1440, 60],
    [1440, 64],
    [1680, 60],
    [1680, 64],
    // m3
    [1920, 57],
    [2160, 60],
    [2160, 64],
    [2400, 60],
    [2400, 64],
    [2640, 60],
    [2640, 64],
    // m4
    [2880, 57],
    [3120, 60],
    [3120, 64],
    [3360, 57],
    [3600, 60],
    [3600, 64],
  ];

  function noteTrack(
    name: string,
    onsets: Array<[number, number]>,
  ): MidiEvent[] {
    const pairs: Array<[number, number, Record<string, unknown>]> = [];
    for (const [tick, note] of onsets) {
      // sort key 1 = noteOn so an off at tick X is processed before an on at X
      pairs.push([
        tick,
        1,
        { type: "noteOn", channel: 0, noteNumber: note, velocity: 64 },
      ]);
      pairs.push([
        tick + SIXTEENTH,
        0,
        { type: "noteOff", channel: 0, noteNumber: note, velocity: 0 },
      ]);
    }
    pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const events: MidiEvent[] = [
      {
        deltaTime: 0,
        meta: true,
        type: "trackName",
        text: name,
      } as unknown as MidiEvent,
    ];
    let prev = 0;
    for (const [tick, , ev] of pairs) {
      events.push({ ...ev, deltaTime: tick - prev } as unknown as MidiEvent);
      prev = tick;
    }
    return events;
  }

  function excerptMidi(): MidiData {
    const meta: MidiEvent[] = [
      {
        deltaTime: 0,
        meta: true,
        type: "setTempo",
        microsecondsPerBeat: 500000,
      },
      {
        deltaTime: 0,
        meta: true,
        type: "timeSignature",
        numerator: 2,
        denominator: 4,
        metronome: 24,
        thirtyseconds: 8,
      },
      { deltaTime: 0, meta: true, type: "keySignature", key: 0, scale: 0 },
      { deltaTime: 0, meta: true, type: "endOfTrack" },
    ] as unknown as MidiEvent[];
    return {
      header: { format: 1, numTracks: 3, ticksPerBeat: TPB_AT },
      tracks: [meta, noteTrack("Piano right", RH), noteTrack("Piano left", LH)],
    };
  }

  const midi = excerptMidi();
  const { musicxml } = midiToMusicXmlWithTracks(
    midi,
    getMidiTracks(midi).map((t) => t.index),
  );
  const score = parseScore(musicxml);

  test("two staves, 2/4, A-minor opening (no accidentals)", () => {
    expect(score.parts).toHaveLength(2);
    expect(score.parts[0].timeSig).toMatchObject({ beats: 2, beatType: 4 });
    // Regression: the opening key has no accidentals. The converter used to keep
    // the LAST key-signature event, which would print the later section's 3
    // sharps from bar 1.
    expect(score.parts[0].keySig).toMatchObject({ fifths: 0 });
    expect(score.parts[0].clef).toMatchObject({ sign: "G" });
  });

  test("right-hand pitches match the score (measures 1–2)", () => {
    const rh = score.parts[0].measures;
    expect(pitchSnapshot(rh[0])).toBe("B4 A4 G4# A4");
    expect(pitchSnapshot(rh[1])).toBe("C5 D5 C5 B4 C5");
  });

  test("left hand rests in measure 1 and plays A3 + C4/E4 chords in measure 2", () => {
    const lh = score.parts[1].measures;
    expect(pitchSnapshot(lh[0])).toBe(""); // full-measure rest
    expect(pitchSnapshot(lh[1])).toBe("A3 C4,E4 C4,E4 C4,E4");
  });

  test("measure 2: both hands align on the shared rhythm grid", () => {
    const layout = resolveLayout(score);
    const spine = layout.measureSpines[1]; // measure 2
    const rhXs = eventXsFromSpine(score.parts[0].measures[1].events, spine);
    const lhXs = eventXsFromSpine(score.parts[1].measures[1].events, spine);
    // RH: C5@0, D5@4, C5@5, B4@6, C5@7.  LH: A3@0, chord@2, chord@4, chord@6.
    expect(rhXs[0]).toBe(lhXs[0]); // both on the downbeat (division 0)
    expect(rhXs[1]).toBe(lhXs[2]); // D5 and the chord share division 4
    expect(rhXs[3]).toBe(lhXs[3]); // B4 and the chord share division 6
  });

  test("measure 1: the G#4 gets extra room so its sharp clears the previous note", () => {
    const layout = resolveLayout(score);
    const spine = layout.measureSpines[0]; // measure 1
    // Events: [quarter rest, B4, A4, G#4, A4] (the last three a tight 16th run).
    const xs = eventXsFromSpine(score.parts[0].measures[0].events, spine);
    const intoPlainNote = xs[2] - xs[1]; // B4 -> A4 (no accidental)
    const intoSharpNote = xs[3] - xs[2]; // A4 -> G#4 (sharp)
    expect(intoSharpNote).toBeGreaterThan(intoPlainNote);
  });
});

// ---------------------------------------------------------------------------
// noteY
// ---------------------------------------------------------------------------

describe("noteY", () => {
  describe("treble clef (bottom line = E4)", () => {
    test("E4 is on line 1 (staffBottomY)", () => {
      expect(noteY(p("E", 4), TREBLE, BOTTOM_Y, SLS)).toBe(200);
    });

    test("G4 is on line 2 (1 sls above bottom)", () => {
      // 2 diatonic steps from E4 → 2 × (SLS/2) = 10px up
      expect(noteY(p("G", 4), TREBLE, BOTTOM_Y, SLS)).toBe(190);
    });

    test("B4 is on line 3, the middle line", () => {
      // 4 steps → 20px up
      expect(noteY(p("B", 4), TREBLE, BOTTOM_Y, SLS)).toBe(180);
    });

    test("F5 is on line 5, the top line", () => {
      // 8 steps → 40px up
      expect(noteY(p("F", 5), TREBLE, BOTTOM_Y, SLS)).toBe(160);
    });

    test("C4 (middle C) is below line 1", () => {
      // -2 steps from E4 → 10px below
      expect(noteY(p("C", 4), TREBLE, BOTTOM_Y, SLS)).toBe(210);
    });
  });

  describe("bass clef (bottom line = G2)", () => {
    test("G2 is on line 1 (staffBottomY)", () => {
      expect(noteY(p("G", 2), BASS, BOTTOM_Y, SLS)).toBe(200);
    });

    test("D3 is on line 3, the middle line", () => {
      // 4 steps from G2 → 20px up
      expect(noteY(p("D", 3), BASS, BOTTOM_Y, SLS)).toBe(180);
    });

    test("A3 is on line 5, the top line", () => {
      // 8 steps → 40px up
      expect(noteY(p("A", 3), BASS, BOTTOM_Y, SLS)).toBe(160);
    });
  });
});

// ---------------------------------------------------------------------------
// ledgerLineYs
// ---------------------------------------------------------------------------

describe("ledgerLineYs", () => {
  test("note on staff has no ledger lines", () => {
    // B4 is on line 3 of treble (step 4 from bottom, within 0..8)
    expect(ledgerLineYs(p("B", 4), TREBLE, BOTTOM_Y, SLS)).toHaveLength(0);
  });

  test("C4 (middle C) has one ledger line below treble staff", () => {
    // stepsFromBottom = -2 → one line at step -2
    const ys = ledgerLineYs(p("C", 4), TREBLE, BOTTOM_Y, SLS);
    expect(ys).toHaveLength(1);
    expect(ys[0]).toBe(210); // BOTTOM_Y - (-2) * (SLS/2) = 200 + 10
  });

  test("A5 has one ledger line above treble staff", () => {
    // stepsFromBottom = 10 → one line at step 10
    const ys = ledgerLineYs(p("A", 5), TREBLE, BOTTOM_Y, SLS);
    expect(ys).toHaveLength(1);
    expect(ys[0]).toBe(150); // BOTTOM_Y - 10*(SLS/2) = 200 - 50
  });

  test("C6 has two ledger lines above treble staff", () => {
    // stepsFromBottom = 12 → lines at steps 10 and 12
    const ys = ledgerLineYs(p("C", 6), TREBLE, BOTTOM_Y, SLS);
    expect(ys).toHaveLength(2);
    expect(ys).toContain(150); // step 10
    expect(ys).toContain(140); // step 12
  });

  test("E2 has one ledger line below bass staff", () => {
    // BASS_BOTTOM = G2; E2 is 2 steps below → stepsFromBottom = -2
    const ys = ledgerLineYs(p("E", 2), BASS, BOTTOM_Y, SLS);
    expect(ys).toHaveLength(1);
    expect(ys[0]).toBe(210);
  });
});

// ---------------------------------------------------------------------------
// stemDirection
// ---------------------------------------------------------------------------

describe("stemDirection", () => {
  describe("treble clef (middle line = B4)", () => {
    test("note below middle line gets stem up", () => {
      expect(stemDirection(chord([p("E", 4)]), TREBLE)).toBe("up");
    });

    test("note above middle line gets stem down", () => {
      expect(stemDirection(chord([p("D", 5)]), TREBLE)).toBe("down");
    });

    test("note on middle line (B4) gets stem up", () => {
      // farthestSteps = 0, 0 <= 0 → up
      expect(stemDirection(chord([p("B", 4)]), TREBLE)).toBe("up");
    });

    test("chord: farthest note from middle determines direction", () => {
      // E4 is 4 steps below middle, D5 is 2 steps above → farthest is E4, stem up
      expect(stemDirection(chord([p("E", 4), p("D", 5)]), TREBLE)).toBe("up");
    });
  });

  describe("bass clef (middle line = D3)", () => {
    test("note below middle line gets stem up", () => {
      expect(stemDirection(chord([p("G", 2)]), BASS)).toBe("up");
    });

    test("note above middle line gets stem down", () => {
      expect(stemDirection(chord([p("A", 3)]), BASS)).toBe("down");
    });
  });
});

// ---------------------------------------------------------------------------
// headerWidth
// ---------------------------------------------------------------------------

describe("headerWidth", () => {
  test("C major (0 sharps/flats): clef + time sig only", () => {
    // 32 (clef) + 0 (key) + 20 (time) + 8 (padding) = 60
    expect(headerWidth(0)).toBe(60);
  });

  test("G major (1 sharp): adds 10px per accidental", () => {
    expect(headerWidth(1)).toBe(70);
  });

  test("D major (2 sharps)", () => {
    expect(headerWidth(2)).toBe(80);
  });

  test("7 sharps", () => {
    expect(headerWidth(7)).toBe(130);
  });

  test("1 flat (same width as 1 sharp)", () => {
    expect(headerWidth(-1)).toBe(headerWidth(1));
  });
});

// ---------------------------------------------------------------------------
// buildMeasureSpine + eventXsFromSpine
// ---------------------------------------------------------------------------

describe("buildMeasureSpine + eventXsFromSpine", () => {
  const NOTE_UNIT = 48;
  const PAD = 14; // MEASURE_PADDING_LEFT
  const DIVS = 16; // 4/4 measure

  function measureOf(events: MeasureEvent[]): ParsedMeasure {
    return { number: 1, events, activeFifths: 0, divisions: 4 };
  }

  // x of every event for a single-part measure (relative to measureX = 0).
  function singlePartXs(
    events: MeasureEvent[],
    { isFirst = false } = {},
  ): number[] {
    const spine = buildMeasureSpine(
      [measureOf(events)],
      isFirst,
      DIVS,
      10,
      NOTE_UNIT,
    );
    return eventXsFromSpine(events, spine);
  }

  test("empty event list returns empty array", () => {
    expect(singlePartXs([])).toEqual([]);
  });

  test("non-first measure: first event starts at the left padding", () => {
    expect(singlePartXs([chord([p("C", 4)])])[0]).toBe(PAD);
  });

  test("first measure: first event starts after the header", () => {
    // headerWidth(0) = 60
    expect(singlePartXs([chord([p("C", 4)])], { isFirst: true })[0]).toBe(
      60 + PAD,
    );
  });

  test("quarter notes advance by noteUnitWidth each", () => {
    const events = [chord([p("C", 4)]), chord([p("D", 4)]), chord([p("E", 4)])];
    expect(singlePartXs(events)).toEqual([PAD, PAD + 48, PAD + 96]);
  });

  test("16th notes respect minimum advance (18px) over proportional (12px)", () => {
    const events = [
      chord([p("C", 4)], "16th", 1),
      chord([p("D", 4)], "16th", 1),
      chord([p("E", 4)], "16th", 1),
    ];
    expect(singlePartXs(events)).toEqual([PAD, PAD + 18, PAD + 36]);
  });

  test("rest events advance by the same rules as chord events", () => {
    const xs = singlePartXs([rest(4, "quarter"), chord([p("C", 4)])]);
    expect(xs[1] - xs[0]).toBe(48); // quarter rest = 48px advance
  });

  test("both staves share one grid: simultaneous onsets get the same x", () => {
    // Mirrors measure 2 of Rondo Alla Turca. Treble: a quarter then four 16ths
    // (onsets 0,4,5,6,7). Bass: four eighth chords (onsets 0,2,4,6). With the
    // old per-staff spacing the beat-1.5 bass chord (div 6) drifted left of the
    // treble note at the same beat; the shared spine puts them at one x.
    const treble = [
      chord([p("C", 5)]), // quarter @0
      chord([p("D", 5)], "16th", 1), // @4
      chord([p("C", 5)], "16th", 1), // @5
      chord([p("B", 4)], "16th", 1), // @6
      chord([p("C", 5)], "16th", 1), // @7
    ];
    const bass = [
      chord([p("A", 3)], "eighth", 2), // @0
      chord([p("C", 4), p("E", 4)], "eighth", 2), // @2
      chord([p("C", 4), p("E", 4)], "eighth", 2), // @4
      chord([p("C", 4), p("E", 4)], "eighth", 2), // @6
    ];
    const spine = buildMeasureSpine(
      [measureOf(treble), measureOf(bass)],
      false,
      DIVS,
      10,
      NOTE_UNIT,
    );
    const tx = eventXsFromSpine(treble, spine);
    const bx = eventXsFromSpine(bass, spine);
    expect(tx[3]).toBe(bx[3]); // both sound at division 6
    expect(tx[1]).toBe(bx[2]); // both sound at division 4
  });

  test("a part's own spacing widens to make room for the other staff's onsets", () => {
    // Bass alone would place its two quarters 48px apart. With a treble note
    // landing between them (an onset the bass doesn't have), the shared grid
    // pushes the bass's second quarter further right.
    const bass = [chord([p("C", 3)]), chord([p("G", 3)])]; // @0, @4
    const treble = [
      chord([p("E", 5)], "eighth", 2), // @0
      chord([p("F", 5)], "eighth", 2), // @2 — between the bass quarters
      chord([p("G", 5)]), // @4
    ];
    const spine = buildMeasureSpine(
      [measureOf(treble), measureOf(bass)],
      false,
      DIVS,
      10,
      NOTE_UNIT,
    );
    const bx = eventXsFromSpine(bass, spine);
    // 0→2 and 2→4 each advance 24 (eighth spacing) → 48 total, vs 48 for one
    // quarter — equal here, but the bass's second note now aligns with the
    // treble's div-4 note.
    const tx = eventXsFromSpine(treble, spine);
    expect(bx[1]).toBe(tx[2]);
  });

  test("a note with an accidental gets extra advance to clear the previous note", () => {
    // Three 16ths A4 G#4 A4: the G#'s sharp would collide with the first A4 at
    // the plain minimum advance, so the advance into it is widened.
    const sharp = chord([p("G", 4, 1)], "16th", 1);
    sharp.notes[0].accidental = "sharp";
    const events = [
      chord([p("A", 4)], "16th", 1),
      sharp,
      chord([p("A", 4)], "16th", 1),
    ];
    const xs = singlePartXs(events);
    expect(xs[1] - xs[0]).toBe(26); // into G#: staffSpace*2.6, vs the 18 floor
    expect(xs[2] - xs[1]).toBe(18); // into the plain A4: the 16th minimum
  });
});

// ---------------------------------------------------------------------------
// groupBeamableEvents
// ---------------------------------------------------------------------------

describe("groupBeamableEvents", () => {
  test("empty measure returns no groups", () => {
    expect(groupBeamableEvents([])).toEqual([]);
  });

  test("single eighth note is not beamed (needs 2+)", () => {
    expect(groupBeamableEvents([chord([p("C", 4)], "eighth", 2)])).toEqual([]);
  });

  test("two consecutive eighth notes form one group", () => {
    const events = [
      chord([p("C", 4)], "eighth", 2),
      chord([p("D", 4)], "eighth", 2),
    ];
    expect(groupBeamableEvents(events)).toEqual([[0, 1]]);
  });

  test("four consecutive 16th notes form one group", () => {
    const events = [
      chord([p("C", 4)], "16th", 1),
      chord([p("D", 4)], "16th", 1),
      chord([p("E", 4)], "16th", 1),
      chord([p("F", 4)], "16th", 1),
    ];
    expect(groupBeamableEvents(events)).toEqual([[0, 1, 2, 3]]);
  });

  test("rest between eighths breaks the run — no groups", () => {
    const events = [
      chord([p("C", 4)], "eighth", 2),
      rest(2, "eighth"),
      chord([p("D", 4)], "eighth", 2),
    ];
    expect(groupBeamableEvents(events)).toEqual([]);
  });

  test("quarter notes are not beamable", () => {
    const events = [chord([p("C", 4)]), chord([p("D", 4)]), chord([p("E", 4)])];
    expect(groupBeamableEvents(events)).toEqual([]);
  });

  test("quarter interrupts an eighth run into two groups", () => {
    const events = [
      chord([p("C", 4)], "eighth", 2),
      chord([p("D", 4)], "eighth", 2),
      chord([p("E", 4)]), // quarter — breaks beam
      chord([p("F", 4)], "eighth", 2),
      chord([p("G", 4)], "eighth", 2),
    ];
    expect(groupBeamableEvents(events)).toEqual([
      [0, 1],
      [3, 4],
    ]);
  });

  test("mixed 8th and 16th notes in one run form one group", () => {
    const events = [
      chord([p("C", 4)], "eighth", 2),
      chord([p("D", 4)], "16th", 1),
      chord([p("E", 4)], "16th", 1),
      chord([p("F", 4)], "eighth", 2),
    ];
    expect(groupBeamableEvents(events)).toEqual([[0, 1, 2, 3]]);
  });

  test("beatDivisions breaks a long eighth run into per-beat groups", () => {
    // Six eighths (duration 2 each) at positions 0,2,4,6,8,10. With a 4-division
    // beat the boundaries fall at 4 and 8 → three pairs.
    const events = Array.from({ length: 6 }, () =>
      chord([p("C", 4)], "eighth", 2),
    );
    expect(groupBeamableEvents(events, 4)).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });

  test("a lone eighth in its own beat is left unbeamed (gets a flag)", () => {
    // Eighth rest then five eighths: positions rest@0, then 2,4,6,8,10.
    // Beat 0 holds only the first eighth (index 1) → no group; beats 1 and 2
    // each hold a pair.
    const events = [
      rest(2, "eighth"),
      chord([p("G", 4)], "eighth", 2),
      chord([p("A", 4)], "eighth", 2),
      chord([p("B", 4)], "eighth", 2),
      chord([p("C", 5)], "eighth", 2),
      chord([p("D", 5)], "eighth", 2),
    ];
    expect(groupBeamableEvents(events, 4)).toEqual([
      [2, 3],
      [4, 5],
    ]);
  });

  test("without beatDivisions the whole run beams together", () => {
    const events = Array.from({ length: 6 }, () =>
      chord([p("C", 4)], "eighth", 2),
    );
    expect(groupBeamableEvents(events)).toEqual([[0, 1, 2, 3, 4, 5]]);
  });
});

// ---------------------------------------------------------------------------
// Accidental display logic (parseScore)
// ---------------------------------------------------------------------------

describe("accidental display", () => {
  // Build a one-part score where each measure's notes are given inline.
  function scoreXml(measures: string[], fifths = 0): string {
    const body = measures
      .map(
        (notes, i) =>
          `<measure number="${i + 1}">${
            i === 0
              ? `<attributes><divisions>4</divisions><key><fifths>${fifths}</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>`
              : ""
          }${notes}</measure>`,
      )
      .join("");
    return `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1">${body}</part></score-partwise>`;
  }

  function note(step: string, octave: number, alter = 0): string {
    const alterEl = alter !== 0 ? `<alter>${alter}</alter>` : "";
    return `<note><pitch><step>${step}</step>${alterEl}<octave>${octave}</octave></pitch><duration>4</duration><type>quarter</type></note>`;
  }

  function accidentals(measure: {
    events: ReturnType<typeof parseScore>["parts"][0]["measures"][0]["events"];
  }): string[] {
    return measure.events.flatMap((ev) =>
      isRest(ev) ? [] : (ev as ChordGroup).notes.map((n) => n.accidental),
    );
  }

  test("a natural cancels a sharp earlier in the same measure", () => {
    const score = parseScore(
      scoreXml([note("C", 4, 1) + note("C", 4, 0) + note("D", 4)]),
    );
    expect(accidentals(score.parts[0].measures[0])).toEqual([
      "sharp",
      "natural",
      "none",
    ]);
  });

  test("a repeated sharp in the same measure is not redrawn", () => {
    const score = parseScore(scoreXml([note("F", 4, 1) + note("F", 4, 1)]));
    expect(accidentals(score.parts[0].measures[0])).toEqual(["sharp", "none"]);
  });

  test("accidental state resets at the barline", () => {
    // C#4 in measure 1; a plain C4 in measure 2 needs no accidental.
    const score = parseScore(scoreXml([note("C", 4, 1), note("C", 4, 0)]));
    expect(accidentals(score.parts[0].measures[1])).toEqual(["none"]);
  });

  test("a note matching the key signature shows no accidental, its natural does", () => {
    // G major (1 sharp = F#). F#5 is in key (no glyph); F-natural needs a natural.
    const score = parseScore(scoreXml([note("F", 5, 1) + note("F", 5, 0)], 1));
    expect(accidentals(score.parts[0].measures[0])).toEqual([
      "none",
      "natural",
    ]);
  });

  test("two sharps a sixth apart in one chord both show", () => {
    // F#4 + D#5.
    const score = parseScore(
      scoreXml([
        `${note("F", 4, 1).replace("</note>", "</note>")}<note><chord/><pitch><step>D</step><alter>1</alter><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note>`,
      ]),
    );
    expect(accidentals(score.parts[0].measures[0])).toEqual(["sharp", "sharp"]);
  });
});

// ---------------------------------------------------------------------------
// Key signature changes mid-piece (parseScore + layout)
// ---------------------------------------------------------------------------

describe("key signature changes", () => {
  // Build a one-part score where measure 1 declares the opening key (full
  // attributes) and `changeMeasure` declares a new key via a key-only
  // <attributes> block, mirroring the converter's output.
  function scoreXml(opts: {
    openFifths: number;
    changeMeasure: number;
    changeFifths: number;
    numMeasures: number;
    notesByMeasure?: Record<number, string>;
  }): string {
    const { openFifths, changeMeasure, changeFifths, numMeasures } = opts;
    const body = Array.from({ length: numMeasures }, (_, i) => {
      const num = i + 1;
      let attrs = "";
      if (i === 0) {
        attrs = `<attributes><divisions>4</divisions><key><fifths>${openFifths}</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>`;
      } else if (num === changeMeasure) {
        attrs = `<attributes><key><fifths>${changeFifths}</fifths><mode>major</mode></key></attributes>`;
      }
      const notes =
        opts.notesByMeasure?.[num] ??
        "<note><pitch><step>G</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>";
      return `<measure number="${num}">${attrs}${notes}</measure>`;
    }).join("");
    return `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1">${body}</part></score-partwise>`;
  }

  test("active key is carried forward across measures", () => {
    const score = parseScore(
      scoreXml({
        openFifths: 0,
        changeMeasure: 3,
        changeFifths: 2,
        numMeasures: 4,
      }),
    );
    const ms = score.parts[0].measures;
    expect(ms.map((m) => m.activeFifths)).toEqual([0, 0, 2, 2]);
  });

  test("only the changing measure carries a keyChange descriptor", () => {
    const score = parseScore(
      scoreXml({
        openFifths: 0,
        changeMeasure: 3,
        changeFifths: 2,
        numMeasures: 4,
      }),
    );
    const ms = score.parts[0].measures;
    expect(ms[0].keyChange).toBeUndefined();
    expect(ms[1].keyChange).toBeUndefined();
    expect(ms[2].keyChange).toEqual({ fifths: 2, prevFifths: 0 });
    expect(ms[3].keyChange).toBeUndefined();
  });

  test("part-level keySig reflects the opening key, not a later change", () => {
    const score = parseScore(
      scoreXml({
        openFifths: 0,
        changeMeasure: 2,
        changeFifths: 3,
        numMeasures: 3,
      }),
    );
    expect(score.parts[0].keySig).toMatchObject({ fifths: 0 });
  });

  test("accidentals are computed against the active key of each measure", () => {
    // Opens in C; changes to D major (F#, C#) at measure 2. An F#5 in measure 2
    // is in the new key and needs no accidental; an F-natural needs a natural.
    const fSharp =
      "<note><pitch><step>F</step><alter>1</alter><octave>5</octave></pitch><duration>8</duration><type>half</type></note>";
    const fNatural =
      "<note><pitch><step>F</step><octave>5</octave></pitch><duration>8</duration><type>half</type></note>";
    const score = parseScore(
      scoreXml({
        openFifths: 0,
        changeMeasure: 2,
        changeFifths: 2,
        numMeasures: 2,
        notesByMeasure: { 2: fSharp + fNatural },
      }),
    );
    const accidentals = (score.parts[0].measures[1].events as ChordGroup[]).map(
      (e) => e.notes[0].accidental,
    );
    expect(accidentals).toEqual(["none", "natural"]);
  });

  test("a key-change measure pushes its first note right by the key-sig width", () => {
    const events = [chord([p("C", 4)])];
    const baseline = buildMeasureSpine(
      [{ number: 1, events, activeFifths: 0, divisions: 4 }],
      false,
      16,
      10,
      48,
    );
    const withChange = buildMeasureSpine(
      [
        {
          number: 1,
          events,
          activeFifths: 2,
          divisions: 4,
          keyChange: { fifths: 2, prevFifths: 0 },
        },
      ],
      false,
      16,
      10,
      48,
    );
    expect(withChange.xs[0] - baseline.xs[0]).toBe(
      keyChangeWidth({ fifths: 2, prevFifths: 0 }, 10),
    );
  });
});

// ---------------------------------------------------------------------------
// keyChangeGlyphs
// ---------------------------------------------------------------------------

describe("keyChangeGlyphs", () => {
  test("removing all sharps cancels each with a natural", () => {
    const { naturals, accidentals } = keyChangeGlyphs(
      { fifths: 0, prevFifths: 3 },
      "G",
    );
    expect(naturals).toHaveLength(3);
    expect(accidentals).toHaveLength(0);
  });

  test("adding sharps from C shows only the new sharps", () => {
    const { naturals, accidentals } = keyChangeGlyphs(
      { fifths: 3, prevFifths: 0 },
      "G",
    );
    expect(naturals).toHaveLength(0);
    expect(accidentals).toHaveLength(3);
  });

  test("adding more sharps of the same kind cancels nothing", () => {
    const { naturals, accidentals } = keyChangeGlyphs(
      { fifths: 2, prevFifths: 1 },
      "G",
    );
    expect(naturals).toHaveLength(0);
    expect(accidentals).toHaveLength(2);
  });

  test("fewer sharps cancels the trailing ones", () => {
    const { naturals, accidentals } = keyChangeGlyphs(
      { fifths: 1, prevFifths: 2 },
      "G",
    );
    expect(naturals).toHaveLength(1);
    expect(accidentals).toHaveLength(1);
  });

  test("switching sign cancels all previous accidentals", () => {
    const { naturals, accidentals } = keyChangeGlyphs(
      { fifths: -1, prevFifths: 1 },
      "G",
    );
    expect(naturals).toHaveLength(1);
    expect(accidentals).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// beamStemDirection
// ---------------------------------------------------------------------------

describe("beamStemDirection", () => {
  test("all notes below middle line → stem up", () => {
    const chords = [chord([p("E", 4)], "eighth"), chord([p("F", 4)], "eighth")];
    expect(beamStemDirection(chords, TREBLE)).toBe("up");
  });

  test("all notes above middle line → stem down", () => {
    const chords = [chord([p("D", 5)], "eighth"), chord([p("E", 5)], "eighth")];
    expect(beamStemDirection(chords, TREBLE)).toBe("down");
  });

  test("farthest note from middle determines direction", () => {
    // E4 is 4 steps below B4 (middle); D5 is only 2 steps above → stem up
    const chords = [chord([p("E", 4)], "eighth"), chord([p("D", 5)], "eighth")];
    expect(beamStemDirection(chords, TREBLE)).toBe("up");
  });

  test("bass clef: notes below middle (D3) → stem up", () => {
    const chords = [chord([p("G", 2)], "eighth"), chord([p("A", 2)], "eighth")];
    expect(beamStemDirection(chords, BASS)).toBe("up");
  });
});

// ---------------------------------------------------------------------------
// resolveLayout (integration — c-major melody fixture)
// ---------------------------------------------------------------------------

describe("resolveLayout", () => {
  const score = parseMidiFixture("c-major-melody.mid", [0]);
  // 4/4, C major, 4 quarter notes per measure, 2 measures, 1 part
  // Default: sls=10, noteUnitWidth=48, partGap=40, canvasPadding=20, ledgerMargin=35

  test("measureXs has one entry per measure", () => {
    const layout = resolveLayout(score);
    expect(layout.measureXs).toHaveLength(2);
  });

  test("first measure starts at x=0", () => {
    const layout = resolveLayout(score);
    expect(layout.measureXs[0]).toBe(0);
  });

  test("second measure starts after first measure width", () => {
    const layout = resolveLayout(score);
    // Measure 1: header(0 fifths)=60 + padding(14) + 4×48 + trailing(4) = 270
    expect(layout.measureXs[1]).toBe(270);
  });

  test("totalWidth equals sum of both measure widths", () => {
    const layout = resolveLayout(score);
    // Measure 2: 0 + 14 + 4×48 + 4 = 210 → total = 270 + 210 = 480
    expect(layout.totalWidth).toBe(480);
  });

  test("single part has one staffBottomY", () => {
    const layout = resolveLayout(score);
    expect(layout.staffBottomYs).toHaveLength(1);
  });

  test("staffBottomY for part 0 is below the canvas top padding", () => {
    const layout = resolveLayout(score);
    // canvasPadding(20) + ledgerMargin(35) + 0 + 4×sls(40) = 95
    expect(layout.staffBottomYs[0]).toBe(95);
  });

  test("layout can be overridden via config", () => {
    const layout = resolveLayout(score, { noteUnitWidth: 60 });
    expect(layout.noteUnitWidth).toBe(60);
    // Measure 1: 60 + 14 + 4×60 + 4 = 318
    expect(layout.measureXs[1]).toBe(318);
  });
});
