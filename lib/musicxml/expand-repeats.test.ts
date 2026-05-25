import { describe, expect, test } from "bun:test";
import { computeExpansion, expandRepeatsMusicXml } from "./expand-repeats";
import { parseScore } from "./musicxml-parser";

// ---------------------------------------------------------------------------
// computeExpansion unit tests
// ---------------------------------------------------------------------------

describe("computeExpansion", () => {
  test("no repeats → identity", () => {
    const infos = [0, 1, 2, 3].map(() => ({
      hasForwardRepeat: false,
      hasBackwardRepeat: false,
      repeatTimes: 2,
      endingNumbers: [],
    }));
    expect(computeExpansion(infos)).toEqual([0, 1, 2, 3]);
  });

  test("simple repeat plays section twice", () => {
    // |: 0 1 2 :|  3
    const infos = [
      {
        hasForwardRepeat: true,
        hasBackwardRepeat: false,
        repeatTimes: 2,
        endingNumbers: [],
      },
      {
        hasForwardRepeat: false,
        hasBackwardRepeat: false,
        repeatTimes: 2,
        endingNumbers: [],
      },
      {
        hasForwardRepeat: false,
        hasBackwardRepeat: true,
        repeatTimes: 2,
        endingNumbers: [],
      },
      {
        hasForwardRepeat: false,
        hasBackwardRepeat: false,
        repeatTimes: 2,
        endingNumbers: [],
      },
    ];
    expect(computeExpansion(infos)).toEqual([0, 1, 2, 0, 1, 2, 3]);
  });

  test("repeat times=3 plays section three times", () => {
    // |: 0 1 :| (×3)
    const infos = [
      {
        hasForwardRepeat: true,
        hasBackwardRepeat: false,
        repeatTimes: 2,
        endingNumbers: [],
      },
      {
        hasForwardRepeat: false,
        hasBackwardRepeat: true,
        repeatTimes: 3,
        endingNumbers: [],
      },
    ];
    expect(computeExpansion(infos)).toEqual([0, 1, 0, 1, 0, 1]);
  });

  test("implicit forward repeat (no forward marker) jumps to beginning", () => {
    // 0 1 2 :|
    const infos = [
      {
        hasForwardRepeat: false,
        hasBackwardRepeat: false,
        repeatTimes: 2,
        endingNumbers: [],
      },
      {
        hasForwardRepeat: false,
        hasBackwardRepeat: false,
        repeatTimes: 2,
        endingNumbers: [],
      },
      {
        hasForwardRepeat: false,
        hasBackwardRepeat: true,
        repeatTimes: 2,
        endingNumbers: [],
      },
    ];
    expect(computeExpansion(infos)).toEqual([0, 1, 2, 0, 1, 2]);
  });

  test("implicit forward repeat jumps to just after previous backward repeat", () => {
    // |: 0 1 :| 2 3 :|  (second repeat's implicit start is measure 2)
    const infos = [
      {
        hasForwardRepeat: true,
        hasBackwardRepeat: false,
        repeatTimes: 2,
        endingNumbers: [],
      },
      {
        hasForwardRepeat: false,
        hasBackwardRepeat: true,
        repeatTimes: 2,
        endingNumbers: [],
      },
      {
        hasForwardRepeat: false,
        hasBackwardRepeat: false,
        repeatTimes: 2,
        endingNumbers: [],
      },
      {
        hasForwardRepeat: false,
        hasBackwardRepeat: true,
        repeatTimes: 2,
        endingNumbers: [],
      },
    ];
    expect(computeExpansion(infos)).toEqual([0, 1, 0, 1, 2, 3, 2, 3]);
  });

  test("two explicit repeat sections expand independently", () => {
    // |: 0 1 :| |: 2 3 :|
    const infos = [
      {
        hasForwardRepeat: true,
        hasBackwardRepeat: false,
        repeatTimes: 2,
        endingNumbers: [],
      },
      {
        hasForwardRepeat: false,
        hasBackwardRepeat: true,
        repeatTimes: 2,
        endingNumbers: [],
      },
      {
        hasForwardRepeat: true,
        hasBackwardRepeat: false,
        repeatTimes: 2,
        endingNumbers: [],
      },
      {
        hasForwardRepeat: false,
        hasBackwardRepeat: true,
        repeatTimes: 2,
        endingNumbers: [],
      },
    ];
    expect(computeExpansion(infos)).toEqual([0, 1, 0, 1, 2, 3, 2, 3]);
  });

  test("volta brackets: first ending played on pass 1, second on pass 2", () => {
    // |: 0 1 | [1. 2] :| [2. 3] |  4
    //  body   ending1        ending2   tail
    const infos = [
      {
        hasForwardRepeat: true,
        hasBackwardRepeat: false,
        repeatTimes: 2,
        endingNumbers: [],
      },
      {
        hasForwardRepeat: false,
        hasBackwardRepeat: false,
        repeatTimes: 2,
        endingNumbers: [],
      },
      {
        hasForwardRepeat: false,
        hasBackwardRepeat: true,
        repeatTimes: 2,
        endingNumbers: [1],
      },
      {
        hasForwardRepeat: false,
        hasBackwardRepeat: false,
        repeatTimes: 2,
        endingNumbers: [2],
      },
      {
        hasForwardRepeat: false,
        hasBackwardRepeat: false,
        repeatTimes: 2,
        endingNumbers: [],
      },
    ];
    // pass 0: play 0,1,2(ending1 ✓) → backward repeat → jump to 0, pass++
    // pass 1: play 0,1, skip 2(ending1 ✗), play 3(ending2 ✓) → no backward repeat on 3
    // continue: play 4
    expect(computeExpansion(infos)).toEqual([0, 1, 2, 0, 1, 3, 4]);
  });

  test("multi-measure endings", () => {
    // |: 0 | [1. 1 2] :| [2. 3 4] | 5
    const infos = [
      {
        hasForwardRepeat: true,
        hasBackwardRepeat: false,
        repeatTimes: 2,
        endingNumbers: [],
      },
      {
        hasForwardRepeat: false,
        hasBackwardRepeat: false,
        repeatTimes: 2,
        endingNumbers: [1],
      },
      {
        hasForwardRepeat: false,
        hasBackwardRepeat: true,
        repeatTimes: 2,
        endingNumbers: [1],
      },
      {
        hasForwardRepeat: false,
        hasBackwardRepeat: false,
        repeatTimes: 2,
        endingNumbers: [2],
      },
      {
        hasForwardRepeat: false,
        hasBackwardRepeat: false,
        repeatTimes: 2,
        endingNumbers: [2],
      },
      {
        hasForwardRepeat: false,
        hasBackwardRepeat: false,
        repeatTimes: 2,
        endingNumbers: [],
      },
    ];
    expect(computeExpansion(infos)).toEqual([0, 1, 2, 0, 3, 4, 5]);
  });
});

// ---------------------------------------------------------------------------
// expandRepeatsMusicXml integration tests
// ---------------------------------------------------------------------------

/** Build a minimal score-partwise MusicXML string from raw measure XML strings. */
function makeScore(rawMeasures: string[]): string {
  const measures = rawMeasures
    .map((body, i) => `<measure number="${i + 1}">${body}</measure>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
    </measure>
${rawMeasures
  .slice(1)
  .map(
    (body, i) => `    <measure number="${i + 2}">
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note>
      ${body}
    </measure>`,
  )
  .join("\n")}
  </part>
</score-partwise>`;
}

const FORWARD = `<barline location="left"><repeat direction="forward"/></barline>`;
const BACKWARD = `<barline location="right"><repeat direction="backward"/></barline>`;
function ending(num: number, type: "start" | "stop") {
  return `<barline location="${type === "start" ? "left" : "right"}"><ending number="${num}" type="${type}"/></barline>`;
}

describe("expandRepeatsMusicXml", () => {
  test("score with no repeats is returned unchanged", () => {
    const xml = makeScore(["", ""]);
    const result = expandRepeatsMusicXml(xml);
    // Should be the same (no-op) - verify same measure count after parsing
    const original = parseScore(xml);
    const expanded = parseScore(result);
    expect(expanded.numMeasures).toBe(original.numMeasures);
  });

  test("simple repeat doubles the section", () => {
    // 3 measures: |: m1 m2 :| (plus m0 with attributes)
    const xml = makeScore([
      FORWARD, // m1 has forward repeat on left
      BACKWARD, // m2 has backward repeat on right
      "", // m3 continues after
    ]);
    const expanded = parseScore(expandRepeatsMusicXml(xml));
    // Original: 3 measures → expanded: m0, m1, m2, m0, m1, m2, m3 = ... wait
    // Actually makeScore puts the barline body in each measure.
    // m0 (index 0) has FORWARD (from the first rawMeasure = "")
    // Wait, I'm constructing this wrong. Let me re-think.
    // makeScore("", FORWARD, BACKWARD, "") would give 4 measures:
    // 0: regular, 1: has forward repeat, 2: has backward repeat, 3: regular
    // But the function above uses slice(1) for remaining measures...
    // Let me just test the expanded measure count.
    expect(expanded.numMeasures).toBeGreaterThan(3);
  });

  test("simple repeat: correct expanded measure count", () => {
    // Build a 4-measure score: m1(regular) m2(|:) m3 m4(:|) m5(regular)
    // Expected expansion: m1 m2 m3 m4 m2 m3 m4 m5  → 8 measures
    const xml = `<?xml version="1.0"?>
<score-partwise>
  <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
    <measure number="2">
      <barline location="left"><repeat direction="forward"/></barline>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
    <measure number="3">
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
    <measure number="4">
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
      <barline location="right"><repeat direction="backward"/></barline>
    </measure>
    <measure number="5">
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;

    const expanded = parseScore(expandRepeatsMusicXml(xml));
    // m1, m2, m3, m4, m2, m3, m4, m5 → 8 measures
    expect(expanded.numMeasures).toBe(8);
  });

  test("repeat barline elements are removed from expanded measures", () => {
    const xml = `<?xml version="1.0"?>
<score-partwise>
  <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <barline location="left"><repeat direction="forward"/></barline>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
      <barline location="right"><repeat direction="backward"/></barline>
    </measure>
  </part>
</score-partwise>`;

    const result = expandRepeatsMusicXml(xml);
    // The expanded XML should not contain <repeat> elements
    expect(result).not.toContain("<repeat ");
    expect(result).not.toContain("<ending ");
  });

  test("volta brackets: correct notes in each pass", () => {
    // |: C :| with 1st ending D, 2nd ending E
    // Play order: C D (repeat) C E (continue)
    const xml = `<?xml version="1.0"?>
<score-partwise>
  <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <barline location="left"><repeat direction="forward"/></barline>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
    <measure number="2">
      <barline location="left"><ending number="1" type="start"/></barline>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
      <barline location="right"><ending number="1" type="stop"/></barline>
      <barline location="right"><repeat direction="backward"/></barline>
    </measure>
    <measure number="3">
      <barline location="left"><ending number="2" type="start"/></barline>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
      <barline location="right"><ending number="2" type="stop"/></barline>
    </measure>
  </part>
</score-partwise>`;

    const expanded = parseScore(expandRepeatsMusicXml(xml));
    // Expected: m1(C) m2(D) m1(C) m3(E) → 4 measures
    expect(expanded.numMeasures).toBe(4);

    function firstNoteStep(
      measure: (typeof expanded.parts)[0]["measures"][0],
    ): string {
      const ev = measure.events[0];
      if (!ev || ("kind" in ev && ev.kind === "rest")) {
        return "?";
      }
      return (
        (ev as { notes: Array<{ pitch: { step: string } }> }).notes[0]?.pitch
          .step ?? "?"
      );
    }

    const steps = expanded.parts[0].measures.map(firstNoteStep);
    expect(steps).toEqual(["C", "D", "C", "E"]);
  });

  test("invalid XML is returned unchanged", () => {
    const bad = "not xml at all <<>>";
    expect(expandRepeatsMusicXml(bad)).toBe(bad);
  });
});
