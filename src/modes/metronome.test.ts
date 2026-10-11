import { describe, expect, test } from "bun:test";
import { firstTickIndexFrom } from "../../lib/midi/midi-player";
import { metronomeTicks } from "./metronome";

describe("metronomeTicks", () => {
  test("4/4: one click per quarter, downbeat at each barline", () => {
    const ticks = metronomeTicks([0, 4], 8, 4);
    expect(ticks.map((tick) => tick.beat)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(
      ticks.filter((tick) => tick.downbeat).map((tick) => tick.beat),
    ).toEqual([0, 4]);
  });

  test("a pickup measure keeps later downbeats on the barlines", () => {
    // One-beat pickup, then two full 3/4 measures.
    const ticks = metronomeTicks([0, 1, 4], 7, 4);
    expect(ticks.map((tick) => tick.beat)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(
      ticks.filter((tick) => tick.downbeat).map((tick) => tick.beat),
    ).toEqual([0, 1, 4]);
  });

  test("6/8 clicks every eighth note", () => {
    const ticks = metronomeTicks([0, 3], 6, 8);
    expect(ticks.map((tick) => tick.beat)).toEqual([
      0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5,
    ]);
  });
});

describe("firstTickIndexFrom", () => {
  const ticks = metronomeTicks([0, 4, 8], 12, 4);

  test("resumes at a tick sitting exactly on the start beat", () => {
    expect(firstTickIndexFrom(ticks, 4)).toBe(4);
    // Float error just past the barline must not skip the downbeat.
    expect(firstTickIndexFrom(ticks, 4 + 1e-12)).toBe(4);
  });

  test("a mid-beat start resumes at the next tick", () => {
    expect(firstTickIndexFrom(ticks, 4.5)).toBe(5);
  });

  test("past the last tick returns the length", () => {
    expect(firstTickIndexFrom(ticks, 20)).toBe(ticks.length);
  });
});
