import type { TrackInfo } from "../../lib/midi/midi-to-musicxml";
import type { ThemeTokens } from "../theme";
import { serifTitle } from "../theme";
import { ResetIcon } from "./icons";

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  theme: ThemeTokens;
  accent: string;
  tracks: TrackInfo[];
  selectedTracks: number[];
  onTrackToggle: (idx: number) => void;
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
              {tracks.map((t) => (
                <label
                  key={t.index}
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
                    checked={selectedTracks.includes(t.index)}
                    onChange={() => onTrackToggle(t.index)}
                    style={{ accentColor: accent }}
                  />
                  <span style={{ color: theme.ink }}>
                    {t.name} ({t.noteCount} notes)
                  </span>
                </label>
              ))}
            </div>
          </DrawerRow>
        )}

        {/* Playalong: play music aloud (Web Audio) */}
        <DrawerRow
          theme={theme}
          label="Playalong mode: play music aloud"
          hint=""
        >
          <label
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
              checked={playalongPlayMusic}
              onChange={(e) =>
                onPlayalongPlayMusicChange(
                  (e.target as HTMLInputElement).checked,
                )
              }
              style={{ accentColor: accent }}
            />
            <span style={{ color: theme.inkSoft }}>
              Play the song through the device speaker
            </span>
          </label>
        </DrawerRow>

        {/* Playalong: metronome via piano */}
        <DrawerRow theme={theme} label="Playalong mode: metronome" hint="">
          <label
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
              checked={playalongMetronome}
              onChange={(e) =>
                onPlayalongMetronomeChange(
                  (e.target as HTMLInputElement).checked,
                )
              }
              style={{ accentColor: accent }}
            />
            <span style={{ color: theme.inkSoft }}>
              Send hi-hat ticks through the piano on each beat
            </span>
          </label>
        </DrawerRow>

        {/* Playalong: count-in */}
        <DrawerRow theme={theme} label="Playalong mode: count-in" hint="">
          <label
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
              checked={playalongCountIn}
              onChange={(e) =>
                onPlayalongCountInChange((e.target as HTMLInputElement).checked)
              }
              style={{ accentColor: accent }}
            />
            <span style={{ color: theme.inkSoft }}>
              Count in before playback; when off, start on your first note
            </span>
          </label>
        </DrawerRow>
      </div>
    </>
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
