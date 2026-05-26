import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { buildBLEMIDIBatch, buildBLEMIDINote } from "../../lib/midi/ble-midi";
import { audioContextMockInitScript } from "./mocks/audio-context";
import { bluetoothMockInitScript } from "./mocks/bluetooth";

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

/**
 * Install all platform mocks (AudioContext + navigator.bluetooth). Call before
 * page.goto() — both must be in place before App.tsx runs its mount effects.
 */
export async function installMocks(page: Page): Promise<void> {
  await page.addInitScript(audioContextMockInitScript());
  await page.addInitScript(bluetoothMockInitScript());
}

/**
 * Wait for the mock bluetooth device to auto-connect. The App's useBluetooth
 * hook calls getDevices() on mount; once status flips to "connected", the
 * Wait and Playalong mode buttons become enabled.
 */
export async function waitForMockBluetoothConnected(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      // biome-ignore lint/suspicious/noExplicitAny: test bridge
      (window as any).__bleListenerCount?.() > 0,
    null,
    { timeout: 5_000 },
  );
}

/** Send a Note On packet through the mocked BLE characteristic. */
export async function sendNoteOn(
  page: Page,
  note: number,
  velocity = 64,
): Promise<void> {
  const bytes = Array.from(buildBLEMIDINote(note, velocity));
  await page.evaluate(
    // biome-ignore lint/suspicious/noExplicitAny: test bridge
    (b) => (window as any).__sendBleMidi(b),
    bytes,
  );
}

/** Send a Note Off packet through the mocked BLE characteristic. */
export async function sendNoteOff(page: Page, note: number): Promise<void> {
  const bytes = Array.from(buildBLEMIDINote(note, 0));
  await page.evaluate(
    // biome-ignore lint/suspicious/noExplicitAny: test bridge
    (b) => (window as any).__sendBleMidi(b),
    bytes,
  );
}

/**
 * Send a chord as a single BLE-MIDI batch packet (all Note Ons in one frame).
 * Velocity defaults to 64 for each note.
 */
export async function sendChordOn(
  page: Page,
  notes: number[],
  velocity = 64,
): Promise<void> {
  const bytes = Array.from(
    buildBLEMIDIBatch(notes.map((n) => ({ note: n, velocity }))),
  );
  await page.evaluate(
    // biome-ignore lint/suspicious/noExplicitAny: test bridge
    (b) => (window as any).__sendBleMidi(b),
    bytes,
  );
}

/** Send Note Off for each note in the chord, as a single batch packet. */
export async function sendChordOff(page: Page, notes: number[]): Promise<void> {
  const bytes = Array.from(
    buildBLEMIDIBatch(notes.map((n) => ({ note: n, velocity: 0 }))),
  );
  await page.evaluate(
    // biome-ignore lint/suspicious/noExplicitAny: test bridge
    (b) => (window as any).__sendBleMidi(b),
    bytes,
  );
}

/** Advance the fake AudioContext clock by N seconds. */
export async function advanceAudioTime(
  page: Page,
  seconds: number,
): Promise<void> {
  await page.evaluate(
    // biome-ignore lint/suspicious/noExplicitAny: test bridge
    (s) => (window as any).__advanceAudioTime(s),
    seconds,
  );
}

/**
 * Read the IDs of all currently-highlighted notes from the DOM. Returns IDs in
 * the canonical `p{part}-m{measure}-n{note}-v{voice}` form.
 */
export async function getHighlightedNoteIds(page: Page): Promise<string[]> {
  return await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-color-id]"))
      .map((el) => el.getAttribute("data-color-id") ?? "")
      .filter((s) => s.length > 0)
      .sort(),
  );
}

/**
 * Wait until the highlighted note ID set matches `expected` exactly. Useful
 * after advancing the fake clock or sending notes — the React re-render is
 * driven by state updates that may take a frame to settle.
 */
export async function waitForHighlightedNoteIds(
  page: Page,
  expected: string[],
  timeoutMs = 2_000,
): Promise<void> {
  const sorted = [...expected].sort();
  await page.waitForFunction(
    (want) => {
      const have = Array.from(document.querySelectorAll("[data-color-id]"))
        .map((el) => el.getAttribute("data-color-id") ?? "")
        .filter((s) => s.length > 0)
        .sort();
      return (
        have.length === want.length && have.every((id, i) => id === want[i])
      );
    },
    sorted,
    { timeout: timeoutMs },
  );
}
