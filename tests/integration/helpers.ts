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

/**
 * Inject a crypto.subtle implementation before page load for non-secure HTTP
 * origins (e.g. http://server:3456 inside Docker). Browsers only expose
 * SubtleCrypto in secure contexts; localhost qualifies automatically but other
 * hostnames do not, so the app's file-hashing logic would throw without this.
 *
 * Uses Node's crypto module (exposed via page.exposeFunction) so that
 * per-file-content hashes are real and consistent — file history lookups
 * work correctly across test runs.
 *
 * Must be called before page.goto().
 */
export async function mockCryptoSubtle(page: Page): Promise<void> {
  // Bridge Node's crypto.createHash into the browser page.
  await page.exposeFunction(
    "__nodeDigest",
    async (algorithm: string, bytes: number[]): Promise<number[]> => {
      const { createHash } = await import("node:crypto");
      return Array.from(
        createHash(algorithm.toLowerCase().replace("-", ""))
          .update(Buffer.from(bytes))
          .digest(),
      );
    },
  );

  await page.addInitScript(() => {
    if (window.crypto.subtle) {
      return;
    }
    type BridgedWindow = Window & {
      __nodeDigest(algorithm: string, bytes: number[]): Promise<number[]>;
    };
    Object.defineProperty(window.crypto, "subtle", {
      value: {
        digest: async (
          algorithm: string,
          data: ArrayBuffer,
        ): Promise<ArrayBuffer> => {
          const bytes = Array.from(new Uint8Array(data));
          const result = await (window as BridgedWindow).__nodeDigest(
            algorithm,
            bytes,
          );
          return new Uint8Array(result).buffer;
        },
      },
      configurable: true,
    });
  });
}
