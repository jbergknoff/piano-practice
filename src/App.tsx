import {
  type TrackInfo,
  getMidiTempo,
  getMidiTracks,
  midiToMusicXmlWithTracks,
} from "@jbergknoff/midi-to-musicxml";
import { parseScore } from "@jbergknoff/sheet-music-display";
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
  getMusicXmlTempo,
  musicXmlToConversion,
} from "../lib/musicxml/musicxml-playback";
import { extractMusicXmlFromMxl } from "../lib/musicxml/mxl";
import { LandingScreen } from "./components/screens/LandingScreen";
import { PracticeScreen } from "./components/screens/PracticeScreen";
import { type DebugBeatEvent, newDebugBuffer } from "./debug-log";
import { DemoOverlay } from "./demo/DemoOverlay";
import { demoFocusRange, isDemoMode } from "./demo/fake-bluetooth";
import {
  type LibraryEntry,
  deleteLibraryEntry,
  getAllLibraryEntries,
  getMostRecentlyOpenedEntry,
  migrateRecentFileToLibrary,
  putLibraryEntry,
} from "./hooks/use-file-library";
import { preserveFullscreenAcrossPicker } from "./hooks/use-fullscreen";
import { usePiano } from "./hooks/use-piano";
import {
  computeLibrarySummary,
  type FileHistory,
  type LibrarySummary,
  hashFileBytes,
  loadFileHistory,
  loadGlobalPreferences,
  saveFileHistory,
  saveGlobalPreferences,
} from "./hooks/use-file-history";
import { useWakeLock } from "./hooks/use-wake-lock";
import type { PracticeMode } from "./modes/mode-control";
import { prettyTitle } from "./pretty-title";
import type { MeasureRange } from "./selection";
import { ACCENT_COLORS, THEMES, type ThemeName } from "./theme";

function isMusicXmlFile(name: string): boolean {
  return /\.(musicxml|xml|mxl)$/i.test(name);
}

export function App() {
  // Desktop-only profiling harness (?demo=1). The fake Bluetooth adapter is
  // installed in main.tsx before mount; here we just prefer Playalong so a
  // profile can be captured with one Play click.
  const demo = isDemoMode();

  // ── File / MIDI state ────────────────────────────────────────────────────
  const openFileInputRef = useRef<HTMLInputElement>(null);
  const [midiData, setMidiData] = useState<MidiData | null>(null);
  // MusicXML loaded directly from a .musicxml/.xml file (no MIDI source).
  const [loadedXml, setLoadedXml] = useState<string | null>(null);
  // True from first render until the auto-restore attempt completes (success
  // or failure). IndexedDB lookups are async, so this always starts true and
  // the auto-resume effect below flips it to false once it settles — the
  // landing screen is never painted before that check resolves.
  const [isRestoringRecentFile, setIsRestoringRecentFile] = useState(true);
  const [libraryEntries, setLibraryEntries] = useState<
    Array<LibraryEntry & LibrarySummary>
  >([]);
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
  const [measureRange, setMeasureRange] = useState<MeasureRange | null>(null);
  const [mode, setMode] = useState<PracticeMode>("listen");
  const [playalongPlayMusic, setPlayalongPlayMusic] = useState(
    () => loadGlobalPreferences().playalongPlayMusic,
  );
  const [playalongMetronome, setPlayalongMetronome] = useState(
    () => loadGlobalPreferences().playalongMetronome,
  );
  const [playalongCountIn, setPlayalongCountIn] = useState(
    () => loadGlobalPreferences().playalongCountIn,
  );

  useEffect(() => {
    saveGlobalPreferences({
      playalongPlayMusic,
      playalongMetronome,
      playalongCountIn,
    });
  }, [playalongPlayMusic, playalongMetronome, playalongCountIn]);

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
    return musicXmlToConversion(
      midiToMusicXmlWithTracks(midiData, selectedTracks),
    );
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
  const clearDebugLog = useCallback(() => {
    debugBufferRef.current = newDebugBuffer();
  }, []);

  // ── Piano input ──────────────────────────────────────────────────────────
  // PracticeScreen writes the active mode's onNoteEvent into this ref; the
  // active transport's note listener dispatches incoming events through it.
  // Keeps the construction cycle (usePiano needs a handler, the handler needs
  // piano.sendNote) broken by indirection.
  const noteEventDispatchRef = useRef<
    ((noteNumber: number, kind: "on" | "off") => void) | null
  >(null);
  const dispatchNoteEvent = useCallback(
    (noteNumber: number, kind: "on" | "off") => {
      noteEventDispatchRef.current?.(noteNumber, kind);
    },
    [],
  );
  const piano = usePiano(dispatchNoteEvent);

  useWakeLock(musicxml !== null);

  // Force listen mode when no piano is connected — wait and playalong
  // require MIDI input. This guard covers runtime disconnects; the initial
  // load case is handled by clampModeToPianoStatus() at history restore.
  useEffect(() => {
    if (piano.status !== "connected") {
      setMode((m) => (m === "wait" || m === "playalong" ? "listen" : m));
    }
  }, [piano.status]);

  // In demo mode, default to Playalong once a file is loaded and the fake piano
  // is "connected". Done once per file (the ref is reset on musicxml change) so
  // manually switching modes afterwards to compare still sticks.
  const demoDefaultedRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: musicxml change resets the once-per-file flag
  useEffect(() => {
    demoDefaultedRef.current = false;
  }, [musicxml]);
  useEffect(() => {
    if (
      demo &&
      musicxml &&
      piano.status === "connected" &&
      !demoDefaultedRef.current
    ) {
      demoDefaultedRef.current = true;
      setMode("playalong");
      const range = demoFocusRange();
      if (range) {
        setMeasureRange(range);
      }
    }
  }, [demo, musicxml, piano.status]);

  // Returns the mode from history, falling back to "listen" when the saved
  // mode requires a piano connection and none is currently connected.
  function clampModeToPianoStatus(savedMode: PracticeMode): PracticeMode {
    const requiresPiano = savedMode === "wait" || savedMode === "playalong";
    if (requiresPiano && piano.status !== "connected") {
      return "listen";
    }
    return savedMode;
  }

  // ── File library ─────────────────────────────────────────────────────────
  const refreshLibrary = useCallback(async () => {
    const entries = await getAllLibraryEntries();
    setLibraryEntries(
      entries
        .map((entry) => ({ ...entry, ...computeLibrarySummary(entry.hash) }))
        .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt),
    );
  }, []);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  async function handleDeleteLibraryEntry(hash: string) {
    await deleteLibraryEntry(hash);
    await refreshLibrary();
  }

  // ── File loading + history restore ───────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await migrateRecentFileToLibrary();
      const entry = await getMostRecentlyOpenedEntry();
      if (cancelled) {
        return;
      }
      if (!entry) {
        setIsRestoringRecentFile(false);
        return;
      }
      loadFile(new File([entry.bytes], entry.fileName));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Route a dropped/selected/restored file to the right parser by extension.
  function loadFile(file: File) {
    if (isMusicXmlFile(file.name)) {
      parseMusicXmlFile(file);
    } else {
      parseMidiFile(file);
    }
  }

  // Reset all file-derived state — shared by loading a new file (name set)
  // and returning to the library, which is effectively "no file loaded"
  // (name null).
  //
  // On the load paths this must be called only AFTER all the async work for
  // the new file is done, in the same synchronous block as the writes that
  // install it (Preact batches those into one render). Calling it up front
  // instead — as this used to — leaves midiData/loadedXml null across the
  // await, which renders LandingScreen for a frame: the flash of the home
  // screen when opening a second file while one is already loaded.
  function resetForNewFile(name: string | null) {
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

  // Applies saved per-file settings when history exists for this file hash,
  // otherwise falls back to the file's own tempo. Shared by both file-loading
  // paths; track-selection restore is MIDI-only, so it stays with its caller.
  function applyFileHistory(history: FileHistory | null, tempo: number) {
    if (history) {
      setBpm(Math.round(tempo * history.bpmRatio));
      setMeasureRange(history.measureRange);
      setMode(clampModeToPianoStatus(history.mode));
      setInitialBeat(history.currentBeat);
    } else {
      setBpm(tempo);
    }
  }

  async function parseMusicXmlFile(file: File) {
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      // .mxl is a zipped container; everything else is plain XML text.
      const xml = /\.mxl$/i.test(file.name)
        ? await extractMusicXmlFromMxl(bytes)
        : new TextDecoder().decode(bytes);
      parseScore(xml); // throws on invalid MusicXML
      const hash = await hashFileBytes(bytes);
      const tempo = getMusicXmlTempo(xml);
      const history = loadFileHistory(hash);
      void putLibraryEntry(hash, file.name, bytes);

      // Single batched swap from the old piece (if any) to the new one.
      resetForNewFile(file.name);
      setFileHash(hash);
      setLoadedXml(xml);
      setBaseBpm(tempo);
      applyFileHistory(history, tempo);
    } catch (err) {
      // A file that fails to parse leaves no piece loaded, so the error is
      // reported on the landing screen.
      resetForNewFile(file.name);
      setFileError(String(err));
    } finally {
      setIsRestoringRecentFile(false);
    }
  }

  async function parseMidiFile(file: File) {
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const hash = await hashFileBytes(bytes);
      const parsed = parseMidi(bytes);
      const trackList = getMidiTracks(parsed);
      const tempo = getMidiTempo(parsed);
      const history = loadFileHistory(hash);
      void putLibraryEntry(hash, file.name, bytes);

      let trackSelection = trackList.map((t) => t.index);
      if (history) {
        const knownIndices = new Set(trackList.map((t) => t.index));
        const validTracks = history.selectedTrackIndices.filter((i) =>
          knownIndices.has(i),
        );
        if (validTracks.length > 0) {
          trackSelection = validTracks;
        }
      }

      // Single batched swap from the old piece (if any) to the new one.
      resetForNewFile(file.name);
      setFileHash(hash);
      setMidiData(parsed);
      setTracks(trackList);
      setSelectedTracks(trackSelection);
      setBaseBpm(tempo);
      applyFileHistory(history, tempo);
    } catch (err) {
      // A file that fails to parse leaves no piece loaded, so the error is
      // reported on the landing screen.
      resetForNewFile(file.name);
      setFileError(String(err));
    } finally {
      setIsRestoringRecentFile(false);
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
    void refreshLibrary();
    resetForNewFile(null);
  }

  function handleOpenFile() {
    openFileInputRef.current?.click();
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

  const pieceTitle = fileName ? prettyTitle(fileName) : "Untitled";

  // ── Render ───────────────────────────────────────────────────────────────
  if (midiData === null && loadedXml === null) {
    // Suppress the landing screen until the auto-restore attempt settles so
    // there is no flash of landing page when a recent file is about to load.
    if (isRestoringRecentFile) {
      return null;
    }
    return (
      <LandingScreen
        theme={theme}
        accent={accent}
        fileError={fileError}
        piano={piano}
        onFile={handleFileInput}
        onDrop={handleFileDrop}
        entries={libraryEntries}
        onSelectEntry={(entry) =>
          loadFile(new File([entry.bytes], entry.fileName))
        }
        onDeleteEntry={handleDeleteLibraryEntry}
      />
    );
  }

  return (
    <>
      <input
        ref={openFileInputRef}
        type="file"
        accept=".mid,.midi,audio/midi,.musicxml,.xml,.mxl,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml"
        onClick={preserveFullscreenAcrossPicker}
        onChange={handleFileInput}
        style={{ display: "none" }}
      />
      {/* Keyed on the file so switching pieces remounts the practice session
          (open drawers/modals, cursor, mode-hook internals all start fresh).
          That remount used to happen implicitly, because loading a file
          bounced through the landing screen; now that it doesn't, the key is
          what keeps one piece's session state from leaking into the next. */}
      <PracticeScreen
        key={fileHash}
        theme={theme}
        accent={accent}
        fileName={fileName ?? ""}
        pieceTitle={pieceTitle}
        musicxml={musicxml}
        fileHash={fileHash}
        bpm={bpm}
        baseBpm={baseBpm}
        measureRange={measureRange}
        piano={piano}
        noteEventDispatchRef={noteEventDispatchRef}
        mode={mode}
        tracks={tracks}
        selectedTracks={selectedTracks}
        initialBeat={initialBeat}
        onCurrentBeatChange={handleCurrentBeatChange}
        onBpmChange={setBpm}
        onMeasureRangeChange={setMeasureRange}
        onModeChange={setMode}
        onTrackToggle={onTrackToggle}
        onOpenFile={handleOpenFile}
        onGoToLanding={handleGoToLanding}
        playalongPlayMusic={playalongPlayMusic}
        onPlayalongPlayMusicChange={setPlayalongPlayMusic}
        playalongMetronome={playalongMetronome}
        onPlayalongMetronomeChange={setPlayalongMetronome}
        playalongCountIn={playalongCountIn}
        onPlayalongCountInChange={setPlayalongCountIn}
        appendToDebugLog={appendToDebugLog}
        getDebugLog={getDebugLog}
        clearDebugLog={clearDebugLog}
      />
      {demo && (
        <DemoOverlay
          noteEventDispatchRef={noteEventDispatchRef}
          accent={accent}
        />
      )}
    </>
  );
}
