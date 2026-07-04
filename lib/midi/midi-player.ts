import type { PlaybackNote } from "../musicxml/musicxml-playback";

// How far ahead (seconds) to schedule notes in each scheduler tick.
const SCHEDULE_AHEAD = 0.3;
// Scheduler tick interval (ms).
const SCHEDULER_INTERVAL = 25;
// Small offset so the very first notes are never scheduled in the past.
const LOOKAHEAD = 0.05;
// Minimum gap (ms) between onPositionUpdate callbacks during playback. The rAF
// loop still runs every frame for accurate end detection, but the position is
// only reported ~20×/sec — enough for note highlighting, far fewer re-renders.
const POSITION_UPDATE_INTERVAL = 50;

export class MidiPlayer {
  private audioCtx: AudioContext | null = null;
  private activeOscillators: OscillatorNode[] = [];
  private activeGains: AudioNode[] = [];
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;
  private animFrameId: number | null = null;
  // performance.now() of the last throttled position emit.
  private lastPositionEmit = 0;

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
  private extraTimers: ReturnType<typeof setTimeout>[] = [];

  onPositionUpdate?: (beat: number) => void;
  onEnd?: (beat: number) => void;
  /** When set, the player loops back to startBeat once beat reaches endBeat. */
  focusRange: { startBeat: number; endBeat: number } | null = null;
  /** When true, skip Web Audio synthesis (phone speaker) for scheduled notes. */
  skipWebAudio = false;
  /**
   * When set, called once per chord (group of notes at the same beat) as they
   * are scheduled. Use this to mirror playback to an external device (e.g. via BLE MIDI).
   */
  onNoteScheduled?: (
    notes: { noteNumber: number; velocity: number; durationMs: number }[],
  ) => void;

  constructor(notes: PlaybackNote[], totalBeats: number, bpm = 120) {
    this.notes = notes;
    this.totalBeats = totalBeats;
    this._bpm = bpm;
  }

  get state() {
    return this._state;
  }

  get currentBeat(): number {
    if (this._state !== "playing") {
      return Math.min(this.resumeBeat, this.totalBeats);
    }
    return Math.min(this.elapsedBeat(), this.totalBeats);
  }

  async play(): Promise<void> {
    if (this._state === "playing") {
      return;
    }

    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
    }
    await this.audioCtx.resume();

    const fromBeat = this.resumeBeat;
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
    // Force the first tick to emit immediately.
    this.lastPositionEmit = 0;
    this.startTick();
  }

  // Called every SCHEDULER_INTERVAL ms: schedule any notes whose start time
  // falls within the next SCHEDULE_AHEAD seconds.
  private scheduleUpcoming(): void {
    if (!this.audioCtx) {
      return;
    }
    const ctx = this.audioCtx;
    const secsPerBeat = 60 / this._bpm;
    const horizon = ctx.currentTime + SCHEDULE_AHEAD;

    while (this.playQueueIndex < this.playQueue.length) {
      const first = this.playQueue[this.playQueueIndex];
      const firstStart = this.startAudioTime + first.startBeat * secsPerBeat;
      if (firstStart > horizon) {
        break;
      }

      // Collect all notes at the same beat (chord) within the horizon.
      const beatStart = first.startBeat;
      const chord: {
        noteNumber: number;
        velocity: number;
        durationMs: number;
      }[] = [];

      while (
        this.playQueueIndex < this.playQueue.length &&
        this.playQueue[this.playQueueIndex].startBeat === beatStart
      ) {
        const note = this.playQueue[this.playQueueIndex];
        const noteStart = this.startAudioTime + note.startBeat * secsPerBeat;
        const durationSecs = note.durationBeats * secsPerBeat;
        this.scheduleNote(
          note.noteNumber,
          noteStart,
          durationSecs,
          note.velocity,
        );
        chord.push({
          noteNumber: note.noteNumber,
          velocity: note.velocity,
          durationMs: durationSecs * 1000,
        });
        this.playQueueIndex++;
      }

      if (this.onNoteScheduled && chord.length > 0) {
        const delayMs = Math.max(0, (firstStart - ctx.currentTime) * 1000);
        const timer = setTimeout(() => {
          this.onNoteScheduled?.(chord);
        }, delayMs);
        this.extraTimers.push(timer);
      }
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
    for (const t of this.extraTimers) {
      clearTimeout(t);
    }
    this.activeOscillators = [];
    this.activeGains = [];
    this.extraTimers = [];
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

    if (this.skipWebAudio) {
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

    // Once the note finishes playing, disconnect all its nodes and remove them
    // from the active tracking arrays so they can be garbage collected.
    // Without this, nodes accumulate for the entire duration of playback.
    // All three oscillators share the same stop time, so one handler suffices.
    const noteOscillators: OscillatorNode[] = [osc1, osc2, osc3];
    const noteGains: AudioNode[] = [gain, gain2, gain3, filter];
    osc1.onended = () => {
      for (const node of [...noteOscillators, ...noteGains]) {
        try {
          node.disconnect();
        } catch {}
      }
      this.activeOscillators = this.activeOscillators.filter(
        (o) => !noteOscillators.includes(o),
      );
      this.activeGains = this.activeGains.filter((g) => !noteGains.includes(g));
    };
  }

  /**
   * Schedule a metronome count-in. Fires onBeat(i) at each beat so the caller
   * can send audio (e.g. via BLE MIDI). Returns a cancel function and a promise
   * that resolves when the count-in finishes. Call cancel() to stop early.
   */
  playCountIn(
    beats: number,
    timeSigNum: number,
    onBeat: (beatIndex: number) => void,
  ): { cancel: () => void; done: Promise<void> } {
    const msPerBeat = (60 / this._bpm) * 1000;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let canceled = false;

    let resolvePromise!: () => void;
    const done = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });

    for (let i = 0; i < beats; i++) {
      timers.push(
        setTimeout(() => {
          if (!canceled) {
            onBeat(i);
          }
        }, i * msPerBeat),
      );
    }

    timers.push(
      setTimeout(
        () => {
          if (!canceled) {
            resolvePromise();
          }
        },
        beats * msPerBeat + 80,
      ),
    );

    const cancel = () => {
      canceled = true;
      for (const t of timers) {
        clearTimeout(t);
      }
      resolvePromise();
    };

    return { cancel, done };
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

      // Focus range: stop at the range end and reset the cursor to the range
      // start (like a natural end-of-piece, but resuming from the range start
      // rather than beat 0).
      if (this.focusRange && beat >= this.focusRange.endBeat) {
        this.stopTick();
        this.cancelAll();
        this._state = "stopped";
        this.resumeBeat = this.focusRange.startBeat;
        this.onPositionUpdate?.(this.focusRange.startBeat);
        this.onEnd?.(this.focusRange.startBeat);
        return;
      }

      const nowMs = performance.now();
      if (nowMs - this.lastPositionEmit >= POSITION_UPDATE_INTERVAL) {
        this.lastPositionEmit = nowMs;
        // Clamp to resumeBeat so the cursor never goes before the play-start
        // position. The LOOKAHEAD offset means elapsedBeat() is slightly below
        // the start beat for the first ~50 ms; without this clamp that dip
        // would briefly highlight notes from the measure before the seek target
        // and place the cursor visually to the left of the focus range edge.
        this.onPositionUpdate?.(
          Math.max(this.resumeBeat, Math.min(beat, this.totalBeats)),
        );
      }

      if (beat >= this.totalBeats) {
        this.stopTick();
        this.cancelAll();
        this._state = "stopped";
        this.resumeBeat = 0;
        this.onPositionUpdate?.(0);
        this.onEnd?.(0);
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
