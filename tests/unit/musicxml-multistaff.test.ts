import { describe, expect, test } from "bun:test";
import {
  type ChordGroup,
  eventXsFromSpine,
  isRest,
  parseScore,
  resolveLayout,
} from "@jbergknoff/sheet-music-display";
import { musicXmlToConversion } from "../../lib/musicxml/musicxml-playback";

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

  test("treble ending early in 4/4 does not stretch the last note to the bass's end", () => {
    // 4/4 measure: treble has two quarter notes ending at beat 2 (no explicit
    // trailing rest); bass has a whole note lasting all 4 beats.
    // Without the fix, buildStaffEvents would anchor D5's duration to the
    // *global* content end (beat 4) instead of the *treble* content end (beat 2),
    // giving D5 a durationBeats of 3 instead of the correct 1.
    const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions><key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <backup><duration>8</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;
    const { notes } = musicXmlToConversion(xml);
    const treble = notes.filter((n) => n.partIndex === 0);
    const bass = notes.filter((n) => n.partIndex === 1);

    // Treble: C5 at beat 0, D5 at beat 1 — each lasts exactly 1 beat.
    expect(treble.map((n) => n.startBeat)).toEqual([0, 1]);
    expect(treble.map((n) => n.durationBeats)).toEqual([1, 1]);

    // Bass whole note: 4 beats.
    expect(bass.map((n) => n.startBeat)).toEqual([0]);
    expect(bass.map((n) => n.durationBeats)).toEqual([4]);
  });

  test("a staff that enters late has a leading rest and correct note starts", () => {
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

  test("a 3-against-2 measure aligns simultaneous triplet and eighth notes on one column", () => {
    // Debussy Arabesque measure 6, reduced to the essential cross-rhythm: a 4/4
    // bar (divisions=6) whose treble is a quarter rest then triplet eighths
    // (duration 2 → 4/3 of a normalized division) over beats 1–3, while the bass
    // is straight eighths (duration 3 → 2 normalized). On beat 2 the treble note
    // (normalized onset 4 + 4/3 + 4/3 + 4/3) and the bass note (normalized onset
    // 2·4) are simultaneous, but those float onset sums land on 7.999999999999999
    // vs 8 — one ULP apart. Before quantization the layout's onset Set treated
    // them as two columns MIN_EVENT_ADVANCE (18px) apart, drawing the noteheads
    // misaligned even though wait mode (which uses exact-tick playback beats)
    // correctly required them together. They must share one x column. (Beats 1
    // and 3 don't drift — their sums land back exactly on 4 and 12 — so beat 2 is
    // the one that regresses.)
    const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>6</divisions><key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><rest/><duration>6</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><staff>1</staff></note>
      <note><pitch><step>F</step><alter>1</alter><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><staff>1</staff></note>
      <note><pitch><step>C</step><alter>1</alter><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><staff>1</staff></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><staff>1</staff></note>
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><staff>1</staff></note>
      <note><pitch><step>C</step><alter>1</alter><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><staff>1</staff></note>
      <note><pitch><step>G</step><alter>1</alter><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><staff>1</staff></note>
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><staff>1</staff></note>
      <note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><staff>1</staff></note>
      <backup><duration>24</duration></backup>
      <note><pitch><step>E</step><octave>2</octave></pitch><duration>3</duration><voice>5</voice><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>B</step><octave>2</octave></pitch><duration>3</duration><voice>5</voice><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>3</duration><voice>5</voice><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>G</step><alter>1</alter><octave>3</octave></pitch><duration>3</duration><voice>5</voice><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>B</step><octave>3</octave></pitch><duration>3</duration><voice>5</voice><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>G</step><alter>1</alter><octave>3</octave></pitch><duration>3</duration><voice>5</voice><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>3</duration><voice>5</voice><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>B</step><octave>2</octave></pitch><duration>3</duration><voice>5</voice><type>eighth</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;
    const score = parseScore(xml);
    const layout = resolveLayout(score);
    const spine = layout.measureSpines[0];

    const trebleXs = eventXsFromSpine(score.parts[0].measures[0].events, spine);
    const bassXs = eventXsFromSpine(score.parts[1].measures[0].events, spine);

    // Treble events: [rest, t1..t9]. The beat-2 downbeat is the 4th triplet,
    // event index 4. Bass events: 8 eighths; beat 2 is the 5th, event index 4.
    // These are simultaneous and must render at the same x.
    expect(trebleXs[4]).toBe(bassXs[4]);

    // Beats 1 and 3 coincidences too (treble indices 1 and 7, bass indices 2 and
    // 6), plus the downbeat (bass index 0, treble rest occupies beat 0).
    expect(trebleXs[1]).toBe(bassXs[2]);
    expect(trebleXs[7]).toBe(bassXs[6]);

    // The spine must have no near-duplicate columns: every gap between adjacent
    // onsets is a real musical gap, not an ULP-sized sliver.
    for (let k = 1; k < spine.divs.length; k++) {
      expect(spine.divs[k] - spine.divs[k - 1]).toBeGreaterThan(1e-3);
    }
  });
});

describe("clef changes", () => {
  // Two staves, two measures. Staff 2 opens in bass, changes to treble mid-way
  // through measure 1 (a new <attributes>/<clef> block after two quarter notes),
  // then changes back to bass at the start of measure 2. Mirrors the Debussy
  // Arabesque, whose left hand crosses between bass and treble mid-measure.
  const MID_MEASURE_CLEF = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions><key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>4</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>
      <attributes><clef number="2"><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>
    </measure>
    <measure number="2">
      <attributes><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>G</step><octave>2</octave></pitch><duration>16</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

  test("a mid-measure clef change tags only the chords after it", () => {
    const bass = parseScore(MID_MEASURE_CLEF).parts[1];
    const events = bass.measures[0].events as ChordGroup[];
    // The measure starts in bass (F clef), so its start clef is F4 and the first
    // two chords (before the change) carry no clef override.
    expect(bass.measures[0].clef).toMatchObject({ sign: "F", line: 4 });
    expect(events[0].clef).toBeUndefined();
    expect(events[1].clef).toBeUndefined();
    // The chords after the mid-measure change are tagged with the new (treble) clef.
    expect(events[2].clef).toMatchObject({ sign: "G", line: 2 });
    expect(events[3].clef).toMatchObject({ sign: "G", line: 2 });
    // A mid-measure change is not a barline change, so no clefChange glyph fires.
    expect(bass.measures[0].clefChange).toBeUndefined();
  });

  test("the running clef carries the last mid-measure clef into the next measure", () => {
    const bass = parseScore(MID_MEASURE_CLEF).parts[1];
    // Measure 1 ends in treble (the mid-measure change); measure 2 re-declares
    // bass at its barline, so it starts in bass and records a clefChange.
    expect(bass.measures[1].clef).toMatchObject({ sign: "F", line: 4 });
    expect(bass.measures[1].clefChange).toMatchObject({ sign: "F", line: 4 });
    // The unchanged treble staff never records a clef change.
    const treble = parseScore(MID_MEASURE_CLEF).parts[0];
    expect(treble.measures[1].clefChange).toBeUndefined();
    expect(treble.measures[1].clef).toMatchObject({ sign: "G", line: 2 });
  });

  test("the initial part clef is the first declared clef, not a default", () => {
    const score = parseScore(MID_MEASURE_CLEF);
    expect(score.parts[0].clef).toMatchObject({ sign: "G", line: 2 });
    expect(score.parts[1].clef).toMatchObject({ sign: "F", line: 4 });
  });

  test("a single-staff part resolves a measure-start clef change", () => {
    // A cello-style single-staff part that switches to treble for a high
    // passage in measure 2, then back to bass in measure 3.
    const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Cello</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions><key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
    <measure number="2">
      <attributes><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
    <measure number="3">
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;
    const part = parseScore(xml).parts[0];
    expect(part.clef).toMatchObject({ sign: "F", line: 4 });
    expect(part.measures[0].clef).toMatchObject({ sign: "F", line: 4 });
    // Measure 2 switches to treble and records the change...
    expect(part.measures[1].clef).toMatchObject({ sign: "G", line: 2 });
    expect(part.measures[1].clefChange).toMatchObject({ sign: "G", line: 2 });
    // ...and measure 3 carries the treble clef forward (it declares none).
    expect(part.measures[2].clef).toMatchObject({ sign: "G", line: 2 });
    expect(part.measures[2].clefChange).toBeUndefined();
  });
});
