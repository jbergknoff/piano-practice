import { describe, expect, test } from "bun:test";
import { musicXmlToConversion } from "../../lib/musicxml/musicxml-playback";
import { buildWaitPoints } from "../../src/modes/use-wait-mode";

// MIDI note numbers used in assertions (pitchToMidiNumber: (octave+1)*12 + semitone + alter).
// C5=72, C#5=73, D5=74, E5=76, F#5=78, G5=79

// Minimal single-staff MusicXML with a 4/4 measure.
function makeScoreXml(measureContent: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      ${measureContent}
    </measure>
  </part>
</score-partwise>`;
}

describe("buildWaitPoints – slashed grace notes", () => {
  test("non-slashed grace note produces its own wait point", () => {
    // E5 quarter, non-slashed grace D5, C5 quarter.
    const xml = makeScoreXml(`
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note>
      <note><grace/><pitch><step>D</step><octave>5</octave></pitch><type>eighth</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note>
    `);
    const { notes } = musicXmlToConversion(xml);
    const points = buildWaitPoints(notes);

    // E5 at beat 0, non-slashed grace D5 just before beat 1, C5 at beat 1.
    const gracePoint = points.find((p) => p.isGrace);
    expect(gracePoint).toBeDefined();
    expect(gracePoint?.noteNumbers.has(74)).toBe(true); // D5 = 74
    expect(gracePoint?.optionalNoteNumbers.size).toBe(0);
  });

  test("slashed grace note does not produce its own wait point", () => {
    // E5 quarter, slashed grace D5 (acciaccatura), C5 quarter.
    const xml = makeScoreXml(`
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note>
      <note><grace slash="yes"/><pitch><step>D</step><octave>5</octave></pitch><type>eighth</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note>
    `);
    const { notes } = musicXmlToConversion(xml);
    const points = buildWaitPoints(notes);

    // No wait point with isGrace — the slashed grace is folded into C5's point.
    expect(points.every((p) => !p.isGrace)).toBe(true);

    // The C5 wait point must carry D5 as optional, not required.
    const c5Point = points.find((p) => p.noteNumbers.has(72)); // C5 = 72
    expect(c5Point).toBeDefined();
    expect(c5Point?.optionalNoteNumbers.has(74)).toBe(true); // D5 = 74 optional
    expect(c5Point?.noteNumbers.has(74)).toBe(false); // D5 not required
  });

  test("multiple slashed graces before one chord all become optional for that chord", () => {
    // E5 quarter, then two slashed graces (D5, C#5) before C5 quarter.
    const xml = makeScoreXml(`
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note>
      <note><grace slash="yes"/><pitch><step>D</step><octave>5</octave></pitch><type>sixteenth</type></note>
      <note><grace slash="yes"/><pitch><step>C</step><alter>1</alter><octave>5</octave></pitch><type>sixteenth</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note>
    `);
    const { notes } = musicXmlToConversion(xml);
    const points = buildWaitPoints(notes);

    // Only 2 wait points: E5 (beat 0) and C5 (beat 1). No grace-only points.
    expect(points).toHaveLength(2);
    expect(points.every((p) => !p.isGrace)).toBe(true);

    const c5Point = points[1];
    expect(c5Point.noteNumbers.has(72)).toBe(true); // C5 required
    expect(c5Point.optionalNoteNumbers.has(74)).toBe(true); // D5 = 74 optional
    expect(c5Point.optionalNoteNumbers.has(73)).toBe(true); // C#5 = 73 optional
  });

  test("mixed slashed and non-slashed graces: non-slashed keeps its point, slashed is folded", () => {
    // E5 quarter, non-slashed grace G5, then slashed grace F#5, then C5 quarter.
    // The non-slashed grace creates its own wait point; the slashed grace is
    // folded into C5's optional set.
    const xml = makeScoreXml(`
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note>
      <note><grace/><pitch><step>G</step><octave>5</octave></pitch><type>eighth</type></note>
      <note><grace slash="yes"/><pitch><step>F</step><alter>1</alter><octave>5</octave></pitch><type>eighth</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note>
    `);
    const { notes } = musicXmlToConversion(xml);
    const points = buildWaitPoints(notes);

    // 3 wait points: E5, non-slashed grace G5, C5 (with slashed F#5 optional).
    expect(points).toHaveLength(3);

    const gracePoint = points.find((p) => p.isGrace);
    expect(gracePoint).toBeDefined();
    expect(gracePoint?.noteNumbers.has(79)).toBe(true); // G5 = 79 required

    const c5Point = points.find((p) => p.noteNumbers.has(72)); // C5 = 72
    expect(c5Point).toBeDefined();
    expect(c5Point?.optionalNoteNumbers.has(78)).toBe(true); // F#5 = 78 optional
    expect(c5Point?.optionalNoteNumbers.has(79)).toBe(false); // G5 is required, not optional
  });

  test("a tied note is a held requirement on the wait point at its tie-stop beat", () => {
    // Beat 0: chord C5 (tie start) + E5. Beat 1: chord C5 (tie stop) + G5.
    // The held C5 carries across; G5 is the only fresh attack at beat 1.
    const xml = makeScoreXml(`
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type><tie type="start"/></note>
      <note><chord/><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type><tie type="stop"/></note>
      <note><chord/><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note>
    `);
    const { notes } = musicXmlToConversion(xml);
    const points = buildWaitPoints(notes);

    // Beat 0: C5 and E5 are both freshly attacked (required), nothing tied.
    expect(points[0].noteNumbers.has(72)).toBe(true); // C5
    expect(points[0].noteNumbers.has(76)).toBe(true); // E5
    expect(points[0].tiedNoteNumbers.size).toBe(0);

    // Beat 1: G5 is the fresh attack; C5 is tied in (held requirement), not a
    // fresh-attack requirement.
    expect(points[1].noteNumbers.has(79)).toBe(true); // G5 required
    expect(points[1].noteNumbers.has(72)).toBe(false); // C5 not a fresh attack
    expect(points[1].tiedNoteNumbers.has(72)).toBe(true); // C5 tied in
  });

  test("a tie landing on a beat with no other onset creates no wait point", () => {
    // C5 half note (tie start) tied to C5 half note (tie stop); nothing else
    // happens at beat 2, so there is no wait point there to enforce the hold.
    const xml = makeScoreXml(`
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><type>half</type><tie type="start"/></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><type>half</type><tie type="stop"/></note>
    `);
    const { notes } = musicXmlToConversion(xml);
    const points = buildWaitPoints(notes);

    expect(points).toHaveLength(1);
    expect(points[0].noteNumbers.has(72)).toBe(true); // C5 struck at beat 0
    expect(points.every((p) => p.tiedNoteNumbers.size === 0)).toBe(true);
  });

  test("slashed grace clamped to same beat as its main note becomes optional on that wait point", () => {
    // Slashed grace D5 before C5 at the very start of the score. Both land at
    // beat 0 due to clamping; D5 must be optional, C5 required.
    const xml = makeScoreXml(`
      <note><grace slash="yes"/><pitch><step>D</step><octave>5</octave></pitch><type>eighth</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note>
    `);
    const { notes } = musicXmlToConversion(xml);
    const points = buildWaitPoints(notes);

    // 2 wait points (C5 and E5). No grace-only wait point.
    expect(points.every((p) => !p.isGrace)).toBe(true);

    const c5Point = points.find((p) => p.noteNumbers.has(72)); // C5 = 72
    expect(c5Point).toBeDefined();
    expect(c5Point?.optionalNoteNumbers.has(74)).toBe(true); // D5 = 74 optional
    expect(c5Point?.noteNumbers.has(74)).toBe(false); // D5 not required
  });
});
