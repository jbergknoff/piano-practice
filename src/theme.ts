import type { JSX } from "preact";

// ── Colours ───────────────────────────────────────────────────────────────────
// The app's palette ("Warm Paper" with an amber accent), defined once as CSS
// custom properties on :root. Components style themselves with `color.*`,
// which are `var(--color-…)` references, so no colour has to be threaded
// through props, and a second palette (e.g. dark mode) would be one more CSS
// block rather than a change to every component.
const PALETTE = {
  bg: "#FAF1DD",
  bgDeep: "#F3E4C0",
  panel: "rgba(255,250,238,0.78)",
  panelSolid: "#FFF7E5",
  ink: "#2F2417",
  inkSoft: "rgba(47,36,23,0.62)",
  inkFaint: "rgba(47,36,23,0.32)",
  played: "rgba(47,36,23,0.28)",
  error: "#C24A3A",
  border: "rgba(47,36,23,0.10)",
  accent: "#E08A3E",
} as const;

export type ColorToken = keyof typeof PALETTE;

function customPropertyName(token: ColorToken): string {
  return `--color-${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

function mapPalette(
  toValue: (token: ColorToken) => string,
): Record<ColorToken, string> {
  const result = {} as Record<ColorToken, string>;
  for (const token of Object.keys(PALETTE) as ColorToken[]) {
    result[token] = toValue(token);
  }
  return result;
}

/** The palette as `var(--color-…)` references: use these in inline styles. */
export const color: Readonly<Record<ColorToken, string>> = mapPalette(
  (token) => `var(${customPropertyName(token)})`,
);

/**
 * The palette's literal values, for the places a CSS variable can't reach:
 * SVG presentation attributes (`fill=`, `stroke=`), which is how the
 * sheet-music package and the note highlights draw. Everywhere else, use
 * `color`.
 */
export const colorValue: Readonly<Record<ColorToken, string>> = mapPalette(
  (token) => PALETTE[token],
);

/**
 * The focus-range overlay on the sheet: the accent at 9% opacity, as a
 * literal colour, because the sheet-music package draws it as an SVG `fill`.
 */
export const focusRangeTint = (() => {
  const hex = PALETTE.accent.replace("#", "");
  const [red, green, blue] = [0, 2, 4].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16),
  );
  return `rgba(${red},${green},${blue},0.09)`;
})();

/**
 * `baseColor` (a `color.*` variable, or any CSS colour) at the given opacity,
 * e.g. `withAlpha(color.accent, 0.35)`.
 */
export function withAlpha(baseColor: string, alpha: number): string {
  const percent = Math.round(alpha * 1000) / 10;
  return `color-mix(in srgb, ${baseColor} ${percent}%, transparent)`;
}

// Injected once per document at module load (the same pattern as the dialog
// styles and the sheet-music glyph font), so the variables exist before the
// first render.
function injectColorVariables(): void {
  if (typeof document === "undefined") {
    return;
  }
  const elementId = "app-color-variables";
  if (document.getElementById(elementId)) {
    return;
  }
  const declarations = (Object.keys(PALETTE) as ColorToken[])
    .map((token) => `  ${customPropertyName(token)}: ${PALETTE[token]};`)
    .join("\n");
  const style = document.createElement("style");
  style.id = elementId;
  style.textContent = `:root {\n${declarations}\n}\n`;
  document.head.appendChild(style);
}
injectColorVariables();

// ── Font stacks ───────────────────────────────────────────────────────────────
// Single source of truth for every font-family string in the app. Bravura (the
// music-notation font) is intentionally not here — it lives in SheetMusicDisplay
// next to the SMuFL glyph code that needs it.
export const FONT_SANS = "'Geist', ui-sans-serif, system-ui, sans-serif";
export const FONT_SERIF = "'Instrument Serif', serif"; // loaded italic-only
export const FONT_MONO = "'Geist Mono', ui-monospace, monospace";

// ── Design scales ─────────────────────────────────────────────────────────────
// Shared vocabulary for spacing, radii, type sizes, and weights. Prefer these
// over ad-hoc pixel literals so values stay consistent across components.
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 12,
  xl: 16,
  xxl: 20,
  pill: 999,
} as const;

export const fontSizes = {
  xs: 10,
  sm: 12,
  base: 13,
  md: 16,
  lg: 22,
  xl: 26,
  display: 40,
} as const;

// All four weights are present in the loaded Geist cuts (see index.html).
export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

// ── Shared style recipes ──────────────────────────────────────────────────────

// Pairs the standard and -webkit- backdrop-filter so Safari is always covered.
export function blurFilter(value: string): JSX.CSSProperties {
  return { backdropFilter: value, WebkitBackdropFilter: value };
}

// Frosted-glass surface (used by floating panels, menus, badges, modals).
export function glassPanel(blur = 20, saturate = 160): JSX.CSSProperties {
  return {
    background: color.panel,
    border: `0.5px solid ${color.border}`,
    ...blurFilter(`blur(${blur}px) saturate(${saturate}%)`),
  };
}

// Italic serif heading used for titles across modals and screens.
export function serifTitle(size: number = fontSizes.xl): JSX.CSSProperties {
  return {
    fontFamily: FONT_SERIF,
    fontStyle: "italic",
    fontSize: size,
    color: color.ink,
  };
}
