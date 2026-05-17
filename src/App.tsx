import type { MidiData } from "midi-file";
import { parseMidi } from "midi-file";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { LandingScreen } from "./components/LandingScreen";
import { PlayalongResultModal } from "./components/PlayalongResultModal";
import { PracticeScreen } from "./components/PracticeScreen";
import { WaitModeResultModal } from "./components/WaitModeResultModal";
import { MidiPlayer } from "./midi-player";
import {
  type MidiConversionResult,
  type TrackInfo,
  getMidiTempo,
  getMidiTracks,
  midiToMusicXmlWithTracks,
} from "./midi-to-musicxml";
import { ACCENT_COLORS, THEMES, type ThemeName } from "./theme";
import {
  type FileHistory,
  type PlayalongAttempt,
  type WaitModeAttempt,
  hashFileBytes,
  loadAttemptHistory,
  loadFileHistory,
  loadPlayalongAttemptHistory,
  loadRecentFile,
  saveAttempt,
  saveFileHistory,
  savePlayalongAttempt,
  saveRecentFile,
} from "./use-file-history";
import { type PlayalongPhase, usePlayalongMode } from "./use-playalong-mode";
import { useWaitMode } from "./use-wait-mode";
import { useBluetooth } from "./useBluetooth";
import { useWakeLock } from "./useWakeLock";

function prettyTitle(filename: string): string {
  return filename.replace(/\.(mid|midi)$/i, "").replace(/[-_]/g, " ");
}

// ── App ───────────────────────────────────────────────────────────────────────

export function App() {
  // File / MIDI state
  const [midiData, setMidiData] = useState<MidiData | null>(null);
  const [tracks, setTracks] = useState<TrackInfo[]>([]);
  const [selectedTracks, setSelectedTracks] = useState<number[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileHash, setFileHash] = useState<string | null>(null);
  // Beat to seek to once the player is created after a file load with saved history.
  const pendingSeekRef = useRef<number>(0);
  // Mode to apply once musicxml is ready after a history restore.
  const pendingModeRef = useRef<"wait" | "playalong" | "listen" | null>(null);

  // Transport state
  const [bpm, setBpm] = useState(120);
  const [baseBpm, setBaseBpm] = useState(120);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(0);
  const [measureRange, setMeasureRange] = useState<{
    from: number;
    to: number;
  } | null>(null);

  // UI state
  const themeName: ThemeName = "cream";
  const accent = ACCENT_COLORS[0];
  const [mode, setMode] = useState<"wait" | "playalong" | "listen">("listen");
  const [noteSensitivityMilliseconds, setNoteSensitivityMilliseconds] =
    useState(150);
  const [playalongTimingBeats, setPlayalongTimingBeats] = useState(0.4);
  const [playalongPianoAudio, setPlayalongPianoAudio] = useState(true);
  const playalongPianoAudioRef = useRef(playalongPianoAudio);
  useEffect(() => {
    playalongPianoAudioRef.current = playalongPianoAudio;
  }, [playalongPianoAudio]);
  const [completionModal, setCompletionModal] = useState<{
    history: WaitModeAttempt[];
    selectionLabel: string;
    expectedDurationMs: number;
  } | null>(null);
  const [playalongModal, setPlayalongModal] = useState<{
    history: PlayalongAttempt[];
    selectionLabel: string;
  } | null>(null);

  const theme = THEMES[themeName];

  // Player + wait mode
  const playerRef = useRef<MidiPlayer | null>(null);
  const measureRangeRef = useRef(measureRange);
  useEffect(() => {
    measureRangeRef.current = measureRange;
  }, [measureRange]);

  const bpmRef = useRef(bpm);
  useEffect(() => {
    bpmRef.current = bpm;
  }, [bpm]);

  const currentBeatRef = useRef(currentBeat);
  useEffect(() => {
    currentBeatRef.current = currentBeat;
  }, [currentBeat]);

  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const fileHashRef = useRef(fileHash);
  useEffect(() => {
    fileHashRef.current = fileHash;
  }, [fileHash]);

  const musicxml = useMemo<MidiConversionResult | null>(() => {
    if (!midiData || selectedTracks.length === 0) {
      return null;
    }
    return midiToMusicXmlWithTracks(midiData, selectedTracks);
  }, [midiData, selectedTracks]);

  const musicxmlRef = useRef(musicxml);
  useEffect(() => {
    musicxmlRef.current = musicxml;
  }, [musicxml]);

  // Ref breaks the dependency cycle: waitMode needs bluetooth.sendNote, but
  // bluetooth needs waitMode.onNoteEvent. The callback is only ever invoked
  // during async user interaction, so the ref is always current by then.
  const sendNoteRef =
    useRef<
      (
        note: number,
        velocity: number,
        durationMs: number,
        channel?: number,
      ) => void
    >();

  function handleWaitModeComplete(stats: {
    wrongNotes: number;
    elapsedMs: number;
  }) {
    const hash = fileHashRef.current;
    const mx = musicxmlRef.current;
    if (!hash || !mx) {
      return;
    }
    const range = measureRangeRef.current;
    const currentBpm = bpmRef.current;

    const selectionKey = range ? `m${range.from}-m${range.to}` : "full";

    const selectionBeats = range
      ? (range.to - range.from + 1) * mx.timeSigNum
      : mx.totalBeats;

    const expectedDurationMs = (selectionBeats / currentBpm) * 60_000;

    const attempt: WaitModeAttempt = {
      timestamp: Date.now(),
      wrongNotes: stats.wrongNotes,
      elapsedMs: stats.elapsedMs,
    };
    saveAttempt(hash, selectionKey, attempt);
    const allAttempts = loadAttemptHistory(hash)[selectionKey] ?? [];

    const selectionLabel = range
      ? range.from === range.to
        ? `Measure ${range.from}`
        : `Measures ${range.from}–${range.to}`
      : "Full piece";

    setCompletionModal({
      history: allAttempts,
      selectionLabel,
      expectedDurationMs,
    });
  }

  function handlePlayalongComplete(stats: { score: number }) {
    const hash = fileHashRef.current;
    const mx = musicxmlRef.current;
    if (!hash || !mx) {
      return;
    }

    const range = measureRangeRef.current;
    const selectionKey = range ? `m${range.from}-m${range.to}` : "full";

    const attempt: PlayalongAttempt = {
      timestamp: Date.now(),
      score: stats.score,
      bpm: bpmRef.current,
    };
    savePlayalongAttempt(hash, selectionKey, attempt);
    const allAttempts = loadPlayalongAttemptHistory(hash)[selectionKey] ?? [];

    const selectionLabel = range
      ? range.from === range.to
        ? `Measure ${range.from}`
        : `Measures ${range.from}–${range.to}`
      : "Full piece";

    setIsPlaying(false);
    setPlayalongModal({ history: allAttempts, selectionLabel });
  }

  const playalongCancelRef = useRef<(() => void) | null>(null);

  const waitMode = useWaitMode(
    musicxml,
    measureRange,
    noteSensitivityMilliseconds,
    // Channel 9 = GM percussion; note 42 = Closed Hi-Hat
    () => sendNoteRef.current?.(42, 55, 80, 9),
    handleWaitModeComplete,
    accent,
  );

  const playalong = usePlayalongMode(
    musicxml,
    measureRange,
    currentBeatRef,
    playalongTimingBeats,
    handlePlayalongComplete,
  );

  // Stable combined note-event handler: routes to the active mode's handler.
  // Both onNoteEvent callbacks are stable (useCallback []); modeRef is a ref.
  // biome-ignore lint/correctness/useExhaustiveDependencies: stable callbacks + refs
  const combinedNoteEvent = useCallback(
    (noteNumber: number, kind: "on" | "off") => {
      if (modeRef.current === "playalong") {
        playalong.onNoteEvent(noteNumber, kind);
      } else {
        waitMode.onNoteEvent(noteNumber, kind);
      }
    },
    [],
  );

  const bluetooth = useBluetooth(combinedNoteEvent);
  sendNoteRef.current = bluetooth.sendNote;
  // Stable ref so effects don't need waitMode.toggle in their dep arrays.
  const waitModeToggleRef = useRef(waitMode.toggle);
  waitModeToggleRef.current = waitMode.toggle;
  useWakeLock(musicxml !== null);

  // Force listen mode when no piano is connected — wait and playalong require MIDI input.
  useEffect(() => {
    if (bluetooth.status !== "connected") {
      setMode((m) => (m === "wait" || m === "playalong" ? "listen" : m));
    }
  }, [bluetooth.status]);

  // On startup, reload the most recently opened file automatically.
  useEffect(() => {
    const recent = loadRecentFile();
    if (!recent) {
      return;
    }
    parseMidiFile(
      new File([recent.bytes], recent.name, { type: "audio/midi" }),
    );
  }, []);

  // Mirror latest saveable state for the beforeunload handler below.
  const snapshotRef = useRef<{ hash: string; history: FileHistory } | null>(
    null,
  );

  // Keep snapshot current and periodically flush to localStorage.
  useEffect(() => {
    if (!fileHash || !midiData) {
      snapshotRef.current = null;
      return;
    }
    const history: FileHistory = {
      bpmRatio: bpm / baseBpm,
      measureRange,
      mode,
      selectedTrackIndices: selectedTracks,
      currentBeat,
      noteSensitivityMilliseconds,
      playalongTimingBeats,
    };
    snapshotRef.current = { hash: fileHash, history };
    const timer = setTimeout(() => saveFileHistory(fileHash, history), 500);
    return () => clearTimeout(timer);
  }, [
    fileHash,
    midiData,
    bpm,
    baseBpm,
    measureRange,
    mode,
    selectedTracks,
    currentBeat,
    noteSensitivityMilliseconds,
    playalongTimingBeats,
  ]);

  // Save synchronously on page close/refresh so cursor position isn't lost.
  useEffect(() => {
    function save() {
      if (snapshotRef.current) {
        saveFileHistory(snapshotRef.current.hash, snapshotRef.current.history);
      }
    }
    window.addEventListener("beforeunload", save);
    return () => window.removeEventListener("beforeunload", save);
  }, []);

  // Apply restored mode once musicxml is available.
  useEffect(() => {
    const pending = pendingModeRef.current;
    if (musicxml === null || pending === null) {
      return;
    }
    pendingModeRef.current = null;
    // useWaitMode initializes active=true; toggle off if mode is not "wait".
    if (pending !== "wait") {
      waitModeToggleRef.current(0);
    }
  }, [musicxml]);

  // Rebuild player when conversion result changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: bpm/measureRange go through player methods
  useEffect(() => {
    playerRef.current?.dispose();
    playerRef.current = null;
    setIsPlaying(false);
    setCurrentBeat(0);

    if (musicxml && musicxml.totalBeats > 0) {
      const player = new MidiPlayer(musicxml.notes, musicxml.totalBeats, bpm);
      const range = measureRangeRef.current;
      if (range) {
        player.focusRange = {
          startBeat: (range.from - 1) * musicxml.timeSigNum,
          endBeat: range.to * musicxml.timeSigNum,
        };
      }
      const seekBeat = pendingSeekRef.current;
      pendingSeekRef.current = 0;
      if (seekBeat > 0) {
        player.seek(seekBeat);
        setCurrentBeat(seekBeat);
      }
      player.onPositionUpdate = (beat) => {
        if (!waitMode.activeRef.current) {
          setCurrentBeat(beat);
        }
      };
      player.onEnd = (beat) => {
        setIsPlaying(false);
        setCurrentBeat(beat);
        if (modeRef.current === "playalong") {
          clearPlayalongAudio(player);
          playalong.notifyEnd();
        }
      };
      playerRef.current = player;
    }

    return () => {
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, [musicxml]);

  // Keep currentBeat and the player position in sync with the wait-mode cursor
  // so that both modes drive the score cursor through the same value.
  useEffect(() => {
    if (waitMode.cursorBeat === null) {
      return;
    }
    setCurrentBeat(waitMode.cursorBeat);
    playerRef.current?.seek(waitMode.cursorBeat);
  }, [waitMode.cursorBeat]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: waitMode.activeRef is a ref
  useEffect(() => {
    const player = playerRef.current;
    if (!musicxml) {
      return;
    }
    const { timeSigNum } = musicxml;
    if (measureRange) {
      const startBeat = (measureRange.from - 1) * timeSigNum;
      const endBeat = measureRange.to * timeSigNum;
      if (player) {
        player.focusRange = { startBeat, endBeat };
        player.seek(startBeat);
      }
      if (!waitMode.activeRef.current) {
        setCurrentBeat(startBeat);
      }
    } else if (player) {
      player.focusRange = null;
    }
  }, [measureRange, musicxml]);

  function clearPlayalongAudio(player: InstanceType<typeof MidiPlayer>) {
    player.skipWebAudio = false;
    player.onNoteScheduled = undefined;
  }

  function handlePlayalongStop() {
    playalongCancelRef.current?.();
    playalongCancelRef.current = null;
    const player = playerRef.current;
    if (player) {
      clearPlayalongAudio(player);
      player.pause();
    }
    setIsPlaying(false);
    playalong.abort();
    const range = measureRangeRef.current;
    const startBeat = range
      ? (range.from - 1) * (musicxmlRef.current?.timeSigNum ?? 4)
      : 0;
    playerRef.current?.seek(startBeat);
    setCurrentBeat(startBeat);
  }

  async function handlePlayPause() {
    if (mode === "wait") {
      return;
    }
    const player = playerRef.current;
    if (!player) {
      return;
    }

    if (mode === "playalong") {
      if (
        isPlaying ||
        playalong.phaseRef.current === "counting-in" ||
        playalong.phaseRef.current === "playing"
      ) {
        handlePlayalongStop();
      } else if (
        playalong.phaseRef.current === "idle" ||
        playalong.phaseRef.current === "complete"
      ) {
        const mx = musicxmlRef.current;
        if (!mx) {
          return;
        }

        // Seek to range start before count-in.
        const range = measureRangeRef.current;
        const startBeat = range ? (range.from - 1) * mx.timeSigNum : 0;
        player.seek(startBeat);
        setCurrentBeat(startBeat);

        playalong.startCountIn();
        setIsPlaying(true); // show stop button during count-in

        const countInBeats = 2 * mx.timeSigNum;
        const { cancel, done } = player.playCountIn(
          countInBeats,
          mx.timeSigNum,
          (i) => {
            const isDownbeat = i % mx.timeSigNum === 0;
            sendNoteRef.current?.(42, isDownbeat ? 80 : 55, 80, 9);
          },
        );
        playalongCancelRef.current = cancel;

        await done;

        if ((playalong.phaseRef.current as string) !== "counting-in") {
          // Was stopped during count-in.
          setIsPlaying(false);
          return;
        }
        playalongCancelRef.current = null;
        playalong.startPlaying();

        // Route playback audio to the piano speaker if the option is on.
        if (playalongPianoAudioRef.current) {
          player.skipWebAudio = true;
          player.onNoteScheduled = (note, velocity, _delay, durationMs) => {
            sendNoteRef.current?.(
              note,
              Math.max(1, Math.round(velocity * 0.3)),
              durationMs,
            );
          };
        }

        await player.play();
      }
      return;
    }

    if (isPlaying) {
      player.pause();
      setIsPlaying(false);
    } else {
      await player.play();
      setIsPlaying(true);
    }
  }

  function handleReset() {
    if (mode === "wait") {
      waitMode.rewind();
      return;
    }
    // Race mode has no reset button, but handle it defensively.
    if (mode === "playalong") {
      handlePlayalongStop();
      return;
    }
    const startBeat = measureRange
      ? (measureRange.from - 1) * (musicxml?.timeSigNum ?? 4)
      : 0;
    playerRef.current?.pause();
    playerRef.current?.seek(startBeat);
    setIsPlaying(false);
    setCurrentBeat(startBeat);
  }

  function handleBpmChange(newBpm: number) {
    setBpm(newBpm);
    playerRef.current?.setBpm(newBpm);
  }

  function handleContextMenuAction(
    action: "focus" | "seek" | "clearFocus",
    measureNumber: number,
    beat: number,
  ) {
    if (action === "focus") {
      setMeasureRange({ from: measureNumber, to: measureNumber });
    } else if (action === "clearFocus") {
      setMeasureRange(null);
    } else {
      handleSeek(beat);
    }
  }

  function handleSeek(beat: number) {
    if (mode === "wait") {
      waitMode.seekToBeat(beat);
      return;
    }
    playerRef.current?.seek(beat);
    setCurrentBeat(beat);
  }

  function handleModeChange(newMode: "wait" | "playalong" | "listen") {
    if (newMode === mode) {
      return;
    }
    // Abort any in-progress playalong when leaving race mode.
    if (mode === "playalong" && playalong.phaseRef.current !== "idle") {
      handlePlayalongStop();
    }
    setMode(newMode);
    const becomingWait = newMode === "wait";
    const wasWait = mode === "wait";
    if (becomingWait && !wasWait) {
      playerRef.current?.pause();
      setIsPlaying(false);
      if (!waitMode.active) {
        waitMode.toggle(currentBeat);
      }
    } else if (!becomingWait && wasWait) {
      if (waitMode.active) {
        waitMode.toggle(currentBeat);
      }
    }
  }

  async function parseMidiFile(file: File) {
    setFileName(file.name);
    setFileError(null);
    setMidiData(null);
    setTracks([]);
    setSelectedTracks([]);
    setIsPlaying(false);
    setCurrentBeat(0);
    setMeasureRange(null);
    setMode("listen");
    setFileHash(null);
    pendingSeekRef.current = 0;

    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const hash = await hashFileBytes(bytes);
      setFileHash(hash);
      saveRecentFile(file.name, bytes);

      const parsed = parseMidi(bytes);
      const trackList = getMidiTracks(parsed);
      const tempo = getMidiTempo(parsed);
      const history = loadFileHistory(hash);

      setMidiData(parsed);
      setTracks(trackList);
      setBaseBpm(tempo);

      if (history) {
        const knownIndices = new Set(trackList.map((t) => t.index));
        const validTracks = history.selectedTrackIndices.filter((i) =>
          knownIndices.has(i),
        );
        setSelectedTracks(
          validTracks.length > 0 ? validTracks : trackList.map((t) => t.index),
        );
        setBpm(Math.round(tempo * history.bpmRatio));
        setMeasureRange(history.measureRange);
        setMode(history.mode);
        setNoteSensitivityMilliseconds(history.noteSensitivityMilliseconds);
        if (history.playalongTimingBeats !== undefined) {
          setPlayalongTimingBeats(history.playalongTimingBeats);
        }
        pendingSeekRef.current = history.currentBeat;
        pendingModeRef.current = history.mode;
      } else {
        setSelectedTracks(trackList.map((t) => t.index));
        setBpm(tempo);
      }
    } catch (err) {
      setFileError(String(err));
    }
  }

  function handleFileInput(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      parseMidiFile(file);
    }
  }

  function handleFileDrop(e: DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      parseMidiFile(file);
    }
  }

  function handleGoToLanding() {
    playerRef.current?.stop();
    playerRef.current?.dispose();
    playerRef.current = null;
    setMidiData(null);
    setFileName(null);
    setFileHash(null);
    setTracks([]);
    setSelectedTracks([]);
    setIsPlaying(false);
    setCurrentBeat(0);
    setMeasureRange(null);
    setMode("listen");
  }

  // Note colors
  const noteColors = useMemo(() => {
    if (waitMode.active) {
      return waitMode.noteColors;
    }

    if (
      mode === "playalong" &&
      (playalong.phase === "playing" || playalong.phase === "complete")
    ) {
      if (!musicxml) {
        return {};
      }
      const range = measureRange;
      const startBeat = range ? (range.from - 1) * musicxml.timeSigNum : 0;
      const endBeat = range
        ? range.to * musicxml.timeSigNum
        : musicxml.totalBeats;
      // In complete phase, treat all selection notes as past.
      const effectiveBeat =
        playalong.phase === "complete" ? Number.POSITIVE_INFINITY : currentBeat;
      const colors: Record<string, string> = {};
      for (const note of musicxml.notes) {
        if (note.tieStop) {
          continue;
        }
        if (note.startBeat < startBeat || note.startBeat >= endBeat) {
          continue;
        }
        const id = `p${note.partIndex}-m${note.measureNumber}-n${note.noteIndex}-v${note.voiceIndex}`;
        if (playalong.hitNoteIds.has(id)) {
          colors[id] = "#2e7d32"; // green: correctly played
        } else if (note.startBeat < effectiveBeat - playalongTimingBeats) {
          colors[id] = "#c62828"; // red: missed
        }
      }
      return colors;
    }

    if (!musicxml || currentBeat === 0) {
      return {};
    }
    const colors: Record<string, string> = {};
    for (const note of musicxml.notes) {
      if (
        note.startBeat <= currentBeat &&
        currentBeat < note.startBeat + note.durationBeats
      ) {
        colors[
          `p${note.partIndex}-m${note.measureNumber}-n${note.noteIndex}-v${note.voiceIndex}`
        ] = accent;
      }
    }
    return colors;
  }, [
    waitMode.active,
    waitMode.noteColors,
    mode,
    playalong.phase,
    playalong.hitNoteIds,
    musicxml,
    measureRange,
    currentBeat,
    playalongTimingBeats,
    accent,
  ]);

  const playbackBeat =
    currentBeat > 0 || waitMode.active ? currentBeat : undefined;

  const pieceTitle = fileName ? prettyTitle(fileName) : "Untitled";

  const onTrackToggle = (idx: number) =>
    setSelectedTracks((prev) =>
      prev.includes(idx)
        ? prev.filter((i) => i !== idx)
        : [...prev, idx].sort((a, b) => a - b),
    );

  // Screen is derived from whether MIDI data has been loaded.
  if (midiData === null) {
    return (
      <LandingScreen
        theme={theme}
        accent={accent}
        fileError={fileError}
        bluetooth={bluetooth}
        onFile={handleFileInput}
        onDrop={handleFileDrop}
      />
    );
  }

  return (
    <>
      <PracticeScreen
        theme={theme}
        accent={accent}
        fileName={fileName ?? ""}
        pieceTitle={pieceTitle}
        musicxml={musicxml}
        noteColors={noteColors}
        playbackBeat={playbackBeat}
        cursorColor={accent}
        isPlaying={isPlaying}
        bpm={bpm}
        baseBpm={baseBpm}
        measureRange={measureRange}
        bluetooth={bluetooth}
        mode={mode}
        playalongPhase={playalong.phase}
        tracks={tracks}
        selectedTracks={selectedTracks}
        onPlayPause={handlePlayPause}
        onReset={handleReset}
        onBpmChange={handleBpmChange}
        onMeasureRangeChange={setMeasureRange}
        onContextMenuAction={handleContextMenuAction}
        onModeChange={handleModeChange}
        onTrackToggle={onTrackToggle}
        onGoToLanding={handleGoToLanding}
        noteSensitivityMilliseconds={noteSensitivityMilliseconds}
        onSensitivityChange={setNoteSensitivityMilliseconds}
        playalongTimingBeats={playalongTimingBeats}
        onPlayalongTimingChange={setPlayalongTimingBeats}
        playalongPianoAudio={playalongPianoAudio}
        onPlayalongPianoAudioChange={setPlayalongPianoAudio}
        fileHash={fileHash}
      />
      {completionModal && (
        <WaitModeResultModal
          theme={theme}
          accent={accent}
          selectionLabel={completionModal.selectionLabel}
          history={completionModal.history}
          expectedDurationMs={completionModal.expectedDurationMs}
          onClose={() => setCompletionModal(null)}
        />
      )}
      {playalongModal && (
        <PlayalongResultModal
          theme={theme}
          accent={accent}
          selectionLabel={playalongModal.selectionLabel}
          history={playalongModal.history}
          onClose={() => {
            setPlayalongModal(null);
            // Keep phase="complete" so green/red note colors remain for review.
            // Seek to start so the sheet is positioned at the beginning.
            const range = measureRangeRef.current;
            const startBeat = range
              ? (range.from - 1) * (musicxmlRef.current?.timeSigNum ?? 4)
              : 0;
            playerRef.current?.seek(startBeat);
            setCurrentBeat(startBeat);
          }}
        />
      )}
    </>
  );
}
