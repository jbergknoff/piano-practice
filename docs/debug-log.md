# Using the debug log

The **Debugging** tab in the Help (?) modal captures a rolling record of
the last 500 note events processed by Wait and Playalong modes. Use it to
report cases where note matching behaves incorrectly.

## How to capture a log

1. Open a piece and enter **Wait** or **Playalong** mode.
2. Play until you observe incorrect behavior.
3. Immediately tap **?** → **Debugging** → **Copy**.
4. Paste the log into your bug report.

The log is cleared whenever a new file is loaded. Events from both modes
are merged into a single chronological timeline.

---

## Reading the log

Each line represents one note event. The format differs slightly between
modes.

### Wait mode

```
2026-05-17T14:23:01.091Z  [wait]      ON   G4(67)      waitPoint=3 measure=3 beat=9.00  expected=[C4(60),E4(64),G4(67)]  held=[C4(60),E4(64),G4(67)]  fresh=[C4(60),E4(64),G4(67)]  msSinceAdvance=5325  → ADVANCE
```

### Playalong mode

```
2026-05-17T14:23:02.500Z  [playalong]  ON   C5(72)      measure=4 beat=12.00  held=[C5(72)]  → MATCHED
```

### Field reference

| Field | Meaning |
|---|---|
| `2026-05-17T14:23:01.091Z` | UTC timestamp with millisecond precision (ISO 8601) |
| `[wait]` / `[playalong]` | Which mode was active when the event was recorded |
| `ON` / `OFF` | Note pressed or released |
| `G4(67)` | Note name and MIDI number of the key that triggered this event |
| `waitPoint=3` | *(Wait only)* Index of the wait point the app was sitting on |
| `measure=3` | Measure number at the time of the event |
| `beat=9.00` | Absolute score beat from the start of the piece |
| `expected=[…]` | *(Wait only)* Notes required to be held simultaneously to advance |
| `held=[…]` | All keys physically held down after this event |
| `fresh=[…]` | *(Wait only)* Subset of `held` that received a fresh press (a Note On while not already down) since the last advance. A required note completes the chord only when it appears here — a key held over from the previous chord does not. `expected ⊆ held` but an expected note absent from `fresh` means a repeated note/chord was not re-struck (see `STALE`) |
| `msSinceAdvance=…` | *(Wait only)* Milliseconds since the last successful advance — relevant for grace-period and debounce diagnosis |
| `→ OUTCOME` | Decision made for this event (see below) |

---

## Outcomes

### Wait mode

| Outcome | Meaning |
|---|---|
| `ADVANCE` | All expected notes were held — cursor moved to the next beat |
| `INCOMPLETE` | The pressed note is in the expected chord, but not all expected notes are held yet |
| `STALE` | Every expected note *is* held (`expected ⊆ held`), but a required one was held over from a previous chord rather than freshly struck — so it is absent from `fresh`. This is what a repeated note/chord looks like when the player holds it instead of re-striking each occurrence. Release and re-press the repeated note(s). A tied note is exempt — it only needs to stay held |
| `WRONG` | The pressed note is not in the expected chord; wrong-note feedback fired |
| `EXTRA` | Every expected note was held, but the advance was blocked because the user is also holding wrong notes (e.g. mashing extra keys). Release the extra keys and re-press the chord |
| `GRACE` | Wrong note, but ignored because it arrived within the grace period after the previous advance (`msSinceAdvance < noteSensitivityMilliseconds`) |
| `DEBOUNCE` | A correct note that would have triggered an advance, but arrived within 100 ms of the last advance and was ignored to prevent double-advancing on the same chord |
| `DUPLICATE` | A `ON` event for a key that was already held (no intervening `OFF`) — a duplicate the instrument re-sent for a sustained/pedalled note, or the tail of a rolled chord. Ignored, and deliberately not counted as a wrong held note so it can't block the next advance |
| `OFF` | Note-release event — no matching logic runs, logged for timeline completeness |

### Playalong mode

| Outcome | Meaning |
|---|---|
| `MATCHED` | The note matched a score note within the timing tolerance window |
| `EXTRA` | The note did not match any score note at the current beat (wrong note or mistimed) |
| `OFF` | Note-release event, logged for timeline completeness |
| `INACTIVE` | Note pressed while playalong was not in the playing phase (e.g. during count-in or after completion) |

---

## Case 1: I played it correctly but Wait mode wouldn't advance

Look for a cluster of `ON` events around the beat that should have
advanced. The outcome column will tell you why it didn't.

**Things to check:**

- **`INCOMPLETE` on every note-on** — The app agreed that each key you
  pressed was in the expected chord, but never saw all of them held at
  the same time. Compare the `held` list at each event against the
  `expected` list. If they look identical but no `ADVANCE` appeared, a
  preceding `OFF` event may have released one key a fraction of a
  millisecond before the last `ON` arrived — a timing edge case.

- **`WRONG` instead of `INCOMPLETE`** — One of the keys you pressed is
  not in `expected`. Cross-check the note names: MIDI note numbers are
  octave-sensitive (e.g. `C4(60)` vs `C5(72)`). The piece may require a
  note in a different octave than the one you played.

- **`DEBOUNCE`** — The advance was suppressed because it happened within
  100 ms of the previous one. This can happen when a single physical
  key press generates two MIDI note-on events (rare, but possible with
  some pianos/adapters). The `msSinceAdvance` value will be under 100.

- **`EXTRA` on the note you meant to play** — Every expected note was
  held, but the advance was blocked because the app thought you were
  also holding a wrong note. Look for an earlier `WRONG`/`GRACE` `ON`
  event whose note is still in `held` (it never got an `OFF`). A common
  cause is a chord tone you are sustaining across consecutive wait
  points that the instrument re-sends a `Note On` for: that duplicate
  is now logged as `DUPLICATE` and ignored, so it no longer blocks the
  next chord. If you still see `EXTRA`, the held note in question got a
  genuine fresh press (a different finger) — release it and re-press
  the expected chord.

- **`GRACE`** — The note was treated as a stray leftover from the
  previous beat and silently dropped. The `msSinceAdvance` value will
  be less than the configured note-sensitivity window (default 150 ms).
  If legitimate notes are being swallowed this way, the sensitivity
  setting may need to be lowered.

---

## Case 2: I played it wrong but Wait mode let me advance anyway

Find the `ADVANCE` event and look at its `expected` and `held` fields.

**Things to check:**

- **`held` contains keys beyond `expected`** — Extra held notes are
  intentionally allowed (the other hand may still be sustaining a chord
  from the previous beat). This is correct behavior, not a bug.

- **`expected` is smaller than you thought** — The app may only require
  a subset of the notes that appear on the score at that beat. The `beat`
  field tells you which score position was being evaluated; cross-reference
  with the sheet music. Note that the `tieStop` side of a tie *is* included
  in `expected` (it must still be held to complete the chord), but it needs
  no fresh attack — if you kept it held from the previous beat there will be
  no Note On for it, yet it still counts toward the chord.

- **`ADVANCE` appears after several `WRONG` events** — The wrong keys
  eventually triggered the correct chord being held (e.g., you hit
  extra notes but also happened to hold all the expected ones). The
  `WRONG` events count against you in the stats but don't block
  advancement once the chord is satisfied.

- **`GRACE` events before `ADVANCE`** — Wrong notes fired during the
  grace window don't count as wrong and don't block progression. If the
  grace window is too wide, reducing the note-sensitivity setting
  (Settings drawer) will shorten it.

- **A repeated chord won't advance past the first strike** — A chord that
  repeats on consecutive beats must be re-struck for each occurrence. If you
  hold it down (or the instrument re-sends `Note On` for the still-held keys),
  the repeats show as `STALE` — `expected ⊆ held` but the required notes are
  missing from `fresh`, because they were held over rather than freshly
  struck. Release and re-press for each repeat. If a held note is genuinely
  meant to carry over, it is a tie in the score and appears in `expected`
  without needing a fresh press.

---

## Case 3: Playalong scored a note as EXTRA when I think I played it correctly

Find the `EXTRA` event and check the `beat` field.

**Things to check:**

- **`beat` is far from the expected note's position** — Playalong
  matching is time-based: a note is accepted only if it falls within
  the timing tolerance window (configurable in Settings) of the score's
  beat. If you played the right note but too early or too late, it will
  appear as `EXTRA`.

- **`beat` looks correct but still `EXTRA`** — The note may already have
  been matched by an earlier event (duplicate note-on from the piano, or
  the same note appearing in multiple voices). Look for a preceding
  `MATCHED` event for the same note number at the same beat.
