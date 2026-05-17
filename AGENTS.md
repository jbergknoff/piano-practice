# Agent notes

## Keeping this file current

**Update the Architecture section below whenever you make changes that affect it** — new screens, new hooks, changes to the mode or focus systems, new control areas, or significant state ownership shifts. The goal is that a future agent can read this file and skip broad exploration. A stale architecture section is worse than none, so if you change something described here, update the description in the same commit.

## Architecture

### Two-screen model

The app renders either `LandingScreen` (file picker) or `PracticeScreen` (practice view), driven by whether `midiData` is loaded. `App.tsx` owns all shared state and passes everything down as props.

### Data pipeline

MIDI file → `parseMidi` (midi-file) → `midiToMusicXmlWithTracks` → `MidiConversionResult` (contains `musicxml` string, `notes`, `totalBeats`, `timeSigNum`) → fed into `MidiPlayer` for playback and `useWaitMode` for interactive practice.

### Key files

| File | Role |
|------|------|
| `src/App.tsx` | State hub: owns all app state, instantiates hooks, passes props to screens |
| `src/components/PracticeScreen.tsx` | Main UI layout; mostly presentational, receives all state + callbacks via props |
| `src/components/LandingScreen.tsx` | File drop/pick screen |
| `src/use-wait-mode.ts` | Hook: tracks expected chords, detects correct piano input, fires completion callback |
| `src/midi-player.ts` | Class: Web Audio / MIDI playback, seek, BPM, focus-range looping |
| `src/midi-to-musicxml.ts` | Converts parsed MIDI to MusicXML + note list used throughout |
| `src/SheetMusicDisplay.tsx` | Renders MusicXML visually; handles focus overlay, drag handles, cursor, right-click |
| `src/use-file-history.ts` | localStorage persistence: per-file history (BPM, range, mode, cursor) + attempt log |
| `src/useBluetooth.ts` | BLE MIDI input; calls `waitMode.onNoteEvent` on each note |
| `src/theme.ts` | Design tokens + `cornerBtnStyle` / `miniBtnStyle` helpers |
| `src/components/icons.tsx` | All SVG icons as Preact components |

### Mode system

Three modes stored as `"wait" | "race" | "listen"` in `App.tsx` state and persisted in `FileHistory`.

- **Wait** — score halts; `useWaitMode` is active and listens for correct piano chords before advancing. Play/Pause and BPM controls hidden.
- **Playalong** (`"race"`) — not yet implemented; reserved. Behaves like Listen for now.
- **Listen** — normal playback; `useWaitMode` inactive. Play/Pause and BPM controls shown.

`useWaitMode` always starts with `active = true`; `handleModeChange` in App.tsx calls `waitMode.toggle()` to keep the hook in sync when the mode changes.

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

`useWaitMode` maintains a rolling buffer (last 50 events) of every note event processed in Wait mode. Each `DebugBeatEvent` (exported from `src/use-wait-mode.ts`) captures the note, kind (on/off), current wait-point index, measure number, absolute beat, expected chord, all held notes, milliseconds since the last advance, and a classified outcome (`advance`, `wrong`, `grace`, `incomplete`, `debounce`, `off`).

The log is exposed via `waitMode.getDebugLog()` and rendered in the **Debugging** tab of the Help (?) modal (`src/components/HelpBadge.tsx`). Users copy it from there and paste it into bug reports.

See `docs/debug-log.md` for the full format reference and a field-by-field guide to diagnosing the two main failure modes (false negative: correct chord not recognised; false positive: wrong chord accepted).

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
