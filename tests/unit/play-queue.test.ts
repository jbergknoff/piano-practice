import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test } from "bun:test";
import { notesSoundingAfter } from "../../lib/midi/midi-player";
import type { ScoreConversion } from "../../lib/musicxml/musicxml-playback";
import {
  musicXmlToConversion,
  playbackNoteId,
} from "../../lib/musicxml/musicxml-playback";
import { extractMusicXmlFromMxl } from "../../lib/musicxml/mxl";

// Companion to sounding-highlights.test.ts, for the *audio* side of the same
// Arabesque focus-range bug. Starting playback of a measure-6 focus range seeks
// the player to beat 20; the play queue used to include any note still ringing
// there (`startBeat + durationBeats > fromBeat`). Measure 5's last chord (F#5 +
// A4) ends at 20.000000000000004 — a ULP past the barline — so it was scheduled
// with an onset in the past and sounded immediately at the start of the range.
describe("notesSoundingAfter – Arabesque focus measure 6", () => {
  let conv: ScoreConversion;
  let measure6Start: number;

  beforeAll(async () => {
    const bytes = new Uint8Array(
      readFileSync("tests/fixtures/arabesque-no1.mxl"),
    );
    conv = musicXmlToConversion(await extractMusicXmlFromMxl(bytes));
    measure6Start = conv.measureStartBeats[5];
  });

  test("the fixture reproduces the barline overshoot in the raw queue", () => {
    // Guards the regression: the naive "still ringing" test must still pull a
    // measure-5 note into the queue, or the fixture no longer exercises the bug.
    const rawQueue = conv.notes.filter(
      (note) =>
        !note.tieStop && note.startBeat + note.durationBeats > measure6Start,
    );
    expect(rawQueue.some((note) => note.measureIndex + 1 < 6)).toBe(true);
  });

  test("the play queue excludes notes that end on the range's opening barline", () => {
    const queue = notesSoundingAfter(conv.notes, measure6Start);
    for (const note of queue) {
      expect(note.measureIndex + 1).toBeGreaterThanOrEqual(6);
    }
    // The first thing it plays is measure 6's opening note, not a leftover.
    expect(playbackNoteId(queue[0])).toMatch(/^p\d+-m6-/);
    expect(queue[0].startBeat).toBe(measure6Start);
  });

  test("a note genuinely sustaining across the seek point is kept", () => {
    // Seeking into the middle of measure 6 (half a beat in) must still schedule
    // measure 6's opening bass note, which is still sounding there.
    const midMeasure = measure6Start + 0.25;
    const queue = notesSoundingAfter(conv.notes, midMeasure);
    expect(
      queue.some(
        (note) =>
          note.startBeat <= midMeasure &&
          note.startBeat + note.durationBeats > midMeasure,
      ),
    ).toBe(true);
  });
});
