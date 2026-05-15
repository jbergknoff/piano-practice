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

/** Soft two-note descending chime played on a wrong note. */
function playWrongNoteSound(): void {
  try {
    const ctx = new AudioContext();
    // Two sine tones a minor third apart, staggered to give a gentle "ding-dong" drop.
    const notes = [
      { freq: 523.25, startDelay: 0, duration: 0.35 },    // C5
      { freq: 440.0, startDelay: 0.18, duration: 0.35 },  // A4 (minor third below)
    ];
    for (const { freq, startDelay, duration } of notes) {
      const gain = ctx.createGain();
      const t0 = ctx.currentTime + startDelay;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.18, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
      gain.connect(ctx.destination);
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(t0);
      osc.stop(t0 + duration);
    }
    setTimeout(() => ctx.close(), 700);
  } catch {
    // Silently ignore if Web Audio is unavailable.
  }
}

export function useWaitMode(
  musicxml: MidiConversionResult | null,
  measureRange: { from: number; to: number } | null,
  noteSensitivityMilliseconds = 150,
  onWrongNote?: () => void,
): WaitModeHandle {
  const [active, setActive] = useState(true);
  const [pointIndex, setPointIndex] = useState(0);
  const [wrongNoteFlash, setWrongNoteFlash] = useState(false);

  const activeRef = useRef(true);
  const pointIndexRef = useRef(0);
  const heldNotesRef = useRef<Set<number>>(new Set());
  const lastAdvanceTimeRef = useRef(0);
  const wrongNoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measureRangeRef = useRef(measureRange);
  const timeSigNumRef = useRef(musicxml?.timeSigNum ?? 4);
  const noteSensitivityMillisecondsRef = useRef(noteSensitivityMilliseconds);
  const onWrongNoteRef = useRef(onWrongNote);

  useEffect(() => {
    onWrongNoteRef.current = onWrongNote;
  }, [onWrongNote]);

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

  // Reset all state whenever the piece changes; always start in wait mode.
  // biome-ignore lint/correctness/useExhaustiveDependencies: musicxml is the trigger; ref mutations don't need to be listed
  useEffect(() => {
    setActive(true);
    activeRef.current = true;
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

    // Silently ignore wrong notes within the grace period after a successful
    // advance (catches lingering "note on" events from the previous beat).
    if (
      !expected.has(noteNumber) &&
      Date.now() - lastAdvanceTimeRef.current <
        noteSensitivityMillisecondsRef.current
    ) {
      return;
    }

    // Wrong note: the pressed key is not in the expected chord at all.
    if (!expected.has(noteNumber)) {
      playWrongNoteSound();
      onWrongNoteRef.current?.();
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
        // Restart from the beginning of the active range (or piece).
        pointIndexRef.current = first;
        setPointIndex(first);
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
    seekToBeat,
  };
}
