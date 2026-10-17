import type { PlaybackNote } from "../../lib/musicxml/musicxml-playback";
import type { WaitModeDebugEvent } from "../debug-log";
import type { MeasureRange } from "../selection";

// Wait mode's rules, as pure functions: which wait points a piece has, and how
// each key press or release moves the player through them. No Preact, timers,
// cursor or audio here — `useWaitMode` owns those and acts on what these
// functions return — so every rule can be unit-tested directly
// (`wait-matching.test.ts`).

export interface WaitPoint {
  beat: number;
  noteNumbers: Set<number>;
  /**
   * Note numbers of slashed grace notes (acciaccatura) that immediately
   * precede this wait point. Playing them is allowed and carries no penalty,
   * but they are not required — the chord is considered complete without them.
   */
  optionalNoteNumbers: Set<number>;
  /**
   * Note numbers that are tied into this wait point from an earlier note (the
   * `tieStop` side of a tie). The note is expected to still be sounding, so the
   * chord is complete only while these are held — but if the user let the tied
   * note go, it must be pressed again like a required note. Re-pressing one is
   * never penalised. Kept separate from `noteNumbers` because a still-held tie
   * needs no fresh attack, whereas every `noteNumbers` entry does.
   */
  tiedNoteNumbers: Set<number>;
  isGrace: boolean;
  /**
   * Rendered measure this wait point belongs to (1-based, matching the focus
   * range numbering). Grace notes are tagged with their main note's measure,
   * even though the playback layer places them at beats just before the
   * barline (mainBeat - k * GRACE_NOTE_BEATS), which would otherwise put them
   * in the previous measure's beat span. Membership and ordering use this, not
   * the raw beat, so grace notes stay with the measure they render in.
   */
  measure: number;
}

/**
 * Derive the ordered sequence of wait points from a score's playback notes.
 *
 * Slashed grace notes (acciaccatura) are treated as optional — they are not
 * required to advance the wait point, and playing them carries no penalty.
 *
 * When a slashed grace note occupies its own beat (its start beat differs from
 * the main note's beat), that beat is folded forward: the grace note numbers
 * are collected as `optionalNoteNumbers` on the following non-slashed-grace
 * wait point rather than becoming a wait point of their own.
 *
 * When a slashed grace note is clamped to the same beat as its main note (e.g.
 * at the very start of the piece), it is also optional — the beat entry's
 * `optionalNoteNumbers` holds the grace note numbers while `noteNumbers` holds
 * only the required (non-slashed) notes.
 *
 * The `tieStop` side of a tie is not a fresh attack, so it never creates a wait
 * point of its own; instead it is recorded as a tied note on the existing wait
 * point at the same beat (if any), so wait mode can require the note to still be
 * sounding there. A tie that lands on a beat with no other onset is dropped —
 * there is nothing to wait for.
 */
export function buildWaitPoints(notes: PlaybackNote[]): WaitPoint[] {
  // Per-beat tracking splits required vs optional vs tied note numbers so that
  // slashed grace notes remain optional even when clamped to the same beat as
  // their main note, and tied notes carry their "must still be held" status.
  const beatMap = new Map<
    number,
    {
      requiredNumbers: Set<number>;
      optionalNumbers: Set<number>;
      tiedNumbers: Set<number>;
      isGrace: boolean;
      isAllGraceSlash: boolean;
      measure: number;
    }
  >();

  // Tie stops are attached after the wait-point beats are known, so a tie that
  // coincides with a real onset becomes a tied note on that wait point and a tie
  // landing on an empty beat is simply ignored.
  const tieStops: Array<{ beat: number; noteNumber: number }> = [];

  for (const note of notes) {
    if (note.tieStop) {
      tieStops.push({ beat: note.startBeat, noteNumber: note.noteNumber });
      continue;
    }
    const isSlashedGrace = (note.isGrace && note.isGraceSlash) ?? false;
    const existing = beatMap.get(note.startBeat);
    if (existing) {
      if (isSlashedGrace) {
        // Always make the grace optional at the wait point whose beat it
        // shares — so the user can play it without penalty at that point.
        // The post-processing pass below (using graceMainBeat) additionally
        // ensures it is also optional at the main note's wait point.
        existing.optionalNumbers.add(note.noteNumber);
      } else {
        existing.requiredNumbers.add(note.noteNumber);
        if (!note.isGrace) {
          // A real note defines the measure; once any non-grace note joins the
          // group, treat it as that note's (real) measure rather than a grace's.
          if (existing.isGrace) {
            existing.measure = note.measureIndex + 1;
          }
          existing.isGrace = false;
        }
        existing.isAllGraceSlash = false;
      }
    } else if (isSlashedGrace) {
      beatMap.set(note.startBeat, {
        requiredNumbers: new Set(),
        optionalNumbers: new Set([note.noteNumber]),
        tiedNumbers: new Set(),
        isGrace: true,
        isAllGraceSlash: true,
        measure: note.measureIndex + 1,
      });
    } else {
      beatMap.set(note.startBeat, {
        requiredNumbers: new Set([note.noteNumber]),
        optionalNumbers: new Set(),
        tiedNumbers: new Set(),
        isGrace: note.isGrace ?? false,
        isAllGraceSlash: false,
        measure: note.measureIndex + 1,
      });
    }
  }

  // Attach each tie stop to the wait point at its beat. A note that is also
  // freshly attacked at the same beat (already required) needs a real press, so
  // it stays in requiredNumbers rather than becoming a held-only tied note.
  for (const { beat, noteNumber } of tieStops) {
    const entry = beatMap.get(beat);
    if (entry && !entry.requiredNumbers.has(noteNumber)) {
      entry.tiedNumbers.add(noteNumber);
    }
  }

  const sorted = Array.from(beatMap.entries())
    .map(
      ([
        beat,
        {
          requiredNumbers,
          optionalNumbers,
          tiedNumbers,
          isGrace,
          isAllGraceSlash,
          measure,
        },
      ]) => ({
        beat,
        requiredNumbers,
        optionalNumbers,
        tiedNumbers,
        isGrace,
        isAllGraceSlash,
        measure,
      }),
    )
    // Sort by measure first so grace notes — whose beats fall just before the
    // barline, inside the previous measure's beat span — stay grouped with
    // the measure they belong to. Within a measure, order by beat.
    .sort((a, b) => a.measure - b.measure || a.beat - b.beat);

  // Pure slashed-grace beats (no required notes at that beat) are folded into
  // the following wait point's optional set rather than becoming points of their
  // own. Beats that mix slashed graces with real or non-slashed-grace notes
  // keep the slashed graces as local optional notes.
  const merged: WaitPoint[] = [];
  const pendingOptional = new Set<number>();

  for (const point of sorted) {
    if (point.isAllGraceSlash) {
      for (const noteNumber of point.optionalNumbers) {
        pendingOptional.add(noteNumber);
      }
    } else {
      const optionalNoteNumbers = new Set(pendingOptional);
      for (const noteNumber of point.optionalNumbers) {
        optionalNoteNumbers.add(noteNumber);
      }
      merged.push({
        beat: point.beat,
        noteNumbers: point.requiredNumbers,
        optionalNoteNumbers,
        tiedNoteNumbers: point.tiedNumbers,
        isGrace: point.isGrace,
        measure: point.measure,
      });
      pendingOptional.clear();
    }
  }

  // Post-process: ensure every slashed grace note is optional at the wait
  // point it actually ornaments. `graceMainBeat` is the exact `beatCursor` value
  // stored at conversion time — the same double used as the main note's beatMap
  // key — so this lookup is immune to the floating-point rounding that occurs
  // when computing `startBeat` as `beatCursor - k * GRACE_NOTE_BEATS`. Without
  // this, a grace whose startBeat differs by even one ULP from a co-resident
  // arpeggio note's accumulated beat slips into `pendingOptional`, gets consumed
  // by the arpeggio's wait point, and never reaches the main chord it ornaments.
  const beatToMergedIndex = new Map(
    merged.map((waitPoint, index) => [waitPoint.beat, index]),
  );
  for (const note of notes) {
    if (
      note.tieStop ||
      !(note.isGrace && note.isGraceSlash) ||
      note.graceMainBeat === undefined
    ) {
      continue;
    }
    const index = beatToMergedIndex.get(note.graceMainBeat);
    if (index !== undefined) {
      merged[index].optionalNoteNumbers.add(note.noteNumber);
    }
  }

  return merged;
}

/**
 * Returns the first wait-point index inside the range and the exclusive end
 * index. Wait points are sorted by (measure, beat), so each measure occupies a
 * contiguous slice; membership is by rendered measure number, which keeps
 * grace notes attached to the measure they render in rather than the previous
 * measure their pre-barline beats fall into.
 */
export function rangeBounds(
  points: WaitPoint[],
  range: MeasureRange | null,
): { first: number; end: number } {
  if (!range) {
    return { first: 0, end: points.length };
  }
  let first = points.findIndex((p) => p.measure >= range.from);
  if (first === -1) {
    first = points.length;
  }
  let end = points.findIndex((p) => p.measure > range.to);
  if (end === -1) {
    end = points.length;
  }
  return { first, end };
}

/**
 * A correct note arriving within this many milliseconds of an advance, while
 * the chord is still incomplete, is ignored rather than judged: it is most
 * likely a leftover key from the chord just played, and must not count
 * towards (or against) the next one.
 */
export const DEBOUNCE_MILLISECONDS = 50;

/**
 * The live state of the keyboard as wait mode sees it. Never mutated: every
 * function here returns a new state.
 */
export interface MatcherState {
  /** Every key currently down. */
  held: ReadonlySet<number>;
  /**
   * The held keys that are NOT part of the expected chord (each fired the
   * wrong-note path). While any is down the chord is not cleanly played, so
   * advancing is blocked — this is what stops "mash a fistful of keys" from
   * sliding past a wait point. Legato notes carried over from a previous chord
   * never enter it (they generate no fresh Note On), and neither do notes
   * forgiven inside the grace window.
   */
  wrongHeld: ReadonlySet<number>;
  /**
   * The held keys that received a fresh Note On (a press while the key was not
   * already down) since the last advance. Each of a wait point's required
   * notes must be in here to complete the chord — merely holding a key over
   * from the previous chord is not enough — which is what forces a repeated
   * note or chord to be re-struck each time. Tied notes are the deliberate
   * exception: they may be held over with no fresh press.
   */
  fresh: ReadonlySet<number>;
  /** When the last advance happened (milliseconds, same clock as `now`). */
  lastAdvanceTime: number;
}

export function initialMatcherState(): MatcherState {
  return {
    held: new Set(),
    wrongHeld: new Set(),
    fresh: new Set(),
    lastAdvanceTime: 0,
  };
}

/** The state after a key is let go: it is no longer held, wrong or fresh. */
export function releaseKey(
  state: MatcherState,
  noteNumber: number,
): MatcherState {
  const held = new Set(state.held);
  const wrongHeld = new Set(state.wrongHeld);
  const fresh = new Set(state.fresh);
  held.delete(noteNumber);
  wrongHeld.delete(noteNumber);
  fresh.delete(noteNumber);
  return { ...state, held, wrongHeld, fresh };
}

/** Where the player is, and the rules' one tunable. */
export interface MatchContext {
  points: WaitPoint[];
  /** The wait point being played. */
  pointIndex: number;
  /** One past the last wait point in the selected range (see `rangeBounds`). */
  end: number;
  /** Current time in milliseconds. */
  now: number;
  /**
   * How long after an advance a wrong note is forgiven without penalty (it
   * still blocks the chord until released).
   */
  sensitivityMilliseconds: number;
}

export type MatchOutcome = WaitModeDebugEvent["outcome"];

export interface NoteJudgement {
  state: MatcherState;
  /**
   * What the event meant, as recorded in the debug log; `null` for a press
   * past the end of the range, which there is nothing to judge against.
   * `"wrong"` is the one outcome the caller penalises.
   */
  outcome: MatchOutcome | null;
  /**
   * Set when the event completed the wait point: the index to move to. Equal
   * to `context.end` when the last wait point of the range was completed.
   */
  advanceTo?: number;
  /** The held and freshly pressed keys at the moment the event was judged. */
  heldWhenJudged: number[];
  freshWhenJudged: number[];
}

function isSubsetOf(notes: Iterable<number>, of: ReadonlySet<number>): boolean {
  for (const note of notes) {
    if (!of.has(note)) {
      return false;
    }
  }
  return true;
}

/**
 * The notes of `waitPoint` that were freshly struck in the gesture that just
 * completed the grace point before it. Players press grace and main-chord keys
 * in one gesture; making them re-press main-chord keys they are already holding
 * once the grace point advances would be awkward, so those presses count.
 */
function freshPressesCarriedInto(
  waitPoint: WaitPoint,
  fresh: ReadonlySet<number>,
): Set<number> {
  const carried = new Set<number>();
  for (const noteNumber of waitPoint.noteNumbers) {
    if (fresh.has(noteNumber)) {
      carried.add(noteNumber);
    }
  }
  return carried;
}

/** Judge one key press or release against the current wait point. */
export function judgeNoteEvent(
  state: MatcherState,
  event: { noteNumber: number; kind: "on" | "off" },
  context: MatchContext,
): NoteJudgement {
  const { noteNumber, kind } = event;
  const { points, pointIndex, end, now, sensitivityMilliseconds } = context;
  const msSinceAdvance = now - state.lastAdvanceTime;

  if (kind === "off") {
    const released = releaseKey(state, noteNumber);
    return {
      state: released,
      outcome: "off",
      heldWhenJudged: [...released.held],
      freshWhenJudged: [...released.fresh],
    };
  }

  const held = new Set(state.held);
  const wrongHeld = new Set(state.wrongHeld);
  const fresh = new Set(state.fresh);

  // A Note On for a key that is already down is a duplicate event (no Note Off
  // in between), not a fresh key press: some instruments re-send Note On for
  // sustained or pedalled notes, and the tail of a rolled chord re-articulates
  // tones that are still down.
  const alreadyHeld = state.held.has(noteNumber);
  held.add(noteNumber);
  if (!alreadyHeld) {
    fresh.add(noteNumber);
  }
  const heldWhenJudged = [...held];
  const freshWhenJudged = [...fresh];
  const judged = (
    outcome: MatchOutcome | null,
    changes: Partial<MatcherState> = {},
    advanceTo?: number,
  ): NoteJudgement => ({
    state: {
      held,
      wrongHeld,
      fresh,
      lastAdvanceTime: state.lastAdvanceTime,
      ...changes,
    },
    outcome,
    advanceTo,
    heldWhenJudged,
    freshWhenJudged,
  });

  if (pointIndex >= end) {
    return judged(null);
  }
  const waitPoint = points[pointIndex];
  const required = waitPoint.noteNumbers;
  // Tied notes must still be sounding for the chord to be complete, but a
  // still-held one needs no fresh press. Re-pressing one (after letting it go)
  // is allowed, so it counts as an accepted note alongside the required ones.
  const tied = waitPoint.tiedNoteNumbers;
  const nextIndex = pointIndex + 1;

  if (!required.has(noteNumber) && !tied.has(noteNumber)) {
    // Slashed grace notes attached to this wait point are optional: playing
    // them is permitted and carries no penalty, but they are not required.
    if (waitPoint.optionalNoteNumbers.has(noteNumber)) {
      return judged("optional");
    }
    // At a non-slashed grace wait point, notes of the next wait point are
    // "anticipated": the player naturally presses grace and main-chord keys in
    // one gesture and must not be penalised for it. If the grace chord is
    // already complete (e.g. its note was debounced earlier and sits in
    // `fresh`), advance now, so both wait points resolve in one gesture.
    if (waitPoint.isGrace && !alreadyHeld && nextIndex < end) {
      const nextPoint = points[nextIndex];
      if (
        nextPoint.noteNumbers.has(noteNumber) ||
        nextPoint.optionalNoteNumbers.has(noteNumber) ||
        nextPoint.tiedNoteNumbers.has(noteNumber)
      ) {
        const graceComplete =
          isSubsetOf(required, held) &&
          isSubsetOf(required, fresh) &&
          isSubsetOf(tied, held) &&
          wrongHeld.size === 0;
        if (!graceComplete) {
          return judged("optional");
        }
        return judged(
          "advance",
          {
            fresh: freshPressesCarriedInto(nextPoint, fresh),
            lastAdvanceTime: now,
          },
          nextIndex,
        );
      }
    }
    // A duplicate Note On must NOT count as a wrong key: otherwise an upper
    // chord tone held across consecutive wait points would block the next
    // advance though no new wrong key was pressed. (You cannot press a key
    // that is already down, so a real wrong press is never `alreadyHeld`.)
    if (alreadyHeld) {
      return judged("duplicate");
    }
    // A wrong key blocks the advance while held (see `extra` below) — this is
    // what makes mashing fail. It is recorded even inside the grace window,
    // because otherwise a wrong key mashed right after an advance would be
    // forgiven and the correct key alongside it would slide straight past. The
    // grace window only waives the penalty, so a near-simultaneous fumble
    // around a transition isn't punished twice.
    wrongHeld.add(noteNumber);
    if (msSinceAdvance < sensitivityMilliseconds) {
      return judged("grace");
    }
    return judged("wrong");
  }

  // Check completion before the debounce: once every required note has been
  // freshly struck (and every tied note is held), the chord is unambiguously
  // complete and advances at once, even inside the debounce window. Only an
  // incomplete chord is debounced, so a leftover key from the previous chord
  // can't trigger a premature advance.
  const chordComplete =
    isSubsetOf(required, held) &&
    isSubsetOf(required, fresh) &&
    isSubsetOf(tied, held);

  if (!chordComplete) {
    if (msSinceAdvance < DEBOUNCE_MILLISECONDS) {
      return judged("debounce");
    }
    // "Not all notes down yet" (incomplete) versus "every note is down, but a
    // required one was held over rather than re-struck" (stale). The latter is
    // the signature of a repeated note or chord that needs a fresh attack.
    const heldComplete = isSubsetOf(required, held) && isSubsetOf(tied, held);
    return judged(heldComplete ? "stale" : "incomplete");
  }

  // Even with the whole chord down, refuse to advance while wrong keys are
  // also held: the user must release them, and the chord then advances on the
  // next press of an expected note.
  if (wrongHeld.size > 0) {
    return judged("extra");
  }

  // Each wait point is judged on its own fresh presses, so the tally restarts —
  // except, after a grace point, for the presses carried into the next chord.
  const carriedFresh =
    waitPoint.isGrace && nextIndex < end
      ? freshPressesCarriedInto(points[nextIndex], fresh)
      : new Set<number>();
  return judged(
    "advance",
    { fresh: carriedFresh, lastAdvanceTime: now },
    nextIndex,
  );
}
