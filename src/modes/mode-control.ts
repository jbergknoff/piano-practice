import type { ScoreConversion } from "../../lib/musicxml/musicxml-playback";
import type { NoteHighlight } from "@jbergknoff/sheet-music-display";
import type { VNode } from "preact";
import type {
  BeatScheduler,
  PlayOptions,
  ScheduledTrack,
} from "../../lib/midi/beat-scheduler";
import type { NoteTrack, ScheduledChordNote } from "../../lib/midi/note-track";
import type { DebugBeatEvent } from "../debug-log";
import type { MeasureRange, NamedRange } from "../selection";

// Re-exported from the display package (its public API) so the rest of the app
// can keep importing the highlight type from mode-control.
export type { NoteHighlight } from "@jbergknoff/sheet-music-display";

/** The three practice modes, persisted in `FileHistory` and driven by `App`. */
export type PracticeMode = "wait" | "playalong" | "listen";

/** A piece's playback: the clock, and the piece's notes as a track on it. */
export interface PiecePlayback {
  scheduler: BeatScheduler;
  notes: NoteTrack;
}

export interface PlayerHandle {
  play(options?: PlayOptions): Promise<void>;
  pause(): void;
  seek(beat: number): void;
  setBpm(bpm: number): void;
  state(): "stopped" | "playing" | "paused";
  /**
   * The exact playback position, read from the audio clock at call time. Use
   * this (not `ModeControl.currentBeatRef`, which trails it by up to a
   * throttled position update) when timing matters, e.g. scoring a note.
   */
  currentBeat(): number;
  /**
   * Add something to play in time with the piece, on the same clock (e.g. a
   * metronome `ClickTrack`). Returns a function that takes it off again.
   */
  addPlaybackTrack(track: ScheduledTrack): () => void;
  /**
   * Install transient onPositionUpdate / onEnd callbacks. Returns an
   * uninstaller that restores the values that were in place at install time.
   */
  installCallbacks(c: {
    onPositionUpdate?: (beat: number) => void;
    onEnd?: (beat: number) => void;
  }): () => void;
  /**
   * Install transient audio routing (skipWebAudio + onNoteScheduled).
   * Returns an uninstaller that restores prior values.
   */
  setAudioRouting(r: {
    skipWebAudio: boolean;
    onNoteScheduled?: (notes: ScheduledChordNote[]) => void;
  }): () => void;
}

/**
 * Build a stable handle that delegates to whatever playback the getter
 * currently returns. This lets the handle outlive player recreation (e.g.
 * on file changes) — methods become no-ops when no playback exists.
 * Uninstallers capture the playback at install time and skip restoration if it
 * has since been replaced.
 */
export function createPlayerHandle(
  getPlayback: () => PiecePlayback | null,
): PlayerHandle {
  const getPlayer = () => getPlayback()?.scheduler ?? null;
  return {
    play: async (options) => {
      const p = getPlayer();
      if (p) {
        await p.play(options);
      }
    },
    pause: () => {
      getPlayer()?.pause();
    },
    seek: (beat) => {
      getPlayer()?.seek(beat);
    },
    setBpm: (bpm) => {
      getPlayer()?.setBpm(bpm);
    },
    state: () => getPlayer()?.state ?? "stopped",
    currentBeat: () => getPlayer()?.currentBeat ?? 0,
    addPlaybackTrack: (track) => getPlayer()?.addTrack(track) ?? (() => {}),
    installCallbacks: (c) => {
      const p = getPlayer();
      if (!p) {
        return () => {};
      }
      const prevOnPositionUpdate = p.onPositionUpdate;
      const prevOnEnd = p.onEnd;
      if ("onPositionUpdate" in c) {
        p.onPositionUpdate = c.onPositionUpdate;
      }
      if ("onEnd" in c) {
        p.onEnd = c.onEnd;
      }
      return () => {
        if (getPlayer() === p) {
          p.onPositionUpdate = prevOnPositionUpdate;
          p.onEnd = prevOnEnd;
        }
      };
    },
    setAudioRouting: (r) => {
      const p = getPlayback()?.notes;
      if (!p) {
        return () => {};
      }
      const prevSkipWebAudio = p.skipWebAudio;
      const prevOnNoteScheduled = p.onNoteScheduled;
      p.skipWebAudio = r.skipWebAudio;
      p.onNoteScheduled = r.onNoteScheduled;
      return () => {
        if (getPlayback()?.notes === p) {
          p.skipWebAudio = prevSkipWebAudio;
          p.onNoteScheduled = prevOnNoteScheduled;
        }
      };
    },
  };
}

/**
 * What a mode can play on the connected piano, whichever way it is connected
 * (Bluetooth or USB). Modes never deal in MIDI notes and channels directly.
 */
export interface PianoOutput {
  /**
   * A closed hi-hat on the piano's drum kit: the metronome's click, and wait
   * mode's wrong-note cue. `velocity` (1–127) sets how loud.
   */
  playHiHat: (velocity: number) => void;
}

/**
 * The neighbouring ranges the result modal offers ("previous"/"next"), each
 * null when there is nowhere to go — see `adjacentRange` in `selection.ts`.
 */
export interface RangeNavigation {
  previous: NamedRange | null;
  next: NamedRange | null;
  goTo: (range: MeasureRange) => void;
}

export interface ModeControl {
  player: PlayerHandle;
  piano: PianoOutput;
  setCursor: (beat: number, behavior: "jump" | "smooth") => void;
  setIsPlaying: (playing: boolean) => void;
  /**
   * Live current-beat value — drive UI memos (noteHighlights, etc.) off this.
   * For event handlers that mustn't go stale, read `currentBeatRef.current`.
   */
  currentBeat: number;
  currentBeatRef: { current: number };
  musicxml: ScoreConversion | null;
  measureRange: MeasureRange | null;
  /**
   * Quarter-note beat at which each measure begins (index 0 = measure 1),
   * cached from `musicxml.measureStartBeats` on file load. Use this — not
   * `(measureNumber - 1) * timeSigNum` — to convert measure numbers to beats.
   */
  measureStartBeats: number[];
  fileHash: string | null;
  rangeNavigation: RangeNavigation;
  appendToDebugLog: (event: DebugBeatEvent) => void;
}

export interface ModeHandle {
  noteHighlights: ReadonlyArray<NoteHighlight>;
  activeRef: { current: boolean };
  onNoteEvent: (noteNumber: number, kind: "on" | "off") => void;
  activate: () => void;
  deactivate: () => void;
  handlePlayPause: () => Promise<void> | void;
  handleReset: () => void;
  handleSeek: (beat: number) => void;
  overlay?: VNode | null;
  modal?: VNode | null;
}
