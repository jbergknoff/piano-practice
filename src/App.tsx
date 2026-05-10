import type { MidiData } from "midi-file";
import { parseMidi } from "midi-file";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { LivePianoInput } from "./LivePianoInput";
import { MidiPlayer } from "./midi-player";
import {
  type MidiConversionResult,
  type TrackInfo,
  getMidiTracks,
  getMidiTempo,
  midiToMusicXmlWithTracks,
} from "./midi-to-musicxml";
import { PlaybackControls } from "./PlaybackControls";
import { SheetMusicDisplay } from "./SheetMusicDisplay";

interface WaitPoint {
  beat: number;
  noteNumbers: Set<number>;
}

export function App() {
  const [midiData, setMidiData] = useState<MidiData | null>(null);
  const [tracks, setTracks] = useState<TrackInfo[]>([]);
  const [selectedTracks, setSelectedTracks] = useState<number[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [bpm, setBpm] = useState(120);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(0);

  const [waitMode, setWaitMode] = useState(false);
  const [waitPointIndex, setWaitPointIndex] = useState(0);

  const playerRef = useRef<MidiPlayer | null>(null);

  // Refs for stable access inside callbacks that outlive renders.
  const waitModeRef = useRef(false);
  const waitPointIndexRef = useRef(0);
  const heldNotesRef = useRef<Set<number>>(new Set());
  // Timestamp of the last cursor advance; used to enforce a brief cooldown so
  // repeated identical chords don't race ahead, without blocking fast playing.
  const lastAdvanceTimeRef = useRef(0);

  useEffect(() => {
    waitModeRef.current = waitMode;
  }, [waitMode]);
  useEffect(() => {
    waitPointIndexRef.current = waitPointIndex;
  }, [waitPointIndex]);

  function handleFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) {
      return;
    }

    setFileName(file.name);
    setError(null);
    setMidiData(null);
    setTracks([]);
    setSelectedTracks([]);
    setIsPlaying(false);
    setCurrentBeat(0);

    file.arrayBuffer().then((buffer) => {
      try {
        const parsed = parseMidi(new Uint8Array(buffer));
        const trackList = getMidiTracks(parsed);
        setMidiData(parsed);
        setTracks(trackList);
        setSelectedTracks(trackList.map((t) => t.index));
        setBpm(getMidiTempo(parsed));
      } catch (err) {
        setError(String(err));
      }
    });
  }

  function toggleTrack(index: number) {
    setSelectedTracks((prev) =>
      prev.includes(index)
        ? prev.filter((i) => i !== index)
        : [...prev, index].sort((a, b) => a - b),
    );
  }

  const musicxml = useMemo<MidiConversionResult | null>(() => {
    if (!midiData || selectedTracks.length === 0) {
      return null;
    }
    return midiToMusicXmlWithTracks(midiData, selectedTracks);
  }, [midiData, selectedTracks]);

  // One wait point per unique startBeat; note numbers deduplicated across parts.
  const waitPoints = useMemo<WaitPoint[]>(() => {
    if (!musicxml) {
      return [];
    }
    const beatMap = new Map<number, Set<number>>();
    for (const note of musicxml.notes) {
      if (note.tieStop) {
        continue;
      }
      const existing = beatMap.get(note.startBeat);
      if (existing) {
        existing.add(note.noteNumber);
      } else {
        beatMap.set(note.startBeat, new Set([note.noteNumber]));
      }
    }
    return Array.from(beatMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([beat, noteNumbers]) => ({ beat, noteNumbers }));
  }, [musicxml]);

  const waitPointsRef = useRef(waitPoints);
  useEffect(() => {
    waitPointsRef.current = waitPoints;
  }, [waitPoints]);

  // Rebuild player whenever the conversion result changes.
  // bpm is intentionally excluded: bpm changes go through player.setBpm, not a rebuild.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useEffect(() => {
    playerRef.current?.dispose();
    playerRef.current = null;
    setIsPlaying(false);
    setCurrentBeat(0);
    setWaitMode(false);
    setWaitPointIndex(0);
    waitPointIndexRef.current = 0;
    heldNotesRef.current.clear();
    lastAdvanceTimeRef.current = 0;

    if (musicxml && musicxml.totalBeats > 0) {
      const player = new MidiPlayer(musicxml.notes, musicxml.totalBeats, bpm);
      player.onPositionUpdate = (beat) => {
        if (!waitModeRef.current) {
          setCurrentBeat(beat);
        }
      };
      player.onEnd = () => {
        setIsPlaying(false);
        setCurrentBeat(0);
      };
      playerRef.current = player;
    }

    return () => {
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, [musicxml]);

  async function handlePlayPause() {
    if (waitMode) {
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
    if (waitMode) {
      // In wait mode, Stop rewinds to the first wait point.
      setWaitPointIndex(0);
      waitPointIndexRef.current = 0;
      if (waitPointsRef.current.length > 0) {
        setCurrentBeat(waitPointsRef.current[0].beat);
      }
      heldNotesRef.current.clear();
      lastAdvanceTimeRef.current = 0;
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

  function toggleWaitMode() {
    const entering = !waitMode;
    if (entering) {
      // Pause regular playback when entering wait mode.
      if (isPlaying) {
        playerRef.current?.pause();
        setIsPlaying(false);
      }
      // Snap to the nearest wait point at or before the current beat.
      const points = waitPointsRef.current;
      let nearestIdx = 0;
      for (let i = 0; i < points.length; i++) {
        if (points[i].beat <= currentBeat) {
          nearestIdx = i;
        } else {
          break;
        }
      }
      setWaitPointIndex(nearestIdx);
      waitPointIndexRef.current = nearestIdx;
      if (points.length > 0) {
        setCurrentBeat(points[nearestIdx].beat);
      }
      heldNotesRef.current.clear();
      lastAdvanceTimeRef.current = 0;
    }
    setWaitMode(entering);
  }

  // Stable callback forwarded from LivePianoInput; advances the cursor in wait mode.
  const handleNoteEvent = useCallback(
    (noteNumber: number, kind: "on" | "off") => {
      if (!waitModeRef.current || waitPointsRef.current.length === 0) {
        return;
      }

      const held = heldNotesRef.current;
      if (kind === "on") {
        held.add(noteNumber);
      } else {
        held.delete(noteNumber);
      }

      // Ignore events within 100 ms of the last advance so that repeated
      // identical chords don't race ahead, while still allowing fast playing.
      if (Date.now() - lastAdvanceTimeRef.current < 100) {
        return;
      }

      const points = waitPointsRef.current;
      const idx = waitPointIndexRef.current;
      if (idx >= points.length) {
        return;
      }

      const expected = points[idx].noteNumbers;
      if (
        held.size === expected.size &&
        [...expected].every((n) => held.has(n))
      ) {
        lastAdvanceTimeRef.current = Date.now();
        const nextIdx = idx + 1;
        waitPointIndexRef.current = nextIdx;
        if (nextIdx < points.length) {
          setWaitPointIndex(nextIdx);
          setCurrentBeat(points[nextIdx].beat);
        } else {
          // Reached the end of the piece.
          setWaitPointIndex(points.length);
          setCurrentBeat(0);
        }
      }
    },
    [],
  );

  // Derive note colors.
  // In wait mode: highlight the expected chord in amber.
  // In playback mode: highlight currently sounding notes in blue.
  const noteColors = useMemo(() => {
    if (!musicxml || (!waitMode && currentBeat === 0)) {
      return {};
    }
    const colors: Record<string, string> = {};

    if (waitMode && waitPoints.length > 0) {
      const idx = Math.min(waitPointIndex, waitPoints.length - 1);
      const targetBeat = waitPoints[idx].beat;
      for (const note of musicxml.notes) {
        if (!note.tieStop && note.startBeat === targetBeat) {
          const id = `p${note.partIndex}-m${note.measureNumber}-n${note.noteIndex}-v${note.voiceIndex}`;
          colors[id] = "#e65100";
        }
      }
    } else if (currentBeat > 0) {
      for (const note of musicxml.notes) {
        if (
          note.startBeat <= currentBeat &&
          currentBeat < note.startBeat + note.durationBeats
        ) {
          const id = `p${note.partIndex}-m${note.measureNumber}-n${note.noteIndex}-v${note.voiceIndex}`;
          colors[id] = "#1565c0";
        }
      }
    }

    return colors;
  }, [musicxml, currentBeat, waitMode, waitPoints, waitPointIndex]);

  return (
    <div>
      <h1>MIDI Inspector</h1>
      <input type="file" accept=".mid,.midi" onChange={handleFile} />
      {fileName && <p>File: {fileName}</p>}
      {error && <p style="color: red">{error}</p>}
      {tracks.length > 0 && (
        <div>
          {tracks.map((t) => (
            <label key={t.index} style={{ marginRight: "1em" }}>
              <input
                type="checkbox"
                checked={selectedTracks.includes(t.index)}
                onChange={() => toggleTrack(t.index)}
              />{" "}
              {t.name} ({t.noteCount} notes)
            </label>
          ))}
        </div>
      )}
      {musicxml && (
        <PlaybackControls
          isPlaying={isPlaying}
          bpm={bpm}
          currentBeat={currentBeat}
          totalBeats={musicxml.totalBeats}
          timeSigNum={musicxml.timeSigNum}
          waitMode={waitMode}
          onPlayPause={handlePlayPause}
          onStop={handleStop}
          onBpmChange={handleBpmChange}
          onToggleWaitMode={toggleWaitMode}
        />
      )}
      {musicxml && (
        <SheetMusicDisplay
          musicxml={musicxml.musicxml}
          noteColors={noteColors}
          playbackBeat={
            waitMode ? currentBeat : currentBeat > 0 ? currentBeat : undefined
          }
        />
      )}

      <LivePianoInput onNoteEvent={handleNoteEvent} />
    </div>
  );
}
