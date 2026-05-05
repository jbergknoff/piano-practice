import type { Midi } from "@tonejs/midi";
import {
  Accidental,
  Formatter,
  Renderer,
  Stave,
  StaveNote,
  Voice,
} from "vexflow";
import { useEffect, useRef, useState } from "preact/hooks";

// --- Music helpers ---

const NOTE_NAMES = [
  "c",
  "c#",
  "d",
  "d#",
  "e",
  "f",
  "f#",
  "g",
  "g#",
  "a",
  "a#",
  "b",
];
const SHARP_SEMITONES = new Set([1, 3, 6, 8, 10]);

function midiToKey(midiNote: number): string {
  return `${NOTE_NAMES[midiNote % 12]}/${Math.floor(midiNote / 12) - 1}`;
}

const NOTE_NAMES_DISPLAY = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

function midiToName(midiNote: number): string {
  return `${NOTE_NAMES_DISPLAY[midiNote % 12]}${Math.floor(midiNote / 12) - 1}`;
}

const VEX_DUR_LABELS: Record<string, string> = {
  w: "whole",
  h: "half",
  q: "quarter",
  "8": "eighth",
  "16": "sixteenth",
};

function getClef(notes: Array<{ midi: number }>): "treble" | "bass" {
  if (!notes.length) {
    return "treble";
  }
  const avg = notes.reduce((s, n) => s + n.midi, 0) / notes.length;
  return avg < 60 ? "bass" : "treble";
}

// VexFlow duration strings, ordered largest to smallest
const VEX_DURS: Array<[number, string]> = [
  [4, "w"],
  [2, "h"],
  [1, "q"],
  [0.5, "8"],
  [0.25, "16"],
];

function nearestVexDur(beats: number): string {
  let best = "q";
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const [b, d] of VEX_DURS) {
    const diff = Math.abs(beats - b);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = d;
    }
  }
  return best;
}

function vexDurToBeats(dur: string): number {
  const base = dur.endsWith("r") ? dur.slice(0, -1) : dur;
  for (const [b, d] of VEX_DURS) {
    if (d === base) {
      return b;
    }
  }
  return 1;
}

// Decompose a beat count into a sequence of rest duration strings (largest-first greedy)
function splitRests(beats: number): string[] {
  const result: string[] = [];
  let rem = beats;
  for (const [b, d] of VEX_DURS) {
    while (rem >= b - 0.005) {
      result.push(`${d}r`);
      rem -= b;
    }
  }
  return result;
}

// --- Measure building ---

interface TrackNote {
  midi: number;
  startBeats: number; // in quarter-note beats, absolute
  durationBeats: number; // in quarter-note beats
}

interface Tickable {
  keys: string[];
  duration: string;
  accs: Array<string | null>;
}

/**
 * Convert a list of notes within a measure into a flat sequence of VexFlow
 * tickables (notes and rests) that fill exactly beatsPerMeasure quarter-note beats.
 *
 * Notes are snapped to a 16th-note grid. Notes starting at the same grid
 * position are combined into a chord; the longest duration wins. Gaps between
 * notes (and at the start/end of the measure) are filled with rests.
 */
function buildMeasureTickables(
  notes: TrackNote[],
  measureStart: number,
  beatsPerMeasure: number,
): Tickable[] {
  // Group by 16th-note-snapped position relative to measure start
  const byPos = new Map<number, { midis: number[]; durBeats: number }>();
  for (const note of notes) {
    const rel = Math.round((note.startBeats - measureStart) * 4) / 4;
    if (rel < 0 || rel >= beatsPerMeasure) {
      continue;
    }
    const clampedDur = Math.min(
      Math.max(0.25, Math.round(note.durationBeats * 4) / 4),
      beatsPerMeasure - rel,
    );
    const existing = byPos.get(rel);
    if (existing) {
      existing.midis.push(note.midi);
      if (clampedDur > existing.durBeats) {
        existing.durBeats = clampedDur;
      }
    } else {
      byPos.set(rel, { midis: [note.midi], durBeats: clampedDur });
    }
  }

  const positions = Array.from(byPos.keys()).sort((a, b) => a - b);
  const result: Tickable[] = [];
  let cursor = 0; // quarter-note beats from measure start

  for (const pos of positions) {
    if (pos < cursor - 0.005) {
      continue; // overlapped by previous note; skip
    }
    if (pos > cursor + 0.005) {
      for (const d of splitRests(pos - cursor)) {
        result.push({ keys: ["b/4"], duration: d, accs: [] });
      }
    }

    const slot = byPos.get(pos);
    if (!slot) {
      continue;
    }
    const { midis, durBeats } = slot;
    const sorted = midis.sort((a, b) => a - b);
    const dur = nearestVexDur(durBeats);

    result.push({
      keys: sorted.map(midiToKey),
      duration: dur,
      accs: sorted.map((m) => (SHARP_SEMITONES.has(m % 12) ? "#" : null)),
    });

    cursor = pos + vexDurToBeats(dur);
  }

  // Fill any remaining beats at the end of the measure with rests
  if (cursor < beatsPerMeasure - 0.005) {
    for (const d of splitRests(beatsPerMeasure - cursor)) {
      result.push({ keys: ["b/4"], duration: d, accs: [] });
    }
  }

  return result;
}

// --- Note table ---

interface TrackTableEvent {
  measure: number; // 1-indexed
  beat: number; // 1-indexed decimal from measure start (e.g. 1, 1.5, 2.75)
  noteNames: string[]; // ["C4", "D#4"] — empty for rests
  duration: string; // human-readable
  isRest: boolean;
}

/**
 * Produce a human-readable sequence of note and rest events for one track,
 * using the same 16th-note quantisation and measure grouping as
 * buildMeasureTickables so the table matches what is drawn on the staff.
 */
function buildTrackTableEvents(
  notes: TrackNote[],
  beatsPerMeasure: number,
  numMeasures: number,
): TrackTableEvent[] {
  const result: TrackTableEvent[] = [];

  for (let m = 0; m < numMeasures; m++) {
    const measureStart = m * beatsPerMeasure;

    const byPos = new Map<number, { midis: number[]; durBeats: number }>();
    for (const note of notes) {
      const rel = Math.round((note.startBeats - measureStart) * 4) / 4;
      if (rel < 0 || rel >= beatsPerMeasure) {
        continue;
      }
      const clampedDur = Math.min(
        Math.max(0.25, Math.round(note.durationBeats * 4) / 4),
        beatsPerMeasure - rel,
      );
      const existing = byPos.get(rel);
      if (existing) {
        existing.midis.push(note.midi);
        if (clampedDur > existing.durBeats) {
          existing.durBeats = clampedDur;
        }
      } else {
        byPos.set(rel, { midis: [note.midi], durBeats: clampedDur });
      }
    }

    const positions = Array.from(byPos.keys()).sort((a, b) => a - b);
    let cursor = 0;

    for (const pos of positions) {
      if (pos < cursor - 0.005) {
        continue;
      }
      if (pos > cursor + 0.005) {
        let restCursor = cursor;
        for (const restDur of splitRests(pos - cursor)) {
          const durKey = restDur.slice(0, -1);
          result.push({
            measure: m + 1,
            beat: Number((restCursor + 1).toFixed(4)),
            noteNames: [],
            duration: VEX_DUR_LABELS[durKey] ?? durKey,
            isRest: true,
          });
          restCursor += vexDurToBeats(restDur);
        }
      }

      const slot = byPos.get(pos);
      if (!slot) {
        continue;
      }
      const { midis, durBeats } = slot;
      const dur = nearestVexDur(durBeats);
      result.push({
        measure: m + 1,
        beat: Number((pos + 1).toFixed(4)),
        noteNames: midis.sort((a, b) => a - b).map(midiToName),
        duration: VEX_DUR_LABELS[dur] ?? dur,
        isRest: false,
      });
      cursor = pos + vexDurToBeats(dur);
    }

    if (cursor < beatsPerMeasure - 0.005) {
      let restCursor = cursor;
      for (const restDur of splitRests(beatsPerMeasure - cursor)) {
        const durKey = restDur.slice(0, -1);
        result.push({
          measure: m + 1,
          beat: Number((restCursor + 1).toFixed(4)),
          noteNames: [],
          duration: VEX_DUR_LABELS[durKey] ?? durKey,
          isRest: true,
        });
        restCursor += vexDurToBeats(restDur);
      }
    }
  }

  return result;
}

// --- Layout constants ---

const FIRST_MEASURE_W = 220; // wider to fit clef + time sig
const MEASURE_W = 180;
const ROW_H = 120; // vertical space per track row
const SVG_TOP = 20;
const SVG_LEFT = 10;

// --- Component ---

export function SheetMusic({ midi }: { midi: Midi }) {
  const containerRef = useRef<HTMLDivElement>(null);

  const tracksWithNotes = midi.tracks
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => track.notes.length > 0);

  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(tracksWithNotes.map(({ index }) => index)),
  );

  const [tableData, setTableData] = useState<
    Array<{ trackName: string; events: TrackTableEvent[] }>
  >([]);

  function toggle(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    el.innerHTML = "";

    const ppq = midi.header.ppq;
    const [sigNum, sigDen] = midi.header.timeSignatures[0]?.timeSignature ?? [
      4, 4,
    ];
    // Ticks per measure, generalised for any time signature (e.g. 6/8 → 3 quarter-note beats)
    const ticksPerMeasure = Math.round((sigNum / sigDen) * 4 * ppq);
    const beatsPerMeasure = ticksPerMeasure / ppq; // in quarter-note beats
    const sixteenth = ppq / 4;

    const activeIndices = midi.tracks
      .map((track, index) => ({ track, index }))
      .filter(
        ({ track, index }) => track.notes.length > 0 && selected.has(index),
      )
      .map(({ index }) => index);

    if (!activeIndices.length) {
      setTableData([]);
      return;
    }

    let maxTick = 0;
    for (const idx of activeIndices) {
      for (const note of midi.tracks[idx].notes) {
        const end = note.ticks + note.durationTicks;
        if (end > maxTick) {
          maxTick = end;
        }
      }
    }
    if (!maxTick) {
      return;
    }

    const numMeasures = Math.ceil(maxTick / ticksPerMeasure);
    const newTableData: Array<{
      trackName: string;
      events: TrackTableEvent[];
    }> = [];

    const svgW =
      SVG_LEFT +
      FIRST_MEASURE_W +
      Math.max(0, numMeasures - 1) * MEASURE_W +
      20;
    const svgH = SVG_TOP + activeIndices.length * ROW_H + 20;

    const renderer = new Renderer(el, Renderer.Backends.SVG);
    renderer.resize(svgW, svgH);
    const ctx = renderer.getContext();

    for (let row = 0; row < activeIndices.length; row++) {
      const idx = activeIndices[row];
      const track = midi.tracks[idx];

      // Quantize all notes to the 16th-note grid
      const notes: TrackNote[] = track.notes.map((n) => ({
        midi: n.midi,
        startBeats: (Math.round(n.ticks / sixteenth) * sixteenth) / ppq,
        durationBeats: Math.max(
          0.25,
          (Math.round(n.durationTicks / sixteenth) * sixteenth) / ppq,
        ),
      }));

      newTableData.push({
        trackName: track.name || `Track ${idx + 1}`,
        events: buildTrackTableEvents(notes, beatsPerMeasure, numMeasures),
      });

      const clef = getClef(notes);
      const staveY = SVG_TOP + row * ROW_H;

      for (let m = 0; m < numMeasures; m++) {
        const measureStart = m * beatsPerMeasure;
        const staveX =
          SVG_LEFT + (m === 0 ? 0 : FIRST_MEASURE_W + (m - 1) * MEASURE_W);
        const staveW = m === 0 ? FIRST_MEASURE_W : MEASURE_W;

        const stave = new Stave(staveX, staveY, staveW);
        if (m === 0) {
          stave.addClef(clef);
          stave.addTimeSignature(`${sigNum}/${sigDen}`);
        }
        stave.setContext(ctx).draw();

        const measureNotes = notes.filter(
          (n) =>
            n.startBeats >= measureStart &&
            n.startBeats < measureStart + beatsPerMeasure,
        );

        const tickables = buildMeasureTickables(
          measureNotes,
          measureStart,
          beatsPerMeasure,
        );
        if (!tickables.length) {
          continue;
        }

        try {
          const staveNotes = tickables.map(({ keys, duration, accs }) => {
            const sn = new StaveNote({ keys, duration });
            accs.forEach((acc, i) => {
              if (acc) {
                sn.addModifier(new Accidental(acc), i);
              }
            });
            return sn;
          });

          const voice = new Voice({
            numBeats: sigNum,
            beatValue: sigDen,
          }).setStrict(false);
          voice.addTickables(staveNotes);
          new Formatter().joinVoices([voice]).format([voice], staveW - 30);
          voice.draw(ctx, stave);
        } catch (err) {
          console.warn(
            `SheetMusic: render error measure ${m} track ${idx}:`,
            err,
          );
        }
      }
    }
    setTableData(newTableData);
  }, [midi, selected]);

  return (
    <div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "12px",
          marginBottom: "8px",
        }}
      >
        {tracksWithNotes.map(({ track, index }) => (
          <label
            key={index}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={selected.has(index)}
              onChange={() => toggle(index)}
            />
            {track.name || `Track ${index + 1}`}
          </label>
        ))}
      </div>
      <div
        ref={containerRef}
        style={{
          overflowX: "auto",
          border: "1px solid #ddd",
          borderRadius: "4px",
        }}
      />
      {tableData.length > 0 && (
        <details style={{ marginTop: "12px" }}>
          <summary style={{ cursor: "pointer" }}>Note data</summary>
          {tableData.map(({ trackName, events }) => (
            <div key={trackName}>
              <h4 style={{ margin: "8px 0 4px" }}>{trackName}</h4>
              <table
                style={{
                  borderCollapse: "collapse",
                  fontSize: "13px",
                  marginBottom: "12px",
                }}
              >
                <thead>
                  <tr>
                    {["Measure", "Beat", "Note(s)", "Duration"].map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: "left",
                          padding: "2px 12px 2px 0",
                          borderBottom: "1px solid #ccc",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev) => (
                    <tr
                      key={`${ev.measure}-${ev.beat}-${ev.isRest ? "r" : ev.noteNames.join("_")}`}
                      style={{ opacity: ev.isRest ? 0.4 : 1 }}
                    >
                      <td style={{ padding: "1px 12px 1px 0" }}>
                        {ev.measure}
                      </td>
                      <td style={{ padding: "1px 12px 1px 0" }}>{ev.beat}</td>
                      <td style={{ padding: "1px 12px 1px 0" }}>
                        {ev.isRest ? "rest" : ev.noteNames.join(", ")}
                      </td>
                      <td style={{ padding: "1px 12px 1px 0" }}>
                        {ev.duration}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
