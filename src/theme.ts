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

export function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = Number.parseInt(h.slice(0, 2), 16);
  const g = Number.parseInt(h.slice(2, 4), 16);
  const b = Number.parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export function cornerBtnStyle(theme: ThemeTokens): Record<string, unknown> {
  return {
    width: 38,
    height: 38,
    background: theme.panel,
    color: theme.ink,
    border: `0.5px solid ${theme.border}`,
    borderRadius: 12,
    backdropFilter: "blur(20px) saturate(160%)",
    WebkitBackdropFilter: "blur(20px) saturate(160%)",
    boxShadow: "0 4px 14px rgba(0,0,0,0.06)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    outline: "none",
    flexShrink: 0,
  };
}

export function miniBtnStyle(theme: ThemeTokens): Record<string, unknown> {
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
    borderRadius: 6,
    outline: "none",
  };
}
