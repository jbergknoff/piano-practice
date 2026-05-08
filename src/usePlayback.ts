import type { RefObject } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { CursorStep } from "./cursor-schedule";
import type { MusicXmlDisplayHandle } from "./MusicXmlDisplay";

export type PlaybackStatus = "idle" | "playing" | "paused";
export type PlaybackMode = "playback" | "ble";

function midiToHz(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

function playNote(
  ctx: AudioContext,
  midiNote: number,
  durationSec: number,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.value = midiToHz(midiNote);
  gain.gain.setValueAtTime(0.25, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(
    0.001,
    ctx.currentTime + Math.max(durationSec, 0.05),
  );
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + Math.max(durationSec, 0.05) + 0.05);
}

function firstStepOfMeasure(schedule: CursorStep[], measure: number): number {
  const idx = schedule.findIndex((s) => s.measureIndex >= measure);
  return idx === -1 ? 0 : idx;
}

function lastStepOfMeasure(schedule: CursorStep[], measure: number): number {
  for (let i = schedule.length - 1; i >= 0; i--) {
    if (schedule[i].measureIndex <= measure) {
      return i;
    }
  }
  return schedule.length - 1;
}

interface Args {
  schedule: CursorStep[];
  displayRef: RefObject<MusicXmlDisplayHandle>;
  scrollContainerRef: RefObject<HTMLDivElement>;
  defaultBpm: number;
}

interface Result {
  status: PlaybackStatus;
  mode: PlaybackMode;
  bpm: number;
  stepIndex: number;
  loopStartMeasure: number;
  loopEndMeasure: number;
  play: () => void;
  pause: () => void;
  stop: () => void;
  setMode: (mode: PlaybackMode) => void;
  setLoopStart: (measure: number) => void;
  setLoopEnd: (measure: number) => void;
  setBpm: (bpm: number) => void;
  advanceToStep: (index: number) => void;
}

export function usePlayback({
  schedule,
  displayRef,
  scrollContainerRef,
  defaultBpm,
}: Args): Result {
  const [status, setStatus] = useState<PlaybackStatus>("idle");
  const [mode, setMode] = useState<PlaybackMode>("playback");
  const [bpm, setBpmState] = useState(defaultBpm);
  const [stepIndex, setStepIndex] = useState(0);
  const [loopStartMeasure, setLoopStartMeasure] = useState(0);
  const [loopEndMeasure, setLoopEndMeasure] = useState(0);

  // Refs used inside the rAF callback (avoids stale closures).
  const statusRef = useRef(status);
  const bpmRef = useRef(bpm);
  const loopStartMeasureRef = useRef(loopStartMeasure);
  const loopEndMeasureRef = useRef(loopEndMeasure);
  const scheduleRef = useRef(schedule);
  const stepIndexRef = useRef(stepIndex);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playStartTimeRef = useRef(0); // audioCtx.currentTime when this loop iteration started
  const loopStartBeatRef = useRef(0); // beatTime of the loop-start step
  const nextStepRef = useRef(0); // index of the next step to trigger
  const rafIdRef = useRef<number | null>(null);

  // Keep refs in sync with state.
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  useEffect(() => {
    bpmRef.current = bpm;
  }, [bpm]);
  useEffect(() => {
    loopStartMeasureRef.current = loopStartMeasure;
  }, [loopStartMeasure]);
  useEffect(() => {
    loopEndMeasureRef.current = loopEndMeasure;
  }, [loopEndMeasure]);
  useEffect(() => {
    scheduleRef.current = schedule;
  }, [schedule]);

  // Reset BPM when the source file changes.
  useEffect(() => {
    setBpmState(defaultBpm);
  }, [defaultBpm]);

  // Reset loop end when schedule changes.
  useEffect(() => {
    if (schedule.length > 0) {
      const maxMeasure = schedule[schedule.length - 1].measureIndex;
      setLoopEndMeasure(maxMeasure);
    }
  }, [schedule]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scrollContainerRef is a stable ref
  const scrollToCenter = useCallback((xPixel: number) => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    container.scrollLeft = xPixel - container.clientWidth / 2;
  }, []);

  function applyStep(index: number, audioCtx: AudioContext) {
    const s = scheduleRef.current;
    const step = s[index];
    if (!step) {
      return;
    }
    displayRef.current?.goToStep(index);
    scrollToCenter(step.xPixel);
    stepIndexRef.current = index;
    setStepIndex(index);

    if (step.noteNumbers.length > 0) {
      const next = s[index + 1];
      const durationBeats = next
        ? next.beatTime - step.beatTime
        : 60 / bpmRef.current;
      const durationSec = durationBeats * (60 / bpmRef.current);
      for (const note of step.noteNumbers) {
        playNote(audioCtx, note, durationSec);
      }
    }
  }

  function rafLoop() {
    const ctx = audioCtxRef.current;
    if (!ctx || statusRef.current !== "playing") {
      return;
    }

    const s = scheduleRef.current;
    if (s.length === 0) {
      return;
    }

    const bpm = bpmRef.current;
    const elapsed = ctx.currentTime - playStartTimeRef.current;
    const elapsedBeats = elapsed * (bpm / 60);
    const loopEndIdx = lastStepOfMeasure(s, loopEndMeasureRef.current);
    const loopStartIdx = firstStepOfMeasure(s, loopStartMeasureRef.current);

    // Advance all steps whose beat offset from loop start has been reached.
    while (nextStepRef.current <= loopEndIdx) {
      const step = s[nextStepRef.current];
      const beatOffset = step.beatTime - loopStartBeatRef.current;
      if (beatOffset > elapsedBeats) {
        break;
      }
      applyStep(nextStepRef.current, ctx);
      nextStepRef.current++;
    }

    // Loop wrap: past the last step in the loop region.
    if (nextStepRef.current > loopEndIdx) {
      const loopStartBeat = s[loopStartIdx].beatTime;
      const loopEndBeat =
        s[loopEndIdx + 1]?.beatTime ?? s[loopEndIdx].beatTime + 1;
      const loopDurationBeats = loopEndBeat - loopStartBeat;
      const loopDurationSec = loopDurationBeats * (60 / bpm);
      playStartTimeRef.current = playStartTimeRef.current + loopDurationSec;
      loopStartBeatRef.current = loopStartBeat;
      nextStepRef.current = loopStartIdx;
    }

    rafIdRef.current = requestAnimationFrame(rafLoop);
  }

  function play() {
    if (schedule.length === 0) {
      return;
    }

    if (statusRef.current === "paused") {
      // Resume: AudioContext was suspended; adjust start time for the gap.
      audioCtxRef.current?.resume().then(() => {
        if (audioCtxRef.current) {
          // Rebase start time so elapsed beats continue from where we paused.
          const pausedElapsed =
            audioCtxRef.current.currentTime - playStartTimeRef.current;
          playStartTimeRef.current =
            audioCtxRef.current.currentTime - pausedElapsed;
        }
        setStatus("playing");
        statusRef.current = "playing";
        rafIdRef.current = requestAnimationFrame(rafLoop);
      });
      return;
    }

    // Fresh play: create AudioContext inside user gesture for mobile Safari.
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new AudioContext();
    }

    const loopStartIdx = firstStepOfMeasure(schedule, loopStartMeasure);
    const loopStartBeat = schedule[loopStartIdx].beatTime;
    loopStartBeatRef.current = loopStartBeat;
    nextStepRef.current = loopStartIdx;
    playStartTimeRef.current = audioCtxRef.current.currentTime;

    setStatus("playing");
    statusRef.current = "playing";
    rafIdRef.current = requestAnimationFrame(rafLoop);
  }

  function pause() {
    if (statusRef.current !== "playing") {
      return;
    }
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    audioCtxRef.current?.suspend();
    setStatus("paused");
    statusRef.current = "paused";
  }

  function stop() {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    setStatus("idle");
    statusRef.current = "idle";
    setStepIndex(0);
    stepIndexRef.current = 0;
    displayRef.current?.goToStep(0);
    if (schedule.length > 0) {
      scrollToCenter(schedule[0].xPixel);
    }
  }

  // Expose a way for BLE mode to move the cursor directly.
  const advanceToStep = useCallback(
    (index: number) => {
      const step = schedule[index];
      if (!step) {
        return;
      }
      displayRef.current?.goToStep(index);
      scrollToCenter(step.xPixel);
      setStepIndex(index);
      stepIndexRef.current = index;
    },
    [schedule, displayRef, scrollToCenter],
  );

  function setBpm(newBpm: number) {
    setBpmState(newBpm);
    bpmRef.current = newBpm;
  }

  function setLoopStart(measure: number) {
    const clamped = Math.min(measure, loopEndMeasure);
    setLoopStartMeasure(clamped);
    loopStartMeasureRef.current = clamped;
  }

  function setLoopEnd(measure: number) {
    const maxMeasure =
      schedule.length > 0 ? schedule[schedule.length - 1].measureIndex : 0;
    const clamped = Math.max(Math.min(measure, maxMeasure), loopStartMeasure);
    setLoopEndMeasure(clamped);
    loopEndMeasureRef.current = clamped;
  }

  return {
    status,
    mode,
    bpm,
    stepIndex,
    loopStartMeasure,
    loopEndMeasure,
    play,
    pause,
    stop,
    setMode,
    setLoopStart,
    setLoopEnd,
    setBpm,
    advanceToStep,
  };
}
