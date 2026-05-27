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

// c-major-melody.mid: 2 measures, 4/4 at 120 bpm.
// "First half" preset  → measureRange { from: 1, to: 1 } → beats 0–4
// "Second half" preset → measureRange { from: 2, to: 2 } → beats 4–8
//
// Fake AudioContext clock starts at 0.  MidiPlayer derives:
//   startAudioTime = fakeNow_at_play + LOOKAHEAD − startBeat * secsPerBeat
//                  = 0 + 0.05 − 4 * 0.5 = −1.95   (for "Second half")
//   elapsedBeat(t) = (t − startAudioTime) * (bpm/60)
//                  = (t + 1.95) * 2                 (for "Second half")
//
// Loop fires when elapsedBeat ≥ endBeat (8):
//   (t + 1.95) * 2 ≥ 8  →  t ≥ 2.05
//
// After the loop, startSchedule(4) is called at fakeNow ≈ 2.2:
//   new startAudioTime = 2.2 + 0.05 − 2.0 = 0.25
//   elapsedBeat_new(t) = (t − 0.25) * 2
//   needs t ≥ 0.25 + 2.05 = 2.3 to reach beat ≥ 4.1.

test.beforeEach(async ({ page }) => {
  await blockExternalFonts(page);
  await mockCryptoSubtle(page);
  await installMocks(page);
  await page.goto("/");
});

test("listen mode loops back to range start when end of focus range is reached", async ({
  page,
}) => {
  await loadFile(page, "c-major-melody.mid");
  await waitForMockBluetoothConnected(page);

  // Select the second half (measure 2, beats 4–8).
  await page.getByTitle("Select range").click();
  await page.getByRole("button", { name: "Second half" }).click();

  // Start playback from beat 4 (the range start).
  await page.getByTitle("Play").click();

  // Advance 0.1s → beat ≈ 4.1; confirm measure-2 playback is under way before
  // the loop fires.
  await advanceAudioTime(page, 0.1);
  await waitForHighlightedNoteIds(page, ["p0-m2-n0-v0"]);

  // Advance 2.1s more (total 2.2s): the loop trigger at t ≥ 2.05s is crossed.
  // The rAF tick that runs after this advance sees elapsedBeat ≥ 8 and calls
  // startSchedule(4), restarting from the range start.
  await advanceAudioTime(page, 2.1);

  // Advance 0.15s more (total 2.35s): with the new startAudioTime ≈ 0.25,
  // elapsedBeat = (2.35 − 0.25) × 2 = 4.2 — back inside measure 2 after the loop.
  await advanceAudioTime(page, 0.15);

  // The first note of measure 2 must be highlighted again, proving the loop
  // returned playback to the range start instead of stopping.
  await waitForHighlightedNoteIds(page, ["p0-m2-n0-v0"]);
});

test("selecting a focus range in wait mode moves the cursor to the first wait point in the new range", async ({
  page,
}) => {
  await loadFile(page, "c-major-melody.mid");
  await waitForMockBluetoothConnected(page);

  // Switch to wait mode.  The first wait point (beat 0) of the whole piece is
  // highlighted on activation.
  await page.getByRole("button", { name: "Wait" }).click();
  await waitForHighlightedNoteIds(page, ["p0-m1-n0-v0"]);

  // Select the second half.  useWaitMode's measureRange effect should seek the
  // cursor to the first wait point that falls inside the new range (beat 4,
  // p0-m2-n0-v0) and update the highlight accordingly.
  await page.getByTitle("Select range").click();
  await page.getByRole("button", { name: "Second half" }).click();

  await waitForHighlightedNoteIds(page, ["p0-m2-n0-v0"]);
});

test("selecting a focus range in listen mode moves the cursor to the range start", async ({
  page,
}) => {
  await loadFile(page, "c-major-melody.mid");
  await waitForMockBluetoothConnected(page);

  // Select the second half from the drawer.  PracticeScreen's measureRange
  // effect calls setCursor(4, "jump"), which should reposition the cursor at
  // the start of measure 2 (beat 4).  Confirm that by starting playback and
  // immediately checking that the measure-2 note is highlighted (rather than
  // a measure-1 note, which would indicate the cursor was still at beat 0).
  await page.getByTitle("Select range").click();
  await page.getByRole("button", { name: "Second half" }).click();

  await page.getByTitle("Play").click();

  // 0.1s advance puts beat at ≈ 4.1 — only correct if playback started from
  // beat 4 (range start), not from beat 0 (piece start).
  await advanceAudioTime(page, 0.1);
  await waitForHighlightedNoteIds(page, ["p0-m2-n0-v0"]);
});
