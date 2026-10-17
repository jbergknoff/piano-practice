import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  BeatScheduler,
  type ScheduledTrack,
  type TrackClock,
} from "./beat-scheduler";
import { type Click, ClickTrack } from "./click-track";

// An AudioContext whose clock only moves when the test says so.
class FakeAudioContext {
  currentTime = 0;
  async resume() {}
  async close() {}
}

// Records what the scheduler asks of a track: each reset, and the audio time
// every whole beat it is asked to schedule would play at.
class RecordingTrack implements ScheduledTrack {
  resets: number[] = [];
  scheduled: { beat: number; time: number }[] = [];
  lastClock: TrackClock | null = null;
  private nextBeat = 0;
  reset(fromBeat: number) {
    this.resets.push(fromBeat);
    this.nextBeat = Math.ceil(fromBeat);
  }
  scheduleThrough(untilBeat: number, clock: TrackClock) {
    this.lastClock = clock;
    while (this.nextBeat <= untilBeat) {
      this.scheduled.push({
        beat: this.nextBeat,
        time: clock.timeOfBeat(this.nextBeat),
      });
      this.nextBeat++;
    }
  }
  cancel() {}
}

// The schedulers' animation-frame ticks, run by hand.
let frames: (() => void)[] = [];
const realRequestAnimationFrame = globalThis.requestAnimationFrame;
beforeEach(() => {
  frames = [];
  globalThis.requestAnimationFrame = ((callback: () => void) => {
    frames.push(callback);
    return frames.length;
  }) as typeof requestAnimationFrame;
});
function runFrame() {
  const pending = frames;
  frames = [];
  for (const callback of pending) {
    callback();
  }
}

let schedulers: BeatScheduler[] = [];
afterEach(() => {
  for (const scheduler of schedulers) {
    scheduler.dispose();
  }
  schedulers = [];
  globalThis.requestAnimationFrame = realRequestAnimationFrame;
});

function makeScheduler(bpm = 120) {
  const audioContext = new FakeAudioContext();
  const scheduler = new BeatScheduler(
    32,
    bpm,
    () => audioContext as unknown as AudioContext,
  );
  schedulers.push(scheduler);
  return { scheduler, audioContext };
}

describe("BeatScheduler", () => {
  test("a lead-in runs the clock before the play position without moving it", async () => {
    const { scheduler, audioContext } = makeScheduler(120);
    const track = new RecordingTrack();
    scheduler.addTrack(track);
    scheduler.seek(8);
    audioContext.currentTime = 10;
    let leadInEnded = false;
    await scheduler.play({
      leadInBeats: 4,
      onLeadInEnd: () => {
        leadInEnded = true;
      },
    });

    // Tracks start four beats early, and beat 8 plays exactly four beats
    // (2 s at 120 BPM) after beat 4.
    expect(track.resets).toEqual([4]);
    expect(track.scheduled[0].beat).toBe(4);
    expect(track.scheduled[0].time).toBeCloseTo(10.05, 9);
    expect(track.lastClock?.timeOfBeat(8)).toBeCloseTo(12.05, 9);

    audioContext.currentTime = 11.5;
    runFrame();
    expect(scheduler.currentBeat).toBe(8);
    expect(leadInEnded).toBe(false);

    audioContext.currentTime = 12.06;
    runFrame();
    expect(leadInEnded).toBe(true);
  });

  test("a tempo change during a lead-in carries on from the beat reached", async () => {
    const { scheduler, audioContext } = makeScheduler(120);
    const track = new RecordingTrack();
    scheduler.addTrack(track);
    audioContext.currentTime = 10;
    await scheduler.play({ leadInBeats: 4 });

    // 0.95 s in at 120 BPM: beat -4 + 1.9.
    audioContext.currentTime = 11;
    scheduler.setBpm(60);
    expect(track.resets[1]).toBeCloseTo(-2.1, 9);
    // At 60 BPM the remaining 2.1 beats take 2.1 s, after the LOOKAHEAD.
    expect(track.lastClock?.timeOfBeat(0)).toBeCloseTo(11.05 + 2.1, 9);
    expect(scheduler.currentBeat).toBe(0);
  });

  test("pausing during a lead-in leaves the position at the play position", async () => {
    const { scheduler, audioContext } = makeScheduler(120);
    scheduler.seek(8);
    await scheduler.play({ leadInBeats: 4 });
    audioContext.currentTime = 1;
    scheduler.pause();
    expect(scheduler.currentBeat).toBe(8);
  });

  test("pausing while play() waits for the audio context calls the play off", async () => {
    const { scheduler } = makeScheduler(120);
    const playing = scheduler.play();
    scheduler.pause();
    await playing;
    expect(scheduler.state).toBe("stopped");
  });

  test("a track added mid-play joins from the current beat", async () => {
    const { scheduler, audioContext } = makeScheduler(120);
    await scheduler.play();
    audioContext.currentTime = 2.05;
    const track = new RecordingTrack();
    scheduler.addTrack(track);
    expect(track.resets[0]).toBeCloseTo(4, 9);
    expect(track.scheduled[0].beat).toBe(4);
    expect(track.scheduled[0].time).toBeCloseTo(2.05, 9);
  });
});

describe("ClickTrack", () => {
  function recordingClock(): {
    clock: TrackClock;
    calls: { time: number; callback: () => void }[];
  } {
    const calls: { time: number; callback: () => void }[] = [];
    return {
      calls,
      clock: {
        audioContext: {} as AudioContext,
        secondsPerBeat: 0.5,
        timeOfBeat: (beat) => 100 + beat * 0.5,
        callAt: (time, callback) => calls.push({ time, callback }),
      },
    };
  }

  function fire(calls: { callback: () => void }[]) {
    for (const call of calls) {
      call.callback();
    }
  }

  test("a count-in clicks each beat before the play position, counting bars from its first beat", () => {
    const clicks: Click[] = [];
    const track = new ClickTrack({
      firstBeat: -8,
      endBeat: 0,
      beatsPerBar: 4,
      onClick: (click) => clicks.push(click),
    });
    const { clock, calls } = recordingClock();
    track.reset(-8);
    track.scheduleThrough(100, clock);
    expect(calls.map((call) => call.time)).toEqual([
      96, 96.5, 97, 97.5, 98, 98.5, 99, 99.5,
    ]);
    fire(calls);
    expect(clicks).toEqual(
      [-8, -7, -6, -5, -4, -3, -2, -1].map((beat, index) => ({
        beat,
        beatInBar: index % 4,
      })),
    );
  });

  test("schedules only up to the look-ahead, then picks up where it left off", () => {
    const track = new ClickTrack({
      firstBeat: 0,
      endBeat: Number.POSITIVE_INFINITY,
      beatsPerBar: 3,
      onClick: () => {},
    });
    const { clock, calls } = recordingClock();
    track.reset(0);
    track.scheduleThrough(1.5, clock);
    track.scheduleThrough(3, clock);
    expect(calls.map((call) => call.time)).toEqual([100, 100.5, 101, 101.5]);
  });

  test("restarting mid-bar resumes at the next beat, keeping the bar count", () => {
    const clicks: Click[] = [];
    const track = new ClickTrack({
      firstBeat: 2,
      endBeat: Number.POSITIVE_INFINITY,
      beatsPerBar: 4,
      onClick: (click) => clicks.push(click),
    });
    const { clock, calls } = recordingClock();
    track.reset(7.25);
    track.scheduleThrough(10, clock);
    fire(calls);
    expect(clicks).toEqual([
      { beat: 8, beatInBar: 2 },
      { beat: 9, beatInBar: 3 },
      { beat: 10, beatInBar: 0 },
    ]);
  });
});
