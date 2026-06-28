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
  await loadFile(page, "simple-grand-piano.musicxml");

  // At least one SMuFL text element (notehead, clef, etc.) should be present
  const svg = page.locator("svg[role='img']");
  await expect(svg).toBeVisible();
  await expect(svg.locator("text").first()).toBeVisible();

  if (screenshotsEnabled) {
    await waitForFonts(page);
    await expect(page).toHaveScreenshot("sheet-music-musicxml.png");
  }
});

test("renders sheet music from a MIDI file", async ({ page }) => {
  await loadFile(page, "c-major-melody.mid");

  const svg = page.locator("svg[role='img']");
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

  const svg = page.locator("svg[role='img']");
  await expect(svg).toBeVisible();
  await expect(svg.locator("text").first()).toBeVisible();

  if (screenshotsEnabled) {
    await waitForFonts(page);
    await expect(page).toHaveScreenshot("sheet-music-rondo-beams.png");
  }
});

// Helper: load the full Rondo and scroll a specific measure into view by
// finding a note element whose ID starts with the expected measure prefix.
// This is deterministic — no playback, no rAF timing, no scroll animation.
async function screenshotRondoAtMeasure(
  page: import("@playwright/test").Page,
  measureNumber: number,
  filename: string,
): Promise<void> {
  await loadFile(page, "rondo-alla-turca-full.mxl");

  // Wait for the SVG to contain at least one note element.
  const svg = page.locator("svg[role='img']");
  await expect(svg.locator("text").first()).toBeVisible();

  // Scroll the first note of the target measure into view.  Note IDs have the
  // form p{part}-m{measure}-n{noteIndex}-v{voice}; scrollIntoView with
  // inline:"center" puts it near the middle of the viewport horizontally.
  await page.evaluate((measure) => {
    const prefix = `-m${measure}-`;
    const noteEl = document.querySelector(`[id*="${prefix}"]`);
    noteEl?.scrollIntoView({ block: "nearest", inline: "center" });
  }, measureNumber);

  if (screenshotsEnabled) {
    await waitForFonts(page);
    await expect(page).toHaveScreenshot(filename);
  }
}

test("Rondo alla Turca full score — around measure 60", async ({ page }) => {
  await screenshotRondoAtMeasure(page, 60, "rondo-full-m60.png");
});

test("Rondo alla Turca full score — around measure 120", async ({ page }) => {
  await screenshotRondoAtMeasure(page, 120, "rondo-full-m120.png");
});

// The A-major coda holds the top C#6 across each bar (written as a half note
// plus tied quarters). Ties are drawn as arcs joining the held noteheads, so a
// held note reads as held rather than as a fresh attack — see #83.
test("Rondo alla Turca full score — tied coda (measure 212)", async ({
  page,
}) => {
  await screenshotRondoAtMeasure(page, 212, "rondo-full-m212-ties.png");
});

// The sticky overlay should show the key signature that is active at the
// visible left edge — not always the original one. This test uses a D-major
// piece (2 sharps) and scrolls past the initial header so the overlay appears
// with the F# and C# accidentals visible.
test("sticky key-signature overlay shows accidentals when scrolled (D major)", async ({
  page,
}) => {
  await loadFile(page, "d-major-melody.musicxml");

  const svg = page.locator("svg[role='img']");
  await expect(svg.locator("text").first()).toBeVisible();

  // Set scrollLeft directly to a position well past the initial header
  // (threshold = paddingLeft + headerWidth(2 sharps) = 60 + 80 = 140 px),
  // then dispatch a scroll event so the sticky overlay handler fires
  // synchronously in the same browser task.
  await page.evaluate(() => {
    const container = document.querySelector(
      "[data-testid='sheet-music-scroll-container']",
    ) as HTMLElement | null;
    if (!container) {
      return;
    }
    container.scrollLeft = 700;
    container.dispatchEvent(new Event("scroll"));
  });

  // Wait for the overlay to become visible (the scroll handler sets display:"inline-block").
  await page.locator("[data-testid='sticky-signature-overlay']").waitFor({
    state: "visible",
  });

  if (screenshotsEnabled) {
    await waitForFonts(page);
    await expect(page).toHaveScreenshot("sticky-signature-overlay-d-major.png");
  }
});
