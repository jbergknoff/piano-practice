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

export function cornerButtonStyle(): JSX.CSSProperties {
  return {
    width: 38,
    height: 38,
    color: color.ink,
    borderRadius: radius.lg,
    ...glassPanel(),
    boxShadow: "0 4px 14px rgba(0,0,0,0.06)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    outline: "none",
    flexShrink: 0,
  };
}

export function miniButtonStyle(): JSX.CSSProperties {
  return {
    width: 22,
    height: 22,
    background: "transparent",
    border: "none",
    color: color.inkSoft,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    outline: "none",
  };
}

/** The ✕ that closes a modal or drawer, in the top-right of its header. */
export function closeButtonStyle(): JSX.CSSProperties {
  return {
    background: "transparent",
    border: "none",
    color: color.inkSoft,
    cursor: "pointer",
    fontSize: 18,
    padding: 4,
    outline: "none",
    lineHeight: 1,
  };
}

/**
 * 32×32 outlined icon button for use inside a modal (e.g. the result modal's
 * previous/next chevrons) — big enough to tap on a phone, unlike
 * `miniButtonStyle`, and outlined like the ghost `modalActionButtonStyle` so it
 * reads as a button against the glass panel. Pass `enabled = false` to dim it.
 */
export function modalIconButtonStyle(enabled = true): JSX.CSSProperties {
  return {
    width: 32,
    height: 32,
    flexShrink: 0,
    background: "transparent",
    border: `0.5px solid ${color.border}`,
    color: color.ink,
    cursor: enabled ? "pointer" : "default",
    opacity: enabled ? 1 : 0.3,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    outline: "none",
    padding: 0,
  };
}

/**
 * Cancel / OK style buttons used at the foot of modals. Pass `"ghost"` for the
 * secondary (Cancel) button and `"accent"` for the primary (OK/Save) button.
 * The `enabled` flag drives cursor and opacity on the accent variant; it has no
 * effect on ghost buttons, which are always interactive.
 */
export function modalActionButtonStyle(
  variant: "ghost" | "accent",
  enabled = true,
): JSX.CSSProperties {
  if (variant === "ghost") {
    return {
      background: "transparent",
      border: `0.5px solid ${color.border}`,
      color: color.ink,
      cursor: "pointer",
      fontSize: 13,
      padding: "8px 16px",
      borderRadius: 10,
      outline: "none",
      fontFamily: FONT_SANS,
    };
  }
  return {
    background: color.accent,
    border: "none",
    color: "#FFF7E5",
    cursor: enabled ? "pointer" : "not-allowed",
    opacity: enabled ? 1 : 0.4,
    fontSize: 13,
    fontWeight: 600,
    padding: "8px 16px",
    borderRadius: 10,
    outline: "none",
    fontFamily: FONT_SANS,
  };
}

/**
 * Variable-width toggle button for use inside chip/pill containers (e.g. the
 * BPM chip). Unlike `miniButtonStyle` (fixed 22×22 icon button), this variant
 * sizes itself by padding and carries active-state highlight styling.
 */
export function chipToggleButtonStyle(isActive: boolean): JSX.CSSProperties {
  return {
    height: 22,
    padding: "0 10px",
    minWidth: 44,
    background: isActive ? color.accent : "transparent",
    border: "none",
    color: isActive ? "#FFF7E5" : color.ink,
    fontWeight: isActive ? 600 : 400,
    fontSize: 13,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    outline: "none",
    boxShadow: isActive
      ? `0 2px 8px ${withAlpha(color.accent, 0.35)}`
      : undefined,
  };
}
