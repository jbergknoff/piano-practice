import { expect, test } from "@playwright/test";
import {
  getHighlightedNoteIds,
  installMocks,
  loadFile,
  mockCrypto,
  sendChordOff,
  sendChordOn,
  sendNoteOff,
  sendNoteOn,
  waitForFonts,
  waitForHighlightedNoteIds,
  waitForMockBluetoothConnected,
} from "./helpers";

// Screenshots are pixel-stable only inside the playwright Docker image. Outside
// of it, set SKIP_SCREENSHOTS=1.
const screenshotsEnabled = !process.env.SKIP_SCREENSHOTS;

// rondo-alla-turca-clip.mxl (first 8 measures of K.331 III) is a 2/4 grand-staff
// piece whose measures 5, 6 and 7 (rendered labels) each open with a two-note
// grace flourish (G5→A5) ornamenting the first beat. We focus measure 6 — the
// measure before AND after it also open with a grace — and exercise Wait mode
// against it.
//
// The clip's first measure is a pickup (MusicXML number="0", implicit="yes"), so
// rendered label N corresponds to measureNumber N-1. Focusing "6" selects the
// measure labelled "6", whose note IDs use m5 (measureNumber=5).
//
// Measure 6's (label) wait points (combining both staves, in order), note IDs m5:
//   1. grace  p0-m5-n0-v0                              → G5 (79)
//   2. grace  p0-m5-n1-v0                              → A5 (81)
//   3. beat   p0-m5-n2-v0 + p1-m5-n0-v0                → B5 (83) + E3 (52)
//   4. beat   p0-m5-n3-v0/v1 + p1-m5-n1-v0/v1          → F#5 (78) A5 (81) B3 (59) E4 (64)
//   5. beat   p0-m5-n4-v0/v1 + p1-m5-n2-v0/v1          → E5 (76) G5 (79) B3 (59) E4 (64)
//   6. beat   p0-m5-n5-v0/v1 + p1-m5-n3-v0/v1 (FINAL)  → F#5 (78) A5 (81) B3 (59) E4 (64)
const GRACE1 = 79;
const GRACE2 = 81;
const CHORD3 = [83, 52];
const CHORD4 = [78, 81, 59, 64];
const CHORD5 = [76, 79, 59, 64];
const CHORD6 = [78, 81, 59, 64];

const HL_GRACE1 = ["p0-m5-n0-v0"];
const HL_GRACE2 = ["p0-m5-n1-v0"];
const HL_CHORD3 = ["p0-m5-n2-v0", "p1-m5-n0-v0"];
const HL_CHORD4 = ["p0-m5-n3-v0", "p0-m5-n3-v1", "p1-m5-n1-v0", "p1-m5-n1-v1"];
const HL_CHORD5 = ["p0-m5-n4-v0", "p0-m5-n4-v1", "p1-m5-n2-v0", "p1-m5-n2-v1"];
const HL_FINAL = ["p0-m5-n5-v0", "p0-m5-n5-v1", "p1-m5-n3-v0", "p1-m5-n3-v1"];

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

async function playChord(
  page: import("@playwright/test").Page,
  notes: number[],
): Promise<void> {
  await sendChordOn(page, notes);
  await sendChordOff(page, notes);
  await page.waitForTimeout(120);
}

test.beforeEach(async ({ page }) => {
  await mockCrypto(page);
  await installMocks(page);
  await page.goto("/");
});

// Focus the measure labelled "6" via the Jump-to-measure modal
// (right-click → "Jump to measure…" → type the number → Go). The modal uses
// 1-based positional measure numbers matching the rendered labels. This avoids
// hunting for an off-screen notehead in the wide clip.
async function focusMeasure6(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.locator("svg[role='img']").click({ button: "right" });
  await page.getByRole("button", { name: "Jump to measure…" }).click();
  await page.locator('input[type="number"]').fill("6");
  await page.getByRole("button", { name: "Go" }).click();
}

// Horizontal centre (screen px) of the first element matching `selector`.
async function centerX(
  page: import("@playwright/test").Page,
  selector: string,
): Promise<number> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) {
    throw new Error(`no bounding box for ${selector}`);
  }
  return box.x + box.width / 2;
}

test("focusing a grace-led measure highlights its leading grace note as the first wait point", async ({
  page,
}) => {
  await loadFile(page, "rondo-alla-turca-clip.mxl");
  await waitForMockBluetoothConnected(page);

  await focusMeasure6(page);
  await page.getByRole("button", { name: "Wait" }).click();

  // The first wait point is m6's leading grace — not any note of m5, even
  // though the grace's raw playback beat falls inside m5's beat span.
  await waitForHighlightedNoteIds(page, HL_GRACE1);

  if (screenshotsEnabled) {
    await waitForFonts(page);
    await expect(page).toHaveScreenshot("wait-grace-rondo-m6-grace.png");
  }
});

test("the cursor sits on the grace wait point, then moves onto the main note", async ({
  page,
}) => {
  await loadFile(page, "rondo-alla-turca-clip.mxl");
  await waitForMockBluetoothConnected(page);

  await focusMeasure6(page);
  await page.getByRole("button", { name: "Wait" }).click();

  // Grace is the wait point: the cursor must sit on the grace notehead, not on
  // the main note to its right (the two share a downbeat, so a beat-only cursor
  // could not tell them apart).
  await waitForHighlightedNoteIds(page, HL_GRACE1);
  const grace1X = await centerX(page, '[data-color-id="p0-m5-n0-v0"]');
  const cursorOnGrace1X = await centerX(page, '[data-cursor="true"]');
  expect(Math.abs(cursorOnGrace1X - grace1X)).toBeLessThan(8);

  // The second grace is also a wait point — the cursor follows it.
  await playNote(page, GRACE1);
  await waitForHighlightedNoteIds(page, HL_GRACE2);
  const cursorOnGrace2X = await centerX(page, '[data-cursor="true"]');
  expect(cursorOnGrace2X).toBeGreaterThan(cursorOnGrace1X);

  // Advance past both graces: the wait point is now the first main note, and the
  // cursor must follow it to the right — off the graces.
  await playNote(page, GRACE2);
  await waitForHighlightedNoteIds(page, HL_CHORD3);
  const mainNoteX = await centerX(page, '[data-color-id="p0-m5-n2-v0"]');
  const cursorOnMainX = await centerX(page, '[data-cursor="true"]');
  expect(Math.abs(cursorOnMainX - mainNoteX)).toBeLessThan(8);
  expect(cursorOnMainX).toBeGreaterThan(cursorOnGrace2X);
});

test("playing through the focused measure highlights every note, ending on the final note and the results modal", async ({
  page,
}) => {
  await loadFile(page, "rondo-alla-turca-clip.mxl");
  await waitForMockBluetoothConnected(page);

  await focusMeasure6(page);
  await page.getByRole("button", { name: "Wait" }).click();

  // Walk every wait point in the measure, asserting the highlight advances. The
  // two leading graces are single notes; the remaining beats are chords drawn
  // from both staves.
  await waitForHighlightedNoteIds(page, HL_GRACE1);
  await playNote(page, GRACE1);
  await waitForHighlightedNoteIds(page, HL_GRACE2);
  await playNote(page, GRACE2);
  await waitForHighlightedNoteIds(page, HL_CHORD3);
  await playChord(page, CHORD3);
  await waitForHighlightedNoteIds(page, HL_CHORD4);
  await playChord(page, CHORD4);
  await waitForHighlightedNoteIds(page, HL_CHORD5);
  await playChord(page, CHORD5);

  // The final note of the measure must light up before it is played — proving
  // wait points reach the measure's last beat and do not stop short.
  await waitForHighlightedNoteIds(page, HL_FINAL);

  // Playing the final chord completes the measure → the results modal appears.
  await playChord(page, CHORD6);
  await expect(page.getByText("Measure 6 complete")).toBeVisible({
    timeout: 3_000,
  });
});
