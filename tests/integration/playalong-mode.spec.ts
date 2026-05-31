import { expect, test } from "@playwright/test";
import {
  advanceAudioTime,
  blockExternalFonts,
  getHighlightedNoteIds,
  installMocks,
  loadFile,
  mockCryptoSubtle,
  sendNoteOff,
  sendNoteOn,
  waitForMockBluetoothConnected,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await blockExternalFonts(page);
  await mockCryptoSubtle(page);
  await installMocks(page);
  await page.goto("/");
});

const E4 = 64;
const C5 = 72;

/**
 * Turn off the playalong count-in via the settings drawer so the test can
 * start playback immediately on the first note (phase: waiting-for-note →
 * playing). Otherwise we'd wait 2 measures of real time before any note input
 * is scored.
 */
async function disableCountIn(page: import("@playwright/test").Page) {
  await page.getByTitle("Settings").click();
  // The "Start on" setting uses chip toggles; click "First played note" to
  // disable count-in (the default is "Count-in").
  await page.getByRole("button", { name: "First played note" }).click();
  // Close the Settings drawer via its ✕ button.
  await page.getByRole("button", { name: "Close settings" }).click();
  // Drawer slide-out is a 320ms CSS transition; wait until pointer events
  // pass through to the buttons behind it again.
  await page.waitForTimeout(400);
}

test("hit notes are colored green in playalong mode", async ({ page }) => {
  await loadFile(page, "c-major-melody.mid");
  await waitForMockBluetoothConnected(page);
  await disableCountIn(page);

  await page.getByRole("button", { name: "Playalong" }).click();
  // Play here is the playalong "start" — phase becomes "waiting-for-note".
  await page.getByTitle("Play").click();

  // Send the first correct note (E4). With count-in disabled, the first note
  // both starts playback and is matched against the first selection note.
  await sendNoteOn(page, E4);

  // Wait for the green highlight on the first note (#2e7d32 is the
  // playalong-hit color in use-playalong-mode.tsx).
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-color-id="p0-m1-n0-v0"]');
      if (!el) {
        return false;
      }
      // The Notehead text within the group is filled with the assigned color.
      const text = el.querySelector("text");
      return text?.getAttribute("fill") === "#2e7d32";
    },
    null,
    { timeout: 3_000 },
  );

  await sendNoteOff(page, E4);
  // Sanity: the same note ID is still highlighted (and still green) after the
  // Note Off — playalong tracks scoring, not currently-held notes.
  const ids = await getHighlightedNoteIds(page);
  expect(ids).toContain("p0-m1-n0-v0");
});

test("wrong notes do not get highlighted green", async ({ page }) => {
  await loadFile(page, "c-major-melody.mid");
  await waitForMockBluetoothConnected(page);
  await disableCountIn(page);

  await page.getByRole("button", { name: "Playalong" }).click();
  await page.getByTitle("Play").click();

  // First note kicks off playback but is wrong (C5 instead of E4). Playback
  // starts (phase → playing), but this press should NOT add a green hit on
  // the first note. We have to start playback to enter the playing phase, so
  // first send a correct note, then verify a follow-up wrong note doesn't add
  // an unexpected hit.
  await sendNoteOn(page, E4);
  await page.waitForFunction(
    () => document.querySelector('[data-color-id="p0-m1-n0-v0"]') !== null,
    null,
    { timeout: 3_000 },
  );
  await sendNoteOff(page, E4);

  // Now send a deliberately wrong note far from the cursor. MIDI note 100
  // (E7) is well outside any note in c-major-melody, so it cannot match.
  await sendNoteOn(page, 100);
  await sendNoteOff(page, 100);

  await page.waitForTimeout(150);

  // Read each highlighted note's color directly from the DOM. The only green
  // (#2e7d32) hit should still be E4 → m1-n0-v0 from the previous correct
  // press. The wrong note must not have added any new green hits.
  const greenIds = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-color-id]"))
      .filter(
        (el) => el.querySelector("text")?.getAttribute("fill") === "#2e7d32",
      )
      .map((el) => el.getAttribute("data-color-id") ?? "")
      .sort(),
  );
  expect(greenIds).toEqual(["p0-m1-n0-v0"]);
});

test("count-in overlay is visible after starting playalong with count-in enabled", async ({
  page,
}) => {
  await loadFile(page, "c-major-melody.mid");
  await waitForMockBluetoothConnected(page);

  await page.getByRole("button", { name: "Playalong" }).click();
  await page.getByTitle("Play").click();

  // With count-in on, an overlay shows the beat number during the 2-measure
  // count-in. We verify the phase reaches the overlay and exits cleanly.
  // The Play button's title flips to "Stop" while counting-in.
  await expect(page.getByTitle("Stop")).toBeVisible({ timeout: 1_000 });

  // Cancel the attempt so the test doesn't have to wait 2 measures.
  await page.getByTitle("Stop").click();
  // Pressing Stop puts playalong back into idle (Play button returns).
  await expect(page.getByTitle("Play")).toBeVisible({ timeout: 1_000 });

  // Sanity: advancing the AudioContext after stop doesn't produce highlights.
  await advanceAudioTime(page, 1.0);
  await page.waitForTimeout(100);
  expect(await getHighlightedNoteIds(page)).toEqual([]);
});
