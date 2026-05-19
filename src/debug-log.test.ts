import { describe, expect, test } from "bun:test";
import {
  DEBUG_LOG_MAX,
  appendDebugEvent,
  newDebugBuffer,
  readDebugBuffer,
} from "./debug-log";
import type { DebugBeatEvent } from "./debug-log";

function makeWaitEvent(t: number, note = 60): DebugBeatEvent {
  return {
    mode: "wait",
    t,
    note,
    kind: "on",
    pointIndex: 0,
    measure: 1,
    beat: 0,
    expected: [note],
    held: [note],
    msSinceAdvance: 0,
    outcome: "advance",
  };
}

function makePlayalongEvent(t: number, note = 60): DebugBeatEvent {
  return {
    mode: "playalong",
    t,
    note,
    kind: "on",
    measure: 1,
    beat: 0,
    held: [note],
    outcome: "matched",
  };
}

describe("newDebugBuffer", () => {
  test("starts empty", () => {
    const buf = newDebugBuffer();
    expect(buf.count).toBe(0);
    expect(buf.head).toBe(0);
    expect(buf.entries).toEqual([]);
  });

  test("readDebugBuffer returns empty array for fresh buffer", () => {
    expect(readDebugBuffer(newDebugBuffer())).toEqual([]);
  });
});

describe("appendDebugEvent / readDebugBuffer — below capacity", () => {
  test("single event is readable", () => {
    const buf = newDebugBuffer();
    const event = makeWaitEvent(1000);
    appendDebugEvent(buf, event);
    expect(readDebugBuffer(buf)).toEqual([event]);
  });

  test("two events are returned oldest-first", () => {
    const buf = newDebugBuffer();
    const e1 = makeWaitEvent(1000);
    const e2 = makePlayalongEvent(2000);
    appendDebugEvent(buf, e1);
    appendDebugEvent(buf, e2);
    expect(readDebugBuffer(buf)).toEqual([e1, e2]);
  });

  test("count tracks number of events below capacity", () => {
    const buf = newDebugBuffer();
    for (let i = 0; i < 10; i++) {
      appendDebugEvent(buf, makeWaitEvent(i));
    }
    expect(buf.count).toBe(10);
  });
});

describe("appendDebugEvent / readDebugBuffer — at and beyond capacity", () => {
  test("count does not exceed DEBUG_LOG_MAX", () => {
    const buf = newDebugBuffer();
    for (let i = 0; i < DEBUG_LOG_MAX + 10; i++) {
      appendDebugEvent(buf, makeWaitEvent(i));
    }
    expect(buf.count).toBe(DEBUG_LOG_MAX);
  });

  test("exactly DEBUG_LOG_MAX events fit without wrapping", () => {
    const buf = newDebugBuffer();
    for (let i = 0; i < DEBUG_LOG_MAX; i++) {
      appendDebugEvent(buf, makeWaitEvent(i));
    }
    const result = readDebugBuffer(buf);
    expect(result).toHaveLength(DEBUG_LOG_MAX);
    expect(result[0].t).toBe(0);
    expect(result[DEBUG_LOG_MAX - 1].t).toBe(DEBUG_LOG_MAX - 1);
  });

  test("oldest event is evicted when capacity is exceeded", () => {
    const buf = newDebugBuffer();
    for (let i = 0; i < DEBUG_LOG_MAX + 1; i++) {
      appendDebugEvent(buf, makeWaitEvent(i));
    }
    const result = readDebugBuffer(buf);
    expect(result).toHaveLength(DEBUG_LOG_MAX);
    // t=0 was evicted; oldest surviving event has t=1
    expect(result[0].t).toBe(1);
    expect(result[DEBUG_LOG_MAX - 1].t).toBe(DEBUG_LOG_MAX);
  });

  test("oldest N events are evicted after N overwrites", () => {
    const buf = newDebugBuffer();
    const total = DEBUG_LOG_MAX + 15;
    for (let i = 0; i < total; i++) {
      appendDebugEvent(buf, makeWaitEvent(i));
    }
    const result = readDebugBuffer(buf);
    expect(result).toHaveLength(DEBUG_LOG_MAX);
    expect(result[0].t).toBe(15);
    expect(result[DEBUG_LOG_MAX - 1].t).toBe(total - 1);
  });

  test("events are returned in insertion order after wraparound", () => {
    const buf = newDebugBuffer();
    const total = DEBUG_LOG_MAX * 2;
    for (let i = 0; i < total; i++) {
      appendDebugEvent(buf, makeWaitEvent(i));
    }
    const result = readDebugBuffer(buf);
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].t).toBeLessThan(result[i + 1].t);
    }
  });

  test("head wraps back to 0 after DEBUG_LOG_MAX writes", () => {
    const buf = newDebugBuffer();
    for (let i = 0; i < DEBUG_LOG_MAX; i++) {
      appendDebugEvent(buf, makeWaitEvent(i));
    }
    expect(buf.head).toBe(0);
  });
});

describe("readDebugBuffer — event identity", () => {
  test("returned events are the same objects that were appended", () => {
    const buf = newDebugBuffer();
    const event = makeWaitEvent(999);
    appendDebugEvent(buf, event);
    expect(readDebugBuffer(buf)[0]).toBe(event);
  });

  test("mixed wait and playalong events are preserved correctly", () => {
    const buf = newDebugBuffer();
    const wait = makeWaitEvent(1);
    const play = makePlayalongEvent(2);
    appendDebugEvent(buf, wait);
    appendDebugEvent(buf, play);
    const result = readDebugBuffer(buf);
    expect(result[0].mode).toBe("wait");
    expect(result[1].mode).toBe("playalong");
  });
});
