import type { Midi } from "@tonejs/midi";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  Accidental,
  Beam,
  Formatter,
  Renderer,
  Stave,
  StaveNote,
  StaveTie,
  Voice,
} from "vexflow";
import {
  FLAT_KEYS,
  FLAT_NAMES,
  FLAT_NAMES_DISPLAY,
  type NoteSegment,
  SHARP_NAMES,
  SHARP_NAMES_DISPLAY,
  type TrackTableEvent,
  buildNoteSegments,
  buildTrackTableEvents,
  getClef,
  longestVex,
  midiToKey,
  musicalDurToTicks,
  splitRests,
} from "./music-utils";

// ─── StaveNote with tie metadata ──────────────────────────────────────────────

interface StaveNoteInfo {
  note: StaveNote;
  tieBackward: boolean;
  tieForward: boolean;
  midis: number[];
}

const MEASURE_W = 180;
const ROW_H = 120;
const SVG_TOP = 20;
const SVG_LEFT = 10;

// ─── Component ────────────────────────────────────────────────────────────────

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
    const ticksPerMeasure = Math.round((sigNum / sigDen) * 4 * ppq);

    const keySpec = midi.header.keySignatures[0]?.key ?? "C";
    const useFlats = FLAT_KEYS.has(keySpec);
    const pitchNames = useFlats ? FLAT_NAMES : SHARP_NAMES;
    const displayNames = useFlats ? FLAT_NAMES_DISPLAY : SHARP_NAMES_DISPLAY;

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

    const allTrackData = activeIndices.map((idx) => {
      const track = midi.tracks[idx];
      const segments = buildNoteSegments(
        track.notes,
        ppq,
        ticksPerMeasure,
        numMeasures,
      );
      const clef = getClef(track.notes.map((n) => n.midi));
      return { segments, clef, trackName: track.name || `Track ${idx + 1}` };
    });

    setTableData(
      allTrackData.map(({ segments, trackName }) => ({
        trackName,
        events: buildTrackTableEvents(
          segments,
          ppq,
          ticksPerMeasure,
          numMeasures,
          displayNames,
        ),
      })),
    );

    // Measure first-measure modifier width (clef + key sig + time sig).
    const tmpEl = document.createElement("div");
    const tmpRenderer = new Renderer(tmpEl, Renderer.Backends.SVG);
    tmpRenderer.resize(600, allTrackData.length * 100);
    const tmpCtx = tmpRenderer.getContext();
    let maxModifierW = 0;
    for (const [i, { clef }] of allTrackData.entries()) {
      const tmpStave = new Stave(0, i * 100, 400);
      tmpStave.addClef(clef);
      if (keySpec !== "C") {
        tmpStave.addKeySignature(keySpec);
      }
      tmpStave.addTimeSignature(`${sigNum}/${sigDen}`);
      tmpStave.setContext(tmpCtx).draw();
      const w = tmpStave.getNoteStartX();
      if (w > maxModifierW) {
        maxModifierW = w;
      }
    }
    const firstMeasureW = maxModifierW + MEASURE_W;

    const svgW =
      SVG_LEFT + firstMeasureW + Math.max(0, numMeasures - 1) * MEASURE_W + 20;
    const svgH = SVG_TOP + activeIndices.length * ROW_H + 20;

    const renderer = new Renderer(el, Renderer.Backends.SVG);
    renderer.resize(svgW, svgH);
    const ctx = renderer.getContext();

    // One pending-tie map per track row; persists across the measure loop so
    // cross-barline ties can be drawn in the measure after the one where the
    // note starts.
    const pendingTieMaps: Map<
      number,
      { note: StaveNote; noteIndex: number }
    >[] = allTrackData.map(() => new Map());

    for (let m = 0; m < numMeasures; m++) {
      const staveW = m === 0 ? firstMeasureW : MEASURE_W;
      const staveX =
        SVG_LEFT + (m === 0 ? 0 : firstMeasureW + (m - 1) * MEASURE_W);

      const measureStaves: Stave[] = [];
      const measureVoices: Array<Voice | null> = [];
      const allBeams: Beam[] = [];
      const allTies: StaveTie[] = [];

      for (let row = 0; row < allTrackData.length; row++) {
        const { segments, clef } = allTrackData[row];
        const pendingTies = pendingTieMaps[row];
        const staveY = SVG_TOP + row * ROW_H;

        const stave = new Stave(staveX, staveY, staveW);
        if (m === 0) {
          stave.addClef(clef);
          if (keySpec !== "C") {
            stave.addKeySignature(keySpec);
          }
          stave.addTimeSignature(`${sigNum}/${sigDen}`);
        }
        stave.setContext(ctx).draw();
        measureStaves.push(stave);

        const measureSegs = segments.filter((s) => s.measureIndex === m);

        const byOffset = new Map<number, NoteSegment[]>();
        for (const seg of measureSegs) {
          const list = byOffset.get(seg.offsetTicks) ?? [];
          list.push(seg);
          byOffset.set(seg.offsetTicks, list);
        }

        const offsets = Array.from(byOffset.keys()).sort((a, b) => a - b);
        let cursor = 0;
        const noteInfos: StaveNoteInfo[] = [];

        for (const offset of offsets) {
          if (offset < cursor) {
            continue; // overlapped by a longer note
          }
          if (offset > cursor) {
            for (const vex of splitRests(offset - cursor, ppq)) {
              noteInfos.push({
                note: new StaveNote({
                  keys: ["b/4"],
                  duration: `${vex}r`,
                  clef,
                }),
                tieBackward: false,
                tieForward: false,
                midis: [],
              });
              cursor += musicalDurToTicks(vex, ppq);
            }
          }

          const segs = byOffset.get(offset) ?? [];
          const midis = [...new Set(segs.map((s) => s.midi))].sort(
            (a, b) => a - b,
          );
          const tieBackward = segs.some((s) => s.tieBackward);
          const vex = longestVex(
            segs.map((s) => s.vex),
            ppq,
          );
          const durTicks = musicalDurToTicks(vex, ppq);
          const tieForward = segs.some((s) => s.tieForward && s.vex === vex);

          const keys = midis.map((midi) => midiToKey(midi, pitchNames));
          const sn = new StaveNote({ keys, duration: vex, clef });
          noteInfos.push({ note: sn, tieBackward, tieForward, midis });
          cursor = offset + durTicks;
        }

        // Fill remaining measure space with rests.
        if (cursor < ticksPerMeasure) {
          for (const vex of splitRests(ticksPerMeasure - cursor, ppq)) {
            noteInfos.push({
              note: new StaveNote({ keys: ["b/4"], duration: `${vex}r`, clef }),
              tieBackward: false,
              tieForward: false,
              midis: [],
            });
            cursor += musicalDurToTicks(vex, ppq);
          }
        }

        if (!noteInfos.length) {
          measureVoices.push(null);
          continue;
        }

        const staveNotes = noteInfos.map((i) => i.note);
        const voice = new Voice({
          numBeats: sigNum,
          beatValue: sigDen,
        }).setStrict(false);
        voice.addTickables(staveNotes);
        measureVoices.push(voice);

        // Build StaveTie objects and update the pending-tie map.
        for (const info of noteInfos) {
          if (!info.midis.length) {
            continue;
          }

          if (info.tieBackward) {
            // Group by source StaveNote so that notes from the same previous
            // chord share one StaveTie object (which draws multiple curves).
            const groups = new Map<
              StaveNote,
              { firstIndexes: number[]; lastIndexes: number[] }
            >();
            for (let i = 0; i < info.midis.length; i++) {
              const pending = pendingTies.get(info.midis[i]);
              if (pending) {
                const g = groups.get(pending.note) ?? {
                  firstIndexes: [],
                  lastIndexes: [],
                };
                g.firstIndexes.push(pending.noteIndex);
                g.lastIndexes.push(i);
                groups.set(pending.note, g);
              }
            }
            for (const [firstNote, { firstIndexes, lastIndexes }] of groups) {
              allTies.push(
                new StaveTie({
                  firstNote,
                  lastNote: info.note,
                  firstIndexes,
                  lastIndexes,
                }),
              );
            }
          }

          for (let i = 0; i < info.midis.length; i++) {
            const midi = info.midis[i];
            if (info.tieForward) {
              pendingTies.set(midi, { note: info.note, noteIndex: i });
            } else {
              pendingTies.delete(midi);
            }
          }
        }

        const beams = Beam.generateBeams(staveNotes);
        allBeams.push(...beams);
      }

      const voices = measureVoices.filter((v): v is Voice => v !== null);
      if (!voices.length) {
        continue;
      }

      try {
        // applyAccidentals MUST come before formatter.format so the formatter
        // can account for accidental glyph widths when spacing notes.
        Accidental.applyAccidentals(voices, keySpec);

        const formatter = new Formatter();
        formatter.joinVoices(voices);
        const noteAreaW =
          measureStaves[0].getNoteEndX() - measureStaves[0].getNoteStartX();
        formatter.format(voices, noteAreaW - 10);

        for (let row = 0; row < allTrackData.length; row++) {
          const v = measureVoices[row];
          if (v) {
            v.draw(ctx, measureStaves[row]);
          }
        }
        for (const beam of allBeams) {
          beam.setContext(ctx).draw();
        }
        for (const tie of allTies) {
          tie.setContext(ctx).draw();
        }
      } catch (err) {
        console.warn(`SheetMusic: render error measure ${m}:`, err);
      }
    }
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
          <div
            style={{
              display: "flex",
              gap: "24px",
              overflowX: "auto",
              alignItems: "flex-start",
              marginTop: "4px",
            }}
          >
            {tableData.map(({ trackName, events }) => (
              <div key={trackName} style={{ flexShrink: 0 }}>
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
          </div>
        </details>
      )}
      <details style={{ marginTop: "8px" }}>
        <summary style={{ cursor: "pointer" }}>Raw MIDI data</summary>
        <p style={{ margin: "6px 0", fontSize: "13px" }}>
          PPQ: {midi.header.ppq}
          {midi.header.tempos[0]
            ? ` · BPM: ${midi.header.tempos[0].bpm.toFixed(1)}`
            : ""}
          {midi.header.timeSignatures[0]
            ? ` · Time: ${midi.header.timeSignatures[0].timeSignature.join("/")}`
            : ""}
          {midi.header.keySignatures[0]
            ? ` · Key: ${midi.header.keySignatures[0].key} ${midi.header.keySignatures[0].scale}`
            : ""}
        </p>
        <div
          style={{
            display: "flex",
            gap: "24px",
            overflowX: "auto",
            alignItems: "flex-start",
            marginTop: "4px",
          }}
        >
          {midi.tracks
            .map((track, index) => ({ track, index }))
            .filter(({ track }) => track.notes.length > 0)
            .map(({ track, index }) => (
              <div key={index} style={{ flexShrink: 0 }}>
                <h4 style={{ margin: "8px 0 4px" }}>
                  {track.name || `Track ${index + 1}`} (ch.&nbsp;{track.channel}
                  )
                </h4>
                <table style={{ borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr>
                      {[
                        "Note",
                        "MIDI",
                        "Start (ticks)",
                        "Dur (ticks)",
                        "Vel",
                      ].map((h) => (
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
                    {track.notes.map((n) => (
                      <tr key={`${n.ticks}-${n.midi}-${n.durationTicks}`}>
                        <td style={{ padding: "1px 12px 1px 0" }}>{n.name}</td>
                        <td style={{ padding: "1px 12px 1px 0" }}>{n.midi}</td>
                        <td style={{ padding: "1px 12px 1px 0" }}>{n.ticks}</td>
                        <td style={{ padding: "1px 12px 1px 0" }}>
                          {n.durationTicks}
                        </td>
                        <td style={{ padding: "1px 12px 1px 0" }}>
                          {Math.round(n.velocity * 127)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
        </div>
      </details>
    </div>
  );
}
