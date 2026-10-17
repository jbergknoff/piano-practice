import type { TrackInfo } from "@jbergknoff/midi-to-musicxml";
import { radius, color } from "../theme";
import { Drawer } from "./Drawer";
import { ModalHeader } from "./Modal";
import { ResetIcon } from "./icons";

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
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
    <Drawer
      open={open}
      onClose={onClose}
      side="right"
      label="Settings"
      style={{
        width: 320,
        background: color.panelSolid,
        borderLeft: `0.5px solid ${color.border}`,
        boxShadow: "-20px 0 40px rgba(0,0,0,0.18)",
        padding: "22px 24px",
        gap: 18,
        color: color.ink,
        overflowY: "auto",
      }}
    >
      <ModalHeader
        title="Settings"
        onClose={onClose}
        closeLabel="Close settings"
      />

      {/* Tracks (if multiple) */}
      {tracks.length > 1 && (
        <DrawerRow label="Tracks" hint="">
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
                  style={{ accentColor: color.accent }}
                />
                <span style={{ color: color.ink }}>
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
            color: color.inkSoft,
          }}
        >
          Playalong Mode
        </span>

        <ToggleRow
          label="Play music aloud"
          options={[
            { label: "On", value: true },
            { label: "Off", value: false },
          ]}
          value={playalongPlayMusic}
          onChange={onPlayalongPlayMusicChange}
        />

        <ToggleRow
          label="Metronome"
          options={[
            { label: "On", value: true },
            { label: "Off", value: false },
          ]}
          value={playalongMetronome}
          onChange={onPlayalongMetronomeChange}
        />

        <ToggleRow
          label="Start on"
          options={[
            { label: "Count-in", value: true },
            { label: "First played note", value: false },
          ]}
          value={playalongCountIn}
          onChange={onPlayalongCountInChange}
        />
      </div>
    </Drawer>
  );
}

function ToggleRow({
  label,
  options,
  value,
  onChange,
}: {
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
      <span style={{ fontSize: 12, fontWeight: 500, color: color.ink }}>
        {label}
      </span>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: "3px 4px",
          // glassPanel's colours without its backdrop-filter: on the drawer's
          // solid background the blur had nothing to blur, but the GPU still
          // recomputed it every frame of the drawer's slide, which made the
          // settings drawer choppy on a phone.
          background: color.panel,
          border: `0.5px solid ${color.border}`,
          borderRadius: radius.md,
          flexShrink: 0,
        }}
      >
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            onClick={() => onChange(option.value)}
            class="chip-toggle"
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
  label,
  hint,
  onReset,
  children,
}: {
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
        <span style={{ fontSize: 12, fontWeight: 500, color: color.ink }}>
          {label}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {hint && (
            <span style={{ fontSize: 11, color: color.inkSoft }}>{hint}</span>
          )}
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: color.inkSoft,
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
