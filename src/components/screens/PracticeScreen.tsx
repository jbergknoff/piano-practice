import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { MidiPlayer } from "../../../lib/midi/midi-player";
import type {
  MidiConversionResult,
  TrackInfo,
} from "../../../lib/midi/midi-to-musicxml";
import type { DebugBeatEvent } from "../../debug-log";
import type { useBluetooth } from "../../hooks/use-bluetooth";
import {
  type CustomRange,
  loadCustomRanges,
  saveCustomRanges,
} from "../../hooks/use-file-history";
import {
  type BluetoothHandle,
  type ModeControl,
  createPlayerHandle,
} from "../../modes/mode-control";
import { useListenMode } from "../../modes/use-listen-mode";
import { usePlayalongMode } from "../../modes/use-playalong-mode";
import { useWaitMode } from "../../modes/use-wait-mode";
import type { ThemeTokens } from "../../theme";
import { cornerBtnStyle, hexA, miniBtnStyle } from "../../theme";
import { ConnectionBadge } from "../ConnectionBadge";
import { HelpBadge } from "../HelpBadge";
import { SelectionRangesDrawer } from "../SelectionRangesDrawer";
import { SettingsDrawer } from "../SettingsDrawer";
import { SheetMusicDisplay } from "../SheetMusicDisplay";
import {
  ChevronLeftIcon,
  GearIcon,
  PauseIcon,
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
  musicxml: MidiConversionResult | null;
  fileHash: string | null;
  bpm: number;
  baseBpm: number;
  measureRange: { from: number; to: number } | null;
  bluetooth: ReturnType<typeof useBluetooth>;
  /**
   * App-owned ref that useBluetooth dispatches MIDI note events through.
   * PracticeScreen writes the active mode's onNoteEvent into this ref.
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
  onGoToLanding: () => void;
  noteSensitivityMilliseconds: number;
  onSensitivityChange: (ms: number) => void;
  playalongTimingBeats: number;
  onPlayalongTimingChange: (beats: number) => void;
  playalongPlayMusic: boolean;
  onPlayalongPlayMusicChange: (enabled: boolean) => void;
  playalongMetronome: boolean;
  onPlayalongMetronomeChange: (enabled: boolean) => void;
  playalongCountIn: boolean;
  onPlayalongCountInChange: (enabled: boolean) => void;
  appendToDebugLog: (event: DebugBeatEvent) => void;
  getDebugLog: () => DebugBeatEvent[];
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
  bluetooth,
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
  onGoToLanding,
  noteSensitivityMilliseconds,
  onSensitivityChange,
  playalongTimingBeats,
  onPlayalongTimingChange,
  playalongPlayMusic,
  onPlayalongPlayMusicChange,
  playalongMetronome,
  onPlayalongMetronomeChange,
  playalongCountIn,
  onPlayalongCountInChange,
  appendToDebugLog,
  getDebugLog,
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
        player.focusRange = {
          startBeat: (range.from - 1) * musicxml.timeSigNum,
          endBeat: range.to * musicxml.timeSigNum,
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
      const startBeat = (measureRange.from - 1) * musicxml.timeSigNum;
      const endBeat = measureRange.to * musicxml.timeSigNum;
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
  const bluetoothRef = useRef(bluetooth);
  bluetoothRef.current = bluetooth;
  const bluetoothHandle = useMemo<BluetoothHandle>(
    () => ({
      get status() {
        return bluetoothRef.current.status;
      },
      sendNote: (note, velocity, durationMs, channel) =>
        bluetoothRef.current.sendNote(note, velocity, durationMs, channel),
      sendNotesBatch: (notes, channel) =>
        bluetoothRef.current.sendNotesBatch(notes, channel),
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
    fileHash,
    appendToDebugLog,
  };

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
    active.handleReset();
  }, [active]);

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

  const [contextMenu, setContextMenu] = useState<{
    clientX: number;
    clientY: number;
    measureNumber: number;
    beat: number;
  } | null>(null);

  // Custom named ranges, persisted per file in local storage.
  const [customRanges, setCustomRanges] = useState<CustomRange[]>([]);
  useEffect(() => {
    setCustomRanges(fileHash ? loadCustomRanges(fileHash) : []);
  }, [fileHash]);

  const persistCustomRanges = useCallback(
    (next: CustomRange[]) => {
      setCustomRanges(next);
      if (fileHash) {
        saveCustomRanges(fileHash, next);
      }
    },
    [fileHash],
  );

  // Range-naming modal: "create" saves the current selection, "edit" renames
  // (or deletes) an existing custom range.
  const [rangeEditor, setRangeEditor] = useState<
    | { kind: "create"; from: number; to: number }
    | { kind: "edit"; range: CustomRange }
    | null
  >(null);
  const [nameDraft, setNameDraft] = useState("");
  const rangeNameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (rangeEditor) {
      rangeNameInputRef.current?.focus();
      rangeNameInputRef.current?.select();
    }
  }, [rangeEditor]);

  const defaultRangeName = (range: { from: number; to: number }) =>
    range.from === range.to
      ? `Measure ${range.from}`
      : `Measures ${range.from}–${range.to}`;

  const openCreateRangeEditor = (range: { from: number; to: number }) => {
    setRangeEditor({ kind: "create", from: range.from, to: range.to });
    setNameDraft(defaultRangeName(range));
  };

  const openEditRangeEditor = (range: CustomRange) => {
    setRangeEditor({ kind: "edit", range });
    setNameDraft(range.name);
  };

  const handleSaveRangeName = () => {
    if (!rangeEditor) {
      return;
    }
    const name = nameDraft.trim();
    if (!name) {
      return;
    }
    if (rangeEditor.kind === "create") {
      const newRange: CustomRange = {
        id: crypto.randomUUID(),
        name,
        from: rangeEditor.from,
        to: rangeEditor.to,
      };
      persistCustomRanges([...customRanges, newRange]);
    } else {
      persistCustomRanges(
        customRanges.map((r) =>
          r.id === rangeEditor.range.id ? { ...r, name } : r,
        ),
      );
    }
    setRangeEditor(null);
  };

  const handleDeleteRange = () => {
    if (rangeEditor?.kind !== "edit") {
      return;
    }
    persistCustomRanges(
      customRanges.filter((r) => r.id !== rangeEditor.range.id),
    );
    setRangeEditor(null);
  };

  const handleModeChange = (newMode: "wait" | "playalong" | "listen") => {
    if (newMode === mode) {
      return;
    }
    // Snap to range start before switching modes so the new mode activates
    // at a predictable position. Each mode's own activate() handles any
    // additional setup (e.g. wait mode picking its first wait point).
    const startBeat = measureRange
      ? (measureRange.from - 1) * (musicxml?.timeSigNum ?? 4)
      : 0;
    playerRef.current?.pause();
    setIsPlaying(false);
    playerRef.current?.seek(startBeat);
    setCursor(startBeat, "jump");
    onModeChange(newMode);
  };

  const handleContextMenuAction = (
    action: "focus" | "seek" | "clearFocus" | "saveCustom",
    measureNumber: number,
    beat: number,
  ) => {
    if (action === "focus") {
      onMeasureRangeChange({ from: measureNumber, to: measureNumber });
    } else if (action === "clearFocus") {
      onMeasureRangeChange(null);
    } else if (action === "saveCustom") {
      if (measureRange) {
        openCreateRangeEditor(measureRange);
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
          noteColors={active.noteColors}
          accentColor={accent}
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
              style={cornerBtnStyle(theme) as Record<string, string | number>}
              title="Select section"
            >
              <SectionsIcon />
            </button>
          )}
          {mode !== "playalong" && (
            <button
              type="button"
              onClick={handleReset}
              style={cornerBtnStyle(theme) as Record<string, string | number>}
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
              style={cornerBtnStyle(theme) as Record<string, string | number>}
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
          {mode !== "wait" && !playalongActive && (
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
                const isActive = bpm === targetBpm;
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
                      background: isActive ? accent : undefined,
                      border: isActive ? "none" : undefined,
                      color: isActive ? "#FFF7E5" : theme.ink,
                      fontWeight: isActive ? 600 : 400,
                      fontSize: 13,
                      boxShadow: isActive
                        ? `0 2px 8px ${hexA(accent, 0.35)}`
                        : undefined,
                    }}
                    aria-pressed={isActive}
                  >
                    {targetBpm}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Mode selector group */}
        {!playalongActive && (
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
            {(["listen", "wait", "playalong"] as const).map((m) => {
              const isActive = mode === m;
              const requiresPiano = m === "wait" || m === "playalong";
              const disabled =
                requiresPiano && bluetooth.status !== "connected";
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
                    ...(miniBtnStyle(theme) as Record<string, string | number>),
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
        <HelpBadge theme={theme} accent={accent} getDebugLog={getDebugLog} />
        <ConnectionBadge
          theme={theme}
          accent={accent}
          bluetooth={bluetooth}
          compact={true}
        />
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
                  ? [
                      {
                        label: "Name this range",
                        action: "saveCustom" as const,
                      },
                      { label: "Clear focus", action: "clearFocus" as const },
                    ]
                  : []),
              ] as {
                label: string;
                action: "focus" | "seek" | "clearFocus" | "saveCustom";
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

      {/* Range-naming modal */}
      {rangeEditor && (
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
            onClick={() => setRangeEditor(null)}
            onKeyDown={(e) => {
              if ((e as unknown as KeyboardEvent).key === "Escape") {
                setRangeEditor(null);
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
              width: 300,
              maxWidth: "calc(100vw - 48px)",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                fontFamily: "'Instrument Serif', serif",
                fontStyle: "italic",
                fontSize: 24,
                color: theme.ink,
                marginBottom: 4,
              }}
            >
              {rangeEditor.kind === "create" ? "Name this range" : "Edit name"}
            </div>
            <div
              style={{ fontSize: 11, color: theme.inkSoft, marginBottom: 16 }}
            >
              {(() => {
                const r =
                  rangeEditor.kind === "create"
                    ? rangeEditor
                    : rangeEditor.range;
                return r.from === r.to
                  ? `Measure ${r.from}`
                  : `Measures ${r.from}–${r.to}`;
              })()}
            </div>
            <input
              ref={rangeNameInputRef}
              type="text"
              value={nameDraft}
              placeholder="e.g. Tricky run"
              onInput={(e) =>
                setNameDraft((e.target as HTMLInputElement).value)
              }
              onKeyDown={(e) => {
                if ((e as unknown as KeyboardEvent).key === "Enter") {
                  handleSaveRangeName();
                }
              }}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "10px 12px",
                fontSize: 14,
                color: theme.ink,
                background: theme.panelSolid,
                border: `0.5px solid ${theme.border}`,
                borderRadius: 10,
                outline: "none",
                fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
                marginBottom: 18,
              }}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div>
                {rangeEditor.kind === "edit" && (
                  <button
                    type="button"
                    onClick={handleDeleteRange}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#c62828",
                      cursor: "pointer",
                      fontSize: 13,
                      padding: "8px 4px",
                      outline: "none",
                      fontFamily:
                        "'Geist', ui-sans-serif, system-ui, sans-serif",
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setRangeEditor(null)}
                  style={{
                    background: "transparent",
                    border: `0.5px solid ${theme.border}`,
                    color: theme.ink,
                    cursor: "pointer",
                    fontSize: 13,
                    padding: "8px 16px",
                    borderRadius: 10,
                    outline: "none",
                    fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveRangeName}
                  disabled={nameDraft.trim().length === 0}
                  style={{
                    background: accent,
                    border: "none",
                    color: "#FFF7E5",
                    cursor:
                      nameDraft.trim().length === 0 ? "not-allowed" : "pointer",
                    opacity: nameDraft.trim().length === 0 ? 0.4 : 1,
                    fontSize: 13,
                    fontWeight: 600,
                    padding: "8px 16px",
                    borderRadius: 10,
                    outline: "none",
                    fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
                  }}
                >
                  Save
                </button>
              </div>
            </div>
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
        markedBpm={baseBpm}
        customRanges={customRanges}
        onEditCustomRange={(range) => {
          setRangesDrawerOpen(false);
          openEditRangeEditor(range);
        }}
      />
      <SettingsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        theme={theme}
        accent={accent}
        tracks={tracks}
        selectedTracks={selectedTracks}
        onTrackToggle={onTrackToggle}
        noteSensitivityMilliseconds={noteSensitivityMilliseconds}
        onSensitivityChange={onSensitivityChange}
        playalongTimingBeats={playalongTimingBeats}
        onPlayalongTimingChange={onPlayalongTimingChange}
        playalongPlayMusic={playalongPlayMusic}
        onPlayalongPlayMusicChange={onPlayalongPlayMusicChange}
        playalongMetronome={playalongMetronome}
        onPlayalongMetronomeChange={onPlayalongMetronomeChange}
        playalongCountIn={playalongCountIn}
        onPlayalongCountInChange={onPlayalongCountInChange}
      />

      {/* Mode-owned result modal */}
      {active.modal}
    </div>
  );
}
