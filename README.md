# piano-practice

A browser-based piano practice app. Load a MIDI or MusicXML file, connect a
digital piano over Bluetooth or USB, and the app renders the sheet music and
listens to what you play — waiting for you, playing along with you, or just
performing the piece while you follow.

Everything runs client-side: there is no server, no account, and no data leaves
the browser. Files, settings, and practice history are stored locally.

## Practice modes

- **Wait** — the score halts at each chord and advances only when you play it
  correctly. Grace notes, ties, and legato passages are handled musically: tied
  notes must still be held but need no fresh press, slashed graces are optional,
  and a wrong key held down blocks the advance until released. Each attempt over
  the selected passage is scored (accuracy-weighted, with a tempo component —
  see [docs/wait-mode-scoring.md](docs/wait-mode-scoring.md)) and logged.
- **Playalong** — the app plays the piece (with optional count-in and
  metronome) while you play along; every note you press is scored hit or miss
  in real time and marked on the score, and the attempt gets an overall score
  per tempo.
- **Listen** — normal playback with the sounding notes highlighted, for
  learning how a passage goes.

## Other features

- **Sheet music rendering** — a custom SMuFL-based renderer (see
  [docs/rendering-approach.md](docs/rendering-approach.md)) draws the score as
  a single horizontally-scrolling system, with a smooth-following cursor,
  grand-staff support, beams, ties, grace notes, and accidentals. The music
  font is embedded, so notation works with zero setup.
- **Focus ranges** — right-click (or long-press) a measure to focus a section;
  drag the handles to resize it. Playback loops within the range, wait mode
  constrains itself to it, and ranges can be named and saved per piece.
- **Per-piece memory** — BPM, mode, focus range, cursor position, and attempt
  history are remembered per file (keyed by content hash), so reopening a piece
  drops you back where you left off.
- **Tempo control** — practice below (or above) the marked tempo; playalong
  scores are tracked per BPM.
- **Debug log** — the Help modal includes a copyable event log of exactly how
  each note you played was judged, for diagnosing matching issues
  ([docs/debug-log.md](docs/debug-log.md)).

## Supported files

`.mid` / `.midi` (converted to MusicXML internally, with track selection),
`.musicxml` / `.xml`, and compressed `.mxl`. Repeats are expanded for playback.

## Connecting a piano

The app takes live input from a digital piano over either transport, choosing
automatically when you tap the connection badge:

- **USB (Web MIDI)** — plug the piano into the device; works in Chromium
  browsers on desktop and Android. On Linux, pianos bridged to ALSA by BlueZ
  also show up here.
- **Bluetooth (Web BLE MIDI)** — works in Chromium browsers on Android. Pair
  the piano in system Bluetooth settings first (pairing mode is usually a
  dedicated button on the piano — check its manual), then connect from the app
  and pick the piano in the browser's device chooser.

**Brave only:** Web Bluetooth is disabled by default. Enable
`enable-experimental-web-platform-features` at `brave://flags` and relaunch.
Chrome needs no extra setup.

Without a connected piano, Listen mode still works fully; Wait and Playalong
need live input.

## Status

Actively developed and used for daily practice. Current limitations worth
knowing:

- The score renders as one long horizontal system — there is no line wrapping
  or page layout yet (planned: [docs/line-wrapping-plan.md](docs/line-wrapping-plan.md)).
- Dense multi-voice passages are rendered as a rhythmic reduction (voices
  within a staff merge into one onset-ordered stream), not full voice
  separation. Dynamics, slurs, and most ornaments are not rendered.
- Only the most recently opened file is kept for quick reopening; there is no
  file library yet.

A WYSIWYG MusicXML editor built on the same renderer is in early planning
(`editor/PLAN.md`).

## How it's built

Preact + TypeScript, bundled with Bun; no framework beyond that. The repo is a
Bun workspace with two dependency-light packages that the app consumes:

- [`packages/sheet-music-display`](packages/sheet-music-display) — parses and
  renders MusicXML as SVG, with stable per-note IDs so callers can recolor
  individual noteheads. Ships its own embedded Bravura glyph subset.
- [`packages/midi-to-musicxml`](packages/midi-to-musicxml) — converts a parsed
  MIDI file into a MusicXML string.

The MusicXML string is the single source of truth: both file paths (MIDI and
MusicXML) converge on it, and playback timing, wait points, and rendering are
all derived from the same parse. Architecture details live in
[CLAUDE.md](CLAUDE.md).

## Development

The only local requirements are `make` and `docker` — Bun, Node, Biome, and
Playwright all run in containers.

```sh
make build              # compile src/ → dist/main.js (needed before index.html works)
make format             # auto-format
make lint               # Biome linter
make typecheck          # tsc --noEmit
make unit-test          # bun test
make integration-test   # Playwright specs in tests/integration/
make pr-ready           # all of the above; run before committing
```

CI runs `make pr-ready` on every push. Netlify deploys production from `main`
and posts a preview URL on every pull request.

## Licenses

Sheet music notation glyphs are rendered using the [Bravura](https://github.com/steinbergmedia/bravura) font by Steinberg Media Technologies GmbH, licensed under the [SIL Open Font License 1.1](https://openfontlicense.org/).

MusicXML test fixtures include the Rondo alla Turca (Piano Sonata No. 11 K. 331, 3rd movement) by W. A. Mozart, sourced from the [musetrainer/library](https://musetrainer.github.io/library/) collection of public domain MusicXML files. Mozart's works are in the public domain.
