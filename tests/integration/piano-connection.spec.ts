import { expect, type Page, test } from "@playwright/test";
import { mockCrypto } from "./helpers";
import { audioContextMockInitScript } from "./mocks/audio-context";
import { bluetoothMockInitScript } from "./mocks/bluetooth";
import { webMidiMockInitScript } from "./mocks/web-midi";

/**
 * Reconnecting a piano across sessions — the part of the app a user hits
 * before playing a single note. Every assertion is made against the landing
 * screen's connection badge, which needs no file loaded.
 */

const PREFERENCE_KEY = "piano-practice:preferred-source";

async function setup(
  page: Page,
  options: {
    midiPermission?: "granted" | "prompt";
    bluetoothAutoConnect?: boolean;
    bluetoothRequestError?: string;
    preferredSource?: "bluetooth" | "midi";
  },
): Promise<void> {
  await mockCrypto(page);
  await page.addInitScript(audioContextMockInitScript());
  await page.addInitScript(
    bluetoothMockInitScript("Mock Piano", {
      autoConnect: options.bluetoothAutoConnect ?? false,
      requestDeviceError: options.bluetoothRequestError,
    }),
  );
  await page.addInitScript(
    webMidiMockInitScript({ permission: options.midiPermission ?? "prompt" }),
  );
  if (options.preferredSource) {
    await page.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      [PREFERENCE_KEY, options.preferredSource] as const,
    );
  }
  await page.goto("/");
}

function readPreference(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), PREFERENCE_KEY);
}

function bleRequestDeviceCount(page: Page): Promise<number> {
  // biome-ignore lint/suspicious/noExplicitAny: test bridge
  return page.evaluate(() => (window as any).__bleRequestDeviceCount());
}

test("a USB piano reconnects with no taps once the MIDI permission is granted", async ({
  page,
}) => {
  await setup(page, { midiPermission: "granted" });

  // No click anywhere — the hook reattaches on mount because the origin
  // already holds the permission.
  await expect(page.getByTitle("Connected · Mock USB Piano")).toBeVisible();
  // A silent reconnect still records the transport, so the next session's
  // first tap knows where to go even if the permission is later revoked.
  await expect.poll(() => readPreference(page)).toBe("midi");
});

test("nothing auto-connects while the MIDI permission is still unprompted", async ({
  page,
}) => {
  await setup(page, { midiPermission: "prompt" });

  await expect(page.getByTitle("Connect a piano")).toBeVisible();
  // The guard must stop *before* requestMIDIAccess, since calling it is what
  // would raise a permission prompt with no user gesture behind it.
  expect(
    // biome-ignore lint/suspicious/noExplicitAny: test bridge
    await page.evaluate(() => (window as any).__webMidiRequestCount()),
  ).toBe(0);
});

test("a remembered transport is tried on the first tap, and a cancelled attempt falls back to the chooser", async ({
  page,
}) => {
  await setup(page, {
    preferredSource: "bluetooth",
    bluetoothRequestError: "User cancelled the requestDevice() chooser.",
    midiPermission: "prompt",
  });

  // The badge stays neutrally labelled — the remembered transport is a
  // shortcut, not something the button should commit itself to.
  await page.getByTitle("Connect a piano").click();

  // The tap went straight to the Bluetooth picker — no "which transport?" step.
  await expect.poll(() => bleRequestDeviceCount(page)).toBe(1);
  await expect(page.getByText("How is your piano connected?")).toBeHidden();

  // That attempt was cancelled, so the next tap must offer the chooser —
  // otherwise the user would be stuck retrying Bluetooth forever.
  await page.getByTitle("Connect a piano").click();
  await expect(page.getByText("How is your piano connected?")).toBeVisible();

  // …and picking USB from it connects, which is the whole point of the escape
  // hatch: switching transports without clearing site data.
  await page.getByRole("button", { name: "USB (Web MIDI)" }).click();
  await expect(page.getByTitle("Connected · Mock USB Piano")).toBeVisible();
  // Bluetooth was never retried behind the user's back.
  expect(await bleRequestDeviceCount(page)).toBe(1);
  // The successful transport replaces the remembered one for next session.
  await expect.poll(() => readPreference(page)).toBe("midi");
});

test("a remembered transport that connects is kept, and the chooser stays out of the way", async ({
  page,
}) => {
  await setup(page, { preferredSource: "bluetooth", midiPermission: "prompt" });

  await page.getByTitle("Connect a piano").click();

  await expect(page.getByTitle("Connected · Mock Piano")).toBeVisible();
  await expect(page.getByText("How is your piano connected?")).toBeHidden();
  await expect.poll(() => readPreference(page)).toBe("bluetooth");
});
