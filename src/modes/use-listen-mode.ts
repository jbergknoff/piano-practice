import { useCallback, useMemo, useRef } from "preact/hooks";
import { selectionStartBeat } from "../selection";
import type { ModeControl, ModeHandle, NoteHighlight } from "./mode-control";
import { soundingHighlights, useStableHighlights } from "./note-colors";

export interface ListenModeSettings {
  accent: string;
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
