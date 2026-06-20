// Document-as-source-of-truth editing primitives.
//
// The editor holds one live MusicXML `Document`. Every gesture applies a
// *surgical* edit to the actual `<note>` elements and the document is then
// re-serialized and re-parsed for rendering. Untouched `<note>` elements are
// reused verbatim (never regenerated), so everything the editor does not model
// — dynamics, slurs, lyrics, voices, layout hints — survives a round-trip by
// construction.
//
// Scope (step 1): single part / single treble staff, no voices / `<backup>` /
// chords / grace notes. A "beat" throughout is one quarter note (matching
// `computeMeasureStartBeats`), so divisions-per-beat == divisions-per-quarter.

import type { NoteType, Pitch } from "./sheet-music/index";

// MusicXML divisions per quarter note. The renderer/layout assume this value.
export const DIVISIONS = 4;

/** Identifies a `<note>` element: its measure (0-based within the part) and its
 *  position among that measure's `<note>` elements (document order, rests
 *  included — matching `ParsedNote.source.noteElementIndex`). */
export interface NoteHandle {
  measureIndex: number;
  noteElementIndex: number;
}

// Standard note/rest durations in divisions (1 division = a 16th note),
// largest first. The dotted values (12, 6, 3) let a single glyph cover dotted
// spans; `decompose` and `largestFit` both walk this list.
const STANDARD_DURATIONS = [16, 12, 8, 6, 4, 3, 2, 1];

// Division span → [MusicXML type, dotted]. Mirrors the table in
// midi-to-musicxml so notation reads identically.
const DURATION_TYPE = new Map<number, [NoteType, boolean]>([
  [16, ["whole", false]],
  [12, ["half", true]],
  [8, ["half", false]],
  [6, ["quarter", true]],
  [4, ["quarter", false]],
  [3, ["eighth", true]],
  [2, ["eighth", false]],
  [1, ["16th", false]],
]);

function typeDotForDivisions(divisions: number): [NoteType, boolean] {
  return DURATION_TYPE.get(divisions) ?? ["quarter", false];
}

// Greatest standard duration not exceeding `maxDivisions` (never below 1).
function largestFit(maxDivisions: number): number {
  return STANDARD_DURATIONS.find((d) => d <= maxDivisions) ?? 1;
}

// Split an arbitrary division span into a sum of standard durations (used to
// fill rest gaps). Ported from midi-to-musicxml's `decompose`.
function decompose(divisions: number): number[] {
  const result: number[] = [];
  let remaining = divisions;
  while (remaining > 0) {
    const value = STANDARD_DURATIONS.find((d) => d <= remaining);
    if (value === undefined) {
      break;
    }
    result.push(value);
    remaining -= value;
  }
  return result;
}

// ── Document plumbing ─────────────────────────────────────────────────────────

export function parseDocument(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Invalid MusicXML");
  }
  return doc;
}

// Serialize the live document back to a MusicXML string. The `<score-partwise>`
// root is serialized (rather than the whole Document) so the linkedom test
// shim, which exposes `outerHTML` on elements, works the same as the browser's
// real XMLSerializer.
export function serializeDocument(doc: Document): string {
  const root = doc.documentElement;
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(
    root,
  )}`;
}

// The `<measure>` elements of the (single) part, in document order.
function measuresOf(doc: Document): Element[] {
  const part = doc.querySelector("part");
  if (!part) {
    return [];
  }
  return Array.from(part.children).filter(
    (child) => child.tagName.toLowerCase() === "measure",
  );
}

// Divisions-per-quarter and total divisions per measure, read from the first
// measure's `<attributes>`.
function measureMetrics(doc: Document): {
  divisions: number;
  divisionsPerMeasure: number;
} {
  const attrEl = measuresOf(doc)[0]?.querySelector("attributes");
  const divisions =
    Number.parseInt(
      attrEl?.querySelector("divisions")?.textContent ?? "4",
      10,
    ) || 4;
  const beats =
    Number.parseInt(
      attrEl?.querySelector("time > beats")?.textContent ?? "4",
      10,
    ) || 4;
  const beatType =
    Number.parseInt(
      attrEl?.querySelector("time > beat-type")?.textContent ?? "4",
      10,
    ) || 4;
  return { divisions, divisionsPerMeasure: divisions * beats * (4 / beatType) };
}

// A real (pitched) note in a measure, with its element and timing in divisions.
interface RealNote {
  element: Element;
  onsetDivisions: number;
  durationDivisions: number;
}

// Walk a measure's children tracking the MusicXML time cursor (same logic as
// the parser's `collectStaffItems`), returning only the real notes — rests are
// dropped because `writeMeasure` regenerates them. Single voice, so the result
// is already onset-ordered and non-overlapping.
function readRealNotes(measureEl: Element, _divisions: number): RealNote[] {
  const notes: RealNote[] = [];
  let cursor = 0;
  let lastOnset = 0;
  for (const child of Array.from(measureEl.children)) {
    const tag = child.tagName.toLowerCase();
    if (tag === "note") {
      const isRest = child.querySelector("rest") !== null;
      const isGrace = child.querySelector("grace") !== null;
      const isChord = child.querySelector("chord") !== null;
      const durationDivisions = isGrace
        ? 0
        : Number.parseInt(
            child.querySelector("duration")?.textContent ?? "0",
            10,
          );
      const onset = isChord ? lastOnset : cursor;
      if (!isRest) {
        notes.push({
          element: child,
          onsetDivisions: onset,
          durationDivisions,
        });
      }
      if (!isChord && !isGrace) {
        lastOnset = cursor;
        cursor += durationDivisions;
      }
    } else if (tag === "backup") {
      cursor -= Number.parseInt(
        child.querySelector("duration")?.textContent ?? "0",
        10,
      );
    } else if (tag === "forward") {
      cursor += Number.parseInt(
        child.querySelector("duration")?.textContent ?? "0",
        10,
      );
    }
  }
  return notes;
}

// Re-emit a measure's note/rest run from a list of real notes (onset-ordered).
// Removes every existing `<note>` (rests and notes) and re-appends: each real
// note's *existing* element verbatim (reused — this is what makes the edit
// faithful) with freshly built `<rest>` notes filling every gap. Non-note
// siblings (`<attributes>`, etc.) keep their relative order; the notes are
// appended after them.
function writeMeasure(
  doc: Document,
  measureEl: Element,
  notes: RealNote[],
  divisionsPerMeasure: number,
): void {
  for (const noteEl of Array.from(measureEl.querySelectorAll("note"))) {
    noteEl.remove();
  }

  const ordered = [...notes].sort(
    (a, b) => a.onsetDivisions - b.onsetDivisions,
  );

  if (ordered.length === 0) {
    measureEl.appendChild(
      createRestElement(doc, {
        durationDivisions: divisionsPerMeasure,
        fullMeasure: true,
      }),
    );
    return;
  }

  let cursor = 0;
  for (const note of ordered) {
    if (note.onsetDivisions > cursor) {
      for (const span of decompose(note.onsetDivisions - cursor)) {
        measureEl.appendChild(
          createRestElement(doc, { durationDivisions: span }),
        );
      }
    }
    // appendChild moves the element here (from its old slot, or another measure
    // on a cross-measure relocation).
    measureEl.appendChild(note.element);
    cursor = note.onsetDivisions + note.durationDivisions;
  }
  if (cursor < divisionsPerMeasure) {
    for (const span of decompose(divisionsPerMeasure - cursor)) {
      measureEl.appendChild(
        createRestElement(doc, { durationDivisions: span }),
      );
    }
  }
}

// The handle for a note element after a rewrite (its index among the measure's
// `<note>` elements).
function handleFor(
  measures: Element[],
  measureIndex: number,
  element: Element,
): NoteHandle {
  const noteEls = Array.from(measures[measureIndex].querySelectorAll("note"));
  return { measureIndex, noteElementIndex: noteEls.indexOf(element) };
}

// ── Node builders ─────────────────────────────────────────────────────────────

function child(doc: Document, tag: string, text?: string): Element {
  const el = doc.createElement(tag);
  if (text !== undefined) {
    el.textContent = text;
  }
  return el;
}

function appendPitch(doc: Document, noteEl: Element, pitch: Pitch): void {
  const pitchEl = doc.createElement("pitch");
  pitchEl.appendChild(child(doc, "step", pitch.step));
  if (pitch.alter !== 0) {
    pitchEl.appendChild(child(doc, "alter", String(pitch.alter)));
  }
  pitchEl.appendChild(child(doc, "octave", String(pitch.octave)));
  noteEl.appendChild(pitchEl);
}

export function createNoteElement(
  doc: Document,
  options: {
    step: Pitch["step"];
    alter: number;
    octave: number;
    durationDivisions: number;
    type?: NoteType;
    dot?: boolean;
  },
): Element {
  const [defaultType, defaultDot] = typeDotForDivisions(
    options.durationDivisions,
  );
  const type = options.type ?? defaultType;
  const dot = options.dot ?? defaultDot;
  const noteEl = doc.createElement("note");
  appendPitch(doc, noteEl, {
    step: options.step,
    alter: options.alter,
    octave: options.octave,
  });
  noteEl.appendChild(child(doc, "duration", String(options.durationDivisions)));
  noteEl.appendChild(child(doc, "type", type));
  if (dot) {
    noteEl.appendChild(doc.createElement("dot"));
  }
  return noteEl;
}

export function createRestElement(
  doc: Document,
  options: { durationDivisions: number; fullMeasure?: boolean },
): Element {
  const noteEl = doc.createElement("note");
  const restEl = doc.createElement("rest");
  if (options.fullMeasure) {
    restEl.setAttribute("measure", "yes");
  }
  noteEl.appendChild(restEl);
  noteEl.appendChild(child(doc, "duration", String(options.durationDivisions)));
  // A full-measure rest is drawn as a whole rest regardless of meter; the
  // parser infers `type: "whole"` from `measure="yes"` when no <type> is given.
  if (!options.fullMeasure) {
    const [type, dot] = typeDotForDivisions(options.durationDivisions);
    noteEl.appendChild(child(doc, "type", type));
    if (dot) {
      noteEl.appendChild(doc.createElement("dot"));
    }
  }
  return noteEl;
}

// Mutate an existing note's `<pitch>` in place, preserving every other child
// (ties, articulations, lyrics, …). Used for pitch changes so expression
// elements survive.
function setPitch(doc: Document, noteEl: Element, pitch: Pitch): void {
  const existing = noteEl.querySelector("pitch");
  const pitchEl = doc.createElement("pitch");
  pitchEl.appendChild(child(doc, "step", pitch.step));
  if (pitch.alter !== 0) {
    pitchEl.appendChild(child(doc, "alter", String(pitch.alter)));
  }
  pitchEl.appendChild(child(doc, "octave", String(pitch.octave)));
  if (existing) {
    existing.replaceWith(pitchEl);
  } else {
    noteEl.insertBefore(pitchEl, noteEl.firstChild);
  }
}

// Mutate an existing note's `<duration>`/`<type>`/`<dot>` in place to a new
// standard span. Other children are untouched.
function setDuration(
  doc: Document,
  noteEl: Element,
  durationDivisions: number,
): void {
  const [type, dot] = typeDotForDivisions(durationDivisions);
  const durEl = noteEl.querySelector("duration");
  if (durEl) {
    durEl.textContent = String(durationDivisions);
  } else {
    noteEl.appendChild(child(doc, "duration", String(durationDivisions)));
  }
  const typeEl = noteEl.querySelector("type");
  if (typeEl) {
    typeEl.textContent = type;
  } else {
    noteEl.appendChild(child(doc, "type", type));
  }
  const dotEl = noteEl.querySelector("dot");
  if (dot && !dotEl) {
    noteEl.appendChild(doc.createElement("dot"));
  } else if (!dot && dotEl) {
    dotEl.remove();
  }
}

// ── Blank document ────────────────────────────────────────────────────────────

export function createBlankDocument(options?: {
  timeSigNum?: number;
  timeSigDen?: number;
  keyFifths?: number;
  clef?: { sign: "G" | "F"; line: number };
  measureCount?: number;
}): Document {
  const timeSigNum = options?.timeSigNum ?? 4;
  const timeSigDen = options?.timeSigDen ?? 4;
  const keyFifths = options?.keyFifths ?? 0;
  const clef = options?.clef ?? { sign: "G" as const, line: 2 };
  const measureCount = options?.measureCount ?? 4;
  const fullMeasureDur = DIVISIONS * timeSigNum * (4 / timeSigDen);

  const measures: string[] = [];
  for (let m = 0; m < measureCount; m++) {
    const attributes =
      m === 0
        ? `
      <attributes>
        <divisions>${DIVISIONS}</divisions>
        <key><fifths>${keyFifths}</fifths><mode>major</mode></key>
        <time><beats>${timeSigNum}</beats><beat-type>${timeSigDen}</beat-type></time>
        <clef><sign>${clef.sign}</sign><line>${clef.line}</line></clef>
      </attributes>`
        : "";
    measures.push(
      `    <measure number="${m + 1}">${attributes}
      <note><rest measure="yes"/><duration>${fullMeasureDur}</duration></note>
    </measure>`,
    );
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1">
      <part-name>Music</part-name>
    </score-part>
  </part-list>
  <part id="P1">
${measures.join("\n")}
  </part>
</score-partwise>`;
  return parseDocument(xml);
}

// ── Surgical operations ───────────────────────────────────────────────────────

// Insert a fresh note. The caller (hit-test) has already snapped the onset/pitch
// to the grid; the duration is fitted to the gap before the next existing note
// (or the barline) so single-voice notes never overlap and stay single, well-
// typed durations. Returns the new note's handle, or null if the target measure
// does not exist.
export function addNote(
  doc: Document,
  options: {
    measureIndex: number;
    onsetBeatInMeasure: number;
    durationBeats: number;
    pitch: Pitch;
  },
): NoteHandle | null {
  const measures = measuresOf(doc);
  const measureEl = measures[options.measureIndex];
  if (!measureEl) {
    return null;
  }
  const { divisions, divisionsPerMeasure } = measureMetrics(doc);
  const onsetDivisions = Math.max(
    0,
    Math.min(
      Math.round(options.onsetBeatInMeasure * divisions),
      divisionsPerMeasure - 1,
    ),
  );
  const requested = Math.max(1, Math.round(options.durationBeats * divisions));

  const notes = readRealNotes(measureEl, divisions);
  const nextOnset = notes.reduce(
    (min, note) =>
      note.onsetDivisions > onsetDivisions
        ? Math.min(min, note.onsetDivisions)
        : min,
    divisionsPerMeasure,
  );
  const fit = largestFit(Math.min(requested, nextOnset - onsetDivisions));

  const element = createNoteElement(doc, {
    step: options.pitch.step,
    alter: options.pitch.alter,
    octave: options.pitch.octave,
    durationDivisions: fit,
  });
  notes.push({ element, onsetDivisions, durationDivisions: fit });
  writeMeasure(doc, measureEl, notes, divisionsPerMeasure);
  return handleFor(measuresOf(doc), options.measureIndex, element);
}

// Locate the `<note>` element a handle refers to.
function elementForHandle(doc: Document, handle: NoteHandle): Element | null {
  const measureEl = measuresOf(doc)[handle.measureIndex];
  if (!measureEl) {
    return null;
  }
  return (
    Array.from(measureEl.querySelectorAll("note"))[handle.noteElementIndex] ??
    null
  );
}

// Remove a note; its span becomes rest (rebalanced by writeMeasure).
export function removeNote(doc: Document, handle: NoteHandle): void {
  const measures = measuresOf(doc);
  const measureEl = measures[handle.measureIndex];
  if (!measureEl) {
    return;
  }
  const { divisions, divisionsPerMeasure } = measureMetrics(doc);
  const target = elementForHandle(doc, handle);
  if (!target) {
    return;
  }
  const notes = readRealNotes(measureEl, divisions).filter(
    (note) => note.element !== target,
  );
  writeMeasure(doc, measureEl, notes, divisionsPerMeasure);
}

// Move a note to a new pitch and/or onset (possibly a different measure). The
// pitch is mutated in place (preserving the note's expression children); only
// when the onset moves and the available gap forces a shorter span is the
// duration adjusted. Returns the note's new handle, or null on a bad handle.
export function moveNote(
  doc: Document,
  handle: NoteHandle,
  target: { measureIndex: number; onsetBeatInMeasure: number; pitch: Pitch },
): NoteHandle | null {
  const measures = measuresOf(doc);
  const sourceMeasureEl = measures[handle.measureIndex];
  const destMeasureEl = measures[target.measureIndex];
  if (!sourceMeasureEl || !destMeasureEl) {
    return null;
  }
  const element = elementForHandle(doc, handle);
  if (!element) {
    return null;
  }
  const { divisions, divisionsPerMeasure } = measureMetrics(doc);

  // Pitch change is always a faithful in-place mutation.
  setPitch(doc, element, target.pitch);

  const onsetDivisions = Math.max(
    0,
    Math.min(
      Math.round(target.onsetBeatInMeasure * divisions),
      divisionsPerMeasure - 1,
    ),
  );

  // Destination notes (excluding the moving element, in case the move is within
  // the same measure).
  const destNotes = readRealNotes(destMeasureEl, divisions).filter(
    (note) => note.element !== element,
  );
  const nextOnset = destNotes.reduce(
    (min, note) =>
      note.onsetDivisions > onsetDivisions
        ? Math.min(min, note.onsetDivisions)
        : min,
    divisionsPerMeasure,
  );
  const currentDuration = Number.parseInt(
    element.querySelector("duration")?.textContent ?? "4",
    10,
  );
  const fit = largestFit(Math.min(currentDuration, nextOnset - onsetDivisions));
  if (fit !== currentDuration) {
    setDuration(doc, element, fit);
  }

  destNotes.push({ element, onsetDivisions, durationDivisions: fit });
  writeMeasure(doc, destMeasureEl, destNotes, divisionsPerMeasure);
  // A cross-measure move leaves a hole in the source measure to backfill.
  if (sourceMeasureEl !== destMeasureEl) {
    const sourceNotes = readRealNotes(sourceMeasureEl, divisions);
    writeMeasure(doc, sourceMeasureEl, sourceNotes, divisionsPerMeasure);
  }
  return handleFor(measuresOf(doc), target.measureIndex, element);
}
