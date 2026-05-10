import type {
  ChordGroup,
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
    return {
      id,
      measures,
      clef: first?.clef ?? { sign: "G", line: 2 },
      timeSig: first?.timeSig ?? { beats: 4, beatType: 4 },
      keySig: first?.keySig ?? { fifths: 0, mode: "major" },
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

  const rawItems = Array.from(el.querySelectorAll("note")).map(parseRawNote);
  const events = groupEvents(rawItems);

  // Assign noteIndex sequentially to ChordGroups (rests don't count)
  let noteIndex = 0;
  for (const event of events) {
    if (!isRest(event)) {
      event.noteIndex = noteIndex++;
    }
  }

  return { number, timeSig, keySig, clef, events };
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

  const durationText = el.querySelector("duration")?.textContent ?? "4";
  const duration = Number.parseInt(durationText, 10);

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
  const alter = alterText ? (Number.parseInt(alterText, 10) as 0 | 1) : 0;
  const octave = Number.parseInt(
    pitchEl?.querySelector("octave")?.textContent ?? "4",
    10,
  );

  const ties = Array.from(el.querySelectorAll("tie"));
  const tieStart = ties.some((t) => t.getAttribute("type") === "start");
  const tieStop = ties.some((t) => t.getAttribute("type") === "stop");

  return {
    kind: "note",
    pitch: { step, alter, octave },
    duration,
    type,
    dot,
    tieStart,
    tieStop,
    isChordMember,
    showAccidental: alter !== 0,
  };
}

function groupEvents(items: Array<ParsedNote | ParsedRest>): MeasureEvent[] {
  const events: MeasureEvent[] = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    if (item.kind === "rest") {
      events.push(item);
      i++;
      continue;
    }
    // Collect this note plus any immediately following chord members
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
    const chord: ChordGroup = {
      notes: group,
      duration: group[0].duration,
      type: group[0].type,
      dot: group[0].dot,
      noteIndex: -1, // filled by caller
    };
    events.push(chord);
  }
  return events;
}

export function isRest(event: MeasureEvent): event is ParsedRest {
  return "kind" in event && event.kind === "rest";
}
