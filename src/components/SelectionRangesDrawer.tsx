import { useEffect, useState } from "preact/hooks";
import { type WaitModeAttempt, loadAttemptHistory } from "../use-file-history";
import type { ThemeTokens } from "../theme";

interface SelectionRangesDrawerProps {
  open: boolean;
  onClose: () => void;
  theme: ThemeTokens;
  accent: string;
  totalMeasures: number;
  measureRange: { from: number; to: number } | null;
  onMeasureRangeChange: (r: { from: number; to: number } | null) => void;
  fileHash: string | null;
}

function rangesEqual(
  a: { from: number; to: number } | null,
  b: { from: number; to: number } | null,
): boolean {
  if (a === null && b === null) {
    return true;
  }
  if (a === null || b === null) {
    return false;
  }
  return a.from === b.from && a.to === b.to;
}

function selectionKey(range: { from: number; to: number } | null): string {
  return range ? `m${range.from}-m${range.to}` : "full";
}

function bestAttempt(attempts: WaitModeAttempt[]): WaitModeAttempt | null {
  if (attempts.length === 0) {
    return null;
  }
  return attempts.reduce((best, a) => {
    if (a.wrongNotes < best.wrongNotes) {
      return a;
    }
    if (a.wrongNotes === best.wrongNotes && a.elapsedMs < best.elapsedMs) {
      return a;
    }
    return best;
  });
}

function formatTime(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function MiniBar({
  from,
  to,
  total,
  accent,
  active,
}: {
  from: number;
  to: number;
  total: number;
  accent: string;
  active: boolean;
}) {
  const left = (from - 1) / total;
  const width = (to - from + 1) / total;
  return (
    <div
      style={{
        position: "relative",
        height: 6,
        borderRadius: 3,
        background: "rgba(128,128,128,0.15)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: `${left * 100}%`,
          width: `${width * 100}%`,
          top: 0,
          bottom: 0,
          borderRadius: 3,
          background: active ? accent : "rgba(128,128,128,0.45)",
        }}
      />
    </div>
  );
}

interface Preset {
  label: string;
  range: { from: number; to: number } | null;
}

export function SelectionRangesDrawer({
  open,
  onClose,
  theme,
  accent,
  totalMeasures,
  measureRange,
  onMeasureRangeChange,
  fileHash,
}: SelectionRangesDrawerProps) {
  const n = totalMeasures;

  const [attemptHistory, setAttemptHistory] = useState<
    Record<string, WaitModeAttempt[]>
  >({});

  useEffect(() => {
    if (open && fileHash) {
      setAttemptHistory(loadAttemptHistory(fileHash));
    }
  }, [open, fileHash]);

  const wholeIsActive =
    measureRange === null || (measureRange.from === 1 && measureRange.to === n);

  const halves: Preset[] = [
    { label: "First half", range: { from: 1, to: Math.floor(n / 2) } },
    {
      label: "Second half",
      range: { from: Math.floor(n / 2) + 1, to: n },
    },
  ];

  const quarters: Preset[] = [
    { label: "Q1", range: { from: 1, to: Math.floor(n / 4) } },
    {
      label: "Q2",
      range: { from: Math.floor(n / 4) + 1, to: Math.floor(n / 2) },
    },
    {
      label: "Q3",
      range: {
        from: Math.floor(n / 2) + 1,
        to: Math.floor((3 * n) / 4),
      },
    },
    {
      label: "Q4",
      range: { from: Math.floor((3 * n) / 4) + 1, to: n },
    },
  ];

  function handleSelect(range: { from: number; to: number } | null) {
    onMeasureRangeChange(range);
    onClose();
  }

  function bestForRange(
    range: { from: number; to: number } | null,
  ): WaitModeAttempt | null {
    const key = selectionKey(range);
    return bestAttempt(attemptHistory[key] ?? []);
  }

  return (
    <>
      {/* Backdrop */}
      <div
        role="button"
        tabIndex={-1}
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === "Escape" || e.key === "Enter") {
            onClose();
          }
        }}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.18)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.25s ease",
          zIndex: 10,
        }}
      />
      {/* Panel */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          bottom: 0,
          width: 300,
          background: theme.panelSolid,
          borderRight: `0.5px solid ${theme.border}`,
          boxShadow: open ? "20px 0 40px rgba(0,0,0,0.18)" : "none",
          transform: open ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.32s cubic-bezier(.32,.72,.36,1)",
          padding: "22px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
          color: theme.ink,
          zIndex: 11,
          overflowY: "auto",
          boxSizing: "border-box",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span
            style={{
              fontFamily: "'Instrument Serif', serif",
              fontSize: 22,
              fontStyle: "italic",
            }}
          >
            Sections
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: theme.inkSoft,
              cursor: "pointer",
              fontSize: 18,
              padding: 4,
              outline: "none",
            }}
          >
            ✕
          </button>
        </div>

        {/* Whole piece */}
        <PresetButton
          label="Whole piece"
          sublabel={`mm. 1–${n}`}
          best={bestForRange(null)}
          active={wholeIsActive}
          accent={accent}
          theme={theme}
          miniBar={
            <MiniBar
              from={1}
              to={n}
              total={n}
              accent={accent}
              active={wholeIsActive}
            />
          }
          onClick={() => handleSelect(null)}
        />

        {/* Halves */}
        {n >= 2 && (
          <Section label="Halves" theme={theme}>
            {halves.map((p) => {
              const active = rangesEqual(measureRange, p.range);
              return (
                <PresetButton
                  key={p.label}
                  label={p.label}
                  sublabel={p.range ? `mm. ${p.range.from}–${p.range.to}` : ""}
                  best={bestForRange(p.range)}
                  active={active}
                  accent={accent}
                  theme={theme}
                  miniBar={
                    p.range ? (
                      <MiniBar
                        from={p.range.from}
                        to={p.range.to}
                        total={n}
                        accent={accent}
                        active={active}
                      />
                    ) : null
                  }
                  onClick={() => handleSelect(p.range)}
                />
              );
            })}
          </Section>
        )}

        {/* Quarters */}
        {n >= 4 && (
          <Section label="Quarters" theme={theme}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
              }}
            >
              {quarters.map((p) => {
                const active = rangesEqual(measureRange, p.range);
                return (
                  <PresetButton
                    key={p.label}
                    label={p.label}
                    sublabel={
                      p.range ? `mm. ${p.range.from}–${p.range.to}` : ""
                    }
                    best={bestForRange(p.range)}
                    active={active}
                    accent={accent}
                    theme={theme}
                    miniBar={
                      p.range ? (
                        <MiniBar
                          from={p.range.from}
                          to={p.range.to}
                          total={n}
                          accent={accent}
                          active={active}
                        />
                      ) : null
                    }
                    onClick={() => handleSelect(p.range)}
                  />
                );
              })}
            </div>
          </Section>
        )}
      </div>
    </>
  );
}

function Section({
  label,
  theme,
  children,
}: {
  label: string;
  theme: ThemeTokens;
  children: preact.ComponentChildren;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: theme.inkSoft,
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function PresetButton({
  label,
  sublabel,
  best,
  active,
  accent,
  theme,
  miniBar,
  onClick,
}: {
  label: string;
  sublabel: string;
  best: WaitModeAttempt | null;
  active: boolean;
  accent: string;
  theme: ThemeTokens;
  miniBar: preact.ComponentChildren;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 7,
        padding: "10px 12px",
        borderRadius: 10,
        border: active
          ? `1.5px solid ${accent}`
          : `0.5px solid ${theme.border}`,
        background: active ? `${accent}18` : theme.panel,
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
        outline: "none",
        transition: "border-color 0.15s, background 0.15s",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: active ? 600 : 400,
            color: active ? accent : theme.ink,
          }}
        >
          {label}
        </span>
        <span style={{ fontSize: 10, color: theme.inkSoft }}>{sublabel}</span>
      </div>
      {miniBar}
      {best !== null ? (
        <span
          style={{
            fontSize: 10,
            color: best.wrongNotes === 0 ? "#5E8C5A" : theme.inkSoft,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          Best: {best.wrongNotes} wrong · {formatTime(best.elapsedMs)}
        </span>
      ) : (
        <span style={{ fontSize: 10, color: theme.inkFaint }}>
          No attempts yet
        </span>
      )}
    </button>
  );
}
