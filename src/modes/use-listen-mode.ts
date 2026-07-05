import { useCallback, useMemo, useRef } from "preact/hooks";
import {
  type PlaybackNote,
  playbackNoteId,
} from "../../lib/musicxml/musicxml-playback";
import {
  type MeasureRange,
  measureInRange,
  selectionStartBeat,
} from "../selection";
import type { ModeControl, ModeHandle, NoteHighlight } from "./mode-control";
import { useStableHighlights } from "./note-colors";

export interface ListenModeSettings {
  accent: string;
}

/**
 * The notes sounding at `currentBeat`, as score highlights. A note is sounding
 * when the beat falls in its half-open `[startBeat, startBeat + durationBeats)`
 * span, and — crucially — its rendered measure lies within the focus range.
 *
 * The measure filter is what keeps a note ending exactly on the barline where
 * the focus range begins from leaking in as a phantom first chord: its end beat
 * can float-overshoot the range-start beat by an ULP, so the raw sounding test
 * alone would highlight it. Filtering by measure (see `measureInRange`) mirrors
 * the way wait mode constrains its wait points to the range.
 */
export function soundingHighlights(
  notes: PlaybackNote[],
  currentBeat: number,
  range: MeasureRange | null,
  accent: string,
): NoteHighlight[] {
  const highlights: NoteHighlight[] = [];
  for (const note of notes) {
    if (!measureInRange(note.measureIndex + 1, range)) {
      continue;
    }
    if (
      note.startBeat <= currentBeat &&
      currentBeat < note.startBeat + note.durationBeats
    ) {
      highlights.push({
        kind: "score",
        id: playbackNoteId(note),
        color: accent,
      });
    }
  }
  return highlights;
}

export function useListenMode(
  control: ModeControl,
  settings: ListenModeSettings,
): ModeHandle {
  const activeRef = useRef(false);
  const controlRef = useRef(control);
  controlRef.current = control;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const handlePlayPause = useCallback(async () => {
    const ctrl = controlRef.current;
    const player = ctrl.player;
    if (player.state() === "playing") {
      player.pause();
      ctrl.setIsPlaying(false);
    } else {
      // Snap the view back to the cursor in case the user scrolled while paused.
      ctrl.setCursor(ctrl.currentBeatRef.current, "jump");
      await player.play();
      ctrl.setIsPlaying(true);
    }
  }, []);

  const handleReset = useCallback(() => {
    const ctrl = controlRef.current;
    const range = ctrl.measureRange;
    const startBeat = selectionStartBeat(range, ctrl.measureStartBeats);
    ctrl.player.pause();
    ctrl.player.seek(startBeat);
    ctrl.setIsPlaying(false);
    ctrl.setCursor(startBeat, "jump");
  }, []);

  const handleSeek = useCallback((beat: number) => {
    const ctrl = controlRef.current;
    ctrl.player.seek(beat);
    ctrl.setCursor(beat, "jump");
  }, []);

  const activate = useCallback(() => {
    activeRef.current = true;
  }, []);

  const deactivate = useCallback(() => {
    activeRef.current = false;
  }, []);

  const onNoteEvent = useCallback(() => {}, []);

  const computedHighlights = useMemo<ReadonlyArray<NoteHighlight>>(() => {
    const musicxml = control.musicxml;
    const currentBeat = control.currentBeat;
    if (!musicxml || currentBeat === 0) {
      return [];
    }
    return soundingHighlights(
      musicxml.notes,
      currentBeat,
      control.measureRange,
      settings.accent,
    );
  }, [
    control.musicxml,
    control.currentBeat,
    control.measureRange,
    settings.accent,
  ]);
  const noteHighlights = useStableHighlights(computedHighlights);

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
    modal: null,
  };
}
