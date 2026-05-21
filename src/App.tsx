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
import { PracticeScreen } from "./components/PracticeScreen";
import { type DebugBeatEvent, newDebugBuffer } from "./debug-log";
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
  hashFileBytes,
  loadFileHistory,
  loadRecentFile,
  saveFileHistory,
  saveRecentFile,
} from "./use-file-history";
import { useBluetooth } from "./useBluetooth";
import { useWakeLock } from "./useWakeLock";

function prettyTitle(filename: string): string {
  return filename.replace(/\.(mid|midi)$/i, "").replace(/[-_]/g, " ");
}

export function App() {
  // ── File / MIDI state ────────────────────────────────────────────────────
  const [midiData, setMidiData] = useState<MidiData | null>(null);
  const [tracks, setTracks] = useState<TrackInfo[]>([]);
  const [selectedTracks, setSelectedTracks] = useState<number[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileHash, setFileHash] = useState<string | null>(null);
  // The beat PracticeScreen should seek to once the player is created after
  // a file load with saved history.
  const [initialBeat, setInitialBeat] = useState(0);

  // ── Transport + persisted settings ───────────────────────────────────────
  const [bpm, setBpm] = useState(120);
  const [baseBpm, setBaseBpm] = useState(120);
  const [measureRange, setMeasureRange] = useState<{
    from: number;
    to: number;
  } | null>(null);
  const [mode, setMode] = useState<"wait" | "playalong" | "listen">("listen");
  const [noteSensitivityMilliseconds, setNoteSensitivityMilliseconds] =
    useState(150);
  const [playalongTimingBeats, setPlayalongTimingBeats] = useState(0.4);
  const [playalongPlayMusic, setPlayalongPlayMusic] = useState(true);
  const [playalongMetronome, setPlayalongMetronome] = useState(false);
  const [playalongCountIn, setPlayalongCountIn] = useState(true);

  // Mirror of PracticeScreen's live cursor, used only for persistence.
  const [currentBeat, setCurrentBeat] = useState(0);
  const handleCurrentBeatChange = useCallback((beat: number) => {
    setCurrentBeat(beat);
  }, []);

  // ── UI tokens ─────────────────────────────────────────────────────────────
  const themeName: ThemeName = "cream";
  const accent = ACCENT_COLORS[0];
  const theme = THEMES[themeName];

  const musicxml = useMemo<MidiConversionResult | null>(() => {
    if (!midiData || selectedTracks.length === 0) {
      return null;
    }
    return midiToMusicXmlWithTracks(midiData, selectedTracks);
  }, [midiData, selectedTracks]);

  // ── Debug log ────────────────────────────────────────────────────────────
  const debugBufferRef = useRef(newDebugBuffer());
  // biome-ignore lint/correctness/useExhaustiveDependencies: musicxml change is the reset trigger
  useEffect(() => {
    debugBufferRef.current = newDebugBuffer();
  }, [musicxml]);
  const appendToDebugLog = useCallback((event: DebugBeatEvent) => {
    debugBufferRef.current.append(event);
  }, []);
  const getDebugLog = useCallback(() => debugBufferRef.current.read(), []);

  // ── BLE MIDI ─────────────────────────────────────────────────────────────
  // PracticeScreen writes the active mode's onNoteEvent into this ref; the
  // bluetooth note listener dispatches incoming events through it. Keeps the
  // construction cycle (useBluetooth needs a handler, the handler needs
  // bluetooth.sendNote) broken by indirection.
  const noteEventDispatchRef = useRef<
    ((noteNumber: number, kind: "on" | "off") => void) | null
  >(null);
  const dispatchNoteEvent = useCallback(
    (noteNumber: number, kind: "on" | "off") => {
      noteEventDispatchRef.current?.(noteNumber, kind);
    },
    [],
  );
  const bluetooth = useBluetooth(dispatchNoteEvent);

  useWakeLock(musicxml !== null);

  // Force listen mode when no piano is connected — wait and playalong
  // require MIDI input.
  useEffect(() => {
    if (bluetooth.status !== "connected") {
      setMode((m) => (m === "wait" || m === "playalong" ? "listen" : m));
    }
  }, [bluetooth.status]);

  // ── File loading + history restore ───────────────────────────────────────
  useEffect(() => {
    const recent = loadRecentFile();
    if (!recent) {
      return;
    }
    parseMidiFile(
      new File([recent.bytes], recent.name, { type: "audio/midi" }),
    );
  }, []);

  async function parseMidiFile(file: File) {
    setFileName(file.name);
    setFileError(null);
    setMidiData(null);
    setTracks([]);
    setSelectedTracks([]);
    setCurrentBeat(0);
    setMeasureRange(null);
    setMode("listen");
    setFileHash(null);
    setInitialBeat(0);

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
        setInitialBeat(history.currentBeat);
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
    setMidiData(null);
    setFileName(null);
    setFileHash(null);
    setTracks([]);
    setSelectedTracks([]);
    setCurrentBeat(0);
    setMeasureRange(null);
    setMode("listen");
    setInitialBeat(0);
  }

  // ── Persistence ──────────────────────────────────────────────────────────
  const snapshotRef = useRef<{ hash: string; history: FileHistory } | null>(
    null,
  );

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

  // ── Track selection ──────────────────────────────────────────────────────
  const onTrackToggle = (idx: number) =>
    setSelectedTracks((prev) =>
      prev.includes(idx)
        ? prev.filter((i) => i !== idx)
        : [...prev, idx].sort((a, b) => a - b),
    );

  function handleBpmChange(newBpm: number) {
    setBpm(newBpm);
  }

  const pieceTitle = fileName ? prettyTitle(fileName) : "Untitled";

  // ── Render ───────────────────────────────────────────────────────────────
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
    <PracticeScreen
      theme={theme}
      accent={accent}
      fileName={fileName ?? ""}
      pieceTitle={pieceTitle}
      musicxml={musicxml}
      fileHash={fileHash}
      bpm={bpm}
      baseBpm={baseBpm}
      measureRange={measureRange}
      bluetooth={bluetooth}
      noteEventDispatchRef={noteEventDispatchRef}
      mode={mode}
      tracks={tracks}
      selectedTracks={selectedTracks}
      initialBeat={initialBeat}
      onCurrentBeatChange={handleCurrentBeatChange}
      onBpmChange={handleBpmChange}
      onMeasureRangeChange={setMeasureRange}
      onModeChange={setMode}
      onTrackToggle={onTrackToggle}
      onGoToLanding={handleGoToLanding}
      noteSensitivityMilliseconds={noteSensitivityMilliseconds}
      onSensitivityChange={setNoteSensitivityMilliseconds}
      playalongTimingBeats={playalongTimingBeats}
      onPlayalongTimingChange={setPlayalongTimingBeats}
      playalongPlayMusic={playalongPlayMusic}
      onPlayalongPlayMusicChange={setPlayalongPlayMusic}
      playalongMetronome={playalongMetronome}
      onPlayalongMetronomeChange={setPlayalongMetronome}
      playalongCountIn={playalongCountIn}
      onPlayalongCountInChange={setPlayalongCountIn}
      appendToDebugLog={appendToDebugLog}
      getDebugLog={getDebugLog}
    />
  );
}
