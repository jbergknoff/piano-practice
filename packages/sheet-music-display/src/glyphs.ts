// The SMuFL glyphs the renderer draws. Single source of truth shared by the
// renderer (SheetMusicDisplay.tsx), the subset generator
// (scripts/generate-glyph-font.ts), and the drift-guard test — so the embedded
// font subset always covers exactly the glyphs the renderer can emit.
//
// SMuFL glyphs live in Unicode's Private Use Area (U+E000–U+F8FF) and are only
// meaningful when rendered with a SMuFL font such as Bravura. Each glyph is
// designed for font-size = 4 × staff-space, with its baseline at the bottom
// staff line (y = staffBottomY in our SVG coordinate system).
export const G = {
  gClef: "",
  fClef: "",
  accSharp: "",
  accFlat: "",
  accNatural: "",
  noteheadWhole: "",
  noteheadHalf: "",
  noteheadBlack: "",
  restWhole: "",
  restHalf: "",
  restQuarter: "",
  rest8th: "",
  rest16th: "",
  flag8thUp: "",
  flag8thDown: "",
  flag16thUp: "",
  flag16thDown: "",
} as const;

// SMuFL time-signature digits are U+E080 (0) … U+E089 (9). Mapping each decimal
// digit to its glyph lets multi-digit values (e.g. 12) render as adjacent
// figures using the same font as the rest of the staff.
export const TIME_SIG_DIGIT_BASE = 0xe080;

export function timeSigGlyphs(value: number): string {
  return String(value)
    .split("")
    .map((digit) => String.fromCharCode(TIME_SIG_DIGIT_BASE + Number(digit)))
    .join("");
}

/** Every codepoint the renderer can emit — the exact set the embedded font
 *  subset must cover. */
export const RENDERED_GLYPH_CODEPOINTS: readonly number[] = [
  ...Object.values(G).map((char) => char.codePointAt(0) as number),
  ...Array.from({ length: 10 }, (_, digit) => TIME_SIG_DIGIT_BASE + digit),
];
