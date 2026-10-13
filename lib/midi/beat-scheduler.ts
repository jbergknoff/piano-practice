// How far ahead (seconds) to schedule events in each scheduler tick.
const SCHEDULE_AHEAD = 0.3;
// Scheduler tick interval (ms).
const SCHEDULER_INTERVAL = 25;
// Small offset so the very first events are never scheduled in the past.
const LOOKAHEAD = 0.05;
// Minimum gap (ms) between onPositionUpdate callbacks during playback. The rAF
// loop still runs every frame for accurate end detection, but the position is
// only reported ~20×/sec — enough for note highlighting, far fewer re-renders.
const POSITION_UPDATE_INTERVAL = 50;

/**
 * What a track sees of the scheduler while it schedules: the audio context to
 * schedule Web Audio nodes on, the beat → audio-time mapping, and `callAt` for
 * work that can't be handed to Web Audio (e.g. sending a MIDI message to the
 * piano), which runs on a timer as close to that audio time as timers allow.
 * Timers set through `callAt` are cleared whenever the track is cancelled.
 */
export interface TrackClock {
  audioContext: AudioContext;
  secondsPerBeat: number;
  timeOfBeat(beat: number): number;
  callAt(audioTime: number, callback: () => void): void;
}

/**
 * Something that plays in time with the scheduler: the piece's notes
 * (`NoteTrack`), a metronome (`ClickTrack`). The scheduler drives every track
 * from the same clock, so they cannot drift apart.
 */
export interface ScheduledTrack {
  /** Playback (re)starts at `fromBeat`: forget the queue and resume from there. */
  reset(fromBeat: number): void;
  /** Schedule every event whose onset is at or before `untilBeat`. */
  scheduleThrough(untilBeat: number, clock: TrackClock): void;
  /** Silence whatever has been scheduled but not yet played out. */
  cancel(): void;
}

export interface PlayOptions {
  /**
   * Run the clock this many beats before the play position first, e.g. for a
   * count-in. Tracks are scheduled from the earlier beat (so a `ClickTrack`
   * clicks through it), while `currentBeat` and position updates hold at the
   * play position until the clock reaches it.
   */
  leadInBeats?: number;
  /** Called once the clock reaches the play position after a lead-in. */
  onLeadInEnd?: () => void;
}

export type SchedulerState = "stopped" | "playing" | "paused";

/**
 * The playback clock: maps quarter-note beats onto the Web Audio clock at the
 * current tempo, and runs the look-ahead loop that has each registered track
 * schedule its events a little ahead of time. Play/pause/seek/tempo changes
 * apply to every track at once. It knows nothing about notes — those are a
 * `NoteTrack`.
 *
 * Beats are scheduled on the audio clock (`AudioContext.currentTime`), not on
 * timers: a timer only decides *when to schedule*, never *when a sound plays*,
 * so timer jitter doesn't reach the audio.
 */
export class BeatScheduler {
  private audioCtx: AudioContext | null = null;
  private readonly createAudioContext: () => AudioContext;
  private tracks: ScheduledTrack[] = [];
  private trackTimers = new Map<
    ScheduledTrack,
    ReturnType<typeof setTimeout>[]
  >();
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;
  private animFrameId: number | null = null;
  // performance.now() of the last throttled position emit.
  private lastPositionEmit = 0;

  // AudioContext.currentTime at which beat 0 of the piece plays.
  private startAudioTime = 0;
  // The play position: where playback started or was last moved to. Reported
  // positions never go below it (see `currentBeat`).
  private resumeBeat = 0;
  private _bpm: number;
  private totalBeats: number;
  private _state: SchedulerState = "stopped";
  private onLeadInEnd: (() => void) | null = null;
  // Bumped by every play/pause/dispose, so a play() still waiting on the audio
  // context to resume knows it has been called off or overtaken by another.
  private playGeneration = 0;

  onPositionUpdate?: (beat: number) => void;
  onEnd?: (beat: number) => void;
  /** When set, playback stops once the beat reaches endBeat and rewinds to startBeat. */
  focusRange: { startBeat: number; endBeat: number } | null = null;

  constructor(
    totalBeats: number,
    bpm = 120,
    createAudioContext: () => AudioContext = () => new AudioContext(),
  ) {
    this.totalBeats = totalBeats;
    this._bpm = bpm;
    this.createAudioContext = createAudioContext;
  }

  get state(): SchedulerState {
    return this._state;
  }

  get currentBeat(): number {
    if (this._state !== "playing") {
      return Math.min(this.resumeBeat, this.totalBeats);
    }
    // Clamped to resumeBeat: the LOOKAHEAD offset (and any lead-in) puts the
    // clock before the play position for a while after play starts.
    return Math.max(
      this.resumeBeat,
      Math.min(this.elapsedBeat(), this.totalBeats),
    );
  }

  /**
   * Register a track. While playing it joins in from the current beat. Returns
   * a function that removes it again (cancelling anything it has scheduled).
   */
  addTrack(track: ScheduledTrack): () => void {
    this.tracks.push(track);
    if (this._state === "playing" && this.audioCtx) {
      track.reset(this.elapsedBeat());
      track.scheduleThrough(this.horizonBeat(), this.clockFor(track));
    }
    return () => {
      const index = this.tracks.indexOf(track);
      if (index === -1) {
        return;
      }
      this.tracks.splice(index, 1);
      this.cancelTrack(track);
    };
  }

  async play(options: PlayOptions = {}): Promise<void> {
    if (this._state === "playing") {
      return;
    }
    if (!this.audioCtx) {
      this.audioCtx = this.createAudioContext();
    }
    const generation = ++this.playGeneration;
    await this.audioCtx.resume();
    if (generation !== this.playGeneration) {
      return;
    }

    const leadInBeats = options.leadInBeats ?? 0;
    this.onLeadInEnd = leadInBeats > 0 ? (options.onLeadInEnd ?? null) : null;
    this._state = "playing";
    this.startSchedule(this.resumeBeat - leadInBeats);
    if (leadInBeats <= 0) {
      options.onLeadInEnd?.();
    }
  }

  pause(): void {
    this.playGeneration++;
    if (this._state !== "playing") {
      return;
    }
    this.resumeBeat = this.currentBeat;
    this.stopSchedule();
    this.onLeadInEnd = null;
    this._state = "paused";
  }

  setBpm(bpm: number): void {
    if (bpm === this._bpm) {
      return;
    }
    if (this._state !== "playing") {
      this._bpm = bpm;
      return;
    }
    // Carry on from the exact beat the clock has reached (which, during a
    // lead-in, is still before the play position), at the new tempo.
    const beat = this.elapsedBeat();
    // Past the play position, hold reported positions at the beat reached, so
    // the restart's LOOKAHEAD dip can't pull the cursor back.
    this.resumeBeat = Math.max(this.resumeBeat, beat);
    this.stopSchedule();
    this._bpm = bpm;
    this.startSchedule(beat);
  }

  /** Seek to a beat position. If playing, restarts every track from that beat. */
  seek(beat: number): void {
    this.resumeBeat = beat;
    if (this._state === "playing") {
      this.stopSchedule();
      this.startSchedule(beat);
    } else {
      this.onPositionUpdate?.(beat);
    }
  }

  dispose(): void {
    this.playGeneration++;
    this.stopSchedule();
    this.onLeadInEnd = null;
    this._state = "stopped";
    void this.audioCtx?.close();
    this.audioCtx = null;
  }

  private elapsedBeat(): number {
    if (!this.audioCtx || this._state !== "playing") {
      return this.resumeBeat;
    }
    return (this.audioCtx.currentTime - this.startAudioTime) * (this._bpm / 60);
  }

  // The last beat the look-ahead window reaches right now.
  private horizonBeat(): number {
    if (!this.audioCtx) {
      return Number.NEGATIVE_INFINITY;
    }
    return (
      (this.audioCtx.currentTime + SCHEDULE_AHEAD - this.startAudioTime) *
      (this._bpm / 60)
    );
  }

  private clockFor(track: ScheduledTrack): TrackClock {
    const audioContext = this.audioCtx as AudioContext;
    const secondsPerBeat = 60 / this._bpm;
    const startAudioTime = this.startAudioTime;
    return {
      audioContext,
      secondsPerBeat,
      timeOfBeat: (beat) => startAudioTime + beat * secondsPerBeat,
      callAt: (audioTime, callback) => {
        const delayMs = Math.max(
          0,
          (audioTime - audioContext.currentTime) * 1000,
        );
        const timers = this.trackTimers.get(track) ?? [];
        timers.push(setTimeout(callback, delayMs));
        this.trackTimers.set(track, timers);
      },
    };
  }

  // Start the clock so that `fromBeat` plays LOOKAHEAD seconds from now, and
  // start the look-ahead loop and the position ticks.
  private startSchedule(fromBeat: number): void {
    if (!this.audioCtx) {
      return;
    }
    this.startAudioTime =
      this.audioCtx.currentTime + LOOKAHEAD - fromBeat * (60 / this._bpm);
    for (const track of this.tracks) {
      track.reset(fromBeat);
    }
    this.scheduleUpcoming();
    this.schedulerTimer = setInterval(
      () => this.scheduleUpcoming(),
      SCHEDULER_INTERVAL,
    );
    // Force the first tick to emit immediately.
    this.lastPositionEmit = 0;
    this.startTick();
  }

  // Called every SCHEDULER_INTERVAL ms: each track schedules whatever falls in
  // the next SCHEDULE_AHEAD seconds.
  private scheduleUpcoming(): void {
    if (!this.audioCtx) {
      return;
    }
    const untilBeat = this.horizonBeat();
    for (const track of this.tracks) {
      track.scheduleThrough(untilBeat, this.clockFor(track));
    }
  }

  private cancelTrack(track: ScheduledTrack): void {
    track.cancel();
    for (const timer of this.trackTimers.get(track) ?? []) {
      clearTimeout(timer);
    }
    this.trackTimers.delete(track);
  }

  private stopSchedule(): void {
    if (this.schedulerTimer !== null) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    for (const track of this.tracks) {
      this.cancelTrack(track);
    }
  }

  // Playback reached its end (of the piece or the focus range): stop, and
  // rewind to `rewindTo` so the next play starts there.
  private finish(rewindTo: number): void {
    this.stopSchedule();
    this._state = "stopped";
    this.resumeBeat = rewindTo;
    this.onPositionUpdate?.(rewindTo);
    this.onEnd?.(rewindTo);
  }

  private startTick(): void {
    const tick = () => {
      if (this._state !== "playing") {
        return;
      }

      const beat = this.elapsedBeat();

      if (this.onLeadInEnd && beat >= this.resumeBeat) {
        const onLeadInEnd = this.onLeadInEnd;
        this.onLeadInEnd = null;
        onLeadInEnd();
        if (this._state !== "playing") {
          return;
        }
      }

      // Focus range: stop at the range end and reset the cursor to the range
      // start (like a natural end-of-piece, but resuming from the range start
      // rather than beat 0).
      if (this.focusRange && beat >= this.focusRange.endBeat) {
        this.finish(this.focusRange.startBeat);
        return;
      }

      const nowMs = performance.now();
      if (nowMs - this.lastPositionEmit >= POSITION_UPDATE_INTERVAL) {
        this.lastPositionEmit = nowMs;
        // Clamp to resumeBeat so the cursor never goes before the play-start
        // position. The LOOKAHEAD offset means elapsedBeat() is slightly below
        // the start beat for the first ~50 ms (and a lead-in for longer);
        // without this clamp that dip would briefly highlight notes from the
        // measure before the seek target and place the cursor visually to the
        // left of the focus range edge.
        this.onPositionUpdate?.(this.currentBeat);
      }

      if (beat >= this.totalBeats) {
        this.finish(0);
        return;
      }

      this.animFrameId = requestAnimationFrame(tick);
    };
    this.animFrameId = requestAnimationFrame(tick);
  }
}
