# Agent notes

## Keeping this file current

**Update the Architecture section below whenever you make changes that affect it** — new screens, new hooks, changes to the mode or focus systems, new control areas, or significant state ownership shifts. The goal is that a future agent can read this file and skip broad exploration. A stale architecture section is worse than none, so if you change something described here, update the description in the same commit.

## Architecture

### Two-screen model

The app renders either `LandingScreen` (file picker) or `PracticeScreen` (practice view), driven by whether `midiData` is loaded. `App.tsx` is a session shell — it owns file loading + persistence + bluetooth + the persisted settings (mode, BPM, range, etc.) and routes between the two screens. `PracticeScreen` owns everything that runs the practice session: the `MidiPlayer`, the live cursor, the three mode hooks, the result modals, and the count-in overlay.

### Data pipeline

MIDI file → `parseMidi` (midi-file) → `midiToMusicXmlWithTracks` → `MidiConversionResult` (contains `musicxml` string, `notes`, `totalBeats`, `timeSigNum`) → fed into `MidiPlayer` for playback and into each mode hook (`useWaitMode`, `usePlayalongMode`, `useListenMode`) via the shared `ModeControl`.

### Key files

| File | Role |
|------|------|
| `src/App.tsx` | Session shell: file load/parse, history persistence, bluetooth, force-listen-on-disconnect, landing↔practice routing |
| `src/components/PracticeScreen.tsx` | Owns the `MidiPlayer`, the live cursor + snap state, transport delegation, and instantiates the three mode hooks; renders `{active.overlay}` and `{active.modal}` |
| `src/components/LandingScreen.tsx` | File drop/pick screen |
| `src/mode-control.ts` | `ModeControl` / `ModeHandle` interfaces and `createPlayerHandle` (stable handle that delegates to whatever `MidiPlayer` the getter currently returns) |
| `src/use-wait-mode.tsx` | Mode hook: wait-point matching, scoring, result modal; receives `ModeControl` |
| `src/use-playalong-mode.tsx` | Mode hook: count-in, audio-to-piano routing, F1 scoring, count-in overlay + result modal |
| `src/use-listen-mode.ts` | Mode hook: thin wrapper over `MidiPlayer` for play/pause/reset/seek + sounding-note highlights |
| `src/midi-player.ts` | Class: Web Audio / MIDI playback, seek, BPM, focus-range looping, count-in scheduling |
| `src/midi-to-musicxml.ts` | Converts parsed MIDI to MusicXML + note list used throughout |
| `src/SheetMusicDisplay.tsx` | Renders MusicXML visually; handles focus overlay, drag handles, cursor, right-click |
| `src/use-file-history.ts` | localStorage persistence: per-file history (BPM, range, mode, cursor) + attempt log |
| `src/useBluetooth.ts` | BLE MIDI input; calls the App-owned `dispatchNoteEvent` ref, which `PracticeScreen` populates with the active mode's `onNoteEvent` each render |
| `src/theme.ts` | Design tokens + `cornerBtnStyle` / `miniBtnStyle` helpers |
| `src/components/icons.tsx` | All SVG icons as Preact components |

### Mode system

Three modes stored as `"wait" | "playalong" | "listen"` in `App.tsx` state and persisted in `FileHistory`.

- **Wait** — score halts; `useWaitMode` listens for correct piano chords before advancing. Play/Pause and BPM controls hidden.
- **Playalong** — the app plays back while the user plays along; notes are scored as hit or missed in real time.
- **Listen** — normal playback; sounding notes are highlighted in accent.

Every mode hook (`useWaitMode`, `usePlayalongMode`, `useListenMode`) consumes the same `ModeControl` surface — `player` (a `PlayerHandle`), `bluetooth` (a `BluetoothHandle`), `setCursor`, `setIsPlaying`, `currentBeat` + `currentBeatRef`, `musicxml`, `measureRange`, `fileHash`, `appendToDebugLog` — and returns the same `ModeHandle` shape: `{ noteColors, activeRef, onNoteEvent, activate, deactivate, handlePlayPause, handleReset, handleSeek, overlay, modal }`. `PracticeScreen` selects `active = { wait, playalong, listen }[mode]` and delegates every transport handler to `active.*`.

Mode activation runs in a `useEffect([musicxml, mode])` inside `PracticeScreen`: the cleanup deactivates the previous mode (handle captured in the closure) and the setup activates the new one. Each hook also self-resets on `musicxml` change via its own internal effect. When the user clicks a mode button, `PracticeScreen.handleModeChange` first snaps the cursor to range start and pauses the player (matching pre-refactor behavior), then calls `onModeChange` so the mode-effect can fire. `useWaitMode.activate()` is the only one with non-trivial side effects — it snaps to its first wait point in the active range and installs a no-op `onPositionUpdate` on the player so any stray ticks don't move the cursor.

The note-event routing chain breaks the construction cycle (`useBluetooth` needs a handler, mode hooks need `bluetooth.sendNote`) by indirection: App's `useBluetooth(dispatchNoteEvent)` reads from a `noteEventDispatchRef`; `PracticeScreen` writes `active.onNoteEvent` into that ref on every render via an effect.

### Cursor and scroll system

`currentBeat: number` in `PracticeScreen` is the **single cursor** shared by all three modes. `App.tsx` keeps a mirror copy (updated via the `onCurrentBeatChange` prop) purely so the persistence snapshot can include it in `FileHistory`.

All cursor changes go through `setCursor(beat, "jump" | "smooth")` in `PracticeScreen`:

- **`"smooth"`** — used for incremental playback ticks (`MidiPlayer.onPositionUpdate`). The sheet music scroll eases toward the cursor position over several animation frames.
- **`"jump"`** — used for any discontinuous move: reset, seek (context menu), mode switch, playalong stop, end-of-piece, wait-mode advance. Writes the target beat into `snapBeatRef.current` and increments `snapGeneration` (React state). `SheetMusicDisplay` has a dedicated snap effect that depends on `snapGeneration`; it reads the beat from `snapBeatRef`, calls `computeCursorX` directly (bypassing `playbackBeat`), and sets `scrollLeft` instantly. Using the beat rather than `cursorX` ensures the snap fires even when `playbackBeat` is undefined — e.g. resetting to beat 0 in listen mode, where `cursorX` would be null.

Mode hooks reach the cursor through `control.setCursor` and the player through `control.player`. `useWaitMode` calls `control.setCursor(beat, "jump")` + `control.player.seek(beat)` synchronously inside `onNoteEvent` whenever the user plays a correct chord, with no intermediate reactive state — eliminating render-cycle lag.

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
- Set via right-click context menu ("Focus measure X"); cleared via "Clear focus" in the same menu
- When non-null, `MidiPlayer.focusRange` loops playback within that range, and `useWaitMode` constrains wait points to that range

### PracticeScreen control areas

- **Top-left** — back button, piece title (opens info modal on click)
- **Bottom-left** — Reset + Play/Pause + BPM buttons (row above in portrait, right of mode selector in landscape), Wait/Playalong/Listen mode selector; responsive via CSS `.bl-controls` / `.bl-transport` / `.bl-modes` classes
- **Bottom-right** — Bluetooth help badge (`?`), Bluetooth connection badge, settings gear



## Debug log

`App.tsx` owns a single shared rolling buffer (last 50 events) of every note event processed by Wait and Playalong modes. The buffer is reset whenever `musicxml` changes. Each mode hook receives an `appendToDebugLog` callback through `ModeControl` and appends events as it processes them, producing a single chronological timeline.

The shared types live in `src/debug-log.ts`:

- `WaitModeDebugEvent` — captures note, kind (on/off), wait-point index, measure, beat, expected chord, held notes, milliseconds since last advance, and outcome (`advance`, `wrong`, `grace`, `incomplete`, `debounce`, `off`).
- `PlayalongDebugEvent` — captures note, kind, measure, beat, held notes, and outcome (`matched`, `extra`, `off`, `inactive`).
- Both share the `DebugBeatEvent` discriminated union, keyed on the `mode` field.
- `newDebugBuffer()` returns a `CircularBuffer<DebugBeatEvent>` pre-sized to `DEBUG_LOG_MAX`.

The underlying O(1) ring buffer is a generic `CircularBuffer<T>` class in `lib/circular-buffer/index.ts`. It exposes two methods: `append(item)` and `read()` (returns entries oldest-first). Unit tests are in `lib/circular-buffer/index.test.ts` (run with `bun test`).

App exposes a `getDebugLog()` callback that reads the buffer; it's passed through `PracticeScreen` to the **Debugging** tab of the Help (?) modal (`src/components/DebugLogTab.tsx`). Users copy it from there and paste it into bug reports.

See `docs/debug-log.md` for the full format reference and a field-by-field guide to the three main diagnostic cases: (1) correct chord not recognised in Wait mode, (2) wrong chord accepted in Wait mode, (3) correct note scored as EXTRA in Playalong mode.

When investigating a note-matching bug from a submitted log, the key fields are `expected` vs `held` at the failing event, and `msSinceAdvance` to determine whether grace-period or debounce logic was involved.

## Local development

The only local requirements are `make` and `docker`. Bun, Node, and Biome are all run inside a Docker container via `docker-compose`; nothing needs to be installed on the host.

```sh
make build      # compile src/ → dist/main.js
make format     # auto-format all JS/TS files
make lint       # run Biome linter
make typecheck  # run tsc --noEmit (type-checks without building)
make pr-ready   # runs format, lint, typecheck, build
```

Run `make pr-ready` before committing to ensure formatting, linting, type-checking, and build all pass.

The first run of any target will install dependencies into `node_modules/` (which is mounted from the host, so subsequent runs skip reinstall).

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

## Dependencies

`bun.lock` is committed. When adding or removing packages, commit the updated `bun.lock` alongside `package.json`.

## CI

GitHub Actions runs `make pr-ready` on every push and pull request (`.github/workflows/ci.yml`), followed by `git diff --exit-code` to fail with a visible diff if files weren't pre-formatted.

## Deployment

Netlify is connected to this repo:

- **Production** — deploys automatically from `main`
- **PR previews** — every pull request gets a unique deploy preview URL, posted as a PR comment by the Netlify bot

## Bun version

The Bun version is pinned via `BUN_VERSION` in `netlify.toml`. `docker-compose.yml` reads that same env var (defaulting to the same value), so changing it in one place keeps both environments in sync.
