/**
 * Generates tests/fixtures/simple-grand-piano.mid — a synthetic 8-measure
 * grand-piano piece in 3/4, C major, 120 BPM.  Run once with:
 *
 *   bun tests/fixtures/generate-simple-grand-piano-mid.ts
 *
 * The resulting MIDI exercises:
 *   - Two tracks (treble + bass) → two staves after conversion
 *   - 3/4 time, C major
 *   - Short bass notes (≤50% of beat slot) → detected as staccato
 *   - F#4 followed by F♮4 in the same measure → natural accidental
 *   - Eighth-note runs → split into per-beat beam groups by groupBeamableEvents
 */

import { writeFileSync } from "node:fs";
import { writeMidi } from "midi-file";

const TPB = 480; // ticks per beat
const TEMPO = 500_000; // µs/beat = 120 BPM
const MLEN = TPB * 3; // ticks per 3/4 measure = 1440
const Q = TPB; // quarter note = 480 ticks
const E = TPB / 2; // eighth note  = 240 ticks
const CH_T = 0; // treble channel
const CH_B = 1; // bass channel
const VEL = 64;

// Helper: produce [noteOn delta, noteOff delta] events for a single note.
// `start` and `dur` are absolute ticks; `prevAbsolute` is the last event tick.
function note(
  channel: number,
  pitch: number,
  start: number,
  dur: number,
  prevAbsolute: number,
): [
  {
    type: "noteOn";
    channel: number;
    noteNumber: number;
    velocity: number;
    delta: number;
  },
  {
    type: "noteOff";
    channel: number;
    noteNumber: number;
    velocity: number;
    delta: number;
  },
  number,
] {
  const onDelta = start - prevAbsolute;
  const offDelta = dur;
  return [
    {
      type: "noteOn",
      channel,
      noteNumber: pitch,
      velocity: VEL,
      delta: onDelta,
    },
    {
      type: "noteOff",
      channel,
      noteNumber: pitch,
      velocity: 0,
      delta: offDelta,
    },
    start + dur,
  ];
}

// Build absolute-tick note list, then sort and convert to delta events.
type AbsNote = { channel: number; pitch: number; tick: number; dur: number };

function buildTrack(notes: AbsNote[], isFirst: boolean): object[] {
  // Expand into [on, off] pairs with absolute ticks.
  const pairs: Array<{
    tick: number;
    type: "on" | "off";
    channel: number;
    pitch: number;
  }> = [];
  for (const n of notes) {
    pairs.push({
      tick: n.tick,
      type: "on",
      channel: n.channel,
      pitch: n.pitch,
    });
    pairs.push({
      tick: n.tick + n.dur,
      type: "off",
      channel: n.channel,
      pitch: n.pitch,
    });
  }
  pairs.sort((a, b) => a.tick - b.tick || (a.type === "off" ? -1 : 1));

  const events: object[] = [];

  if (isFirst) {
    events.push({
      type: "timeSignature",
      deltaTime: 0,
      numerator: 3,
      denominator: 4,
      metronome: 24,
      thirtyseconds: 8,
    });
    events.push({ type: "setTempo", deltaTime: 0, microsecondsPerBeat: TEMPO });
    events.push({ type: "trackName", deltaTime: 0, text: "Piano" });
  }

  let cursor = 0;
  for (const p of pairs) {
    const deltaTime = p.tick - cursor;
    cursor = p.tick;
    if (p.type === "on") {
      events.push({
        type: "noteOn",
        deltaTime,
        channel: p.channel,
        noteNumber: p.pitch,
        velocity: VEL,
      });
    } else {
      events.push({
        type: "noteOff",
        deltaTime,
        channel: p.channel,
        noteNumber: p.pitch,
        velocity: 0,
      });
    }
  }
  events.push({ type: "endOfTrack", deltaTime: 0 });
  return events;
}

// Normal note duration (just under full beat to avoid unintended ties).
const QNORM = Q - 20; // 460
const ENORM = E - 10; // 230
// Staccato duration: strictly ≤ 50% of the display slot.
const QSTAC = Math.floor(Q * 0.4); // 192 — clearly staccato
const ESTAC = Math.floor(E * 0.4); // 96

const treble: AbsNote[] = [];
const bass: AbsNote[] = [];

function addTreble(tick: number, pitch: number, dur: number) {
  treble.push({ channel: CH_T, pitch, tick, dur });
}
function addBass(tick: number, pitch: number, dur: number) {
  bass.push({ channel: CH_B, pitch, tick, dur });
}

// ── Measure 1 (tick 0): C5 E5 G5 treble / C3 G2 E3 bass (staccato) ──────────
// Notes on both staves in measure 1 — needed for cursor-highlighting tests.
addTreble(0 * MLEN + 0 * Q, 72, QNORM); // C5
addTreble(0 * MLEN + 1 * Q, 76, QNORM); // E5
addTreble(0 * MLEN + 2 * Q, 79, QNORM); // G5
addBass(0 * MLEN + 0 * Q, 48, QSTAC); // C3 staccato
addBass(0 * MLEN + 1 * Q, 43, QSTAC); // G2 staccato
addBass(0 * MLEN + 2 * Q, 52, QSTAC); // E3 staccato

// ── Measure 2 (tick 1440): 6 eighth notes in treble (→ 3 beam groups) ────────
// G4 A4 | B4 C5 | D5 E5 — each beat-pair forms one beam group.
addTreble(1 * MLEN + 0 * E, 67, ENORM); // G4
addTreble(1 * MLEN + 1 * E, 69, ENORM); // A4
addTreble(1 * MLEN + 2 * E, 71, ENORM); // B4
addTreble(1 * MLEN + 3 * E, 72, ENORM); // C5
addTreble(1 * MLEN + 4 * E, 74, ENORM); // D5
addTreble(1 * MLEN + 5 * E, 76, ENORM); // E5
addBass(1 * MLEN + 0 * Q, 48, QSTAC); // C3 staccato
addBass(1 * MLEN + 1 * Q, 43, QSTAC); // G2 staccato
addBass(1 * MLEN + 2 * Q, 52, QSTAC); // E3 staccato

// ── Measure 3 (tick 2880): D4+B4 staccato chord, then F#4, then F♮4 ─────────
// The staccato chord exercises staccato-chord rendering (one dot per chord).
// F#4 followed by F♮4 in the same measure → natural accidental on F♮4.
addTreble(2 * MLEN + 0 * Q, 62, QSTAC); // D4 } staccato chord
addTreble(2 * MLEN + 0 * Q, 71, QSTAC); // B4 }
addTreble(2 * MLEN + 1 * Q, 66, QNORM); // F#4
addTreble(2 * MLEN + 2 * Q, 65, QNORM); // F♮4 (natural — cancels the F# above)
addBass(2 * MLEN + 0 * Q, 45, QSTAC); // A2 staccato
addBass(2 * MLEN + 1 * Q, 52, QSTAC); // E3 staccato
addBass(2 * MLEN + 2 * Q, 45, QSTAC); // A2 staccato

// ── Measures 4–8: simple filler so all measures are non-empty ─────────────────
const melodyPitches = [72, 71, 69, 67, 69, 71, 72, 72, 72]; // C5 B4 A4…
for (let m = 3; m < 8; m++) {
  for (let b = 0; b < 3; b++) {
    addTreble(
      m * MLEN + b * Q,
      melodyPitches[(m * 3 + b) % melodyPitches.length],
      QNORM,
    );
    addBass(m * MLEN + b * Q, b === 0 ? 48 : 55, QSTAC); // C3 or G3, all staccato
  }
}

const midi = {
  header: { format: 1, numTracks: 2, ticksPerBeat: TPB },
  tracks: [
    buildTrack([...treble, ...bass], true), // track 0: meta + all notes
    buildTrack([], false), // track 1: empty (notes in track 0)
  ],
};

// format=1 with notes all in track 0 is the simplest valid two-track MIDI.
// The converter groups by pitch-range / program to assign staves.
// Alternatively, use two real note tracks:
const midi2 = {
  header: { format: 1, numTracks: 3, ticksPerBeat: TPB },
  tracks: [
    // Track 0: tempo/time-sig only
    [
      {
        type: "timeSignature",
        deltaTime: 0,
        numerator: 3,
        denominator: 4,
        metronome: 24,
        thirtyseconds: 8,
      },
      { type: "setTempo", deltaTime: 0, microsecondsPerBeat: TEMPO },
      { type: "endOfTrack", deltaTime: 0 },
    ],
    buildTrack(treble, false), // Track 1: treble
    buildTrack(bass, false), // Track 2: bass
  ],
};

const bytes = writeMidi(midi2);
writeFileSync("tests/fixtures/simple-grand-piano.mid", Buffer.from(bytes));
console.log("Written tests/fixtures/simple-grand-piano.mid");
