## What changed? Why?

While the wait-mode completion/results modal is visible, pressing piano keys should have no effect. Previously the `onNoteEvent` handler in `useWaitMode` was still fully active during this time, so pressing the wrong note would play the hi-hat "wrong note" sound via BLE MIDI, and completing the chord at the current wait point would advance the cursor (and potentially open a second modal).

Fix: mirror the existing `completionModal` state into a `completionModalRef` (same pattern as `pointIndexRef` / `controlRef`) and return early from `onNoteEvent` when it is non-null. No separate flag is needed — `completionModal !== null` is already the direct source of truth for whether the modal is shown.

Playalong mode was already correct: when its result modal is shown the phase is `"complete"`, and `onNoteEvent` already returns early for any phase other than `"playing"` or `"waiting-for-note"`.

## How was the change tested?

Existing unit test suite passes (`make unit-test`, 241 tests). The behaviour was verified manually: completing a wait-mode section and pressing keys while the results modal is open produces no sound and no cursor movement.
