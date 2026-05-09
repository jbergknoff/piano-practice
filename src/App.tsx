import type { MidiData } from "midi-file";
import { parseMidi } from "midi-file";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { LivePianoInput } from "./LivePianoInput";
import { MidiPlayer } from "./midi-player";
import {
  type MidiConversionResult,
  type TrackInfo,
  getMidiTracks,
  midiToMusicXmlWithTracks,
} from "./midi-to-musicxml";
import { PlaybackControls } from "./PlaybackControls";
import { SheetMusicDisplay } from "./SheetMusicDisplay";

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

  function handleFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

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

  const conversionResult = useMemo<MidiConversionResult | null>(() => {
    if (!midiData || selectedTracks.length === 0) return null;
    return midiToMusicXmlWithTracks(midiData, selectedTracks);
  }, [midiData, selectedTracks]);

  // Rebuild player whenever the conversion result changes
  useEffect(() => {
    playerRef.current?.dispose();
    playerRef.current = null;
    setIsPlaying(false);
    setCurrentBeat(0);

    if (conversionResult && conversionResult.totalBeats > 0) {
      const player = new MidiPlayer(
        conversionResult.notes,
        conversionResult.totalBeats,
        bpm,
      );
      player.onPositionUpdate = (beat) => setCurrentBeat(beat);
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
    // bpm is intentionally excluded — setBpm on the player handles that path
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversionResult]);

  async function handlePlayPause() {
    const player = playerRef.current;
    if (!player) return;
    if (isPlaying) {
      player.pause();
      setIsPlaying(false);
    } else {
      await player.play();
      setIsPlaying(true);
    }
  }

  function handleStop() {
    playerRef.current?.stop();
    setIsPlaying(false);
    setCurrentBeat(0);
  }

  function handleBpmChange(newBpm: number) {
    setBpm(newBpm);
    playerRef.current?.setBpm(newBpm);
  }

  // Derive note colors: highlight notes currently playing
  const noteColors = useMemo(() => {
    if (!conversionResult || currentBeat === 0) return {};
    const colors: Record<string, string> = {};
    for (const note of conversionResult.notes) {
      if (
        note.startBeat <= currentBeat &&
        currentBeat < note.startBeat + note.durationBeats
      ) {
        const id = `p${note.partIndex}-m${note.measureNumber}-n${note.noteIndex}-v${note.voiceIndex}`;
        colors[id] = "#1565c0";
      }
    }
    return colors;
  }, [conversionResult, currentBeat]);

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
      {conversionResult && (
        <PlaybackControls
          isPlaying={isPlaying}
          bpm={bpm}
          currentBeat={currentBeat}
          totalBeats={conversionResult.totalBeats}
          timeSigNum={conversionResult.timeSigNum}
          onPlayPause={handlePlayPause}
          onStop={handleStop}
          onBpmChange={handleBpmChange}
        />
      )}
      {conversionResult && (
        <SheetMusicDisplay
          musicxml={conversionResult.musicxml}
          noteColors={noteColors}
          playbackBeat={currentBeat > 0 ? currentBeat : undefined}
        />
      )}

      <LivePianoInput />
    </div>
  );
}
