import type { ComponentChildren } from "preact";
import type { ThemeTokens } from "../theme";
import { dimBackdrop, FONT_SANS, glassPanel, hexA, serifTitle } from "../theme";

export function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  const timeStr = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return isToday
    ? timeStr
    : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${timeStr}`;
}

export function scoreColor(score: number): string {
  if (score >= 80) {
    return "#2e7d32";
  }
  if (score >= 50) {
    return "#e65100";
  }
  return "#c62828";
}

export function ScoreChip({ score }: { score: number }) {
  return (
    <span
      style={{
        fontVariantNumeric: "tabular-nums",
        color: scoreColor(score),
        fontWeight: 600,
      }}
    >
      {score}%
    </span>
  );
}

function motivationalMessage(score: number): string {
  if (score === 100) {
    return "Perfect — every note right on time!";
  }
  if (score >= 80) {
    return "Great playing — keep it up.";
  }
  if (score >= 50) {
    return "Good effort — practice makes perfect.";
  }
  return "Keep practicing — you'll get there!";
}

export interface ResultRow {
  key: string | number;
  isLatest: boolean;
  when: string;
  cells: ComponentChildren[];
}

interface ResultModalProps {
  theme: ThemeTokens;
  accent: string;
  selectionLabel: string;
  latest: {
    score: number;
    headerRight?: string;
    stats?: { label: string; value: string }[];
  } | null;
  history: {
    label: string;
    gridTemplate: string;
    columns: string[];
    rows: ResultRow[];
  };
  onClose: () => void;
}

export function ResultModal({
  theme,
  accent,
  selectionLabel,
  latest,
  history,
  onClose,
}: ResultModalProps) {
  return (
    <>
      <div
        role="presentation"
        style={{ ...dimBackdrop(0.28), zIndex: 299 }}
        onClick={onClose}
        onKeyDown={(e: Event) => {
          if ((e as unknown as KeyboardEvent).key === "Escape") {
            onClose();
          }
        }}
      />

      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 300,
          ...glassPanel(theme, 28, 180),
          borderRadius: 20,
          padding: "28px 32px 24px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
          width: "min(420px, calc(100vw - 40px))",
          maxHeight: "calc(100vh - 80px)",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        <div>
          <div style={{ ...serifTitle(theme), lineHeight: 1.1 }}>
            {selectionLabel} complete
          </div>
        </div>

        {latest && (
          <div
            style={{
              background: hexA(accent, 0.07),
              border: `0.5px solid ${hexA(accent, 0.2)}`,
              borderRadius: 12,
              padding: "14px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-between",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span
                  style={{
                    fontSize: 10,
                    color: theme.inkSoft,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                  }}
                >
                  Score
                </span>
                <span
                  style={{
                    fontSize: 40,
                    fontWeight: 700,
                    color: scoreColor(latest.score),
                    fontVariantNumeric: "tabular-nums",
                    lineHeight: 1,
                  }}
                >
                  {latest.score}%
                </span>
              </div>
              {latest.headerRight && (
                <span style={{ fontSize: 12, color: theme.inkSoft }}>
                  {latest.headerRight}
                </span>
              )}
            </div>

            {latest.stats && latest.stats.length > 0 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${latest.stats.length}, 1fr)`,
                  gap: 8,
                  borderTop: `0.5px solid ${hexA(accent, 0.15)}`,
                  paddingTop: 10,
                }}
              >
                {latest.stats.map((stat) => (
                  <div
                    key={stat.label}
                    style={{ display: "flex", flexDirection: "column", gap: 3 }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        color: theme.inkSoft,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                      }}
                    >
                      {stat.label}
                    </span>
                    <span
                      style={{
                        fontSize: 16,
                        fontWeight: 600,
                        color: theme.ink,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {stat.value}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div
              style={{
                borderTop: `0.5px solid ${hexA(accent, 0.15)}`,
                paddingTop: 10,
                fontSize: 13,
                color: theme.inkSoft,
              }}
            >
              {motivationalMessage(latest.score)}
            </div>
          </div>
        )}

        {history.rows.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                fontSize: 10,
                color: theme.inkSoft,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              {history.label}
            </div>
            <div
              style={{
                border: `0.5px solid ${theme.border}`,
                borderRadius: 10,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: history.gridTemplate,
                  padding: "7px 12px",
                  background: hexA(theme.ink, 0.04),
                  borderBottom: `0.5px solid ${theme.border}`,
                }}
              >
                {history.columns.map((h) => (
                  <span
                    key={h}
                    style={{
                      fontSize: 10,
                      color: theme.inkSoft,
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                    }}
                  >
                    {h}
                  </span>
                ))}
              </div>
              {history.rows.map((row, i) => (
                <div
                  key={row.key}
                  style={{
                    display: "grid",
                    gridTemplateColumns: history.gridTemplate,
                    padding: "7px 12px",
                    borderBottom:
                      i < history.rows.length - 1
                        ? `0.5px solid ${theme.border}`
                        : undefined,
                    alignItems: "center",
                    background: row.isLatest ? hexA(accent, 0.06) : undefined,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      color: row.isLatest ? theme.ink : theme.inkSoft,
                      fontWeight: row.isLatest ? 500 : 400,
                    }}
                  >
                    {row.isLatest ? "Now" : row.when}
                  </span>
                  {row.cells}
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          style={{
            alignSelf: "flex-end",
            background: accent,
            color: "#FFF7E5",
            border: "none",
            borderRadius: 10,
            padding: "9px 20px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: FONT_SANS,
            boxShadow: `0 4px 12px ${hexA(accent, 0.35)}`,
            letterSpacing: "0.02em",
          }}
        >
          Keep practicing
        </button>
      </div>
    </>
  );
}
