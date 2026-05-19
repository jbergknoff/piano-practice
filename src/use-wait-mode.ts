import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import type { MidiConversionResult } from "./midi-to-musicxml";
import type { DebugBeatEvent, WaitModeDebugEvent } from "./debug-log";

export type { DebugBeatEvent } from "./debug-log";

interface WaitPoint {
  beat: number;
  noteNumbers: Set<number>;
}

export interface WaitModeHandle {
  /** Whether wait mode is currently active. */
  active: boolean;
  /**
   * Ref whose `.current` mirrors `active`. Safe to read inside long-lived
   * callbacks (e.g. the MidiPlayer onPositionUpdate) without stale-closure risk.
   */
  activeRef: { current: boolean };
  /** Amber note-color map for the expected chord; empty when inactive. */
  noteColors: Record<string, string>;
  /** True for ~600 ms after a wrong note is pressed; use for visual feedback. */
  wrongNoteFlash: boolean;
  /** Forward this to LivePianoInput's onNoteEvent prop. */
  onNoteEvent: (noteNumber: number, kind: "on" | "off") => void;
  /**
   * Toggle wait mode on/off.  Pass the current playback beat so the hook can
   * snap to the nearest wait point when entering.  The caller is responsible
   * for pausing audio playback before calling this.
   */
  toggle: (currentBeat: number) => void;
  /** Rewind to the first wait point of the current range. */
  rewind: () => void;
  /** Jump the wait-mode cursor to the first wait point at or after the given beat. */
  seekToBeat: (beat: number) => void;
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
  musicxml: MidiConversionResult | null,
  measureRange: { from: number; to: number } | null,
  noteSensitivityMilliseconds = 150,
  onWrongNote?: () => void,
  onComplete?: (stats: {
    wrongNotes: number;
    elapsedMs: number;
    totalPoints: number;
  }) => void,
  noteColor = "#E08A3E",
  onCursorAdvance?: (beat: number) => void,
  appendToDebugLog: (event: DebugBeatEvent) => void = () => {},
): WaitModeHandle {
  const [active, setActive] = useState(false);
  const [pointIndex, setPointIndex] = useState(0);
  const [wrongNoteFlash, setWrongNoteFlash] = useState(false);

  const activeRef = useRef(false);
  const pointIndexRef = useRef(0);
  const heldNotesRef = useRef<Set<number>>(new Set());
  const lastAdvanceTimeRef = useRef(0);
  const wrongNoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrongNoteCountRef = useRef(0);
  const attemptStartTimeRef = useRef<number | null>(null);
  const measureRangeRef = useRef(measureRange);
  const timeSigNumRef = useRef(musicxml?.timeSigNum ?? 4);
  const noteSensitivityMillisecondsRef = useRef(noteSensitivityMilliseconds);
  const onWrongNoteRef = useRef(onWrongNote);
  const onCompleteRef = useRef(onComplete);
  const appendToDebugLogRef = useRef(appendToDebugLog);
  const onCursorAdvanceRef = useRef(onCursorAdvance);

  useEffect(() => {
    onWrongNoteRef.current = onWrongNote;
  }, [onWrongNote]);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    appendToDebugLogRef.current = appendToDebugLog;
  }, [appendToDebugLog]);

  useEffect(() => {
    onCursorAdvanceRef.current = onCursorAdvance;
  }, [onCursorAdvance]);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    pointIndexRef.current = pointIndex;
  }, [pointIndex]);

  useEffect(() => {
    measureRangeRef.current = measureRange;
  }, [measureRange]);

  useEffect(() => {
    timeSigNumRef.current = musicxml?.timeSigNum ?? 4;
  }, [musicxml]);

  useEffect(() => {
    noteSensitivityMillisecondsRef.current = noteSensitivityMilliseconds;
  }, [noteSensitivityMilliseconds]);

  // One entry per unique startBeat; note numbers deduplicated across parts.
  const waitPoints = useMemo<WaitPoint[]>(() => {
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
  }, [musicxml]);

  const waitPointsRef = useRef(waitPoints);
  useEffect(() => {
    waitPointsRef.current = waitPoints;
  }, [waitPoints]);

  // Reset all state whenever the piece changes. Active state is controlled by
  // the caller via toggle(); start inactive so App.tsx can decide the mode.
  // biome-ignore lint/correctness/useExhaustiveDependencies: musicxml is the trigger; ref mutations don't need to be listed
  useEffect(() => {
    setActive(false);
    activeRef.current = false;
    setPointIndex(0);
    pointIndexRef.current = 0;
    setWrongNoteFlash(false);
    heldNotesRef.current.clear();
    lastAdvanceTimeRef.current = 0;
    wrongNoteCountRef.current = 0;
    attemptStartTimeRef.current = null;
    if (wrongNoteTimerRef.current !== null) {
      clearTimeout(wrongNoteTimerRef.current);
      wrongNoteTimerRef.current = null;
    }
  }, [musicxml]);

  // When the range changes while wait mode is active, restart from range start.
  // biome-ignore lint/correctness/useExhaustiveDependencies: measureRange is the trigger; ref mutations don't need to be listed
  useEffect(() => {
    if (!active) {
      return;
    }
    const { first } = rangeBounds(
      waitPointsRef.current,
      measureRange,
      timeSigNumRef.current,
    );
    setPointIndex(first);
    pointIndexRef.current = first;
    heldNotesRef.current.clear();
    lastAdvanceTimeRef.current = 0;
    wrongNoteCountRef.current = 0;
    attemptStartTimeRef.current = null;
  }, [measureRange]);

  const noteColors = useMemo<Record<string, string>>(() => {
    if (!active || !musicxml || waitPoints.length === 0) {
      return {};
    }
    const idx = Math.min(pointIndex, waitPoints.length - 1);
    const targetBeat = waitPoints[idx].beat;
    const colors: Record<string, string> = {};
    for (const note of musicxml.notes) {
      if (!note.tieStop && note.startBeat === targetBeat) {
        colors[
          `p${note.partIndex}-m${note.measureNumber}-n${note.noteIndex}-v${note.voiceIndex}`
        ] = noteColor;
      }
    }
    return colors;
  }, [active, musicxml, waitPoints, pointIndex, noteColor]);

  function toggle(currentBeat: number) {
    if (active) {
      setActive(false);
      return;
    }
    const points = waitPointsRef.current;
    const range = measureRangeRef.current;
    const tSig = timeSigNumRef.current;
    const { first } = rangeBounds(points, range, tSig);

    let startIdx: number;
    if (range) {
      // With a range active, always start from the range beginning.
      startIdx = first;
    } else {
      // No range: snap to the nearest wait point at or before currentBeat.
      startIdx = 0;
      for (let i = 0; i < points.length; i++) {
        if (points[i].beat <= currentBeat) {
          startIdx = i;
        } else {
          break;
        }
      }
    }

    setPointIndex(startIdx);
    pointIndexRef.current = startIdx;
    heldNotesRef.current.clear();
    lastAdvanceTimeRef.current = 0;
    wrongNoteCountRef.current = 0;
    attemptStartTimeRef.current = null;
    setActive(true);
  }

  function seekToBeat(beat: number) {
    const points = waitPointsRef.current;
    const { first, end } = rangeBounds(
      points,
      measureRangeRef.current,
      timeSigNumRef.current,
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
  }

  function rewind() {
    const { first } = rangeBounds(
      waitPointsRef.current,
      measureRangeRef.current,
      timeSigNumRef.current,
    );
    setPointIndex(first);
    pointIndexRef.current = first;
    heldNotesRef.current.clear();
    lastAdvanceTimeRef.current = 0;
    wrongNoteCountRef.current = 0;
    attemptStartTimeRef.current = null;
  }

  // Stable: reads only from refs so it never goes stale inside the BLE listener.
  const onNoteEvent = useCallback((noteNumber: number, kind: "on" | "off") => {
    if (!activeRef.current || waitPointsRef.current.length === 0) {
      return;
    }

    const held = heldNotesRef.current;
    const now = Date.now();
    const msSinceAdvance = now - lastAdvanceTimeRef.current;

    if (kind === "on") {
      held.add(noteNumber);
      // Start timing on the first key press of this attempt.
      if (attemptStartTimeRef.current === null) {
        attemptStartTimeRef.current = now;
      }
    } else {
      held.delete(noteNumber);
      // Log the note-off so the debug timeline is complete.
      const points = waitPointsRef.current;
      const idx = pointIndexRef.current;
      const { end } = rangeBounds(
        points,
        measureRangeRef.current,
        timeSigNumRef.current,
      );
      const wp = idx < end ? points[idx] : null;
      const offBeat = wp?.beat ?? -1;
      const tSig = timeSigNumRef.current;
      appendToDebugLogRef.current({
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
      return; // only check for a match when a new note is pressed
    }

    const points = waitPointsRef.current;
    const idx = pointIndexRef.current;
    const { first, end } = rangeBounds(
      points,
      measureRangeRef.current,
      timeSigNumRef.current,
    );

    if (idx >= end) {
      return;
    }

    const wp = points[idx];
    const expected = wp.noteNumbers;
    const beat = wp.beat;
    const measure = Math.floor(beat / timeSigNumRef.current) + 1;
    // Snapshot held *after* adding the new note, for the debug log.
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

    // Silently ignore wrong notes within the grace period after a successful
    // advance (catches lingering "note on" events from the previous beat).
    if (
      !expected.has(noteNumber) &&
      msSinceAdvance < noteSensitivityMillisecondsRef.current
    ) {
      appendToDebugLogRef.current({
        ...debugBase,
        outcome: "grace",
      });
      return;
    }

    // Wrong note: the pressed key is not in the expected chord at all.
    if (!expected.has(noteNumber)) {
      wrongNoteCountRef.current += 1;
      onWrongNoteRef.current?.();
      setWrongNoteFlash(true);
      if (wrongNoteTimerRef.current !== null) {
        clearTimeout(wrongNoteTimerRef.current);
      }
      wrongNoteTimerRef.current = setTimeout(() => {
        setWrongNoteFlash(false);
        wrongNoteTimerRef.current = null;
      }, 600);
      appendToDebugLogRef.current({
        ...debugBase,
        outcome: "wrong",
      });
      return;
    }

    // Ignore events within 100 ms of the last advance so that repeated
    // identical chords don't race ahead, while still allowing fast playing.
    if (msSinceAdvance < 100) {
      appendToDebugLogRef.current({
        ...debugBase,
        outcome: "debounce",
      });
      return;
    }

    // All expected notes must be held; extra held notes (e.g. the other hand
    // still sustaining a previous chord) are fine.
    if ([...expected].every((n) => held.has(n))) {
      lastAdvanceTimeRef.current = now;
      const nextIdx = idx + 1;
      if (nextIdx >= end) {
        // Attempt complete — fire callback before resetting.
        const startTime = attemptStartTimeRef.current;
        if (startTime !== null) {
          onCompleteRef.current?.({
            wrongNotes: wrongNoteCountRef.current,
            elapsedMs: now - startTime,
            totalPoints: end - first,
          });
        }
        // Restart from the beginning of the active range (or piece).
        wrongNoteCountRef.current = 0;
        attemptStartTimeRef.current = null;
        pointIndexRef.current = first;
        setPointIndex(first);
        onCursorAdvanceRef.current?.(points[first].beat);
      } else {
        pointIndexRef.current = nextIdx;
        setPointIndex(nextIdx);
        onCursorAdvanceRef.current?.(points[nextIdx].beat);
      }
      appendToDebugLogRef.current({
        ...debugBase,
        outcome: "advance",
      });
    } else {
      appendToDebugLogRef.current({
        ...debugBase,
        outcome: "incomplete",
      });
    }
  }, []);

  return {
    active,
    activeRef,
    noteColors,
    wrongNoteFlash,
    onNoteEvent,
    toggle,
    rewind,
    seekToBeat,
  };
}
