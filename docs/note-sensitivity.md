# Note Sensitivity in Wait Mode

## Problem

During fast runs in wait mode, a note from the *previous* beat can still be "note on" when the cursor advances to the next beat. That lingering event fires against the new expected chord — which doesn't contain it — and immediately triggers the wrong-note buzz, even though the player did nothing wrong.

## Solution

A **post-advance grace period** (`noteSensitivityMilliseconds`) suppresses the audible wrong-note buzz for a short window after each successful advance, so a lingering note from a fast run doesn't punish a player who did nothing wrong. Notes in the expected chord are always accepted immediately.

Note what the grace period does **not** do: it no longer lets an unexpected note slide past a wait point. A wrong note pressed during the grace window is still recorded as a held wrong note (see "Wrong notes block the advance" below) and blocks advancement until released — the grace window only mutes the *buzz*, not the gate. This is what keeps the grace forgiveness from making the matching lax (it used to: a wrong note mashed within the window passed straight through).

## Wrong notes block the advance

Matching the expected chord means holding *exactly* the expected notes. `onNoteEvent` tracks the currently-held notes that are not part of the expected chord in `wrongHeldNotesRef`; while that set is non-empty the advance is refused (`outcome: "extra"`), even when every expected note is also down. Mashing a fistful of keys therefore fails: the extra keys are held alongside the correct one, so the chord is not cleanly played.

Sustained/legato notes carried over from a previous chord never enter that set — they generate no fresh Note On — so legato passages still advance. Only a note that was *unexpected at the moment it was pressed* and is *still held* blocks. A quick brush during a fast run is released almost immediately, so it rarely blocks in practice; a deliberately-held wrong key does.

## Implementation

The grace check lives in `onNoteEvent` in `src/modes/use-wait-mode.tsx`. The held wrong note is recorded first, then the grace window only decides whether to buzz:

```ts
if (!expected.has(noteNumber)) {
  wrongHeldNotesRef.current.add(noteNumber); // blocks the advance regardless
  if (msSinceAdvance < sensitivityMs) {
    return; // within grace window — record it, but don't buzz
  }
  // outside the window — buzz + count as a wrong note
  ...
}
```

`noteSensitivityMilliseconds` is part of the `WaitModeSettings` object passed into `useWaitMode` and mirrored to `settingsRef` so the stable `onNoteEvent` callback (empty deps array) can always read the latest value without going stale.

The existing 50 ms anti-racing debounce for *correct* notes is unchanged — these are orthogonal concerns.

## Configuration

There is no longer a user-facing slider (the expert sliders were removed in #65). The value is hardcoded in `PracticeScreen` (`noteSensitivityMilliseconds = 150`) and marked as intentionally not user-facing; adjust it there to tune the buzz-suppression window.

## Default

**150 ms.** This covers the typical note-overlap window in fast passages without buzzing on genuinely-late lingering notes. Because the window now only affects the buzz (not the gate), the value is no longer a strict-vs-lax knob.
