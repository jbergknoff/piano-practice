import type { WaitModeAttempt } from "../use-file-history";
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

function RatioChip({
  elapsedMs,
  expectedMs,
  accent,
}: { elapsedMs: number; expectedMs: number; accent: string }) {
  const ratio = expectedMs > 0 ? elapsedMs / expectedMs : 1;
  const label = ratio <= 1.05 ? `${ratio.toFixed(2)}×` : `${ratio.toFixed(2)}×`;
  const color = ratio <= 1.1 ? "#2e7d32" : ratio <= 1.5 ? "#e65100" : "#c62828";
  return (
    <span
      style={{
        fontVariantNumeric: "tabular-nums",
        color,
        fontWeight: 600,
      }}
    >
      {label}
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

        {/* Latest attempt stats */}
        {latest && (
          <div
            style={{
              background: hexA(accent, 0.07),
              border: `0.5px solid ${hexA(accent, 0.2)}`,
              borderRadius: 12,
              padding: "14px 16px",
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 8,
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
                    fontSize: 20,
                    fontWeight: 600,
                    color: theme.ink,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {value}
                </span>
              </div>
            ))}
            <div
              style={{
                gridColumn: "1 / -1",
                borderTop: `0.5px solid ${hexA(accent, 0.15)}`,
                paddingTop: 10,
                marginTop: 4,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  color: theme.inkSoft,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                Pace
              </span>
              <span style={{ fontSize: 15, fontWeight: 500, color: theme.ink }}>
                <RatioChip
                  elapsedMs={latest.elapsedMs}
                  expectedMs={expectedDurationMs}
                  accent={accent}
                />{" "}
                <span
                  style={{
                    color: theme.inkSoft,
                    fontWeight: 400,
                    fontSize: 13,
                  }}
                >
                  expected time
                </span>
              </span>
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
                  gridTemplateColumns: "1fr 72px 60px 52px",
                  padding: "7px 12px",
                  background: hexA(theme.ink, 0.04),
                  borderBottom: `0.5px solid ${theme.border}`,
                }}
              >
                {(["When", "Wrong", "Time", "Pace"] as string[]).map((h) => (
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
                    gridTemplateColumns: "1fr 72px 60px 52px",
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
                  <span
                    style={{
                      fontSize: 12,
                      color: theme.ink,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {formatTime(a.elapsedMs)}
                  </span>
                  <RatioChip
                    elapsedMs={a.elapsedMs}
                    expectedMs={expectedDurationMs}
                    accent={accent}
                  />
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
