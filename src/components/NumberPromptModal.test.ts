import { describe, expect, test } from "bun:test";
import { parseBpm, parseMeasureNumber } from "./NumberPromptModal";

describe("parseBpm", () => {
  test("accepts 20–300 and rounds to a whole BPM", () => {
    expect(parseBpm("20")).toBe(20);
    expect(parseBpm("300")).toBe(300);
    expect(parseBpm("120.4")).toBe(120);
    expect(parseBpm("120.5")).toBe(121);
  });

  test("rejects empty, non-numeric and out-of-range input", () => {
    expect(parseBpm("")).toBeNull();
    expect(parseBpm("  ")).toBeNull();
    expect(parseBpm("abc")).toBeNull();
    expect(parseBpm("19")).toBeNull();
    expect(parseBpm("301")).toBeNull();
  });
});

describe("parseMeasureNumber", () => {
  test("accepts whole numbers from 1 to the last measure", () => {
    expect(parseMeasureNumber("1", 40)).toBe(1);
    expect(parseMeasureNumber("40", 40)).toBe(40);
  });

  test("rejects empty, fractional and out-of-range input", () => {
    expect(parseMeasureNumber("", 40)).toBeNull();
    expect(parseMeasureNumber("2.5", 40)).toBeNull();
    expect(parseMeasureNumber("0", 40)).toBeNull();
    expect(parseMeasureNumber("41", 40)).toBeNull();
  });
});
