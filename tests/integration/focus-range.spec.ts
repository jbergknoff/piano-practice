import { test } from "@playwright/test";
import {
  advanceAudioTime,
  blockExternalFonts,
  installMocks,
  loadFile,
  mockCryptoSubtle,
  waitForHighlightedNoteIds,
  waitForMockBluetoothConnected,
} from "./helpers";

// pickup-measure-melody.musicxml: 4 measures, 2/4 at 120 BPM.
//
// Crucially, measure 1 is a one-beat pickup (anacrusis) instead of the
// normal two beats. This makes every subsequent measure boundary arrive one
// beat earlier than the naive formula `(measureNumber − 1) × timeSigNum`
// would predict:
//
//   measureStartBeats (correct, from actual durations):
//     m1: beat 0  m2: beat 1  m3: beat 3  m4: beat 5   totalBeats: 7
//
//   Old broken formula  (measureNumber − 1) × 2:
//     m1:     0         m2:     2         m3:     4         m4:     6
//
// The "Second half" preset for a 4-measure piece selects mm. 3–4,
// so all three tests below exercise the case where the broken formula
// would have placed the cursor one full beat into m3 rather than at its start.
//
// ─── Fake-clock arithmetic ────────────────────────────────────────────────────
//
// At 120 BPM, one quarter beat = 0.5 s.  MidiPlayer derives:
//   startAudioTime = fakeNow_at_play + LOOKAHEAD − startBeat × secsPerBeat
//   elapsedBeat(t) = (t − startAudioTime) × (bpm / 60)
//
// Correct formula — startBeat = 3:
//   startAudioTime = 0 + 0.05 − 3 × 0.5 = −1.45
//   elapsedBeat(t) = (t + 1.45) × 2
//
//   At t = 0.1 s:  beat = (0.1 + 1.45) × 2 = 3.1  → p0-m3-n0-v0 (first note of m3)
//
// Broken formula — startBeat = 4:
//   startAudioTime = 0 + 0.05 − 4 × 0.5 = −1.95
//   elapsedBeat(t) = (t + 1.95) × 2
//
//   At t = 0.1 s:  beat = (0.1 + 1.95) × 2 = 4.1  → p0-m3-n1-v0 (second note of m3)
//
// Stop fires when elapsedBeat ≥ endBeat (7 with correct formula):
//   (t + 1.45) × 2 ≥ 7  →  t ≥ 2.05
//
// After the stop, the cursor resets to focusRange.startBeat = 3 (the range start).
// The player is now stopped, so advancing the fake clock further does NOT advance
// the cursor — it remains at beat 3.  This distinguishes a stop from a loop:
// a looping player would move the cursor forward after the fake-clock advance.

test.beforeEach(async ({ page }) => {
  await blockExternalFonts(page);
  await mockCryptoSubtle(page);
  await installMocks(page);
  await page.goto("/");
});

test("listen mode stops and resets cursor to range start when end of focus range is reached (pickup measure)", async ({
  page,
}) => {
  await loadFile(page, "pickup-measure-melody.musicxml");
  await waitForMockBluetoothConnected(page);

  // Select mm. 3–4 (beats 3–7 with the correct formula).
  await page.getByTitle("Select range").click();
  await page.getByRole("button", { name: "Second half" }).click();

  // Start playback from beat 3 (the range start).
  await page.getByTitle("Play").click();

  // Advance 0.1 s → beat ≈ 3.1.  The first note of m3 must be highlighted,
  // confirming that playback started from beat 3 (correct formula) rather than
  // beat 4 (broken formula, which would put us at m3-n1-v0 instead).
  await advanceAudioTime(page, 0.1);
  await waitForHighlightedNoteIds(page, ["p0-m3-n0-v0"]);

  // Advance 2.1 s more (total 2.2 s): the stop trigger at t ≥ 2.05 s is crossed.
  // The rAF tick sees elapsedBeat ≥ 7 (the real end of m4), stops the player,
  // and resets the cursor to focusRange.startBeat = 3.
  await advanceAudioTime(page, 2.1);

  // Cursor is now at beat 3 (range start).  The first note of m3 must be
  // highlighted, confirming the reset used the correct formula (beat 3, not 4).
  await waitForHighlightedNoteIds(page, ["p0-m3-n0-v0"]);

  // Advance 0.5 s more (= 1 beat at 120 BPM).  If the player had looped it
  // would now be at beat 4 and p0-m3-n1-v0 would be highlighted instead.
  // Because it stopped, the cursor stays at beat 3 and p0-m3-n0-v0 remains.
  await advanceAudioTime(page, 0.5);
  await waitForHighlightedNoteIds(page, ["p0-m3-n0-v0"]);
});

test("selecting a focus range in wait mode moves the cursor to the first wait point in the new range (pickup measure)", async ({
  page,
}) => {
  await loadFile(page, "pickup-measure-melody.musicxml");
  await waitForMockBluetoothConnected(page);

  // Switch to wait mode.  The first wait point (beat 0, m1 pickup) is
  // highlighted on activation.
  await page.getByRole("button", { name: "Wait" }).click();
  await waitForHighlightedNoteIds(page, ["p0-m1-n0-v0"]);

  // Select mm. 3–4.  useWaitMode's measureRange effect should seek the cursor
  // to the first wait point whose beat falls at or after beat 3 — that is
  // p0-m3-n0-v0 at beat 3.  With the broken formula the seek target would
  // have been beat 4, landing at p0-m3-n1-v0 instead.
  await page.getByTitle("Select range").click();
  await page.getByRole("button", { name: "Second half" }).click();

  await waitForHighlightedNoteIds(page, ["p0-m3-n0-v0"]);
});

test("selecting a focus range in listen mode moves the cursor to the range start (pickup measure)", async ({
  page,
}) => {
  await loadFile(page, "pickup-measure-melody.musicxml");
  await waitForMockBluetoothConnected(page);

  // Select mm. 3–4.  PracticeScreen's measureRange effect calls
  // setCursor(3, "jump"), which should place the cursor at the actual start
  // of m3 (beat 3).  Confirm by starting playback and immediately checking
  // that p0-m3-n0-v0 is highlighted — with the broken formula playback would
  // have started from beat 4 and the first note of m3 would already be past.
  await page.getByTitle("Select range").click();
  await page.getByRole("button", { name: "Second half" }).click();

  await page.getByTitle("Play").click();

  // 0.1 s advance puts beat at ≈ 3.1 — the first note of m3 — only correct
  // if playback started from beat 3 (range start) and not from beat 4.
  await advanceAudioTime(page, 0.1);
  await waitForHighlightedNoteIds(page, ["p0-m3-n0-v0"]);
});
