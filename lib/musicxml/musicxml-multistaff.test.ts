import { describe, expect, test } from "bun:test";
import { isRest, parseScore } from "./musicxml-parser";
import { musicXmlToConversion } from "./musicxml-playback";
import type { ChordGroup } from "./sheet-music-types";

// A minimal two-staff piano part: treble (staff 1) over bass (staff 2), written
// with <backup> the way real exporters do. divisions=8 exercises the
// normalization to the layout's base grid (4 per quarter). 2/4, one measure:
//   treble: C5 quarter, D5 quarter
//   bass:   C3 quarter, G3 quarter
const TWO_STAFF = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>8</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>2</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>8</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>8</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

describe("multi-staff parsing", () => {
  test("splits a two-staff part into a treble and a bass part", () => {
    const score = parseScore(TWO_STAFF);
    expect(score.parts).toHaveLength(2);
    expect(score.parts[0].clef.sign).toBe("G");
    expect(score.parts[1].clef.sign).toBe("F");
    expect(score.numMeasures).toBe(1);
  });

  test("normalizes durations to the base grid and keeps each staff's notes", () => {
    const score = parseScore(TWO_STAFF);
    const treble = score.parts[0].measures[0].events as ChordGroup[];
    const bass = score.parts[1].measures[0].events as ChordGroup[];
    // divisions normalized 8 -> 4, so quarter notes read as duration 4.
    expect(score.parts[0].measures[0].divisions).toBe(4);
    expect(treble.map((e) => e.notes[0].pitch.step)).toEqual(["C", "D"]);
    expect(treble.map((e) => e.duration)).toEqual([4, 4]);
    expect(bass.map((e) => e.notes[0].pitch.step)).toEqual(["C", "G"]);
    expect(bass.every((e) => e.notes[0].pitch.octave === 3)).toBe(true);
  });

  test("derives playback notes on both staves with onsets in beats", () => {
    const { notes, totalBeats } = musicXmlToConversion(TWO_STAFF);
    expect(totalBeats).toBe(2);
    const treble = notes.filter((n) => n.partIndex === 0);
    const bass = notes.filter((n) => n.partIndex === 1);
    expect(treble.map((n) => n.startBeat)).toEqual([0, 1]);
    expect(bass.map((n) => n.startBeat)).toEqual([0, 1]);
    expect(treble.map((n) => n.durationBeats)).toEqual([1, 1]);
    // C5 = 72, D5 = 74; C3 = 48, G3 = 55.
    expect(treble.map((n) => n.noteNumber)).toEqual([72, 74]);
    expect(bass.map((n) => n.noteNumber)).toEqual([48, 55]);
  });

  test("every derived playback note maps to a rendered note id", () => {
    const score = parseScore(TWO_STAFF);
    const renderedIds = new Set<string>();
    score.parts.forEach((part, p) => {
      for (const measure of part.measures) {
        for (const event of measure.events) {
          if (isRest(event)) {
            continue;
          }
          event.notes.forEach((_, vi) => {
            renderedIds.add(
              `p${p}-m${measure.number}-n${event.noteIndex}-v${vi}`,
            );
          });
        }
      }
    });
    for (const note of musicXmlToConversion(TWO_STAFF).notes) {
      const id = `p${note.partIndex}-m${note.measureNumber}-n${note.noteIndex}-v${note.voiceIndex}`;
      expect(renderedIds.has(id)).toBe(true);
    }
  });

  test("a staff that ends early gets a trailing rest and correct note durations", () => {
    // Treble: C5 quarter + D5 quarter (2 beats). Bass: C3 half (2 beats).
    // Both staves fill a 2/4 measure, but treble has two separate onsets while
    // bass has only one. The treble's D5 (last note) must have duration 1 beat,
    // NOT 2 beats (which would happen if it were anchored to the bass's end).
    const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions><key><fifths>0</fifths></key>
        <time><beats>2</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <backup><duration>8</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>8</duration><voice>5</voice><type>half</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;
    const { notes } = musicXmlToConversion(xml);
    const treble = notes.filter((n) => n.partIndex === 0);
    const bass = notes.filter((n) => n.partIndex === 1);

    // Both treble notes must start at the correct beat.
    expect(treble.map((n) => n.startBeat)).toEqual([0, 1]);
    // Each treble note should only last 1 beat — not be stretched to 2.
    expect(treble.map((n) => n.durationBeats)).toEqual([1, 1]);

    // Bass half note: 2 beats.
    expect(bass.map((n) => n.startBeat)).toEqual([0]);
    expect(bass.map((n) => n.durationBeats)).toEqual([2]);
  });

  test("a staff that enters late gets a leading rest", () => {
    // Bass rests for the first quarter, then plays C3.
    const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions><key><fifths>0</fifths></key>
        <time><beats>2</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <backup><duration>8</duration></backup>
      <note><rest/><duration>4</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;
    const bass = parseScore(xml).parts[1].measures[0].events;
    expect(isRest(bass[0])).toBe(true);
    expect(isRest(bass[1])).toBe(false);
    expect((bass[1] as ChordGroup).notes[0].pitch.step).toBe("C");
  });
});
