import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import {
  formatDate,
  ResultModal,
  type ResultRow,
  ScoreChip,
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
import type { ModeControl, ModeHandle, NoteHighlight } from "./mode-control";
import { useStableHighlights } from "./note-colors";

export type { DebugBeatEvent } from "../debug-log";

interface WaitPoint {
  beat: number;
  noteNumbers: Set<number>;
}

export interface WaitModeSettings {
  noteSensitivityMilliseconds: number;
  /** Current BPM — used to compute expected attempt duration for scoring. */
  bpm: number;
  accent: string;
  theme: ThemeTokens;
}

function formatTime(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Returns the first wait-point index inside the range and the exclusive end index. */
function rangeBounds(
  points: WaitPoint[],
  range: { from: number; to: number } | null,
  measureStartBeats: number[],
  totalBeats: number,
): { first: number; end: number } {
  if (!range) {
    return { first: 0, end: points.length };
  }
  const startBeat = measureStartBeats[range.from - 1] ?? 0;
  const endBeat = measureStartBeats[range.to] ?? totalBeats;

  let first = points.findIndex((p) => p.beat >= startBeat);
  if (first === -1) {
    first = points.length;
  }
  let end = points.findIndex((p) => p.beat >= endBeat);
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

  // Wait-point set is keyed off musicxml; rebuild when it changes.
  const waitPoints = useMemo<WaitPoint[]>(() => {
    const musicxml = control.musicxml;
    if (!musicxml) {
      return [];
    }
    const beatMap = new Map<number, Set<number>>();
    for (const note of musicxml.notes) {
      if (note.tieStop || note.isGrace) {
        continue;
      }
      const existing = beatMap.get(note.startBeat);
      if (existing) {
        existing.add(note.noteNumber);
      } else {
        beatMap.set(note.startBeat, new Set([note.noteNumber]));
      }
    }
    return Array.from(beatMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([beat, noteNumbers]) => ({ beat, noteNumbers }));
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
    heldNotesRef.current.clear();
    lastAdvanceTimeRef.current = 0;
    wrongNoteCountRef.current = 0;
    attemptStartTimeRef.current = null;
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
    const totalBeats = ctrl.musicxml?.totalBeats ?? 0;
    const points = waitPointsRef.current;
    const { first } = rangeBounds(
      points,
      control.measureRange,
      measureStartBeats,
      totalBeats,
    );
    setPointIndex(first);
    pointIndexRef.current = first;
    heldNotesRef.current.clear();
    lastAdvanceTimeRef.current = 0;
    wrongNoteCountRef.current = 0;
    attemptStartTimeRef.current = null;

    // Move the cursor and player to the new range start so the user can see
    // what they are about to play.
    let targetBeat: number;
    if (points.length > 0 && first < points.length) {
      targetBeat = points[first].beat;
    } else {
      const range = control.measureRange;
      targetBeat = range ? (measureStartBeats[range.from - 1] ?? 0) : 0;
    }
    ctrl.setCursor(targetBeat, "jump");
    ctrl.player.seek(targetBeat);
  }, [control.measureRange]);

  const computedHighlights = useMemo<ReadonlyArray<NoteHighlight>>(() => {
    if (!active || !control.musicxml || waitPoints.length === 0) {
      return [];
    }
    const idx = Math.min(pointIndex, waitPoints.length - 1);
    const targetBeat = waitPoints[idx].beat;
    const highlights: NoteHighlight[] = [];
    for (const note of control.musicxml.notes) {
      if (!note.tieStop && note.startBeat === targetBeat) {
        highlights.push({
          kind: "score",
          id: `p${note.partIndex}-m${note.measureNumber}-n${note.noteIndex}-v${note.voiceIndex}`,
          color: settings.accent,
        });
      }
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
    const tSig = ctrl.musicxml?.timeSigNum ?? 4; // used only for approximate debug-log measure numbers
    const measureStartBeats = ctrl.measureStartBeats;
    const totalBeats = ctrl.musicxml?.totalBeats ?? 0;
    const sensitivityMs = settingsRef.current.noteSensitivityMilliseconds;

    const held = heldNotesRef.current;
    const now = Date.now();
    const msSinceAdvance = now - lastAdvanceTimeRef.current;

    if (kind === "on") {
      held.add(noteNumber);
      if (attemptStartTimeRef.current === null) {
        attemptStartTimeRef.current = now;
      }
    } else {
      held.delete(noteNumber);
      const points = waitPointsRef.current;
      const idx = pointIndexRef.current;
      const { end } = rangeBounds(
        points,
        ctrl.measureRange,
        measureStartBeats,
        totalBeats,
      );
      const wp = idx < end ? points[idx] : null;
      const offBeat = wp?.beat ?? -1;
      ctrl.appendToDebugLog({
        mode: "wait",
        t: now,
        note: noteNumber,
        kind: "off",
        pointIndex: idx,
        measure: offBeat >= 0 ? Math.floor(offBeat / tSig) + 1 : -1,
        beat: offBeat,
        expected: wp ? [...wp.noteNumbers] : [],
        held: [...held],
        msSinceAdvance,
        outcome: "off",
      });
      return;
    }

    const points = waitPointsRef.current;
    const idx = pointIndexRef.current;
    const { first, end } = rangeBounds(
      points,
      ctrl.measureRange,
      measureStartBeats,
      totalBeats,
    );

    if (idx >= end) {
      return;
    }

    const wp = points[idx];
    const expected = wp.noteNumbers;
    const beat = wp.beat;
    const measure = Math.floor(beat / tSig) + 1;
    const heldSnapshot = [...held];
    const expectedSnapshot = [...expected];
    const debugBase: Omit<WaitModeDebugEvent, "outcome"> = {
      mode: "wait",
      t: now,
      note: noteNumber,
      kind: "on",
      pointIndex: idx,
      measure,
      beat,
      expected: expectedSnapshot,
      held: heldSnapshot,
      msSinceAdvance,
    };

    if (!expected.has(noteNumber) && msSinceAdvance < sensitivityMs) {
      ctrl.appendToDebugLog({ ...debugBase, outcome: "grace" });
      return;
    }

    if (!expected.has(noteNumber)) {
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

    // Check chord completion before debounce: if every expected note is already
    // held (e.g. a grace note pre-filled one of them), the chord is
    // unambiguously complete and should advance immediately even within the
    // debounce window. Only debounce when the chord is still incomplete, to
    // prevent a leftover key from the previous chord from accidentally
    // triggering a premature advance.
    const chordComplete = [...expected].every((n) => held.has(n));

    if (!chordComplete && msSinceAdvance < 50) {
      ctrl.appendToDebugLog({ ...debugBase, outcome: "debounce" });
      return;
    }

    if (chordComplete) {
      lastAdvanceTimeRef.current = now;
      const nextIdx = idx + 1;
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
        const targetBeat = points[first].beat;
        ctrl.setCursor(targetBeat, "jump");
        ctrl.player.seek(targetBeat);
      } else {
        pointIndexRef.current = nextIdx;
        setPointIndex(nextIdx);
        const targetBeat = points[nextIdx].beat;
        ctrl.setCursor(targetBeat, "jump");
        ctrl.player.seek(targetBeat);
      }
      ctrl.appendToDebugLog({ ...debugBase, outcome: "advance" });
    } else {
      ctrl.appendToDebugLog({ ...debugBase, outcome: "incomplete" });
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
    const totalBeats = ctrl.musicxml?.totalBeats ?? 0;
    const { first } = rangeBounds(points, range, measureStartBeats, totalBeats);

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
    }

    // Stop playback, snap cursor / player to the start point.
    ctrl.player.pause();
    ctrl.setIsPlaying(false);
    const startBeat =
      points.length > 0
        ? points[startIdx].beat
        : range
          ? (measureStartBeats[range.from - 1] ?? 0)
          : 0;
    ctrl.player.seek(startBeat);
    ctrl.setCursor(startBeat, "jump");

    setPointIndex(startIdx);
    pointIndexRef.current = startIdx;
    heldNotesRef.current.clear();
    lastAdvanceTimeRef.current = 0;
    wrongNoteCountRef.current = 0;
    attemptStartTimeRef.current = null;

    // Suppress any cursor updates from the player while wait mode owns the cursor.
    uninstallCallbacksRef.current?.();
    uninstallCallbacksRef.current = ctrl.player.installCallbacks({
      onPositionUpdate: () => {},
    });

    setActive(true);
    activeRef.current = true;
  }, []);

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
    const measureStartBeats = ctrl.measureStartBeats;
    const totalBeats = ctrl.musicxml?.totalBeats ?? 0;
    const { first } = rangeBounds(
      waitPointsRef.current,
      ctrl.measureRange,
      measureStartBeats,
      totalBeats,
    );
    setPointIndex(first);
    pointIndexRef.current = first;
    heldNotesRef.current.clear();
    lastAdvanceTimeRef.current = 0;
    wrongNoteCountRef.current = 0;
    attemptStartTimeRef.current = null;
    const points = waitPointsRef.current;
    if (points.length > 0 && first < points.length) {
      const targetBeat = points[first].beat;
      ctrl.setCursor(targetBeat, "jump");
      ctrl.player.seek(targetBeat);
    }
  }, []);

  const handleSeek = useCallback((beat: number) => {
    const ctrl = controlRef.current;
    const measureStartBeats = ctrl.measureStartBeats;
    const totalBeats = ctrl.musicxml?.totalBeats ?? 0;
    const points = waitPointsRef.current;
    const { first, end } = rangeBounds(
      points,
      ctrl.measureRange,
      measureStartBeats,
      totalBeats,
    );
    let idx = first;
    for (let i = first; i < end; i++) {
      if (points[i].beat > beat) {
        break;
      }
      idx = i;
    }
    setPointIndex(idx);
    pointIndexRef.current = idx;
    heldNotesRef.current.clear();
    lastAdvanceTimeRef.current = 0;
    ctrl.setCursor(beat, "jump");
  }, []);

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
