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
  GearIcon,
  LoopIcon,
  MicIcon,
  PauseIcon,
  PlayIcon,
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
  baseBpm: number;
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
  onContextMenuAction: (
    action: "loop" | "seek",
    measureNumber: number,
    beat: number,
  ) => void;
  onGoToLanding: () => void;
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
            color: theme.inkFaint,
            letterSpacing: "0.06em",
          }}
        >
          1
        </span>
        <span
          style={{
            fontSize: 8,
            color: theme.inkFaint,
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
  pieceTitle,
  musicxml,
  noteColors,
  playbackBeat,
  cursorColor,
  isPlaying,
  bpm,
  baseBpm,
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
  onContextMenuAction,
  onToggleWaitMode,
  onTrackToggle,
  onGoToLanding,
}: PracticeScreenProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Imperative handle into SheetMusicDisplay's scroll logic — calling this
  // bypasses Preact state entirely, so the view responds in the same frame as
  // the pointer event with no render-cycle lag.
  const viewScrollRef = useRef<((beat: number | null) => void) | null>(null);
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
          onLoopRangeChange={showLoop ? onMeasureRangeChange : undefined}
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

        {/* Tempo panel */}
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
          {([25, 50, 75, 100] as const).map((pct) => {
            const targetBpm = Math.round((baseBpm * pct) / 100);
            const active = bpm === targetBpm;
            return (
              <button
                key={pct}
                type="button"
                onClick={() => onBpmChange(targetBpm)}
                style={{
                  ...(miniBtnStyle(theme) as Record<string, string | number>),
                  padding: "0 10px",
                  minWidth: 44,
                  background: active ? hexA(accent, 0.15) : undefined,
                  border: active
                    ? `0.5px solid ${hexA(accent, 0.5)}`
                    : undefined,
                  color: active ? accent : theme.ink,
                  fontWeight: active ? 600 : 400,
                  fontSize: 13,
                }}
                aria-pressed={active}
              >
                {pct}%
              </button>
            );
          })}
        </div>
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
                  label: `Loop measure ${contextMenu.measureNumber}`,
                  action: "loop" as const,
                },
                { label: "Jump here", action: "seek" as const },
              ] as { label: string; action: "loop" | "seek" }[]
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
