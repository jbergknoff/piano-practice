# Agent notes

## Keeping this file current

**Update the Architecture section below whenever you make changes that affect it** — new screens, new hooks, changes to the mode or focus systems, new control areas, or significant state ownership shifts. The goal is that a future agent can read this file and skip broad exploration. A stale architecture section is worse than none, so if you change something described here, update the description in the same commit.

## Architecture

### Repository layout

The repo is a **Bun workspace**. Two dependency-light libraries live under `packages/*` (each its own `package.json`, scoped `@jbergknoff/*`, source-as-entry — `exports`/`types` point straight at the `.ts`, no per-package build step); the app itself stays at the repo root under `src/` and `lib/`. Tests are colocated next to their subject, except shared MIDI/MusicXML fixtures, which live in `tests/fixtures/` (referenced via repo-root-relative paths, since `bun test` runs from the repo root; integration tests use the `FIXTURES` helper in `tests/integration/helpers.ts`).

Neither package imports app code — the app depends on the packages, not the other way around. Packages (wired together via `node_modules` symlinks created by `bun install`):

- `packages/midi-to-musicxml/` (`@jbergknoff/midi-to-musicxml`) — `midi-to-musicxml.ts`; **only dependency is `midi-file`**. `midiToMusicXmlWithTracks` takes a parsed MIDI file and returns a MusicXML **string** (the app derives the `ScoreConversion` from it). Also exports `getMidiTempo`/`getMidiTracks`/`TrackInfo`.
- `packages/sheet-music-display/` (`@jbergknoff/sheet-music-display`) — the self-contained "sheet music" library: it **parses and draws** MusicXML. `musicxml-parser.ts` (`parseScore`, `diatonicIndex`, `isRest`) + `sheet-music-types.ts` (the `Parsed*`/`Pitch`/layout types) + `measure-beats.ts` (`computeMeasureStartBeats`) + `sheet-music-layout.ts` + the Preact renderer `SheetMusicDisplay.tsx` + `highlights.ts` (the `NoteHighlight` public type) + `glyphs.ts` (the SMuFL glyph map / codepoints) + `embedded-glyph-font.ts` (a generated base64 Bravura subset). `preact` is a peer dep; no other runtime deps. **Self-contained fonts:** the package bundles its own SMuFL glyph font (see "Glyph font bundling" below) so notation renders with zero setup — only the plain-text font is a prop (`textFontFamily`). No app-theme import.

App-internal code (under `lib/` and `src/`):

- `lib/musicxml/` — the **playback-derivation layer**: `musicxml-playback.ts` (`musicXmlToConversion` + the `ScoreConversion`/`PlaybackNote`/`RepeatSection` types, `pitchToMidiNumber`, `getMusicXmlTempo`), `expand-repeats.ts`, `mxl.ts` (unzips `.mxl`). Imports the parser + notation types from `@jbergknoff/sheet-music-display`.
- `lib/midi/` — `midi-player.ts` (Web Audio playback), `ble-midi.ts`
- `lib/circular-buffer/` — generic O(1) ring buffer
- `src/` — `main.tsx` (entry, built by the Makefile), `App.tsx` (shell), `theme.ts`, `debug-log.ts`, `globals.d.ts`
- `src/components/` — UI components; `src/components/screens/` holds the two top-level screens
- `src/hooks/` — `use-bluetooth.ts`, `use-wake-lock.ts`, `use-file-history.ts`
- `src/modes/` — the three mode hooks, `mode-control.ts`, `note-colors.ts`
- `tests/unit/` — cross-package unit tests that span more than one package (e.g. layout fed by MIDI-derived MusicXML)

File naming: components are `PascalCase`; everything else is `kebab-case`.

### Two-screen model

The app renders either `LandingScreen` (file picker) or `PracticeScreen` (practice view), driven by whether a file is loaded (either `midiData` from a MIDI file or `loadedXml` from a MusicXML/`.mxl` file). `App.tsx` is a session shell — it owns file loading + persistence + bluetooth + the persisted settings (mode, BPM, range, etc.) and routes between the two screens. `PracticeScreen` owns everything that runs the practice session: the `MidiPlayer`, the live cursor, the three mode hooks, the result modals, and the count-in overlay.

### Data pipeline

The MusicXML string is the single source of playback metadata. Conversion and
playback derivation are separate steps:

- **MIDI source**: MIDI file → `parseMidi` (midi-file) → `midiToMusicXmlWithTracks` (`@jbergknoff/midi-to-musicxml`) returns a MusicXML string → `musicXmlToConversion` (in `lib/musicxml/musicxml-playback.ts`) derives the playback notes. `App.tsx` composes the two.
- **MusicXML source**: `.musicxml`/`.xml` read as text (or `.mxl` unzipped via `extractMusicXmlFromMxl`) → `musicXmlToConversion`.

Both paths produce a `ScoreConversion` (`musicxml` string, `notes`, `totalBeats`, `timeSigNum`/`timeSigDen`). `musicXmlToConversion` parses the score with the same `parseScore` the renderer uses, so each `PlaybackNote`'s ID (`p{partIndex}-m{measureNumber}-n{noteIndex}-v{voiceIndex}`) matches the renderer's by construction. Standard MusicXML has no per-note velocity, so playback uses a constant default velocity and notation-derived durations (staccato shortens the sounding length). The `ScoreConversion` is fed into `MidiPlayer` for playback and into each mode hook (`useWaitMode`, `usePlayalongMode`, `useListenMode`) via the shared `ModeControl`.

Multi-staff piano parts (`<staves>` > 1, or any part using `<backup>`) are split by the parser into one `ParsedPart` per staff — the renderer stacks them as a grand staff. Each staff's voices are reduced to a single onset-ordered event stream (notes sharing an onset become a chord; durations become the gap to the next onset), and durations are normalized to the layout's base grid (`NORMALIZED_DIVISIONS` = 4 per quarter) so arbitrary file `<divisions>` work without touching the layout. Dense multi-voice passages are thus a rhythmic reduction, not full voice separation.

### Key files

| File | Role |
|------|------|
| `src/App.tsx` | Session shell: file load/parse (MIDI + MusicXML/`.mxl`, routed by extension), history persistence, bluetooth, force-listen-on-disconnect, landing↔practice routing |
| `src/components/screens/PracticeScreen.tsx` | Owns the `MidiPlayer`, the live cursor + snap state, transport delegation, and instantiates the three mode hooks; renders `{active.overlay}` and `{active.modal}` |
| `src/components/screens/LandingScreen.tsx` | File drop/pick screen |
| `src/modes/mode-control.ts` | `ModeControl` / `ModeHandle` interfaces and `createPlayerHandle` (stable handle that delegates to whatever `MidiPlayer` the getter currently returns) |
| `src/modes/use-wait-mode.tsx` | Mode hook: wait-point matching, scoring, result modal; receives `ModeControl` |
| `src/modes/use-playalong-mode.tsx` | Mode hook: count-in, audio-to-piano routing, F1 scoring, count-in overlay + result modal |
| `src/modes/use-listen-mode.ts` | Mode hook: thin wrapper over `MidiPlayer` for play/pause/reset/seek + sounding-note highlights |
| `lib/midi/midi-player.ts` | Class: Web Audio / MIDI playback, seek, BPM, focus-range looping, count-in scheduling (app-internal; imports `PlaybackNote` from `lib/musicxml/musicxml-playback`) |
| `lib/musicxml/musicxml-playback.ts` | Derives the `ScoreConversion` (playback notes, timing) from a MusicXML string — shared by the MIDI and direct-load paths; owns the `ScoreConversion`/`PlaybackNote` types. Imports `parseScore`/types from `@jbergknoff/sheet-music-display` |
| `lib/musicxml/mxl.ts` | Unzips `.mxl` containers (native `DecompressionStream`) and returns the root MusicXML string |
| `packages/midi-to-musicxml/src/midi-to-musicxml.ts` | Converts parsed MIDI to a MusicXML string (returns the string; the app derives the `ScoreConversion`) |
| `packages/sheet-music-display/src/SheetMusicDisplay.tsx` | Renders MusicXML visually; handles focus overlay, drag handles, cursor, right-click, and tie arcs (`computeTieArcs` + `TieLayer`, see below). Injects the bundled SMuFL `@font-face` at module load; plain text uses the `textFontFamily` prop (the app passes its theme constant); highlight types live in the sibling `highlights.ts`, glyph codepoints in `glyphs.ts` |
| `src/hooks/use-file-history.ts` | localStorage persistence: per-file history (BPM, range, mode, cursor) + attempt log |
| `src/hooks/use-bluetooth.ts` | BLE MIDI input; calls the App-owned `dispatchNoteEvent` ref, which `PracticeScreen` populates with the active mode's `onNoteEvent` each render |
| `src/theme.ts` | Design tokens (color themes + `space`/`radius`/`fontSizes`/`fontWeight` scales), font-family constants (`FONT_SANS`/`FONT_SERIF`/`FONT_MONO`), and shared style helpers (`glassPanel`, `dimBackdrop`, `blurFilter`, `serifTitle`, `cornerButtonStyle`, `miniButtonStyle`, `modalActionButtonStyle`, `chipToggleButtonStyle`). All font-family strings and frosted-glass/backdrop recipes go through here — don't re-type the literals in components |
| `src/components/icons.tsx` | All SVG icons as Preact components |

### Mode system

Three modes stored as `"wait" | "playalong" | "listen"` in `App.tsx` state and persisted in `FileHistory`.

- **Wait** — score halts; `useWaitMode` listens for correct piano chords before advancing. Play/Pause and BPM controls hidden. A `WaitPoint` separates `noteNumbers` (fresh attacks the user must press), `optionalNoteNumbers` (slashed graces — allowed, never required), and `tiedNoteNumbers` (the `tieStop` side of a tie — must still be *held* to complete the chord, but a still-held note needs no fresh press; re-pressing a released tie is allowed and unpenalised). A tie landing on a beat with no other onset creates no wait point.
- **Playalong** — the app plays back while the user plays along; notes are scored as hit or missed in real time.
- **Listen** — normal playback; sounding notes are highlighted in accent.

Every mode hook (`useWaitMode`, `usePlayalongMode`, `useListenMode`) consumes the same `ModeControl` surface — `player` (a `PlayerHandle`), `bluetooth` (a `BluetoothHandle`), `setCursor`, `setIsPlaying`, `currentBeat` + `currentBeatRef`, `musicxml`, `measureRange`, `fileHash`, `appendToDebugLog` — and returns the same `ModeHandle` shape: `{ noteHighlights, activeRef, onNoteEvent, activate, deactivate, handlePlayPause, handleReset, handleSeek, overlay, modal }`. `noteHighlights` is a unified stream of `NoteHighlight` (discriminated union: `kind: "score"` recolours an existing notehead by id, `kind: "marker"` draws a circle at an arbitrary `(beat, noteNumber)` — playalong uses both, the other modes only emit `"score"` entries). `PracticeScreen` selects `active = { wait, playalong, listen }[mode]` and delegates every transport handler to `active.*`.

Mode activation runs in a `useEffect([musicxml, mode])` inside `PracticeScreen`: the cleanup deactivates the previous mode (handle captured in the closure) and the setup activates the new one. Each hook also self-resets on `musicxml` change via its own internal effect. When the user clicks a mode button, `PracticeScreen.handleModeChange` first snaps the cursor to range start and pauses the player (matching pre-refactor behavior), then calls `onModeChange` so the mode-effect can fire. `useWaitMode.activate()` is the only one with non-trivial side effects — it snaps to its first wait point in the active range and installs a no-op `onPositionUpdate` on the player so any stray ticks don't move the cursor.

The note-event routing chain breaks the construction cycle (`useBluetooth` needs a handler, mode hooks need `bluetooth.sendNote`) by indirection: App's `useBluetooth(dispatchNoteEvent)` reads from a `noteEventDispatchRef`; `PracticeScreen` writes `active.onNoteEvent` into that ref on every render via an effect.

### Cursor and scroll system

`currentBeat: number` in `PracticeScreen` is the **single cursor** shared by all three modes. `App.tsx` keeps a mirror copy (updated via the `onCurrentBeatChange` prop) purely so the persistence snapshot can include it in `FileHistory`.

All cursor changes go through `setCursor(beat, "jump" | "smooth")` in `PracticeScreen`:

- **`"smooth"`** — used for incremental playback ticks (`MidiPlayer.onPositionUpdate`). The sheet music scroll eases toward the cursor position over several animation frames.
- **`"jump"`** — used for any discontinuous move: reset, seek (context menu), mode switch, playalong stop, end-of-piece, wait-mode advance. Writes the target beat into `snapBeatRef.current` and increments `snapGeneration` (React state). `SheetMusicDisplay` has a dedicated snap effect that depends on `snapGeneration`; it reads the beat from `snapBeatRef`, calls `computeCursorX` directly (bypassing `playbackBeat`), and sets `scrollLeft` instantly. Using the beat rather than `cursorX` ensures the snap fires even when `playbackBeat` is undefined — e.g. resetting to beat 0 in listen mode, where `cursorX` would be null.

Mode hooks reach the cursor through `control.setCursor` and the player through `control.player`. `useWaitMode` calls `control.setCursor(beat, "jump")` + `control.player.seek(beat)` synchronously inside `onNoteEvent` whenever the user plays a correct chord, with no intermediate reactive state — eliminating render-cycle lag.

**Beat → X mapping** — `computeCursorX(beat, score, layout, measureStartBeats)` in `SheetMusicDisplay.tsx` turns a quarter-note beat into an SVG x. It binary-searches `measureStartBeats` (the actual beat offset where each measure begins, computed once per piece by `computeMeasureStartBeats` from the parsed events' durations) to find the measure, then walks that measure's rhythm spine to interpolate within it. Using real per-measure offsets — rather than the old `floor(beat / beatsPerMeasure)` — keeps the cursor aligned on scores with pickup (anacrusis) bars or any other irregular measure lengths.

**Scroll detachment** — `SheetMusicDisplay` tracks a `detachedRef` boolean internally:
- Set `true` by pointer-drag or wheel events on the scroll container (the user scrolled away manually).
- While detached, the smooth-follow animation does not run.
- Clears automatically when the cursor moves back into the visible viewport.
- Also cleared immediately by any `"jump"` (the snap always re-attaches).

The result: the scroll normally follows the cursor, jump-cuts snap instantly, and a user who scrolls away to look at a different passage will have the view re-attach as soon as the cursor catches up or a transport action (reset/seek) fires.

### Focus system

`measureRange: { from: number; to: number } | null` in `App.tsx` is the single source of truth.

- `null` → whole piece; no orange overlay or drag handles rendered in `SheetMusicDisplay`
- non-null → section highlighted with a translucent orange overlay and two draggable handles
- Set via right-click context menu ("Focus measure X") or the ranges drawer; cleared via "Clear focus" in the context menu or "Whole piece" in the drawer
- When non-null, `MidiPlayer.focusRange` **loops** playback within that range: once `beat >= endBeat`, `startTick` calls `startSchedule(startBeat)` to restart from the range start (rather than stopping). `useWaitMode` also constrains wait points to that range.
- Changing the range while in listen/playalong mode: `PracticeScreen.measureRange` effect calls `player.seek(startBeat)` and `setCursor(startBeat, "jump")`, snapping the cursor to the new range start. In wait mode that effect skips the cursor move (wait mode owns the cursor); `useWaitMode`'s own `measureRange` effect handles it instead by calling `setCursor` and `player.seek` to the first wait point in the new range.
- Dragging the overlay handles auto-scrolls the sheet when the pointer approaches the container edge (`SheetMusicDisplay.onHandlePointerMove`).
- **Beat conversion**: measure number → beat offset is done via `ScoreConversion.measureStartBeats` (a `number[]` cached once on file load by `computeMeasureStartBeats`), NOT by `(measureNumber - 1) * timeSigNum`. The old formula silently breaks on any pickup measure. `measureStartBeats` is exposed directly on `ModeControl` so every mode hook can look up `ctrl.measureStartBeats[range.from - 1]` without navigating through `musicxml`.

### PracticeScreen control areas

- **Top-left** — back button, piece title (opens info modal on click)
- **Bottom-left** — Reset + Play/Pause + BPM buttons (row above in portrait, right of mode selector in landscape), Wait/Playalong/Listen mode selector; responsive via CSS `.bl-controls` / `.bl-transport` / `.bl-modes` classes
- **Bottom-right** — Bluetooth help badge (`?`), Bluetooth connection badge, settings gear

### Tie rendering

`computeTieArcs(score, layout)` in `SheetMusicDisplay.tsx` resolves every tie to
a drawable `TieArc`, and `TieLayer` strokes each as a shallow quadratic curve
between the two tied noteheads. A tie joins a note flagged `tieStart` to the next
same-pitch note flagged `tieStop` **within the same part (staff)**; because the
multi-staff voice reduction can split a held note (e.g. a half note overlapping a
faster voice) into two events — even across a barline — ties are tracked across
the whole part, keyed by pitch identity, rather than per measure. The display is
a single horizontal system (no line wrapping), so every arc is a simple
left-to-right curve. Arc direction follows the conventional rule (curve opposite
the stem): a notehead at or above the staff middle line bulges upward (arc above
the head), below it bulges downward. Without
this, every held note rendered as a second unconnected notehead, reading as a
fresh attack (the renderer draws no slurs; only ties). Tie paths carry a
`data-tie` attribute for test selection.

### Glyph font bundling

The notation is drawn with SMuFL glyphs (Unicode Private-Use-Area codepoints) that only render in a SMuFL font, so `sheet-music-display` ships its own. There is **no `glyphFontFamily` prop** — the package fully owns the glyph font; a consumer gets working notation with zero setup.

- `glyphs.ts` is the single source of truth for the glyph set: the `G` map (named glyph → char), `timeSigGlyphs`, and `RENDERED_GLYPH_CODEPOINTS` (every codepoint the renderer can emit). The renderer imports `G`/`timeSigGlyphs` from here.
- `embedded-glyph-font.ts` is **generated, committed code**: a Bravura subset (only the ~27 glyphs in `RENDERED_GLYPH_CODEPOINTS`) as a base64 woff2, plus `GLYPH_FONT_FAMILY` (`"BravuraEmbedded"`, namespaced to avoid colliding with a host page's own `Bravura`). `SheetMusicDisplay.tsx` injects it once per document via an `@font-face` `<style>` at module load (SSR- and idempotency-guarded), so it is in place before first paint.
- Regenerate with `make generate-glyph-font` (script: `packages/sheet-music-display/scripts/generate-glyph-font.ts`, using `subset-font` + `@fontsource/bravura`, both **devDependencies** of the package — never needed at runtime/install). Run it whenever the glyph set in `glyphs.ts` changes; the drift-guard test `embedded-glyph-font.test.ts` fails if the committed subset is missing a codepoint the renderer emits.
- Because the font is embedded in the JS bundle, the **app no longer loads Bravura at all** — there is no Bravura `@font-face`/preload in `index.html`, no `cp …bravura…` in the Makefile, and no `@fontsource/bravura` app dependency. (The plain-text font is still supplied by the app via the `textFontFamily` prop.)



## Debug log

`App.tsx` owns a single shared rolling buffer (last 500 events) of every note event processed by Wait and Playalong modes. The buffer is reset whenever `musicxml` changes. Each mode hook receives an `appendToDebugLog` callback through `ModeControl` and appends events as it processes them, producing a single chronological timeline.

The shared types live in `src/debug-log.ts`:

- `WaitModeDebugEvent` — captures note, kind (on/off), wait-point index, measure, beat, expected chord, held notes, milliseconds since last advance, and outcome (`advance`, `wrong`, `grace`, `incomplete`, `debounce`, `off`).
- `PlayalongDebugEvent` — captures note, kind, measure, beat, held notes, and outcome (`matched`, `extra`, `off`, `inactive`).
- Both share the `DebugBeatEvent` discriminated union, keyed on the `mode` field.
- `newDebugBuffer()` returns a `CircularBuffer<DebugBeatEvent>` pre-sized to `DEBUG_LOG_MAX`.

The underlying O(1) ring buffer is a generic `CircularBuffer<T>` class in `lib/circular-buffer/index.ts`. It exposes two methods: `append(item)` and `read()` (returns entries oldest-first). Unit tests are in `lib/circular-buffer/index.test.ts` (run with `bun test`).

App exposes a `getDebugLog()` callback that reads the buffer; it's passed through `PracticeScreen` to the **Debugging** tab of the Help (?) modal (`src/components/DebugLogTab.tsx`). Users copy it from there and paste it into bug reports.

See `docs/debug-log.md` for the full format reference and a field-by-field guide to the three main diagnostic cases: (1) correct chord not recognised in Wait mode, (2) wrong chord accepted in Wait mode, (3) correct note scored as EXTRA in Playalong mode.

When investigating a note-matching bug from a submitted log, the key fields are `expected` vs `held` at the failing event, and `msSinceAdvance` to determine whether grace-period or debounce logic was involved.

## Integration tests

Playwright specs live in `tests/integration/` and run via `make integration-test`. To exercise the wait/playalong/listen pipelines deterministically, two browser APIs are mocked in `tests/integration/mocks/`:

- `audio-context.ts` — replaces `window.AudioContext` with one whose `currentTime` is driven by `window.__advanceAudioTime(seconds)`. `MidiPlayer` derives the cursor beat from `audioCtx.currentTime`, so this gives tests precise control over cursor advance without depending on real wall-clock time.
- `bluetooth.ts` — installs a fake `navigator.bluetooth` whose `getDevices()` returns one device. The App's `useBluetooth` auto-reconnect flips status to `"connected"` on mount, enabling the Wait and Playalong mode buttons. `window.__sendBleMidi(bytes)` dispatches a raw BLE-MIDI packet through the captured `characteristicvaluechanged` listener, exercising the full `parseBLEMIDI` → dispatch pipeline.

The helpers in `tests/integration/helpers.ts` (`installMocks`, `sendNoteOn`/`sendNoteOff`/`sendChordOn`/`sendChordOff`, `advanceAudioTime`, `waitForHighlightedNoteIds`) wrap these mocks. DOM assertions on highlighted notes rely on `data-color-id` attributes set by `NoteColorOverlay` in `SheetMusicDisplay.tsx`.

## Local development

The only local requirements are `make` and `docker`. Bun, Node, and Biome are all run inside a Docker container via `docker-compose`; nothing needs to be installed on the host.

```sh
make build              # compile src/ → dist/main.js
make format             # auto-format all JS/TS files
make lint               # run Biome linter
make typecheck          # run tsc --noEmit (type-checks without building)
make unit-test          # run `bun test` against src/, lib/, packages/, and tests/unit/
make integration-test   # run Playwright specs in tests/integration/
make update-screenshots # regenerate Playwright screenshot baselines
make test               # unit-test + integration-test
make pr-ready           # runs format, lint, typecheck, build, test
```

Run `make pr-ready` before committing to ensure formatting, linting, type-checking, build, and the full test suite all pass.

The first run of any target will install dependencies into `node_modules/` (which is mounted from the host, so subsequent runs skip reinstall).

### Docker IS available in the Claude Code web sandbox

Do not assume the remote/web sandbox lacks Docker — it has it, and the full
toolchain runs through `make`. The `SessionStart` hook
(`.claude/hooks/session-start.sh`, wired up in `.claude/settings.json`) starts
`dockerd`, points it at a Docker Hub mirror (`mirror.gcr.io`, since the blob CDN
is blocked), pre-pulls the compose images, and pre-installs `node_modules`. It
runs again on session *resume*, so a resumed session also has Docker ready.

Practical consequences for an agent working in the sandbox:

- **Use the `make` targets directly** — `make unit-test`, `make integration-test`,
  `make update-screenshots`, `make pr-ready`, etc. all work here. There is no
  need to fall back to running `bun`/`playwright` by hand, and you do not need
  to invoke `docker compose` yourself; `make` does.
- **Integration tests and screenshots run here.** `make integration-test`
  launches the Playwright container against the built app, and
  `make update-screenshots` regenerates baselines. Generate/refresh screenshot
  baselines inside this environment (they are only pixel-stable in the
  Playwright Docker image).
- **The commit gate runs Docker too.** The `PreToolUse` hook on `git commit`
  runs `make pr-ready`; if Docker or the toolchain isn't ready the commit is
  blocked, so let the session-start hook finish before committing.
- Running `bun test` directly (outside Docker) works for quick unit checks, but
  it has no DOM — parser/render code needs the `linkedom` setup from
  `src/test-setup.ts` (preloaded by `bun test` via `bunfig.toml`).

## Build output

`dist/` is gitignored and excluded from Biome linting/formatting. `make build` must be run before `index.html` will work — it produces `dist/main.js`, which the page loads.

## Code style

Always write out full words in variable, function, and type names. Never shorten names by dropping letters or syllables (e.g. `debugBase` not `dbgBase`, `temporary` not `tmp`, `index` not `idx`, `previous` not `prev`). Abbreviated names slow down readers who aren't already familiar with the code.

Always use braces around conditional and loop bodies, even for single-line statements:

```ts
// correct
if (!value) {
  return;
}

// wrong
if (!value) return;
```

### Button styles

Always reach for the shared helpers in `src/theme.ts` before writing ad-hoc button styles:

- **`cornerButtonStyle(theme)`** — 38×38 frosted-glass square with `radius.lg`. Used for the main nav/transport buttons (back, reset, play/pause, gear, help badge).
- **`miniButtonStyle(theme)`** — 22×22, transparent background, no border, `radius.sm`. Used for small icon-only buttons inside panels or inline with other content (e.g. the trash icon in the debug log tab).
- **`modalActionButtonStyle(theme, variant, accent?, enabled?)`** — text-label action buttons at the foot of modals. `"ghost"` for secondary (Cancel); `"accent"` for primary (OK/Save), passing the accent colour and an enabled flag.
- **`chipToggleButtonStyle(theme, accent, isActive)`** — variable-width toggle pill for use inside chip containers (e.g. BPM preset buttons). Sizes by padding rather than fixed width; carries active-state highlight styling.

Two rules that must hold:

1. **Never write ad-hoc button styles.** If none of the helpers above fit, add a new named helper to `theme.ts` rather than writing inline `width`/`height`/`borderRadius`/`background`/`fontSize`/`padding`/`fontFamily` combinations directly on a `<button>`. Writing one-off combinations is what causes the next author to copy-paste them instead of reaching for a helper.

2. **Never override a helper's own structural properties at the call site.** Spreading a helper and then immediately overriding its `width`, `height`, `borderRadius`, or `background` defeats the purpose. If the dimensions need to differ, either the helper is the wrong choice (pick a different one or add a new one) or the container should accommodate the standard size.

## Dependencies

`bun.lock` is committed. When adding or removing packages, commit the updated `bun.lock` alongside `package.json`.

## Pull requests

A PR description should always lead with the motivation for the change — the
problem being solved or the reason the change is needed — before describing what
was changed. A reviewer should understand *why* the PR exists from the first
paragraph, not have to infer it from a list of edits.

## CI

GitHub Actions runs `make pr-ready` on every push and pull request (`.github/workflows/ci.yml`), followed by `git diff --exit-code` to fail with a visible diff if files weren't pre-formatted.

## Deployment

Netlify is connected to this repo:

- **Production** — deploys automatically from `main`
- **PR previews** — every pull request gets a unique deploy preview URL, posted as a PR comment by the Netlify bot

## Bun version

The Bun version is pinned via `BUN_VERSION` in `netlify.toml`. `docker-compose.yml` reads that same env var (defaulting to the same value), so changing it in one place keeps both environments in sync.
