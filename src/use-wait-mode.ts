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
  /** Forward this to LivePianoInput's onNoteEvent prop. */
  onNoteEvent: (noteNumber: number, kind: "on" | "off") => void;
  /**
   * Toggle wait mode on/off.  Pass the current playback beat so the hook can
   * snap to the nearest wait point when entering.  The caller is responsible
   * for pausing audio playback before calling this.
   */
  toggle: (currentBeat: number) => void;
  /** Rewind to the first wait point (used by the Stop button in wait mode). */
  rewind: () => void;
}

export function useWaitMode(
  musicxml: MidiConversionResult | null,
): WaitModeHandle {
  const [active, setActive] = useState(false);
  const [pointIndex, setPointIndex] = useState(0);

  const activeRef = useRef(false);
  const pointIndexRef = useRef(0);
  const heldNotesRef = useRef<Set<number>>(new Set());
  const lastAdvanceTimeRef = useRef(0);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    pointIndexRef.current = pointIndex;
  }, [pointIndex]);

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
    heldNotesRef.current.clear();
    lastAdvanceTimeRef.current = 0;
  }, [musicxml]);

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
    // Snap to the nearest wait point at or before the current playback beat.
    const points = waitPointsRef.current;
    let nearestIdx = 0;
    for (let i = 0; i < points.length; i++) {
      if (points[i].beat <= currentBeat) {
        nearestIdx = i;
      } else {
        break;
      }
    }
    setPointIndex(nearestIdx);
    pointIndexRef.current = nearestIdx;
    heldNotesRef.current.clear();
    lastAdvanceTimeRef.current = 0;
    setActive(true);
  }

  function rewind() {
    setPointIndex(0);
    pointIndexRef.current = 0;
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

    // Ignore events within 100 ms of the last advance so that repeated
    // identical chords don't race ahead, while still allowing fast playing.
    if (Date.now() - lastAdvanceTimeRef.current < 100) {
      return;
    }

    const points = waitPointsRef.current;
    const idx = pointIndexRef.current;
    if (idx >= points.length) {
      return;
    }

    // All expected notes must be held; extra held notes (e.g. the other hand
    // still sustaining a previous chord) are fine.
    const expected = points[idx].noteNumbers;
    if ([...expected].every((n) => held.has(n))) {
      lastAdvanceTimeRef.current = Date.now();
      const nextIdx = idx + 1;
      pointIndexRef.current = nextIdx;
      if (nextIdx < points.length) {
        setPointIndex(nextIdx);
      } else {
        // End of piece: leave the cursor on the last chord and deactivate.
        setActive(false);
        activeRef.current = false;
      }
    }
  }, []);

  return {
    active,
    activeRef,
    cursorBeat,
    noteColors,
    onNoteEvent,
    toggle,
    rewind,
  };
}
