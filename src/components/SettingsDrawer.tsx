import type { TrackInfo } from "../../lib/midi/midi-to-musicxml";
import {
  type ThemeTokens,
  chipToggleButtonStyle,
  glassPanel,
  radius,
  serifTitle,
} from "../theme";
import { ResetIcon } from "./icons";

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  theme: ThemeTokens;
  accent: string;
  tracks: TrackInfo[];
  selectedTracks: number[];
  onTrackToggle: (index: number) => void;
  playalongPlayMusic: boolean;
  onPlayalongPlayMusicChange: (enabled: boolean) => void;
  playalongMetronome: boolean;
  onPlayalongMetronomeChange: (enabled: boolean) => void;
  playalongCountIn: boolean;
  onPlayalongCountInChange: (enabled: boolean) => void;
}

export function SettingsDrawer({
  open,
  onClose,
  theme,
  accent,
  tracks,
  selectedTracks,
  onTrackToggle,
  playalongPlayMusic,
  onPlayalongPlayMusicChange,
  playalongMetronome,
  onPlayalongMetronomeChange,
  playalongCountIn,
  onPlayalongCountInChange,
}: SettingsDrawerProps) {
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
          right: 0,
          bottom: 0,
          width: 320,
          background: theme.panelSolid,
          borderLeft: `0.5px solid ${theme.border}`,
          boxShadow: open ? "-20px 0 40px rgba(0,0,0,0.18)" : "none",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.32s cubic-bezier(.32,.72,.36,1)",
          padding: "22px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          color: theme.ink,
          zIndex: 11,
          overflowY: "auto",
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
          <span style={serifTitle(theme, 22)}>Settings</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
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

        {/* Tracks (if multiple) */}
        {tracks.length > 1 && (
          <DrawerRow theme={theme} label="Tracks" hint="">
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {tracks.map((track) => (
                <label
                  key={track.index}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedTracks.includes(track.index)}
                    onChange={() => onTrackToggle(track.index)}
                    style={{ accentColor: accent }}
                  />
                  <span style={{ color: theme.ink }}>
                    {track.name} ({track.noteCount} notes)
                  </span>
                </label>
              ))}
            </div>
          </DrawerRow>
        )}

        {/* Playalong Mode section */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: theme.inkSoft,
            }}
          >
            Playalong Mode
          </span>

          <ToggleRow
            theme={theme}
            accent={accent}
            label="Play music aloud"
            options={[
              { label: "On", value: true },
              { label: "Off", value: false },
            ]}
            value={playalongPlayMusic}
            onChange={onPlayalongPlayMusicChange}
          />

          <ToggleRow
            theme={theme}
            accent={accent}
            label="Metronome"
            options={[
              { label: "On", value: true },
              { label: "Off", value: false },
            ]}
            value={playalongMetronome}
            onChange={onPlayalongMetronomeChange}
          />

          <ToggleRow
            theme={theme}
            accent={accent}
            label="Start on"
            options={[
              { label: "Count-in", value: true },
              { label: "First played note", value: false },
            ]}
            value={playalongCountIn}
            onChange={onPlayalongCountInChange}
          />
        </div>
      </div>
    </>
  );
}

function ToggleRow({
  theme,
  accent,
  label,
  options,
  value,
  onChange,
}: {
  theme: ThemeTokens;
  accent: string;
  label: string;
  options: Array<{ label: string; value: boolean }>;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 500, color: theme.ink }}>
        {label}
      </span>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: "3px 4px",
          ...glassPanel(theme),
          borderRadius: radius.md,
          flexShrink: 0,
        }}
      >
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            onClick={() => onChange(option.value)}
            style={chipToggleButtonStyle(theme, accent, value === option.value)}
            aria-pressed={value === option.value}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function DrawerRow({
  theme,
  label,
  hint,
  onReset,
  children,
}: {
  theme: ThemeTokens;
  label: string;
  hint: string;
  onReset?: () => void;
  children: preact.ComponentChildren;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 500, color: theme.ink }}>
          {label}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {hint && (
            <span style={{ fontSize: 11, color: theme.inkSoft }}>{hint}</span>
          )}
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: theme.inkSoft,
                padding: 4,
                lineHeight: 0,
              }}
              title="Reset to default"
            >
              <ResetIcon size={12} />
            </button>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}
