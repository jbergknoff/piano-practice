import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { WaitModeResultModal } from "../components/WaitModeResultModal";
import type { WaitModeDebugEvent } from "../debug-log";
import {
  type WaitModeAttempt,
  loadAttemptHistory,
  saveAttempt,
} from "../hooks/use-file-history";
import type { ThemeTokens } from "../theme";
import type { ModeControl, ModeHandle } from "./mode-control";

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

/** Returns the first wait-point index inside the range and the exclusive end index. */
function rangeBounds(
  points: WaitPoint[],
  range: { from: number; to: number } | null,
  timeSigNum: number,
): { first: number; end: number } {
  if (!range) {
    return { first: 0, end: points.length };
  }
  const startBeat = (range.from - 1) * timeSigNum;
  const endBeat = range.to * timeSigNum;

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
  } | null>(null);

  const activeRef = useRef(false);
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
      if (note.tieStop) {
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
    const tSig = controlRef.current.musicxml?.timeSigNum ?? 4;
    const { first } = rangeBounds(
      waitPointsRef.current,
      control.measureRange,
      tSig,
    );
    setPointIndex(first);
    pointIndexRef.current = first;
    heldNotesRef.current.clear();
    lastAdvanceTimeRef.current = 0;
    wrongNoteCountRef.current = 0;
    attemptStartTimeRef.current = null;
  }, [control.measureRange]);

  const noteColors = useMemo<Record<string, string>>(() => {
    if (!active || !control.musicxml || waitPoints.length === 0) {
      return {};
    }
    const idx = Math.min(pointIndex, waitPoints.length - 1);
    const targetBeat = waitPoints[idx].beat;
    const colors: Record<string, string> = {};
    for (const note of control.musicxml.notes) {
      if (!note.tieStop && note.startBeat === targetBeat) {
        colors[
          `p${note.partIndex}-m${note.measureNumber}-n${note.noteIndex}-v${note.voiceIndex}`
        ] = settings.accent;
      }
    }
    return colors;
  }, [active, control.musicxml, waitPoints, pointIndex, settings.accent]);

  // Stable: reads only from refs so it never goes stale inside the BLE listener.
  const onNoteEvent = useCallback((noteNumber: number, kind: "on" | "off") => {
    if (!activeRef.current || waitPointsRef.current.length === 0) {
      return;
    }
    const ctrl = controlRef.current;
    const tSig = ctrl.musicxml?.timeSigNum ?? 4;
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
      const { end } = rangeBounds(points, ctrl.measureRange, tSig);
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
    const { first, end } = rangeBounds(points, ctrl.measureRange, tSig);

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

    if (msSinceAdvance < 100) {
      ctrl.appendToDebugLog({ ...debugBase, outcome: "debounce" });
      return;
    }

    if ([...expected].every((n) => held.has(n))) {
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
    const selectionBeats = range
      ? (range.to - range.from + 1) * mx.timeSigNum
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
    });
  }

  const activate = useCallback(() => {
    if (activeRef.current) {
      return;
    }
    const ctrl = controlRef.current;
    const points = waitPointsRef.current;
    const range = ctrl.measureRange;
    const tSig = ctrl.musicxml?.timeSigNum ?? 4;
    const { first } = rangeBounds(points, range, tSig);

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
          ? (range.from - 1) * tSig
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
    const tSig = ctrl.musicxml?.timeSigNum ?? 4;
    const { first } = rangeBounds(
      waitPointsRef.current,
      ctrl.measureRange,
      tSig,
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
    const tSig = ctrl.musicxml?.timeSigNum ?? 4;
    const points = waitPointsRef.current;
    const { first, end } = rangeBounds(points, ctrl.measureRange, tSig);
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

  const modal = completionModal ? (
    <WaitModeResultModal
      theme={settings.theme}
      accent={settings.accent}
      selectionLabel={completionModal.selectionLabel}
      history={completionModal.history}
      expectedDurationMs={completionModal.expectedDurationMs}
      onClose={() => setCompletionModal(null)}
    />
  ) : null;

  return {
    noteColors,
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
