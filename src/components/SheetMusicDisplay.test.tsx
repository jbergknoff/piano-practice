/**
 * Render-level tests: mount the real SheetMusicDisplay component into a linkedom
 * DOM (set up in src/test-setup.ts) and inspect the SVG it produces. These
 * complement the data-layer tests in lib/musicxml by verifying that notation
 * decisions actually reach the rendered glyphs and geometry — note positions,
 * stem direction, ledger lines, chord spacing, accidentals, beams, staccato.
 */
import { describe, expect, test } from "bun:test";
import { render } from "preact";
import { SheetMusicDisplay } from "./SheetMusicDisplay";

// SMuFL glyphs we assert on (must match the G map in SheetMusicDisplay.tsx).
const SHARP = "";
const NATURAL = "";
const NOTEHEAD_WHOLE = "";
const NOTEHEAD_HALF = "";
const NOTEHEAD_BLACK = "";
const NOTEHEADS = [NOTEHEAD_WHOLE, NOTEHEAD_HALF, NOTEHEAD_BLACK];

// Stroke widths that uniquely identify each kind of <line> (see the renderer).
const STEM_WIDTH = "1.2";
const LEDGER_WIDTH = "1";
const BEAM_WIDTH = "5"; // staffSpace (10) * 0.5

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

  const allText = () => Array.from(svg.querySelectorAll("text"));
  const allLines = () => Array.from(svg.querySelectorAll("line"));

  return {
    svg,
    container,
    textsWith: (glyph: string) =>
      allText().filter((t) => (t.textContent ?? "").includes(glyph)),
    linesWithStrokeWidth: (w: string) =>
      allLines().filter((l) => l.getAttribute("stroke-width") === w),
    // Noteheads in document order (= note order within each measure), each with
    // its x/y so position and intra-chord spacing can be asserted.
    noteheads: () =>
      allText()
        .filter((t) => NOTEHEADS.some((g) => (t.textContent ?? "").includes(g)))
        .map((t) => ({
          x: Number(t.getAttribute("x")),
          y: Number(t.getAttribute("y")),
        })),
    stems: () =>
      allLines()
        .filter((l) => l.getAttribute("stroke-width") === STEM_WIDTH)
        .map((l) => ({
          x: Number(l.getAttribute("x1")),
          y1: Number(l.getAttribute("y1")),
          y2: Number(l.getAttribute("y2")),
        })),
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

// ── Glyph-level features ──────────────────────────────────────────────────────

describe("SheetMusicDisplay rendering", () => {
  test("renders an <svg> with a notehead glyph for each note", () => {
    const { noteheads } = renderSheetMusic(
      scoreXml([QUARTER("C", 4), QUARTER("D", 4)]),
    );
    expect(noteheads()).toHaveLength(2);
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
    expect(linesWithStrokeWidth(BEAM_WIDTH)).toHaveLength(3);
  });
});

// ── Geometry features (mirror the lib/musicxml unit tests at render level) ─────

describe("SheetMusicDisplay geometry", () => {
  test("notehead vertical position reflects pitch (noteY)", () => {
    // B4 sits a third (4 diatonic steps) above E4 → 4 × (staffSpace/2) = 20px
    // higher, i.e. a smaller SVG y. (treble bottom line = E4)
    const { noteheads } = renderSheetMusic(
      scoreXml([QUARTER("E", 4), QUARTER("B", 4)]),
    );
    const [e4, b4] = noteheads();
    expect(b4.y).toBeLessThan(e4.y);
    expect(e4.y - b4.y).toBe(20);
  });

  test("stem points up for a low note and down for a high note (stemDirection)", () => {
    // Stem side is encoded in its x relative to the notehead: up → right of the
    // head, down → left. E4 is below the middle line, D5 above it.
    const low = renderSheetMusic(scoreXml([QUARTER("E", 4)]));
    expect(low.stems()[0].x).toBeGreaterThan(low.noteheads()[0].x);

    const high = renderSheetMusic(scoreXml([QUARTER("D", 5)]));
    expect(high.stems()[0].x).toBeLessThan(high.noteheads()[0].x);
  });

  test("notes off the staff get ledger lines, notes on it do not (ledgerLineYs)", () => {
    // Middle C (C4) needs one ledger line below the treble staff.
    const offStaff = renderSheetMusic(scoreXml([QUARTER("C", 4)]));
    expect(
      offStaff.linesWithStrokeWidth(LEDGER_WIDTH).length,
    ).toBeGreaterThanOrEqual(1);

    // B4 sits on the middle line — no ledger lines.
    const onStaff = renderSheetMusic(scoreXml([QUARTER("B", 4)]));
    expect(onStaff.linesWithStrokeWidth(LEDGER_WIDTH)).toHaveLength(0);
  });

  test("adjacent seconds in a chord are horizontally displaced (chordXOffsets)", () => {
    // C4 + D4 are a second apart, so the two noteheads cannot share a column.
    const { noteheads } = renderSheetMusic(
      scoreXml([QUARTER("C", 4), { ...QUARTER("D", 4), chord: true }]),
    );
    const heads = noteheads();
    expect(heads).toHaveLength(2);
    expect(Math.abs(heads[0].x - heads[1].x)).toBeGreaterThan(5);
  });

  test("the key signature renders its sharps in the header (KeySig)", () => {
    // G major: one sharp (F#). B4 isn't altered by the key, so the only sharp
    // glyph is the key signature's.
    const gMajor = renderSheetMusic(scoreXml([QUARTER("B", 4)], { fifths: 1 }));
    expect(gMajor.textsWith(SHARP)).toHaveLength(1);

    // D major: two sharps (F#, C#).
    const dMajor = renderSheetMusic(scoreXml([QUARTER("B", 4)], { fifths: 2 }));
    expect(dMajor.textsWith(SHARP)).toHaveLength(2);
  });
});
