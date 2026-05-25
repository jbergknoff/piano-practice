import { expect, test } from "@playwright/test";
import { blockExternalFonts, loadFile, waitForFonts } from "./helpers";

// Shared setup: block flaky external fonts before every test in this file
test.beforeEach(async ({ page }) => {
  await blockExternalFonts(page);
  await page.goto("/");
});

test("renders sheet music from a MusicXML file", async ({ page }) => {
  await loadFile(page, "underwater-theme.musicxml");

  // At least one SMuFL text element (notehead, clef, etc.) should be present
  const svg = page.locator("svg").first();
  await expect(svg).toBeVisible();
  await expect(svg.locator("text").first()).toBeVisible();

  await waitForFonts(page);
  await expect(page).toHaveScreenshot("sheet-music-musicxml.png");
});

test("renders sheet music from a MIDI file", async ({ page }) => {
  await loadFile(page, "c-major-melody.mid");

  const svg = page.locator("svg").first();
  await expect(svg).toBeVisible();
  await expect(svg.locator("text").first()).toBeVisible();

  await waitForFonts(page);
  await expect(page).toHaveScreenshot("sheet-music-midi.png");
});
