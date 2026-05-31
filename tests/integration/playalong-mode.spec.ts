import { expect, test } from "@playwright/test";
import {
  advanceAudioTime,
  getHighlightedNoteIds,
  installMocks,
  loadFile,
  mockCryptoSubtle,
  sendNoteOff,
  sendNoteOn,
  waitForHighlightedNoteIds,
  waitForMockBluetoothConnected,
} from "./helpers";

test.beforeEach(async ({ page }) => {
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

  // Wait for the green highlight on the first note (#43a047 is the
  // playalong-hit color in use-playalong-mode.tsx).
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-color-id="p0-m1-n0-v0"]');
      if (!el) {
        return false;
      }
      // The Notehead text within the group is filled with the assigned color.
      const text = el.querySelector("text");
      return text?.getAttribute("fill") === "#43a047";
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
  // (#43a047) hit should still be E4 → m1-n0-v0 from the previous correct
  // press. The wrong note must not have added any new green hits.
  const greenIds = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-color-id]"))
      .filter(
        (el) => el.querySelector("text")?.getAttribute("fill") === "#43a047",
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

// c-major-melody.mid: 8 quarter notes, 2 measures of 4/4 at 120 BPM.
//
// Beat layout (all voices 0, part 0):
//   m1-n0: E4 (64)  beat 0    m2-n0: G4 (67)  beat 4
//   m1-n1: C5 (72)  beat 1    m2-n1: C5 (72)  beat 5
//   m1-n2: E5 (76)  beat 2    m2-n2: D5 (74)  beat 6
//   m1-n3: B4 (71)  beat 3    m2-n3: F4 (65)  beat 7
//
// Timing: 1 beat = 0.5 s. Total piece = 8 beats = 4.0 s.
// LOOKAHEAD = 0.05 s → onEnd fires when fake time ≥ 4.05 s.
//
// Score formula (F1): round((2 × matched) / (expected + matched + extra) × 100)
// Hitting only E4: matched=1, extra=0, expected=8 → round(200/9) = 22%.
test("completing a playthrough shows results modal with score; switching range clears all highlights", async ({
  page,
}) => {
  await loadFile(page, "c-major-melody.mid");
  await waitForMockBluetoothConnected(page);
  await disableCountIn(page);

  await page.getByRole("button", { name: "Playalong" }).click();
  // Play starts the session in "waiting-for-note" phase (count-in disabled).
  await page.getByTitle("Play").click();

  // Pressing E4 both kicks off playback and scores the first note as a hit
  // (beat tolerance 0.4; cursor is at beat 0 exactly).
  await sendNoteOn(page, E4);

  // p0-m1-n0-v0 (E4) must turn green (#43a047) immediately.
  await page.waitForFunction(
    () => {
      const element = document.querySelector('[data-color-id="p0-m1-n0-v0"]');
      return (
        element?.querySelector("text")?.getAttribute("fill") === "#43a047"
      );
    },
    null,
    { timeout: 3_000 },
  );

  await sendNoteOff(page, E4);

  // Advance the fake AudioContext clock past the end of the piece. The player's
  // rAF tick sees elapsed beat ≥ 8 (totalBeats) and fires onEnd.
  await advanceAudioTime(page, 4.5);

  // The results modal must appear with "Full piece complete" as the heading.
  await expect(page.getByText("Full piece complete")).toBeVisible({
    timeout: 3_000,
  });
  // One of eight notes was hit → F1 score = 22%. The score chip renders in
  // both the "latest" header and the history row, so scope to the first match.
  await expect(page.getByText("22%").first()).toBeVisible();

  // Dismiss the modal. The "complete" phase is intentionally kept so the
  // green/red review colors remain visible for the user.
  await page.getByRole("button", { name: "Keep practicing" }).click();
  await expect(page.getByText("Full piece complete")).not.toBeVisible({
    timeout: 2_000,
  });

  // Confirm the review colors are still present: the hit note (E4) is green
  // and the next missed note (C5) is red.
  await page.waitForFunction(
    () => {
      const hitNote = document.querySelector('[data-color-id="p0-m1-n0-v0"]');
      const missedNote = document.querySelector(
        '[data-color-id="p0-m1-n1-v0"]',
      );
      return (
        hitNote?.querySelector("text")?.getAttribute("fill") === "#43a047" &&
        missedNote?.querySelector("text")?.getAttribute("fill") === "#e53935"
      );
    },
    null,
    { timeout: 2_000 },
  );

  // Switching to "First half" (measure 1) while the phase is still "complete"
  // must reset the view completely. Before the fix, the stale hit set was
  // applied to the new range, coloring all its notes red.
  //
  // "First half" of a 2-measure piece → { from: 1, to: 1 }, startBeat = 0.
  // After reset the idle listen-mode highlight guard skips beat 0, so the
  // expected highlighted set is empty.
  await page.getByTitle("Select range").click();
  await page.getByRole("button", { name: "First half" }).click();

  await waitForHighlightedNoteIds(page, []);
});
