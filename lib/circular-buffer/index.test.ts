import { describe, expect, test } from "bun:test";
import { CircularBuffer } from "./index";

const CAPACITY = 50;

function makeItem(t: number): { t: number } {
  return { t };
}

describe("CircularBuffer — empty", () => {
  test("size is 0 on construction", () => {
    expect(new CircularBuffer<{ t: number }>(CAPACITY).size).toBe(0);
  });

  test("read returns empty array on construction", () => {
    expect(new CircularBuffer<{ t: number }>(CAPACITY).read()).toEqual([]);
  });
});

describe("CircularBuffer — below capacity", () => {
  test("single item is readable", () => {
    const buf = new CircularBuffer<{ t: number }>(CAPACITY);
    const item = makeItem(1000);
    buf.append(item);
    expect(buf.read()).toEqual([item]);
  });

  test("two items are returned oldest-first", () => {
    const buf = new CircularBuffer<{ t: number }>(CAPACITY);
    const first = makeItem(1000);
    const second = makeItem(2000);
    buf.append(first);
    buf.append(second);
    expect(buf.read()).toEqual([first, second]);
  });

  test("size tracks number of appended items", () => {
    const buf = new CircularBuffer<{ t: number }>(CAPACITY);
    for (let i = 0; i < 10; i++) {
      buf.append(makeItem(i));
    }
    expect(buf.size).toBe(10);
  });
});

describe("CircularBuffer — at and beyond capacity", () => {
  test("size does not exceed capacity", () => {
    const buf = new CircularBuffer<{ t: number }>(CAPACITY);
    for (let i = 0; i < CAPACITY + 10; i++) {
      buf.append(makeItem(i));
    }
    expect(buf.size).toBe(CAPACITY);
  });

  test("exactly capacity items fit without eviction", () => {
    const buf = new CircularBuffer<{ t: number }>(CAPACITY);
    for (let i = 0; i < CAPACITY; i++) {
      buf.append(makeItem(i));
    }
    const result = buf.read();
    expect(result).toHaveLength(CAPACITY);
    expect(result[0].t).toBe(0);
    expect(result[CAPACITY - 1].t).toBe(CAPACITY - 1);
  });

  test("oldest item is evicted when capacity is exceeded", () => {
    const buf = new CircularBuffer<{ t: number }>(CAPACITY);
    for (let i = 0; i < CAPACITY + 1; i++) {
      buf.append(makeItem(i));
    }
    const result = buf.read();
    expect(result).toHaveLength(CAPACITY);
    expect(result[0].t).toBe(1);
    expect(result[CAPACITY - 1].t).toBe(CAPACITY);
  });

  test("oldest N items are evicted after N overwrites", () => {
    const buf = new CircularBuffer<{ t: number }>(CAPACITY);
    const total = CAPACITY + 15;
    for (let i = 0; i < total; i++) {
      buf.append(makeItem(i));
    }
    const result = buf.read();
    expect(result).toHaveLength(CAPACITY);
    expect(result[0].t).toBe(15);
    expect(result[CAPACITY - 1].t).toBe(total - 1);
  });

  test("items are returned in insertion order after wraparound", () => {
    const buf = new CircularBuffer<{ t: number }>(CAPACITY);
    for (let i = 0; i < CAPACITY * 2; i++) {
      buf.append(makeItem(i));
    }
    const result = buf.read();
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].t).toBeLessThan(result[i + 1].t);
    }
  });
});

describe("CircularBuffer — item identity", () => {
  test("returned items are the same objects that were appended", () => {
    const buf = new CircularBuffer<{ t: number }>(CAPACITY);
    const item = makeItem(999);
    buf.append(item);
    expect(buf.read()[0]).toBe(item);
  });
});

describe("CircularBuffer — small capacity", () => {
  test("capacity of 1 always holds only the latest item", () => {
    const buf = new CircularBuffer<{ t: number }>(1);
    buf.append(makeItem(1));
    buf.append(makeItem(2));
    buf.append(makeItem(3));
    expect(buf.read()).toEqual([makeItem(3)]);
    expect(buf.size).toBe(1);
  });

  test("capacity of 2 holds the two most recent items", () => {
    const buf = new CircularBuffer<{ t: number }>(2);
    buf.append(makeItem(1));
    buf.append(makeItem(2));
    buf.append(makeItem(3));
    expect(buf.read()).toEqual([makeItem(2), makeItem(3)]);
  });
});
