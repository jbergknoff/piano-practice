import { useEffect, useRef, useState } from "preact/hooks";
import { SheetMusicDisplay } from "../SheetMusicDisplay";
import type { MidiConversionResult, TrackInfo } from "../midi-to-musicxml";
import type { ThemeTokens } from "../theme";
import { cornerBtnStyle, hexA, miniBtnStyle } from "../theme";
import type { useBluetooth } from "../useBluetooth";
import { BluetoothHelpBadge } from "./BluetoothHelpBadge";
import { ConnectionBadge } from "./ConnectionBadge";
import { SettingsDrawer } from "./SettingsDrawer";
import {
  ChevronLeftIcon,
  GearIcon,
  PauseIcon,
  PlayIcon,
  ResetIcon,
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
  totalMeasures: number;
  currentMeasure: number;
  bluetooth: ReturnType<typeof useBluetooth>;
  mode: "wait" | "race" | "listen";
  tracks: TrackInfo[];
  selectedTracks: number[];
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

function MeasureScrubber({
  currentMeasure,
  totalMeasures,
  totalBeats,
  timeSigNum,
  playbackBeat,
  isPlaying,
  theme,
  accent,
  onViewChange,
}: {
  currentMeasure: number;
  totalMeasures: number;
  totalBeats: number;
  timeSigNum: number;
  playbackBeat: number | undefined;
  isPlaying: boolean;
  theme: ThemeTokens;
  accent: string;
  onViewChange: (beat: number | null) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  // scrubBeat persists after drag ends so the handle stays put; cleared when
  // playback starts so the handle resumes following the cursor.
  const [scrubBeat, setScrubBeat] = useState<number | null>(null);
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;

  useEffect(() => {
    if (isPlaying) {
      setScrubBeat(null);
      onViewChangeRef.current(null);
    }
  }, [isPlaying]);

  const playbackProgress =
    totalBeats > 0 && playbackBeat != null
      ? Math.min(1, playbackBeat / totalBeats)
      : 0;

  const progress =
    scrubBeat !== null && totalBeats > 0
      ? Math.min(1, scrubBeat / totalBeats)
      : playbackProgress;

  const displayMeasure =
    scrubBeat !== null && timeSigNum > 0
      ? Math.min(totalMeasures, Math.floor(scrubBeat / timeSigNum) + 1)
      : currentMeasure;

  function beatFromPointer(e: PointerEvent): number {
    if (!trackRef.current) {
      return 0;
    }
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.max(
      0,
      Math.min(1, (e.clientX - rect.left) / rect.width),
    );
    return ratio * totalBeats;
  }

  const thumbPct = `${progress * 100}%`;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        userSelect: "none",
      }}
    >
      {/* Track + floating measure label + playhead */}
      <div
        ref={trackRef}
        onPointerDown={(e) => {
          isDragging.current = true;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          const beat = beatFromPointer(e as unknown as PointerEvent);
          setScrubBeat(beat);
          onViewChange(beat);
        }}
        onPointerMove={(e) => {
          if (isDragging.current) {
            const beat = beatFromPointer(e as unknown as PointerEvent);
            setScrubBeat(beat);
            onViewChange(beat);
          }
        }}
        onPointerUp={() => {
          isDragging.current = false;
          // scrubBeat is intentionally kept — handle stays at the browsed
          // position until playback starts (cleared in the isPlaying effect).
        }}
        style={{
          width: 130,
          height: 22,
          position: "relative",
          touchAction: "none",
        }}
      >
        {/* Track line */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "50%",
            height: 1.5,
            background: theme.border,
            borderRadius: 1,
            transform: "translateY(-50%)",
          }}
        />
        {/* Measure number floating above playhead */}
        <div
          style={{
            position: "absolute",
            left: thumbPct,
            bottom: "calc(50% + 9px)",
            transform: "translateX(-50%)",
            fontSize: 9,
            color: theme.ink,
            letterSpacing: "0.06em",
            lineHeight: 1,
            pointerEvents: "none",
          }}
        >
          {displayMeasure}
        </div>
        {/* Playhead bar */}
        <div
          style={{
            position: "absolute",
            left: thumbPct,
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: 2,
            height: 14,
            background: accent,
            borderRadius: 1,
            pointerEvents: "none",
          }}
        />
      </div>
      {/* End labels */}
      <div
        style={{
          width: 130,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontSize: 8,
            color: theme.ink,
            letterSpacing: "0.06em",
          }}
        >
          1
        </span>
        <span
          style={{
            fontSize: 8,
            color: theme.ink,
            letterSpacing: "0.06em",
          }}
        >
          {totalMeasures}
        </span>
      </div>
    </div>
  );
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
  totalMeasures,
  currentMeasure,
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
}: PracticeScreenProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
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
  const totalBeats = musicxml?.totalBeats ?? 0;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: `radial-gradient(120% 140% at 50% 0%, ${theme.bg} 0%, transparent 100%), ${theme.bgDeep}`,
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
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
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
        {totalMeasures > 0 && (
          <MeasureScrubber
            currentMeasure={currentMeasure}
            totalMeasures={totalMeasures}
            totalBeats={totalBeats}
            timeSigNum={musicxml?.timeSigNum ?? 4}
            playbackBeat={playbackBeat}
            isPlaying={isPlaying}
            theme={theme}
            accent={accent}
            onViewChange={(beat) => viewScrollRef.current?.(beat)}
          />
        )}
      </div>

      {/* BOTTOM LEFT: transport controls + mode selector */}
      <div
        style={{
          position: "absolute",
          bottom: 20,
          left: 22,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 8,
          zIndex: 2,
        }}
      >
        {/* Reset + Play/Pause row */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
                padding: "6px 8px",
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
