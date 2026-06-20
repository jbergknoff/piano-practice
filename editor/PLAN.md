# Plan: WYSIWYG MusicXML editor (step 1 — add/remove/move notes)

## Context

We want to start building a WYSIWYG MusicXML editor that reuses the notation
rendering this repo already has (`SheetMusicDisplay` from
`packages/sheet-music-display`). The first milestone is a notation surface where
a user can **add, move, and remove notes** on a staff, importing and exporting
MusicXML. It will eventually move to its own repository, so it must be
**self-contained**.

Two decisions were made up front:

- **Display = single-row MVP now.** Build on the existing single-row,
  horizontal-scroll renderer as-is. Traditional line-wrapping into stacked
  systems (a large layout-engine + 2-D cursor/hit-test effort) and repeat-barline/
  volta glyphs are deferred follow-ups, not step 1.
- **Fidelity = DOM-as-source surgical edits.** The **MusicXML `Document` is the
  source of truth.** Gestures apply *surgical* edits to the actual `<note>`
  elements and re-serialize the same document, so everything the editor doesn't
  model (dynamics, slurs, lyrics, voices, layout hints) survives a round-trip by
  construction; an unedited file round-trips faithfully. There is **no
  regenerating serializer** — export is `XMLSerializer` over the live document.

Repeat *unrolling* is not a concern: `expand-repeats.ts` is app-side
(`lib/musicxml/`), and the parser/renderer draw whatever measures they are given,
so the editor simply never expands repeats.

Scope guard for step 1: single part / single treble staff, 4/4, no repeats, no
voices/`<backup>`/chords. Grand staff, chords, key/time editing, and undo/redo are
explicit follow-ups (notes below).

## Architecture: document-as-source-of-truth

```
 live MusicXML Document (the truth)
        │  XMLSerializer.serializeToString
        ▼
   musicxml string ──► vendored parseScore ──► SheetMusicDisplay (render)
        ▲                      │
        │                      └─ each ParsedNote carries source provenance
        │                         { measureIndex, noteElementIndex }
        │
   surgical DOM edits (dom-edit.ts): insert / remove / relocate <note>,
   mutate <pitch>, rebalance rests — reusing untouched <note> nodes verbatim
```

The editor holds one `Document`. Every edit mutates that document in place (or on
a clone, for undo). Rendering re-serializes it and re-parses with the vendored
`parseScore`. **Untouched `<note>` elements are never regenerated** — only rests
and the single edited note are created/removed — which is what makes the
round-trip faithful.

## Directory layout (new, self-contained)

Top-level `editor/`, a Bun workspace member so `bun install` symlinks `preact`:

```
editor/
  package.json            # @jbergknoff/editor; dep: preact
  index.html              # <div id="app">, font/CSS block copied from repo index.html
  src/
    main.tsx              # render(<Editor/>, #app)
    Editor.tsx            # shell: owns the Document, palette, EditableSheetMusic, import/export
    dom-edit.ts           # Document-as-source ops + blank-template + node builders + rewriteMeasure
    dom-edit.test.ts
    hit-test.ts           # screen<->music inverses (beatFromX, pitchFromY) + pickNote
    hit-test.test.ts
    components/
      DurationPalette.tsx
      EditableSheetMusic.tsx   # wraps the vendored renderer + pointer seam
    sheet-music/          # DUPLICATED copy of packages/sheet-music-display/src/*, extended in place
  dist/                   # gitignored build output
```

`editor/src/*` imports the renderer from the local `./sheet-music/` copy, **not**
from `@jbergknoff/sheet-music-display`, so the folder lifts out whole later.

## 1. Scaffold + build wiring

- `editor/package.json`: `"name": "@jbergknoff/editor"`, `"type": "module"`, dep
  on `preact`. Add `"editor"` to the root `package.json` `workspaces`.
- Duplicate `packages/sheet-music-display/src/` → `editor/src/sheet-music/`
  verbatim (keep an `index.ts` mirroring upstream exports). This is the copy we
  extend (provenance + a couple of exported constants).
- `editor/index.html`: copy the `<head>` font block + global CSS from the repo
  `index.html`; `<div id="app">`; `<script type="module" src="dist/main.js">`.
- `Makefile`: add `build-editor` (`bun build editor/src/main.tsx --outdir
  editor/dist --minify`) and `hot-reload-editor` (`--watch`). Add `editor` to the
  `unit-test` path list (`bun test src lib packages tests/unit editor`).
- `tsconfig.json` `include`: add `"editor"`. `.gitignore`: add `editor/dist`.

## 2. Document edits — `editor/src/dom-edit.ts` (the core)

All operations take and mutate a `Document` (or a clone). DOM built with
`DOMParser`/`document.createElement` (works under the existing `linkedom`
`test-setup.ts`).

Node builders (small; these replace the full serializer the lossy approach would
have needed):
- `createBlankDocument({ timeSigNum, timeSigDen, keyFifths, clef, measureCount })`
  → a `score-partwise` document: `part-list`, one `part`, `measureCount` measures
  each holding a single full-measure `<rest>` `<note>`, with `<attributes>`
  (divisions=4, key, time, clef) in measure 1. Mirrors the element shapes in
  `packages/midi-to-musicxml/src/midi-to-musicxml.ts` (`scoreTemplate`,
  `renderNote`) but builds DOM nodes, not strings.
- `createNoteElement(doc, { step, alter, octave, durationDivisions, type, dot })`
  and `createRestElement(doc, { durationDivisions, type, dot, fullMeasure })`.

Surgical ops (each locates the target `<measure>` element by index and rewrites
only that measure's note/rest run):
- `addNote(doc, { measureIndex, onsetBeatInMeasure, durationBeats, pitch })`
- `removeNote(doc, handle)`  — `handle = { measureIndex, noteElementIndex }`
- `moveNote(doc, handle, { measureIndex, onsetBeatInMeasure, pitch })`
  - pitch-only change: mutate the existing `<note>`'s `<pitch>` children **in
    place** (preserves all sibling expression elements on that note);
  - onset/measure change: relocate the same `<note>` node and rebalance rests.

Heart of it — `rewriteMeasure(measureEl, divisions, beatsPerMeasure)`:
1. Read the measure's existing **real** (non-rest) `<note>` elements as
   `{ element, onsetDivisions, durationDivisions }`, replaying the MusicXML time
   cursor (same logic as the parser's `collectStaffItems`).
2. Apply the requested add/remove/move to that list (single voice ⇒ onsets stay
   ordered and non-overlapping after snapping).
3. Re-emit the measure's children: for each real note in onset order, append the
   **same existing element node** (reused verbatim — fidelity), and fill every gap
   before/between/after with **freshly created** `<rest>` notes via a duration
   decomposition (port `decompose()` from `midi-to-musicxml.ts`, which already
   splits an arbitrary division span into well-typed rest durations). Only rests
   and the one edited note are ever created/destroyed.

Grid/pitch snapping is done by the caller (hit-test) before these ops, so
`dom-edit` deals only in exact divisions/pitches.

Test (`dom-edit.test.ts`): start from `createBlankDocument`, apply add/move/remove,
serialize, feed to the vendored `parseScore`, and assert measure/pitch/duration.
Fidelity test: parse a fixture with an articulation/dynamic on a note, move a
*different* note, re-serialize, and assert the untouched note's expression
elements are byte-for-byte preserved.

## 3. Provenance + coordinate inverses — duplicated parser & `editor/src/hit-test.ts`

**Provenance (small change to the duplicated copy only):** extend
`editor/src/sheet-music/sheet-music-types.ts` `ParsedNote` with optional
`source?: { measureIndex: number; noteElementIndex: number }`, and populate it in
the duplicated `musicxml-parser.ts`. `parseMeasure` already maps
`Array.from(el.querySelectorAll("note")).map(parseRawNote)` in document order, so
thread the `<note>` index (and the measure index from `parseMeasures`) into
`parseRawNote`. This is the bridge from a picked on-screen note to the `<note>`
element `dom-edit` must mutate. (The app's package is untouched.)

**Inverses** reuse exported primitives from the vendored copy: `parseScore`,
`resolveLayout`, `computeCursorX`, `noteY`, `diatonicIndex`, `DIVISIONS`,
`computeMeasureStartBeats`. Export the two staff constants `noteY` needs
(`TREBLE_BOTTOM`, staff-space) from the duplicated `sheet-music-layout.ts`.

- `beatFromX(svgX, score, layout, measureStartBeats)` — port the inverse already
  living in `SheetMusicDisplay.tsx`'s `onContextMenu` handler (find the measure
  via `layout.measureXs`, interpolate within it using `measureStartBeats`). Snap
  to nearest 0.25 beat.
- `pitchFromY(svgY, staffBottomY, staffSpace, clef)` — invert `noteY` (a clean
  linear map): `stepsFromBottom = round((staffBottomY - svgY)/(staffSpace/2))`;
  `d = stepsFromBottom + bottomRef`; `{ octave: floor(d/7), step: STEPS[d % 7] }`.
  `alter` from key sig (0 in step 1). Rounding to half-spaces gives natural
  staff-line snapping.
- `pickNote(score, beat, pitch)` — nearest parsed note within a small tolerance;
  returns the renderer id (`p{part}-m{measure}-n{noteIndex}-v0`, for selection
  highlight) **and** its `source` handle (for `dom-edit`).

Tests (`hit-test.test.ts`): beat↔x and pitch↔y round-trip against a known layout;
`pickNote` returns the right id + handle for a clicked location.

## 4. Renderer pointer seam — `editor/src/components/EditableSheetMusic.tsx`

Wraps the vendored `SheetMusicDisplay`. Because we own the copy, add a thin,
additive opt-in seam rather than reimplementing rendering:

- Extend the vendored `SheetMusicDisplay` props with optional
  `onStagePointerDown/Move/Up(info)` carrying raw `svgX/svgY` plus the
  already-computed `layout`/`score`. The wrapper resolves them to
  `{ beat, pitch, hit }` (`hit` from `pickNote`) via `hit-test.ts`. When the
  callbacks are absent the copy still renders the read-only practice view.
- The wrapper holds no document; it reports gestures up to `Editor.tsx` and draws
  feedback through the existing `noteHighlights` prop — `ScoreHighlight` for the
  selected note (by `pickNote`'s id), a `MarkerHighlight` at the live drag
  `(beat, pitch)` for placement preview. Both highlight kinds already exist.

## 5. Editor shell — `editor/src/Editor.tsx` + `DurationPalette.tsx`

- State: the `Document` (in a ref; a `version` counter state forces re-render
  after each mutation), `selectedDuration`, `selectedNoteId`. Derived per render:
  `musicxml = serializeToString(doc)` (memoized on `version`).
- `DurationPalette`: toolbar of duration buttons (whole/half/quarter/eighth/16th),
  highlighting the active one. Self-contained minimal styles (no app `theme.ts`).
- Gestures (from `EditableSheetMusic`), each calls a `dom-edit` op then bumps
  `version`:
  - **pointerdown on empty staff** with a duration selected → `addNote` at snapped
    (measure, onset, pitch, duration); select it.
  - **pointerdown on a note** → select (store `pickNote` id + handle); **drag** →
    live `moveNote` (vertical=pitch, horizontal=beat) on each move, commit on up.
  - **Delete/Backspace** (or a delete button) → `removeNote(selectedHandle)`.
- **Import**: file input reads `.musicxml`/`.xml` text into a `Document` via
  `DOMParser` (`.mxl` deferred). **Export**: download `serializeToString(doc)` as
  `.musicxml` (Blob + anchor). Optional live-XML textarea for debugging.
- Start state: `createBlankDocument` (4/4 treble, a few empty measures).

## Follow-ups (explicitly out of step 1)

Undo/redo (snapshot via `doc.cloneNode(true)` — cheap given the doc-as-source
design), chords (multiple `<note>` at one onset with `<chord/>`), grand staff,
accidental/key/time editing, `.mxl` import, traditional wrapped layout +
repeat-barline/volta glyphs, Playwright integration coverage.

## Verification

1. `make build-editor` succeeds; open `editor/index.html` (via
   `make hot-reload-editor`) and confirm an empty staff renders.
2. Manual: pick a quarter, click the staff → a note appears at the clicked
   pitch/beat; drag up a line → pitch changes; drag right → beat changes; select +
   Delete → it disappears; Export → the `.musicxml` reopens correctly in the
   practice app's loader.
3. **Fidelity check**: import a MusicXML file containing dynamics/slurs/
   articulations, move one note, export, and diff — untouched elements are
   preserved verbatim.
4. `make unit-test` runs `dom-edit.test.ts` (edit → serialize → `parseScore`
   round-trip + fidelity-preservation test) and `hit-test.test.ts` (coordinate
   inverses + pick).
5. `make pr-ready` (format, lint, typecheck, build, tests) green before commit.
6. Practice app untouched: `git status` shows no changes under
   `packages/sheet-music-display` or `src/`, and `make build` still passes.
