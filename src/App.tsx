import type { MidiData } from "midi-file";
import { parseMidi } from "midi-file";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import {
  type ScoreConversion,
  type TrackInfo,
  getMidiTempo,
  getMidiTracks,
  midiToMusicXmlWithTracks,
} from "../lib/midi/midi-to-musicxml";
import { extractMusicXmlFromMxl } from "../lib/musicxml/mxl";
import { parseScore } from "../lib/musicxml/musicxml-parser";
import {
  getMusicXmlTempo,
  musicXmlToConversion,
} from "../lib/musicxml/musicxml-playback";
import { LandingScreen } from "./components/screens/LandingScreen";
import { PracticeScreen } from "./components/screens/PracticeScreen";
import { type DebugBeatEvent, newDebugBuffer } from "./debug-log";
import { useBluetooth } from "./hooks/use-bluetooth";
import {
  type FileHistory,
  hashFileBytes,
  loadFileHistory,
  loadRecentFile,
  saveFileHistory,
  saveRecentFile,
} from "./hooks/use-file-history";
import { useWakeLock } from "./hooks/use-wake-lock";
import { ACCENT_COLORS, THEMES, type ThemeName } from "./theme";

function prettyTitle(filename: string): string {
  return filename
    .replace(/\.(mid|midi|musicxml|xml|mxl)$/i, "")
    .replace(/[-_]/g, " ");
}

function isMusicXmlFile(name: string): boolean {
  return /\.(musicxml|xml|mxl)$/i.test(name);
}

export function App() {
  // ── File / MIDI state ────────────────────────────────────────────────────
  const [midiData, setMidiData] = useState<MidiData | null>(null);
  // MusicXML loaded directly from a .musicxml/.xml file (no MIDI source).
  const [loadedXml, setLoadedXml] = useState<string | null>(null);
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

  // Mirror of PracticeScreen's live cursor, used only for persistence. Kept in
  // a ref (not state) so the 60fps position stream during playback never
  // re-renders App. The persistence snapshot reads it when other deps change,
  // and beforeunload reads the latest value directly.
  const currentBeatRef = useRef(0);
  const handleCurrentBeatChange = useCallback((beat: number) => {
    currentBeatRef.current = beat;
  }, []);

  // ── UI tokens ─────────────────────────────────────────────────────────────
  const themeName: ThemeName = "cream";
  const accent = ACCENT_COLORS[0];
  const theme = THEMES[themeName];

  const musicxml = useMemo<ScoreConversion | null>(() => {
    if (loadedXml) {
      return musicXmlToConversion(loadedXml);
    }
    if (!midiData || selectedTracks.length === 0) {
      return null;
    }
    return midiToMusicXmlWithTracks(midiData, selectedTracks);
  }, [loadedXml, midiData, selectedTracks]);

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
    loadFile(new File([recent.bytes], recent.name));
  }, []);

  // Route a dropped/selected/restored file to the right parser by extension.
  function loadFile(file: File) {
    if (isMusicXmlFile(file.name)) {
      parseMusicXmlFile(file);
    } else {
      parseMidiFile(file);
    }
  }

  // Reset all file-derived state before loading a new file (shared by both
  // the MIDI and MusicXML paths).
  function resetForNewFile(name: string) {
    setFileName(name);
    setFileError(null);
    setMidiData(null);
    setLoadedXml(null);
    setTracks([]);
    setSelectedTracks([]);
    currentBeatRef.current = 0;
    setMeasureRange(null);
    setMode("listen");
    setFileHash(null);
    setInitialBeat(0);
  }

  async function parseMusicXmlFile(file: File) {
    resetForNewFile(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      // .mxl is a zipped container; everything else is plain XML text.
      const xml = /\.mxl$/i.test(file.name)
        ? await extractMusicXmlFromMxl(bytes)
        : new TextDecoder().decode(bytes);
      parseScore(xml); // throws on invalid MusicXML
      const hash = await hashFileBytes(bytes);
      setFileHash(hash);
      saveRecentFile(file.name, bytes);

      const tempo = getMusicXmlTempo(xml);
      const history = loadFileHistory(hash);

      setLoadedXml(xml);
      setBaseBpm(tempo);

      if (history) {
        setBpm(Math.round(tempo * history.bpmRatio));
        setMeasureRange(history.measureRange);
        setMode(history.mode);
        setNoteSensitivityMilliseconds(history.noteSensitivityMilliseconds);
        if (history.playalongTimingBeats !== undefined) {
          setPlayalongTimingBeats(history.playalongTimingBeats);
        }
        setInitialBeat(history.currentBeat);
      } else {
        setBpm(tempo);
      }
    } catch (err) {
      setFileError(String(err));
    }
  }

  async function parseMidiFile(file: File) {
    resetForNewFile(file.name);

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
      loadFile(file);
    }
  }

  function handleFileDrop(e: DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      loadFile(file);
    }
  }

  function handleGoToLanding() {
    setMidiData(null);
    setLoadedXml(null);
    setFileName(null);
    setFileHash(null);
    setTracks([]);
    setSelectedTracks([]);
    currentBeatRef.current = 0;
    setMeasureRange(null);
    setMode("listen");
    setInitialBeat(0);
  }

  // ── Persistence ──────────────────────────────────────────────────────────
  const snapshotRef = useRef<{ hash: string; history: FileHistory } | null>(
    null,
  );

  useEffect(() => {
    if (!fileHash || (!midiData && !loadedXml)) {
      snapshotRef.current = null;
      return;
    }
    const history: FileHistory = {
      bpmRatio: bpm / baseBpm,
      measureRange,
      mode,
      selectedTrackIndices: selectedTracks,
      currentBeat: currentBeatRef.current,
      noteSensitivityMilliseconds,
      playalongTimingBeats,
    };
    snapshotRef.current = { hash: fileHash, history };
    const timer = setTimeout(() => saveFileHistory(fileHash, history), 500);
    return () => clearTimeout(timer);
  }, [
    fileHash,
    midiData,
    loadedXml,
    bpm,
    baseBpm,
    measureRange,
    mode,
    selectedTracks,
    noteSensitivityMilliseconds,
    playalongTimingBeats,
  ]);

  // Persist the latest cursor position when the page is closed or backgrounded.
  // currentBeat is no longer a snapshot dep (it would re-render on every
  // position update), so these are the points where the live beat is captured.
  // visibilitychange → hidden is the reliable signal on mobile, where
  // beforeunload often doesn't fire.
  useEffect(() => {
    function save() {
      if (snapshotRef.current) {
        saveFileHistory(snapshotRef.current.hash, {
          ...snapshotRef.current.history,
          currentBeat: currentBeatRef.current,
        });
      }
    }
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") {
        save();
      }
    }
    window.addEventListener("beforeunload", save);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", save);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
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
  if (midiData === null && loadedXml === null) {
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
