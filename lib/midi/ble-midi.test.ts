import { describe, expect, test } from "bun:test";
import { buildBLEMIDIBatch, buildBLEMIDINote, parseBLEMIDI } from "./ble-midi";

describe("buildBLEMIDINote", () => {
  test("builds a Note On packet", () => {
    expect(Array.from(buildBLEMIDINote(60, 100))).toEqual([
      0x80, 0x80, 0x90, 60, 100,
    ]);
  });

  test("builds a Note Off packet for zero velocity", () => {
    expect(Array.from(buildBLEMIDINote(60, 0))).toEqual([
      0x80, 0x80, 0x80, 60, 0,
    ]);
  });

  test("encodes the channel in the status byte", () => {
    expect(Array.from(buildBLEMIDINote(60, 100, 9))).toEqual([
      0x80, 0x80, 0x99, 60, 100,
    ]);
  });

  test("masks note and velocity to 7 bits", () => {
    expect(Array.from(buildBLEMIDINote(200, 200))).toEqual([
      0x80,
      0x80,
      0x90,
      200 & 0x7f,
      200 & 0x7f,
    ]);
  });
});

describe("buildBLEMIDIBatch", () => {
  test("returns an empty buffer for no notes", () => {
    expect(buildBLEMIDIBatch([]).length).toBe(0);
  });

  test("a single note matches buildBLEMIDINote's output", () => {
    expect(
      Array.from(buildBLEMIDIBatch([{ note: 60, velocity: 100 }])),
    ).toEqual(Array.from(buildBLEMIDINote(60, 100)));
  });

  test("multiple notes share one header and repeat the status per note", () => {
    const batch = buildBLEMIDIBatch([
      { note: 60, velocity: 100 },
      { note: 64, velocity: 90 },
    ]);
    expect(Array.from(batch)).toEqual([
      0x80, 0x80, 0x90, 60, 100, 0x80, 0x90, 64, 90,
    ]);
  });

  test("encodes the channel across every note in the batch", () => {
    const batch = buildBLEMIDIBatch(
      [
        { note: 60, velocity: 100 },
        { note: 64, velocity: 0 },
      ],
      9,
    );
    expect(Array.from(batch)).toEqual([
      0x80, 0x80, 0x99, 60, 100, 0x80, 0x99, 64, 0,
    ]);
  });
});

describe("parseBLEMIDI", () => {
  test("parses a single Note On message", () => {
    expect(parseBLEMIDI(new Uint8Array([0x80, 0x80, 0x90, 60, 100]))).toEqual([
      { note: 60, kind: "on" },
    ]);
  });

  test("parses a single Note Off message", () => {
    expect(parseBLEMIDI(new Uint8Array([0x80, 0x80, 0x80, 60, 0]))).toEqual([
      { note: 60, kind: "off" },
    ]);
  });

  test("treats Note On with velocity 0 as off", () => {
    expect(parseBLEMIDI(new Uint8Array([0x80, 0x80, 0x90, 60, 0]))).toEqual([
      { note: 60, kind: "off" },
    ]);
  });

  test("reads the note from a message on a non-zero channel", () => {
    expect(parseBLEMIDI(new Uint8Array([0x80, 0x80, 0x99, 72, 88]))).toEqual([
      { note: 72, kind: "on" },
    ]);
  });

  test("parses multiple explicit-status messages in one packet (buildBLEMIDIBatch's format)", () => {
    const packet = buildBLEMIDIBatch([
      { note: 60, velocity: 100 },
      { note: 64, velocity: 90 },
      { note: 67, velocity: 0 },
    ]);
    expect(parseBLEMIDI(packet)).toEqual([
      { note: 60, kind: "on" },
      { note: 64, kind: "on" },
      { note: 67, kind: "off" },
    ]);
  });

  test("parses running-status messages that omit the repeated status byte", () => {
    // Per the BLE MIDI spec, a message with the same status as the previous
    // one may omit the status byte, carrying only its own timestamp + data.
    const packet = new Uint8Array([
      0x80, // header
      0x80,
      0x90,
      60,
      100, // full message: Note On, note 60
      0x81,
      62,
      90, // running status: timestamp + data only, status stays 0x90
    ]);
    expect(parseBLEMIDI(packet)).toEqual([
      { note: 60, kind: "on" },
      { note: 62, kind: "on" },
    ]);
  });

  test("ignores unhandled message types (e.g. control change)", () => {
    const packet = new Uint8Array([0x80, 0x80, 0xb0, 7, 127]);
    expect(parseBLEMIDI(packet)).toEqual([]);
  });

  test("stops rather than looping forever on a truncated trailing message", () => {
    const packet = new Uint8Array([0x80, 0x80, 0x90, 60]);
    expect(parseBLEMIDI(packet)).toEqual([]);
  });

  test("round-trips a single note through build and parse", () => {
    expect(parseBLEMIDI(buildBLEMIDINote(45, 64))).toEqual([
      { note: 45, kind: "on" },
    ]);
  });
});
