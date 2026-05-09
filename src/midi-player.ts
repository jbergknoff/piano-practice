import type { PlaybackNote } from "./midi-to-musicxml";

export class MidiPlayer {
  private audioCtx: AudioContext | null = null;
  private activeOscillators: OscillatorNode[] = [];
  private activeGains: AudioNode[] = [];
  private startAudioTime = 0;
  private resumeBeat = 0;
  private _bpm: number;
  private notes: PlaybackNote[];
  private totalBeats: number;
  private animFrameId: number | null = null;
  private _state: "stopped" | "playing" | "paused" = "stopped";

  onPositionUpdate?: (beat: number) => void;
  onEnd?: () => void;

  constructor(notes: PlaybackNote[], totalBeats: number, bpm = 120) {
    this.notes = notes;
    this.totalBeats = totalBeats;
    this._bpm = bpm;
  }

  get state() {
    return this._state;
  }

  async play(): Promise<void> {
    if (this._state === "playing") return;

    this.audioCtx ??= new AudioContext();
    if (this.audioCtx.state === "suspended") {
      await this.audioCtx.resume();
    }

    const fromBeat = this._state === "paused" ? this.resumeBeat : 0;
    this.startSchedule(fromBeat);
    this._state = "playing";
  }

  pause(): void {
    if (this._state !== "playing") return;
    this.resumeBeat = this.elapsedBeat();
    this.cancelNodes();
    this.stopTick();
    this._state = "paused";
  }

  stop(): void {
    this.cancelNodes();
    this.stopTick();
    this.resumeBeat = 0;
    this._state = "stopped";
    this.onPositionUpdate?.(0);
  }

  setBpm(bpm: number): void {
    if (bpm === this._bpm) return;
    const wasPlaying = this._state === "playing";
    const beat = this.elapsedBeat();

    if (wasPlaying) {
      this.cancelNodes();
      this.stopTick();
    }

    this._bpm = bpm;

    if (wasPlaying) {
      this.startSchedule(beat);
    }
  }

  dispose(): void {
    this.cancelNodes();
    this.stopTick();
    void this.audioCtx?.close();
    this.audioCtx = null;
  }

  private elapsedBeat(): number {
    if (!this.audioCtx || this._state === "stopped") return this.resumeBeat;
    const elapsedSecs = this.audioCtx.currentTime - this.startAudioTime;
    return this.resumeBeat + elapsedSecs * (this._bpm / 60);
  }

  private startSchedule(fromBeat: number): void {
    if (!this.audioCtx) return;
    this.resumeBeat = fromBeat;
    this.startAudioTime = this.audioCtx.currentTime;

    const secsPerBeat = 60 / this._bpm;
    const now = this.audioCtx.currentTime;

    for (const note of this.notes) {
      if (note.tieStop) continue;
      const noteEnd = note.startBeat + note.durationBeats;
      if (noteEnd <= fromBeat) continue;

      const delayBeats = note.startBeat - fromBeat;
      const noteStart = now + Math.max(0, delayBeats) * secsPerBeat;
      const durationSecs = note.durationBeats * secsPerBeat;
      this.scheduleNote(note.noteNumber, noteStart, durationSecs, note.velocity);
    }

    this.startTick();
  }

  private cancelNodes(): void {
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
  }

  private scheduleNote(
    midiNote: number,
    startTime: number,
    duration: number,
    velocity: number,
  ): void {
    const ctx = this.audioCtx;
    if (!ctx) return;

    const freq = 440 * 2 ** ((midiNote - 69) / 12);
    const vol = (velocity / 127) * 0.22;
    const releaseTime = 0.35;
    const totalDuration = duration + releaseTime;

    // Low-pass filter — brighter at higher velocities, mimicking piano hammer strike
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 800 + (velocity / 127) * 3200;
    filter.Q.value = 0.5;
    filter.connect(ctx.destination);
    this.activeGains.push(filter);

    // Main amplitude envelope
    const gain = ctx.createGain();
    gain.connect(filter);
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(vol, startTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(vol * 0.55, startTime + 0.012 + 0.18);
    gain.gain.setValueAtTime(vol * 0.55, startTime + duration);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration + releaseTime);
    this.activeGains.push(gain);

    // Fundamental oscillator (triangle wave — richer than sine)
    const osc1 = ctx.createOscillator();
    osc1.frequency.value = freq;
    osc1.type = "triangle";
    osc1.connect(gain);
    osc1.start(startTime);
    osc1.stop(startTime + totalDuration);
    this.activeOscillators.push(osc1);

    // 2nd harmonic at lower amplitude
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

    // 3rd harmonic — very subtle
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

  private startTick(): void {
    const tick = () => {
      if (this._state !== "playing") return;

      const beat = this.elapsedBeat();
      this.onPositionUpdate?.(Math.min(beat, this.totalBeats));

      if (beat >= this.totalBeats) {
        this.stopTick();
        this.cancelNodes();
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
