import { describe, expect, test } from "bun:test";
import {
  FLAT_NAMES,
  SHARP_NAMES,
  buildNoteSegments,
  buildTrackTableEvents,
  greedyDecompose,
  inferNotatedDurations,
  midiToKey,
  nearestMusicalDuration,
} from "./music-utils";

const PPQ = 480;
const TICKS_PER_4_4 = PPQ * 4; // 1920

// Helper to build minimal Note-like objects accepted by buildNoteSegments.
function note(
  midi: number,
  ticks: number,
  durationTicks: number,
): { midi: number; ticks: number; durationTicks: number } {
  return { midi, ticks, durationTicks };
}

// ─── nearestMusicalDuration ──────────────────────────────────────────────────

describe("nearestMusicalDuration", () => {
  test("exact quarter note", () => {
    expect(nearestMusicalDuration(PPQ, PPQ).vex).toBe("q");
  });

  test("exact half note", () => {
    expect(nearestMusicalDuration(PPQ * 2, PPQ).vex).toBe("h");
  });

  test("exact dotted quarter (3/2 * PPQ)", () => {
    expect(nearestMusicalDuration(PPQ * 1.5, PPQ).vex).toBe("qd");
  });

  test("exact dotted half (3 * PPQ)", () => {
    expect(nearestMusicalDuration(PPQ * 3, PPQ).vex).toBe("hd");
  });

  test("exact eighth note", () => {
    expect(nearestMusicalDuration(PPQ / 2, PPQ).vex).toBe("8");
  });

  test("exact dotted eighth (3/4 * PPQ)", () => {
    expect(nearestMusicalDuration((PPQ * 3) / 4, PPQ).vex).toBe("8d");
  });

  test("prefers smaller duration on a tie", () => {
    // 675 ticks is equidistant between dotted eighth (720) and eighth (480)...
    // actually: 8d = 360, 8 = 240 at ppq=480 — let's verify with actual ppq
    // At ppq=480: qd=720, q=480. Midpoint is 600.
    // 600 is equidistant from qd (diff=120) and q (diff=120) → prefer smaller (q)
    expect(nearestMusicalDuration(600, PPQ).vex).toBe("q");
  });
});

// ─── greedyDecompose ─────────────────────────────────────────────────────────

describe("greedyDecompose", () => {
  test("quarter note", () => {
    expect(greedyDecompose(PPQ, PPQ)).toEqual(["q"]);
  });

  test("half note", () => {
    expect(greedyDecompose(PPQ * 2, PPQ)).toEqual(["h"]);
  });

  test("dotted quarter", () => {
    expect(greedyDecompose(PPQ * 1.5, PPQ)).toEqual(["qd"]);
  });

  test("dotted half", () => {
    expect(greedyDecompose(PPQ * 3, PPQ)).toEqual(["hd"]);
  });

  test("whole note", () => {
    expect(greedyDecompose(PPQ * 4, PPQ)).toEqual(["w"]);
  });

  test("half + eighth (non-standard duration splits into tied components)", () => {
    // 1200 ticks = half (960) + eighth (240)
    expect(greedyDecompose(1200, PPQ)).toEqual(["h", "8"]);
  });

  test("tiny remainder falls back to 32nd", () => {
    expect(greedyDecompose(PPQ / 8, PPQ)).toEqual(["32"]);
  });
});

// ─── midiToKey ───────────────────────────────────────────────────────────────

describe("midiToKey", () => {
  test("C4 (midi 60) sharp key", () => {
    expect(midiToKey(60, SHARP_NAMES)).toBe("c/4");
  });

  test("D4 (midi 62) sharp key", () => {
    expect(midiToKey(62, SHARP_NAMES)).toBe("d/4");
  });

  test("Bb4 (midi 70) uses flat spelling in flat key", () => {
    expect(midiToKey(70, FLAT_NAMES)).toBe("bb/4");
  });

  test("Bb4 (midi 70) uses sharp spelling in sharp key", () => {
    expect(midiToKey(70, SHARP_NAMES)).toBe("a#/4");
  });

  test("C5 (midi 72)", () => {
    expect(midiToKey(72, SHARP_NAMES)).toBe("c/5");
  });

  test("B3 (midi 59)", () => {
    expect(midiToKey(59, SHARP_NAMES)).toBe("b/3");
  });
});

// ─── inferNotatedDurations ───────────────────────────────────────────────────

describe("inferNotatedDurations", () => {
  test("extends short note to fill gap to next onset", () => {
    // Quarter-note gap, but note only held for 300 ticks (staccato piano)
    const result = inferNotatedDurations([
      note(60, 0, 300),
      note(62, PPQ, 300),
    ]);
    expect(result[0].durationTicks).toBe(PPQ); // extended to 480
    expect(result[1].durationTicks).toBe(300); // last onset — unchanged
  });

  test("does not shorten a note already longer than the gap", () => {
    // Bass note held for 3 beats; melody onset every 1 beat
    const result = inferNotatedDurations([
      note(48, 0, PPQ * 3), // bass, 3-beat hold
      note(60, 0, 300), // melody beat 1
      note(62, PPQ, 300), // melody beat 2
      note(64, PPQ * 2, 300), // melody beat 3
    ]);
    const bass = result.find((n) => n.midi === 48);
    expect(bass?.durationTicks).toBe(PPQ * 3); // not truncated to PPQ
  });

  test("chord notes at same onset all get the same gap", () => {
    const result = inferNotatedDurations([
      note(60, 0, 200),
      note(64, 0, 200),
      note(67, 0, 200),
      note(72, PPQ, 100),
    ]);
    expect(result[0].durationTicks).toBe(PPQ);
    expect(result[1].durationTicks).toBe(PPQ);
    expect(result[2].durationTicks).toBe(PPQ);
  });

  test("empty array returns empty array", () => {
    expect(inferNotatedDurations([])).toEqual([]);
  });

  test("single note is unchanged", () => {
    const result = inferNotatedDurations([note(60, 0, 300)]);
    expect(result[0].durationTicks).toBe(300);
  });
});

// ─── buildNoteSegments ───────────────────────────────────────────────────────

describe("buildNoteSegments", () => {
  test("single quarter note in measure 0", () => {
    // C4, starts at tick 0, lasts one quarter
    const segs = buildNoteSegments([note(60, 0, PPQ)], PPQ, TICKS_PER_4_4, 2);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({
      midi: 60,
      measureIndex: 0,
      offsetTicks: 0,
      vex: "q",
      tieBackward: false,
      tieForward: false,
    });
  });

  test("dotted quarter note stays as one segment", () => {
    const segs = buildNoteSegments(
      [note(60, 0, PPQ * 1.5)],
      PPQ,
      TICKS_PER_4_4,
      2,
    );
    expect(segs).toHaveLength(1);
    expect(segs[0].vex).toBe("qd");
    expect(segs[0].tieForward).toBe(false);
  });

  test("whole note crossing barline splits into two tied segments", () => {
    // Note starts on beat 4 (tick 1440), lasts one whole note (1920 ticks).
    // In 4/4: measure 0 has 480 ticks left, measure 1 gets 1440 ticks.
    const segs = buildNoteSegments(
      [note(60, PPQ * 3, PPQ * 4)],
      PPQ,
      TICKS_PER_4_4,
      3,
    );
    // First segment in measure 0: quarter note, tieForward=true
    const seg0 = segs.find((s) => s.measureIndex === 0);
    expect(seg0).toBeDefined();
    expect(seg0?.tieForward).toBe(true);
    expect(seg0?.tieBackward).toBe(false);

    // Continuation segment(s) in measure 1: tieBackward=true
    const seg1 = segs.find((s) => s.measureIndex === 1);
    expect(seg1).toBeDefined();
    expect(seg1?.tieBackward).toBe(true);
    expect(seg1?.midi).toBe(60);
  });

  test("note beyond numMeasures is silently dropped", () => {
    const segs = buildNoteSegments(
      [note(60, TICKS_PER_4_4 * 5, PPQ)],
      PPQ,
      TICKS_PER_4_4,
      2, // only 2 measures
    );
    expect(segs).toHaveLength(0);
  });

  test("chord: two notes at the same tick become separate segments at the same offset", () => {
    const segs = buildNoteSegments(
      [note(60, 0, PPQ), note(64, 0, PPQ)],
      PPQ,
      TICKS_PER_4_4,
      1,
    );
    expect(segs).toHaveLength(2);
    expect(segs[0].offsetTicks).toBe(0);
    expect(segs[1].offsetTicks).toBe(0);
    expect(segs.map((s) => s.midi).sort()).toEqual([60, 64]);
  });
});

// ─── buildTrackTableEvents (snapshot) ────────────────────────────────────────

describe("buildTrackTableEvents snapshots", () => {
  test("one measure of C-major scale (eight eighth notes)", () => {
    // C D E F at beats 1–4, each lasting one quarter note
    const segs = buildNoteSegments(
      [
        note(60, 0, PPQ),
        note(62, PPQ, PPQ),
        note(64, PPQ * 2, PPQ),
        note(65, PPQ * 3, PPQ),
      ],
      PPQ,
      TICKS_PER_4_4,
      1,
    );
    const events = buildTrackTableEvents(segs, PPQ, TICKS_PER_4_4, 1, [
      "C",
      "C#",
      "D",
      "D#",
      "E",
      "F",
      "F#",
      "G",
      "G#",
      "A",
      "A#",
      "B",
    ]);
    expect(events).toMatchSnapshot();
  });

  test("dotted quarter + eighth fills one measure", () => {
    const segs = buildNoteSegments(
      [note(60, 0, PPQ * 1.5), note(62, PPQ * 1.5, PPQ * 0.5)],
      PPQ,
      TICKS_PER_4_4,
      1,
    );
    const events = buildTrackTableEvents(segs, PPQ, TICKS_PER_4_4, 1, [
      "C",
      "C#",
      "D",
      "D#",
      "E",
      "F",
      "F#",
      "G",
      "G#",
      "A",
      "A#",
      "B",
    ]);
    expect(events).toMatchSnapshot();
  });

  test("note crossing a barline appears as tied pair across two measures", () => {
    // Half note starting on beat 3 of measure 0 → spills into measure 1
    const segs = buildNoteSegments(
      [note(60, PPQ * 2, PPQ * 2)],
      PPQ,
      TICKS_PER_4_4,
      2,
    );
    const events = buildTrackTableEvents(segs, PPQ, TICKS_PER_4_4, 2, [
      "C",
      "C#",
      "D",
      "D#",
      "E",
      "F",
      "F#",
      "G",
      "G#",
      "A",
      "A#",
      "B",
    ]);
    expect(events).toMatchSnapshot();
  });

  test("empty measure is filled with rests", () => {
    const events = buildTrackTableEvents([], PPQ, TICKS_PER_4_4, 1, [
      "C",
      "C#",
      "D",
      "D#",
      "E",
      "F",
      "F#",
      "G",
      "G#",
      "A",
      "A#",
      "B",
    ]);
    expect(events).toMatchSnapshot();
  });

  test("flat key: Bb spelled as Bb not A#", () => {
    const segs = buildNoteSegments([note(70, 0, PPQ)], PPQ, TICKS_PER_4_4, 1);
    const events = buildTrackTableEvents(segs, PPQ, TICKS_PER_4_4, 1, [
      "C",
      "Db",
      "D",
      "Eb",
      "E",
      "F",
      "Gb",
      "G",
      "Ab",
      "A",
      "Bb",
      "B",
    ]);
    expect(events[0].noteNames).toEqual(["Bb4"]);
  });
});
