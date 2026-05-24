import type { WaitModeAttempt } from "../hooks/use-file-history";
import type { ThemeTokens } from "../theme";
import { hexA } from "../theme";

function formatTime(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDate(timestamp: number): string {
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

function scoreColor(score: number): string {
  if (score >= 80) {
    return "#2e7d32";
  }
  if (score >= 50) {
    return "#e65100";
  }
  return "#c62828";
}

function ScoreChip({ score }: { score: number }) {
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

interface WaitModeResultModalProps {
  theme: ThemeTokens;
  accent: string;
  selectionLabel: string;
  history: WaitModeAttempt[];
  expectedDurationMs: number;
  onClose: () => void;
}

export function WaitModeResultModal({
  theme,
  accent,
  selectionLabel,
  history,
  expectedDurationMs,
  onClose,
}: WaitModeResultModalProps) {
  const latest = history[history.length - 1];
  const prior = history.slice(0, -1).reverse().slice(0, 9);

  return (
    <>
      {/* Backdrop */}
      <div
        role="presentation"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 299,
          background: "rgba(0,0,0,0.28)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
        }}
        onClick={onClose}
        onKeyDown={(e: Event) => {
          if ((e as unknown as KeyboardEvent).key === "Escape") {
            onClose();
          }
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 300,
          background: theme.panel,
          border: `0.5px solid ${theme.border}`,
          borderRadius: 20,
          backdropFilter: "blur(28px) saturate(180%)",
          WebkitBackdropFilter: "blur(28px) saturate(180%)",
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
        {/* Title */}
        <div>
          <div
            style={{
              fontFamily: "'Instrument Serif', serif",
              fontStyle: "italic",
              fontSize: 26,
              color: theme.ink,
              lineHeight: 1.1,
            }}
          >
            {selectionLabel} complete
          </div>
        </div>

        {/* Latest attempt */}
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
            {/* Score hero */}
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

            {/* Detail stats */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 8,
                borderTop: `0.5px solid ${hexA(accent, 0.15)}`,
                paddingTop: 10,
              }}
            >
              {(
                [
                  ["Wrong notes", String(latest.wrongNotes)],
                  ["Time", formatTime(latest.elapsedMs)],
                  ["Expected", formatTime(expectedDurationMs)],
                ] as [string, string][]
              ).map(([label, value]) => (
                <div
                  key={label}
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
                    {label}
                  </span>
                  <span
                    style={{
                      fontSize: 16,
                      fontWeight: 600,
                      color: theme.ink,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {value}
                  </span>
                </div>
              ))}
            </div>

            {/* Motivational message */}
            <div
              style={{
                borderTop: `0.5px solid ${hexA(accent, 0.15)}`,
                paddingTop: 10,
                fontSize: 13,
                color: theme.inkSoft,
              }}
            >
              {latest.score === 100
                ? "Perfect — every note right on time!"
                : latest.score >= 80
                  ? "Great playing — keep it up."
                  : latest.score >= 50
                    ? "Good effort — practice makes perfect."
                    : "Keep practicing — you'll get there!"}
            </div>
          </div>
        )}

        {/* History table */}
        {prior.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                fontSize: 10,
                color: theme.inkSoft,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              Previous attempts
            </div>
            <div
              style={{
                border: `0.5px solid ${theme.border}`,
                borderRadius: 10,
                overflow: "hidden",
              }}
            >
              {/* Header */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 72px 52px",
                  padding: "7px 12px",
                  background: hexA(theme.ink, 0.04),
                  borderBottom: `0.5px solid ${theme.border}`,
                }}
              >
                {(["When", "Wrong", "Score"] as string[]).map((h) => (
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
              {prior.map((a, i) => (
                <div
                  key={a.timestamp}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 72px 52px",
                    padding: "7px 12px",
                    borderBottom:
                      i < prior.length - 1
                        ? `0.5px solid ${theme.border}`
                        : undefined,
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontSize: 12, color: theme.inkSoft }}>
                    {formatDate(a.timestamp)}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: theme.ink,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {a.wrongNotes}
                  </span>
                  <ScoreChip score={a.score ?? 0} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Close button */}
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
            fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
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
