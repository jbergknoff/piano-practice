# MIDI → VexFlow rendering pipeline

This document covers the full data pipeline from a parsed MIDI file
(`@tonejs/midi`) to rendered sheet music (`VexFlow 5`). It is intended as a
reference for debugging rendering issues and for anyone extending the renderer
in `src/SheetMusic.tsx`.

---

## 1. @tonejs/midi data format

### `Midi` (root object)

```
Midi
├── header: Header
└── tracks: Track[]
```

`@tonejs/midi` auto-splits multi-channel MIDI tracks. A single-track MIDI file
that uses two channels becomes two `Track` objects. A standard piano export
(left hand on ch 1, right hand on ch 2) becomes two tracks, which is why the
app shows them as separate rows in the score.

---

### `Header`

| Field | Type | Meaning |
|---|---|---|
| `ppq` | `number` | **Pulses Per Quarter-note** — the MIDI clock resolution. Defaults to 480. Every tick value in the file is a multiple of this unit. Quarter note = `ppq` ticks; 16th note = `ppq/4` ticks. |
| `tempos` | `TempoEvent[]` | One entry per tempo change. Each has `{ ticks, bpm }`. `bpm` is converted from MIDI microseconds-per-beat by the library. Missing → assume 120 BPM. |
| `timeSignatures` | `TimeSignatureEvent[]` | One entry per time-sig change. Each has `{ ticks, timeSignature: [numerator, denominator] }`. E.g. `[4, 4]` for 4/4, `[6, 8]` for 6/8. |
| `keySignatures` | `KeySignatureEvent[]` | One entry per key-sig change. Each has `{ ticks, key, scale }`. Key names like `"C"`, `"F#"`, `"Bb"`; scale is `"major"` or `"minor"`. Reliability varies — DAW exports often omit or mis-set this. |

Helper methods: `ticksToSeconds(ticks)`, `secondsToTicks(s)`, `ticksToMeasures(ticks)` — all account for tempo changes via binary search.

---

### `Track`

| Field | Type | Meaning |
|---|---|---|
| `name` | `string` | From the MIDI track-name meta event. Frequently blank or generic. |
| `channel` | `number` | **0-indexed** (0–15). Channel 9 = percussion / drums. |
| `instrument` | `Instrument` | `{ number, name, family, percussion }`. Program number 0–127, name from GM table. Often unreliable in DAW exports — many files export everything as program 0 (piano). |
| `notes` | `Note[]` | All note events, sorted by start tick. |
| `controlChanges` | `ControlChanges` | Keyed by CC number or name (e.g. `controlChanges[64]` = sustain pedal). Not used by the renderer. |
| `pitchBends` | `PitchBend[]` | Not used by the renderer. |

---

### `Note`

| Field | Type | Meaning |
|---|---|---|
| `midi` | `number` | MIDI pitch 0–127. Middle C = 60. Formula: `midi = (octave + 1) × 12 + semitone` where semitone is 0=C, 1=C♯, …, 11=B. |
| `ticks` | `number` | **Absolute** start position in ticks from the beginning of the file. |
| `durationTicks` | `number` | Duration in ticks, computed as `noteOff.ticks − noteOn.ticks`. |
| `velocity` | `number` | 0–1 float (MIDI 0–127 divided by 127). Not used by the renderer. |
| `name` *(getter)* | `string` | Scientific pitch notation, e.g. `"C4"`, `"C#4"`, `"Bb3"`. |
| `pitch` *(getter)* | `string` | Pitch class only: `"C"`, `"C#"`, …, `"B"`. |
| `octave` *(getter)* | `number` | `Math.floor(midi / 12) − 1`. C4 → octave 4. |
| `time` *(getter)* | `number` | Start time in seconds (uses `header.ticksToSeconds`). |
| `duration` *(getter)* | `number` | Duration in seconds. |

MIDI pitch reference:

| MIDI | Note |
|---|---|
| 21 | A0 (lowest piano key) |
| 48 | C3 |
| 60 | C4 (middle C) |
| 69 | A4 (concert A = 440 Hz) |
| 72 | C5 |
| 108 | C8 (highest piano key) |

---

## 2. VexFlow objects needed

### `Renderer`

```typescript
const renderer = new Renderer(element, Renderer.Backends.SVG);
renderer.resize(width, height);   // must be called; sets SVG element dimensions
const ctx = renderer.getContext();
```

### `Stave`

```typescript
new Stave(x, y, width)
  .addClef("treble" | "bass" | "alto" | "tenor" | ...)
  .addTimeSignature("4/4")      // or "3/4", "6/8", "C", "C|"
  .addKeySignature("G")         // key name string, e.g. "Bb", "F#"
  .setContext(ctx)
  .draw();

stave.getNoteStartX()  // pixel x where notes begin after modifiers (clef, key sig, time sig)
```

### `StaveNote`

```typescript
new StaveNote({ keys: string[], duration: string })
```

**`keys`** — one string per pitch in the chord, format `"{note}/{octave}"`:
- Note names are lowercase: `"c"`, `"d"`, `"e"`, `"f"`, `"g"`, `"a"`, `"b"`.
- Accidentals go between the note letter and the slash: `"c#/4"`, `"db/4"`,
  `"g##/5"`, `"an/4"` (natural A).
- The accidental in the key string tells VexFlow which staff line/space to
  place the notehead on, but **it does not draw an accidental glyph**. To
  draw the glyph, attach an `Accidental` modifier (see below).

**`duration`** — rhythm value string:

| String | Value |
|---|---|
| `"w"` | whole |
| `"h"` | half |
| `"q"` | quarter |
| `"8"` | eighth |
| `"16"` | sixteenth |
| `"32"` | thirty-second |
| `"64"` | sixty-fourth |
| `"hd"` | dotted half |
| `"qd"` | dotted quarter |
| `"8d"` | dotted eighth |
| `"hdd"` | double-dotted half |
| `"wr"` | whole rest |
| `"hr"`, `"qr"`, `"8r"`, `"16r"` | half / quarter / eighth / sixteenth rest |

Rests do not semantically need a `keys` array; VexFlow ignores it for rests.
The current code passes `["b/4"]` as a placeholder, which is harmless.

### `Accidental`

```typescript
staveNote.addModifier(new Accidental(type), noteIndexInChord);
```

Valid `type` strings: `"#"`, `"##"`, `"b"`, `"bb"`, `"n"`, plus microtonal
variants. The optional `.setAsCautionary()` method wraps the glyph in
parentheses (courtesy accidental).

**Static helper** — automatically applies accidentals to all voices based on
a key signature:

```typescript
Accidental.applyAccidentals(voices, "G");   // key of G major
```

This eliminates the need for manual SHARP_SEMITONES logic and correctly handles
naturals, flats, and redundant-accidental suppression within a measure.

### `Voice`

```typescript
new Voice({ numBeats: 4, beatValue: 4 })
  .setStrict(false)             // SOFT mode: don't require exact fill
  .addTickables([...staveNotes]);
```

`numBeats` / `beatValue` match the time signature. `setStrict(false)` prevents
VexFlow from throwing when a voice doesn't fill the measure exactly (important
for pickup bars and measures where some notes were silently skipped).

### `Formatter`

The formatter assigns pixel x-positions to all notes and is the mechanism for
**aligning beat positions across multiple staves**:

```typescript
const formatter = new Formatter();
for (const voice of allVoicesThisMeasure) {
  formatter.joinVoices([voice]);   // register (does not merge voices)
}
formatter.format(allVoicesThisMeasure, availableWidthPx);
// now draw each voice onto its own stave
```

`joinVoices` is called once per voice. Despite the name it does not combine
voices — it registers them so the subsequent `format` call can give all of
them the same horizontal grid. Calling `format` with only one voice at a time
(the old approach) assigns each track's beats independently, causing
misalignment.

### `Beam`

VexFlow does **not** auto-beam. Beams must be created explicitly:

```typescript
const beam = new Beam([note1, note2, note3, note4]);
// after drawing voices:
beam.setContext(ctx).draw();
```

Or use the static helper to generate beams from a note array:

```typescript
const beams = Beam.generateBeams(notes, { groups: [new Fraction(2, 8)] });
```

Currently not implemented in `SheetMusic.tsx` — eighth and sixteenth notes are
drawn with individual flags.

### `Tuplet`

```typescript
new Tuplet([n1, n2, n3], { numNotes: 3, notesOccupied: 2 });
```

`numNotes` notes occupy the space of `notesOccupied` regular notes. Currently
not implemented.

---

## 3. Processing pipeline

```
@tonejs/midi Note                →   TrackNote (internal)      →   Tickable           →   StaveNote
{ ticks, durationTicks, midi }      { startBeats,                 { keys: string[],       VexFlow object
                                       durationBeats,               duration: string,
                                       midi }                        accs: (string|null)[] }
```

### Step 1 — MIDI metadata extraction

```typescript
const ppq = midi.header.ppq;
const [sigNum, sigDen] = midi.header.timeSignatures[0]?.timeSignature ?? [4, 4];
const ticksPerMeasure = Math.round((sigNum / sigDen) * 4 * ppq);
const beatsPerMeasure = ticksPerMeasure / ppq;   // quarter-note beats
const sixteenth = ppq / 4;                        // ticks per 16th note
```

**Known limitation:** Only the first time signature is used. Changes mid-piece
are ignored.

### Step 2 — Track filtering

Tracks with zero notes are excluded from the UI checkbox list. Only tracks
checked in the UI (`selected` state) are rendered.

### Step 3 — Quantization: ticks → beats

Each raw tick is snapped to the nearest 16th-note grid, then converted to
quarter-note beats:

```typescript
startBeats   = (Math.round(ticks        / sixteenth) * sixteenth) / ppq
durationBeats = (Math.round(durationTicks / sixteenth) * sixteenth) / ppq
durationBeats = Math.max(0.25, durationBeats)   // minimum: one 16th note
```

A note shorter than 1/8th of a 16th note (≈ 8 ticks at ppq=480) is promoted
to a 16th note rather than disappearing. Positions are stored as absolute
quarter-note beats from the start of the piece.

**Known limitation:** 32nd notes, triplets, and any subdivision finer than a
16th cannot be represented.

### Step 4 — Clef selection

```typescript
const avg = mean(note.midi for all notes in track);
const clef = avg < 60 ? "bass" : "treble";
```

One clef per track, fixed for the entire piece.

**Known limitations:** No alto/tenor clef. No clef changes mid-piece. The
threshold is MIDI 60 (C4). A track spanning both registers gets whichever clef
matches its average pitch.

### Step 5 — Note grouping into chords (per measure)

Within each measure, notes with the same 16th-snapped relative position are
merged into one chord slot:

```typescript
const rel = Math.round((note.startBeats - measureStart) * 4) / 4;
byPos[rel].midis.push(note.midi);
byPos[rel].durBeats = Math.max(byPos[rel].durBeats, clampedDur);
```

`byPos` is a `Map<number, { midis: number[], durBeats: number }>` keyed on
the 16th-grid position relative to measure start (0, 0.25, 0.5, …).

**Known limitations:**
- When notes in a chord have different durations, the longest wins; shorter
  notes' true endings are lost.
- A note whose quantized start falls inside the window already consumed by a
  prior note (`pos < cursor`) is silently dropped.

### Step 6 — Rest insertion

After sorting chord slots by position, gaps between slots (and the gap between
the last slot and the measure end) are filled with rest tickables.
`splitRests(gapBeats)` decomposes the gap greedily into whole → half →
quarter → eighth → sixteenth. Rest noteheads use the placeholder key `"b/4"`.

### Step 7 — Duration mapping: beats → VexFlow string

`nearestVexDur(beats)` finds the closest entry in:

| Beats | VexFlow string |
|---|---|
| 4.0 | `"w"` |
| 2.0 | `"h"` |
| 1.0 | `"q"` |
| 0.5 | `"8"` |
| 0.25 | `"16"` |

Implicit break points are halfway between adjacent values. After 16th-note
quantization in step 3, the only values that can arrive here are multiples of
0.25, so the nearest-neighbour lookup always lands exactly on one of these.

**Known limitation:** Dotted durations (1.5, 0.75, 0.375 beats) are rounded
to the nearest non-dotted value — a dotted quarter becomes a half. VexFlow
supports dotted durations (`"qd"`, `"hd"`, `"8d"`) but they are not currently
used.

### Step 8 — Accidental logic

```typescript
const SHARP_SEMITONES = new Set([1, 3, 6, 8, 10]);  // C#, D#, F#, G#, A#
const acc = SHARP_SEMITONES.has(midi % 12) ? "#" : null;
```

For each pitch in a chord: if the semitone (0–11) is in `SHARP_SEMITONES`,
emit a `"#"` accidental. Otherwise emit `null` (no glyph). Accidentals are
attached as `new Accidental("#")` modifiers.

VexFlow key strings always use sharps: `"c#/4"`, `"d#/4"`, etc.

**Known limitations:**
- All black keys are always spelled as sharps, regardless of key signature or
  harmonic context (e.g. Bb is always displayed as A#).
- Natural signs (`"n"`) are never drawn; a note that should cancel a key-sig
  accidental gets no glyph.
- Flats and double accidentals are never used.
- The key signature is never consulted. `Accidental.applyAccidentals()` could
  replace this logic and handle all of the above correctly.

### Step 9 — Layout geometry

```
firstMeasureW  = max(stave.getNoteStartX() across all track clefs) + MEASURE_W
                 // dynamic: measured via throw-away off-screen renderer
MEASURE_W      = 180 px   // fixed for all subsequent measures
ROW_H          = 120 px   // vertical space per track row
SVG_LEFT       = 10 px
SVG_TOP        = 20 px

staveX(m)  = SVG_LEFT + (m === 0 ? 0 : firstMeasureW + (m-1) × MEASURE_W)
staveW(m)  = m === 0 ? firstMeasureW : MEASURE_W
staveY(row) = SVG_TOP + row × ROW_H
svgW       = SVG_LEFT + firstMeasureW + (numMeasures−1) × MEASURE_W + 20
svgH       = SVG_TOP  + numTracks × ROW_H + 20
```

`firstMeasureW` is computed by drawing each track's first stave (clef + time
sig) into a throw-away off-screen renderer, reading `getNoteStartX()`, then
taking the maximum across all tracks. This ensures note content gets the same
horizontal space in every track's first measure.

**Known limitation:** `MEASURE_W` is fixed at 180 px regardless of note
density. A measure with 16 sixteenth notes gets the same width as a measure
with one whole note.

### Step 10 — Rendering

```typescript
for (let m = 0; m < numMeasures; m++) {
  // inner loop: build staves and voices for all tracks in this measure
  const formatter = new Formatter();
  for (const voice of voices) { formatter.joinVoices([voice]); }
  formatter.format(voices, staveW - 30);   // shared layout for all tracks
  for (let row = 0; row < allTrackData.length; row++) {
    if (measureVoices[row]) {
      measureVoices[row].draw(ctx, measureStaves[row]);
    }
  }
}
```

One `Formatter` per measure, all tracks' voices formatted together — this is
what keeps beat 2 at the same x-coordinate across all staves.

---

## 4. Ambiguities and open choices

| Topic | Current behaviour | What it would take to fix |
|---|---|---|
| **Key signature** | Always ignored; no key-sig glyph drawn | Read `header.keySignatures[0]`, call `stave.addKeySignature(key)` on each first stave, then call `Accidental.applyAccidentals(voices, key)` instead of the manual SHARP_SEMITONES loop |
| **Flat vs sharp spelling** | All black keys shown as sharps (A# not Bb, etc.) | Derive preferred spelling from key signature (flat key → prefer flats); feed to VexFlow key strings and accidental modifiers |
| **Natural signs** | Never drawn | Handled automatically by `Accidental.applyAccidentals()` |
| **Dotted notes** | Rounded to nearest non-dotted duration (dotted quarter → half) | Add `1.5`, `0.75`, `0.375` to the `VEX_DURS` table with strings `"hd"`, `"qd"`, `"8d"`; adjust quantization grid or add a dedicated dotted-snapping pass |
| **Ties** | Not rendered; a long note is simply truncated at the measure boundary | Detect notes whose quantized duration crosses a barline; render as two tied `StaveNote` objects connected by a `StaveTie` |
| **Beaming** | Not implemented; 8th/16th notes show individual flags | Build `Beam` objects after voices are created; `Beam.generateBeams(notes)` can automate grouping |
| **Tuplets / triplets** | Not representable; rounded to nearest binary duration | Detect groups of 3 (or 5, 6, 7) notes summing to a binary duration; wrap in VexFlow `Tuplet` |
| **Multi-voice staves** | Not supported; each track = one stave, one voice | To reconstitute a grand staff from two tracks, place both on the same pair of staves with stem-up and stem-down voices |
| **Clef threshold** | MIDI 60 (C4); anything ≥ C4 → treble | MIDI 57 (A3) is a common piano grand-staff split |
| **Measure width** | Fixed 180 px per measure | Proportional to note count or to total duration in that measure |
| **Time signature changes** | Only first time sig used; changes ignored | Walk `header.timeSignatures` and switch `beatsPerMeasure` / `ticksPerMeasure` at the corresponding measure boundary |
| **Chord duration conflict** | Longest duration wins; shorter notes' endings are lost | Render as two independent voices if notes at the same beat have meaningfully different durations |
| **Overlapping notes** | Second note (if its quantized start falls inside the first note's window) is silently dropped | Place into a second voice |
| **Percussion tracks** | Rendered as an ordinary treble stave | Detect `track.channel === 9` and either skip the track or use a percussion clef with x-head noteheads |
| **Grace notes** | Not representable | VexFlow supports `GraceNote` / `GraceNoteGroup`; requires detecting very short notes (< 1 16th note before quantization) |
