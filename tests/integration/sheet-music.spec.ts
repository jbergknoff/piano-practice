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
