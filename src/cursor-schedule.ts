import type { OpenSheetMusicDisplay } from "opensheetmusicdisplay";

export interface CursorStep {
  index: number;
  beatTime: number; // quarter-note beats from start (CurrentSourceTimestamp.RealValue)
  measureIndex: number;
  noteNumbers: number[]; // MIDI note numbers; empty = rest → auto-advance
  xPixel: number; // cursor.cursorElement.style.left as float
}

export function buildCursorSchedule(osmd: OpenSheetMusicDisplay): CursorStep[] {
  const cursor = osmd.cursor;
  cursor.show();
  cursor.reset();

  const steps: CursorStep[] = [];
  let index = 0;

  while (!cursor.iterator.EndReached) {
    const beatTime = cursor.iterator.CurrentSourceTimestamp.RealValue;
    const measureIndex = cursor.iterator.CurrentMeasureIndex;
    const xPixel = Number.parseFloat(cursor.cursorElement.style.left) || 0;
    const noteNumbers = cursor
      .NotesUnderCursor()
      .filter((n) => !n.isRest())
      .map((n) => n.halfTone);

    steps.push({ index, beatTime, measureIndex, noteNumbers, xPixel });
    cursor.next();
    index++;
  }

  cursor.reset();
  cursor.show();
  return steps;
}
