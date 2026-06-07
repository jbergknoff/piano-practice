import { describe, expect, test } from "bun:test";
import { createNoteTracker, trackFrame } from "./note-tracker";

describe("note tracker", () => {
  test("emits 'on' only after the note persists for onFrames", () => {
    const tracker = createNoteTracker({ onFrames: 2, offFrames: 4 });

    // First frame: present once, not yet on.
    expect(trackFrame(tracker, new Set([60]))).toEqual([]);
    // Second frame: reaches onFrames → emit on.
    expect(trackFrame(tracker, new Set([60]))).toEqual([
      { noteNumber: 60, kind: "on", velocity: 64 },
    ]);
    // Third frame: still held, no duplicate event.
    expect(trackFrame(tracker, new Set([60]))).toEqual([]);
  });

  test("stays on through a brief gap shorter than offFrames", () => {
    const tracker = createNoteTracker({ onFrames: 1, offFrames: 3 });
    trackFrame(tracker, new Set([60])); // on
    // Absent for two frames (< offFrames) → no off yet.
    expect(trackFrame(tracker, new Set())).toEqual([]);
    expect(trackFrame(tracker, new Set())).toEqual([]);
    // Reappears → still no event (already on).
    expect(trackFrame(tracker, new Set([60]))).toEqual([]);
  });

  test("emits 'off' after offFrames of absence", () => {
    const tracker = createNoteTracker({ onFrames: 1, offFrames: 2 });
    trackFrame(tracker, new Set([60])); // on
    expect(trackFrame(tracker, new Set())).toEqual([]);
    expect(trackFrame(tracker, new Set())).toEqual([
      { noteNumber: 60, kind: "off", velocity: 0 },
    ]);
  });

  test("carries velocity through to the on event", () => {
    const tracker = createNoteTracker({ onFrames: 1 });
    const events = trackFrame(tracker, new Set([72]), new Map([[72, 100]]));
    expect(events).toEqual([{ noteNumber: 72, kind: "on", velocity: 100 }]);
  });

  test("tracks chords independently", () => {
    const tracker = createNoteTracker({ onFrames: 1, offFrames: 1 });
    const events = trackFrame(tracker, new Set([60, 64, 67]));
    expect(
      events.map((event) => event.noteNumber).sort((a, b) => a - b),
    ).toEqual([60, 64, 67]);
    expect(events.every((event) => event.kind === "on")).toBe(true);
  });
});
