# Using the debug log

The **Debugging** tab in the Help (?) modal captures a rolling record of
the last 50 note events processed by Wait mode. Use it to report cases
where note matching behaves incorrectly.

## How to capture a log

1. Open a piece and enter **Wait mode**.
2. Play until you observe incorrect behavior.
3. Immediately tap **?** → **Debugging** → **Refresh** (so the buffer
   reflects what just happened), then tap **Copy**.
4. Paste the log into your bug report.

The log is cleared whenever a new file is loaded.

---

## Reading the log

Each line represents one note event:

```
+0.091s  ON   G4(67)      waitPoint=3 measure=3 beat=9.00  expected=[C4(60),E4(64),G4(67)]  held=[C4(60),E4(64),G4(67)]  msSinceAdvance=5325  → ADVANCE
```

| Field | Meaning |
|---|---|
| `+0.091s` | Time since the first event in this buffer |
| `ON` / `OFF` | Note pressed or released |
| `G4(67)` | Note name and MIDI number of the key that triggered this event |
| `waitPoint=3` | Index of the wait point the app was sitting on at the time |
| `measure=3` | Measure number corresponding to that wait point |
| `beat=9.00` | Absolute score beat (from the start of the piece) corresponding to that wait point |
| `expected=[…]` | Notes the app required to be held to advance |
| `held=[…]` | All keys physically held down after this event |
| `msSinceAdvance` | Milliseconds since the last successful advance (relevant for grace-period and debounce logic) |
| `→ OUTCOME` | Decision made for this event (see below) |

### Outcomes

| Outcome | Meaning |
|---|---|
| `ADVANCE` | All expected notes were held — cursor moved to the next beat |
| `INCOMPLETE` | The pressed note is in the expected chord but not all expected notes are held yet |
| `WRONG` | The pressed note is not in the expected chord; wrong-note feedback fired |
| `GRACE` | Wrong note, but ignored because it arrived within the grace period after the previous advance (`msSinceAdvance < noteSensitivityMilliseconds`) |
| `DEBOUNCE` | A correct note that would have triggered an advance, but arrived within 100 ms of the last advance and was ignored to prevent double-advancing on the same chord |
| `OFF` | Note-release event — no matching logic runs, logged for timeline completeness |

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
  a subset of the notes that appear on the score at that beat. Check
  whether some of those notes are ties (a tied note is not a new
  attack, so it doesn't appear in `expected`). The `beat` field will
  tell you which score position was being evaluated; cross-reference
  with the sheet music.

- **`ADVANCE` appears after several `WRONG` events** — The wrong keys
  eventually triggered the correct chord being held (e.g., you hit
  extra notes but also happened to hold all the expected ones). The
  `WRONG` events count against you in the stats but don't block
  advancement once the chord is satisfied.

- **`GRACE` events before `ADVANCE`** — Wrong notes fired during the
  grace window don't count as wrong and don't block progression. If the
  grace window is too wide, reducing the note-sensitivity setting
  (Settings drawer) will shorten it.
