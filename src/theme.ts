import type { JSX } from "preact";

export type ThemeName = "cream" | "sepia" | "dark";

export interface ThemeTokens {
  bg: string;
  bgDeep: string;
  panel: string;
  panelSolid: string;
  ink: string;
  inkSoft: string;
  inkFaint: string;
  played: string;
  error: string;
  border: string;
  name: string;
}

export const THEMES: Record<ThemeName, ThemeTokens> = {
  cream: {
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
    name: "Warm Paper",
  },
  sepia: {
    bg: "#E8D5A8",
    bgDeep: "#D9C088",
    panel: "rgba(245,230,200,0.82)",
    panelSolid: "#F2DDB0",
    ink: "#3C2A14",
    inkSoft: "rgba(60,42,20,0.62)",
    inkFaint: "rgba(60,42,20,0.32)",
    played: "rgba(60,42,20,0.30)",
    error: "#B0432E",
    border: "rgba(60,42,20,0.12)",
    name: "Vellum",
  },
  dark: {
    bg: "#1A1612",
    bgDeep: "#0F0C09",
    panel: "rgba(30,25,20,0.78)",
    panelSolid: "#221C16",
    ink: "#F5E6CA",
    inkSoft: "rgba(245,230,202,0.62)",
    inkFaint: "rgba(245,230,202,0.32)",
    played: "rgba(245,230,202,0.28)",
    error: "#E07060",
    border: "rgba(245,230,202,0.10)",
    name: "Candle",
  },
};

export const ACCENT_COLORS = [
  "#E08A3E",
  "#C7553F",
  "#5E8C5A",
  "#9A6FB4",
] as const;

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

export function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = Number.parseInt(h.slice(0, 2), 16);
  const g = Number.parseInt(h.slice(2, 4), 16);
  const b = Number.parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// ── Shared style recipes ──────────────────────────────────────────────────────

// Pairs the standard and -webkit- backdrop-filter so Safari is always covered.
export function blurFilter(value: string): JSX.CSSProperties {
  return { backdropFilter: value, WebkitBackdropFilter: value };
}

// Frosted-glass surface (used by floating panels, menus, badges, modals).
export function glassPanel(
  theme: ThemeTokens,
  blur = 20,
  saturate = 160,
): JSX.CSSProperties {
  return {
    background: theme.panel,
    border: `0.5px solid ${theme.border}`,
    ...blurFilter(`blur(${blur}px) saturate(${saturate}%)`),
  };
}

// Full-screen dim layer rendered behind modals/drawers.
export function dimBackdrop(opacity = 0.3, blur = 4): JSX.CSSProperties {
  return {
    position: "fixed",
    inset: 0,
    background: `rgba(0,0,0,${opacity})`,
    ...blurFilter(`blur(${blur}px)`),
  };
}

// Italic serif heading used for titles across modals and screens.
export function serifTitle(
  theme: ThemeTokens,
  size: number = fontSizes.xl,
): JSX.CSSProperties {
  return {
    fontFamily: FONT_SERIF,
    fontStyle: "italic",
    fontSize: size,
    color: theme.ink,
  };
}

export function cornerBtnStyle(theme: ThemeTokens): JSX.CSSProperties {
  return {
    width: 38,
    height: 38,
    color: theme.ink,
    borderRadius: radius.lg,
    ...glassPanel(theme),
    boxShadow: "0 4px 14px rgba(0,0,0,0.06)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    outline: "none",
    flexShrink: 0,
  };
}

export function miniBtnStyle(theme: ThemeTokens): JSX.CSSProperties {
  return {
    width: 22,
    height: 22,
    background: "transparent",
    border: "none",
    color: theme.inkSoft,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    outline: "none",
  };
}
