import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import type { MidiConversionResult } from "./midi-to-musicxml";

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
  /**
   * The beat the cursor should sit on while wait mode is active.
   * `null` when wait mode is inactive.
   */
  cursorBeat: number | null;
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

/** Brief dissonant buzz played on a wrong note. */
function playWrongNoteSound(): void {
  try {
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
    gain.connect(ctx.destination);
    // Two slightly detuned sawtooths create a harsh beating tone.
    for (const freq of [155, 183]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.28);
    }
    setTimeout(() => ctx.close(), 400);
  } catch {
    // Silently ignore if Web Audio is unavailable.
  }
}

export function useWaitMode(
  musicxml: MidiConversionResult | null,
  measureRange: { from: number; to: number } | null,
): WaitModeHandle {
  const [active, setActive] = useState(false);
  const [pointIndex, setPointIndex] = useState(0);
  const [wrongNoteFlash, setWrongNoteFlash] = useState(false);

  const activeRef = useRef(false);
  const pointIndexRef = useRef(0);
  const heldNotesRef = useRef<Set<number>>(new Set());
  const lastAdvanceTimeRef = useRef(0);
  const wrongNoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measureRangeRef = useRef(measureRange);
  const timeSigNumRef = useRef(musicxml?.timeSigNum ?? 4);

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

  // Reset all state whenever the piece changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: musicxml is the trigger; ref mutations don't need to be listed
  useEffect(() => {
    setActive(false);
    activeRef.current = false;
    setPointIndex(0);
    pointIndexRef.current = 0;
    setWrongNoteFlash(false);
    heldNotesRef.current.clear();
    lastAdvanceTimeRef.current = 0;
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
  }, [measureRange]);

  const cursorBeat =
    active && waitPoints.length > 0
      ? waitPoints[Math.min(pointIndex, waitPoints.length - 1)].beat
      : null;

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
        ] = "#e65100";
      }
    }
    return colors;
  }, [active, musicxml, waitPoints, pointIndex]);

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
    setActive(true);
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
  }

  // Stable: reads only from refs so it never goes stale inside the BLE listener.
  const onNoteEvent = useCallback((noteNumber: number, kind: "on" | "off") => {
    if (!activeRef.current || waitPointsRef.current.length === 0) {
      return;
    }

    const held = heldNotesRef.current;
    if (kind === "on") {
      held.add(noteNumber);
    } else {
      held.delete(noteNumber);
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

    const expected = points[idx].noteNumbers;

    // Wrong note: the pressed key is not in the expected chord at all.
    if (!expected.has(noteNumber)) {
      playWrongNoteSound();
      setWrongNoteFlash(true);
      if (wrongNoteTimerRef.current !== null) {
        clearTimeout(wrongNoteTimerRef.current);
      }
      wrongNoteTimerRef.current = setTimeout(() => {
        setWrongNoteFlash(false);
        wrongNoteTimerRef.current = null;
      }, 600);
      return;
    }

    // Ignore events within 100 ms of the last advance so that repeated
    // identical chords don't race ahead, while still allowing fast playing.
    if (Date.now() - lastAdvanceTimeRef.current < 100) {
      return;
    }

    // All expected notes must be held; extra held notes (e.g. the other hand
    // still sustaining a previous chord) are fine.
    if ([...expected].every((n) => held.has(n))) {
      lastAdvanceTimeRef.current = Date.now();
      const nextIdx = idx + 1;
      if (nextIdx >= end) {
        if (measureRangeRef.current) {
          // Restart from the start of the focus range.
          pointIndexRef.current = first;
          setPointIndex(first);
        } else {
          // No range: end of piece — deactivate.
          setActive(false);
          activeRef.current = false;
        }
      } else {
        pointIndexRef.current = nextIdx;
        setPointIndex(nextIdx);
      }
    }
  }, []);

  return {
    active,
    activeRef,
    cursorBeat,
    noteColors,
    wrongNoteFlash,
    onNoteEvent,
    toggle,
    rewind,
  };
}
