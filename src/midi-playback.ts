import type { MidiData } from "midi-file";

export interface ScheduledNote {
  time: number; // seconds from start of piece
  note: number; // MIDI note number
  duration: number; // seconds
  velocity: number; // 0-127
}

export function getTempo(midiData: MidiData): number {
  for (const track of midiData.tracks) {
    for (const ev of track) {
      if (ev.type === "setTempo") {
        return ev.microsecondsPerBeat;
      }
    }
  }
  return 500000; // default: 120 BPM
}

export function buildNoteSchedule(
  midiData: MidiData,
  trackIndices: number[],
): ScheduledNote[] {
  const tpb = midiData.header.ticksPerBeat ?? 480;
  const secondsPerTick = getTempo(midiData) / 1_000_000 / tpb;

  const notes: ScheduledNote[] = [];

  for (const idx of trackIndices) {
    const track = midiData.tracks[idx];
    if (!track) continue;

    let tick = 0;
    const active = new Map<number, { startTick: number; velocity: number }>();

    for (const ev of track) {
      tick += ev.deltaTime;
      if (ev.type === "noteOn" && ev.velocity > 0) {
        active.set(ev.noteNumber, { startTick: tick, velocity: ev.velocity });
      } else if (
        ev.type === "noteOff" ||
        (ev.type === "noteOn" && ev.velocity === 0)
      ) {
        const a = active.get(ev.noteNumber);
        if (a) {
          notes.push({
            time: a.startTick * secondsPerTick,
            note: ev.noteNumber,
            duration: Math.max(0.05, (tick - a.startTick) * secondsPerTick),
            velocity: a.velocity,
          });
          active.delete(ev.noteNumber);
        }
      }
    }
  }

  return notes.sort((a, b) => a.time - b.time);
}
