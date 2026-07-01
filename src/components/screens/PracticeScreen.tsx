import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import type { TrackInfo } from "@jbergknoff/midi-to-musicxml";
import type { ScoreConversion } from "../../../lib/musicxml/musicxml-playback";
import { SheetMusicDisplay } from "@jbergknoff/sheet-music-display";
import { MidiPlayer } from "../../../lib/midi/midi-player";
import type { DebugBeatEvent } from "../../debug-log";
import type { PianoController } from "../../hooks/use-piano";
import { useCustomRanges } from "../../hooks/use-custom-ranges";
import {
  type BluetoothHandle,
  type ModeControl,
  createPlayerHandle,
} from "../../modes/mode-control";
import { useListenMode } from "../../modes/use-listen-mode";
import { usePlayalongMode } from "../../modes/use-playalong-mode";
import { useWaitMode } from "../../modes/use-wait-mode";
import type { ThemeTokens } from "../../theme";
import {
  chipToggleButtonStyle,
  cornerButtonStyle,
  dimBackdrop,
  FONT_SANS,
  glassPanel,
  hexA,
  miniButtonStyle,
  serifTitle,
} from "../../theme";
import { BpmInputModal } from "../BpmInputModal";
import { ConnectionBadge } from "../ConnectionBadge";
import { HelpBadge } from "../HelpBadge";
import { MeasureJumpModal } from "../MeasureJumpModal";
import { RangeNameModal } from "../RangeNameModal";
import { SelectionRangesDrawer } from "../SelectionRangesDrawer";
import { SettingsDrawer } from "../SettingsDrawer";
import {
  GearIcon,
  OpenFileIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  ResetIcon,
  SectionsIcon,
  StopIcon,
} from "../icons";

interface PracticeScreenProps {
  theme: ThemeTokens;
  accent: string;
  fileName: string;
  pieceTitle: string;
  musicxml: ScoreConversion | null;
  fileHash: string | null;
  bpm: number;
  baseBpm: number;
  measureRange: { from: number; to: number } | null;
  piano: PianoController;
  /**
   * App-owned ref that the active input transport dispatches MIDI note events
   * through. PracticeScreen writes the active mode's onNoteEvent into this ref.
   */
  noteEventDispatchRef: {
    current: ((noteNumber: number, kind: "on" | "off") => void) | null;
  };
  mode: "wait" | "playalong" | "listen";
  tracks: TrackInfo[];
  selectedTracks: number[];
  /** Beat to seek to once the player is created (used for history restore). */
  initialBeat: number;
  /** Fires whenever the live cursor beat changes — App persists it. */
  onCurrentBeatChange: (beat: number) => void;
  onBpmChange: (bpm: number) => void;
  onMeasureRangeChange: (r: { from: number; to: number } | null) => void;
  onModeChange: (mode: "wait" | "playalong" | "listen") => void;
  onTrackToggle: (idx: number) => void;
  onOpenFile: () => void;
  playalongPlayMusic: boolean;
  onPlayalongPlayMusicChange: (enabled: boolean) => void;
  playalongMetronome: boolean;
  onPlayalongMetronomeChange: (enabled: boolean) => void;
  playalongCountIn: boolean;
  onPlayalongCountInChange: (enabled: boolean) => void;
  appendToDebugLog: (event: DebugBeatEvent) => void;
  getDebugLog: () => DebugBeatEvent[];
  clearDebugLog: () => void;
}

export function PracticeScreen({
  theme,
  accent,
  fileName,
  pieceTitle,
  musicxml,
  fileHash,
  bpm,
  baseBpm,
  measureRange,
  piano,
  noteEventDispatchRef,
  mode,
  tracks,
  selectedTracks,
  initialBeat,
  onCurrentBeatChange,
  onBpmChange,
  onMeasureRangeChange,
  onModeChange,
  onTrackToggle,
  onOpenFile,
  playalongPlayMusic,
  onPlayalongPlayMusicChange,
  playalongMetronome,
  onPlayalongMetronomeChange,
  playalongCountIn,
  onPlayalongCountInChange,
  appendToDebugLog,
  getDebugLog,
  clearDebugLog,
}: PracticeScreenProps) {
  // Live cursor state owned here so mode hooks (and the player) can drive it.
  const [currentBeat, setCurrentBeat] = useState(initialBeat);
  const currentBeatRef = useRef(currentBeat);
  currentBeatRef.current = currentBeat;
  const [isPlaying, setIsPlaying] = useState(false);

  // Scroll-snap signalling: snapBeatRef captures the target beat; bumping
  // snapGeneration forces SheetMusicDisplay to re-snap even if the beat is
  // the same as the previous snap.
  const snapBeatRef = useRef<number | null>(null);
  const [snapGeneration, setSnapGeneration] = useState(0);

  const setCursor = useCallback((beat: number, behavior: "jump" | "smooth") => {
    setCurrentBeat(beat);
    if (behavior === "jump") {
      snapBeatRef.current = beat;
      setSnapGeneration((g) => g + 1);
    }
  }, []);

  // Notify App so it can persist currentBeat to file-history.
  useEffect(() => {
    onCurrentBeatChange(currentBeat);
  }, [currentBeat, onCurrentBeatChange]);

  // Player + control-surface plumbing -----------------------------------------

  // Player effect — keyed on musicxml. Declared first so mode-activation
  // effect (declared below) cleans up before this one disposes the player.
  const playerRef = useRef<MidiPlayer | null>(null);
  const initialBeatRef = useRef(initialBeat);
  initialBeatRef.current = initialBeat;
  const measureRangeRef = useRef(measureRange);
  measureRangeRef.current = measureRange;
  const bpmRef = useRef(bpm);
  bpmRef.current = bpm;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // biome-ignore lint/correctness/useExhaustiveDependencies: bpm/measureRange flow through the player methods + refs
  useEffect(() => {
    playerRef.current?.dispose();
    playerRef.current = null;
    setIsPlaying(false);
    setCurrentBeat(0);

    if (musicxml && musicxml.totalBeats > 0) {
      const player = new MidiPlayer(
        musicxml.notes,
        musicxml.totalBeats,
        bpmRef.current,
      );
      const range = measureRangeRef.current;
      if (range) {
        const measureStartBeats = musicxml.measureStartBeats;
        player.focusRange = {
          startBeat: measureStartBeats[range.from - 1] ?? 0,
          endBeat: measureStartBeats[range.to] ?? musicxml.totalBeats,
        };
      }
      // Apply initialBeat BEFORE assigning onPositionUpdate so the seek
      // doesn't trip the cursor handler.
      const seekBeat = initialBeatRef.current;
      initialBeatRef.current = 0;
      if (seekBeat > 0) {
        player.seek(seekBeat);
      }
      player.onPositionUpdate = (beat) => setCursor(beat, "smooth");
      player.onEnd = (beat) => {
        setIsPlaying(false);
        setCursor(beat, "jump");
      };
      playerRef.current = player;
      // Jump so the cursor is placed and the sheet scrolls to the start (or the
      // restored position) as soon as the piece loads.
      setCursor(seekBeat, "jump");
    }

    return () => {
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, [musicxml]);

  // BPM changes flow through the live player.
  useEffect(() => {
    playerRef.current?.setBpm(bpm);
  }, [bpm]);

  // Measure-range changes: update focusRange + seek + snap (unless wait mode
  // owns the cursor, in which case let the wait hook handle range changes).
  useEffect(() => {
    const player = playerRef.current;
    if (!musicxml) {
      return;
    }
    if (measureRange) {
      const measureStartBeats = musicxml.measureStartBeats;
      const startBeat = measureStartBeats[measureRange.from - 1] ?? 0;
      const endBeat = measureStartBeats[measureRange.to] ?? musicxml.totalBeats;
      if (player) {
        player.focusRange = { startBeat, endBeat };
        player.seek(startBeat);
      }
      if (modeRef.current !== "wait") {
        setCursor(startBeat, "jump");
      }
    } else if (player) {
      player.focusRange = null;
    }
  }, [measureRange, musicxml, setCursor]);

  // Stable PlayerHandle that delegates to the current playerRef value.
  const playerHandle = useMemo(
    () => createPlayerHandle(() => playerRef.current),
    [],
  );

  // Drives the cursor. Returns the current beat (so the cursor is visible at the
  // start position even when stopped); null only when there is no player. The
  // play/pause lifecycle of the rAF loop is driven by the `playing` prop below.
  const getLiveBeat = useCallback(() => {
    const p = playerRef.current;
    return p ? p.currentBeat : null;
  }, []);

  // Stable BluetoothHandle that reads from a ref so identity stays constant.
  const pianoRef = useRef(piano);
  pianoRef.current = piano;
  const bluetoothHandle = useMemo<BluetoothHandle>(
    () => ({
      get status() {
        return pianoRef.current.status;
      },
      sendNote: (note, velocity, durationMs, channel) =>
        pianoRef.current.sendNote(note, velocity, durationMs, channel),
      sendNotesBatch: (notes, channel) =>
        pianoRef.current.sendNotesBatch(notes, channel),
    }),
    [],
  );

  const control: ModeControl = {
    player: playerHandle,
    bluetooth: bluetoothHandle,
    setCursor,
    setIsPlaying,
    currentBeat,
    currentBeatRef,
    musicxml,
    measureRange,
    measureStartBeats: musicxml?.measureStartBeats ?? [],
    fileHash,
    appendToDebugLog,
  };

  // These values are intentionally not user-facing; adjust here to tune behaviour.
  const noteSensitivityMilliseconds = 150;
  const playalongTimingBeats = 0.4;

  const wait = useWaitMode(control, {
    noteSensitivityMilliseconds,
    bpm,
    accent,
    theme,
  });
  const playalong = usePlayalongMode(control, {
    timingBeats: playalongTimingBeats,
    playMusic: playalongPlayMusic,
    metronome: playalongMetronome,
    countIn: playalongCountIn,
    bpm,
    accent,
    theme,
  });
  const listen = useListenMode(control, { accent });

  const active =
    mode === "wait" ? wait : mode === "playalong" ? playalong : listen;

  // Route bluetooth note events into the active mode.
  useEffect(() => {
    noteEventDispatchRef.current = active.onNoteEvent;
    return () => {
      if (noteEventDispatchRef.current === active.onNoteEvent) {
        noteEventDispatchRef.current = null;
      }
    };
  }, [active.onNoteEvent, noteEventDispatchRef]);

  // Mode-activation effect — keyed on [mode, musicxml]. Cleanup deactivates
  // the previous mode (handle captured in `m`) before setup activates the
  // new one. Effect is declared AFTER the player effect so cleanup runs
  // before the player is disposed on piece changes.
  const modesRef = useRef({ wait, playalong, listen });
  modesRef.current = { wait, playalong, listen };
  useEffect(() => {
    if (!musicxml) {
      return;
    }
    const m = modesRef.current[mode];
    m.activate();
    return () => {
      m.deactivate();
    };
  }, [musicxml, mode]);

  // Transport delegation -------------------------------------------------------

  const handlePlayPause = useCallback(() => {
    void active.handlePlayPause();
  }, [active]);

  const handleReset = useCallback(() => {
    clearDebugLog();
    active.handleReset();
  }, [active, clearDebugLog]);

  const handleSeek = useCallback(
    (beat: number) => {
      active.handleSeek(beat);
    },
    [active],
  );

  // UI state -------------------------------------------------------------------

  const playalongActive =
    mode === "playalong" &&
    (playalong.phase === "counting-in" ||
      playalong.phase === "waiting-for-note" ||
      playalong.phase === "playing");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [rangesDrawerOpen, setRangesDrawerOpen] = useState(false);
  const [pieceInfoOpen, setPieceInfoOpen] = useState(false);
  const [bpmInputModalOpen, setBpmInputModalOpen] = useState(false);
  // Holds the default measure for the jump modal; null when the modal is closed.
  const [measureJumpDefault, setMeasureJumpDefault] = useState<number | null>(
    null,
  );

  const [contextMenu, setContextMenu] = useState<{
    clientX: number;
    clientY: number;
    measureNumber: number;
    beat: number;
  } | null>(null);

  const customRanges = useCustomRanges(fileHash);

  const handleModeChange = (newMode: "wait" | "playalong" | "listen") => {
    if (newMode === mode) {
      return;
    }
    // Snap to range start before switching modes so the new mode activates
    // at a predictable position. Each mode's own activate() handles any
    // additional setup (e.g. wait mode picking its first wait point).
    const startBeat =
      measureRange && musicxml
        ? (musicxml.measureStartBeats[measureRange.from - 1] ?? 0)
        : 0;
    clearDebugLog();
    playerRef.current?.pause();
    setIsPlaying(false);
    playerRef.current?.seek(startBeat);
    setCursor(startBeat, "jump");
    onModeChange(newMode);
  };

  // The custom range, if any, that exactly matches the current selection.
  const namedRange = measureRange
    ? (customRanges.ranges.find(
        (r) => r.from === measureRange.from && r.to === measureRange.to,
      ) ?? null)
    : null;

  const handleContextMenuAction = (
    action:
      | "focus"
      | "seek"
      | "jump"
      | "clearFocus"
      | "saveCustom"
      | "editCustom",
    measureNumber: number,
    beat: number,
  ) => {
    if (action === "focus") {
      onMeasureRangeChange({ from: measureNumber, to: measureNumber });
    } else if (action === "jump") {
      setMeasureJumpDefault(measureNumber);
    } else if (action === "clearFocus") {
      onMeasureRangeChange(null);
    } else if (action === "saveCustom") {
      if (measureRange) {
        customRanges.openCreate(measureRange);
      }
    } else if (action === "editCustom") {
      if (namedRange) {
        customRanges.openEdit(namedRange);
      }
    } else {
      handleSeek(beat);
    }
  };

  const showStopIcon =
    mode === "playalong" &&
    (isPlaying ||
      playalong.phase === "counting-in" ||
      playalong.phase === "waiting-for-note");

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: theme.bg,
        color: theme.ink,
        fontFamily: FONT_SANS,
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
          noteHighlights={active.noteHighlights}
          accentColor={accent}
          textFontFamily={FONT_SANS}
          inkColor={theme.ink}
          focusRange={measureRange}
          focusColor={hexA(accent, 0.09)}
          onFocusRangeChange={onMeasureRangeChange}
          snapBeatRef={snapBeatRef}
          snapGeneration={snapGeneration}
          scrollLocked={isPlaying}
          getLiveBeat={getLiveBeat}
          isPlaying={isPlaying}
          onSheetContextMenu={(info) => {
            setContextMenu(info);
          }}
          stickySignatureBackground={theme.bg}
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
      {!playalongActive && (
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
            onClick={onOpenFile}
            style={cornerButtonStyle(theme)}
            title="Open file"
          >
            <OpenFileIcon />
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
                ...serifTitle(theme, 28),
                lineHeight: 1,
                letterSpacing: "-0.01em",
              }}
            >
              {pieceTitle}
            </div>
          </button>
        </div>
      )}

      {/* BOTTOM LEFT: transport controls + mode selector */}
      <div
        style={{ position: "absolute", bottom: 20, left: 22, zIndex: 2 }}
        class="bl-controls"
      >
        {/* Reset + Play/Pause + BPM row */}
        <div class="bl-transport">
          {!playalongActive && (
            <button
              type="button"
              onClick={() => setRangesDrawerOpen(true)}
              style={cornerButtonStyle(theme)}
              title="Select range"
            >
              <SectionsIcon />
            </button>
          )}
          {mode !== "playalong" && (
            <button
              type="button"
              onClick={handleReset}
              style={cornerButtonStyle(theme)}
              title={
                measureRange
                  ? "Return to start of selection. Click to reset."
                  : "Return to beginning. Click to reset."
              }
            >
              <ResetIcon />
            </button>
          )}
          {mode !== "wait" && (
            <button
              type="button"
              onClick={handlePlayPause}
              style={cornerButtonStyle(theme)}
              title={showStopIcon ? "Stop" : isPlaying ? "Pause" : "Play"}
            >
              {showStopIcon ? (
                <StopIcon size={18} />
              ) : isPlaying ? (
                <PauseIcon size={22} />
              ) : (
                <PlayIcon size={22} />
              )}
            </button>
          )}
          {mode !== "wait" &&
            !playalongActive &&
            (() => {
              const presetPercentages = [50, 75, 100] as const;
              const presetBpms = presetPercentages.map((pct) =>
                Math.round((baseBpm * pct) / 100),
              );
              const isCustomBpm = !presetBpms.includes(bpm);
              return (
                <div
                  style={{
                    height: 38,
                    padding: "0 8px",
                    ...glassPanel(theme),
                    borderRadius: 12,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    boxShadow: "0 4px 14px rgba(0,0,0,0.06)",
                    boxSizing: "border-box",
                  }}
                >
                  {/* BPM label — shows the custom value alongside the unit
                    label when no preset is active. */}
                  <span
                    style={{
                      fontSize: 10,
                      color: theme.inkSoft,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      padding: "0 0 0 2px",
                      userSelect: "none",
                      display: "flex",
                      alignItems: "center",
                      gap: 3,
                    }}
                  >
                    BPM
                    {isCustomBpm && (
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: 13,
                          color: theme.ink,
                        }}
                      >
                        {bpm}
                      </span>
                    )}
                  </span>
                  {/* Pencil — always visible; opens the free-input modal */}
                  <button
                    type="button"
                    onClick={() => setBpmInputModalOpen(true)}
                    title="Set a custom tempo"
                    style={{
                      ...miniButtonStyle(theme),
                      flexShrink: 0,
                      marginRight: 2,
                    }}
                  >
                    <PencilIcon size={11} />
                  </button>
                  {/* Reset — only when a custom (non-preset) tempo is active */}
                  {isCustomBpm && (
                    <button
                      type="button"
                      onClick={() => onBpmChange(baseBpm)}
                      title="Reset to default tempo"
                      style={{
                        ...miniButtonStyle(theme),
                        flexShrink: 0,
                        marginRight: 2,
                      }}
                    >
                      <ResetIcon size={11} />
                    </button>
                  )}
                  {/* Preset percentage buttons — hidden when a custom tempo is active */}
                  {!isCustomBpm &&
                    presetBpms.map((targetBpm, index) => {
                      const isActive = bpm === targetBpm;
                      return (
                        <button
                          key={presetPercentages[index]}
                          type="button"
                          onClick={() => onBpmChange(targetBpm)}
                          style={chipToggleButtonStyle(theme, accent, isActive)}
                          aria-pressed={isActive}
                        >
                          {targetBpm}
                        </button>
                      );
                    })}
                </div>
              );
            })()}
        </div>

        {/* Mode selector group */}
        {!playalongActive && (
          <div
            class="bl-modes"
            style={{
              padding: "4px 6px",
              ...glassPanel(theme),
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              gap: 2,
              boxShadow: "0 4px 14px rgba(0,0,0,0.06)",
            }}
          >
            {(["listen", "wait", "playalong"] as const).map((m) => {
              const isActive = mode === m;
              const requiresPiano = m === "wait" || m === "playalong";
              const disabled = requiresPiano && piano.status !== "connected";
              const labels: Record<string, string> = {
                listen: "Listen",
                wait: "Wait",
                playalong: "Playalong",
              };
              return (
                <button
                  key={m}
                  type="button"
                  disabled={disabled}
                  onClick={() => handleModeChange(m)}
                  style={{
                    ...miniButtonStyle(theme),
                    padding: "0 14px",
                    minWidth: 60,
                    height: 30,
                    background: isActive ? accent : "transparent",
                    color: isActive ? "#FFF7E5" : theme.ink,
                    fontWeight: isActive ? 600 : 400,
                    fontSize: 12,
                    boxShadow: isActive
                      ? `0 2px 8px ${hexA(accent, 0.35)}`
                      : undefined,
                    cursor: disabled ? "not-allowed" : "pointer",
                    opacity: disabled ? 0.35 : 1,
                    justifyContent: "center",
                  }}
                  aria-pressed={isActive}
                  title={
                    disabled ? "Connect a piano to use this mode" : undefined
                  }
                >
                  {labels[m]}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Mode-owned overlay (e.g. playalong count-in) */}
      {active.overlay}

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
        <HelpBadge
          theme={theme}
          accent={accent}
          getDebugLog={getDebugLog}
          clearDebugLog={clearDebugLog}
        />
        <ConnectionBadge
          theme={theme}
          accent={accent}
          piano={piano}
          compact={true}
        />
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          style={cornerButtonStyle(theme)}
          title="Settings"
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
              ...glassPanel(theme),
              borderRadius: 12,
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
                {
                  label: "Jump to measure…",
                  action: "jump" as const,
                },
                ...(measureRange
                  ? [
                      namedRange
                        ? {
                            label: `Rename “${namedRange.name}”`,
                            action: "editCustom" as const,
                          }
                        : {
                            label: "Name this range",
                            action: "saveCustom" as const,
                          },
                      { label: "Clear focus", action: "clearFocus" as const },
                    ]
                  : []),
              ] as {
                label: string;
                action:
                  | "focus"
                  | "seek"
                  | "jump"
                  | "clearFocus"
                  | "saveCustom"
                  | "editCustom";
              }[]
            ).map(({ label, action }) => (
              <button
                key={action}
                type="button"
                onClick={() => {
                  handleContextMenuAction(
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
                  fontFamily: FONT_SANS,
                  width: "100%",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Range-naming modal */}
      {customRanges.editor && (
        <RangeNameModal
          editor={customRanges.editor}
          nameDraft={customRanges.nameDraft}
          onNameDraftChange={customRanges.setNameDraft}
          onSave={customRanges.saveEditor}
          onCancel={customRanges.closeEditor}
          onDelete={customRanges.deleteEditing}
          theme={theme}
          accent={accent}
        />
      )}

      {/* Piece info modal */}
      {pieceInfoOpen && (
        <>
          <div
            role="presentation"
            style={{ ...dimBackdrop(), zIndex: 199 }}
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
              ...glassPanel(theme, 24, 160),
              borderRadius: 16,
              padding: "24px 28px",
              boxShadow: "0 16px 48px rgba(0,0,0,0.18)",
              minWidth: 280,
            }}
          >
            <div style={{ ...serifTitle(theme, 24), marginBottom: 20 }}>
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
                ...(tracks.length > 0
                  ? ([["Tracks", String(tracks.length)]] as [string, string][])
                  : []),
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
        markedBpm={baseBpm}
        customRanges={customRanges.ranges}
        onEditCustomRange={(range) => {
          setRangesDrawerOpen(false);
          customRanges.openEdit(range);
        }}
        repeatSections={musicxml?.repeatSections ?? []}
      />
      <SettingsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        theme={theme}
        accent={accent}
        tracks={tracks}
        selectedTracks={selectedTracks}
        onTrackToggle={onTrackToggle}
        playalongPlayMusic={playalongPlayMusic}
        onPlayalongPlayMusicChange={onPlayalongPlayMusicChange}
        playalongMetronome={playalongMetronome}
        onPlayalongMetronomeChange={onPlayalongMetronomeChange}
        playalongCountIn={playalongCountIn}
        onPlayalongCountInChange={onPlayalongCountInChange}
      />

      {/* BPM free-input modal */}
      {bpmInputModalOpen && (
        <BpmInputModal
          currentBpm={bpm}
          baseBpm={baseBpm}
          onConfirm={(newBpm) => {
            onBpmChange(newBpm);
            setBpmInputModalOpen(false);
          }}
          onCancel={() => setBpmInputModalOpen(false)}
          theme={theme}
          accent={accent}
        />
      )}

      {/* Jump-to-measure modal — focuses the chosen measure (cursor snaps there) */}
      {measureJumpDefault !== null && musicxml && (
        <MeasureJumpModal
          currentMeasure={measureJumpDefault}
          totalMeasures={musicxml.measureStartBeats.length}
          onConfirm={(measureNumber) => {
            onMeasureRangeChange({ from: measureNumber, to: measureNumber });
            setMeasureJumpDefault(null);
          }}
          onCancel={() => setMeasureJumpDefault(null)}
          theme={theme}
          accent={accent}
        />
      )}

      {/* Mode-owned result modal */}
      {active.modal}
    </div>
  );
}
