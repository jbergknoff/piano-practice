import type { ScheduledTrack, TrackClock } from "./beat-scheduler";

export interface Click {
  /** The beat the click falls on. */
  beat: number;
  /** 0 on the first beat of each bar, counted from the track's `firstBeat`. */
  beatInBar: number;
}

/**
 * A metronome, as a `BeatScheduler` track: one click per beat from `firstBeat`
 * up to (not including) `endBeat`, each delivered through `onClick` when it
 * falls due. The track makes no sound itself; `onClick` decides what a click
 * is (e.g. a hi-hat note sent to the piano).
 *
 * Bars are counted from `firstBeat`, so start the track on a downbeat. A
 * count-in is just clicks before the play position: start the track
 * `leadInBeats` early and play with the same `leadInBeats`.
 */
export class ClickTrack implements ScheduledTrack {
  private readonly firstBeat: number;
  private readonly endBeat: number;
  private readonly beatsPerBar: number;
  private readonly onClick: (click: Click) => void;
  // Index (from firstBeat) of the next click to schedule.
  private nextIndex = 0;

  constructor(options: {
    firstBeat: number;
    endBeat: number;
    beatsPerBar: number;
    onClick: (click: Click) => void;
  }) {
    this.firstBeat = options.firstBeat;
    this.endBeat = options.endBeat;
    this.beatsPerBar = options.beatsPerBar;
    this.onClick = options.onClick;
  }

  reset(fromBeat: number): void {
    // The first click at or after fromBeat. The tolerance keeps a click that
    // lands exactly on fromBeat (as a float) from being skipped.
    this.nextIndex = Math.max(0, Math.ceil(fromBeat - this.firstBeat - 1e-9));
  }

  scheduleThrough(untilBeat: number, clock: TrackClock): void {
    for (;;) {
      const beat = this.firstBeat + this.nextIndex;
      if (beat > untilBeat || beat >= this.endBeat) {
        return;
      }
      const click = { beat, beatInBar: this.nextIndex % this.beatsPerBar };
      clock.callAt(clock.timeOfBeat(beat), () => this.onClick(click));
      this.nextIndex++;
    }
  }

  cancel(): void {}
}
