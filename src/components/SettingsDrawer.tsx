import type { TrackInfo } from "../midi-to-musicxml";
import type { ThemeTokens } from "../theme";
import type { useBluetooth } from "../useBluetooth";

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  theme: ThemeTokens;
  accent: string;
  tracks: TrackInfo[];
  selectedTracks: number[];
  bluetooth: ReturnType<typeof useBluetooth>;
  onTrackToggle: (idx: number) => void;
  noteSensitivityMilliseconds: number;
  onSensitivityChange: (ms: number) => void;
  playalongTimingBeats: number;
  onPlayalongTimingChange: (beats: number) => void;
  playalongPianoAudio: boolean;
  onPlayalongPianoAudioChange: (enabled: boolean) => void;
}

function sensitivityLabel(ms: number): string {
  if (ms === 0) {
    return "Strict";
  }
  if (ms <= 100) {
    return "Low";
  }
  if (ms <= 250) {
    return "Normal";
  }
  if (ms <= 400) {
    return "High";
  }
  return "Lenient";
}

export function SettingsDrawer({
  open,
  onClose,
  theme,
  accent,
  tracks,
  selectedTracks,
  bluetooth,
  onTrackToggle,
  noteSensitivityMilliseconds,
  onSensitivityChange,
  playalongTimingBeats,
  onPlayalongTimingChange,
  playalongPianoAudio,
  onPlayalongPianoAudioChange,
}: SettingsDrawerProps) {
  const connected = bluetooth.status === "connected";

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
          <span
            style={{
              fontFamily: "'Instrument Serif', serif",
              fontSize: 22,
              fontStyle: "italic",
            }}
          >
            Settings
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

        {/* Note sensitivity slider */}
        <DrawerRow
          theme={theme}
          label="Note sensitivity"
          hint={sensitivityLabel(noteSensitivityMilliseconds)}
        >
          <input
            type="range"
            min={0}
            max={500}
            step={25}
            value={noteSensitivityMilliseconds}
            onInput={(e) =>
              onSensitivityChange(Number((e.target as HTMLInputElement).value))
            }
            style={{ width: "100%", accentColor: accent }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 10,
              color: theme.inkSoft,
              marginTop: -2,
            }}
          >
            <span>Strict</span>
            <span>Lenient</span>
          </div>
        </DrawerRow>

        {/* Playalong timing window */}
        <DrawerRow
          theme={theme}
          label="Playalong timing window"
          hint={`±${playalongTimingBeats.toFixed(2)} beats`}
        >
          <input
            type="range"
            min={0.1}
            max={1.0}
            step={0.05}
            value={playalongTimingBeats}
            onInput={(e) =>
              onPlayalongTimingChange(
                Number((e.target as HTMLInputElement).value),
              )
            }
            style={{ width: "100%", accentColor: accent }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 10,
              color: theme.inkSoft,
              marginTop: -2,
            }}
          >
            <span>Tight</span>
            <span>Loose</span>
          </div>
        </DrawerRow>

        {/* Playalong piano audio toggle */}
        <DrawerRow theme={theme} label="Piano plays along" hint="">
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
              checked={playalongPianoAudio}
              onChange={(e) =>
                onPlayalongPianoAudioChange(
                  (e.target as HTMLInputElement).checked,
                )
              }
              style={{ accentColor: accent }}
            />
            <span style={{ color: theme.inkSoft }}>
              Play guide notes through the piano at low volume
            </span>
          </label>
        </DrawerRow>

        {/* Footer — connection */}
        <div
          style={{
            marginTop: "auto",
            paddingTop: 14,
            borderTop: `0.5px solid ${theme.border}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: 10,
              color: theme.inkSoft,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {connected ? "Connected" : "Not connected"}
          </span>
          {connected ? (
            <span
              style={{
                fontSize: 11,
                color: theme.ink,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#5E8C5A",
                  flexShrink: 0,
                }}
              />
              {bluetooth.deviceName}
            </span>
          ) : (
            <button
              type="button"
              onClick={bluetooth.connect}
              style={{
                fontSize: 11,
                color: accent,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 0,
                outline: "none",
              }}
            >
              Connect piano…
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function DrawerRow({
  theme,
  label,
  hint,
  children,
}: {
  theme: ThemeTokens;
  label: string;
  hint: string;
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
        {hint && (
          <span style={{ fontSize: 11, color: theme.inkSoft }}>{hint}</span>
        )}
      </div>
      {children}
    </div>
  );
}
