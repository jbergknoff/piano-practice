import { CircularBuffer } from "../lib/circular-buffer";

export const DEBUG_LOG_MAX = 50;

interface DebugEventBase {
  /** Wall-clock timestamp (Date.now()). */
  t: number;
  /** MIDI note number (0–127). */
  note: number;
  kind: "on" | "off";
  /** Measure number at the time of this event (-1 when unavailable). */
  measure: number;
  /** Absolute score beat at the time of this event (-1 when unavailable). */
  beat: number;
  /** All held notes after this event is processed. */
  held: number[];
}

export interface WaitModeDebugEvent extends DebugEventBase {
  mode: "wait";
  /** Wait-point index at the time of this event. */
  pointIndex: number;
  /** Expected note numbers at the current wait point. */
  expected: number[];
  /** Milliseconds elapsed since the last successful advance. */
  msSinceAdvance: number;
  outcome:
    | "advance" // all expected notes held → advanced to next point
    | "wrong" // note not in expected chord (outside grace period)
    | "grace" // wrong note silently ignored within grace period
    | "incomplete" // correct note pressed but not all expected notes held yet
    | "debounce" // within 100 ms anti-race window after last advance
    | "off"; // note-off event (no matching logic runs)
}

export interface PlayalongDebugEvent extends DebugEventBase {
  mode: "playalong";
  outcome:
    | "matched" // note matched a score note within the timing window
    | "extra" // note did not match any score note (wrong or mistimed)
    | "off" // note-off event
    | "inactive"; // playalong not in playing phase
}

export type DebugBeatEvent = WaitModeDebugEvent | PlayalongDebugEvent;

export function newDebugBuffer(): CircularBuffer<DebugBeatEvent> {
  return new CircularBuffer<DebugBeatEvent>(DEBUG_LOG_MAX);
}
