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
import { BeatScheduler } from "../../../lib/midi/beat-scheduler";
import { NoteTrack } from "../../../lib/midi/note-track";
import type { DebugBeatEvent } from "../../debug-log";
import type { PianoController } from "../../hooks/use-piano";
import { useBookmarks } from "../../hooks/use-bookmarks";
import {
  type ModeControl,
  type PianoOutput,
  type PiecePlayback,
  type PracticeMode,
  type RangeNavigation,
  createPlayerHandle,
} from "../../modes/mode-control";
import { useListenMode } from "../../modes/use-listen-mode";
import { usePlayalongMode } from "../../modes/use-playalong-mode";
import { useWaitMode } from "../../modes/use-wait-mode";
import {
  adjacentRange,
  type MeasureRange,
  selectionEndBeat,
  selectionStartBeat,
} from "../../selection";
import {
  color,
  withAlpha,
  FONT_SANS,
  glassPanel,
  serifTitle,
  colorValue,
  focusRangeTint,
} from "../../theme";
import { ContextMenu } from "../ContextMenu";
import { ConnectionBadge } from "../ConnectionBadge";
import { FullscreenButton } from "../FullscreenButton";
import { HelpBadge } from "../HelpBadge";
import { Modal } from "../Modal";
import {
  NumberPromptModal,
  parseBpm,
  parseMeasureNumber,
} from "../NumberPromptModal";
import { BookmarkModal } from "../BookmarkModal";
import { SelectionRangesDrawer } from "../SelectionRangesDrawer";
import { SettingsDrawer } from "../SettingsDrawer";
import {
  BookmarkIcon,
  GearIcon,
  HomeIcon,
  OpenFileIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  ResetIcon,
  StopIcon,
} from "../icons";

interface PracticeScreenProps {
  fileName: string;
  pieceTitle: string;
  musicxml: ScoreConversion | null;
  fileHash: string | null;
  bpm: number;
  baseBpm: number;
  measureRange: MeasureRange | null;
  piano: PianoController;
  /**
   * App-owned ref that the active input transport dispatches MIDI note events
   * through. PracticeScreen writes the active mode's onNoteEvent into this ref.
   */
  noteEventDispatchRef: {
    current: ((noteNumber: number, kind: "on" | "off") => void) | null;
  };
  mode: PracticeMode;
  tracks: TrackInfo[];
  selectedTracks: number[];
  /** Beat to seek to once the player is created (used for history restore). */
  initialBeat: number;
  /** Fires whenever the live cursor beat changes — App persists it. */
  onCurrentBeatChange: (beat: number) => void;
  onBpmChange: (bpm: number) => void;
  onMeasureRangeChange: (r: MeasureRange | null) => void;
  onModeChange: (mode: PracticeMode) => void;
  onTrackToggle: (idx: number) => void;
  onOpenFile: () => void;
  onGoToLanding: () => void;
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
  onGoToLanding,
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
  const playbackRef = useRef<PiecePlayback | null>(null);
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
    playbackRef.current?.scheduler.dispose();
    playbackRef.current = null;
    setIsPlaying(false);
    setCurrentBeat(0);

    if (musicxml && musicxml.totalBeats > 0) {
      const player = new BeatScheduler(musicxml.totalBeats, bpmRef.current);
      const notes = new NoteTrack(musicxml.notes);
      player.addTrack(notes);
      const range = measureRangeRef.current;
      if (range) {
        const measureStartBeats = musicxml.measureStartBeats;
        player.focusRange = {
          startBeat: selectionStartBeat(range, measureStartBeats),
          endBeat: selectionEndBeat(
            range,
            measureStartBeats,
            musicxml.totalBeats,
          ),
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
      playbackRef.current = { scheduler: player, notes };
      // Jump so the cursor is placed and the sheet scrolls to the start (or the
      // restored position) as soon as the piece loads.
      setCursor(seekBeat, "jump");
    }

    return () => {
      playbackRef.current?.scheduler.dispose();
      playbackRef.current = null;
    };
  }, [musicxml]);

  // BPM changes flow through the live player.
  useEffect(() => {
    playbackRef.current?.scheduler.setBpm(bpm);
  }, [bpm]);

  // Measure-range changes: update focusRange + seek + snap (unless wait mode
  // owns the cursor, in which case let the wait hook handle range changes).
  useEffect(() => {
    const player = playbackRef.current?.scheduler;
    if (!musicxml) {
      return;
    }
    if (measureRange) {
      const measureStartBeats = musicxml.measureStartBeats;
      const startBeat = selectionStartBeat(measureRange, measureStartBeats);
      const endBeat = selectionEndBeat(
        measureRange,
        measureStartBeats,
        musicxml.totalBeats,
      );
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

  // Stable PlayerHandle that delegates to the current playbackRef value.
  const playerHandle = useMemo(
    () => createPlayerHandle(() => playbackRef.current),
    [],
  );

  // Drives the cursor. Returns the current beat (so the cursor is visible at the
  // start position even when stopped); null only when there is no player. The
  // play/pause lifecycle of the rAF loop is driven by the `playing` prop below.
  const getLiveBeat = useCallback(() => {
    const p = playbackRef.current?.scheduler;
    return p ? p.currentBeat : null;
  }, []);

  // Stable PianoOutput that reads from a ref so identity stays constant.
  const pianoRef = useRef(piano);
  pianoRef.current = piano;
  const pianoOutput = useMemo<PianoOutput>(
    () => ({
      // Channel 10 (index 9) is General MIDI percussion; note 42 is a closed
      // hi-hat. 80 ms is just long enough to sound.
      playHiHat: (velocity) => pianoRef.current.sendNote(42, velocity, 80, 9),
    }),
    [],
  );

  const totalMeasures = musicxml ? musicxml.totalMeasures : 1;
  const bookmarks = useBookmarks(fileHash, totalMeasures, onMeasureRangeChange);

  // Previous/next ranges for the result modals. Recomputed every render — a
  // handful of comparisons over the bookmark list.
  const rangeNavigation: RangeNavigation = {
    previous: adjacentRange(
      measureRange,
      "previous",
      totalMeasures,
      bookmarks.bookmarks,
    ),
    next: adjacentRange(
      measureRange,
      "next",
      totalMeasures,
      bookmarks.bookmarks,
    ),
    goTo: onMeasureRangeChange,
  };

  const control: ModeControl = {
    player: playerHandle,
    piano: pianoOutput,
    setCursor,
    setIsPlaying,
    currentBeat,
    currentBeatRef,
    musicxml,
    measureRange,
    measureStartBeats: musicxml?.measureStartBeats ?? [],
    fileHash,
    rangeNavigation,
    appendToDebugLog,
  };

  // These values are intentionally not user-facing; adjust here to tune behaviour.
  const noteSensitivityMilliseconds = 150;
  const playalongTimingBeats = 0.4;

  const wait = useWaitMode(control, {
    noteSensitivityMilliseconds,
    baseBpm,
  });
  const playalong = usePlayalongMode(control, {
    timingBeats: playalongTimingBeats,
    playMusic: playalongPlayMusic,
    metronome: playalongMetronome,
    countIn: playalongCountIn,
    bpm,
  });
  const listen = useListenMode(control);

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

  const handleModeChange = (newMode: PracticeMode) => {
    if (newMode === mode) {
      return;
    }
    // Snap to range start before switching modes so the new mode activates
    // at a predictable position. Each mode's own activate() handles any
    // additional setup (e.g. wait mode picking its first wait point).
    const startBeat = musicxml
      ? selectionStartBeat(measureRange, musicxml.measureStartBeats)
      : 0;
    clearDebugLog();
    playbackRef.current?.scheduler.pause();
    setIsPlaying(false);
    playbackRef.current?.scheduler.seek(startBeat);
    setCursor(startBeat, "jump");
    onModeChange(newMode);
  };

  // The bookmark, if any, that exactly matches the current selection.
  const activeBookmark = measureRange
    ? (bookmarks.bookmarks.find(
        (b) => b.from === measureRange.from && b.to === measureRange.to,
      ) ?? null)
    : null;

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
        background: color.bg,
        color: color.ink,
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
          accentColor={colorValue.accent}
          textFontFamily={FONT_SANS}
          inkColor={colorValue.ink}
          focusRange={measureRange}
          focusColor={focusRangeTint}
          onFocusRangeChange={onMeasureRangeChange}
          snapBeatRef={snapBeatRef}
          snapGeneration={snapGeneration}
          scrollLocked={isPlaying}
          getLiveBeat={getLiveBeat}
          isPlaying={isPlaying}
          onSheetContextMenu={(info) => {
            setContextMenu(info);
          }}
          stickySignatureBackground={color.bg}
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
            color: color.inkFaint,
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
          background: `linear-gradient(90deg, ${color.bg} 0%, transparent 100%)`,
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
          background: `linear-gradient(270deg, ${color.bg} 0%, transparent 100%)`,
          zIndex: 1,
        }}
      />

      {/* TOP LEFT: home button + open-file button + piece title */}
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
            class="corner-button"
            title="Back to your pieces"
          >
            <HomeIcon />
          </button>
          <button
            type="button"
            onClick={onOpenFile}
            class="corner-button"
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
                ...serifTitle(28),
                lineHeight: 1,
                letterSpacing: "-0.01em",
              }}
            >
              {pieceTitle}
            </div>
          </button>
        </div>
      )}

      {/* TOP RIGHT: fullscreen toggle. The only corner with no other chrome,
          which matters in portrait where the top-left row (home + open +
          title) already runs out of width on a phone. */}
      <div
        style={{
          position: "absolute",
          top: 18,
          right: 22,
          zIndex: 2,
        }}
      >
        <FullscreenButton />
      </div>

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
              class="corner-button"
              title="Select range"
            >
              <BookmarkIcon />
            </button>
          )}
          {mode !== "playalong" && (
            <button
              type="button"
              onClick={handleReset}
              class="corner-button"
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
              class="corner-button"
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
                    ...glassPanel(),
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
                      color: color.inkSoft,
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
                          color: color.ink,
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
                    class="mini-button"
                    style={{ flexShrink: 0, marginRight: 2 }}
                  >
                    <PencilIcon size={11} />
                  </button>
                  {/* Reset — only when a custom (non-preset) tempo is active */}
                  {isCustomBpm && (
                    <button
                      type="button"
                      onClick={() => onBpmChange(baseBpm)}
                      title="Reset to default tempo"
                      class="mini-button"
                      style={{ flexShrink: 0, marginRight: 2 }}
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
                          class="chip-toggle"
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
              ...glassPanel(),
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
                  class="mode-toggle"
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

      {/* BOTTOM RIGHT: bluetooth + gear.
          z-index 4 (above the other chrome, which is 2) keeps these buttons
          above the playback cursor bar, which leaks into the root stacking
          context at z-index 3. The modals the badges open no longer depend on
          it: they are <dialog>s in the top layer, above everything. */}
      <div
        style={{
          position: "absolute",
          bottom: 20,
          right: 22,
          display: "flex",
          alignItems: "center",
          gap: 10,
          zIndex: 4,
        }}
      >
        <HelpBadge getDebugLog={getDebugLog} clearDebugLog={clearDebugLog} />
        <ConnectionBadge piano={piano} compact={true} />
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          class="corner-button"
          title="Settings"
        >
          <GearIcon />
        </button>
      </div>

      {/* Context menu (right-click / long-press on sheet music) */}
      {contextMenu && (
        <ContextMenu
          clientX={contextMenu.clientX}
          clientY={contextMenu.clientY}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: `Focus measure ${contextMenu.measureNumber}`,
              onSelect: () =>
                onMeasureRangeChange({
                  from: contextMenu.measureNumber,
                  to: contextMenu.measureNumber,
                }),
            },
            {
              label: "Move cursor to here",
              onSelect: () => handleSeek(contextMenu.beat),
            },
            {
              label: "Jump to measure…",
              onSelect: () => setMeasureJumpDefault(contextMenu.measureNumber),
            },
            ...(measureRange
              ? [
                  activeBookmark
                    ? {
                        label: `Rename “${activeBookmark.name}”`,
                        onSelect: () => bookmarks.openEdit(activeBookmark),
                      }
                    : {
                        label: "Bookmark this range",
                        onSelect: () => bookmarks.openCreate(measureRange),
                      },
                  {
                    label: "Clear focus",
                    onSelect: () => onMeasureRangeChange(null),
                  },
                ]
              : []),
          ]}
        />
      )}

      {/* Bookmark naming/renaming modal */}
      {bookmarks.editor && (
        <BookmarkModal
          editor={bookmarks.editor}
          nameDraft={bookmarks.nameDraft}
          onNameDraftChange={bookmarks.setNameDraft}
          fromDraft={bookmarks.fromDraft}
          onFromDraftChange={bookmarks.setFromDraft}
          toDraft={bookmarks.toDraft}
          onToDraftChange={bookmarks.setToDraft}
          boundsValid={bookmarks.boundsValid}
          totalMeasures={totalMeasures}
          onSave={bookmarks.saveEditor}
          onCancel={bookmarks.closeEditor}
          onDelete={bookmarks.deleteEditing}
        />
      )}

      {/* Piece info modal */}
      {pieceInfoOpen && (
        <Modal
          label="Piece info"
          onClose={() => setPieceInfoOpen(false)}
          style={{
            ...glassPanel(24, 160),
            borderRadius: 16,
            padding: "24px 28px",
            boxShadow: "0 16px 48px rgba(0,0,0,0.18)",
            minWidth: 280,
          }}
        >
          <div style={{ ...serifTitle(24), marginBottom: 20 }}>
            {pieceTitle}
          </div>
          {(
            [
              ["File", fileName],
              [
                "Tempo",
                `${baseBpm} BPM${bpm !== baseBpm ? ` (playing at ${bpm})` : ""}`,
              ],
              [
                "Time signature",
                musicxml
                  ? `${musicxml.timeSigNum}/${musicxml.timeSigDen}`
                  : "—",
              ],
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
                borderTop: `0.5px solid ${color.border}`,
                fontSize: 13,
              }}
            >
              <span style={{ color: color.inkSoft, whiteSpace: "nowrap" }}>
                {label}
              </span>
              <span
                style={{
                  color: color.ink,
                  textAlign: "right",
                  wordBreak: "break-all",
                }}
              >
                {value}
              </span>
            </div>
          ))}
        </Modal>
      )}

      <SelectionRangesDrawer
        open={rangesDrawerOpen}
        onClose={() => setRangesDrawerOpen(false)}
        totalMeasures={totalMeasures}
        measureRange={measureRange}
        onMeasureRangeChange={onMeasureRangeChange}
        fileHash={fileHash}
        markedBpm={baseBpm}
        bookmarks={bookmarks.bookmarks}
        onEditBookmark={(bookmark) => {
          setRangesDrawerOpen(false);
          bookmarks.openEdit(bookmark);
        }}
        onCreateBookmark={() => {
          setRangesDrawerOpen(false);
          bookmarks.openCreate(measureRange ?? { from: 1, to: totalMeasures });
        }}
        repeatSections={musicxml?.repeatSections ?? []}
      />
      <SettingsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
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
        <NumberPromptModal
          title="Set tempo"
          hint={`Default: ${baseBpm} BPM`}
          initialValue={bpm}
          parse={parseBpm}
          confirmLabel="OK"
          onConfirm={(newBpm) => {
            onBpmChange(newBpm);
            setBpmInputModalOpen(false);
          }}
          onCancel={() => setBpmInputModalOpen(false)}
        />
      )}

      {/* Jump-to-measure modal — focuses the chosen measure (cursor snaps there) */}
      {measureJumpDefault !== null && musicxml && (
        <NumberPromptModal
          title="Jump to measure"
          hint={`1–${totalMeasures}`}
          initialValue={measureJumpDefault}
          parse={(draft) => parseMeasureNumber(draft, totalMeasures)}
          confirmLabel="Go"
          onConfirm={(measureNumber) => {
            onMeasureRangeChange({ from: measureNumber, to: measureNumber });
            setMeasureJumpDefault(null);
          }}
          onCancel={() => setMeasureJumpDefault(null)}
        />
      )}

      {/* Mode-owned result modal */}
      {active.modal}
    </div>
  );
}
