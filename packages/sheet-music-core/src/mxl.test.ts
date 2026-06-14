import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { extractMusicXmlFromMxl } from "./mxl";
import { parseScore } from "./musicxml-parser";
import { musicXmlToConversion } from "./musicxml-playback";

describe("extractMusicXmlFromMxl", () => {
  test("extracts the root score from an .mxl container", async () => {
    const bytes = new Uint8Array(
      readFileSync("tests/fixtures/c-major-melody.mxl"),
    );
    const xml = await extractMusicXmlFromMxl(bytes);

    // The extracted bytes are the score named in META-INF/container.xml, and
    // match the standalone .musicxml fixture they were zipped from.
    expect(xml).toContain("<score-partwise");
    const expected = readFileSync(
      "tests/fixtures/c-major-melody.expected.musicxml",
      "utf8",
    );
    expect(xml).toBe(expected);

    // It parses and derives the same playback data as the raw MusicXML.
    expect(parseScore(xml).parts.length).toBeGreaterThan(0);
    expect(musicXmlToConversion(xml).notes).toHaveLength(8);
  });

  test("rejects bytes that are not a ZIP archive", async () => {
    const notZip = new TextEncoder().encode("<score-partwise/>");
    await expect(extractMusicXmlFromMxl(notZip)).rejects.toThrow(
      /not a valid \.mxl file/i,
    );
  });
});
