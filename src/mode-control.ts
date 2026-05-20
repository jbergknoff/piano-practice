import type { VNode } from "preact";
import type { DebugBeatEvent } from "./debug-log";
import type { MidiPlayer } from "./midi-player";
import type { MidiConversionResult } from "./midi-to-musicxml";
import type { BtStatus } from "./useBluetooth";

export interface PlayerHandle {
  play(): Promise<void>;
  pause(): void;
  seek(beat: number): void;
  setBpm(bpm: number): void;
  state(): "stopped" | "playing" | "paused";
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

export interface ModeControl {
  player: PlayerHandle;
  bluetooth: BluetoothHandle;
  setCursor: (beat: number, behavior: "jump" | "smooth") => void;
  setIsPlaying: (playing: boolean) => void;
  /**
   * Live current-beat value — drive UI memos (noteColors, etc.) off this.
   * For event handlers that mustn't go stale, read `currentBeatRef.current`.
   */
  currentBeat: number;
  currentBeatRef: { current: number };
  musicxml: MidiConversionResult | null;
  measureRange: { from: number; to: number } | null;
  fileHash: string | null;
  appendToDebugLog: (event: DebugBeatEvent) => void;
}

export interface ModeHandle {
  noteColors: Record<string, string>;
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
