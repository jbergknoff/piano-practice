interface RawNote {
  midi: number;
  ticks: number;
  durationTicks: number;
}

// ─── Duration table ───────────────────────────────────────────────────────────

export interface MusicalDuration {
  vex: string;
  ticksFn: (ppq: number) => number;
}

// Ordered largest → smallest; drives both nearestMusicalDuration and greedyDecompose.
export const MUSICAL_DURATIONS: MusicalDuration[] = [
  { vex: "w", ticksFn: (p) => p * 4 },
  { vex: "hd", ticksFn: (p) => p * 3 },
  { vex: "h", ticksFn: (p) => p * 2 },
  { vex: "qd", ticksFn: (p) => Math.round((p * 3) / 2) },
  { vex: "q", ticksFn: (p) => p },
  { vex: "8d", ticksFn: (p) => Math.round((p * 3) / 4) },
  { vex: "8", ticksFn: (p) => Math.round(p / 2) },
  { vex: "16d", ticksFn: (p) => Math.round((p * 3) / 8) },
  { vex: "16", ticksFn: (p) => Math.round(p / 4) },
  { vex: "32", ticksFn: (p) => Math.round(p / 8) },
];

export function nearestMusicalDuration(
  ticks: number,
  ppq: number,
): MusicalDuration {
  let best = MUSICAL_DURATIONS[MUSICAL_DURATIONS.length - 1];
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const d of MUSICAL_DURATIONS) {
    const dt = d.ticksFn(ppq);
    const diff = Math.abs(ticks - dt);
    if (diff < bestDiff || (diff === bestDiff && dt < best.ticksFn(ppq))) {
      bestDiff = diff;
      best = d;
    }
  }
  return best;
}

export function musicalDurToTicks(vex: string, ppq: number): number {
  const d = MUSICAL_DURATIONS.find((d) => d.vex === vex);
  return d ? d.ticksFn(ppq) : ppq;
}

// Greedy largest-first decomposition of a tick count into vex duration strings.
export function greedyDecompose(ticks: number, ppq: number): string[] {
  const result: string[] = [];
  let rem = ticks;
  for (const d of MUSICAL_DURATIONS) {
    const dt = d.ticksFn(ppq);
    while (rem >= dt) {
      result.push(d.vex);
      rem -= dt;
    }
    if (rem <= 0) {
      break;
    }
  }
  return result.length > 0 ? result : ["32"];
}

export function splitRests(ticks: number, ppq: number): string[] {
  return greedyDecompose(ticks, ppq);
}

export function longestVex(vexList: string[], ppq: number): string {
  let best = vexList[0];
  let bestTicks = 0;
  for (const vex of vexList) {
    const t = musicalDurToTicks(vex, ppq);
    if (t > bestTicks) {
      bestTicks = t;
      best = vex;
    }
  }
  return best;
}

// ─── Pitch names ──────────────────────────────────────────────────────────────

export const SHARP_NAMES = [
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
export const FLAT_NAMES = [
  "c",
  "db",
  "d",
  "eb",
  "e",
  "f",
  "gb",
  "g",
  "ab",
  "a",
  "bb",
  "b",
];
export const SHARP_NAMES_DISPLAY = [
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
export const FLAT_NAMES_DISPLAY = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
];
export const FLAT_KEYS = new Set(["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F"]);

export function midiToKey(midiNote: number, pitchNames: string[]): string {
  return `${pitchNames[midiNote % 12]}/${Math.floor(midiNote / 12) - 1}`;
}

export function midiToName(midiNote: number, displayNames: string[]): string {
  return `${displayNames[midiNote % 12]}${Math.floor(midiNote / 12) - 1}`;
}

export function getClef(midiValues: number[]): "treble" | "bass" {
  if (!midiValues.length) {
    return "treble";
  }
  const avg = midiValues.reduce((s, n) => s + n, 0) / midiValues.length;
  return avg < 60 ? "bass" : "treble";
}

export const VEX_DUR_LABELS: Record<string, string> = {
  w: "whole",
  hd: "dotted half",
  h: "half",
  qd: "dotted quarter",
  q: "quarter",
  "8d": "dotted eighth",
  "8": "eighth",
  "16d": "dotted sixteenth",
  "16": "sixteenth",
  "32": "thirty-second",
};

// ─── Note segments ────────────────────────────────────────────────────────────

export interface NoteSegment {
  midi: number;
  measureIndex: number;
  offsetTicks: number; // ticks from start of measure
  vex: string; // single VexFlow base duration string
  tieBackward: boolean;
  tieForward: boolean;
}

export function buildNoteSegments(
  rawNotes: RawNote[],
  ppq: number,
  ticksPerMeasure: number,
  numMeasures: number,
): NoteSegment[] {
  const grid = Math.max(1, Math.round(ppq / 8)); // 32nd-note grid
  const result: NoteSegment[] = [];

  for (const note of rawNotes) {
    const startTick = Math.round(note.ticks / grid) * grid;
    const classifiedDur = nearestMusicalDuration(note.durationTicks, ppq);
    const totalDurTicks = Math.max(grid, classifiedDur.ticksFn(ppq));

    let currentTick = startTick;
    let remainingTicks = totalDurTicks;
    let isFirstSegment = true;

    while (remainingTicks > 0) {
      const measureIndex = Math.floor(currentTick / ticksPerMeasure);
      if (measureIndex >= numMeasures) {
        break;
      }

      const measureEndTick = (measureIndex + 1) * ticksPerMeasure;
      const spaceInMeasure = measureEndTick - currentTick;
      const segmentTicks = Math.min(remainingTicks, spaceInMeasure);
      if (segmentTicks <= 0) {
        break;
      }

      const subDurations = greedyDecompose(segmentTicks, ppq);
      let subCurrentTick = currentTick;

      for (let i = 0; i < subDurations.length; i++) {
        const vex = subDurations[i];
        const subDurTicks = musicalDurToTicks(vex, ppq);
        const isFirstSub = i === 0;
        const isLastSub = i === subDurations.length - 1;

        result.push({
          midi: note.midi,
          measureIndex,
          offsetTicks: subCurrentTick - measureIndex * ticksPerMeasure,
          vex,
          tieBackward: !isFirstSegment || !isFirstSub,
          tieForward: remainingTicks > segmentTicks || !isLastSub,
        });

        subCurrentTick += subDurTicks;
      }

      currentTick += segmentTicks;
      remainingTicks -= segmentTicks;
      isFirstSegment = false;
    }
  }

  return result;
}

// ─── Note table ───────────────────────────────────────────────────────────────

export interface TrackTableEvent {
  measure: number;
  beat: number;
  noteNames: string[];
  duration: string;
  isRest: boolean;
}

export function buildTrackTableEvents(
  segments: NoteSegment[],
  ppq: number,
  ticksPerMeasure: number,
  numMeasures: number,
  displayNames: string[],
): TrackTableEvent[] {
  const result: TrackTableEvent[] = [];

  for (let m = 0; m < numMeasures; m++) {
    const measureSegs = segments.filter((s) => s.measureIndex === m);

    const byOffset = new Map<number, NoteSegment[]>();
    for (const seg of measureSegs) {
      const list = byOffset.get(seg.offsetTicks) ?? [];
      list.push(seg);
      byOffset.set(seg.offsetTicks, list);
    }

    const offsets = Array.from(byOffset.keys()).sort((a, b) => a - b);
    let cursor = 0;

    for (const offset of offsets) {
      if (offset < cursor) {
        continue;
      }
      if (offset > cursor) {
        for (const vex of splitRests(offset - cursor, ppq)) {
          result.push({
            measure: m + 1,
            beat: Number((cursor / ppq + 1).toFixed(4)),
            noteNames: [],
            duration: VEX_DUR_LABELS[vex] ?? vex,
            isRest: true,
          });
          cursor += musicalDurToTicks(vex, ppq);
        }
      }

      const segs = byOffset.get(offset) ?? [];
      const midis = [...new Set(segs.map((s) => s.midi))].sort((a, b) => a - b);
      const vex = longestVex(
        segs.map((s) => s.vex),
        ppq,
      );

      result.push({
        measure: m + 1,
        beat: Number((offset / ppq + 1).toFixed(4)),
        noteNames: midis.map((midi) => midiToName(midi, displayNames)),
        duration: VEX_DUR_LABELS[vex] ?? vex,
        isRest: false,
      });
      cursor = offset + musicalDurToTicks(vex, ppq);
    }

    if (cursor < ticksPerMeasure) {
      for (const vex of splitRests(ticksPerMeasure - cursor, ppq)) {
        result.push({
          measure: m + 1,
          beat: Number((cursor / ppq + 1).toFixed(4)),
          noteNames: [],
          duration: VEX_DUR_LABELS[vex] ?? vex,
          isRest: true,
        });
        cursor += musicalDurToTicks(vex, ppq);
      }
    }
  }

  return result;
}
