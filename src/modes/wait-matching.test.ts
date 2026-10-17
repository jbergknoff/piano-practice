import { describe, expect, test } from "bun:test";
import {
  DEBOUNCE_MILLISECONDS,
  type MatchOutcome,
  type WaitPoint,
  initialMatcherState,
  judgeNoteEvent,
  releaseKey,
} from "./wait-matching";

// The wrong-note forgiveness window used throughout these tests.
const SENSITIVITY_MILLISECONDS = 100;

function waitPoint(
  required: number[],
  options: { optional?: number[]; tied?: number[]; isGrace?: boolean } = {},
): WaitPoint {
  return {
    beat: 0,
    noteNumbers: new Set(required),
    optionalNoteNumbers: new Set(options.optional ?? []),
    tiedNoteNumbers: new Set(options.tied ?? []),
    isGrace: options.isGrace ?? false,
    measure: 1,
  };
}

/**
 * Plays key events through the matcher the way `useWaitMode` does: keeps the
 * state and the current wait point, and moves to the next point on an advance.
 * Each event happens `gap` milliseconds after the previous one (default: long
 * enough to be outside every time window).
 */
function practise(points: WaitPoint[]) {
  let state = initialMatcherState();
  let pointIndex = 0;
  let now = 10_000;
  function event(
    kind: "on" | "off",
    noteNumber: number,
    gap: number,
  ): MatchOutcome | null {
    now += gap;
    const judgement = judgeNoteEvent(
      state,
      { noteNumber, kind },
      {
        points,
        pointIndex,
        end: points.length,
        now,
        sensitivityMilliseconds: SENSITIVITY_MILLISECONDS,
      },
    );
    state = judgement.state;
    if (judgement.advanceTo !== undefined) {
      pointIndex = judgement.advanceTo;
    }
    return judgement.outcome;
  }
  return {
    press: (noteNumber: number, gap = 1_000) => event("on", noteNumber, gap),
    release: (noteNumber: number, gap = 1_000) => event("off", noteNumber, gap),
    get pointIndex() {
      return pointIndex;
    },
    get state() {
      return state;
    },
  };
}

const C4 = 60;
const D4 = 62;
const E4 = 64;
const G4 = 67;
const WRONG = 70;

describe("judgeNoteEvent", () => {
  test("a chord advances once every note is down", () => {
    const player = practise([waitPoint([C4, E4]), waitPoint([D4])]);
    expect(player.press(C4)).toBe("incomplete");
    expect(player.pointIndex).toBe(0);
    expect(player.press(E4)).toBe("advance");
    expect(player.pointIndex).toBe(1);
  });

  test("completing the last wait point advances to the end of the range", () => {
    const player = practise([waitPoint([C4])]);
    expect(player.press(C4)).toBe("advance");
    expect(player.pointIndex).toBe(1);
  });

  test("a press past the end of the range is not judged, but the key is tracked", () => {
    const points = [waitPoint([C4])];
    const judgement = judgeNoteEvent(
      initialMatcherState(),
      { noteNumber: D4, kind: "on" },
      {
        points,
        pointIndex: 1,
        end: 1,
        now: 10_000,
        sensitivityMilliseconds: SENSITIVITY_MILLISECONDS,
      },
    );
    expect(judgement.outcome).toBeNull();
    expect(judgement.advanceTo).toBeUndefined();
    expect([...judgement.state.held]).toEqual([D4]);
  });

  test("a wrong key is penalised, and blocks the chord until it is released", () => {
    const player = practise([waitPoint([C4, E4]), waitPoint([D4])]);
    expect(player.press(WRONG)).toBe("wrong");
    expect(player.press(C4)).toBe("incomplete");
    expect(player.press(E4)).toBe("extra");
    expect(player.pointIndex).toBe(0);
    player.release(WRONG);
    // The next press of an expected note completes the chord.
    player.release(E4);
    expect(player.press(E4)).toBe("advance");
  });

  test("a wrong key right after an advance is forgiven but still blocks", () => {
    const player = practise([
      waitPoint([C4]),
      waitPoint([E4]),
      waitPoint([G4]),
    ]);
    player.press(C4);
    expect(player.press(WRONG, SENSITIVITY_MILLISECONDS - 1)).toBe("grace");
    expect(player.press(E4)).toBe("extra");
    player.release(WRONG);
    player.release(E4);
    expect(player.press(E4)).toBe("advance");
  });

  test("a repeated note must be struck again: holding it over is stale", () => {
    const player = practise([waitPoint([C4]), waitPoint([C4, E4])]);
    player.press(C4);
    expect(player.press(E4)).toBe("stale");
    expect(player.pointIndex).toBe(1);
    player.release(C4);
    expect(player.press(C4)).toBe("advance");
  });

  test("an incomplete chord is debounced right after an advance; a complete one is not", () => {
    const player = practise([
      waitPoint([C4]),
      waitPoint([D4, E4]),
      waitPoint([G4]),
    ]);
    player.press(C4);
    expect(player.press(D4, DEBOUNCE_MILLISECONDS - 1)).toBe("debounce");
    // D4's press still counted as fresh, so E4 completes the chord even inside
    // the debounce window.
    expect(player.press(E4, 0)).toBe("advance");
    expect(player.pointIndex).toBe(2);
  });

  test("a tied note needs to stay held but not be struck again", () => {
    const player = practise([waitPoint([C4]), waitPoint([E4], { tied: [C4] })]);
    player.press(C4);
    expect(player.press(E4)).toBe("advance");
  });

  test("a released tied note must be pressed again, without penalty", () => {
    const player = practise([
      waitPoint([C4]),
      waitPoint([E4], { tied: [C4] }),
      waitPoint([G4]),
    ]);
    player.press(C4);
    player.release(C4);
    expect(player.press(E4)).toBe("incomplete");
    expect(player.press(C4)).toBe("advance");
    expect(player.pointIndex).toBe(2);
  });

  test("an optional (slashed grace) note is allowed and never blocks", () => {
    const player = practise([waitPoint([E4], { optional: [D4] })]);
    expect(player.press(D4)).toBe("optional");
    expect(player.press(E4)).toBe("advance");
  });

  test("a repeated Note On for a key already down is a duplicate, not a wrong key", () => {
    const player = practise([waitPoint([C4]), waitPoint([E4])]);
    player.press(WRONG);
    player.press(C4);
    player.release(WRONG);
    expect(player.press(C4)).toBe("advance");
    // C4 is still down at E4's wait point; an instrument re-sending its Note On
    // must not block E4.
    expect(player.press(C4)).toBe("duplicate");
    expect(player.press(E4)).toBe("advance");
  });

  test("a main-chord note pressed before its grace note carries over to the main chord", () => {
    const player = practise([
      waitPoint([D4], { isGrace: true }),
      waitPoint([C4, E4]),
      waitPoint([G4]),
    ]);
    expect(player.press(C4)).toBe("optional");
    expect(player.press(D4, 0)).toBe("advance");
    expect(player.pointIndex).toBe(1);
    // C4 was struck in the same gesture, so E4 alone completes the main chord.
    expect(player.press(E4, 0)).toBe("advance");
    expect(player.pointIndex).toBe(2);
  });

  test("a main-chord note pressed once the grace chord is complete advances past the grace point", () => {
    const player = practise([
      waitPoint([D4], { isGrace: true }),
      waitPoint([C4, E4]),
      waitPoint([G4]),
    ]);
    // A wrong key holds the grace point back even though its note is down…
    player.press(WRONG);
    expect(player.press(D4)).toBe("extra");
    player.release(WRONG);
    // …so the main chord's first note is what moves past it, and counts.
    expect(player.press(C4)).toBe("advance");
    expect(player.pointIndex).toBe(1);
    expect(player.press(E4, 0)).toBe("advance");
  });

  test("judging never mutates the state it was given", () => {
    const state = initialMatcherState();
    judgeNoteEvent(
      state,
      { noteNumber: WRONG, kind: "on" },
      {
        points: [waitPoint([C4])],
        pointIndex: 0,
        end: 1,
        now: 10_000,
        sensitivityMilliseconds: SENSITIVITY_MILLISECONDS,
      },
    );
    expect(state).toEqual(initialMatcherState());
  });
});

describe("releaseKey", () => {
  test("a released key is no longer held, wrong or fresh", () => {
    const player = practise([waitPoint([C4, E4])]);
    player.press(WRONG);
    player.press(C4);
    const released = releaseKey(releaseKey(player.state, WRONG), C4);
    expect([...released.held]).toEqual([]);
    expect([...released.wrongHeld]).toEqual([]);
    expect([...released.fresh]).toEqual([]);
  });
});
