import type { ScoreConversion } from "../../lib/musicxml/musicxml-playback";
import type { NoteHighlight } from "@jbergknoff/sheet-music-display";
import type { VNode } from "preact";
import type { MetronomeTick, MidiPlayer } from "../../lib/midi/midi-player";
import type { DebugBeatEvent } from "../debug-log";
import type { BtStatus } from "../hooks/use-bluetooth";
import type { MeasureRange, NamedRange } from "../selection";

// Re-exported from the display package (its public API) so the rest of the app
// can keep importing the highlight type from mode-control.
export type { NoteHighlight } from "@jbergknoff/sheet-music-display";

/** The three practice modes, persisted in `FileHistory` and driven by `App`. */
export type PracticeMode = "wait" | "playalong" | "listen";

export interface PlayerHandle {
  play(): Promise<void>;
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
  playCountIn(
    beats: number,
    timeSigNum: number,
    onBeat: (beatIndex: number) => void,
  ): { cancel: () => void; done: Promise<void> };
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
    onNoteScheduled?: (
      notes: { noteNumber: number; velocity: number; durationMs: number }[],
    ) => void;
  }): () => void;
  /**
   * Install a transient metronome: `onTick` fires at each of `ticks` (sorted
   * by beat) as playback reaches it. Returns an uninstaller.
   */
  setMetronome(m: {
    ticks: MetronomeTick[];
    onTick: (tick: MetronomeTick) => void;
  }): () => void;
}

/**
 * Build a stable handle that delegates to whatever MidiPlayer the getter
 * currently returns. This lets the handle outlive player recreation (e.g.
 * on track-selection or file changes) — methods become no-ops when no
 * player exists. Uninstallers capture the player at install time and skip
 * restoration if the player has since been replaced.
 */
export function createPlayerHandle(
  getPlayer: () => MidiPlayer | null,
): PlayerHandle {
  return {
    play: async () => {
      const p = getPlayer();
      if (p) {
        await p.play();
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
    playCountIn: (beats, timeSigNum, onBeat) => {
      const p = getPlayer();
      if (!p) {
        return { cancel: () => {}, done: Promise.resolve() };
      }
      return p.playCountIn(beats, timeSigNum, onBeat);
    },
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
      const p = getPlayer();
      if (!p) {
        return () => {};
      }
      const prevSkipWebAudio = p.skipWebAudio;
      const prevOnNoteScheduled = p.onNoteScheduled;
      p.skipWebAudio = r.skipWebAudio;
      p.onNoteScheduled = r.onNoteScheduled;
      return () => {
        if (getPlayer() === p) {
          p.skipWebAudio = prevSkipWebAudio;
          p.onNoteScheduled = prevOnNoteScheduled;
        }
      };
    },
    setMetronome: (m) => {
      const p = getPlayer();
      if (!p) {
        return () => {};
      }
      p.metronomeTicks = m.ticks;
      p.onMetronomeTick = m.onTick;
      return () => {
        if (getPlayer() === p) {
          p.metronomeTicks = null;
          p.onMetronomeTick = undefined;
        }
      };
    },
  };
}

export interface BluetoothHandle {
  status: BtStatus;
  sendNote: (
    note: number,
    velocity: number,
    durationMs: number,
    channel?: number,
  ) => void;
  sendNotesBatch: (
    notes: { note: number; velocity: number; durationMs: number }[],
    channel?: number,
  ) => void;
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
  bluetooth: BluetoothHandle;
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
