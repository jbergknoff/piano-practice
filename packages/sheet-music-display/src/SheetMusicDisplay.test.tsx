import { describe, expect, test } from "bun:test";
/**
 * Render-level tests: mount the real SheetMusicDisplay component into a linkedom
 * DOM (set up in src/test-setup.ts) and inspect the SVG it produces. These
 * complement the data-layer tests in lib/musicxml by verifying that notation
 * decisions actually reach the rendered glyphs and geometry — note positions,
 * stem direction, ledger lines, chord spacing, accidentals, beams, staccato.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { render } from "preact";
import {
  EMBEDDED_GLYPH_FONT_BASE64,
  GLYPH_FONT_FAMILY,
} from "./embedded-glyph-font";
import { computeMeasureStartBeats } from "./measure-beats";
import { parseScore } from "./musicxml-parser";
import {
  SheetMusicDisplay,
  computeCursorX,
  computeTieArcs,
} from "./SheetMusicDisplay";
import { resolveLayout } from "./sheet-music-layout";

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
    // Barline x positions, ascending (barlines use stroke-width 0.9).
    barlineXs: () =>
      allLines()
        .filter((l) => l.getAttribute("stroke-width") === "0.9")
        .map((l) => Number(l.getAttribute("x1")))
        .sort((a, b) => a - b),
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
  /** Emit a <grace/> (no <duration>); true = plain, {slash} = acciaccatura. */
  grace?: boolean | { slash: boolean };
  /** Emit <tie> elements: "start", "stop", or "both" (a tie chain). */
  tie?: "start" | "stop" | "both";
}

function noteXml(n: NoteSpec): string {
  const parts = ["<note>"];
  if (n.grace) {
    const slash = typeof n.grace === "object" && n.grace.slash;
    parts.push(slash ? '<grace slash="yes"/>' : "<grace/>");
  }
  if (n.chord) {
    parts.push("<chord/>");
  }
  parts.push(`<pitch><step>${n.step}</step>`);
  if (n.alter) {
    parts.push(`<alter>${n.alter}</alter>`);
  }
  parts.push(`<octave>${n.octave}</octave></pitch>`);
  // Grace notes carry no rhythmic duration.
  if (!n.grace) {
    parts.push(`<duration>${n.duration}</duration>`);
  }
  parts.push(`<type>${n.type}</type>`);
  if (n.dot) {
    parts.push("<dot/>");
  }
  if (n.tie === "start" || n.tie === "both") {
    parts.push('<tie type="start"/>');
  }
  if (n.tie === "stop" || n.tie === "both") {
    parts.push('<tie type="stop"/>');
  }
  if (n.staccato) {
    parts.push(
      "<notations><articulations><staccato/></articulations></notations>",
    );
  }
  parts.push("</note>");
  return parts.join("");
}

// Build a one-part score from one measure (notes) or several (array of notes).
function scoreXml(
  notesOrMeasures: NoteSpec[] | NoteSpec[][],
  { beats = 4, beatType = 4, fifths = 0 } = {},
): string {
  const measures = (
    Array.isArray(notesOrMeasures[0]) ? notesOrMeasures : [notesOrMeasures]
  ) as NoteSpec[][];
  const attributes = `<attributes><divisions>4</divisions><key><fifths>${fifths}</fifths><mode>major</mode></key><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>`;
  const body = measures
    .map(
      (notes, i) =>
        `<measure number="${i + 1}">${i === 0 ? attributes : ""}${notes.map(noteXml).join("")}</measure>`,
    )
    .join("");
  return `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1">${body}</part></score-partwise>`;
}

// Two-measure one-part score: measure 1 opens in `openFifths`, measure 2
// declares a key change to `changeFifths` via a key-only <attributes> block
// (mirroring the converter's mid-piece output).
function keyChangeScoreXml(openFifths: number, changeFifths: number): string {
  const m1Attr = `<attributes><divisions>4</divisions><key><fifths>${openFifths}</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>`;
  const m2Attr = `<attributes><key><fifths>${changeFifths}</fifths><mode>major</mode></key></attributes>`;
  const note = noteXml({ step: "B", octave: 4, duration: 16, type: "whole" });
  const body = `<measure number="1">${m1Attr}${note}</measure><measure number="2">${m2Attr}${note}</measure>`;
  return `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1">${body}</part></score-partwise>`;
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

  test("staggered chord accidentals sit right of the measure's barline", () => {
    // Measure 1 is plain; measure 2 opens with the F#4 + D#5 chord whose two
    // sharps stagger into two columns. Extra left padding must keep both to the
    // right of the measure-2 barline.
    const { textsWith, barlineXs } = renderSheetMusic(
      scoreXml(
        [
          [{ step: "G", octave: 4, duration: 12, type: "half", dot: true }],
          [
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
          ],
        ],
        { beats: 3, beatType: 4 },
      ),
    );
    const sharps = textsWith(SHARP);
    expect(sharps).toHaveLength(2);
    // Barlines ascending: [measure 1, measure 2, final] → middle is measure 2.
    const measure2BarlineX = barlineXs()[1];
    for (const s of sharps) {
      expect(Number(s.getAttribute("x"))).toBeGreaterThan(measure2BarlineX);
    }
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

  test("a staccato chord renders one dot, not one per note", () => {
    // Mirrors measure 3 of the simple-grand-piano fixture: [D4, B4], both staccato.
    const { circles } = renderSheetMusic(
      scoreXml([
        { step: "D", octave: 4, duration: 4, type: "quarter", staccato: true },
        {
          step: "B",
          octave: 4,
          duration: 4,
          type: "quarter",
          staccato: true,
          chord: true,
        },
      ]),
    );
    expect(circles()).toHaveLength(1);
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

  test("a mid-piece key change adds new sharps at the changing measure", () => {
    // C major → D major (2 sharps). The two sharp glyphs are the key change's
    // (B4 is unaltered in either key).
    const { textsWith } = renderSheetMusic(keyChangeScoreXml(0, 2));
    expect(textsWith(SHARP)).toHaveLength(2);
    expect(textsWith(NATURAL)).toHaveLength(0);
  });

  test("returning to C cancels the outgoing sharps with naturals", () => {
    // A major (3 sharps in the header) → C major. Measure 2 cancels F#, C#, G#
    // with three naturals and shows no sharps of its own.
    const { textsWith } = renderSheetMusic(keyChangeScoreXml(3, 0));
    expect(textsWith(SHARP)).toHaveLength(3); // header only
    expect(textsWith(NATURAL)).toHaveLength(3); // the cancels
  });

  test("key-change glyphs sit right of the changing measure's barline", () => {
    const { textsWith, barlineXs } = renderSheetMusic(keyChangeScoreXml(3, 0));
    const measure2BarlineX = barlineXs()[1];
    for (const n of textsWith(NATURAL)) {
      expect(Number(n.getAttribute("x"))).toBeGreaterThan(measure2BarlineX);
    }
  });
});

// ── Grace note highlighting ───────────────────────────────────────────────────

describe("grace note highlighting", () => {
  // E5 quarter, then a grace D5 ornamenting a C5 quarter. assignNoteIndices
  // numbers the grace group n1 (between the two quarters n0 and n2), so its
  // notehead id is p0-m1-n1-v0.
  const graceScore = scoreXml([
    QUARTER("E", 5),
    { step: "D", octave: 5, duration: 0, type: "eighth", grace: true },
    QUARTER("C", 5),
  ]);

  test("a score highlight on a grace note recolors its (smaller) notehead", () => {
    // Highlights live in the dynamic overlay <svg>, a sibling of the static
    // notation <svg>, so query the container (which spans both), not `svg`.
    const { container } = renderSheetMusic(graceScore, {
      noteHighlights: [{ kind: "score", id: "p0-m1-n1-v0", color: "#ff0000" }],
    });
    const group = container.querySelector('[data-color-id="p0-m1-n1-v0"]');
    expect(group).not.toBeNull();
    // The recolored glyph is a black notehead drawn at the grace glyph size
    // (staffSpace 10 × GRACE_FONT_FACTOR 2.4 = 24), not the full-note size.
    const head = group?.querySelector("text");
    expect(head?.textContent).toContain(NOTEHEAD_BLACK);
    expect(head?.getAttribute("fill")).toBe("#ff0000");
    expect(group?.getAttribute("font-size")).toBe("24");
  });

  test("a regular notehead highlight carries no grace font-size override", () => {
    // Contrast case: highlighting the main C5 (n2) uses the document default
    // glyph size, so its overlay group has no font-size attribute.
    const { container } = renderSheetMusic(graceScore, {
      noteHighlights: [{ kind: "score", id: "p0-m1-n2-v0", color: "#ff0000" }],
    });
    const group = container.querySelector('[data-color-id="p0-m1-n2-v0"]');
    expect(group).not.toBeNull();
    expect(group?.getAttribute("font-size")).toBeNull();
  });
});

// ── SVG snapshots ─────────────────────────────────────────────────────────────
//
// Each case below is rendered to a self-contained, viewable SVG (Bravura subset
// embedded, cream background) committed under tests/fixtures/svg/. The committed
// file IS the expected output: open it in a browser to see the notation, and the
// test fails if the renderer drifts from it. Regenerate after an intended change
// with:  UPDATE_SVG=1 bun test src/components/SheetMusicDisplay.test.tsx

const SVG_DIR = "tests/fixtures/svg";

function standaloneSvg(svg: Element): string {
  const w = svg.getAttribute("width");
  const h = svg.getAttribute("height");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="font-family:${GLYPH_FONT_FAMILY},serif;font-size:40px">`,
    `<defs><style>@font-face{font-family:'${GLYPH_FONT_FAMILY}';src:url(data:font/woff2;base64,${EMBEDDED_GLYPH_FONT_BASE64}) format('woff2');}</style></defs>`,
    `<rect width="${w}" height="${h}" fill="#faf6e9"/>`,
    svg.innerHTML,
    "</svg>",
    "",
  ].join("\n");
}

const SNAPSHOT_CASES: Array<[string, string]> = [
  // Sharp then natural (cancel) then a plain note.
  [
    "accidentals",
    scoreXml([QUARTER("C", 4, 1), QUARTER("C", 4, 0), QUARTER("D", 4)]),
  ],
  // Staggered chord accidentals in measure 2, kept clear of the barline.
  [
    "chord-accidentals",
    scoreXml(
      [
        [{ step: "G", octave: 4, duration: 12, type: "half", dot: true }],
        [
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
        ],
      ],
      { beats: 3, beatType: 4 },
    ),
  ],
  // Six eighths in 3/4 → three per-beat beam groups.
  [
    "beaming",
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
  ],
  // Staccato chord → a single dot below the lowest notehead.
  [
    "staccato-chord",
    scoreXml([
      { step: "D", octave: 4, duration: 4, type: "quarter", staccato: true },
      {
        step: "B",
        octave: 4,
        duration: 4,
        type: "quarter",
        staccato: true,
        chord: true,
      },
    ]),
  ],
  // Mid-piece key change (A major → C major): three naturals cancel the
  // outgoing sharps at the start of measure 2. Mirrors Rondo Alla Turca.
  ["key-change", keyChangeScoreXml(3, 0)],
];

describe("SheetMusicDisplay SVG snapshots", () => {
  for (const [name, xml] of SNAPSHOT_CASES) {
    test(name, () => {
      const { svg } = renderSheetMusic(xml);
      const out = standaloneSvg(svg);
      const path = `${SVG_DIR}/${name}.svg`;
      if (process.env.UPDATE_SVG) {
        writeFileSync(path, out);
        return;
      }
      expect(out).toBe(readFileSync(path, "utf8"));
    });
  }
});

// ── Ties ──────────────────────────────────────────────────────────────────────

describe("ties", () => {
  const tiePaths = (svg: Element) =>
    Array.from(svg.querySelectorAll("path[data-tie]"));

  test("draws a tie arc between two tied noteheads in a measure", () => {
    const { svg } = renderSheetMusic(
      scoreXml([
        { ...QUARTER("G", 4), tie: "start" },
        { ...QUARTER("G", 4), tie: "stop" },
        QUARTER("C", 4),
        QUARTER("D", 4),
      ]),
    );
    expect(tiePaths(svg)).toHaveLength(1);
  });

  test("draws no tie arc when no notes are tied", () => {
    const { svg } = renderSheetMusic(
      scoreXml([QUARTER("G", 4), QUARTER("G", 4)]),
    );
    expect(tiePaths(svg)).toHaveLength(0);
  });

  test("ties a note across a barline", () => {
    const score = parseScore(
      scoreXml([
        [
          QUARTER("C", 4),
          QUARTER("D", 4),
          QUARTER("E", 4),
          { ...QUARTER("G", 4), tie: "start" },
        ],
        [
          { ...QUARTER("G", 4), tie: "stop" },
          QUARTER("C", 4),
          QUARTER("D", 4),
          QUARTER("E", 4),
        ],
      ]),
    );
    const arcs = computeTieArcs(score, resolveLayout(score));
    expect(arcs).toHaveLength(1);
    // The tie starts in measure 1 and stops in measure 2, so the stop endpoint
    // is to the right of the start endpoint.
    expect(arcs[0].stopX).toBeGreaterThan(arcs[0].startX);
    expect(arcs[0].partIndex).toBe(0);
  });

  test("a high notehead's tie bulges up, a low one's bulges down", () => {
    // Ties curve opposite the stem: a high note (stem down) gets the arc above
    // it, a low note (stem up) gets it below.
    const highScore = parseScore(
      scoreXml([
        [{ ...QUARTER("A", 5), tie: "start" }, QUARTER("C", 4)],
        [{ ...QUARTER("A", 5), tie: "stop" }, QUARTER("C", 4)],
      ]),
    );
    expect(computeTieArcs(highScore, resolveLayout(highScore))[0].bulge).toBe(
      "up",
    );

    const lowScore = parseScore(
      scoreXml([
        [{ ...QUARTER("C", 4), tie: "start" }, QUARTER("C", 4)],
        [{ ...QUARTER("C", 4), tie: "stop" }, QUARTER("C", 4)],
      ]),
    );
    expect(computeTieArcs(lowScore, resolveLayout(lowScore))[0].bulge).toBe(
      "down",
    );
  });
});

// ── Playback cursor positioning ───────────────────────────────────────────────

describe("computeCursorX", () => {
  // Two 4/4 measures of four quarter notes each. Quarter-note beats map onto
  // the shared spine's onset divisions (4 divisions per quarter).
  const FOUR_QUARTERS = [
    QUARTER("C", 4),
    QUARTER("D", 4),
    QUARTER("E", 4),
    QUARTER("F", 4),
  ];
  const score = parseScore(scoreXml([FOUR_QUARTERS, FOUR_QUARTERS]));
  const layout = resolveLayout(score);
  const measureStartBeats = computeMeasureStartBeats(score);
  const cx = (beat: number): number => {
    const x = computeCursorX(beat, score, layout, measureStartBeats);
    if (x === null) {
      throw new Error(`computeCursorX returned null at beat ${beat}`);
    }
    return x;
  };

  test("a downbeat lands on the first notehead, not the barline", () => {
    // Measure 2's downbeat is beat 4. The clef/key/padding lead-in sits between
    // the barline and the first note; the cursor must be on the note.
    const barlineX = layout.measureXs[1];
    const firstOnsetX = layout.measureSpines[1].xs[0];

    expect(cx(4)).toBe(firstOnsetX);
    // Regression guard: the old code returned the barline x here.
    expect(firstOnsetX).toBeGreaterThan(barlineX);
    expect(cx(4)).toBeGreaterThan(barlineX);
  });

  test("each beat anchor sits on its own onset", () => {
    // Beats 4..7 are the four onsets of measure 2.
    for (let i = 0; i < 4; i++) {
      expect(cx(4 + i)).toBe(layout.measureSpines[1].xs[i]);
    }
  });

  test("between onsets the cursor interpolates monotonically", () => {
    const a = layout.measureSpines[1].xs[0];
    const b = layout.measureSpines[1].xs[1];
    const mid = cx(4.5); // halfway between beats 4 and 5
    expect(mid).toBeGreaterThan(a);
    expect(mid).toBeLessThan(b);
  });

  test("the cursor is continuous across a barline (no jump)", () => {
    // Approaching the end of measure 1 must converge on measure 2's downbeat x,
    // so the cursor doesn't snap backward to the barline as the bar turns over.
    const justBeforeBarline = cx(4 - 1e-6);
    expect(justBeforeBarline).toBeCloseTo(cx(4), 1);
  });

  test("computeMeasureStartBeats handles a pickup (anacrusis) measure", () => {
    // A pickup measure contains only 1 quarter note (1 beat), followed by two
    // full 4/4 measures of 4 quarter notes each.  The beat offsets must reflect
    // the actual measure durations, not assume every measure is 4 beats long.
    const ONE_QUARTER = [QUARTER("C", 4)];
    const pickupScore = parseScore(
      scoreXml([ONE_QUARTER, FOUR_QUARTERS, FOUR_QUARTERS]),
    );
    const pickupMeasureStartBeats = computeMeasureStartBeats(pickupScore);
    // Pickup = 1 beat; first full measure starts at beat 1; second at beat 5.
    expect(pickupMeasureStartBeats).toEqual([0, 1, 5]);
  });

  test("cursor lands in the correct measure after a pickup", () => {
    // With a one-beat pickup, beat 1 is the downbeat of the FIRST full measure
    // (index 1), not still inside the pickup (index 0).
    const ONE_QUARTER = [QUARTER("C", 4)];
    const pickupScore = parseScore(
      scoreXml([ONE_QUARTER, FOUR_QUARTERS, FOUR_QUARTERS]),
    );
    const pickupLayout = resolveLayout(pickupScore);
    const pickupMeasureStartBeats = computeMeasureStartBeats(pickupScore);
    const pickupCx = (beat: number): number => {
      const x = computeCursorX(
        beat,
        pickupScore,
        pickupLayout,
        pickupMeasureStartBeats,
      );
      if (x === null) {
        throw new Error(`computeCursorX returned null at beat ${beat}`);
      }
      return x;
    };

    // At beat 1 the cursor must be on measure 1's first notehead (not at the
    // end of measure 0 as the old floor(beat / beatsPerMeasure) formula gave).
    const measure1FirstNoteX = pickupLayout.measureSpines[1].xs[0];
    expect(pickupCx(1)).toBe(measure1FirstNoteX);

    // At beat 5 the cursor is on measure 2's first notehead.
    const measure2FirstNoteX = pickupLayout.measureSpines[2].xs[0];
    expect(pickupCx(5)).toBe(measure2FirstNoteX);
  });
});
