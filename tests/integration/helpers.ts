import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the shared test-fixtures directory. */
export const FIXTURES = path.join(__dirname, "../../test-fixtures");

/**
 * Upload a file from test-fixtures/ through the landing screen's hidden file
 * input, then wait for the sheet music <svg> to appear.
 */
export async function loadFile(page: Page, filename: string): Promise<void> {
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.join(FIXTURES, filename));
  // Wait for the first rendered glyph, not just the SVG shell — the SVG
  // element appears before notation is painted on a subsequent render tick.
  await page.waitForSelector("svg text", { timeout: 10_000 });
}

/**
 * Block Google Fonts network requests so screenshots are stable across
 * environments.  The Bravura music font is served locally from dist/ and is
 * unaffected.
 */
export async function blockExternalFonts(page: Page): Promise<void> {
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.route("https://fonts.gstatic.com/**", (route) => route.abort());
}

/** Wait for all fonts (including Bravura) to finish loading. */
export async function waitForFonts(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
}
