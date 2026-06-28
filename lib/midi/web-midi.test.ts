import { describe, expect, it } from "bun:test";
import { buildNoteMessage, parseMidiMessage } from "./web-midi";

describe("parseMidiMessage", () => {
  it("parses a Note On as on", () => {
    expect(parseMidiMessage(new Uint8Array([0x90, 60, 100]))).toEqual([
      { note: 60, kind: "on" },
    ]);
  });

  it("parses a Note Off as off", () => {
    expect(parseMidiMessage(new Uint8Array([0x80, 60, 0]))).toEqual([
      { note: 60, kind: "off" },
    ]);
  });

  it("treats Note On with velocity 0 as off", () => {
    expect(parseMidiMessage(new Uint8Array([0x90, 64, 0]))).toEqual([
      { note: 64, kind: "off" },
    ]);
  });

  it("reads the note and velocity from a message on a non-zero channel", () => {
    expect(parseMidiMessage(new Uint8Array([0x95, 72, 88]))).toEqual([
      { note: 72, kind: "on" },
    ]);
  });

  it("ignores non note-on/off messages (e.g. control change)", () => {
    expect(parseMidiMessage(new Uint8Array([0xb0, 7, 127]))).toEqual([]);
  });

  it("ignores truncated messages", () => {
    expect(parseMidiMessage(new Uint8Array([0x90, 60]))).toEqual([]);
  });
});

describe("buildNoteMessage", () => {
  it("builds a Note On for positive velocity", () => {
    expect(buildNoteMessage(60, 100)).toEqual([0x90, 60, 100]);
  });

  it("builds a Note Off for zero velocity", () => {
    expect(buildNoteMessage(60, 0)).toEqual([0x80, 60, 0]);
  });

  it("encodes the channel in the status byte", () => {
    expect(buildNoteMessage(60, 100, 3)).toEqual([0x93, 60, 100]);
  });

  it("masks note and velocity to 7 bits", () => {
    expect(buildNoteMessage(200, 200)).toEqual([0x90, 200 & 0x7f, 200 & 0x7f]);
  });
});
