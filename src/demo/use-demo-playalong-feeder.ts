import { useEffect, useMemo, useRef } from "preact/hooks";
import type { ScoreConversion } from "../../lib/musicxml/musicxml-playback";
import type { PlayalongPhase } from "../modes/use-playalong-mode";

interface DemoPlayalongFeederParams {
  /** Gate — the whole hook is inert unless this is true (?demo=1). */
  demo: boolean;
  musicxml: ScoreConversion | null;
  measureRange: { from: number; to: number } | null;
  /** Playalong's current phase; feeding runs during waiting-for-note + playing. */
  playalongPhase: PlayalongPhase;
  /** Current BPM — drives the synthetic note-off delay. */
  bpm: number;
  /** Reads the live cursor beat (PracticeScreen's getLiveBeat). */
  getLiveBeat: () => number | null;
  /** App-owned dispatch ref — the exact path real BLE input ends up calling. */
  noteEventDispatchRef: {
    current: ((noteNumber: number, kind: "on" | "off") => void) | null;
  };
}

/**
 * Desktop-only profiling harness (?demo=1): while a Playalong run is in flight,
 * emit a synthetic note-on at each note's start beat (and a matching note-off
 * after its duration) through the App-owned dispatch ref — the exact path real
 * BLE input ends up calling — so a captured performance profile reflects
 * production rendering. Firing on the true start beat lands within the match
 * tolerance, so every note scores as a hit, reproducing the full marker +
 * highlight load.
 *
 * Lives outside PracticeScreen so the production component carries only the
 * single (inert-when-disabled) call site. Does nothing unless `demo` is true.
 */
export function useDemoPlayalongFeeder({
  demo,
  musicxml,
  measureRange,
  playalongPhase,
  bpm,
  getLiveBeat,
  noteEventDispatchRef,
}: DemoPlayalongFeederParams): void {
  const bpmRef = useRef(bpm);
  bpmRef.current = bpm;

  // Onset notes (skip tie-continuations) within the active focus range, sorted
  // by start beat. Confining to the range mirrors Playalong's selectionNotes and
  // keeps a focused profiling run (which loops within the range) from dumping
  // every earlier note in a single frame at start.
  const demoFeedNotes = useMemo(() => {
    if (!demo || !musicxml) {
      return [];
    }
    const measureStartBeats = musicxml.measureStartBeats;
    const startBeat = measureRange
      ? (measureStartBeats[measureRange.from - 1] ?? 0)
      : 0;
    const endBeat = measureRange
      ? (measureStartBeats[measureRange.to] ?? musicxml.totalBeats)
      : musicxml.totalBeats;
    return musicxml.notes
      .filter(
        (n) =>
          !n.tieStop &&
          (n.graceMainBeat ?? n.startBeat) >= startBeat &&
          (n.graceMainBeat ?? n.startBeat) < endBeat,
      )
      .slice()
      .sort((a, b) => a.startBeat - b.startBeat);
  }, [demo, musicxml, measureRange]);

  // Runs during both "waiting-for-note" (count-in disabled: the first fed note
  // kicks off playback, just like a real first key press) and "playing", so the
  // demo works regardless of the count-in preference. The scan pointer and last
  // beat live in refs so they survive the waiting→playing effect re-run without
  // re-firing the first note; the pointer resets when the cursor jumps backward
  // (a new run or a focus-range loop). The walk is O(notes fired this frame),
  // not O(score), so the feeder itself stays out of the captured profile.
  const demoPointerRef = useRef(0);
  const demoLastBeatRef = useRef(Number.NEGATIVE_INFINITY);
  useEffect(() => {
    const feeding =
      playalongPhase === "playing" || playalongPhase === "waiting-for-note";
    if (!demo || !feeding || demoFeedNotes.length === 0) {
      return;
    }
    let rafId = 0;
    const pendingOffs = new Set<ReturnType<typeof setTimeout>>();

    const fire = (noteNumber: number, durationBeats: number) => {
      noteEventDispatchRef.current?.(noteNumber, "on");
      const msPerBeat = 60000 / Math.max(1, bpmRef.current);
      const offDelay = Math.min(durationBeats * msPerBeat, 2000);
      const timer = setTimeout(() => {
        pendingOffs.delete(timer);
        noteEventDispatchRef.current?.(noteNumber, "off");
      }, offDelay);
      pendingOffs.add(timer);
    };

    const step = () => {
      const beat = getLiveBeat();
      if (beat != null) {
        // Cursor jumped backward (new run or focus-range loop) — re-arm.
        if (beat < demoLastBeatRef.current) {
          demoPointerRef.current = 0;
        }
        demoLastBeatRef.current = beat;
        // Count-in disabled: the cursor sits at the start until the first key
        // press. Fire the first note unconditionally to begin playback, exactly
        // as a real first press would (its start beat may be > 0 on a pickup).
        if (
          playalongPhase === "waiting-for-note" &&
          demoPointerRef.current === 0
        ) {
          const first = demoFeedNotes[0];
          fire(first.noteNumber, first.durationBeats);
          demoPointerRef.current = 1;
        }
        while (
          demoPointerRef.current < demoFeedNotes.length &&
          demoFeedNotes[demoPointerRef.current].startBeat <= beat
        ) {
          const note = demoFeedNotes[demoPointerRef.current];
          fire(note.noteNumber, note.durationBeats);
          demoPointerRef.current++;
        }
      }
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(rafId);
      for (const timer of pendingOffs) {
        clearTimeout(timer);
      }
    };
  }, [demo, playalongPhase, demoFeedNotes, getLiveBeat, noteEventDispatchRef]);
}
