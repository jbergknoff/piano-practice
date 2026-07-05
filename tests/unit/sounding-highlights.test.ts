import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test } from "bun:test";
import type { ScoreConversion } from "../../lib/musicxml/musicxml-playback";
import { musicXmlToConversion } from "../../lib/musicxml/musicxml-playback";
import { extractMusicXmlFromMxl } from "../../lib/musicxml/mxl";
import { soundingHighlights } from "../../src/modes/note-colors";

// Reported bug (Debussy Arabesque No. 1): focusing measure 6 highlights notes
// just left of the focus range as a phantom first chord. `soundingHighlights`
// is the shared basis for listen mode's highlighting and playalong's
// idle/count-in highlighting, so this guards both call sites.
//
// Measure 5 ends with a triplet whose final notes land exactly on the measure
// 5/6 barline (beat 20). Because a note's end is `startBeat + durationBeats` —
// summed over a different sequence of divisions than the running float
// `computeMeasureStartBeats` accumulates — those notes end at 20.000000000000004
// while measure 6 begins at exactly 20. Sitting the cursor at the range start
// (beat 20) then reports the measure-5 notes as still sounding. Keying highlight
// membership on the rendered measure (see `measureInRange`) fixes it, the same
// way wait mode constrains its wait points to the focus range.
describe("soundingHighlights – Arabesque focus measure 6", () => {
  let conv: ScoreConversion;
  let measure6Start: number;

  beforeAll(async () => {
    const bytes = new Uint8Array(
      readFileSync("tests/fixtures/arabesque-no1.mxl"),
    );
    conv = musicXmlToConversion(await extractMusicXmlFromMxl(bytes));
    measure6Start = conv.measureStartBeats[5]; // range { from: 6, to: 6 }
  });

  test("the fixture reproduces the barline float overshoot", () => {
    // Guards the regression: measure-5 notes ending on the barline must read as
    // sounding at the measure-6 start beat under the raw test, or the fixture
    // would no longer exercise the bug.
    const leaked = conv.notes.filter(
      (note) =>
        note.measureIndex + 1 < 6 &&
        note.startBeat <= measure6Start &&
        measure6Start < note.startBeat + note.durationBeats,
    );
    expect(leaked.length).toBeGreaterThan(0);
    // Every leaked note ends a hair past the true barline at beat 20.
    for (const note of leaked) {
      expect(note.measureNumber).toBe(5);
      expect(note.startBeat + note.durationBeats).toBeGreaterThan(20);
    }
  });

  test("focusing measure 6 highlights only measure-6 notes", () => {
    const highlights = soundingHighlights(
      conv.notes,
      measure6Start,
      { from: 6, to: 6 },
      "orange",
    );
    expect(highlights.length).toBeGreaterThan(0);
    for (const highlight of highlights) {
      // IDs are p{part}-m{measureNumber}-...; measure 6 uses measureNumber 6.
      expect(highlight.kind === "score" && /^p\d+-m6-/.test(highlight.id)).toBe(
        true,
      );
    }
  });

  test("whole piece (null range) keeps the raw sounding set", () => {
    const highlights = soundingHighlights(conv.notes, measure6Start, null, "x");
    const rawSounding = conv.notes.filter(
      (note) =>
        note.startBeat <= measure6Start &&
        measure6Start < note.startBeat + note.durationBeats,
    );
    expect(highlights.length).toBe(rawSounding.length);
  });
});
