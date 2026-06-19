import { expect, test } from "@playwright/test";
import {
  installMocks,
  loadFile,
  mockCryptoSubtle,
  sendChordOff,
  sendChordOn,
  sendNoteOff,
  sendNoteOn,
  waitForHighlightedNoteIds,
  waitForMockBluetoothConnected,
} from "./helpers";

// tied-note.musicxml is a single 4/4 measure:
//   Beat 1: chord C5 (tie start) + E5
//   Beat 2: chord C5 (tie stop, held over) + G5 (fresh attack)
//   Beats 3-4: a bare C4 each
//
// At the beat-2 wait point, G5 is the only fresh attack; the tied-in C5 must
// still be sounding for the chord to count as complete. So:
//   - if the player keeps C5 held, playing G5 alone advances;
//   - if the player let C5 go, G5 alone is NOT enough — C5 must be pressed again.
//
// Note numbers (pitchToMidiNumber): C5=72, E5=76, G5=79, C4=60.
const C5 = 72;
const E5 = 76;
const G5 = 79;

// data-color-id values for the highlighted noteheads.
const HL_BEAT1 = ["p0-m1-n0-v0", "p0-m1-n0-v1"]; // C5 + E5
const HL_BEAT2 = ["p0-m1-n1-v0", "p0-m1-n1-v1"]; // tied C5 + G5
const HL_BEAT3 = ["p0-m1-n2-v0"]; // C4

test.beforeEach(async ({ page }) => {
  await mockCryptoSubtle(page);
  await installMocks(page);
  await page.goto("/");
});

test("a released tied note must be pressed again to advance past its tie-stop", async ({
  page,
}) => {
  await loadFile(page, "tied-note.musicxml");
  await waitForMockBluetoothConnected(page);
  await page.getByRole("button", { name: "Wait" }).click();

  await waitForHighlightedNoteIds(page, HL_BEAT1);

  // Play the first chord and release everything — C5 is no longer held.
  await sendChordOn(page, [C5, E5]);
  await sendChordOff(page, [C5, E5]);
  await waitForHighlightedNoteIds(page, HL_BEAT2);
  await page.waitForTimeout(80);

  // Playing only G5 must NOT advance: the tied C5 is not sounding.
  await sendNoteOn(page, G5);
  await page.waitForTimeout(250);
  await waitForHighlightedNoteIds(page, HL_BEAT2);

  // Pressing the released C5 (with G5 still down) completes the chord.
  await sendNoteOn(page, C5);
  await waitForHighlightedNoteIds(page, HL_BEAT3);
  await sendNoteOff(page, G5);
  await sendNoteOff(page, C5);
});

test("a held tied note advances without being pressed again", async ({
  page,
}) => {
  await loadFile(page, "tied-note.musicxml");
  await waitForMockBluetoothConnected(page);
  await page.getByRole("button", { name: "Wait" }).click();

  await waitForHighlightedNoteIds(page, HL_BEAT1);

  // Play the first chord, then release only E5 — keep C5 held across the tie.
  await sendChordOn(page, [C5, E5]);
  await sendNoteOff(page, E5);
  await waitForHighlightedNoteIds(page, HL_BEAT2);
  await page.waitForTimeout(80);

  // C5 is still down, so playing the fresh G5 alone completes the chord.
  await sendNoteOn(page, G5);
  await waitForHighlightedNoteIds(page, HL_BEAT3);
  await sendNoteOff(page, G5);
  await sendNoteOff(page, C5);
});
