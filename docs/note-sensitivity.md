# Note Sensitivity in Wait Mode

## Problem

During fast runs in wait mode, a note from the *previous* beat can still be "note on" when the cursor advances to the next beat. That lingering event fires against the new expected chord — which doesn't contain it — and immediately triggers the wrong-note buzz, even though the player did nothing wrong.

## Solution

A configurable **post-advance grace period** (`noteSensitivityMilliseconds`) suppresses wrong-note feedback for a short window after each successful advance. Notes in the expected chord are always accepted immediately; only *unexpected* notes are silently ignored during the grace window.

## Implementation

The check lives in `onNoteEvent` in `src/use-wait-mode.ts`, just before the wrong-note buzz logic:

```ts
if (
  !expected.has(noteNumber) &&
  Date.now() - lastAdvanceTimeRef.current < noteSensitivityMillisecondsRef.current
) {
  return; // silently ignore — still within grace window
}
```

`noteSensitivityMilliseconds` is passed into `useWaitMode` as a plain parameter and mirrored to a ref (`noteSensitivityMillisecondsRef`) so the stable `onNoteEvent` callback (empty deps array) can always read the latest value without going stale.

The existing 100 ms anti-racing debounce for *correct* notes is unchanged — these are orthogonal concerns.

## UI

A "Note sensitivity" slider in the Settings drawer (0–500 ms, step 25 ms) lets the user tune the grace period live. Human-readable labels are shown in the hint area of the row:

| Range | Label |
|-------|-------|
| 0 ms | Strict |
| 1–100 ms | Low |
| 101–250 ms | Normal |
| 251–400 ms | High |
| 401–500 ms | Lenient |

## Default

**150 ms.** This covers the typical note-overlap window in fast passages without masking genuinely wrong notes played well after an advance.

## Edge Case

At 0 ms the guard condition (`< 0`) is never true, so behavior is identical to the original strict mode — wrong notes buzz immediately regardless of timing.
