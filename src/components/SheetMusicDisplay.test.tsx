/**
 * Render-level tests: mount the real SheetMusicDisplay component into a linkedom
 * DOM (set up in src/test-setup.ts) and inspect the SVG it produces. These
 * complement the data-layer tests in lib/musicxml by verifying that notation
 * decisions actually reach the rendered glyphs — accidentals, chord accidental
 * staggering, beat-grouped beams, and staccato dots.
 */
import { describe, expect, test } from "bun:test";
import { render } from "preact";
import { SheetMusicDisplay } from "./SheetMusicDisplay";

// SMuFL glyphs we assert on (must match the G map in SheetMusicDisplay.tsx).
const SHARP = "";
const NATURAL = "";

// Mount the component and return its root <svg> plus a few query helpers.
function renderSheetMusic(
  musicxml: string,
  props: Record<string, unknown> = {},
) {
  const container = document.createElement("div");
  render(
    <SheetMusicDisplay musicxml={musicxml} {...props} />,
    container as unknown as Element,
  );
  const svg = container.querySelector("svg");
  if (!svg) {
    throw new Error("SheetMusicDisplay produced no <svg>");
  }
  const textsWith = (glyph: string) =>
    Array.from(svg.querySelectorAll("text")).filter((t) =>
      (t.textContent ?? "").includes(glyph),
    );
  const linesWithStrokeWidth = (w: string) =>
    Array.from(svg.querySelectorAll("line")).filter(
      (l) => l.getAttribute("stroke-width") === w,
    );
  return {
    svg,
    container,
    textsWith,
    linesWithStrokeWidth,
    circles: () => Array.from(svg.querySelectorAll("circle")),
  };
}

// ── MusicXML builders ─────────────────────────────────────────────────────────

interface NoteSpec {
  step: string;
  octave: number;
  alter?: number;
  duration: number;
  type: string;
  chord?: boolean;
  dot?: boolean;
  staccato?: boolean;
}

function noteXml(n: NoteSpec): string {
  const parts = ["<note>"];
  if (n.chord) {
    parts.push("<chord/>");
  }
  parts.push(`<pitch><step>${n.step}</step>`);
  if (n.alter) {
    parts.push(`<alter>${n.alter}</alter>`);
  }
  parts.push(`<octave>${n.octave}</octave></pitch>`);
  parts.push(`<duration>${n.duration}</duration>`);
  parts.push(`<type>${n.type}</type>`);
  if (n.dot) {
    parts.push("<dot/>");
  }
  if (n.staccato) {
    parts.push(
      "<notations><articulations><staccato/></articulations></notations>",
    );
  }
  parts.push("</note>");
  return parts.join("");
}

function scoreXml(
  notes: NoteSpec[],
  { beats = 4, beatType = 4, fifths = 0 } = {},
): string {
  const attributes = `<attributes><divisions>4</divisions><key><fifths>${fifths}</fifths><mode>major</mode></key><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>`;
  return `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1"><measure number="1">${attributes}${notes.map(noteXml).join("")}</measure></part></score-partwise>`;
}

const QUARTER = (step: string, octave: number, alter = 0): NoteSpec => ({
  step,
  octave,
  alter,
  duration: 4,
  type: "quarter",
});
const EIGHTH = (step: string, octave: number): NoteSpec => ({
  step,
  octave,
  duration: 2,
  type: "eighth",
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SheetMusicDisplay rendering", () => {
  test("renders an <svg> with a notehead glyph for each note", () => {
    const { svg } = renderSheetMusic(
      scoreXml([QUARTER("C", 4), QUARTER("D", 4)]),
    );
    expect(svg.querySelectorAll("text").length).toBeGreaterThan(0);
    // Black noteheads (U+E0A4) — one per quarter note.
    const noteheads = Array.from(svg.querySelectorAll("text")).filter((t) =>
      (t.textContent ?? "").includes(""),
    );
    expect(noteheads).toHaveLength(2);
  });

  test("a natural cancels a sharp earlier in the measure", () => {
    // C#4, C4, D4 → one sharp glyph, one natural glyph.
    const { textsWith } = renderSheetMusic(
      scoreXml([QUARTER("C", 4, 1), QUARTER("C", 4, 0), QUARTER("D", 4)]),
    );
    expect(textsWith(SHARP)).toHaveLength(1);
    expect(textsWith(NATURAL)).toHaveLength(1);
  });

  test("two accidentals in a chord are staggered horizontally", () => {
    // F#4 + D#5 (a sixth apart) — both sharps, placed in different columns.
    const { textsWith } = renderSheetMusic(
      scoreXml([
        {
          step: "F",
          octave: 4,
          alter: 1,
          duration: 12,
          type: "half",
          dot: true,
        },
        {
          step: "D",
          octave: 5,
          alter: 1,
          duration: 12,
          type: "half",
          dot: true,
          chord: true,
        },
      ]),
    );
    const sharps = textsWith(SHARP);
    expect(sharps).toHaveLength(2);
    const xs = sharps.map((t) => Number(t.getAttribute("x")));
    expect(Math.abs(xs[0] - xs[1])).toBeGreaterThan(5);
  });

  test("staccato renders a dot; a plain note renders none", () => {
    const plain = renderSheetMusic(scoreXml([QUARTER("G", 4)]));
    expect(plain.circles()).toHaveLength(0);

    const staccato = renderSheetMusic(
      scoreXml([
        { step: "G", octave: 4, duration: 4, type: "quarter", staccato: true },
      ]),
    );
    expect(staccato.circles()).toHaveLength(1);
  });

  test("a six-eighth run in 3/4 beams as three per-beat groups", () => {
    // Without beat grouping this would be a single beam spanning the measure.
    const { linesWithStrokeWidth } = renderSheetMusic(
      scoreXml(
        [
          EIGHTH("G", 4),
          EIGHTH("A", 4),
          EIGHTH("B", 4),
          EIGHTH("C", 5),
          EIGHTH("D", 5),
          EIGHTH("E", 5),
        ],
        { beats: 3, beatType: 4 },
      ),
    );
    // Beam lines use stroke-width = staffSpace * 0.5 = 5 (default staffSpace 10).
    expect(linesWithStrokeWidth("5")).toHaveLength(3);
  });
});
