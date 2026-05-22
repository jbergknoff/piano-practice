import { useCallback, useMemo, useRef } from "preact/hooks";
import type { ModeControl, ModeHandle } from "./mode-control";
import { useStableNoteColors } from "./note-colors";

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
    const mx = ctrl.musicxml;
    const range = ctrl.measureRange;
    const startBeat = range ? (range.from - 1) * (mx?.timeSigNum ?? 4) : 0;
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

  const computedColors = useMemo<Record<string, string>>(() => {
    const musicxml = control.musicxml;
    const currentBeat = control.currentBeat;
    if (!musicxml || currentBeat === 0) {
      return {};
    }
    const colors: Record<string, string> = {};
    for (const note of musicxml.notes) {
      if (
        note.startBeat <= currentBeat &&
        currentBeat < note.startBeat + note.durationBeats
      ) {
        colors[
          `p${note.partIndex}-m${note.measureNumber}-n${note.noteIndex}-v${note.voiceIndex}`
        ] = settings.accent;
      }
    }
    return colors;
  }, [control.musicxml, control.currentBeat, settings.accent]);
  const noteColors = useStableNoteColors(computedColors);

  return {
    noteColors,
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
