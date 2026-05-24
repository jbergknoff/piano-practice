import type {
  AccidentalKind,
  ChordGroup,
  GraceGroup,
  MeasureEvent,
  NoteType,
  ParsedMeasure,
  ParsedNote,
  ParsedPart,
  ParsedRest,
  ParsedScore,
  Pitch,
} from "./sheet-music-types";

const DIATONIC: Record<string, number> = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
};

export function diatonicIndex(pitch: Pitch): number {
  return DIATONIC[pitch.step] + pitch.octave * 7;
}

export function parseScore(xml: string): ParsedScore {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Invalid MusicXML");
  }

  const scorePartEls = Array.from(
    doc.querySelectorAll("part-list > score-part"),
  );
  const partEls = Array.from(doc.querySelectorAll("score-partwise > part"));

  const parts: ParsedPart[] = scorePartEls.map((scorePartEl, i) => {
    const id = scorePartEl.getAttribute("id") ?? `P${i + 1}`;
    const partEl = partEls[i];
    const measures = partEl ? parseMeasures(partEl) : [];
    const first = measures[0];
    const keySig = first?.keySig ?? { fifths: 0, mode: "major" };
    // Resolve the key in effect for each measure: a measure carries the running
    // key forward unless its <attributes> declares a different one, in which
    // case it starts a key change (rendered with cancel naturals + new accidentals).
    let runningFifths = keySig.fifths;
    // divisions (ticks per quarter note) likewise carries forward from the last
    // measure that declared one; default to 4 if the file never declares it.
    let runningDivisions =
      measures.find((m) => m.divisions > 0)?.divisions ?? 4;
    measures.forEach((measure, m) => {
      const declared = measure.keySig;
      if (m === 0) {
        runningFifths = declared?.fifths ?? runningFifths;
      } else if (declared && declared.fifths !== runningFifths) {
        measure.keyChange = {
          fifths: declared.fifths,
          prevFifths: runningFifths,
        };
        runningFifths = declared.fifths;
      }
      measure.activeFifths = runningFifths;
      if (measure.divisions > 0) {
        runningDivisions = measure.divisions;
      }
      measure.divisions = runningDivisions;
      assignMeasureAccidentals(measure.events, runningFifths);
    });
    return {
      id,
      measures,
      clef: first?.clef ?? { sign: "G", line: 2 },
      timeSig: first?.timeSig ?? { beats: 4, beatType: 4 },
      keySig,
    };
  });

  return { parts, numMeasures: parts[0]?.measures.length ?? 0 };
}

function parseMeasures(partEl: Element): ParsedMeasure[] {
  return Array.from(partEl.querySelectorAll("measure")).map(parseMeasure);
}

function parseMeasure(el: Element): ParsedMeasure {
  const number = Number.parseInt(el.getAttribute("number") ?? "1", 10);

  const attrEl = el.querySelector("attributes");
  const timeSig = attrEl ? parseTimeSig(attrEl) : undefined;
  const keySig = attrEl ? parseKeySig(attrEl) : undefined;
  const clef = attrEl ? parseClef(attrEl) : undefined;
  // 0 is a sentinel for "not declared here"; parseScore resolves the running value.
  const divisions = attrEl
    ? Number.parseInt(attrEl.querySelector("divisions")?.textContent ?? "0", 10)
    : 0;

  const rawItems = Array.from(el.querySelectorAll("note")).map(parseRawNote);
  const events = groupEvents(rawItems);

  // Assign noteIndex sequentially to grace groups and ChordGroups (rests don't count).
  // Grace groups and regular chords share the same counter so their IDs are unique.
  let noteIndex = 0;
  for (const event of events) {
    if (!isRest(event)) {
      const chord = event as ChordGroup;
      for (const gg of chord.gracesBefore ?? []) {
        gg.noteIndex = noteIndex++;
      }
      chord.noteIndex = noteIndex++;
    }
  }

  // activeFifths is a placeholder here; parseScore resolves the running key
  // across measures and overwrites it.
  return {
    number,
    timeSig,
    keySig,
    clef,
    events,
    divisions,
    activeFifths: keySig?.fifths ?? 0,
  };
}

function parseTimeSig(
  el: Element,
): { beats: number; beatType: number } | undefined {
  const timeEl = el.querySelector("time");
  if (!timeEl) {
    return undefined;
  }
  const beats = Number.parseInt(
    timeEl.querySelector("beats")?.textContent ?? "4",
    10,
  );
  const beatType = Number.parseInt(
    timeEl.querySelector("beat-type")?.textContent ?? "4",
    10,
  );
  return { beats, beatType };
}

function parseKeySig(
  el: Element,
): { fifths: number; mode: string } | undefined {
  const keyEl = el.querySelector("key");
  if (!keyEl) {
    return undefined;
  }
  const fifths = Number.parseInt(
    keyEl.querySelector("fifths")?.textContent ?? "0",
    10,
  );
  const mode = keyEl.querySelector("mode")?.textContent ?? "major";
  return { fifths, mode };
}

function parseClef(el: Element): { sign: "G" | "F"; line: number } | undefined {
  const clefEl = el.querySelector("clef");
  if (!clefEl) {
    return undefined;
  }
  const sign = (clefEl.querySelector("sign")?.textContent ?? "G") as "G" | "F";
  const line = Number.parseInt(
    clefEl.querySelector("line")?.textContent ?? "2",
    10,
  );
  return { sign, line };
}

function parseRawNote(el: Element): ParsedNote | ParsedRest {
  const restEl = el.querySelector("rest");
  const isRestEl = restEl !== null;
  const fullMeasure = restEl?.getAttribute("measure") === "yes";

  // Grace notes have <grace/> instead of (or in addition to) <duration>.
  const graceEl = el.querySelector("grace");
  const isGrace = graceEl !== null;

  // Grace notes carry no rhythmic duration — treat as 0.
  const durationText = el.querySelector("duration")?.textContent;
  const duration = isGrace ? 0 : Number.parseInt(durationText ?? "4", 10);

  const typeText = el.querySelector("type")?.textContent;
  const type: NoteType =
    fullMeasure && !typeText ? "whole" : ((typeText ?? "quarter") as NoteType);

  const dot = el.querySelector("dot") !== null;
  const isChordMember = el.querySelector("chord") !== null;

  if (isRestEl) {
    return { kind: "rest", duration, type, dot, fullMeasure };
  }

  const pitchEl = el.querySelector("pitch");
  const step = (pitchEl?.querySelector("step")?.textContent ??
    "C") as Pitch["step"];
  const alterText = pitchEl?.querySelector("alter")?.textContent;
  const alter = alterText ? Number.parseInt(alterText, 10) : 0;
  const octave = Number.parseInt(
    pitchEl?.querySelector("octave")?.textContent ?? "4",
    10,
  );

  const ties = Array.from(el.querySelectorAll("tie"));
  const tieStart = ties.some((t) => t.getAttribute("type") === "start");
  const tieStop = ties.some((t) => t.getAttribute("type") === "stop");

  const staccato =
    el.querySelector("notations > articulations > staccato") !== null;

  const note: ParsedNote = {
    kind: "note",
    pitch: { step, alter, octave },
    duration,
    type,
    dot,
    tieStart,
    tieStop,
    isChordMember,
    // Provisional; replaced by assignMeasureAccidentals once the measure's
    // running accidental state (and the key signature) are known.
    accidental: "none",
    staccato,
  };
  if (isGrace) {
    note.grace = { slash: graceEl.getAttribute("slash") === "yes" };
  }
  return note;
}

// Order in which sharps / flats are added by the key signature.
const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];
const FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"];

// The alteration the key signature imposes on a given step (+1 sharp, -1 flat).
function keyAlterForStep(step: string, fifths: number): number {
  if (fifths > 0) {
    return SHARP_ORDER.slice(0, fifths).includes(step) ? 1 : 0;
  }
  if (fifths < 0) {
    return FLAT_ORDER.slice(0, -fifths).includes(step) ? -1 : 0;
  }
  return 0;
}

// Walk a measure's events in onset order, deciding which notes need a printed
// accidental. The active alteration for each (step, octave) starts at whatever
// the key signature dictates and is updated by every explicit accidental, so a
// pitch sharped earlier in the measure shows a natural when it returns, and a
// repeated sharp is not redrawn.
//
// Grace note groups that precede a chord are processed first (left to right),
// matching their left-to-right display order.
function assignMeasureAccidentals(
  events: MeasureEvent[],
  fifths: number,
): void {
  const active = new Map<string, number>();

  function assignForNotes(notes: ParsedNote[]) {
    for (const note of notes) {
      const key = `${note.pitch.step}${note.pitch.octave}`;
      const current = active.has(key)
        ? (active.get(key) as number)
        : keyAlterForStep(note.pitch.step, fifths);
      const alter = note.pitch.alter;
      if (alter === current) {
        note.accidental = "none";
        continue;
      }
      const glyph: AccidentalKind =
        alter > 0 ? "sharp" : alter < 0 ? "flat" : "natural";
      note.accidental = glyph;
      active.set(key, alter);
    }
  }

  for (const event of events) {
    if (isRest(event)) {
      continue;
    }
    // Grace notes appear visually before the main chord — process them first.
    for (const graceGroup of (event as ChordGroup).gracesBefore ?? []) {
      assignForNotes(graceGroup.notes);
    }
    assignForNotes(event.notes);
  }
}

function groupEvents(items: Array<ParsedNote | ParsedRest>): MeasureEvent[] {
  const events: MeasureEvent[] = [];
  // Buffer grace notes until we find the main chord they precede.
  const pendingGraceGroups: GraceGroup[] = [];

  let i = 0;
  while (i < items.length) {
    const item = items[i];

    if (item.kind === "rest") {
      // Flush any pending grace notes before the rest (attach to the rest is
      // not supported — discard them; this is an unusual edge case).
      pendingGraceGroups.length = 0;
      events.push(item);
      i++;
      continue;
    }

    // Collect this note plus any immediately following chord members.
    const group: ParsedNote[] = [item];
    i++;
    while (
      i < items.length &&
      items[i].kind === "note" &&
      (items[i] as ParsedNote).isChordMember
    ) {
      group.push(items[i] as ParsedNote);
      i++;
    }

    // Sort low→high by diatonic index
    group.sort((a, b) => diatonicIndex(a.pitch) - diatonicIndex(b.pitch));

    if (group[0].grace) {
      // This is a grace note group. Buffer it until the following main chord.
      pendingGraceGroups.push({
        notes: group,
        slash: group[0].grace.slash,
        noteIndex: -1, // filled by parseMeasure
      });
      continue;
    }

    // Regular chord — attach any buffered grace groups and clear the buffer.
    const chord: ChordGroup = {
      notes: group,
      duration: group[0].duration,
      type: group[0].type,
      dot: group[0].dot,
      noteIndex: -1, // filled by caller
      gracesBefore:
        pendingGraceGroups.length > 0 ? [...pendingGraceGroups] : undefined,
    };
    pendingGraceGroups.length = 0;
    events.push(chord);
  }

  // If grace notes appear at the very end of a measure with no following note,
  // discard them (this shouldn't happen in well-formed MusicXML).
  return events;
}

export function isRest(event: MeasureEvent): event is ParsedRest {
  return "kind" in event && event.kind === "rest";
}
