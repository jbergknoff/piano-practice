import { expect, test } from "@playwright/test";
import {
  advanceAudioTime,
  installMocks,
  loadFile,
  mockCryptoSubtle,
  waitForFonts,
  waitForMockBluetoothConnected,
} from "./helpers";

// Shared setup: must happen before goto() so init scripts and routes
// are registered before the page begins loading.
test.beforeEach(async ({ page }) => {
  await mockCryptoSubtle(page);
  await installMocks(page);
  await page.goto("/");
});

// Screenshot baselines are generated inside the Docker playwright image.
// Outside of Docker the Chrome version is unspecified and may be anything,
// so pixel-level output is not stable against those baselines.
const screenshotsEnabled = !process.env.SKIP_SCREENSHOTS;

test("renders sheet music from a MusicXML file", async ({ page }) => {
  await loadFile(page, "underwater-theme.musicxml");

  // At least one SMuFL text element (notehead, clef, etc.) should be present
  const svg = page.locator("svg").first();
  await expect(svg).toBeVisible();
  await expect(svg.locator("text").first()).toBeVisible();

  if (screenshotsEnabled) {
    await waitForFonts(page);
    await expect(page).toHaveScreenshot("sheet-music-musicxml.png");
  }
});

test("renders sheet music from a MIDI file", async ({ page }) => {
  await loadFile(page, "c-major-melody.mid");

  const svg = page.locator("svg").first();
  await expect(svg).toBeVisible();
  await expect(svg.locator("text").first()).toBeVisible();

  if (screenshotsEnabled) {
    await waitForFonts(page);
    await expect(page).toHaveScreenshot("sheet-music-midi.png");
  }
});

// Rondo alla Turca has dense runs of beamed 16th notes — a good visual
// regression target for beam geometry (slope, stem length, secondary beams).
test("renders beamed 16th-note runs (Rondo alla Turca clip)", async ({
  page,
}) => {
  await loadFile(page, "rondo-alla-turca-clip.mxl");

  const svg = page.locator("svg").first();
  await expect(svg).toBeVisible();
  await expect(svg.locator("text").first()).toBeVisible();

  if (screenshotsEnabled) {
    await waitForFonts(page);
    await expect(page).toHaveScreenshot("sheet-music-rondo-beams.png");
  }
});

// Helper: load the full Rondo, start listen playback, advance the mock audio
// clock to `seconds`, wait for the cursor highlight and scroll to settle, then
// take a screenshot.  The piece is 2/4 at 120 BPM (2 beats/sec), so
// `seconds` maps to beat = seconds * 2. Measure n (1-indexed, pickup = 1)
// starts at beat 2n - 1, i.e. measure 60 ≈ 59.5 s, measure 120 ≈ 119.5 s.
async function screenshotRondoAtSeconds(
  page: import("@playwright/test").Page,
  seconds: number,
  filename: string,
): Promise<void> {
  await loadFile(page, "rondo-alla-turca-full.mxl");
  await waitForMockBluetoothConnected(page);
  await page.getByTitle("Play").click();
  await advanceAudioTime(page, seconds);
  // Wait until the cursor has reached the target region (at least one note
  // highlighted) before taking the screenshot.
  await page.waitForFunction(
    () => document.querySelectorAll("[data-color-id]").length > 0,
    null,
    { timeout: 5_000 },
  );
  // Allow the smooth-scroll animation a moment to settle on the new position.
  await page.waitForTimeout(400);
  if (screenshotsEnabled) {
    await waitForFonts(page);
    await expect(page).toHaveScreenshot(filename);
  }
}

test("Rondo alla Turca full score — around measure 60", async ({ page }) => {
  await screenshotRondoAtSeconds(page, 59.5, "rondo-full-m60.png");
});

test("Rondo alla Turca full score — around measure 120", async ({ page }) => {
  await screenshotRondoAtSeconds(page, 119.5, "rondo-full-m120.png");
});
