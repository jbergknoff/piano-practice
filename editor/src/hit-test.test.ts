import { describe, expect, test } from "bun:test";
import { addNote, createBlankDocument, serializeDocument } from "./dom-edit";
import {
  beatFromX,
  idForHandle,
  locateBeat,
  pickNote,
  pitchFromY,
} from "./hit-test";
import {
  computeMeasureStartBeats,
  noteY,
  parseScore,
  type Pitch,
  resolveLayout,
} from "./sheet-music/index";

function blankLayout() {
  const score = parseScore(serializeDocument(createBlankDocument()));
  const layout = resolveLayout(score);
  const measureStartBeats = computeMeasureStartBeats(score);
  return { score, layout, measureStartBeats };
}

describe("beatFromX", () => {
  test("maps measure left edges to their start beats", () => {
    const { score, layout, measureStartBeats } = blankLayout();
    expect(
      beatFromX(layout.measureXs[0], score, layout, measureStartBeats),
    ).toBe(0);
    expect(
      beatFromX(layout.measureXs[1], score, layout, measureStartBeats),
    ).toBe(measureStartBeats[1]);
  });

  test("interpolates and snaps within a measure", () => {
    const { score, layout, measureStartBeats } = blankLayout();
    const midX = layout.measureXs[0] + layout.measureWidths[0] / 2;
    // 4/4 measure: halfway across is beat 2.
    expect(beatFromX(midX, score, layout, measureStartBeats)).toBe(2);
  });
});

describe("locateBeat", () => {
  test("splits an absolute beat into measure + onset", () => {
    const { measureStartBeats } = blankLayout();
    expect(locateBeat(0, measureStartBeats)).toEqual({
      measureIndex: 0,
      onsetBeatInMeasure: 0,
    });
    expect(locateBeat(5, measureStartBeats)).toEqual({
      measureIndex: 1,
      onsetBeatInMeasure: 1,
    });
  });
});

describe("pitchFromY", () => {
  test("inverts noteY for a range of pitches (treble)", () => {
    const { layout } = blankLayout();
    const clef = { sign: "G" as const, line: 2 };
    const staffBottomY = layout.staffBottomYs[0];
    const pitches: Pitch[] = [
      { step: "E", alter: 0, octave: 4 }, // bottom line
      { step: "B", alter: 0, octave: 4 }, // middle line
      { step: "F", alter: 0, octave: 5 }, // top line
      { step: "C", alter: 0, octave: 5 }, // a space
      { step: "C", alter: 0, octave: 6 }, // above the staff (ledger)
    ];
    for (const pitch of pitches) {
      const y = noteY(pitch, clef, staffBottomY, layout.staffSpace);
      expect(pitchFromY(y, staffBottomY, layout.staffSpace, clef)).toEqual(
        pitch,
      );
    }
  });
});

describe("pickNote", () => {
  test("returns the id and handle of a note at a clicked location", () => {
    const doc = createBlankDocument();
    const handle = addNote(doc, {
      measureIndex: 0,
      onsetBeatInMeasure: 0,
      durationBeats: 1,
      pitch: { step: "C", alter: 0, octave: 5 },
    });
    const score = parseScore(serializeDocument(doc));

    expect(handle).not.toBeNull();
    const hit = pickNote(score, 0, { step: "C", alter: 0, octave: 5 });
    expect(hit).not.toBeNull();
    if (!hit || !handle) {
      throw new Error("expected a hit");
    }
    expect(hit.handle).toEqual(handle);
    expect(hit.id).toBe("p0-m1-n0-v0");
    // The id resolves back to the same handle.
    expect(idForHandle(score, hit.handle)).toBe(hit.id);
  });

  test("returns null when nothing is close enough", () => {
    const doc = createBlankDocument();
    addNote(doc, {
      measureIndex: 0,
      onsetBeatInMeasure: 0,
      durationBeats: 1,
      pitch: { step: "C", alter: 0, octave: 5 },
    });
    const score = parseScore(serializeDocument(doc));
    // Far away in both beat and pitch.
    expect(pickNote(score, 3.5, { step: "C", alter: 0, octave: 3 })).toBeNull();
  });
});
