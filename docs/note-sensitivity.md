# Note Sensitivity in Wait Mode

## Problem

During fast runs in wait mode, a note from the *previous* beat can still be "note on" when the cursor advances to the next beat. That lingering event fires against the new expected chord — which doesn't contain it — and immediately triggers the wrong-note buzz, even though the player did nothing wrong.

## Solution

A **post-advance grace period** (`noteSensitivityMilliseconds`) suppresses the audible wrong-note buzz for a short window after each successful advance, so a lingering note from a fast run doesn't punish a player who did nothing wrong. Notes in the expected chord are always accepted immediately.

Note what the grace period does **not** do: it no longer lets an unexpected note slide past a wait point. A wrong note pressed during the grace window is still recorded as a held wrong note (see "Wrong notes block the advance" below) and blocks advancement until released — the grace window only mutes the *buzz*, not the gate. This is what keeps the grace forgiveness from making the matching lax (it used to: a wrong note mashed within the window passed straight through).

## Wrong notes block the advance

Matching the expected chord means holding *exactly* the expected notes. `judgeKeyPress` tracks the currently-held notes that are not part of the expected chord in the `KeyPressState`'s `wrongHeld` set; while that set is non-empty the advance is refused (`outcome: "extra"`), even when every expected note is also down. Mashing a fistful of keys therefore fails: the extra keys are held alongside the correct one, so the chord is not cleanly played.

Sustained/legato notes carried over from a previous chord never enter that set — they generate no fresh Note On — so legato passages still advance. Only a note that was *unexpected at the moment it was pressed* and is *still held* blocks. A quick brush during a fast run is released almost immediately, so it rarely blocks in practice; a deliberately-held wrong key does.

## Implementation

The grace check lives in `judgeKeyPress` in `src/modes/wait-matching.ts`, a pure function that `useWaitMode`'s `onNoteEvent` calls for every key press. The held wrong note is recorded first, then the grace window only decides between the `"grace"` and `"wrong"` outcomes:

```ts
wrongHeld.add(noteNumber); // blocks the advance regardless
if (msSinceAdvance < sensitivityMilliseconds) {
  return judged("grace"); // within grace window — recorded, but no buzz
}
return judged("wrong"); // the hook buzzes and counts it
```

`noteSensitivityMilliseconds` is part of the `WaitModeSettings` object passed into `useWaitMode` and mirrored to `settingsRef`, so the stable `onNoteEvent` callback can pass the latest value to `judgeKeyPress` without going stale.

It is the only time-based rule in wait mode, and it never affects whether a chord advances, only whether a wrong note is penalised. (A 50 ms debounce for correct notes used to sit alongside it, but once a completed chord was allowed to advance inside it, it only relabelled incomplete chords in the debug log, so it was removed.) It is covered by unit tests in `src/modes/wait-matching.test.ts`.

## Configuration

There is no longer a user-facing slider (the expert sliders were removed in #65). The value is hardcoded in `PracticeScreen` (`noteSensitivityMilliseconds = 150`) and marked as intentionally not user-facing; adjust it there to tune the buzz-suppression window.

## Default

**150 ms.** This covers the typical note-overlap window in fast passages without buzzing on genuinely-late lingering notes. Because the window now only affects the buzz (not the gate), the value is no longer a strict-vs-lax knob.
