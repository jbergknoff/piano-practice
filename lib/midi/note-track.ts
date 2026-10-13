import type { PlaybackNote } from "../musicxml/musicxml-playback";
import type { ScheduledTrack, TrackClock } from "./beat-scheduler";

// A note whose sounding ends within this many beats of the seek/start point is
// treated as already finished, not still ringing. A note ending exactly on a
// measure boundary (e.g. the last chord before a focus range) can have
// `startBeat + durationBeats` float-overshoot that boundary by an ULP — the sum
// walks a different division sequence than the measure-start beats accumulate —
// so a strict `> fromBeat` test pulls it into the play queue and sounds it at
// the start of the focus range (its onset is in the past, so Web Audio plays it
// immediately). This tolerance is far below any real note length yet far above
// the ULP overshoot, so it drops only the boundary artifact. The beat-based
// track has no measure grid to key on the way the highlight filter does, so a
// small tolerance is the right tool here.
const SEEK_END_TOLERANCE_BEATS = 1e-6;

/**
 * The notes still sounding after `fromBeat` — the subset the track must
 * (re)schedule when it starts or seeks to that beat — sorted by onset. A note
 * qualifies when its sounding span extends past `fromBeat` by more than
 * `SEEK_END_TOLERANCE_BEATS` (see that constant for the focus-range boundary
 * this guards). Tie-continuations (`tieStop`) never begin a fresh sound, so they
 * are excluded.
 */
export function notesSoundingAfter(
  notes: PlaybackNote[],
  fromBeat: number,
): PlaybackNote[] {
  return notes
    .filter(
      (note) =>
        !note.tieStop &&
        note.startBeat + note.durationBeats >
          fromBeat + SEEK_END_TOLERANCE_BEATS,
    )
    .sort((a, b) => a.startBeat - b.startBeat);
}

export interface ScheduledChordNote {
  noteNumber: number;
  velocity: number;
  durationMs: number;
}

/**
 * The piece's notes, as a `BeatScheduler` track: synthesizes each note with
 * Web Audio (unless `skipWebAudio`) and reports each chord through
 * `onNoteScheduled` as it sounds, e.g. to mirror it to the piano.
 */
export class NoteTrack implements ScheduledTrack {
  private notes: PlaybackNote[];
  private activeOscillators: OscillatorNode[] = [];
  private activeGains: AudioNode[] = [];
  // Sorted subset of notes that still need scheduling in the current playback.
  private playQueue: PlaybackNote[] = [];
  private playQueueIndex = 0;

  /** When true, skip Web Audio synthesis (phone speaker) for scheduled notes. */
  skipWebAudio = false;
  /**
   * When set, called once per chord (group of notes at the same beat) when it
   * sounds. Use this to mirror playback to an external device (e.g. via BLE MIDI).
   */
  onNoteScheduled?: (notes: ScheduledChordNote[]) => void;

  constructor(notes: PlaybackNote[]) {
    this.notes = notes;
  }

  reset(fromBeat: number): void {
    this.playQueue = notesSoundingAfter(this.notes, fromBeat);
    this.playQueueIndex = 0;
  }

  scheduleThrough(untilBeat: number, clock: TrackClock): void {
    while (this.playQueueIndex < this.playQueue.length) {
      const first = this.playQueue[this.playQueueIndex];
      if (first.startBeat > untilBeat) {
        break;
      }

      // Collect all notes at the same beat (chord).
      const beatStart = first.startBeat;
      const chordStart = clock.timeOfBeat(beatStart);
      const chord: ScheduledChordNote[] = [];
      while (
        this.playQueueIndex < this.playQueue.length &&
        this.playQueue[this.playQueueIndex].startBeat === beatStart
      ) {
        const note = this.playQueue[this.playQueueIndex];
        const durationSecs = note.durationBeats * clock.secondsPerBeat;
        this.scheduleNote(
          clock.audioContext,
          note.noteNumber,
          chordStart,
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

      if (this.onNoteScheduled) {
        clock.callAt(chordStart, () => this.onNoteScheduled?.(chord));
      }
    }
  }

  cancel(): void {
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
    ctx: AudioContext,
    midiNote: number,
    startTime: number,
    duration: number,
    velocity: number,
  ): void {
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
}
