import { expect, test } from "@playwright/test";
import {
  getHighlightedNoteIds,
  installMocks,
  loadFile,
  mockCrypto,
  sendChordOff,
  sendChordOn,
  sendNoteOff,
  sendNoteOn,
  waitForHighlightedNoteIds,
  waitForMockBluetoothConnected,
  waitForRender,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await mockCrypto(page);
  await installMocks(page);
  await page.goto("/");
});

// MIDI note numbers for c-major-melody.mid, measures 1–2.
const E4 = 64;
const C5 = 72;
const E5 = 76;
const B4 = 71;

async function switchToWaitMode(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Wait" }).click();
  // Wait mode's activate() snaps to the first wait point and the highlight
  // becomes visible on the next render.
  await page.waitForFunction(
    () => document.querySelectorAll("[data-color-id]").length > 0,
    null,
    { timeout: 2_000 },
  );
}

test("wait mode highlights the first wait-point chord on activation", async ({
  page,
}) => {
  await loadFile(page, "c-major-melody.mid");
  await waitForMockBluetoothConnected(page);
  await switchToWaitMode(page);

  // The very first note of the piece is E4 → expect a single highlighted
  // note at p0-m1-n0-v0.
  await waitForHighlightedNoteIds(page, ["p0-m1-n0-v0"]);
});

test("playing the correct note advances the wait-point highlight", async ({
  page,
}) => {
  await loadFile(page, "c-major-melody.mid");
  await waitForMockBluetoothConnected(page);
  await switchToWaitMode(page);

  await waitForHighlightedNoteIds(page, ["p0-m1-n0-v0"]);

  // Press + release E4. Wait mode advances on the matching Note On (Note Off
  // is logged but does not gate the advance), so the highlight should move to
  // the second note (C5) of the melody.
  await sendNoteOn(page, E4);
  await sendNoteOff(page, E4);

  await waitForHighlightedNoteIds(page, ["p0-m1-n1-v0"]);
});

test("a wrong note does not advance the wait-point highlight", async ({
  page,
}) => {
  await loadFile(page, "c-major-melody.mid");
  await waitForMockBluetoothConnected(page);
  await switchToWaitMode(page);

  await waitForHighlightedNoteIds(page, ["p0-m1-n0-v0"]);

  // C5 is wrong for the first wait point (E4 is expected). The highlight
  // must stay on the first note.
  await sendNoteOn(page, C5);
  await sendNoteOff(page, C5);

  // Let any (incorrect) advance render, then assert there was none.
  await waitForRender(page);
  expect(await getHighlightedNoteIds(page)).toEqual(["p0-m1-n0-v0"]);
});

test("mashing wrong keys alongside the correct one does not advance", async ({
  page,
}) => {
  await loadFile(page, "c-major-melody.mid");
  await waitForMockBluetoothConnected(page);
  await switchToWaitMode(page);

  await waitForHighlightedNoteIds(page, ["p0-m1-n0-v0"]); // expects E4

  // Mash a fistful of keys that includes the correct note (E4). The wrong keys
  // are part of the held set when E4 completes the chord, so the advance must
  // be blocked — even though E4 itself is down. (The wrong keys lead the batch
  // so they are registered before E4 is evaluated.)
  await sendChordOn(page, [C5, E5, B4, E4]);

  await waitForRender(page);
  expect(await getHighlightedNoteIds(page)).toEqual(["p0-m1-n0-v0"]);

  // Release everything, then play E4 cleanly — now it should advance.
  await sendChordOff(page, [C5, E5, B4, E4]);
  await sendNoteOn(page, E4);
  await sendNoteOff(page, E4);

  await waitForHighlightedNoteIds(page, ["p0-m1-n1-v0"]);
});

test("playing the full first measure advances through every wait point", async ({
  page,
}) => {
  await loadFile(page, "c-major-melody.mid");
  await waitForMockBluetoothConnected(page);
  await switchToWaitMode(page);

  await waitForHighlightedNoteIds(page, ["p0-m1-n0-v0"]);

  const sequence: { note: number; expectedNextId: string | null }[] = [
    { note: E4, expectedNextId: "p0-m1-n1-v0" },
    { note: C5, expectedNextId: "p0-m1-n2-v0" },
    { note: E5, expectedNextId: "p0-m1-n3-v0" },
    { note: B4, expectedNextId: "p0-m2-n0-v0" }, // crosses the barline
  ];

  for (const { note, expectedNextId } of sequence) {
    await sendNoteOn(page, note);
    await sendNoteOff(page, note);
    await waitForHighlightedNoteIds(page, [expectedNextId as string]);
  }
});

test("a key released after the completion modal appears is not stuck held into the next playthrough", async ({
  page,
}) => {
  // Regression test: Note Off events arriving while the completion modal is
  // shown used to be dropped entirely (the early `completionModalRef.current
  // !== null` return skipped the held-notes bookkeeping for ALL events, not
  // just chord matching). If the user finishes a playthrough still holding
  // the final chord and only lets go after the modal pops up, that note's
  // release is the kind of event that would have been dropped, leaving it
  // "stuck" in heldNotesRef. On the next playthrough, a genuine fresh press
  // of that same note is then misread as "already held" (no intervening Note
  // Off was ever processed) and silently swallowed instead of completing the
  // chord.
  await loadFile(page, "c-major-melody.mid");
  await waitForMockBluetoothConnected(page);
  await switchToWaitMode(page);

  // Focus measure 1 only, so a playthrough completes after just 4 notes.
  await page.locator("svg[role='img']").click({ button: "right" });
  await page.getByRole("button", { name: "Jump to measure…" }).click();
  await page.locator('input[type="number"]').fill("1");
  await page.getByRole("button", { name: "Go" }).click();

  await waitForHighlightedNoteIds(page, ["p0-m1-n0-v0"]); // E4

  for (const note of [E4, C5, E5]) {
    await sendNoteOn(page, note);
    await sendNoteOff(page, note);
  }

  // Press B4 (the final note) but don't release it yet — completing the
  // attempt opens the results modal while B4 is still physically held.
  await sendNoteOn(page, B4);
  await expect(page.getByText("Measure 1 complete")).toBeVisible({
    timeout: 2_000,
  });

  // Release B4 only after the modal is up.
  await sendNoteOff(page, B4);
  await page.getByRole("button", { name: "Keep practicing" }).click();
  await expect(page.getByText("Measure 1 complete")).not.toBeVisible({
    timeout: 2_000,
  });

  // New playthrough: highlight is back on E4.
  await waitForHighlightedNoteIds(page, ["p0-m1-n0-v0"]);

  for (const note of [E4, C5, E5]) {
    await sendNoteOn(page, note);
    await sendNoteOff(page, note);
  }
  await waitForHighlightedNoteIds(page, ["p0-m1-n3-v0"]); // B4 wait point

  // Press B4 fresh. If it were still stuck as "held" from the previous
  // playthrough, this Note On would be seen as a duplicate (no fresh press
  // recorded), and the attempt would never complete.
  await sendNoteOn(page, B4);
  await expect(page.getByText("Measure 1 complete")).toBeVisible({
    timeout: 2_000,
  });
});

test("a note pressed right after an advance counts", async ({ page }) => {
  // Regression test: a debounce window after each advance (first 100ms, then
  // 50ms, since removed) once swallowed genuine quick presses — e.g. a note
  // released 9ms after an advance then re-pressed 98ms after. A press right
  // after an advance must be judged like any other.
  await loadFile(page, "c-major-melody.mid");
  await waitForMockBluetoothConnected(page);
  await switchToWaitMode(page);

  await waitForHighlightedNoteIds(page, ["p0-m1-n0-v0"]); // E4

  // Advance past E4, then press C5 straight away: it should advance to E5.
  await sendNoteOn(page, E4);
  await sendNoteOff(page, E4);
  await sendNoteOn(page, C5);
  await sendNoteOff(page, C5);

  await waitForHighlightedNoteIds(page, ["p0-m1-n2-v0"]); // E5
});
