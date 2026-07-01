import { useEffect, useState } from "preact/hooks";
import type { RepeatSection } from "../../lib/musicxml/musicxml-playback";
import {
  type CustomRange,
  type PlayalongAttempt,
  type WaitModeAttempt,
  loadAttemptHistory,
  loadPlayalongAttemptHistory,
} from "../hooks/use-file-history";
import type { ThemeTokens } from "../theme";
import { miniButtonStyle, serifTitle } from "../theme";
import { PencilIcon, PlusIcon } from "./icons";

interface SelectionRangesDrawerProps {
  open: boolean;
  onClose: () => void;
  theme: ThemeTokens;
  accent: string;
  totalMeasures: number;
  measureRange: { from: number; to: number } | null;
  onMeasureRangeChange: (r: { from: number; to: number } | null) => void;
  fileHash: string | null;
  markedBpm: number;
  customRanges: CustomRange[];
  onEditCustomRange: (range: CustomRange) => void;
  onCreateCustomRange: () => void;
  repeatSections: RepeatSection[];
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
  return attempts.reduce((best, a) => (a.score > best.score ? a : best));
}

function bestPlayalongAttempt(
  attempts: PlayalongAttempt[],
  markedBpm: number,
): PlayalongAttempt | null {
  const atTempo = attempts.filter((a) => a.bpm === markedBpm);
  if (atTempo.length === 0) {
    return null;
  }
  return atTempo.reduce((best, a) => (a.score > best.score ? a : best));
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
  markedBpm,
  customRanges,
  onEditCustomRange,
  onCreateCustomRange,
  repeatSections,
}: SelectionRangesDrawerProps) {
  const n = totalMeasures;

  const [attemptHistory, setAttemptHistory] = useState<
    Record<string, WaitModeAttempt[]>
  >({});
  const [playalongHistory, setPlayalongHistory] = useState<
    Record<string, PlayalongAttempt[]>
  >({});

  useEffect(() => {
    if (open && fileHash) {
      setAttemptHistory(loadAttemptHistory(fileHash));
      setPlayalongHistory(loadPlayalongAttemptHistory(fileHash));
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

  function bestPlayalongForRange(
    range: { from: number; to: number } | null,
  ): PlayalongAttempt | null {
    const key = selectionKey(range);
    return bestPlayalongAttempt(playalongHistory[key] ?? [], markedBpm);
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
          <span style={serifTitle(theme, 22)}>Ranges</span>
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

        {/* Custom ranges */}
        <Section
          label="Custom"
          theme={theme}
          action={
            <button
              type="button"
              onClick={onCreateCustomRange}
              title="New custom range"
              style={miniButtonStyle(theme)}
            >
              <PlusIcon />
            </button>
          }
        >
          {customRanges.length === 0 ? (
            <span style={{ fontSize: 11, color: theme.inkFaint }}>
              No custom ranges yet
            </span>
          ) : (
            customRanges.map((cr) => {
              const range = { from: cr.from, to: cr.to };
              const active = rangesEqual(measureRange, range);
              return (
                <CustomRangeButton
                  key={cr.id}
                  label={cr.name}
                  sublabel={
                    cr.from === cr.to
                      ? `m. ${cr.from}`
                      : `mm. ${cr.from}–${cr.to}`
                  }
                  best={bestForRange(range)}
                  bestPlayalong={bestPlayalongForRange(range)}
                  active={active}
                  accent={accent}
                  theme={theme}
                  miniBar={
                    <MiniBar
                      from={cr.from}
                      to={cr.to}
                      total={n}
                      accent={accent}
                      active={active}
                    />
                  }
                  onClick={() => handleSelect(range)}
                  onEdit={() => onEditCustomRange(cr)}
                />
              );
            })
          )}
        </Section>

        <div style={{ height: 1, background: theme.border }} />

        {/* Whole piece */}
        <PresetButton
          label="Whole piece"
          sublabel={`mm. 1–${n}`}
          best={bestForRange(null)}
          bestPlayalong={bestPlayalongForRange(null)}
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

        {/* Repeat sections */}
        {repeatSections.length > 0 && (
          <Section label="Sections" theme={theme}>
            {repeatSections.map((sec) => {
              const range = { from: sec.from, to: sec.to };
              const active = rangesEqual(measureRange, range);
              return (
                <PresetButton
                  key={sec.label}
                  label={sec.label}
                  sublabel={`mm. ${sec.from}–${sec.to}`}
                  best={bestForRange(range)}
                  bestPlayalong={bestPlayalongForRange(range)}
                  active={active}
                  accent={accent}
                  theme={theme}
                  miniBar={
                    <MiniBar
                      from={sec.from}
                      to={sec.to}
                      total={n}
                      accent={accent}
                      active={active}
                    />
                  }
                  onClick={() => handleSelect(range)}
                />
              );
            })}
          </Section>
        )}

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
                  bestPlayalong={bestPlayalongForRange(p.range)}
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
                    bestPlayalong={bestPlayalongForRange(p.range)}
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
  action,
  children,
}: {
  label: string;
  theme: ThemeTokens;
  action?: preact.ComponentChildren;
  children: preact.ComponentChildren;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
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
        {action}
      </div>
      {children}
    </div>
  );
}

function RangeContent({
  label,
  sublabel,
  best,
  bestPlayalong,
  active,
  accent,
  theme,
  miniBar,
}: {
  label: string;
  sublabel: string;
  best: WaitModeAttempt | null;
  bestPlayalong: PlayalongAttempt | null;
  active: boolean;
  accent: string;
  theme: ThemeTokens;
  miniBar: preact.ComponentChildren;
}) {
  const hasAny = best !== null || bestPlayalong !== null;
  return (
    <>
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
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        <span
          style={{ fontSize: 10, color: theme.inkSoft, whiteSpace: "nowrap" }}
        >
          {sublabel}
        </span>
      </div>
      {miniBar}
      {hasAny ? (
        <div
          style={{
            display: "flex",
            gap: 8,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {best !== null && (
            <span style={{ fontSize: 10, color: scoreColor(best.score) }}>
              Wait {best.score}%
            </span>
          )}
          {bestPlayalong !== null && (
            <span
              style={{ fontSize: 10, color: scoreColor(bestPlayalong.score) }}
            >
              Play {bestPlayalong.score}%
            </span>
          )}
        </div>
      ) : (
        <span style={{ fontSize: 10, color: theme.inkFaint }}>
          No attempts yet
        </span>
      )}
    </>
  );
}

function PresetButton({
  label,
  sublabel,
  best,
  bestPlayalong,
  active,
  accent,
  theme,
  miniBar,
  onClick,
}: {
  label: string;
  sublabel: string;
  best: WaitModeAttempt | null;
  bestPlayalong: PlayalongAttempt | null;
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
      aria-pressed={active}
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
      <RangeContent
        label={label}
        sublabel={sublabel}
        best={best}
        bestPlayalong={bestPlayalong}
        active={active}
        accent={accent}
        theme={theme}
        miniBar={miniBar}
      />
    </button>
  );
}

function CustomRangeButton({
  label,
  sublabel,
  best,
  bestPlayalong,
  active,
  accent,
  theme,
  miniBar,
  onClick,
  onEdit,
}: {
  label: string;
  sublabel: string;
  best: WaitModeAttempt | null;
  bestPlayalong: PlayalongAttempt | null;
  active: boolean;
  accent: string;
  theme: ThemeTokens;
  miniBar: preact.ComponentChildren;
  onClick: () => void;
  onEdit: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 6,
        borderRadius: 10,
        border: active
          ? `1.5px solid ${accent}`
          : `0.5px solid ${theme.border}`,
        background: active ? `${accent}18` : theme.panel,
        transition: "border-color 0.15s, background 0.15s",
      }}
    >
      <button
        type="button"
        onClick={onClick}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 7,
          padding: "10px 12px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          flex: 1,
          minWidth: 0,
          outline: "none",
        }}
      >
        <RangeContent
          label={label}
          sublabel={sublabel}
          best={best}
          bestPlayalong={bestPlayalong}
          active={active}
          accent={accent}
          theme={theme}
          miniBar={miniBar}
        />
      </button>
      <button
        type="button"
        onClick={onEdit}
        title="Rename"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 38,
          flexShrink: 0,
          background: "transparent",
          border: "none",
          borderLeft: `0.5px solid ${theme.border}`,
          color: theme.inkSoft,
          cursor: "pointer",
          outline: "none",
        }}
      >
        <PencilIcon />
      </button>
    </div>
  );
}
