# Plan: line-wrapped (multi-system) sheet music layout

Status: **proposed** (not yet started). This documents the intended approach so
implementation can proceed in phases, each independently shippable.

## Motivation

The score currently renders as one long horizontal system that scrolls
sideways. That works well on a phone in landscape, but it is not how printed
music reads: wrapped systems stacked vertically, with a page-turn feel, are the
natural reading mode on tablets and desktops — and a prerequisite for the
planned WYSIWYG editor's long-term display ambitions (`editor/PLAN.md` defers
exactly this).

## Where the difficulty lives

The hard engraving work (rhythm spines, beaming, accidental columns, grace
notes, chord geometry) is **measure-local** and already computed relative to
each measure's left edge — `buildMeasureSpine` works at x=0, then
`resolveLayout` offsets to absolute x. None of that changes.

What changes is the assumption, baked into `ResolvedLayout` and its consumers,
that the score is one row: a single `measureXs[]` on one y-baseline
(`staffBottomYs` per part, constant across the piece), consumed by cursor
mapping, tie arcs, the focus overlay, hit-testing, and scroll-follow as flat x
coordinates. Line wrapping is therefore mostly a **coordinate-system refactor
plus a line-breaking pass**, not a new renderer.

Two structural shifts come with it:

- Layout stops being a pure function of the score: wrapped layout depends on
  **container width**, so layout becomes reactive to resize.
- The scroll axis flips from horizontal to vertical.

## Approach: additive mode, not replacement

Wrapping ships as a display mode (`wrap?: boolean` prop on
`SheetMusicDisplay`, default off), with the app offering a toggle persisted in
`GlobalPreferences`. Rationale:

- The horizontal mode's UX is deeply tuned (snap system, scroll detachment,
  sticky signature overlay, edge-drag auto-scroll) and stays untouched.
- All existing tests and screenshot baselines stay green while wrapping
  matures.
- Horizontal may genuinely remain better on a phone in landscape.

The phase-1 refactor makes both modes share one engine, so this is not a fork.

## Phase 1 — systems abstraction (pure refactor, zero visual change)

Introduce the system concept into `ResolvedLayout`, with the current behavior
expressed as "one system containing every measure":

```ts
interface SystemLayout {
  firstMeasureIndex: number; // inclusive
  lastMeasureIndex: number; // inclusive
  y: number; // top of this system's staves block
  width: number; // right edge (justified width in wrapped mode)
  headerWidth: number; // clef+key(+time) lead-in at the line start
}

interface ResolvedLayout {
  // Existing fields keep their meaning, but x becomes "within the system's
  // row" (all systems share x=0, so in single-system mode nothing changes):
  //   measureXs, measureWidths, measureSpines, ...
  systems: SystemLayout[];
  systemOfMeasure: number[]; // measureIndex → system index
  systemStride: number; // vertical distance between system tops
}
```

Concretely:

- `staffBottomYs` becomes the per-part baselines **within a system block**; a
  note's y is `staffBottomYs[partIndex] + systems[s].y`. In single-system mode
  `systems[0].y === 0`, so every existing call site is unchanged after
  mechanical substitution.
- Split `Staff` (which draws full-width staff lines and all measures) into a
  `System` component: per-part staff lines spanning `system.width`, the
  measures in `[first..last]`, and the final barline. Single-system mode
  renders one `System`.
- `computeCursorX` grows into
  `computeCursorPosition(beat, …) → { x, systemIndex } | null`, keeping a thin
  `computeCursorX` wrapper for the public API. One real fix inside: the
  terminal anchor for a measure's last beat is currently "next measure's first
  onset x" — valid only when the next measure is on the same system; otherwise
  anchor to the system's right edge.
- `computeNoteRenderInfos` and `computeTieArcs` take the system offset into
  account (in phase 1, always 0).

**Gate:** `make pr-ready` green with **no screenshot baseline changes** — the
proof the refactor is behaviorally inert.

## Phase 2 — line breaking + wrapped rendering (static correctness)

1. **Measure-width pass.** `buildMeasureSpine` already returns natural
   relative widths; compute them once for all measures (this pass exists).

2. **Greedy line breaking.** Fill systems left to right: a system's budget is
   `availableWidth − systemHeaderWidth`; add measures while they fit; always
   place at least one measure per line (an over-wide measure gets compressed —
   see justification). Header per system: clef + active key signature repeat
   at every system start (standard engraving); time signature only on system 1
   and after a change. The existing `headerWidth`/`keyChangeWidth` helpers
   cover this. A mid-staff key change landing exactly at a line break renders
   as the new system's header signature instead of an inline change block.

3. **Justification.** Stretch each system to exactly `availableWidth` by
   scaling spine positions past the lead-in:
   `x' = leadIn + (x − leadIn) × factor`, same for `endX` / measure widths.
   Exact, one line of math, and stretches note spacing uniformly (accidental
   and grace clearances only get *more* room when factor ≥ 1; for the
   compressed single-over-wide-measure case a floor of ~0.75 keeps it
   legible). Two engraving conventions: cap the factor (~1.5) so sparse lines
   don't look gappy, and leave the final system ragged (factor 1).

4. **Vertical stacking.** `systemStride = parts-block height + systemGap` (new
   `LayoutConfig` field); `totalHeight = systems.length × stride`;
   `totalWidth = availableWidth`. The two stacked SVG roots (static + dynamic
   overlay — see the paint-isolation notes in CLAUDE.md) keep identical
   dimensions, so that split carries over untouched.

5. **Tie arcs across line breaks.** In `computeTieArcs`, when a tie's start
   and stop land on different systems, emit two half-arcs (the engraving
   convention): start → its system's right edge, and next system's header
   end → stop notehead. `TieArc` gains a `systemIndex`; the y offset moves to
   render time with everything else.

6. **Container-width reactivity.** `SheetMusicDisplay` measures the container
   with a `ResizeObserver` (one already exists in the rAF cursor effect —
   hoist it), holds `availableWidth` in state (debounced ~100 ms), and feeds
   it to `resolveLayout` in wrapped mode. On reflow, re-anchor the scroll to
   the current beat so a device rotation doesn't dump the user at the wrong
   line.

**Gate:** new Playwright screenshot baselines for wrapped mode (Rondo alla
Turca fixture at 2–3 viewport widths), plus unit tests for the breaking /
justification / tie-split math (pure functions — easy `bun test` targets).

## Phase 3 — interaction plumbing

Every place that assumes "x alone identifies a measure" or "follow means
scrollLeft":

- **Cursor.** The cursor div gets `translate(x, y)` with the height of one
  system block (the top/height math already exists per staves block). The rAF
  loop and the snap effect write `scrollTop` in wrapped mode, keeping the
  active system in the upper ~third of the viewport — a page turn per line
  rather than a continuous horizontal chase. Scroll detachment / re-attach
  transfers as-is on the other axis (`touchAction: pan-y`, vertical
  drag-to-scroll).
- **Hit-testing** (context menu, seek): map pointer `(x, y)` → system via
  `floor(y / systemStride)` → measure via the existing x scan restricted to
  that system's measures. One shared helper serves both.
- **Focus overlay across systems:** render one rect per touched system
  (first: `fromX → right edge`, middle systems: full line, last:
  `left edge → toX`). Left handle on the first system, right handle on the
  last; the drag's `snapIndexFromCurrent` boundary walk already operates on
  measure indices, so it survives — only the pointer→boundary projection needs
  the system-aware hit-test.
- **Player markers:** use `computeCursorPosition` for `{x, systemIndex}` and
  add the system y to the staff-choice math in `PlayerMarkerOverlay`.
- **Sticky signature overlay:** disabled in wrapped mode (every system carries
  its own header — it's redundant).

**Gate:** an integration spec exercising wrapped mode end-to-end — seek via
context menu on a lower system, wait-mode advance across a line break (cursor
jumps to the next line and the view follows), focus range spanning two
systems.

## Phase 4 — app integration

- Toggle in the settings drawer ("Wrap lines" / "Scroll sideways"), persisted
  in `GlobalPreferences`. A sensible follow-up is defaulting wrapped for
  portrait and horizontal for landscape, but start with an explicit toggle
  only.
- `PracticeScreen` container style per mode: wrapped drops the
  `display: flex; alignItems: center` centering and the left/right fade
  gradients (replace with top/bottom fades), `overflowY: auto`.
- Update **CLAUDE.md** (cursor/scroll section, tie rendering, focus system,
  sticky overlay) and the README's "Status" limitation line — both call out
  the single-system model explicitly today.

## Risks and open questions

- **The risk is phase 3 breadth, not phase 2 math.** The interactions are
  individually small but numerous; the phase gates (screenshots after 2,
  integration spec after 3) are what keep regressions visible. Phases 1 and 2
  are each roughly the size of the tie-rendering feature; phase 3 is the long
  tail.
- **Editor overlap:** `editor/PLAN.md` builds on the single-row renderer and
  vendors `parseScore`. The systems refactor changes `ResolvedLayout`'s public
  shape — do it before the editor starts consuming it, and keep field renames
  minimal.
- **Wait mode + wrapped:** wait mode jump-cuts the cursor constantly; a
  vertical snap per advance might feel jumpier than horizontal. If so, only
  snap when the target system changes (a trivial check in the snap effect).
- **Default mode:** whether wrapped eventually becomes the default is deferred
  until it has been practiced on for a while.

The single most important step is phase 1: once "system" exists as a
first-class layout concept with the current display as its degenerate case,
everything else is incremental and independently shippable.
