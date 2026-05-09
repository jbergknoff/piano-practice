import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { diatonicIndex, isRest, parseScore } from "./musicxml-parser";
import {
  eventXPositions,
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

const C_MAJOR_XML = readFileSync(
  "src/test-fixtures/c-major-melody.expected.musicxml",
  "utf-8",
);

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
      showAccidental: false,
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
// parseScore — c-major-melody fixture
// ---------------------------------------------------------------------------

describe("parseScore", () => {
  test("parses one part and two measures", () => {
    const score = parseScore(C_MAJOR_XML);
    expect(score.parts).toHaveLength(1);
    expect(score.numMeasures).toBe(2);
  });

  test("part-level clef, key sig, time sig", () => {
    const { parts } = parseScore(C_MAJOR_XML);
    expect(parts[0].clef).toMatchObject({ sign: "G", line: 2 });
    expect(parts[0].keySig).toMatchObject({ fifths: 0, mode: "major" });
    expect(parts[0].timeSig).toMatchObject({ beats: 4, beatType: 4 });
  });

  test("measure 1 has 4 events, all quarter-note chords", () => {
    const { parts } = parseScore(C_MAJOR_XML);
    const events = parts[0].measures[0].events;
    expect(events).toHaveLength(4);
    for (const ev of events) {
      expect(isRest(ev)).toBe(false);
      expect((ev as ChordGroup).type).toBe("quarter");
      expect((ev as ChordGroup).duration).toBe(4);
    }
  });

  test("measure 1 note pitches are E4 C5 E5 B4 in order", () => {
    const { parts } = parseScore(C_MAJOR_XML);
    const events = parts[0].measures[0].events as ChordGroup[];
    const pitches = events.map((ev) => ev.notes[0].pitch);
    expect(pitches[0]).toMatchObject({ step: "E", octave: 4 });
    expect(pitches[1]).toMatchObject({ step: "C", octave: 5 });
    expect(pitches[2]).toMatchObject({ step: "E", octave: 5 });
    expect(pitches[3]).toMatchObject({ step: "B", octave: 4 });
  });

  test("measure 2 has 4 events with pitches G4 C5 D5 F4", () => {
    const { parts } = parseScore(C_MAJOR_XML);
    const events = parts[0].measures[1].events as ChordGroup[];
    const pitches = events.map((ev) => ev.notes[0].pitch);
    expect(pitches[0]).toMatchObject({ step: "G", octave: 4 });
    expect(pitches[1]).toMatchObject({ step: "C", octave: 5 });
    expect(pitches[2]).toMatchObject({ step: "D", octave: 5 });
    expect(pitches[3]).toMatchObject({ step: "F", octave: 4 });
  });

  test("noteIndex is assigned sequentially per measure (rests not counted)", () => {
    const { parts } = parseScore(C_MAJOR_XML);
    // Measure 1: four consecutive notes → noteIndex 0..3
    const m1 = parts[0].measures[0].events as ChordGroup[];
    expect(m1.map((e) => e.noteIndex)).toEqual([0, 1, 2, 3]);
    // Measure 2: starts fresh at 0
    const m2 = parts[0].measures[1].events as ChordGroup[];
    expect(m2.map((e) => e.noteIndex)).toEqual([0, 1, 2, 3]);
  });

  test("measure number comes from the MusicXML attribute", () => {
    const { parts } = parseScore(C_MAJOR_XML);
    expect(parts[0].measures[0].number).toBe(1);
    expect(parts[0].measures[1].number).toBe(2);
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
    expect(eventXPositions([], MEASURE_X, false, 0, NOTE_UNIT)).toEqual([]);
  });

  test("non-first measure: first event starts at measureX + padding", () => {
    const events = [chord([p("C", 4)])];
    const xs = eventXPositions(events, MEASURE_X, false, 0, NOTE_UNIT);
    expect(xs[0]).toBe(MEASURE_X + PADDING_LEFT);
  });

  test("first measure: first event starts after header", () => {
    const events = [chord([p("C", 4)])];
    const xs = eventXPositions(events, MEASURE_X, true, 0, NOTE_UNIT);
    // headerWidth(0) = 60
    expect(xs[0]).toBe(MEASURE_X + 60 + PADDING_LEFT);
  });

  test("quarter notes advance by noteUnitWidth each", () => {
    // Each quarter (duration=4): advance = max((4/4)*48, 18) = 48
    const events = [chord([p("C", 4)]), chord([p("D", 4)]), chord([p("E", 4)])];
    const xs = eventXPositions(events, 0, false, 0, NOTE_UNIT);
    expect(xs).toEqual([PADDING_LEFT, PADDING_LEFT + 48, PADDING_LEFT + 96]);
  });

  test("16th notes respect minimum advance (18px) over proportional (12px)", () => {
    // duration=1 (16th): proportional = (1/4)*48 = 12 < MIN_EVENT_ADVANCE(18)
    const events = [
      chord([p("C", 4)], "16th", 1),
      chord([p("D", 4)], "16th", 1),
      chord([p("E", 4)], "16th", 1),
    ];
    const xs = eventXPositions(events, 0, false, 0, NOTE_UNIT);
    expect(xs).toEqual([PADDING_LEFT, PADDING_LEFT + 18, PADDING_LEFT + 36]);
  });

  test("rest events advance by the same rules as chord events", () => {
    const events = [rest(4, "quarter"), chord([p("C", 4)])];
    const xs = eventXPositions(events, 0, false, 0, NOTE_UNIT);
    expect(xs[1] - xs[0]).toBe(48); // quarter rest = 48px advance
  });
});

// ---------------------------------------------------------------------------
// resolveLayout (integration — c-major melody fixture)
// ---------------------------------------------------------------------------

describe("resolveLayout", () => {
  const score = parseScore(C_MAJOR_XML);
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
