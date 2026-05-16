import { useEffect, useRef, useState } from "preact/hooks";
import { SheetMusicDisplay } from "../SheetMusicDisplay";
import type { MidiConversionResult, TrackInfo } from "../midi-to-musicxml";
import type { ThemeTokens } from "../theme";
import { cornerBtnStyle, hexA, miniBtnStyle } from "../theme";
import type { useBluetooth } from "../useBluetooth";
import { BluetoothHelpBadge } from "./BluetoothHelpBadge";
import { ConnectionBadge } from "./ConnectionBadge";
import { SelectionRangesDrawer } from "./SelectionRangesDrawer";
import { SettingsDrawer } from "./SettingsDrawer";
import {
  ChevronLeftIcon,
  GearIcon,
  PauseIcon,
  PlayIcon,
  ResetIcon,
  SectionsIcon,
} from "./icons";

interface PracticeScreenProps {
  theme: ThemeTokens;
  accent: string;
  fileName: string;
  pieceTitle: string;
  musicxml: MidiConversionResult | null;
  noteColors: Record<string, string>;
  playbackBeat: number | undefined;
  cursorColor: string;
  isPlaying: boolean;
  bpm: number;
  baseBpm: number;
  measureRange: { from: number; to: number } | null;
  bluetooth: ReturnType<typeof useBluetooth>;
  mode: "wait" | "race" | "listen";
  tracks: TrackInfo[];
  selectedTracks: number[];
  fileHash: string | null;
  onPlayPause: () => void;
  onReset: () => void;
  onBpmChange: (bpm: number) => void;
  onMeasureRangeChange: (r: { from: number; to: number } | null) => void;
  onModeChange: (mode: "wait" | "race" | "listen") => void;
  onTrackToggle: (idx: number) => void;
  onContextMenuAction: (
    action: "focus" | "seek" | "clearFocus",
    measureNumber: number,
    beat: number,
  ) => void;
  onGoToLanding: () => void;
  noteSensitivityMilliseconds: number;
  onSensitivityChange: (ms: number) => void;
}

export function PracticeScreen({
  theme,
  accent,
  fileName,
  pieceTitle,
  musicxml,
  noteColors,
  playbackBeat,
  cursorColor,
  isPlaying,
  bpm,
  baseBpm,
  measureRange,
  bluetooth,
  mode,
  tracks,
  selectedTracks,
  onPlayPause,
  onReset,
  onBpmChange,
  onMeasureRangeChange,
  onContextMenuAction,
  onModeChange,
  onTrackToggle,
  onGoToLanding,
  noteSensitivityMilliseconds,
  onSensitivityChange,
  fileHash,
}: PracticeScreenProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [rangesDrawerOpen, setRangesDrawerOpen] = useState(false);
  const [pieceInfoOpen, setPieceInfoOpen] = useState(false);
  // Imperative handle into SheetMusicDisplay's scroll logic — calling this
  // bypasses Preact state entirely, so the view responds in the same frame as
  // the pointer event with no render-cycle lag.
  const viewScrollRef = useRef<((beat: number | null) => void) | null>(null);

  // When wait mode is enabled, snap the sheet to the cursor position so it's
  // in view. Calling viewScrollRef with the beat then immediately with null
  // performs an instant scroll and releases scrub-lock so cursor-following resumes.
  const playbackBeatRef = useRef(playbackBeat);
  useEffect(() => {
    playbackBeatRef.current = playbackBeat;
  });
  useEffect(() => {
    if (mode === "wait" && playbackBeatRef.current !== undefined) {
      viewScrollRef.current?.(playbackBeatRef.current);
      viewScrollRef.current?.(null);
    }
  }, [mode]);

  const [contextMenu, setContextMenu] = useState<{
    clientX: number;
    clientY: number;
    measureNumber: number;
    beat: number;
  } | null>(null);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: theme.bg,
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
          focusRange={measureRange}
          focusColor={hexA(accent, 0.09)}
          onFocusRangeChange={onMeasureRangeChange}
          viewScrollRef={viewScrollRef}
          onSheetContextMenu={(info) => {
            setContextMenu(info);
          }}
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

      {/* TOP LEFT: back button + piece title */}
      <div
        style={{
          position: "absolute",
          top: 18,
          left: 22,
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <button
          type="button"
          onClick={onGoToLanding}
          style={cornerBtnStyle(theme) as Record<string, string | number>}
          title="Back"
        >
          <ChevronLeftIcon />
        </button>
        <button
          type="button"
          onClick={() => setPieceInfoOpen(true)}
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
              fontSize: 28,
              lineHeight: 1,
              letterSpacing: "-0.01em",
              color: theme.ink,
            }}
          >
            {pieceTitle}
          </div>
        </button>
      </div>

      {/* BOTTOM LEFT: transport controls + mode selector */}
      <div
        style={{ position: "absolute", bottom: 20, left: 22, zIndex: 2 }}
        class="bl-controls"
      >
        {/* Reset + Play/Pause + BPM row */}
        <div class="bl-transport">
          <button
            type="button"
            onClick={() => setRangesDrawerOpen(true)}
            style={cornerBtnStyle(theme) as Record<string, string | number>}
            title="Select section"
          >
            <SectionsIcon />
          </button>
          <button
            type="button"
            onClick={onReset}
            style={cornerBtnStyle(theme) as Record<string, string | number>}
            title={
              measureRange
                ? "Return to start of selection. Click to reset."
                : "Return to beginning. Click to reset."
            }
          >
            <ResetIcon />
          </button>
          {mode !== "wait" && (
            <button
              type="button"
              onClick={onPlayPause}
              style={cornerBtnStyle(theme) as Record<string, string | number>}
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
            </button>
          )}
          {mode !== "wait" && (
            <div
              style={{
                height: 38,
                padding: "0 8px",
                background: theme.panel,
                border: `0.5px solid ${theme.border}`,
                borderRadius: 12,
                backdropFilter: "blur(20px) saturate(160%)",
                WebkitBackdropFilter: "blur(20px) saturate(160%)",
                display: "flex",
                alignItems: "center",
                gap: 4,
                boxShadow: "0 4px 14px rgba(0,0,0,0.06)",
                boxSizing: "border-box",
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  color: theme.inkSoft,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  padding: "0 6px 0 2px",
                  userSelect: "none",
                }}
              >
                BPM
              </span>
              {([25, 50, 75, 100] as const).map((pct) => {
                const targetBpm = Math.round((baseBpm * pct) / 100);
                const active = bpm === targetBpm;
                return (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => onBpmChange(targetBpm)}
                    style={{
                      ...(miniBtnStyle(theme) as Record<
                        string,
                        string | number
                      >),
                      padding: "0 10px",
                      minWidth: 44,
                      background: active ? accent : undefined,
                      border: active ? "none" : undefined,
                      color: active ? "#FFF7E5" : theme.ink,
                      fontWeight: active ? 600 : 400,
                      fontSize: 13,
                      boxShadow: active
                        ? `0 2px 8px ${hexA(accent, 0.35)}`
                        : undefined,
                    }}
                    aria-pressed={active}
                  >
                    {targetBpm}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Mode selector group */}
        <div
          class="bl-modes"
          style={{
            padding: "4px 6px",
            background: theme.panel,
            border: `0.5px solid ${theme.border}`,
            borderRadius: 12,
            backdropFilter: "blur(20px) saturate(160%)",
            WebkitBackdropFilter: "blur(20px) saturate(160%)",
            display: "flex",
            alignItems: "center",
            gap: 2,
            boxShadow: "0 4px 14px rgba(0,0,0,0.06)",
          }}
        >
          {(["wait", "race", "listen"] as const).map((m) => {
            const active = mode === m;
            const labels: Record<string, string> = {
              wait: "Wait",
              race: "Playalong",
              listen: "Listen",
            };
            return (
              <button
                key={m}
                type="button"
                onClick={() => onModeChange(m)}
                disabled={m === "race"}
                style={{
                  ...(miniBtnStyle(theme) as Record<string, string | number>),
                  padding: "0 14px",
                  minWidth: 60,
                  height: 30,
                  background: active ? accent : "transparent",
                  color: active
                    ? "#FFF7E5"
                    : m === "race"
                      ? theme.inkFaint
                      : theme.ink,
                  fontWeight: active ? 600 : 400,
                  fontSize: 12,
                  boxShadow: active
                    ? `0 2px 8px ${hexA(accent, 0.35)}`
                    : undefined,
                  cursor: m === "race" ? "not-allowed" : "pointer",
                  justifyContent: "center",
                }}
                aria-pressed={active}
                title={
                  m === "race" ? "Playalong mode — coming soon" : undefined
                }
              >
                {labels[m]}
              </button>
            );
          })}
        </div>
      </div>

      {/* BOTTOM RIGHT: bluetooth + gear */}
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
        {bluetooth.status !== "connected" && (
          <BluetoothHelpBadge theme={theme} accent={accent} />
        )}
        <ConnectionBadge theme={theme} bluetooth={bluetooth} compact={true} />
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          style={cornerBtnStyle(theme) as Record<string, string | number>}
        >
          <GearIcon />
        </button>
      </div>

      <style>{`
        @keyframes bar0 { 0%,100% { height: 4px } 50% { height: 12px } }
        @keyframes bar1 { 0%,100% { height: 6px } 50% { height: 14px } }
        @keyframes bar2 { 0%,100% { height: 5px } 50% { height: 10px } }
        @keyframes bar3 { 0%,100% { height: 8px } 50% { height: 14px } }
        @keyframes bar4 { 0%,100% { height: 3px } 50% { height: 9px } }
        .bl-controls { display:flex; flex-direction:column; align-items:flex-start; gap:8px; }
        .bl-transport { display:flex; align-items:center; gap:10px; }
        @media (orientation:landscape) {
          .bl-controls { flex-direction:row; align-items:center; gap:10px; }
          .bl-modes { order:-1; }
        }
      `}</style>

      {/* Context menu (right-click / long-press on sheet music) */}
      {contextMenu && (
        <>
          <div
            role="presentation"
            style={{ position: "fixed", inset: 0, zIndex: 99 }}
            onClick={() => setContextMenu(null)}
            onKeyDown={(e) => {
              if ((e as unknown as KeyboardEvent).key === "Escape") {
                setContextMenu(null);
              }
            }}
          />
          <div
            style={{
              position: "fixed",
              left: contextMenu.clientX + 4,
              top: contextMenu.clientY + 4,
              zIndex: 100,
              background: theme.panel,
              border: `0.5px solid ${theme.border}`,
              borderRadius: 12,
              backdropFilter: "blur(20px) saturate(160%)",
              WebkitBackdropFilter: "blur(20px) saturate(160%)",
              padding: 4,
              boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
              display: "flex",
              flexDirection: "column",
              minWidth: 180,
            }}
          >
            {(
              [
                {
                  label: `Focus measure ${contextMenu.measureNumber}`,
                  action: "focus" as const,
                },
                {
                  label: "Move cursor to here",
                  action: "seek" as const,
                },
                ...(measureRange
                  ? [{ label: "Clear focus", action: "clearFocus" as const }]
                  : []),
              ] as { label: string; action: "focus" | "seek" | "clearFocus" }[]
            ).map(({ label, action }) => (
              <button
                key={action}
                type="button"
                onClick={() => {
                  onContextMenuAction(
                    action,
                    contextMenu.measureNumber,
                    contextMenu.beat,
                  );
                  setContextMenu(null);
                }}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "8px 12px",
                  textAlign: "left",
                  fontSize: 13,
                  color: theme.ink,
                  borderRadius: 8,
                  fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
                  width: "100%",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Piece info modal */}
      {pieceInfoOpen && (
        <>
          <div
            role="presentation"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 199,
              background: "rgba(0,0,0,0.3)",
              backdropFilter: "blur(4px)",
              WebkitBackdropFilter: "blur(4px)",
            }}
            onClick={() => setPieceInfoOpen(false)}
            onKeyDown={(e) => {
              if ((e as unknown as KeyboardEvent).key === "Escape") {
                setPieceInfoOpen(false);
              }
            }}
          />
          <div
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 200,
              background: theme.panel,
              border: `0.5px solid ${theme.border}`,
              borderRadius: 16,
              backdropFilter: "blur(24px) saturate(160%)",
              WebkitBackdropFilter: "blur(24px) saturate(160%)",
              padding: "24px 28px",
              boxShadow: "0 16px 48px rgba(0,0,0,0.18)",
              minWidth: 280,
            }}
          >
            <div
              style={{
                fontFamily: "'Instrument Serif', serif",
                fontStyle: "italic",
                fontSize: 24,
                color: theme.ink,
                marginBottom: 20,
              }}
            >
              {pieceTitle}
            </div>
            {(
              [
                ["File", fileName],
                [
                  "Tempo",
                  `${baseBpm} BPM${bpm !== baseBpm ? ` (playing at ${bpm})` : ""}`,
                ],
                ["Time signature", musicxml ? `${musicxml.timeSigNum}/4` : "—"],
                ["Tracks", String(tracks.length)],
              ] as [string, string][]
            ).map(([label, value]) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 24,
                  padding: "7px 0",
                  borderTop: `0.5px solid ${theme.border}`,
                  fontSize: 13,
                }}
              >
                <span style={{ color: theme.inkSoft, whiteSpace: "nowrap" }}>
                  {label}
                </span>
                <span
                  style={{
                    color: theme.ink,
                    textAlign: "right",
                    wordBreak: "break-all",
                  }}
                >
                  {value}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <SelectionRangesDrawer
        open={rangesDrawerOpen}
        onClose={() => setRangesDrawerOpen(false)}
        theme={theme}
        accent={accent}
        totalMeasures={
          musicxml ? Math.ceil(musicxml.totalBeats / musicxml.timeSigNum) : 1
        }
        measureRange={measureRange}
        onMeasureRangeChange={onMeasureRangeChange}
        fileHash={fileHash}
      />
      <SettingsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        theme={theme}
        accent={accent}
        tracks={tracks}
        selectedTracks={selectedTracks}
        bluetooth={bluetooth}
        onTrackToggle={onTrackToggle}
        noteSensitivityMilliseconds={noteSensitivityMilliseconds}
        onSensitivityChange={onSensitivityChange}
      />
    </div>
  );
}
