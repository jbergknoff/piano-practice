import { expect, test } from "@playwright/test";
import {
  getHighlightedNoteIds,
  installMocks,
  loadFile,
  mockCryptoSubtle,
  sendNoteOff,
  sendNoteOn,
  waitForFonts,
  waitForHighlightedNoteIds,
  waitForMockBluetoothConnected,
} from "./helpers";

// Screenshots are pixel-stable only inside the playwright Docker image. Outside
// of it, set SKIP_SCREENSHOTS=1.
const screenshotsEnabled = !process.env.SKIP_SCREENSHOTS;

// grace-note-focus.musicxml: three 4/4 measures. m1 is plain; m2 and m3 each
// open with a grace note. MIDI numbers for the notes we play in m2:
const M2_GRACE_G4 = 67;
const M2_A4 = 69;
const M2_B4 = 71;
const M2_C5 = 72;
const M2_D5 = 74;

// Wait mode advances on Note On; pause between presses to clear the 50 ms
// debounce window (see use-wait-mode.tsx).
async function playNote(
  page: import("@playwright/test").Page,
  note: number,
): Promise<void> {
  await sendNoteOn(page, note);
  await sendNoteOff(page, note);
  await page.waitForTimeout(120);
}

test.beforeEach(async ({ page }) => {
  await mockCryptoSubtle(page);
  await installMocks(page);
  await page.goto("/");
});

// Focus measure 2 via the right-click context menu. Right-clicking m2's first
// main notehead (p0-m2-n1) lands the click inside m2's horizontal span, so the
// menu offers "Focus measure 2".
async function focusMeasure2(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.locator('[data-chord-id="p0-m2-n1"]').click({ button: "right" });
  await page.getByRole("button", { name: "Focus measure 2" }).click();
}

test("focusing a middle measure highlights its leading grace note as the first wait point", async ({
  page,
}) => {
  await loadFile(page, "grace-note-focus.musicxml");
  await waitForMockBluetoothConnected(page);

  await focusMeasure2(page);
  await page.getByRole("button", { name: "Wait" }).click();

  // The first wait point must be m2's grace note — not any note of m1, even
  // though the grace's raw playback beat falls inside m1's beat span.
  await waitForHighlightedNoteIds(page, ["p0-m2-n0-v0"]);

  if (screenshotsEnabled) {
    await waitForFonts(page);
    await expect(page).toHaveScreenshot("wait-grace-focused-m2-grace.png");
  }
});

test("wait points stay inside the focused measure and do not include the next measure's grace", async ({
  page,
}) => {
  await loadFile(page, "grace-note-focus.musicxml");
  await waitForMockBluetoothConnected(page);

  await focusMeasure2(page);
  await page.getByRole("button", { name: "Wait" }).click();

  // First wait point: m2's grace (G4).
  await waitForHighlightedNoteIds(page, ["p0-m2-n0-v0"]);

  // Playing the grace advances to m2's first main note (A4) — proving the grace
  // is a genuine wait point that advances within the focused measure.
  await playNote(page, M2_GRACE_G4);
  await waitForHighlightedNoteIds(page, ["p0-m2-n1-v0"]);

  if (screenshotsEnabled) {
    await waitForFonts(page);
    await expect(page).toHaveScreenshot(
      "wait-grace-focused-m2-after-grace.png",
    );
  }

  // Play the rest of m2. After the last note (D5) the attempt completes and the
  // wait point loops back to m2's grace — it must NOT advance into m3. If m3's
  // grace (p0-m3-n0-v0) were ever a wait point, the highlight would move there.
  await playNote(page, M2_A4);
  await waitForHighlightedNoteIds(page, ["p0-m2-n2-v0"]);
  await playNote(page, M2_B4);
  await waitForHighlightedNoteIds(page, ["p0-m2-n3-v0"]);
  await playNote(page, M2_C5);
  await waitForHighlightedNoteIds(page, ["p0-m2-n4-v0"]);
  await playNote(page, M2_D5);

  // Looped back to the focused measure's grace, never to m3.
  await waitForHighlightedNoteIds(page, ["p0-m2-n0-v0"]);
  expect(await getHighlightedNoteIds(page)).toEqual(["p0-m2-n0-v0"]);
});
