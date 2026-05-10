import type { MidiData } from "midi-file";
import { parseMidi } from "midi-file";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
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
import { useWaitMode } from "./use-wait-mode";

export function App() {
  const [midiData, setMidiData] = useState<MidiData | null>(null);
  const [tracks, setTracks] = useState<TrackInfo[]>([]);
  const [selectedTracks, setSelectedTracks] = useState<number[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [bpm, setBpm] = useState(120);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(0);

  const playerRef = useRef<MidiPlayer | null>(null);

  const musicxml = useMemo<MidiConversionResult | null>(() => {
    if (!midiData || selectedTracks.length === 0) {
      return null;
    }
    return midiToMusicXmlWithTracks(midiData, selectedTracks);
  }, [midiData, selectedTracks]);

  const waitMode = useWaitMode(musicxml);

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

  // Rebuild player whenever the conversion result changes.
  // bpm is intentionally excluded: bpm changes go through player.setBpm, not a rebuild.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useEffect(() => {
    playerRef.current?.dispose();
    playerRef.current = null;
    setIsPlaying(false);
    setCurrentBeat(0);

    if (musicxml && musicxml.totalBeats > 0) {
      const player = new MidiPlayer(musicxml.notes, musicxml.totalBeats, bpm);
      // Suppress position updates while wait mode is driving the cursor.
      player.onPositionUpdate = (beat) => {
        if (!waitMode.activeRef.current) {
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

  function handleToggleWaitMode() {
    if (!waitMode.active) {
      // Pause audio before handing cursor control to the hook.
      playerRef.current?.pause();
      setIsPlaying(false);
    }
    waitMode.toggle(currentBeat);
  }

  // In wait mode: amber highlight on the expected chord (from the hook).
  // In playback mode: blue highlight on currently sounding notes.
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
        ] = "#1565c0";
      }
    }
    return colors;
  }, [waitMode.active, waitMode.noteColors, musicxml, currentBeat]);

  const playbackBeat =
    waitMode.cursorBeat ?? (currentBeat > 0 ? currentBeat : undefined);

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
          waitMode={waitMode.active}
          onPlayPause={handlePlayPause}
          onStop={handleStop}
          onBpmChange={handleBpmChange}
          onToggleWaitMode={handleToggleWaitMode}
        />
      )}
      {musicxml && (
        <SheetMusicDisplay
          musicxml={musicxml.musicxml}
          noteColors={noteColors}
          playbackBeat={playbackBeat}
        />
      )}

      <LivePianoInput onNoteEvent={waitMode.onNoteEvent} />
    </div>
  );
}
