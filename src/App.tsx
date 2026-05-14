import type { MidiData } from "midi-file";
import { parseMidi } from "midi-file";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { LandingScreen } from "./components/LandingScreen";
import { PracticeScreen } from "./components/PracticeScreen";
import { MidiPlayer } from "./midi-player";
import {
  type MidiConversionResult,
  type TrackInfo,
  getMidiTempo,
  getMidiTracks,
  midiToMusicXmlWithTracks,
} from "./midi-to-musicxml";
import { ACCENT_COLORS, THEMES, type ThemeName } from "./theme";
import { useWaitMode } from "./use-wait-mode";
import { useBluetooth } from "./useBluetooth";

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
  const [showFocus, setShowFocus] = useState(false);

  const theme = THEMES[themeName];

  // Player + wait mode
  const playerRef = useRef<MidiPlayer | null>(null);
  const measureRangeRef = useRef(measureRange);
  useEffect(() => {
    measureRangeRef.current = measureRange;
  }, [measureRange]);

  const musicxml = useMemo<MidiConversionResult | null>(() => {
    if (!midiData || selectedTracks.length === 0) {
      return null;
    }
    return midiToMusicXmlWithTracks(midiData, selectedTracks);
  }, [midiData, selectedTracks]);

  const waitMode = useWaitMode(musicxml, showFocus ? measureRange : null);
  const bluetooth = useBluetooth(waitMode.onNoteEvent);

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
      player.onPositionUpdate = (beat) => {
        if (!waitMode.activeRef.current) {
          setCurrentBeat(beat);
        }
      };
      player.onEnd = (beat) => {
        setIsPlaying(false);
        setCurrentBeat(beat);
      };
      playerRef.current = player;
    }

    return () => {
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, [musicxml]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: waitMode.activeRef is a ref
  useEffect(() => {
    const player = playerRef.current;
    if (!musicxml) {
      return;
    }
    const { timeSigNum } = musicxml;
    if (showFocus && measureRange) {
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
  }, [showFocus, measureRange, musicxml]);

  async function handlePlayPause() {
    if (waitMode.active) {
      return;
    }
    const player = playerRef.current;
    if (!player) {
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

  function handleStop() {
    if (waitMode.active) {
      waitMode.rewind();
      return;
    }
    playerRef.current?.stop();
    setIsPlaying(false);
    setCurrentBeat(0);
  }

  function handleBpmChange(newBpm: number) {
    setBpm(newBpm);
    playerRef.current?.setBpm(newBpm);
  }

  function handleContextMenuAction(
    action: "focus" | "seek",
    measureNumber: number,
    beat: number,
  ) {
    if (action === "focus") {
      setShowFocus(true);
      setMeasureRange({ from: measureNumber, to: measureNumber });
    } else {
      handleSeek(beat);
    }
  }

  function handleSeek(beat: number) {
    if (waitMode.active) {
      return;
    }
    playerRef.current?.seek(beat);
    setCurrentBeat(beat);
  }

  function handleToggleWaitMode() {
    if (!waitMode.active) {
      playerRef.current?.pause();
      setIsPlaying(false);
    }
    waitMode.toggle(currentBeat);
  }

  function parseMidiFile(file: File) {
    setFileName(file.name);
    setFileError(null);
    setMidiData(null);
    setTracks([]);
    setSelectedTracks([]);
    setIsPlaying(false);
    setCurrentBeat(0);
    setMeasureRange(null);
    setShowFocus(false);

    file.arrayBuffer().then((buffer) => {
      try {
        const parsed = parseMidi(new Uint8Array(buffer));
        const trackList = getMidiTracks(parsed);
        setMidiData(parsed);
        setTracks(trackList);
        setSelectedTracks(trackList.map((t) => t.index));
        const tempo = getMidiTempo(parsed);
        setBpm(tempo);
        setBaseBpm(tempo);
      } catch (err) {
        setFileError(String(err));
      }
    });
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
    setTracks([]);
    setSelectedTracks([]);
    setIsPlaying(false);
    setCurrentBeat(0);
    setMeasureRange(null);
    setShowFocus(false);
  }

  // Note colors
  const noteColors = useMemo(() => {
    if (waitMode.active) {
      return waitMode.noteColors;
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
  }, [waitMode.active, waitMode.noteColors, musicxml, currentBeat, accent]);

  const playbackBeat =
    waitMode.cursorBeat ?? (currentBeat > 0 ? currentBeat : undefined);

  const totalMeasures =
    musicxml && musicxml.totalBeats > 0
      ? Math.ceil(musicxml.totalBeats / musicxml.timeSigNum)
      : 0;
  const currentMeasure =
    musicxml && musicxml.totalBeats > 0
      ? Math.min(
          totalMeasures,
          Math.floor((playbackBeat ?? 0) / musicxml.timeSigNum) + 1,
        )
      : 1;

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
    <PracticeScreen
      theme={theme}
      accent={accent}
      pieceTitle={pieceTitle}
      musicxml={musicxml}
      noteColors={noteColors}
      playbackBeat={playbackBeat}
      cursorColor={waitMode.wrongNoteFlash ? theme.error : accent}
      isPlaying={isPlaying}
      bpm={bpm}
      baseBpm={baseBpm}
      showFocus={showFocus}
      measureRange={measureRange}
      totalMeasures={totalMeasures}
      currentMeasure={currentMeasure}
      bluetooth={bluetooth}
      waitMode={waitMode.active}
      tracks={tracks}
      selectedTracks={selectedTracks}
      onPlayPause={handlePlayPause}
      onStop={handleStop}
      onBpmChange={handleBpmChange}
      onFocusToggle={() => {
        setShowFocus((v) => {
          if (!v && musicxml && !measureRange) {
            setMeasureRange({ from: 1, to: Math.min(4, totalMeasures) });
          }
          return !v;
        });
      }}
      onMeasureRangeChange={setMeasureRange}
      onContextMenuAction={handleContextMenuAction}
      onToggleWaitMode={handleToggleWaitMode}
      onTrackToggle={onTrackToggle}
      onGoToLanding={handleGoToLanding}
    />
  );
}
