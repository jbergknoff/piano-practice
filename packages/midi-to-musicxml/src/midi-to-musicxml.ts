import type { MidiData, MidiEvent } from "midi-file";

// MusicXML divisions per quarter note (1 division = one 16th note)
const DIVISIONS = 4;

// Chromatic note names, defaulting to sharps
const NOTE_STEPS = [
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

// Map from grid duration (in 16th-note units) to MusicXML [type, hasDot]
const DURATION_TYPE = new Map<number, [string, boolean]>([
  [16, ["whole", false]],
  [12, ["half", true]],
  [8, ["half", false]],
  [6, ["quarter", true]],
  [4, ["quarter", false]],
  [3, ["eighth", true]],
  [2, ["eighth", false]],
  [1, ["16th", false]],
]);

// Nearest standard grid duration for values that don't map exactly
const STANDARD_DURATIONS = [16, 12, 8, 6, 4, 3, 2, 1];

interface RawNote {
  noteNumber: number;
  startTick: number;
  endTick: number;
  velocity: number;
}

// A note segment within a single measure (after barline splitting)
interface NotePart {
  noteNumber: number;
  startTick: number; // absolute
  durationTicks: number; // within this measure only
  velocity: number;
  tieStop: boolean; // continues from previous measure
  tieStart: boolean; // continues into next measure
}

function noteNumberToPitch(n: number): {
  step: string;
  alter?: number;
  octave: number;
} {
  const name = NOTE_STEPS[n % 12];
  const octave = Math.floor(n / 12) - 1;
  return name.length > 1
    ? { step: name[0], alter: 1, octave }
    : { step: name, octave };
}

// Split a note into segments at every barline it crosses
function splitAtBarlines(note: RawNote, ticksPerMeasure: number): NotePart[] {
  const parts: NotePart[] = [];
  let tick = note.startTick;
  let first = true;
  while (tick < note.endTick) {
    const barEnd = (Math.floor(tick / ticksPerMeasure) + 1) * ticksPerMeasure;
    const segEnd = Math.min(note.endTick, barEnd);
    parts.push({
      noteNumber: note.noteNumber,
      startTick: tick,
      durationTicks: segEnd - tick,
      velocity: note.velocity,
      tieStop: !first,
      tieStart: segEnd < note.endTick,
    });
    tick = segEnd;
    first = false;
  }
  return parts;
}

// Break a grid duration into a sum of standard values (for rests)
function decompose(units: number): number[] {
  const result: number[] = [];
  let rem = units;
  while (rem > 0) {
    const v = STANDARD_DURATIONS.find((d) => d <= rem);
    if (v === undefined) {
      break;
    }
    result.push(v);
    rem -= v;
  }
  return result;
}

// Snap a duration to the nearest standard grid value
function snapToStandard(units: number): number {
  return STANDARD_DURATIONS.reduce((best, d) =>
    Math.abs(d - units) < Math.abs(best - units) ? d : best,
  );
}

function renderNote(
  pitch: { step: string; alter?: number; octave: number } | null,
  dur: number,
  tieStop: boolean,
  tieStart: boolean,
  chord: boolean,
  indent: string,
  staccato = false,
  /** When provided, emit a `<play-duration>` child so the parser can store the
   *  actual sounding length separately from the display duration (`dur`).
   *  `musicXmlToConversion` then uses the playback duration for `durationBeats`
   *  instead of the display duration, keeping highlight timing accurate when a
   *  second part has intermediate onsets that advance the cursor. */
  playbackDur?: number,
): string {
  const [type, dot] = DURATION_TYPE.get(dur) ?? ["quarter", false];
  const i = indent;
  const lines: string[] = [`${i}<note>`];
  if (chord) {
    lines.push(`${i}  <chord/>`);
  }
  if (pitch === null) {
    lines.push(`${i}  <rest/>`);
  } else {
    lines.push(`${i}  <pitch>`);
    lines.push(`${i}    <step>${pitch.step}</step>`);
    if (pitch.alter !== undefined) {
      lines.push(`${i}    <alter>${pitch.alter}</alter>`);
    }
    lines.push(`${i}    <octave>${pitch.octave}</octave>`);
    lines.push(`${i}  </pitch>`);
  }
  lines.push(`${i}  <duration>${dur}</duration>`);
  if (playbackDur !== undefined) {
    lines.push(`${i}  <play-duration>${playbackDur}</play-duration>`);
  }
  if (tieStop) {
    lines.push(`${i}  <tie type="stop"/>`);
  }
  if (tieStart) {
    lines.push(`${i}  <tie type="start"/>`);
  }
  lines.push(`${i}  <type>${type}</type>`);
  if (dot) {
    lines.push(`${i}  <dot/>`);
  }
  const hasNotations = (tieStop || tieStart || staccato) && pitch !== null;
  if (hasNotations) {
    lines.push(`${i}  <notations>`);
    if (tieStop) {
      lines.push(`${i}    <tied type="stop"/>`);
    }
    if (tieStart) {
      lines.push(`${i}    <tied type="start"/>`);
    }
    if (staccato) {
      lines.push(`${i}    <articulations><staccato/></articulations>`);
    }
    lines.push(`${i}  </notations>`);
  }
  lines.push(`${i}</note>`);
  return lines.join("\n");
}

// Emit a grace note (appoggiatura or acciaccatura) — no <duration>, type is
// always "eighth". slash=true adds `slash="yes"` to <grace/>.
function renderGraceNote(
  pitch: { step: string; alter?: number; octave: number },
  slash: boolean,
  chord: boolean,
  indent: string,
): string {
  const i = indent;
  const lines: string[] = [`${i}<note>`];
  if (chord) {
    lines.push(`${i}  <chord/>`);
  }
  lines.push(`${i}  <grace${slash ? ' slash="yes"' : ""}/>`);
  lines.push(`${i}  <pitch>`);
  lines.push(`${i}    <step>${pitch.step}</step>`);
  if (pitch.alter !== undefined) {
    lines.push(`${i}    <alter>${pitch.alter}</alter>`);
  }
  lines.push(`${i}    <octave>${pitch.octave}</octave>`);
  lines.push(`${i}  </pitch>`);
  lines.push(`${i}  <type>eighth</type>`);
  lines.push(`${i}</note>`);
  return lines.join("\n");
}

// A note whose sounding length is at most this fraction of the space until the
// next onset is treated as staccato (detached) and gets a staccato dot.
const STACCATO_RATIO = 0.5;

// Raw MIDI duration thresholds for grace note detection (in ticks).
// A note shorter than GRACE_NOTE_THRESHOLD (≤ 32nd note) that is immediately
// followed by a longer note is classified as a grace note. Notes shorter than
// ACCIACCATURA_THRESHOLD (≤ 64th note) get the acciaccatura slash.
//
// These are expressed as multiples of tpb so they scale with the MIDI file's
// resolution. For the common 480-tpb case:
//   GRACE_NOTE_THRESHOLD  = 480/8  = 60 ticks (32nd note)
//   ACCIACCATURA_THRESHOLD= 480/16 = 30 ticks (64th note)
const GRACE_NOTE_THRESHOLD_FACTOR = 1 / 8; // × tpb
const ACCIACCATURA_THRESHOLD_FACTOR = 1 / 16; // × tpb

// ── Multi-track API ──────────────────────────────────────────────────────────

export function getMidiTempo(midiData: MidiData): number {
  for (const track of midiData.tracks) {
    for (const ev of track) {
      if (ev.type === "setTempo") {
        return Math.round(60_000_000 / ev.microsecondsPerBeat);
      }
    }
  }
  return 120;
}

export interface TrackInfo {
  index: number;
  name: string;
  noteCount: number;
}

export function getMidiTracks(midiData: MidiData): TrackInfo[] {
  const result: TrackInfo[] = [];
  for (let i = 0; i < midiData.tracks.length; i++) {
    const track = midiData.tracks[i];
    let name = `Track ${i + 1}`;
    let noteCount = 0;
    for (const ev of track) {
      if (ev.type === "trackName") {
        name = ev.text || name;
      } else if (ev.type === "noteOn" && ev.velocity > 0) {
        noteCount++;
      }
    }
    if (noteCount > 0) {
      result.push({ index: i, name, noteCount });
    }
  }
  return result;
}

function extractTrackNotes(track: MidiEvent[], tpb: number): RawNote[] {
  const rawNotes: RawNote[] = [];
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
        rawNotes.push({
          noteNumber: ev.noteNumber,
          startTick: a.startTick,
          endTick: tick,
          velocity: a.velocity,
        });
        active.delete(ev.noteNumber);
      }
    }
  }
  return rawNotes;
}

// Map each MIDI key-signature change to the measure it takes effect in. Key
// changes in MIDI fall on (or are snapped down to) a measure boundary. Measure 0
// always has an entry so the first measure's header can be emitted.
function collectKeyByMeasure(
  midiData: MidiData,
  ticksPerMeasure: number,
): Map<number, { fifths: number; mode: string }> {
  const events: Array<{ tick: number; fifths: number; mode: string }> = [];
  for (const track of midiData.tracks) {
    let tick = 0;
    for (const ev of track) {
      tick += ev.deltaTime;
      if (ev.type === "keySignature") {
        events.push({
          tick,
          fifths: ev.key,
          mode: ev.scale === 0 ? "major" : "minor",
        });
      }
    }
  }
  events.sort((a, b) => a.tick - b.tick);

  const byMeasure = new Map<number, { fifths: number; mode: string }>();
  for (const ev of events) {
    const m = Math.max(0, Math.floor(ev.tick / ticksPerMeasure));
    byMeasure.set(m, { fifths: ev.fifths, mode: ev.mode });
  }
  if (!byMeasure.has(0)) {
    byMeasure.set(0, { fifths: 0, mode: "major" });
  }
  return byMeasure;
}

function detectClef(notes: RawNote[]): { sign: string; line: number } {
  if (notes.length === 0) {
    return { sign: "G", line: 2 };
  }
  const sorted = notes.map((n) => n.noteNumber).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return median < 60 ? { sign: "F", line: 4 } : { sign: "G", line: 2 };
}

// A grace note extracted before quantization, associated with the main note
// it immediately precedes.
interface GraceNoteInfo {
  noteNumber: number;
  /** Raw (pre-quantization) start tick. */
  rawStartTick: number;
  /** Raw MIDI duration in ticks. */
  rawDurationTicks: number;
  velocity: number;
  slash: boolean; // acciaccatura (true) vs appoggiatura (false)
  /** Raw startTick of the main note this grace note is associated with. */
  mainNoteRawTick: number;
}

/**
 * Identify grace note candidates from raw (unquantized) notes. Returns the
 * grace notes and the remaining regular notes (with grace notes removed).
 *
 * A note is a grace note when:
 *   1. Its raw duration < graceThreshold (≤ 32nd note), AND
 *   2. It is preceded (in time) by either a normal-duration note or a
 *      confirmed grace note — this prevents trill-termination figures from
 *      being misidentified as grace notes, AND
 *   3. There exists a subsequent note starting within one measure that is
 *      not itself a grace note candidate — that note is the "main note".
 * Slash (acciaccatura) is set when duration < acciaccaturaThreshold (≤ 64th).
 *
 * Rule 2 in detail: real grace ornaments always follow a "normal" note
 * (e.g. a quarter or eighth note with duration > graceThreshold).  Multiple
 * grace notes in a group chain: each subsequent candidate may follow another
 * confirmed grace note.  Trill endings look like clusters of short notes
 * preceded by the last trill repeat note which sits exactly at the threshold
 * — those are rejected because their predecessor has duration ≤ graceThreshold
 * and is not itself a confirmed grace.
 */
function detectGraceNotes(
  rawNotes: RawNote[],
  tpb: number,
  ticksPerMeasure: number,
): { graces: GraceNoteInfo[]; regulars: RawNote[] } {
  const graceThreshold = tpb * GRACE_NOTE_THRESHOLD_FACTOR;
  const acciaccaturaThreshold = tpb * ACCIACCATURA_THRESHOLD_FACTOR;

  // Sort by start tick for sequential processing.
  const sorted = [...rawNotes].sort(
    (a, b) => a.startTick - b.startTick || a.noteNumber - b.noteNumber,
  );

  // First pass: flag all notes shorter than the grace threshold as candidates.
  const isCandidate = sorted.map(
    (n) => n.endTick - n.startTick < graceThreshold,
  );

  const graces: GraceNoteInfo[] = [];
  const graceIndices = new Set<number>();

  // Second pass: confirm each candidate.
  for (let i = 0; i < sorted.length; i++) {
    if (!isCandidate[i]) {
      continue;
    }
    const grace = sorted[i];

    // --- Rule 2: predecessor check ---
    // Find the tick of the event that starts strictly before this candidate.
    let prevTick = -1;
    for (let j = i - 1; j >= 0; j--) {
      if (sorted[j].startTick < grace.startTick) {
        prevTick = sorted[j].startTick;
        break;
      }
    }

    if (prevTick >= 0) {
      // Examine all notes that share that preceding tick (a potential chord).
      // The candidate is accepted if ANY predecessor is:
      //   a) a normal-duration note (dur > graceThreshold), or
      //   b) a confirmed grace note (chaining).
      let validPredecessor = false;
      for (let j = i - 1; j >= 0; j--) {
        if (sorted[j].startTick !== prevTick) {
          break;
        }
        const prevDur = sorted[j].endTick - sorted[j].startTick;
        if (prevDur > graceThreshold || graceIndices.has(j)) {
          validPredecessor = true;
          break;
        }
      }
      if (!validPredecessor) {
        continue; // trill-ending or other short-note cluster — skip
      }
    }
    // (If there is no preceding note at all, allow the candidate — it is the
    // first note in the track, which can legitimately be a grace note.)

    // --- Rule 3: following main note check ---
    let mainIdx = -1;
    for (let j = i + 1; j < sorted.length; j++) {
      if (
        !isCandidate[j] &&
        sorted[j].startTick <= grace.startTick + ticksPerMeasure
      ) {
        mainIdx = j;
        break;
      }
    }
    if (mainIdx === -1) {
      continue; // no following main note — keep as regular
    }

    graceIndices.add(i);
    const rawDurationTicks = grace.endTick - grace.startTick;
    graces.push({
      noteNumber: grace.noteNumber,
      rawStartTick: grace.startTick,
      rawDurationTicks,
      velocity: grace.velocity,
      slash: rawDurationTicks < acciaccaturaThreshold,
      mainNoteRawTick: sorted[mainIdx].startTick,
    });
  }

  const regulars = sorted.filter((_, i) => !graceIndices.has(i));
  return { graces, regulars };
}

function buildPartMeasuresXml(
  rawNotes: RawNote[],
  graceNotes: GraceNoteInfo[],
  tpb: number,
  timeSigNum: number,
  timeSigDen: number,
  keyByMeasure: Map<number, { fifths: number; mode: string }>,
  clef: { sign: string; line: number },
  numMeasures: number,
): string[] {
  const grid = tpb / 4;
  const snap = (t: number) => Math.round(t / grid) * grid;
  const quantized: RawNote[] = rawNotes.map((n) => {
    const s = snap(n.startTick);
    const e = Math.max(s + grid, snap(n.endTick));
    return { ...n, startTick: s, endTick: e };
  });

  const ticksPerMeasure = (tpb * timeSigNum * 4) / timeSigDen;

  const parts: NotePart[] = quantized
    .flatMap((n) => splitAtBarlines(n, ticksPerMeasure))
    .sort((a, b) => a.startTick - b.startTick || a.noteNumber - b.noteNumber);

  // Build a map from the quantized tick of each grace note's main note to the
  // list of grace notes that precede it, sorted by rawStartTick (ascending so
  // the leftmost grace note is first in display order).
  const gracesByQuantizedMainTick = new Map<number, GraceNoteInfo[]>();
  for (const g of graceNotes) {
    const quantizedMain = snap(g.mainNoteRawTick);
    const list = gracesByQuantizedMainTick.get(quantizedMain) ?? [];
    list.push(g);
    gracesByQuantizedMainTick.set(quantizedMain, list);
  }
  // Sort each group so grace notes appear in onset order (left to right).
  for (const list of gracesByQuantizedMainTick.values()) {
    list.sort((a, b) => a.rawStartTick - b.rawStartTick);
  }

  const measureXml: string[] = [];
  const ind = "    ";

  const initialKey = keyByMeasure.get(0) ?? { fifths: 0, mode: "major" };
  let runningFifths = initialKey.fifths;

  for (let m = 0; m < numMeasures; m++) {
    const mStart = m * ticksPerMeasure;
    const mEnd = mStart + ticksPerMeasure;
    const mParts = parts.filter(
      (p) => p.startTick >= mStart && p.startTick < mEnd,
    );
    const lines: string[] = [];

    if (m === 0) {
      lines.push(
        `${ind}<attributes>`,
        `${ind}  <divisions>${DIVISIONS}</divisions>`,
        `${ind}  <key><fifths>${initialKey.fifths}</fifths><mode>${initialKey.mode}</mode></key>`,
        `${ind}  <time><beats>${timeSigNum}</beats><beat-type>${timeSigDen}</beat-type></time>`,
        `${ind}  <clef><sign>${clef.sign}</sign><line>${clef.line}</line></clef>`,
        `${ind}</attributes>`,
      );
    } else {
      // Emit a key-only <attributes> block whenever the key signature changes
      // at this measure (key changes in the MIDI fall on measure boundaries).
      const k = keyByMeasure.get(m);
      if (k && k.fifths !== runningFifths) {
        lines.push(
          `${ind}<attributes><key><fifths>${k.fifths}</fifths><mode>${k.mode}</mode></key></attributes>`,
        );
        runningFifths = k.fifths;
      }
    }

    let cursor = mStart;
    let i = 0;
    let noteIndex = 0;

    while (i < mParts.length) {
      const startTick = mParts[i].startTick;
      if (startTick > cursor) {
        const restGrid = Math.round((startTick - cursor) / grid);
        for (const d of decompose(restGrid)) {
          lines.push(renderNote(null, d, false, false, false, ind));
        }
      }

      let j = i;
      while (j < mParts.length && mParts[j].startTick === startTick) {
        j++;
      }
      const chord = mParts.slice(i, j);

      // Emit any grace notes that precede this chord (keyed by its quantized
      // start tick). Each grace note group is a single note (chord=false for
      // the first, chord=true for subsequent notes at the same grace onset).
      const graceList = gracesByQuantizedMainTick.get(startTick);
      if (graceList) {
        // Group grace notes that share the same rawStartTick into chords.
        let gi = 0;
        while (gi < graceList.length) {
          const graceStart = graceList[gi].rawStartTick;
          // Collect all grace notes at this same raw onset.
          let gj = gi;
          while (
            gj < graceList.length &&
            graceList[gj].rawStartTick === graceStart
          ) {
            gj++;
          }
          const graceChord = graceList.slice(gi, gj);
          // All notes in a grace chord share the same slash value (from first).
          const slash = graceChord[0].slash;
          // Sort the chord by note number (low → high).
          graceChord.sort((a, b) => a.noteNumber - b.noteNumber);
          for (let gk = 0; gk < graceChord.length; gk++) {
            const g = graceChord[gk];
            lines.push(
              renderGraceNote(
                noteNumberToPitch(g.noteNumber),
                slash,
                gk > 0, // chord member for all but the first
                ind,
              ),
            );
          }
          noteIndex++;
          gi = gj;
        }
      }

      // The space to the next chord determines the visual notehead type so
      // that short MIDI note-off times (performance articulation) don't create
      // spurious rests in the notation.  However, `<duration>` uses the actual
      // quantized note length so that `musicXmlToConversion` derives correct
      // per-note `durationBeats` for highlighting — especially when a second
      // part has intermediate onsets that advance the cursor past this note's
      // X position before the space-to-next-onset expires.
      const nextStartTick = j < mParts.length ? mParts[j].startTick : mEnd;
      const spaceGrid = Math.round((nextStartTick - startTick) / grid);
      const displayDur = STANDARD_DURATIONS.find((d) => d <= spaceGrid) ?? 1;

      // Actual quantized note duration (from MIDI durationTicks), capped to the
      // space available so it never exceeds the next onset.
      const actualDurGrid = Math.round(chord[0].durationTicks / grid);
      const rhythmicDur =
        STANDARD_DURATIONS.find(
          (d) => d <= Math.min(actualDurGrid, spaceGrid),
        ) ?? 1;

      for (let k = 0; k < chord.length; k++) {
        const p = chord[k];
        const pitch = noteNumberToPitch(p.noteNumber);
        // The note is staccato when it sounds for much less than the space
        // until the next onset (displayDur). Tied segments are never staccato.
        const staccato =
          !p.tieStart &&
          !p.tieStop &&
          p.durationTicks <= displayDur * grid * STACCATO_RATIO;
        // When the actual sounding length is shorter than the display slot,
        // emit <play-duration> so musicXmlToConversion can use the real length
        // for durationBeats without an explicit rest disturbing the spine.
        // `displayDur` is always used for <duration> to keep beatCursor
        // advancement (and thus subsequent note startBeats) correct.
        const playbackDur = rhythmicDur < displayDur ? rhythmicDur : undefined;
        lines.push(
          renderNote(
            pitch,
            displayDur,
            p.tieStop,
            p.tieStart,
            k > 0,
            ind,
            staccato,
            playbackDur,
          ),
        );
      }

      // Advance cursor by the display duration (space to next onset in this
      // part). No explicit rests are needed: the <play-duration> element tells
      // musicXmlToConversion the actual note length, and beatCursor still
      // advances correctly via <duration>=displayDur.
      cursor = startTick + displayDur * grid;
      noteIndex++;
      i = j;
    }

    if (cursor < mEnd) {
      const restGrid = Math.round((mEnd - cursor) / grid);
      for (const d of decompose(restGrid)) {
        lines.push(renderNote(null, d, false, false, false, ind));
      }
    }

    measureXml.push(
      `  <measure number="${m + 1}">\n${lines.join("\n")}\n  </measure>`,
    );
  }

  return measureXml;
}

export function midiToMusicXmlWithTracks(
  midiData: MidiData,
  trackIndices: number[],
): string {
  const tpb = midiData.header.ticksPerBeat ?? 480;

  let timeSigNum = 4;
  let timeSigDen = 4;

  for (const track of midiData.tracks) {
    let tick = 0;
    for (const ev of track) {
      tick += ev.deltaTime;
      if (ev.type === "timeSignature") {
        timeSigNum = ev.numerator;
        timeSigDen = ev.denominator;
      }
    }
  }

  const grid = tpb / 4;
  const snap = (t: number) => Math.round(t / grid) * grid;
  const ticksPerMeasure = (tpb * timeSigNum * 4) / timeSigDen;
  const keyByMeasure = collectKeyByMeasure(midiData, ticksPerMeasure);
  const initialKey = keyByMeasure.get(0) ?? { fifths: 0, mode: "major" };

  // Extract raw notes per track, then detect grace notes *before* quantization
  // so the short-duration ornament notes are identified from the true MIDI data.
  const rawTrackNotes = trackIndices.map((idx) =>
    extractTrackNotes(midiData.tracks[idx], tpb),
  );

  // Detect and remove grace notes from each track's raw notes, then quantize.
  const trackGraceNotes = rawTrackNotes.map((raw) => {
    const { graces, regulars } = detectGraceNotes(raw, tpb, ticksPerMeasure);
    return { graces, regulars };
  });

  const trackNotes = trackGraceNotes.map(({ regulars }) =>
    regulars.map((n) => {
      const s = snap(n.startTick);
      const e = Math.max(s + grid, snap(n.endTick));
      return { ...n, startTick: s, endTick: e };
    }),
  );

  const allNotes = trackNotes.flat();
  if (allNotes.length === 0) {
    return emptyScore(
      initialKey.fifths,
      initialKey.mode,
      timeSigNum,
      timeSigDen,
    );
  }

  const totalTicks = Math.max(...allNotes.map((n) => n.endTick));
  const numMeasures = Math.ceil(totalTicks / ticksPerMeasure);

  const trackNames = getMidiTracks(midiData).reduce<Record<number, string>>(
    (acc, t) => {
      acc[t.index] = t.name;
      return acc;
    },
    {},
  );

  const partEntries = trackIndices.map((idx, i) => {
    const clef = detectClef(trackNotes[i]);
    const measureXml = buildPartMeasuresXml(
      trackNotes[i],
      trackGraceNotes[i].graces,
      tpb,
      timeSigNum,
      timeSigDen,
      keyByMeasure,
      clef,
      numMeasures,
    );
    return {
      id: `P${i + 1}`,
      name: trackNames[idx] ?? `Track ${idx + 1}`,
      measuresXml: measureXml,
    };
  });

  const partList = partEntries
    .map(
      (p) =>
        `    <score-part id="${p.id}">\n      <part-name>${p.name}</part-name>\n    </score-part>`,
    )
    .join("\n");
  const parts = partEntries
    .map((p) => `  <part id="${p.id}">\n${p.measuresXml.join("\n")}\n  </part>`)
    .join("\n");

  const musicxml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list>
${partList}
  </part-list>
${parts}
</score-partwise>`;

  return musicxml;
}

function emptyScore(
  keyFifths: number,
  keyMode: string,
  timeSigNum: number,
  timeSigDen: number,
): string {
  const fullMeasureDur = timeSigNum * DIVISIONS;
  return scoreTemplate(
    `  <measure number="1">
    <attributes>
      <divisions>${DIVISIONS}</divisions>
      <key><fifths>${keyFifths}</fifths><mode>${keyMode}</mode></key>
      <time><beats>${timeSigNum}</beats><beat-type>${timeSigDen}</beat-type></time>
      <clef><sign>G</sign><line>2</line></clef>
    </attributes>
    <note><rest measure="yes"/><duration>${fullMeasureDur}</duration></note>
  </measure>`,
  );
}

function scoreTemplate(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>
  <part id="P1">
${body}
  </part>
</score-partwise>`;
}
