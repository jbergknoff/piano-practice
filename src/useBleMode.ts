import { useEffect, useRef } from "preact/hooks";
import type { CursorStep } from "./cursor-schedule";

function firstStepOfMeasure(schedule: CursorStep[], measure: number): number {
  const idx = schedule.findIndex((s) => s.measureIndex >= measure);
  return idx === -1 ? 0 : idx;
}

function lastStepOfMeasure(schedule: CursorStep[], measure: number): number {
  let last = schedule.length - 1;
  for (let i = schedule.length - 1; i >= 0; i--) {
    if (schedule[i].measureIndex <= measure) {
      last = i;
      break;
    }
  }
  return last;
}

function nextWrapped(
  current: number,
  schedule: CursorStep[],
  loopStartMeasure: number,
  loopEndMeasure: number,
): number {
  const loopEnd = lastStepOfMeasure(schedule, loopEndMeasure);
  if (current >= loopEnd) {
    return firstStepOfMeasure(schedule, loopStartMeasure);
  }
  return current + 1;
}

interface Args {
  schedule: CursorStep[];
  stepIndex: number;
  onAdvance: (newIndex: number) => void;
  loopStartMeasure: number;
  loopEndMeasure: number;
}

export function useBleMode({
  schedule,
  stepIndex,
  onAdvance,
  loopStartMeasure,
  loopEndMeasure,
}: Args): { onNoteOn: (noteNumber: number, velocity: number) => void } {
  const playedPitchClasses = useRef(new Set<number>());

  // Clear held notes and auto-advance past rests whenever the step changes.
  useEffect(() => {
    playedPitchClasses.current.clear();
    const step = schedule[stepIndex];
    if (step && step.noteNumbers.length === 0) {
      onAdvance(
        nextWrapped(stepIndex, schedule, loopStartMeasure, loopEndMeasure),
      );
    }
  }, [stepIndex, schedule, loopStartMeasure, loopEndMeasure, onAdvance]);

  function onNoteOn(noteNumber: number, _velocity: number) {
    if (schedule.length === 0) {
      return;
    }
    const step = schedule[stepIndex];
    if (!step || step.noteNumbers.length === 0) {
      return;
    }

    const required = [...new Set(step.noteNumbers.map((n) => n % 12))];
    const pitch = noteNumber % 12;
    if (!required.includes(pitch)) {
      return;
    }

    playedPitchClasses.current.add(pitch);
    if (playedPitchClasses.current.size >= required.length) {
      playedPitchClasses.current.clear();
      onAdvance(
        nextWrapped(stepIndex, schedule, loopStartMeasure, loopEndMeasure),
      );
    }
  }

  return { onNoteOn };
}
