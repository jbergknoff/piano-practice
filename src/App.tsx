import type { MidiData } from "midi-file";
import { parseMidi } from "midi-file";
import { useCallback, useMemo, useRef, useState } from "preact/hooks";
import { Controls } from "./Controls";
import { LivePianoInput } from "./LivePianoInput";
import { LoopMarkers } from "./LoopMarkers";
import { type MusicXmlDisplayHandle, MusicXmlDisplay } from "./MusicXmlDisplay";
import type { CursorStep } from "./cursor-schedule";
import {
  type TrackInfo,
  extractTempo,
  getMidiTracks,
  midiToMusicXmlWithTracks,
} from "./midi-to-musicxml";
import { useBleMode } from "./useBleMode";
import { usePlayback } from "./usePlayback";

export function App() {
  const [midiData, setMidiData] = useState<MidiData | null>(null);
  const [tracks, setTracks] = useState<TrackInfo[]>([]);
  const [selectedTracks, setSelectedTracks] = useState<number[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<CursorStep[]>([]);

  const displayRef = useRef<MusicXmlDisplayHandle>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const defaultBpm = useMemo(
    () => (midiData ? extractTempo(midiData) : 120),
    [midiData],
  );

  const musicxml = useMemo(() => {
    if (!midiData || selectedTracks.length === 0) {
      return null;
    }
    return midiToMusicXmlWithTracks(midiData, selectedTracks);
  }, [midiData, selectedTracks]);

  const handleScheduleBuilt = useCallback((s: CursorStep[]) => {
    setSchedule(s);
  }, []);

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
    setSchedule([]);

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
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
    );
  }

  const playback = usePlayback({
    schedule,
    displayRef,
    scrollContainerRef,
    defaultBpm,
  });

  const ble = useBleMode({
    schedule,
    stepIndex: playback.stepIndex,
    onAdvance: playback.advanceToStep,
    loopStartMeasure: playback.loopStartMeasure,
    loopEndMeasure: playback.loopEndMeasure,
  });

  function handleSetLoopStart() {
    const step = schedule[playback.stepIndex];
    if (step) {
      playback.setLoopStart(step.measureIndex);
    }
  }

  function handleSetLoopEnd() {
    const step = schedule[playback.stepIndex];
    if (step) {
      playback.setLoopEnd(step.measureIndex);
    }
  }

  // Pixel x positions for loop markers.
  const loopStartX = useMemo(() => {
    return (
      schedule.find((s) => s.measureIndex >= playback.loopStartMeasure)
        ?.xPixel ?? 0
    );
  }, [schedule, playback.loopStartMeasure]);

  const loopEndX = useMemo(() => {
    for (let i = schedule.length - 1; i >= 0; i--) {
      if (schedule[i].measureIndex <= playback.loopEndMeasure) {
        return schedule[i].xPixel;
      }
    }
    return 0;
  }, [schedule, playback.loopEndMeasure]);

  // Score container height for loop marker lines.
  const scoreHeight = scrollContainerRef.current?.scrollHeight ?? 200;

  const measureCount = displayRef.current?.getMeasureCount() ?? 0;

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
        <>
          <Controls
            status={playback.status}
            mode={playback.mode}
            bpm={playback.bpm}
            stepIndex={playback.stepIndex}
            measureCount={measureCount}
            loopStartMeasure={playback.loopStartMeasure}
            loopEndMeasure={playback.loopEndMeasure}
            scheduleReady={schedule.length > 0}
            onPlay={playback.play}
            onPause={playback.pause}
            onStop={playback.stop}
            onSetMode={playback.setMode}
            onSetLoopStart={handleSetLoopStart}
            onSetLoopEnd={handleSetLoopEnd}
            onSetBpm={playback.setBpm}
          />
          <div ref={scrollContainerRef} style={{ position: "relative" }}>
            <LoopMarkers
              startX={loopStartX}
              endX={loopEndX}
              height={scoreHeight}
              visible={schedule.length > 0}
            />
            <MusicXmlDisplay
              ref={displayRef}
              musicxml={musicxml}
              onScheduleBuilt={handleScheduleBuilt}
            />
          </div>
        </>
      )}

      <LivePianoInput
        onNoteOn={playback.mode === "ble" ? ble.onNoteOn : undefined}
      />
    </div>
  );
}
