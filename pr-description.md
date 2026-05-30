## What changed? Why?

Sheet music for the Rondo alla Turca includes a trill ornament (`<trill-mark/>`) in the source file, but the app was ignoring it in three ways: the symbol wasn't rendered on the score, and both wait mode and playalong mode had no concept of trill execution — every alternation press of the ornamental neighbour note was counted as a wrong or extra note.

This PR fixes all three gaps, and also corrects a pre-existing bug where 16th-note grace note groups were drawn with only one beam bar instead of two.

**Grace note beam bar count.** 16th-note grace notes need two beam bars; eighth notes need one. The renderer was unconditionally drawing one bar regardless of type. A `graceNoteBeamCount` helper now maps the note type to the correct count and the bars are rendered as a mapped array.

**Trill mark rendering.** `<trill-mark/>` elements inside `<notations><ornaments>` were silently dropped. The fix flows through the full stack: `ParsedNote` and `ChordGroup` gain an optional `trill` flag; `parseRawNote` detects the element (following the existing staccato pattern) and propagates the flag through `groupEvents()` and `buildStaffEvents()`; `SheetMusicDisplay` renders SMuFL glyph U+E566 (`ornamentTrill`) centered above the top notehead of any trilled chord. The Rondo alla Turca `.mxl` source file was also edited to add the missing `<trill-mark>` to the relevant measure.

**Trill-aware note matching.** `PlaybackNote` gains `trill?: boolean`, propagated from `ChordGroup.trill` in `musicXmlToConversion`. In wait mode, after advancing past a trilled chord, any note within ±2 semitones of that chord arriving within 500 ms is treated as a trill neighbour and silently ignored rather than counted as a wrong note. In playalong mode, notes within ±2 semitones of a trilled score note that fall inside its duration window are similarly tolerated and don't reduce the F1 score. Both modes emit a `"trill-neighbor"` outcome in the debug log.

## How was the change tested?

Existing unit and integration tests all pass (`make pr-ready`). The trill rendering was verified visually by loading the Rondo alla Turca file and navigating to the affected measure. Trill-aware matching was verified by inspecting the debug log while playing the trilled chord in wait mode and confirming that neighbour note presses show `"trill-neighbor"` rather than `"wrong"`.
