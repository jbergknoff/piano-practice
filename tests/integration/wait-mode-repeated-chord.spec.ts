import { expect, test } from "@playwright/test";
import {
  getHighlightedNoteIds,
  installMocks,
  loadFile,
  mockCryptoSubtle,
  sendChordOff,
  sendChordOn,
  waitForHighlightedNoteIds,
  waitForMockBluetoothConnected,
} from "./helpers";

// repeated-chord.musicxml is a single 4/4 measure: the same C5+E5 chord struck
// on each of the four quarter beats, with NO ties. Each occurrence is a fresh
// attack, so Wait mode must require the chord to be re-struck four separate
// times. Holding the chord down — or an instrument re-sending Note On for the
// still-held keys — must advance exactly one wait point, not slide through the
// remaining identical chords.
//
// Note numbers (pitchToMidiNumber): C5=72, E5=76.
const C5 = 72;
const E5 = 76;

// data-color-id values for the four chord onsets (low→high within each chord).
const HL_BEAT1 = ["p0-m1-n0-v0", "p0-m1-n0-v1"];
const HL_BEAT2 = ["p0-m1-n1-v0", "p0-m1-n1-v1"];
const HL_BEAT3 = ["p0-m1-n2-v0", "p0-m1-n2-v1"];

test.beforeEach(async ({ page }) => {
  await mockCryptoSubtle(page);
  await installMocks(page);
  await page.goto("/");
});

test("a held repeated chord advances only one wait point, not through every repeat", async ({
  page,
}) => {
  await loadFile(page, "repeated-chord.musicxml");
  await waitForMockBluetoothConnected(page);
  await page.getByRole("button", { name: "Wait" }).click();

  await waitForHighlightedNoteIds(page, HL_BEAT1);

  // Strike the chord once. This advances exactly one wait point (beat 1 → 2).
  await sendChordOn(page, [C5, E5]);
  await waitForHighlightedNoteIds(page, HL_BEAT2);

  // Keep the chord held. The instrument re-sends Note On for the still-held
  // keys (no intervening Note Off) — exactly what a sustained repeated-chord
  // passage produces. These duplicates must NOT advance: the chord was not
  // freshly re-struck, so the wait point stays on beat 2.
  await sendChordOn(page, [C5, E5]);
  await page.waitForTimeout(120);
  await sendChordOn(page, [C5, E5]);
  await page.waitForTimeout(120);
  expect(await getHighlightedNoteIds(page)).toEqual([...HL_BEAT2].sort());

  // A genuine re-strike (release, then press again) advances one more wait
  // point (beat 2 → 3), proving the chord still advances when actually replayed.
  await sendChordOff(page, [C5, E5]);
  await page.waitForTimeout(80);
  await sendChordOn(page, [C5, E5]);
  await waitForHighlightedNoteIds(page, HL_BEAT3);
});
