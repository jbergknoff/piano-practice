import { expect, test } from "@playwright/test";
import { loadFile, mockCryptoSubtle, waitForFonts } from "./helpers";

// Shared setup: must happen before goto() so init scripts and routes
// are registered before the page begins loading.
test.beforeEach(async ({ page }) => {
  await mockCryptoSubtle(page);
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
