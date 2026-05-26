import { expect, test } from "@playwright/test";
import {
  advanceAudioTime,
  blockExternalFonts,
  getHighlightedNoteIds,
  installMocks,
  loadFile,
  mockCryptoSubtle,
  waitForFonts,
  waitForHighlightedNoteIds,
  waitForMockBluetoothConnected,
} from "./helpers";

// Same gate as sheet-music.spec.ts: pixel screenshots are stable only inside
// the playwright Docker image. Outside of it, set SKIP_SCREENSHOTS=1.
const screenshotsEnabled = !process.env.SKIP_SCREENSHOTS;

test.beforeEach(async ({ page }) => {
  await blockExternalFonts(page);
  await mockCryptoSubtle(page);
  await installMocks(page);
  await page.goto("/");
});

/**
 * Drive the cursor in listen mode by advancing the fake AudioContext clock.
 * MidiPlayer derives `elapsedBeat = (currentTime - startAudioTime) * bpm/60`,
 * so advancing the clock by `secs` advances the cursor by `secs * bpm/60`
 * beats. The cursor settles after MidiPlayer's rAF tick fires (one frame +
 * its 50ms position-emit throttle), so callers should poll the DOM rather
 * than assume the highlight is updated synchronously.
 */
async function startListenPlayback(page: import("@playwright/test").Page) {
  // Listen mode is the default; the Play button is icon-only but its title
  // attribute ("Play") gives us a stable selector.
  await page.getByTitle("Play").click();
}

test("highlights the first note at start of playback (c-major-melody)", async ({
  page,
}) => {
  await loadFile(page, "c-major-melody.mid");
  await waitForMockBluetoothConnected(page);

  // Before any audio time has passed, the cursor is at beat 0 and listen mode
  // does NOT highlight (useListenMode short-circuits on currentBeat === 0).
  expect(await getHighlightedNoteIds(page)).toEqual([]);

  await startListenPlayback(page);

  // 1 ms of audio advance is enough to push currentBeat past 0 while still
  // landing inside the first quarter note (beat range [0, 1) at 120 bpm).
  await advanceAudioTime(page, 0.1);

  await page.waitForFunction(
    () => document.querySelectorAll("[data-color-id]").length > 0,
    null,
    { timeout: 2_000 },
  );

  const ids = await getHighlightedNoteIds(page);
  // The first note in measure 1 must be highlighted; it is the only
  // sounding note at beat ~0.2 of a piece whose notes are quarter notes.
  expect(ids).toEqual(["p0-m1-n0-v0"]);
});

test("cursor advance highlights successive notes within a measure", async ({
  page,
}) => {
  await loadFile(page, "c-major-melody.mid");
  await waitForMockBluetoothConnected(page);

  await startListenPlayback(page);

  // Beat ~0.5 → first quarter note (n0)
  await advanceAudioTime(page, 0.3);
  await waitForHighlightedNoteIds(page, ["p0-m1-n0-v0"]);

  // Cross into the second beat → second quarter note (n1)
  await advanceAudioTime(page, 0.55);
  await waitForHighlightedNoteIds(page, ["p0-m1-n1-v0"]);

  // Cross into the third beat → third quarter note (n2)
  await advanceAudioTime(page, 0.5);
  await waitForHighlightedNoteIds(page, ["p0-m1-n2-v0"]);

  // Cross into the fourth beat → fourth quarter note (n3)
  await advanceAudioTime(page, 0.5);
  await waitForHighlightedNoteIds(page, ["p0-m1-n3-v0"]);
});

test("cursor advance crosses the barline to highlight measure 2 (regression #44)", async ({
  page,
}) => {
  await loadFile(page, "c-major-melody.mid");
  await waitForMockBluetoothConnected(page);

  await startListenPlayback(page);

  // Advance well past the measure boundary (4 beats at 120bpm = 2.0s; one full
  // beat into measure 2 puts the cursor on n0 of m2).
  await advanceAudioTime(page, 2.2);
  await waitForHighlightedNoteIds(page, ["p0-m2-n0-v0"]);

  // Continue into the second note of measure 2.
  await advanceAudioTime(page, 0.5);
  await waitForHighlightedNoteIds(page, ["p0-m2-n1-v0"]);
});

test("multi-staff piece highlights notes in both staves simultaneously (regression #43)", async ({
  page,
}) => {
  await loadFile(page, "underwater-theme.musicxml");
  await waitForMockBluetoothConnected(page);

  await startListenPlayback(page);

  // Underwater Theme is 3/4 at 120 bpm; in the first measure both staves
  // (treble + bass piano) sound simultaneously. After ~0.5s of audio,
  // we should see at least one highlighted note in each staff.
  await advanceAudioTime(page, 0.25);

  await page.waitForFunction(
    () => document.querySelectorAll("[data-color-id]").length > 0,
    null,
    { timeout: 2_000 },
  );

  const ids = await getHighlightedNoteIds(page);

  // IDs encode part index: "p0-…" is the first staff, "p1-…" is the second.
  // Both must be present at this beat, which is exactly the cross-staff
  // alignment guarantee from #43.
  const partsHighlighted = new Set(
    ids.map((id) => id.split("-")[0]).filter((p) => p.startsWith("p")),
  );
  expect(partsHighlighted.has("p0")).toBe(true);
  expect(partsHighlighted.has("p1")).toBe(true);
});

test("multi-staff piece screenshot mid-playback (regression #43, #44, #48)", async ({
  page,
}) => {
  await loadFile(page, "underwater-theme.musicxml");
  await waitForMockBluetoothConnected(page);

  await startListenPlayback(page);
  // Land mid-first-measure for a deterministic visual that exercises both
  // staves' highlights and the cursor position.
  await advanceAudioTime(page, 0.4);

  await page.waitForFunction(
    () => document.querySelectorAll("[data-color-id]").length > 0,
    null,
    { timeout: 2_000 },
  );

  if (screenshotsEnabled) {
    await waitForFonts(page);
    await expect(page).toHaveScreenshot("cursor-multi-staff-mid-playback.png");
  }
});
