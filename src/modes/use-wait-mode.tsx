import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import {
  ResultModal,
  type ResultRow,
  ScoreChip,
  formatDate,
} from "../components/ResultModal";
import type { WaitModeDebugEvent } from "../debug-log";
import {
  type WaitModeAttempt,
  clearAttempts,
  deleteAttempt,
  loadAttemptHistory,
  saveAttempt,
} from "../hooks/use-file-history";
import type { ThemeTokens } from "../theme";
import type { PlaybackNote } from "../../lib/musicxml/musicxml-playback";
import type { ModeControl, ModeHandle, NoteHighlight } from "./mode-control";
import { useStableHighlights } from "./note-colors";

export type { DebugBeatEvent } from "../debug-log";

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

export interface WaitModeSettings {
  noteSensitivityMilliseconds: number;
  /** Current BPM — used to compute expected attempt duration for scoring. */
  bpm: number;
  accent: string;
  theme: ThemeTokens;
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
        // The post-processing pass below (using anchorBeat) additionally
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
  // point it actually ornaments. `anchorBeat` is the exact `beatCursor` value
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
      note.anchorBeat === undefined
    ) {
      continue;
    }
    const index = beatToMergedIndex.get(note.anchorBeat);
    if (index !== undefined) {
      merged[index].optionalNoteNumbers.add(note.noteNumber);
    }
  }

  return merged;
}

function formatTime(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Returns the beat to use for cursor and player positioning when jumping to a
 * wait point. Grace notes have a raw beat just before the barline of their
 * rendered measure (mainBeat - k * GRACE_NOTE_BEATS), which would place the
 * cursor in the previous measure's visual span — potentially even behind the
 * beat we just came from. Using the rendered measure's start beat keeps the
 * cursor co-located with the highlighted note.
 */
function waitPointCursorBeat(
  waitPoint: WaitPoint,
  measureStartBeats: number[],
): number {
  if (waitPoint.isGrace) {
    return measureStartBeats[waitPoint.measure - 1] ?? waitPoint.beat;
  }
  return waitPoint.beat;
}

/**
 * Returns the first wait-point index inside the range and the exclusive end
 * index. Wait points are sorted by (measure, beat), so each measure occupies a
 * contiguous slice; membership is by rendered measure number, which keeps
 * grace notes attached to the measure they render in rather than the previous
 * measure their pre-barline beats fall into.
 */
function rangeBounds(
  points: WaitPoint[],
  range: { from: number; to: number } | null,
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

export function useWaitMode(
  control: ModeControl,
  settings: WaitModeSettings,
): ModeHandle {
  const [active, setActive] = useState(false);
  const [pointIndex, setPointIndex] = useState(0);
  const [completionModal, setCompletionModal] = useState<{
    history: WaitModeAttempt[];
    selectionLabel: string;
    expectedDurationMs: number;
    hash: string;
    selectionKey: string;
  } | null>(null);

  const activeRef = useRef(false);
  const completionModalRef = useRef(completionModal);
  completionModalRef.current = completionModal;
  const pointIndexRef = useRef(0);
  const heldNotesRef = useRef<Set<number>>(new Set());
  // Subset of heldNotesRef: notes the user is currently holding that are NOT
  // part of the expected chord (they each fired the wrong-note path). While any
  // of these is held the chord is not considered cleanly played, so advancing
  // is blocked — this is what stops "mash a fistful of keys" from sliding past
  // a wait point. Legato/sustained notes carried over from a previous chord
  // never enter this set (they generate no fresh Note On), and grace-window
  // forgiven notes are deliberately excluded too.
  const wrongHeldNotesRef = useRef<Set<number>>(new Set());
  // Subset of heldNotesRef: keys that received a *fresh* Note On (a press while
  // the key was not already held) since the last advance. A wait point's
  // required notes must each appear here to complete the chord — merely holding
  // a key over from a previous chord is not enough. This is what forces a
  // repeated note/chord to be re-struck for each occurrence rather than sliding
  // through on a single sustained hold. Tied notes (`tiedNoteNumbers`) are the
  // deliberate exception: they may be held over with no fresh press. Cleared on
  // every advance so each wait point is judged on its own fresh presses.
  const freshlyPressedNotesRef = useRef<Set<number>>(new Set());
  const lastAdvanceTimeRef = useRef(0);
  const wrongNoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrongNoteCountRef = useRef(0);
  const attemptStartTimeRef = useRef<number | null>(null);
  const uninstallCallbacksRef = useRef<(() => void) | null>(null);

  // Mirror live control values to refs so the stable callbacks below can read them.
  const controlRef = useRef(control);
  controlRef.current = control;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Reset for the start of a fresh attempt: clear the live note-matching state
  // (what is held, which held notes are wrong, which have been freshly struck,
  // and the advance clock) and zero the per-attempt scoring tally (wrong-note
  // count + elapsed-time clock). After this the next correct chord advances
  // from a clean slate. Stable (touches only refs) so it can sit in other
  // callbacks' dependency lists without churn.
  const resetAttempt = useCallback(() => {
    heldNotesRef.current.clear();
    wrongHeldNotesRef.current.clear();
    freshlyPressedNotesRef.current.clear();
    lastAdvanceTimeRef.current = 0;
    wrongNoteCountRef.current = 0;
    attemptStartTimeRef.current = null;
  }, []);

  // Wait-point set is keyed off musicxml; rebuild when it changes.
  const waitPoints = useMemo<WaitPoint[]>(() => {
    const musicxml = control.musicxml;
    if (!musicxml) {
      return [];
    }
    return buildWaitPoints(musicxml.notes);
  }, [control.musicxml]);

  const waitPointsRef = useRef(waitPoints);
  waitPointsRef.current = waitPoints;

  // Reset all state whenever the piece changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: musicxml is the trigger
  useEffect(() => {
    uninstallCallbacksRef.current?.();
    uninstallCallbacksRef.current = null;
    setActive(false);
    activeRef.current = false;
    setPointIndex(0);
    pointIndexRef.current = 0;
    setCompletionModal(null);
    resetAttempt();
    if (wrongNoteTimerRef.current !== null) {
      clearTimeout(wrongNoteTimerRef.current);
      wrongNoteTimerRef.current = null;
    }
  }, [control.musicxml]);

  // When the range changes while wait mode is active, restart from range start.
  useEffect(() => {
    if (!activeRef.current) {
      return;
    }
    const ctrl = controlRef.current;
    const measureStartBeats = ctrl.measureStartBeats;
    const points = waitPointsRef.current;
    const { first } = rangeBounds(points, control.measureRange);
    setPointIndex(first);
    pointIndexRef.current = first;
    resetAttempt();

    // Move the cursor and player to the new range start so the user can see
    // what they are about to play.
    let targetBeat: number;
    if (points.length > 0 && first < points.length) {
      targetBeat = waitPointCursorBeat(points[first], measureStartBeats);
    } else {
      const range = control.measureRange;
      targetBeat = range ? (measureStartBeats[range.from - 1] ?? 0) : 0;
    }
    ctrl.setCursor(targetBeat, "jump");
    ctrl.player.seek(targetBeat);
  }, [control.measureRange, resetAttempt]);

  const computedHighlights = useMemo<ReadonlyArray<NoteHighlight>>(() => {
    if (!active || !control.musicxml || waitPoints.length === 0) {
      return [];
    }
    const idx = Math.min(pointIndex, waitPoints.length - 1);
    const targetBeat = waitPoints[idx].beat;
    const tied = waitPoints[idx].tiedNoteNumbers;
    const highlights: NoteHighlight[] = [];
    for (const note of control.musicxml.notes) {
      if (note.startBeat !== targetBeat) {
        continue;
      }
      // Notes freshly attacked at this beat are highlighted; a tied-in note is
      // too (so the held note the user must keep down reads as part of the
      // chord), but any other tie continuation passing through is not.
      if (note.tieStop && !tied.has(note.noteNumber)) {
        continue;
      }
      highlights.push({
        kind: "score",
        id: `p${note.partIndex}-m${note.measureNumber}-n${note.noteIndex}-v${note.voiceIndex}`,
        color: settings.accent,
      });
    }
    return highlights;
  }, [active, control.musicxml, waitPoints, pointIndex, settings.accent]);
  const noteHighlights = useStableHighlights(computedHighlights);

  // Stable: reads only from refs so it never goes stale inside the BLE listener.
  const onNoteEvent = useCallback((noteNumber: number, kind: "on" | "off") => {
    if (!activeRef.current || waitPointsRef.current.length === 0) {
      return;
    }
    if (completionModalRef.current !== null) {
      return;
    }
    const ctrl = controlRef.current;
    const sensitivityMs = settingsRef.current.noteSensitivityMilliseconds;

    const held = heldNotesRef.current;
    const now = Date.now();
    const msSinceAdvance = now - lastAdvanceTimeRef.current;

    // Whether this key was already physically down before this event. A Note On
    // for an already-held key is a duplicate event (no intervening Note Off),
    // not a fresh key press — see the wrong-note branch below.
    const alreadyHeld = kind === "on" && held.has(noteNumber);

    if (kind === "on") {
      held.add(noteNumber);
      // A genuine fresh attack (the key was not already down). Duplicate Note
      // Ons for an already-held key are not fresh presses, so they never make a
      // held-over note count toward a repeated chord.
      if (!alreadyHeld) {
        freshlyPressedNotesRef.current.add(noteNumber);
      }
      if (attemptStartTimeRef.current === null) {
        attemptStartTimeRef.current = now;
      }
    } else {
      held.delete(noteNumber);
      wrongHeldNotesRef.current.delete(noteNumber);
      freshlyPressedNotesRef.current.delete(noteNumber);
      const points = waitPointsRef.current;
      const idx = pointIndexRef.current;
      const { end } = rangeBounds(points, ctrl.measureRange);
      const wp = idx < end ? points[idx] : null;
      const offBeat = wp?.beat ?? -1;
      ctrl.appendToDebugLog({
        mode: "wait",
        t: now,
        note: noteNumber,
        kind: "off",
        pointIndex: idx,
        measure: wp?.measure ?? -1,
        beat: offBeat,
        expected: wp ? [...wp.noteNumbers, ...wp.tiedNoteNumbers] : [],
        fresh: [...freshlyPressedNotesRef.current],
        held: [...held],
        msSinceAdvance,
        outcome: "off",
      });
      return;
    }

    const points = waitPointsRef.current;
    const idx = pointIndexRef.current;
    const { first, end } = rangeBounds(points, ctrl.measureRange);

    if (idx >= end) {
      return;
    }

    const wp = points[idx];
    const expected = wp.noteNumbers;
    // Tied notes must still be sounding for the chord to be complete, but a
    // still-held one needs no fresh press. Re-pressing one (after letting it go)
    // is allowed, so it counts as an accepted note alongside the required ones.
    const tied = wp.tiedNoteNumbers;
    const beat = wp.beat;
    const measure = wp.measure;
    const heldSnapshot = [...held];
    // Log the full requirement (fresh-attack notes plus tied-in held notes) so a
    // chord that won't advance because a released tie is missing is diagnosable.
    const expectedSnapshot = [...expected, ...tied];
    const debugBase: Omit<WaitModeDebugEvent, "outcome"> = {
      mode: "wait",
      t: now,
      note: noteNumber,
      kind: "on",
      pointIndex: idx,
      measure,
      beat,
      expected: expectedSnapshot,
      fresh: [...freshlyPressedNotesRef.current],
      held: heldSnapshot,
      msSinceAdvance,
    };

    if (!expected.has(noteNumber) && !tied.has(noteNumber)) {
      // Slashed grace notes attached to this wait point are optional: playing
      // them is permitted and carries no penalty, but they are not required.
      if (wp.optionalNoteNumbers.has(noteNumber)) {
        ctrl.appendToDebugLog({ ...debugBase, outcome: "optional" });
        return;
      }
      // When at a non-slashed grace wait point, notes belonging to the next
      // wait point are "anticipated" — the player naturally presses grace and
      // main-chord keys in one physical gesture and must not be penalised for
      // it. If the grace chord is already complete (e.g. the grace note was
      // debounced on an earlier tick and sits in fresh), also advance now so
      // both wait points resolve in a single gesture.
      if (wp.isGrace && !alreadyHeld) {
        const anticipationIdx = idx + 1;
        if (anticipationIdx < end) {
          const anticipatedWp = points[anticipationIdx];
          if (
            anticipatedWp.noteNumbers.has(noteNumber) ||
            anticipatedWp.optionalNoteNumbers.has(noteNumber) ||
            anticipatedWp.tiedNoteNumbers.has(noteNumber)
          ) {
            const currentFresh = freshlyPressedNotesRef.current;
            const graceComplete =
              [...expected].every((n) => held.has(n) && currentFresh.has(n)) &&
              [...tied].every((n) => held.has(n)) &&
              wrongHeldNotesRef.current.size === 0;
            if (graceComplete) {
              lastAdvanceTimeRef.current = now;
              const savedFresh = new Set(currentFresh);
              freshlyPressedNotesRef.current.clear();
              for (const nextNoteNumber of anticipatedWp.noteNumbers) {
                if (savedFresh.has(nextNoteNumber)) {
                  freshlyPressedNotesRef.current.add(nextNoteNumber);
                }
              }
              if (anticipationIdx >= end) {
                const startTime = attemptStartTimeRef.current;
                if (startTime !== null) {
                  recordCompletion({
                    wrongNotes: wrongNoteCountRef.current,
                    elapsedMs: now - startTime,
                    totalPoints: end - first,
                  });
                }
                wrongNoteCountRef.current = 0;
                attemptStartTimeRef.current = null;
                pointIndexRef.current = first;
                setPointIndex(first);
                const targetBeat = waitPointCursorBeat(
                  points[first],
                  ctrl.measureStartBeats,
                );
                ctrl.setCursor(targetBeat, "jump");
                ctrl.player.seek(targetBeat);
              } else {
                pointIndexRef.current = anticipationIdx;
                setPointIndex(anticipationIdx);
                const targetBeat = waitPointCursorBeat(
                  anticipatedWp,
                  ctrl.measureStartBeats,
                );
                ctrl.setCursor(targetBeat, "jump");
                ctrl.player.seek(targetBeat);
              }
              ctrl.appendToDebugLog({ ...debugBase, outcome: "advance" });
            } else {
              ctrl.appendToDebugLog({ ...debugBase, outcome: "optional" });
            }
            return;
          }
        }
      }
      // A Note On for a key that was already held is a duplicate event, not a
      // fresh wrong key press: some instruments re-send Note On for
      // sustained/pedalled notes, and the tail of a rolled chord re-articulates
      // tones that are still down. Such a note must NOT enter wrongHeldNotesRef
      // — otherwise an upper-chord tone the user is holding across consecutive
      // wait points would block the next advance even though no new wrong key
      // was ever pressed. (You physically cannot press an already-down key, so
      // a fresh wrong press always arrives as a Note On while NOT already held.)
      if (alreadyHeld) {
        ctrl.appendToDebugLog({ ...debugBase, outcome: "duplicate" });
        return;
      }
      // Any non-expected note the user is holding blocks the advance (see the
      // wrongHeldNotesRef check below) — this is what makes mashing fail. We
      // record it even inside the grace window, because otherwise a wrong key
      // mashed within `sensitivityMs` of the previous advance would be
      // forgiven and the correct key alongside it would slide straight past.
      // The grace window only suppresses the *audible* wrong-note feedback, so
      // a near-simultaneous fumble around a transition isn't punished twice.
      wrongHeldNotesRef.current.add(noteNumber);
      if (msSinceAdvance < sensitivityMs) {
        ctrl.appendToDebugLog({ ...debugBase, outcome: "grace" });
        return;
      }
      wrongNoteCountRef.current += 1;
      // Channel 9 = GM percussion; note 42 = Closed Hi-Hat
      ctrl.bluetooth.sendNote(42, 55, 80, 9);
      if (wrongNoteTimerRef.current !== null) {
        clearTimeout(wrongNoteTimerRef.current);
      }
      wrongNoteTimerRef.current = setTimeout(() => {
        wrongNoteTimerRef.current = null;
      }, 600);
      ctrl.appendToDebugLog({ ...debugBase, outcome: "wrong" });
      return;
    }

    // Check chord completion before debounce: if every expected note has been
    // freshly attacked (and any slashed grace that pre-fills a required note
    // counts, since a folded grace press carries no intervening advance), the
    // chord is unambiguously complete and should advance immediately even
    // within the debounce window. Only debounce when the chord is still
    // incomplete, to prevent a leftover key from the previous chord from
    // accidentally triggering a premature advance. Required notes must be
    // *freshly pressed* — a key merely held over from the previous chord does
    // not satisfy a repeated note/chord, so each occurrence must be re-struck.
    // Tied notes are the exception: they only need to remain held (or be
    // pressed again).
    const fresh = freshlyPressedNotesRef.current;
    const chordComplete =
      [...expected].every((n) => held.has(n) && fresh.has(n)) &&
      [...tied].every((n) => held.has(n));

    if (!chordComplete && msSinceAdvance < 50) {
      ctrl.appendToDebugLog({ ...debugBase, outcome: "debounce" });
      return;
    }

    // Even with every expected note down, refuse to advance while the user is
    // also holding wrong notes. Without this, mashing a handful of keys that
    // happens to include the right ones would slide past the wait point. The
    // user must release the extra keys (the chord then advances on the next
    // press of the expected notes).
    if (chordComplete && wrongHeldNotesRef.current.size > 0) {
      ctrl.appendToDebugLog({ ...debugBase, outcome: "extra" });
      return;
    }

    if (chordComplete) {
      lastAdvanceTimeRef.current = now;
      const nextIdx = idx + 1;
      // When advancing from a non-slashed grace wait point, capture the notes
      // pressed in this gesture before clearing so they can be retroactively
      // credited as fresh presses for the next wait point. Players press grace
      // and main-chord keys in one gesture; requiring a re-press of
      // already-held main-chord notes after the grace advances is awkward.
      const graceAnticipatedFresh =
        wp.isGrace && nextIdx < end
          ? new Set(freshlyPressedNotesRef.current)
          : null;
      // Each wait point is judged on its own fresh presses; reset the tally so
      // notes still held into the next chord must be struck again to count.
      freshlyPressedNotesRef.current.clear();
      if (graceAnticipatedFresh !== null) {
        const nextWp = points[nextIdx];
        for (const nextNoteNumber of nextWp.noteNumbers) {
          if (graceAnticipatedFresh.has(nextNoteNumber)) {
            freshlyPressedNotesRef.current.add(nextNoteNumber);
          }
        }
      }
      if (nextIdx >= end) {
        // Attempt complete — compute score, persist, show modal.
        const startTime = attemptStartTimeRef.current;
        if (startTime !== null) {
          recordCompletion({
            wrongNotes: wrongNoteCountRef.current,
            elapsedMs: now - startTime,
            totalPoints: end - first,
          });
        }
        wrongNoteCountRef.current = 0;
        attemptStartTimeRef.current = null;
        pointIndexRef.current = first;
        setPointIndex(first);
        const targetBeat = waitPointCursorBeat(
          points[first],
          ctrl.measureStartBeats,
        );
        ctrl.setCursor(targetBeat, "jump");
        ctrl.player.seek(targetBeat);
      } else {
        pointIndexRef.current = nextIdx;
        setPointIndex(nextIdx);
        const targetBeat = waitPointCursorBeat(
          points[nextIdx],
          ctrl.measureStartBeats,
        );
        ctrl.setCursor(targetBeat, "jump");
        ctrl.player.seek(targetBeat);
      }
      ctrl.appendToDebugLog({ ...debugBase, outcome: "advance" });
    } else {
      // Distinguish "not all notes down yet" (incomplete) from "every note is
      // down but a required one was held over rather than re-struck" (stale).
      // The latter is the signature of a repeated note/chord that needs a fresh
      // attack — without its own outcome it would read as a baffling INCOMPLETE
      // with expected ⊆ held.
      const heldComplete =
        [...expected].every((n) => held.has(n)) &&
        [...tied].every((n) => held.has(n));
      ctrl.appendToDebugLog({
        ...debugBase,
        outcome: heldComplete ? "stale" : "incomplete",
      });
    }
  }, []);

  function recordCompletion(stats: {
    wrongNotes: number;
    elapsedMs: number;
    totalPoints: number;
  }) {
    const ctrl = controlRef.current;
    const hash = ctrl.fileHash;
    const mx = ctrl.musicxml;
    if (!hash || !mx) {
      return;
    }
    const range = ctrl.measureRange;
    const selectionKey = range ? `m${range.from}-m${range.to}` : "full";
    const measureStartBeats = ctrl.measureStartBeats;
    const selectionBeats = range
      ? (measureStartBeats[range.to] ?? mx.totalBeats) -
        (measureStartBeats[range.from - 1] ?? 0)
      : mx.totalBeats;
    const bpm = settingsRef.current.bpm;
    const expectedDurationMs = bpm > 0 ? (selectionBeats / bpm) * 60_000 : 0;

    const accuracy =
      stats.totalPoints > 0
        ? Math.max(0, 1 - stats.wrongNotes / stats.totalPoints)
        : 1;
    const tempo =
      expectedDurationMs > 0
        ? Math.min(1, expectedDurationMs / stats.elapsedMs)
        : 1;
    const score = Math.round(0.7 * accuracy * 100 + 0.3 * tempo * 100);

    const attempt: WaitModeAttempt = {
      timestamp: Date.now(),
      wrongNotes: stats.wrongNotes,
      elapsedMs: stats.elapsedMs,
      score,
    };
    saveAttempt(hash, selectionKey, attempt);
    const allAttempts = loadAttemptHistory(hash)[selectionKey] ?? [];

    const selectionLabel = range
      ? range.from === range.to
        ? `Measure ${range.from}`
        : `Measures ${range.from}–${range.to}`
      : "Full piece";

    setCompletionModal({
      history: allAttempts,
      selectionLabel,
      expectedDurationMs,
      hash,
      selectionKey,
    });
  }

  const activate = useCallback(() => {
    if (activeRef.current) {
      return;
    }
    const ctrl = controlRef.current;
    const points = waitPointsRef.current;
    const range = ctrl.measureRange;
    const measureStartBeats = ctrl.measureStartBeats;
    const { first } = rangeBounds(points, range);

    // Pick start point: range start if a range is active, else nearest wait
    // point at or before the current cursor.
    let startIdx: number;
    if (range) {
      startIdx = first;
    } else {
      startIdx = 0;
      const currentBeat = ctrl.currentBeatRef.current;
      for (let i = 0; i < points.length; i++) {
        if (points[i].beat <= currentBeat) {
          startIdx = i;
        } else {
          break;
        }
      }
      // The cursor-based loop above lands on the main chord nearest the cursor.
      // Walk back to the first grace note for that chord so the user starts
      // from the grace notes, not the main chord. Grace notes are sorted
      // immediately before their main chord (same measure), so they form a
      // contiguous run here.
      while (startIdx > 0 && points[startIdx - 1].isGrace) {
        startIdx -= 1;
      }
    }

    // Stop playback, snap cursor / player to the start point.
    ctrl.player.pause();
    ctrl.setIsPlaying(false);
    const startBeat =
      points.length > 0
        ? waitPointCursorBeat(points[startIdx], measureStartBeats)
        : range
          ? (measureStartBeats[range.from - 1] ?? 0)
          : 0;
    ctrl.player.seek(startBeat);
    ctrl.setCursor(startBeat, "jump");

    setPointIndex(startIdx);
    pointIndexRef.current = startIdx;
    resetAttempt();

    // Suppress any cursor updates from the player while wait mode owns the cursor.
    uninstallCallbacksRef.current?.();
    uninstallCallbacksRef.current = ctrl.player.installCallbacks({
      onPositionUpdate: () => {},
    });

    setActive(true);
    activeRef.current = true;
  }, [resetAttempt]);

  const deactivate = useCallback(() => {
    uninstallCallbacksRef.current?.();
    uninstallCallbacksRef.current = null;
    setActive(false);
    activeRef.current = false;
  }, []);

  const handlePlayPause = useCallback(() => {
    // Wait mode is driven by note input, not the transport.
  }, []);

  const handleReset = useCallback(() => {
    const ctrl = controlRef.current;
    const { first } = rangeBounds(waitPointsRef.current, ctrl.measureRange);
    setPointIndex(first);
    pointIndexRef.current = first;
    resetAttempt();
    const points = waitPointsRef.current;
    if (points.length > 0 && first < points.length) {
      const targetBeat = waitPointCursorBeat(
        points[first],
        ctrl.measureStartBeats,
      );
      ctrl.setCursor(targetBeat, "jump");
      ctrl.player.seek(targetBeat);
    }
  }, [resetAttempt]);

  const handleSeek = useCallback(
    (beat: number) => {
      const ctrl = controlRef.current;
      const points = waitPointsRef.current;
      const { first, end } = rangeBounds(points, ctrl.measureRange);
      let idx = first;
      for (let i = first; i < end; i++) {
        if (points[i].beat > beat) {
          break;
        }
        idx = i;
      }
      setPointIndex(idx);
      pointIndexRef.current = idx;
      // A seek starts a fresh attempt from the new position: reset both the
      // live matching state and the per-attempt scoring tally.
      resetAttempt();
      ctrl.setCursor(beat, "jump");
    },
    [resetAttempt],
  );

  const modal = completionModal
    ? (() => {
        const history = completionModal.history;
        const latest = history[history.length - 1];
        const rows: ResultRow[] = history
          .slice()
          .reverse()
          .slice(0, 10)
          .map((a) => ({
            key: a.timestamp,
            isLatest: a.timestamp === latest?.timestamp,
            when: formatDate(a.timestamp),
            cells: [
              <span
                key="wrong"
                style={{
                  fontSize: 12,
                  color: settings.theme.ink,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {a.wrongNotes}
              </span>,
              <ScoreChip key="score" score={a.score ?? 0} />,
            ],
          }));
        return (
          <ResultModal
            theme={settings.theme}
            accent={settings.accent}
            selectionLabel={completionModal.selectionLabel}
            latest={
              latest
                ? {
                    score: latest.score,
                    stats: [
                      {
                        label: "Wrong notes",
                        value: String(latest.wrongNotes),
                      },
                      { label: "Time", value: formatTime(latest.elapsedMs) },
                      {
                        label: "Expected",
                        value: formatTime(completionModal.expectedDurationMs),
                      },
                    ],
                  }
                : null
            }
            history={{
              label: "Attempts",
              gridTemplate: "1fr 72px 52px",
              columns: ["When", "Wrong", "Score"],
              rows,
            }}
            onClose={() => setCompletionModal(null)}
            onDeleteRow={(key) => {
              const updatedHistory = deleteAttempt(
                completionModal.hash,
                completionModal.selectionKey,
                key as number,
              );
              if (updatedHistory.length === 0) {
                setCompletionModal(null);
              } else {
                setCompletionModal({
                  ...completionModal,
                  history: updatedHistory,
                });
              }
            }}
            onClearRows={() => {
              clearAttempts(completionModal.hash, completionModal.selectionKey);
              setCompletionModal(null);
            }}
          />
        );
      })()
    : null;

  return {
    noteHighlights,
    activeRef,
    onNoteEvent,
    activate,
    deactivate,
    handlePlayPause,
    handleReset,
    handleSeek,
    overlay: null,
    modal,
  };
}
