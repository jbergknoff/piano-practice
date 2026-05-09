import type { MidiData } from "midi-file";
import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import { useEffect, useRef, useState } from "preact/hooks";
import { buildNoteSchedule, getTempo } from "./midi-playback";

interface Props {
  musicxml: string;
  midiData?: MidiData;
  selectedTracks?: number[];
}

export function MusicXmlDisplay({ musicxml, midiData, selectedTracks }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Store stopPlayback in a ref so effect cleanups always see the current version
  // without adding it to effect dependency arrays.
  const stopPlaybackRef = useRef<() => void>(() => {});

  function stopPlayback() {
    for (const t of timeoutsRef.current) clearTimeout(t);
    timeoutsRef.current = [];
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    if (osmdRef.current) {
      osmdRef.current.cursor.hide();
      osmdRef.current.cursor.reset();
    }
    setIsPlaying(false);
  }
  stopPlaybackRef.current = stopPlayback;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!osmdRef.current) {
      osmdRef.current = new OpenSheetMusicDisplay(container, {
        autoResize: false,
        backend: "svg",
        drawTitle: false,
        pageFormat: "Endless",
      });
    }

    // Give OSMD a wide canvas so all measures fit on one row without wrapping.
    container.style.width = "10000px";

    osmdRef.current
      .load(musicxml)
      .then(() => {
        if (!osmdRef.current || !containerRef.current) return;
        osmdRef.current.render();
        osmdRef.current.cursor.hide();

        // Trim the SVG and container to the actual rendered content width.
        const svg = containerRef.current.querySelector<SVGSVGElement>("svg");
        if (svg) {
          const bbox = svg.getBBox();
          const contentWidth = Math.ceil(bbox.x + bbox.width) + 20;
          if (contentWidth > 0) {
            svg.setAttribute("width", String(contentWidth));
            containerRef.current.style.width = `${contentWidth}px`;
          }
        }
      })
      .catch(console.error);

    return () => stopPlaybackRef.current();
  }, [musicxml]);

  function scheduleNote(
    ctx: AudioContext,
    midiNote: number,
    velocity: number,
    startTime: number,
    duration: number,
  ) {
    const freq = 440 * 2 ** ((midiNote - 69) / 12);
    const vol = (velocity / 127) * 0.25;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.value = freq;

    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(vol, startTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(
      vol * 0.4,
      startTime + Math.min(0.4, duration * 0.6),
    );
    gain.gain.setValueAtTime(vol * 0.4, startTime + duration - 0.03);
    gain.gain.linearRampToValueAtTime(0.0001, startTime + duration + 0.05);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.1);
  }

  function startPlayback() {
    if (!osmdRef.current || !midiData || !selectedTracks?.length) return;

    const osmd = osmdRef.current;
    const cursor = osmd.cursor;
    cursor.reset();
    cursor.show();

    // Collect beat timestamps for each cursor step
    const cursorBeats: number[] = [];
    while (!cursor.iterator.endReached) {
      cursorBeats.push(cursor.iterator.currentTimeStamp.realValue);
      cursor.next();
    }
    cursor.reset();

    if (cursorBeats.length === 0) {
      cursor.hide();
      return;
    }

    const secondsPerBeat = getTempo(midiData) / 1_000_000;
    const startBeat = cursorBeats[0];

    // Schedule cursor advances relative to the first cursor position
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i < cursorBeats.length; i++) {
      const delay = (cursorBeats[i] - startBeat) * secondsPerBeat * 1000;
      timeouts.push(
        setTimeout(() => {
          cursor.next();
        }, delay),
      );
    }

    // Hide cursor and reset state after the last note
    const totalMs =
      (cursorBeats[cursorBeats.length - 1] - startBeat) * secondsPerBeat * 1000;
    timeouts.push(
      setTimeout(
        () => {
          cursor.hide();
          setIsPlaying(false);
        },
        totalMs + secondsPerBeat * 1000,
      ),
    );

    timeoutsRef.current = timeouts;

    // Schedule audio
    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;

    const notes = buildNoteSchedule(midiData, selectedTracks);
    for (const n of notes) {
      scheduleNote(
        audioCtx,
        n.note,
        n.velocity,
        audioCtx.currentTime + n.time,
        n.duration,
      );
    }

    setIsPlaying(true);
  }

  function handlePlayStop() {
    if (isPlaying) {
      stopPlayback();
    } else {
      startPlayback();
    }
  }

  const canPlay = !!midiData && !!selectedTracks?.length;

  return (
    <div>
      {canPlay && (
        <button
          type="button"
          onClick={handlePlayStop}
          style={{ marginBottom: "0.5em" }}
        >
          {isPlaying ? "Stop" : "Play"}
        </button>
      )}
      <div style={{ overflowX: "auto" }}>
        <div ref={containerRef} />
      </div>
    </div>
  );
}
