import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseMidi } from "midi-file";
import {
  getMidiTracks,
  midiToMusicXmlWithTracks,
} from "../midi/midi-to-musicxml";
import { diatonicIndex, isRest, parseScore } from "./musicxml-parser";
import {
  DIVISIONS,
  beamStemDirection,
  eventXPositions,
  groupBeamableEvents,
  headerWidth,
  ledgerLineYs,
  noteY,
  resolveLayout,
  stemDirection,
} from "./sheet-music-layout";
import type { ChordGroup, ParsedRest, Pitch } from "./sheet-music-types";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

// Full pipeline: MIDI file → MusicXML string → ParsedScore
function parseMidiFixture(filename: string, trackIndices: number[]) {
  const midiData = parseMidi(readFileSync(`test-fixtures/${filename}`));
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
// Integration — underwater theme exercises all four notation features
// ---------------------------------------------------------------------------

describe("parseScore (underwater-theme via MIDI pipeline)", () => {
  const midiData = parseMidi(
    readFileSync("test-fixtures/underwater-theme.mid"),
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
// eventXPositions
// ---------------------------------------------------------------------------

describe("eventXPositions", () => {
  const NOTE_UNIT = 48;
  const MEASURE_X = 100;
  const PADDING_LEFT = 14;

  test("empty event list returns empty array", () => {
    expect(eventXPositions([], MEASURE_X, false, 0, NOTE_UNIT, 10)).toEqual([]);
  });

  test("non-first measure: first event starts at measureX + padding", () => {
    const events = [chord([p("C", 4)])];
    const xs = eventXPositions(events, MEASURE_X, false, 0, NOTE_UNIT, 10);
    expect(xs[0]).toBe(MEASURE_X + PADDING_LEFT);
  });

  test("first measure: first event starts after header", () => {
    const events = [chord([p("C", 4)])];
    const xs = eventXPositions(events, MEASURE_X, true, 0, NOTE_UNIT, 10);
    // headerWidth(0) = 60
    expect(xs[0]).toBe(MEASURE_X + 60 + PADDING_LEFT);
  });

  test("quarter notes advance by noteUnitWidth each", () => {
    // Each quarter (duration=4): advance = max((4/4)*48, 18) = 48
    const events = [chord([p("C", 4)]), chord([p("D", 4)]), chord([p("E", 4)])];
    const xs = eventXPositions(events, 0, false, 0, NOTE_UNIT, 10);
    expect(xs).toEqual([PADDING_LEFT, PADDING_LEFT + 48, PADDING_LEFT + 96]);
  });

  test("16th notes respect minimum advance (18px) over proportional (12px)", () => {
    // duration=1 (16th): proportional = (1/4)*48 = 12 < MIN_EVENT_ADVANCE(18)
    const events = [
      chord([p("C", 4)], "16th", 1),
      chord([p("D", 4)], "16th", 1),
      chord([p("E", 4)], "16th", 1),
    ];
    const xs = eventXPositions(events, 0, false, 0, NOTE_UNIT, 10);
    expect(xs).toEqual([PADDING_LEFT, PADDING_LEFT + 18, PADDING_LEFT + 36]);
  });

  test("rest events advance by the same rules as chord events", () => {
    const events = [rest(4, "quarter"), chord([p("C", 4)])];
    const xs = eventXPositions(events, 0, false, 0, NOTE_UNIT, 10);
    expect(xs[1] - xs[0]).toBe(48); // quarter rest = 48px advance
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
    // each hold a pair. Mirrors measure 8 of the underwater theme.
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
    // F#4 + D#5 (measure 6 of the underwater theme).
    const score = parseScore(
      scoreXml([
        `${note("F", 4, 1).replace("</note>", "</note>")}<note><chord/><pitch><step>D</step><alter>1</alter><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note>`,
      ]),
    );
    expect(accidentals(score.parts[0].measures[0])).toEqual(["sharp", "sharp"]);
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
