import type { PlaybackNote } from "./midi-to-musicxml";

// How far ahead (seconds) to schedule notes in each scheduler tick.
const SCHEDULE_AHEAD = 0.3;
// Scheduler tick interval (ms).
const SCHEDULER_INTERVAL = 25;
// Small offset so the very first notes are never scheduled in the past.
const LOOKAHEAD = 0.05;

export class MidiPlayer {
  private audioCtx: AudioContext | null = null;
  private activeOscillators: OscillatorNode[] = [];
  private activeGains: AudioNode[] = [];
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;
  private animFrameId: number | null = null;

  // Sorted subset of notes that still need scheduling in the current playback.
  private playQueue: PlaybackNote[] = [];
  private playQueueIndex = 0;

  // AudioContext.currentTime at which beat 0 of the piece plays.
  private startAudioTime = 0;
  private resumeBeat = 0;
  private _bpm: number;
  private notes: PlaybackNote[];
  private totalBeats: number;
  private _state: "stopped" | "playing" | "paused" = "stopped";

  onPositionUpdate?: (beat: number) => void;
  onEnd?: () => void;
  /** When set, the player loops back to startBeat once beat reaches endBeat. */
  loopRange: { startBeat: number; endBeat: number } | null = null;

  constructor(notes: PlaybackNote[], totalBeats: number, bpm = 120) {
    this.notes = notes;
    this.totalBeats = totalBeats;
    this._bpm = bpm;
  }

  get state() {
    return this._state;
  }

  async play(): Promise<void> {
    if (this._state === "playing") {
      return;
    }

    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
    }
    await this.audioCtx.resume();

    const fromBeat = this._state === "paused" ? this.resumeBeat : 0;
    this.startSchedule(fromBeat);
    this._state = "playing";
  }

  pause(): void {
    if (this._state !== "playing") {
      return;
    }
    this.resumeBeat = this.elapsedBeat();
    this.cancelAll();
    this.stopTick();
    this._state = "paused";
  }

  stop(): void {
    this.cancelAll();
    this.stopTick();
    this.resumeBeat = 0;
    this._state = "stopped";
    this.onPositionUpdate?.(0);
  }

  setBpm(bpm: number): void {
    if (bpm === this._bpm) {
      return;
    }
    const wasPlaying = this._state === "playing";
    const beat = wasPlaying ? this.elapsedBeat() : this.resumeBeat;

    if (wasPlaying) {
      this.cancelAll();
      this.stopTick();
    }

    this._bpm = bpm;

    if (wasPlaying) {
      this.startSchedule(beat);
    }
  }

  dispose(): void {
    this.cancelAll();
    this.stopTick();
    void this.audioCtx?.close();
    this.audioCtx = null;
  }

  private elapsedBeat(): number {
    if (!this.audioCtx || this._state === "stopped") {
      return this.resumeBeat;
    }
    return (this.audioCtx.currentTime - this.startAudioTime) * (this._bpm / 60);
  }

  private startSchedule(fromBeat: number): void {
    if (!this.audioCtx) {
      return;
    }
    const secsPerBeat = 60 / this._bpm;

    // startAudioTime is the AudioContext time at which beat 0 of the piece
    // would play.  Adding LOOKAHEAD ensures the first scheduled note is always
    // slightly in the future when the engine picks it up.
    this.startAudioTime =
      this.audioCtx.currentTime + LOOKAHEAD - fromBeat * secsPerBeat;

    this.resumeBeat = fromBeat;

    // Build a sorted queue of notes that haven't finished yet.
    this.playQueue = this.notes
      .filter((n) => !n.tieStop && n.startBeat + n.durationBeats > fromBeat)
      .sort((a, b) => a.startBeat - b.startBeat);
    this.playQueueIndex = 0;

    this.scheduleUpcoming();
    this.schedulerTimer = setInterval(
      () => this.scheduleUpcoming(),
      SCHEDULER_INTERVAL,
    );
    this.startTick();
  }

  // Called every SCHEDULER_INTERVAL ms: schedule any notes whose start time
  // falls within the next SCHEDULE_AHEAD seconds.
  private scheduleUpcoming(): void {
    if (!this.audioCtx) {
      return;
    }
    const secsPerBeat = 60 / this._bpm;
    const horizon = this.audioCtx.currentTime + SCHEDULE_AHEAD;

    while (this.playQueueIndex < this.playQueue.length) {
      const note = this.playQueue[this.playQueueIndex];
      const noteStart = this.startAudioTime + note.startBeat * secsPerBeat;
      if (noteStart > horizon) {
        break;
      }

      const durationSecs = note.durationBeats * secsPerBeat;
      this.scheduleNote(
        note.noteNumber,
        noteStart,
        durationSecs,
        note.velocity,
      );
      this.playQueueIndex++;
    }
  }

  private cancelAll(): void {
    if (this.schedulerTimer !== null) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    for (const osc of this.activeOscillators) {
      try {
        osc.stop(0);
      } catch {}
      osc.disconnect();
    }
    for (const node of this.activeGains) {
      node.disconnect();
    }
    this.activeOscillators = [];
    this.activeGains = [];
    this.playQueue = [];
    this.playQueueIndex = 0;
  }

  private scheduleNote(
    midiNote: number,
    startTime: number,
    duration: number,
    velocity: number,
  ): void {
    const ctx = this.audioCtx;
    if (!ctx) {
      return;
    }

    const freq = 440 * 2 ** ((midiNote - 69) / 12);
    const vol = (velocity / 127) * 0.22;
    const releaseTime = 0.35;
    const totalDuration = duration + releaseTime;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 800 + (velocity / 127) * 3200;
    filter.Q.value = 0.5;
    filter.connect(ctx.destination);
    this.activeGains.push(filter);

    const gain = ctx.createGain();
    gain.connect(filter);
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(vol, startTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(
      vol * 0.55,
      startTime + 0.012 + 0.18,
    );
    gain.gain.setValueAtTime(vol * 0.55, startTime + duration);
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      startTime + duration + releaseTime,
    );
    this.activeGains.push(gain);

    const osc1 = ctx.createOscillator();
    osc1.frequency.value = freq;
    osc1.type = "triangle";
    osc1.connect(gain);
    osc1.start(startTime);
    osc1.stop(startTime + totalDuration);
    this.activeOscillators.push(osc1);

    const gain2 = ctx.createGain();
    gain2.gain.value = 0.22;
    gain2.connect(gain);
    this.activeGains.push(gain2);

    const osc2 = ctx.createOscillator();
    osc2.frequency.value = freq * 2;
    osc2.type = "sine";
    osc2.connect(gain2);
    osc2.start(startTime);
    osc2.stop(startTime + totalDuration);
    this.activeOscillators.push(osc2);

    const gain3 = ctx.createGain();
    gain3.gain.value = 0.08;
    gain3.connect(gain);
    this.activeGains.push(gain3);

    const osc3 = ctx.createOscillator();
    osc3.frequency.value = freq * 3;
    osc3.type = "sine";
    osc3.connect(gain3);
    osc3.start(startTime);
    osc3.stop(startTime + totalDuration);
    this.activeOscillators.push(osc3);
  }

  /** Seek to a beat position. If playing, restarts audio from that beat. */
  seek(beat: number): void {
    if (this._state === "playing") {
      this.cancelAll();
      this.stopTick();
      this.startSchedule(beat);
    } else {
      this.resumeBeat = beat;
      this.onPositionUpdate?.(beat);
    }
  }

  private startTick(): void {
    const tick = () => {
      if (this._state !== "playing") {
        return;
      }

      const beat = this.elapsedBeat();

      // Loop range takes priority: restart before the end-of-piece check fires.
      if (this.loopRange && beat >= this.loopRange.endBeat) {
        this.cancelAll();
        this.stopTick();
        this.startSchedule(this.loopRange.startBeat);
        return;
      }

      this.onPositionUpdate?.(Math.min(beat, this.totalBeats));

      if (beat >= this.totalBeats) {
        this.stopTick();
        this.cancelAll();
        this._state = "stopped";
        this.resumeBeat = 0;
        this.onPositionUpdate?.(0);
        this.onEnd?.();
        return;
      }

      this.animFrameId = requestAnimationFrame(tick);
    };
    this.animFrameId = requestAnimationFrame(tick);
  }

  private stopTick(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }
}
