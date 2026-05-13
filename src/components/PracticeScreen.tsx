import { useState } from "preact/hooks";
import { SheetMusicDisplay } from "../SheetMusicDisplay";
import type { MidiConversionResult, TrackInfo } from "../midi-to-musicxml";
import type { ThemeTokens } from "../theme";
import { cornerBtnStyle, hexA, miniBtnStyle } from "../theme";
import type { useBluetooth } from "../useBluetooth";
import { BluetoothHelpBadge } from "./BluetoothHelpBadge";
import { ConnectionBadge } from "./ConnectionBadge";
import { SettingsDrawer } from "./SettingsDrawer";
import {
  GearIcon,
  LoopIcon,
  MicIcon,
  MinusIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  StopIcon,
} from "./icons";

interface PracticeScreenProps {
  theme: ThemeTokens;
  accent: string;
  pieceTitle: string;
  musicxml: MidiConversionResult | null;
  noteColors: Record<string, string>;
  playbackBeat: number | undefined;
  cursorColor: string;
  isPlaying: boolean;
  bpm: number;
  showLoop: boolean;
  measureRange: { from: number; to: number } | null;
  totalMeasures: number;
  currentMeasure: number;
  bluetooth: ReturnType<typeof useBluetooth>;
  waitMode: boolean;
  tracks: TrackInfo[];
  selectedTracks: number[];
  onPlayPause: () => void;
  onStop: () => void;
  onBpmChange: (bpm: number) => void;
  onLoopToggle: () => void;
  onMeasureRangeChange: (r: { from: number; to: number } | null) => void;
  onToggleWaitMode: () => void;
  onTrackToggle: (idx: number) => void;
  onGoToLanding: () => void;
}

export function PracticeScreen({
  theme,
  accent,
  pieceTitle,
  musicxml,
  noteColors,
  playbackBeat,
  cursorColor,
  isPlaying,
  bpm,
  showLoop,
  measureRange,
  totalMeasures,
  currentMeasure,
  bluetooth,
  waitMode,
  tracks,
  selectedTracks,
  onPlayPause,
  onStop,
  onBpmChange,
  onLoopToggle,
  onMeasureRangeChange,
  onToggleWaitMode,
  onTrackToggle,
  onGoToLanding,
}: PracticeScreenProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const progress = totalMeasures > 0 ? (currentMeasure - 1) / totalMeasures : 0;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: `radial-gradient(120% 80% at 50% 0%, ${theme.bg} 0%, ${theme.bgDeep} 100%)`,
        color: theme.ink,
        fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Paper texture */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity: 0.5,
          background:
            "radial-gradient(circle at 30% 20%, rgba(0,0,0,0.04) 0px, transparent 60%), radial-gradient(circle at 70% 80%, rgba(0,0,0,0.04) 0px, transparent 60%)",
        }}
      />

      {/* Sheet music — full bleed */}
      {musicxml ? (
        <SheetMusicDisplay
          musicxml={musicxml.musicxml}
          noteColors={noteColors}
          playbackBeat={playbackBeat}
          cursorColor={cursorColor}
          inkColor={theme.ink}
          loopRange={showLoop ? measureRange : null}
          loopColor={hexA(accent, 0.09)}
          containerStyle={{
            position: "absolute",
            inset: 0,
            overflowX: "auto",
            overflowY: "hidden",
            padding: "56px 60px 64px",
            display: "flex",
            alignItems: "center",
          }}
        />
      ) : (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: theme.inkFaint,
            fontSize: 14,
          }}
        >
          Loading…
        </div>
      )}

      {/* Left fade */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 50,
          bottom: 56,
          width: 50,
          pointerEvents: "none",
          background: `linear-gradient(90deg, ${theme.bg} 0%, transparent 100%)`,
          zIndex: 1,
        }}
      />
      {/* Right fade */}
      <div
        style={{
          position: "absolute",
          right: 0,
          top: 50,
          bottom: 56,
          width: 50,
          pointerEvents: "none",
          background: `linear-gradient(270deg, ${theme.bg} 0%, transparent 100%)`,
          zIndex: 1,
        }}
      />

      {/* TOP LEFT: piece title */}
      <div style={{ position: "absolute", top: 18, left: 22, zIndex: 2 }}>
        <button
          type="button"
          onClick={onGoToLanding}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
            textAlign: "left",
          }}
        >
          <div
            style={{
              fontFamily: "'Instrument Serif', serif",
              fontStyle: "italic",
              fontSize: 22,
              lineHeight: 1,
              letterSpacing: "-0.01em",
              color: theme.ink,
            }}
          >
            {pieceTitle}
          </div>
          <div
            style={{
              fontSize: 10,
              marginTop: 4,
              color: theme.inkSoft,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {musicxml ? `${musicxml.timeSigNum}/4` : ""}
            {tracks.length > 0
              ? ` · ${tracks.length} track${tracks.length !== 1 ? "s" : ""}`
              : ""}
          </div>
        </button>
      </div>

      {/* TOP RIGHT: connection badge + measure progress + gear */}
      <div
        style={{
          position: "absolute",
          top: 18,
          right: 22,
          display: "flex",
          alignItems: "center",
          gap: 14,
          zIndex: 2,
        }}
      >
        {bluetooth.status !== "connected" && (
          <BluetoothHelpBadge theme={theme} accent={accent} />
        )}
        <ConnectionBadge theme={theme} bluetooth={bluetooth} compact={true} />
        {totalMeasures > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 4,
            }}
          >
            <span
              style={{
                fontSize: 9,
                color: theme.inkSoft,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Measure {currentMeasure} / {totalMeasures}
            </span>
            <div
              style={{
                width: 120,
                height: 3,
                background: theme.border,
                borderRadius: 2,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, progress * 100)}%`,
                  height: "100%",
                  background: accent,
                  borderRadius: 2,
                  transition: "width 0.4s ease",
                }}
              />
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          style={cornerBtnStyle(theme) as Record<string, string | number>}
        >
          <GearIcon />
        </button>
      </div>

      {/* BOTTOM LEFT: transport controls */}
      <div
        style={{
          position: "absolute",
          bottom: 20,
          left: 22,
          display: "flex",
          alignItems: "center",
          gap: 10,
          zIndex: 2,
        }}
      >
        <button
          type="button"
          onClick={onPlayPause}
          disabled={waitMode}
          style={{
            ...(cornerBtnStyle(theme) as Record<string, string | number>),
            width: 52,
            height: 52,
            background: accent,
            color: "#FFF7E5",
            border: "none",
            boxShadow: `0 6px 18px ${hexA(accent, 0.35)}, inset 0 1px 0 rgba(255,255,255,0.25)`,
            opacity: waitMode ? 0.5 : 1,
          }}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
        </button>
        <button
          type="button"
          onClick={onStop}
          style={cornerBtnStyle(theme) as Record<string, string | number>}
          title="Stop"
        >
          <StopIcon />
        </button>

        {/* Wait-mode toggle — styled as a chip */}
        <button
          type="button"
          onClick={onToggleWaitMode}
          style={{
            ...(cornerBtnStyle(theme) as Record<string, string | number>),
            width: "auto",
            padding: "0 12px",
            background: waitMode ? hexA(accent, 0.18) : theme.panel,
            color: waitMode ? accent : theme.inkSoft,
            borderColor: waitMode ? hexA(accent, 0.35) : theme.border,
            fontSize: 11,
            letterSpacing: "0.04em",
            gap: 6,
          }}
          title={waitMode ? "Disable wait mode" : "Enable wait mode"}
        >
          <MicIcon size={12} />
          <span>Wait</span>
        </button>
      </div>

      {/* BOTTOM RIGHT: loop toggle + BPM */}
      <div
        style={{
          position: "absolute",
          bottom: 20,
          right: 22,
          display: "flex",
          alignItems: "center",
          gap: 10,
          zIndex: 2,
        }}
      >
        <button
          type="button"
          onClick={onLoopToggle}
          style={{
            ...(cornerBtnStyle(theme) as Record<string, string | number>),
            background: showLoop ? hexA(accent, 0.18) : theme.panel,
            color: showLoop ? accent : theme.ink,
            borderColor: showLoop ? hexA(accent, 0.35) : theme.border,
          }}
          title="Loop section"
        >
          <LoopIcon />
        </button>

        {/* BPM panel */}
        <div
          style={{
            padding: "8px 6px 8px 14px",
            background: theme.panel,
            border: `0.5px solid ${theme.border}`,
            borderRadius: 12,
            backdropFilter: "blur(20px) saturate(160%)",
            WebkitBackdropFilter: "blur(20px) saturate(160%)",
            display: "flex",
            alignItems: "center",
            gap: 4,
            boxShadow: "0 4px 14px rgba(0,0,0,0.06)",
          }}
        >
          <button
            type="button"
            onClick={() => onBpmChange(Math.max(40, bpm - 4))}
            style={miniBtnStyle(theme) as Record<string, string | number>}
          >
            <MinusIcon />
          </button>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              minWidth: 52,
            }}
          >
            <span
              style={{
                fontFamily: "'Geist Mono', monospace",
                fontSize: 18,
                fontWeight: 500,
                lineHeight: 1,
                color: theme.ink,
                letterSpacing: "-0.01em",
              }}
            >
              {bpm}
            </span>
            <span
              style={{
                fontSize: 8,
                color: theme.inkSoft,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                marginTop: 2,
              }}
            >
              BPM
            </span>
          </div>
          <button
            type="button"
            onClick={() => onBpmChange(Math.min(220, bpm + 4))}
            style={miniBtnStyle(theme) as Record<string, string | number>}
          >
            <PlusIcon />
          </button>
        </div>
      </div>

      <style>{`
        @keyframes bar0 { 0%,100% { height: 4px } 50% { height: 12px } }
        @keyframes bar1 { 0%,100% { height: 6px } 50% { height: 14px } }
        @keyframes bar2 { 0%,100% { height: 5px } 50% { height: 10px } }
        @keyframes bar3 { 0%,100% { height: 8px } 50% { height: 14px } }
        @keyframes bar4 { 0%,100% { height: 3px } 50% { height: 9px } }
      `}</style>

      <SettingsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        theme={theme}
        accent={accent}
        tracks={tracks}
        selectedTracks={selectedTracks}
        bluetooth={bluetooth}
        onTrackToggle={onTrackToggle}
      />
    </div>
  );
}
