import { describe, expect, test } from "bun:test";
import {
  addNote,
  createBlankDocument,
  moveNote,
  type NoteHandle,
  parseDocument,
  removeNote,
  serializeDocument,
} from "./dom-edit";
import {
  type ChordGroup,
  isRest,
  type ParsedScore,
  parseScore,
} from "./sheet-music/index";

function reparse(doc: Document): ParsedScore {
  return parseScore(serializeDocument(doc));
}

// Flatten a score's chords with their measure index and absolute onset beat.
function chords(
  score: ParsedScore,
): Array<{ measureIndex: number; onsetBeat: number; chord: ChordGroup }> {
  const result: Array<{
    measureIndex: number;
    onsetBeat: number;
    chord: ChordGroup;
  }> = [];
  score.parts[0].measures.forEach((measure, measureIndex) => {
    let onsetBeat = 0;
    const divisions = measure.divisions || 4;
    for (const event of measure.events) {
      if (!isRest(event)) {
        result.push({ measureIndex, onsetBeat, chord: event });
      }
      onsetBeat += event.duration / divisions;
    }
  });
  return result;
}

describe("createBlankDocument", () => {
  test("produces a parseable empty score of the requested size", () => {
    const score = reparse(createBlankDocument({ measureCount: 3 }));
    expect(score.parts.length).toBe(1);
    expect(score.parts[0].measures.length).toBe(3);
    expect(score.numMeasures).toBe(3);
    // Every measure is a single full-measure rest.
    for (const measure of score.parts[0].measures) {
      expect(measure.events.length).toBe(1);
      expect(isRest(measure.events[0])).toBe(true);
    }
    expect(score.parts[0].timeSig).toEqual({ beats: 4, beatType: 4 });
    expect(score.parts[0].clef).toEqual({ sign: "G", line: 2 });
  });
});

describe("addNote", () => {
  test("inserts a note at the snapped measure/onset/pitch/duration", () => {
    const doc = createBlankDocument();
    const handle = addNote(doc, {
      measureIndex: 0,
      onsetBeatInMeasure: 0,
      durationBeats: 1,
      pitch: { step: "C", alter: 0, octave: 5 },
    });
    expect(handle).not.toBeNull();

    const score = reparse(doc);
    const placed = chords(score);
    expect(placed.length).toBe(1);
    expect(placed[0].measureIndex).toBe(0);
    expect(placed[0].onsetBeat).toBe(0);
    expect(placed[0].chord.type).toBe("quarter");
    expect(placed[0].chord.notes[0].pitch).toEqual({
      step: "C",
      alter: 0,
      octave: 5,
    });
  });

  test("fits the duration to the gap before an existing note", () => {
    const doc = createBlankDocument();
    // A quarter at beat 1, then a whole note requested at beat 0 — it must
    // shrink to a quarter so it does not overlap.
    addNote(doc, {
      measureIndex: 0,
      onsetBeatInMeasure: 1,
      durationBeats: 1,
      pitch: { step: "E", alter: 0, octave: 5 },
    });
    addNote(doc, {
      measureIndex: 0,
      onsetBeatInMeasure: 0,
      durationBeats: 4,
      pitch: { step: "C", alter: 0, octave: 5 },
    });
    const placed = chords(reparse(doc));
    expect(placed.map((p) => p.onsetBeat)).toEqual([0, 1]);
    expect(placed[0].chord.type).toBe("quarter");
    expect(placed[0].chord.notes[0].pitch.step).toBe("C");
  });
});

describe("moveNote", () => {
  test("pitch-only change keeps the onset", () => {
    const doc = createBlankDocument();
    const handle = addNote(doc, {
      measureIndex: 0,
      onsetBeatInMeasure: 0,
      durationBeats: 1,
      pitch: { step: "C", alter: 0, octave: 5 },
    }) as NoteHandle;
    const moved = moveNote(doc, handle, {
      measureIndex: 0,
      onsetBeatInMeasure: 0,
      pitch: { step: "G", alter: 0, octave: 5 },
    });
    expect(moved).not.toBeNull();
    const placed = chords(reparse(doc));
    expect(placed.length).toBe(1);
    expect(placed[0].onsetBeat).toBe(0);
    expect(placed[0].chord.notes[0].pitch.step).toBe("G");
  });

  test("onset change relocates the note", () => {
    const doc = createBlankDocument();
    const handle = addNote(doc, {
      measureIndex: 0,
      onsetBeatInMeasure: 0,
      durationBeats: 1,
      pitch: { step: "C", alter: 0, octave: 5 },
    }) as NoteHandle;
    moveNote(doc, handle, {
      measureIndex: 0,
      onsetBeatInMeasure: 2,
      pitch: { step: "C", alter: 0, octave: 5 },
    });
    const placed = chords(reparse(doc));
    expect(placed.length).toBe(1);
    expect(placed[0].onsetBeat).toBe(2);
  });

  test("can move a note into another measure", () => {
    const doc = createBlankDocument({ measureCount: 2 });
    const handle = addNote(doc, {
      measureIndex: 0,
      onsetBeatInMeasure: 0,
      durationBeats: 1,
      pitch: { step: "C", alter: 0, octave: 5 },
    }) as NoteHandle;
    moveNote(doc, handle, {
      measureIndex: 1,
      onsetBeatInMeasure: 1,
      pitch: { step: "D", alter: 0, octave: 5 },
    });
    const placed = chords(reparse(doc));
    expect(placed.length).toBe(1);
    expect(placed[0].measureIndex).toBe(1);
    expect(placed[0].onsetBeat).toBe(1);
    expect(placed[0].chord.notes[0].pitch.step).toBe("D");
  });
});

describe("removeNote", () => {
  test("turns the note's span back into rest", () => {
    const doc = createBlankDocument();
    const handle = addNote(doc, {
      measureIndex: 0,
      onsetBeatInMeasure: 0,
      durationBeats: 1,
      pitch: { step: "C", alter: 0, octave: 5 },
    }) as NoteHandle;
    removeNote(doc, handle);
    const score = reparse(doc);
    expect(chords(score).length).toBe(0);
    expect(score.parts[0].measures[0].events.every(isRest)).toBe(true);
  });
});

describe("fidelity", () => {
  // A two-note measure where the first note carries an articulation and a lyric
  // (neither modelled by the editor). Moving the *second* note must leave the
  // first note's expression elements byte-for-byte intact.
  const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
        <lyric><text>la</text></lyric>
        <notations><articulations><staccato/></articulations></notations>
      </note>
      <note>
        <pitch><step>E</step><octave>5</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>`;

  test("untouched note's expression elements survive a move of another note", () => {
    const doc = parseDocument(FIXTURE);
    // The E note is the 2nd <note> element in measure 0.
    moveNote(
      doc,
      { measureIndex: 0, noteElementIndex: 1 },
      {
        measureIndex: 0,
        onsetBeatInMeasure: 2,
        pitch: { step: "F", alter: 0, octave: 5 },
      },
    );
    const serialized = serializeDocument(doc);
    // The first note's articulation and lyric are still present and intact.
    expect(serialized).toContain("<staccato");
    expect(serialized).toContain("<lyric><text>la</text></lyric>");
    // And it still parses as a staccato C5.
    const score = parseScore(serialized);
    const firstChord = chords(score)[0].chord;
    expect(firstChord.notes[0].pitch.step).toBe("C");
    expect(firstChord.notes[0].staccato).toBe(true);
  });
});
