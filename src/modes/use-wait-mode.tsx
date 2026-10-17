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
import {
  type WaitModeAttempt,
  clearAttempts,
  deleteAttempt,
  loadAttemptHistory,
  saveAttempt,
} from "../hooks/use-file-history";
import { color, colorValue } from "../theme";
import { playbackNoteId } from "../../lib/musicxml/musicxml-playback";
import type { WaitModeDebugEvent } from "../debug-log";
import {
  selectionEndBeat,
  selectionKeyForRange,
  selectionLabelForRange,
  selectionStartBeat,
} from "../selection";
import type { ModeControl, ModeHandle, NoteHighlight } from "./mode-control";
import { useStableHighlights } from "./note-colors";
import {
  type WaitPoint,
  buildWaitPoints,
  initialKeyPressState,
  expectedDurationMilliseconds,
  judgeKeyPress,
  pointIndexAtBeat,
  rangeBounds,
  releaseKey,
  scoreAttempt,
  startingPointIndex,
  waitPointCursorBeat,
} from "./wait-matching";

export type { DebugBeatEvent } from "../debug-log";

export interface WaitModeSettings {
  noteSensitivityMilliseconds: number;
  /** The piece's own default tempo — used to compute expected attempt duration for scoring, independent of any BPM the user dialed in for listen/playalong. */
  baseBpm: number;
}

function formatTime(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
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
  // Which keys are down, which of them are wrong or freshly struck, and when
  // the last advance was: the input to the pure matching rules in
  // `wait-matching.ts`, replaced wholesale after every note event.
  const keyPressStateRef = useRef(initialKeyPressState());
  const wrongNoteCountRef = useRef(0);
  const attemptStartTimeRef = useRef<number | null>(null);
  const uninstallCallbacksRef = useRef<(() => void) | null>(null);
  // The `measureRange` value that `pointIndex`/the live attempt state was last
  // reset for. `applyRangeReset` below is idempotent against this: it only
  // resets once per actual range change, however many times (or however late)
  // it's called. This guards against a real race — `useEffect`s in
  // Preact/React flush asynchronously, so a note arriving (via the BLE/MIDI
  // listener, which fires outside React's render cycle) in the gap between a
  // range change committing and its effect actually running would otherwise
  // be judged against the stale pre-change wait point, and the effect's later
  // flush would then silently overwrite whatever genuine progress that note
  // produced. Calling `applyRangeReset` synchronously from `onNoteEvent`
  // itself (in addition to the effect, for the cursor-snap side effect when
  // no note arrives) closes that gap entirely.
  const appliedRangeRef = useRef<{ from: number; to: number } | null>(null);

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
    keyPressStateRef.current = initialKeyPressState();
    wrongNoteCountRef.current = 0;
    attemptStartTimeRef.current = null;
  }, []);

  // Move pointIndex/cursor/player to wait point `index` — or, if `index` is
  // past the last point (e.g. an empty piece), to the selection start beat.
  // Consolidates the "jump to a wait point" sequence that recurs at every
  // advance, activation, range reset, and manual reset. Does not touch the
  // live note-matching state (keyPressStateRef) — callers that need a fresh
  // attempt call `resetAttempt` themselves; the grace-anticipation advance
  // deliberately carries some of that state forward instead of resetting it.
  const jumpToPoint = useCallback((index: number) => {
    const ctrl = controlRef.current;
    const points = waitPointsRef.current;
    setPointIndex(index);
    pointIndexRef.current = index;
    const targetBeat =
      points.length > 0 && index < points.length
        ? waitPointCursorBeat(points[index], ctrl.measureStartBeats)
        : selectionStartBeat(ctrl.measureRange, ctrl.measureStartBeats);
    ctrl.setCursor(targetBeat, "jump");
    ctrl.player.seek(targetBeat);
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
    appliedRangeRef.current = controlRef.current.measureRange;
    setCompletionModal(null);
    resetAttempt();
  }, [control.musicxml]);

  // Restart from range start when the active range actually changes. Guarded
  // by `appliedRangeRef` so it is safe to call from both the effect below
  // (which only covers the "no note arrives" case — see `onNoteEvent`, which
  // calls this synchronously first) and to call more than once for the same
  // range without clobbering progress already made under that range.
  const applyRangeReset = useCallback(() => {
    const ctrl = controlRef.current;
    const range = ctrl.measureRange;
    if (appliedRangeRef.current === range) {
      return;
    }
    appliedRangeRef.current = range;
    const points = waitPointsRef.current;
    const { first } = rangeBounds(points, range);
    resetAttempt();
    // Move the cursor and player to the new range start so the user can see
    // what they are about to play.
    jumpToPoint(first);
  }, [resetAttempt, jumpToPoint]);

  // When the range changes while wait mode is active, restart from range
  // start. This effect alone is not enough to be race-free — see
  // `applyRangeReset`'s call inside `onNoteEvent` for why.
  // biome-ignore lint/correctness/useExhaustiveDependencies: control.measureRange is the trigger; applyRangeReset reads the live value via controlRef
  useEffect(() => {
    if (!activeRef.current) {
      return;
    }
    applyRangeReset();
  }, [control.measureRange, applyRangeReset]);

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
        id: playbackNoteId(note),
        color: colorValue.accent,
      });
    }
    return highlights;
  }, [active, control.musicxml, waitPoints, pointIndex]);
  const noteHighlights = useStableHighlights(computedHighlights);

  // Stable: reads only from refs so it never goes stale inside the BLE listener.
  const onNoteEvent = useCallback(
    (noteNumber: number, kind: "on" | "off") => {
      if (!activeRef.current || waitPointsRef.current.length === 0) {
        return;
      }
      // Apply any pending range-change reset before judging this note — see
      // `applyRangeReset`'s comment for why this can't wait for the effect.
      applyRangeReset();
      const keys = keyPressStateRef.current;
      const ctrl = controlRef.current;
      const points = waitPointsRef.current;
      const { first, end } = rangeBounds(points, ctrl.measureRange);
      const pointIndex = pointIndexRef.current;
      const now = Date.now();
      const waitPoint = pointIndex < end ? points[pointIndex] : null;
      const logEvent = (
        outcome: WaitModeDebugEvent["outcome"],
        held: number[],
        fresh: number[],
      ) =>
        ctrl.appendToDebugLog({
          mode: "wait",
          t: now,
          note: noteNumber,
          kind,
          pointIndex,
          measure: waitPoint?.measure ?? -1,
          beat: waitPoint?.beat ?? -1,
          // The full requirement (fresh-attack notes plus tied-in held
          // notes), so a chord that won't advance because a released tie is
          // missing is diagnosable.
          expected: waitPoint
            ? [...waitPoint.noteNumbers, ...waitPoint.tiedNoteNumbers]
            : [],
          fresh,
          held,
          msSinceAdvance: now - keys.lastAdvanceTime,
          outcome,
        });

      if (kind === "off") {
        const released = releaseKey(keys, noteNumber);
        keyPressStateRef.current = released;
        // A release is still tracked while the result modal is up: otherwise
        // a chord let go after it completes (e.g. the final chord of the
        // piece) would read as already held at the start of the next
        // playthrough. It is only logged outside the modal, like a press.
        if (completionModalRef.current === null) {
          logEvent("off", [...released.held], [...released.fresh]);
        }
        return;
      }
      // The modal blocks new chord matching.
      if (completionModalRef.current !== null) {
        return;
      }
      const judgment = judgeKeyPress(
        keys,
        { noteNumber, time: now },
        { points, pointIndex, end },
        settingsRef.current.noteSensitivityMilliseconds,
      );
      keyPressStateRef.current = judgment.keys;
      if (attemptStartTimeRef.current === null) {
        attemptStartTimeRef.current = now;
      }
      if (judgment.outcome === null) {
        return;
      }
      logEvent(
        judgment.outcome,
        judgment.heldWhenJudged,
        judgment.freshWhenJudged,
      );

      if (judgment.outcome === "wrong") {
        wrongNoteCountRef.current += 1;
        ctrl.piano.playHiHat(55);
      }
      if (judgment.advanceTo === undefined) {
        return;
      }
      if (judgment.advanceTo < end) {
        jumpToPoint(judgment.advanceTo);
        return;
      }
      // The last wait point of the range: the attempt is complete — compute
      // the score, persist it, show the modal, and go back to the start.
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
      jumpToPoint(first);
    },
    [applyRangeReset, jumpToPoint],
  );

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
    const selectionKey = selectionKeyForRange(range);
    const measureStartBeats = ctrl.measureStartBeats;
    const selectionBeats =
      selectionEndBeat(range, measureStartBeats, mx.totalBeats) -
      selectionStartBeat(range, measureStartBeats);
    const expectedDurationMs = expectedDurationMilliseconds(
      selectionBeats,
      settingsRef.current.baseBpm,
    );
    const score = scoreAttempt({
      wrongNotes: stats.wrongNotes,
      elapsedMilliseconds: stats.elapsedMs,
      waitPointCount: stats.totalPoints,
      expectedDurationMilliseconds: expectedDurationMs,
    });

    const attempt: WaitModeAttempt = {
      timestamp: Date.now(),
      wrongNotes: stats.wrongNotes,
      elapsedMs: stats.elapsedMs,
      score,
    };
    saveAttempt(hash, selectionKey, attempt);
    const allAttempts = loadAttemptHistory(hash)[selectionKey] ?? [];

    const selectionLabel = selectionLabelForRange(range);

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
    const startIndex = startingPointIndex(
      points,
      range,
      ctrl.currentBeatRef.current,
    );

    // Stop playback, snap cursor / player to the start point.
    ctrl.player.pause();
    ctrl.setIsPlaying(false);
    jumpToPoint(startIndex);
    appliedRangeRef.current = range;
    resetAttempt();

    // Suppress any cursor updates from the player while wait mode owns the cursor.
    uninstallCallbacksRef.current?.();
    uninstallCallbacksRef.current = ctrl.player.installCallbacks({
      onPositionUpdate: () => {},
    });

    setActive(true);
    activeRef.current = true;
  }, [resetAttempt, jumpToPoint]);

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
    appliedRangeRef.current = ctrl.measureRange;
    resetAttempt();
    jumpToPoint(first);
  }, [resetAttempt, jumpToPoint]);

  const handleSeek = useCallback(
    (beat: number) => {
      const ctrl = controlRef.current;
      const index = pointIndexAtBeat(
        waitPointsRef.current,
        ctrl.measureRange,
        beat,
      );
      setPointIndex(index);
      pointIndexRef.current = index;
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
                  color: color.ink,
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
            previousRange={control.rangeNavigation.previous}
            nextRange={control.rangeNavigation.next}
            onNavigateToRange={(range) => {
              setCompletionModal(null);
              control.rangeNavigation.goTo(range);
            }}
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
