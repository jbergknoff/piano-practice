# Focus-range off-by-one on pickup-measure pieces

**Status:** known bug, deferred to a follow-up PR.

## Symptom

On a piece whose first measure is a **pickup (anacrusis)** — e.g.
`tests/fixtures/rondo-alla-turca-clip.mxl` — focusing a single measure puts the
orange focus overlay (and the cursor) on the measure you picked, but the
**wait-point highlights land on the *next* measure**. The overlay and the
highlighted notes are one measure apart.

It only happens on pickup pieces (or, more generally, any piece whose MusicXML
`<measure number=…>` attributes are not `1, 2, 3, …`). Normal pieces are
unaffected, which is why this went unnoticed.

## Root cause: two measure-numbering schemes

There are two different ways measures get numbered, and the focus feature mixes
them.

1. **Positional, 1-based** — "the Nth rendered measure". Used by:
   - the measure-number **labels** (`measureIndex + 1`,
     `SheetMusicDisplay.tsx`, the `Measure` component ~line 1566),
   - the **focus overlay** rectangle (`focusRange.from - 1` indexes
     `layout.measureXs`, `SheetMusicDisplay.tsx` ~line 1128),
   - the **right-click context menu** (`measureNumber: measureIndex + 1`,
     `SheetMusicDisplay.tsx` ~line 1187),
   - the **jump-to-measure modal** (`1 … measureStartBeats.length`,
     `MeasureJumpModal.tsx`),
   - the **cursor seek** on focus change (`measureStartBeats[range.from - 1]`,
     `PracticeScreen.tsx` and `use-wait-mode.tsx`).

2. **Parsed MusicXML number** — the `number` attribute on `<measure>`, e.g.
   `0, 1, 2, …` when measure 0 is an `implicit="yes"` pickup. Used by:
   - **note IDs** (`p{part}-m{measureNumber}-n…`, both the renderer's
     `data-color-id`/`data-chord-id` and the mode hooks' highlight emission),
   - **`rangeBounds`** in `src/modes/use-wait-mode.tsx`, which decides which
     wait points fall inside the focus range by comparing `range.from`/`range.to`
     against each wait point's parsed `measure`.

On a normal piece the MusicXML numbers are `1, 2, 3, …`, i.e. exactly
`positional + 1`, so the two schemes coincide and everything agrees. On a pickup
piece the numbers are `0, 1, 2, …`, i.e. `positional`, which is **one less** than
`positional + 1`. So `rangeBounds` (scheme 2) selects wait points one measure
ahead of where the overlay, cursor, and labels (scheme 1) point.

`rangeBounds` is the lone outlier — every *user-facing* surface (labels, overlay,
context menu, modal, seek) already agrees on positional 1-based numbering.

### Worked example (rondo clip)

The clip's MusicXML measures are numbered `0..8` (`number="0"` is the pickup,
`implicit="yes"`). So:

| Rendered label | Positional index | Parsed `measure.number` (note IDs) |
|---|---|---|
| "6" | 5 | `m5` |
| "7" | 6 | `m6` |

Focusing the measure **labelled "6"** → `measureRange = {from: 6, to: 6}`:

- overlay: `measureXs[6 - 1]` → positional 5 → the measure labelled "6" ✓
- cursor seek: `measureStartBeats[6 - 1]` → positional 5 ✓
- `rangeBounds`: wait points whose parsed `measure == 6` → note IDs `m6` →
  positional 6 → the measure labelled **"7"** ✗

So the highlights are on label-"7" while the box is on label-"6".

> Note: the current grace-focus integration test
> (`tests/integration/wait-mode-grace-focus.spec.ts`) focuses `6` and asserts the
> `p0-m6-…` highlights. That passes today only because it matches the *buggy*
> `rangeBounds` result. When this is fixed, that test must be retargeted (focusing
> `6` should select the label-"6" measure, whose IDs are `m5`).

## Proposed fix (targeted, low-churn — recommended)

Make `rangeBounds` use positional numbering like everything else, by giving each
wait point a positional measure index:

1. **`lib/musicxml/musicxml-playback.ts`** — measures are already iterated in
   order when building `PlaybackNote`s. Record a 0-based `measureIndex` on each
   note alongside the existing parsed `measureNumber`. Grace notes get the same
   `measureIndex` as the measure they render in (mirroring how `measureNumber` is
   already tagged for graces).
2. **`src/modes/use-wait-mode.tsx`** — `WaitPoint.measure` (consumed by
   `rangeBounds` and the grace grouping/sort) becomes `measureIndex + 1`
   (positional 1-based). Note IDs are untouched: `computedHighlights` keeps
   building them from the parsed `measureNumber`.

No change to note IDs, the renderer, the overlay, the modal, or non-pickup
pieces. Roughly a new field plus a few lines.

### Test work that comes with it

- Retarget `tests/integration/wait-mode-grace-focus.spec.ts` (focusing a number
  now selects the like-labelled measure; update the expected IDs and the MIDI
  play-through accordingly).
- Add a regression test that focuses a measure in a **pickup** piece in Wait mode
  and asserts the focused measure's own notes become the wait points (i.e. the
  overlay and the highlights agree). A small purpose-built pickup fixture, or the
  rondo clip, works.

## Alternative (more unifying, more churn)

Renumber measures positionally in the parser so `measure.number` becomes
`1, 2, 3, …` (matching the labels). Then note IDs, labels, focus, and
`rangeBounds` all share one scheme and "focus 6" ↔ label "6" ↔ ID `m6`. Cleaner
conceptually, but it changes every `data-color-id`/`data-chord-id` value, so the
rondo-highlighting, cursor-highlighting, and grace-focus tests all need their
expected IDs updated. The MusicXML's original numbering (e.g. pickup = 0) would
be lost from `measure.number`, though nothing currently displays it (labels use
`measureIndex + 1`).

## Why this is safe to defer

The bug only bites pickup/odd-numbered pieces, and only the Wait-mode focus
*selection* is wrong — playback, rendering, and non-pickup focus are all fine.
The grace-notehead work in this PR is unaffected (its test is internally
consistent with today's `rangeBounds`).
