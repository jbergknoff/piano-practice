import { expect, test } from "@playwright/test";
import {
  getHighlightedNoteIds,
  installMocks,
  loadFile,
  mockCryptoSubtle,
  sendNoteOff,
  sendNoteOn,
  waitForHighlightedNoteIds,
  waitForMockBluetoothConnected,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await mockCryptoSubtle(page);
  await installMocks(page);
  await page.goto("/");
});

// MIDI note numbers for c-major-melody.mid, measures 1–2.
const E4 = 64;
const C5 = 72;
const E5 = 76;
const B4 = 71;

async function switchToWaitMode(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Wait" }).click();
  // Wait mode's activate() snaps to the first wait point and the highlight
  // becomes visible on the next render.
  await page.waitForFunction(
    () => document.querySelectorAll("[data-color-id]").length > 0,
    null,
    { timeout: 2_000 },
  );
}

test("wait mode highlights the first wait-point chord on activation", async ({
  page,
}) => {
  await loadFile(page, "c-major-melody.mid");
  await waitForMockBluetoothConnected(page);
  await switchToWaitMode(page);

  // The very first note of the piece is E4 → expect a single highlighted
  // note at p0-m1-n0-v0.
  await waitForHighlightedNoteIds(page, ["p0-m1-n0-v0"]);
});

test("playing the correct note advances the wait-point highlight", async ({
  page,
}) => {
  await loadFile(page, "c-major-melody.mid");
  await waitForMockBluetoothConnected(page);
  await switchToWaitMode(page);

  await waitForHighlightedNoteIds(page, ["p0-m1-n0-v0"]);

  // Press + release E4. Wait mode advances on the matching Note On (Note Off
  // is logged but does not gate the advance), so the highlight should move to
  // the second note (C5) of the melody.
  await sendNoteOn(page, E4);
  await sendNoteOff(page, E4);

  await waitForHighlightedNoteIds(page, ["p0-m1-n1-v0"]);
});

test("a wrong note does not advance the wait-point highlight", async ({
  page,
}) => {
  await loadFile(page, "c-major-melody.mid");
  await waitForMockBluetoothConnected(page);
  await switchToWaitMode(page);

  await waitForHighlightedNoteIds(page, ["p0-m1-n0-v0"]);

  // C5 is wrong for the first wait point (E4 is expected). The highlight
  // must stay on the first note.
  await sendNoteOn(page, C5);
  await sendNoteOff(page, C5);

  // Give the app time to (incorrectly) advance, then assert it did not.
  await page.waitForTimeout(150);
  expect(await getHighlightedNoteIds(page)).toEqual(["p0-m1-n0-v0"]);
});

test("playing the full first measure advances through every wait point", async ({
  page,
}) => {
  await loadFile(page, "c-major-melody.mid");
  await waitForMockBluetoothConnected(page);
  await switchToWaitMode(page);

  await waitForHighlightedNoteIds(page, ["p0-m1-n0-v0"]);

  // Wait mode has a 50ms debounce between successful advances (see
  // use-wait-mode.tsx: msSinceAdvance < 50 → "debounce"). Pause between
  // notes to let the gate clear.
  const sequence: { note: number; expectedNextId: string | null }[] = [
    { note: E4, expectedNextId: "p0-m1-n1-v0" },
    { note: C5, expectedNextId: "p0-m1-n2-v0" },
    { note: E5, expectedNextId: "p0-m1-n3-v0" },
    { note: B4, expectedNextId: "p0-m2-n0-v0" }, // crosses the barline
  ];

  for (const { note, expectedNextId } of sequence) {
    await sendNoteOn(page, note);
    await sendNoteOff(page, note);
    await waitForHighlightedNoteIds(page, [expectedNextId as string]);
    // Clear the 50ms debounce before sending the next chord.
    await page.waitForTimeout(120);
  }
});

test("a note pressed 60ms after an advance is not debounced", async ({
  page,
}) => {
  // Regression test: the debounce window was previously 100ms, which
  // swallowed genuine quick re-presses (e.g. a note released 9ms after an
  // advance then re-pressed 98ms after — well outside any MIDI bounce window
  // but still inside the old 100ms gate). The threshold was reduced to 50ms;
  // this test confirms that a re-press at ~60ms advances correctly.
  await loadFile(page, "c-major-melody.mid");
  await waitForMockBluetoothConnected(page);
  await switchToWaitMode(page);

  await waitForHighlightedNoteIds(page, ["p0-m1-n0-v0"]); // E4

  // Advance past E4. The debounce timer starts at this moment.
  await sendNoteOn(page, E4);
  await sendNoteOff(page, E4);

  // Wait 60ms — inside the old 100ms window but above the new 50ms threshold.
  // Under the old code C5 would have been debounced here; under the new code
  // it should advance to E5.
  await page.waitForTimeout(60);
  await sendNoteOn(page, C5);
  await sendNoteOff(page, C5);

  await waitForHighlightedNoteIds(page, ["p0-m1-n2-v0"]); // E5
});
