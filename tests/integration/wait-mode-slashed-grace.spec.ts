import { expect, test } from "@playwright/test";
import {
  installMocks,
  loadFile,
  mockCryptoSubtle,
  sendChordOff,
  sendChordOn,
  sendNoteOff,
  sendNoteOn,
  waitForFonts,
  waitForHighlightedNoteIds,
  waitForMockBluetoothConnected,
} from "./helpers";

// Screenshots are pixel-stable only inside the playwright Docker image. Outside
// of it, set SKIP_SCREENSHOTS=1.
const screenshotsEnabled = !process.env.SKIP_SCREENSHOTS;

// rondo-alla-turca-full.mxl loaded via musicXmlToConversion expands repeats,
// yielding a 241-measure score (measures 1–241, no pickup offset).
//
// Expanded measure 224 (rendered label "224") opens with two slashed grace
// notes (acciaccatura) in the treble — E5 (noteIndex=0) and A5 (noteIndex=1) —
// ornamenting the main C#6 quarter (noteIndex=2). The bass staff (partIndex=1)
// carries a plain Alberti-bass pattern with no grace notes.
//
// Because the graces are slashed (acciaccatura), they must NOT create wait
// points of their own; instead they become optional notes on the combined
// C#6+A3 downbeat wait point.
//
// First wait point of measure 224 (beat 411):
//   Required:  C#6 (85)  p0-m224-n2-v0
//              A3  (57)  p1-m224-n0-v0
//   Optional:  E5  (76)  [slashed grace — not its own wait point]
//              A5  (81)  [slashed grace — not its own wait point]
//
// Second wait point (first Alberti bass 16th after the downbeat, beat 411.25):
//   Required:  E4  (64)  p1-m224-n1-v0
//
// Note number formula: pitchToMidiNumber = (octave + 1) * 12 + semitone + alter
//   C#6 = 7*12+0+1 = 85,  E5 = 6*12+4 = 76,  A5 = 6*12+9 = 81
//   A3  = 4*12+9   = 57,  E4 = 5*12+4 = 64

const SLASHED_GRACE_E5 = 76;
const SLASHED_GRACE_A5 = 81;
const REQUIRED_C_SHARP_6 = 85;
const REQUIRED_A3 = 57;
const REQUIRED_E4 = 64;

const HL_FIRST_CHORD = ["p0-m224-n2-v0", "p1-m224-n0-v0"];
const HL_SECOND_BEAT = ["p1-m224-n1-v0"];

async function playChord(
  page: import("@playwright/test").Page,
  notes: number[],
): Promise<void> {
  await sendChordOn(page, notes);
  await sendChordOff(page, notes);
  await page.waitForTimeout(120);
}

test.beforeEach(async ({ page }) => {
  await mockCryptoSubtle(page);
  await installMocks(page);
  await page.goto("/");
});

// Navigate to the measure labelled "224" via the Jump-to-measure modal
// (right-click → "Jump to measure…" → type the number → Go). The modal uses
// 1-based positional measure numbers matching the rendered labels.
async function jumpToMeasure224(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.locator("svg").first().click({ button: "right" });
  await page.getByRole("button", { name: "Jump to measure…" }).click();
  await page.locator('input[type="number"]').fill("224");
  await page.getByRole("button", { name: "Go" }).click();
}

test("slashed grace notes are not wait points — first highlighted chord is C#6+A3, not the graces", async ({
  page,
}) => {
  await loadFile(page, "rondo-alla-turca-full.mxl");
  await waitForMockBluetoothConnected(page);

  await jumpToMeasure224(page);
  await page.getByRole("button", { name: "Wait" }).click();

  // Slashed graces (E5, A5) must not appear as highlighted noteheads — they are
  // not wait points. The first wait point must be the C#6+A3 main-note onset.
  await waitForHighlightedNoteIds(page, HL_FIRST_CHORD);

  if (screenshotsEnabled) {
    await waitForFonts(page);
    await expect(page).toHaveScreenshot("wait-slashed-grace-rondo-m224.png");
  }
});

test("playing the required chord without the slashed graces advances to the next wait point", async ({
  page,
}) => {
  await loadFile(page, "rondo-alla-turca-full.mxl");
  await waitForMockBluetoothConnected(page);

  await jumpToMeasure224(page);
  await page.getByRole("button", { name: "Wait" }).click();

  await waitForHighlightedNoteIds(page, HL_FIRST_CHORD);

  // The slashed graces are optional — skipping them must not block advancement.
  await playChord(page, [REQUIRED_C_SHARP_6, REQUIRED_A3]);

  await waitForHighlightedNoteIds(page, HL_SECOND_BEAT);
});

test("playing the slashed graces then the required chord advances to the next wait point", async ({
  page,
}) => {
  await loadFile(page, "rondo-alla-turca-full.mxl");
  await waitForMockBluetoothConnected(page);

  await jumpToMeasure224(page);
  await page.getByRole("button", { name: "Wait" }).click();

  await waitForHighlightedNoteIds(page, HL_FIRST_CHORD);

  // Play the optional slashed graces: they must be silently accepted (no penalty,
  // no wrong-note sound) without blocking the subsequent required chord.
  await sendNoteOn(page, SLASHED_GRACE_E5);
  await sendNoteOn(page, SLASHED_GRACE_A5);
  await page.waitForTimeout(60);

  // Play the required chord while the optional graces are still held. The held
  // graces must not block the advance because they are in optionalNoteNumbers,
  // not wrongHeldNotesRef.
  await sendChordOn(page, [REQUIRED_C_SHARP_6, REQUIRED_A3]);
  await sendNoteOff(page, SLASHED_GRACE_E5);
  await sendNoteOff(page, SLASHED_GRACE_A5);
  await sendChordOff(page, [REQUIRED_C_SHARP_6, REQUIRED_A3]);
  await page.waitForTimeout(120);

  await waitForHighlightedNoteIds(page, HL_SECOND_BEAT, 3_000);
});

test("a duplicate Note On for a sustained chord tone does not block the next advance", async ({
  page,
}) => {
  // Regression: a user holding an upper chord tone across consecutive wait
  // points (e.g. with the sustain pedal) whose instrument re-sends a Note On
  // for that already-held key must not have the next wait point blocked. The
  // duplicate Note On used to be recorded as a wrong held note, so the next
  // (correct) chord scored EXTRA and never advanced.
  await loadFile(page, "rondo-alla-turca-full.mxl");
  await waitForMockBluetoothConnected(page);

  await jumpToMeasure224(page);
  await page.getByRole("button", { name: "Wait" }).click();

  await waitForHighlightedNoteIds(page, HL_FIRST_CHORD);

  // Play the downbeat chord but keep C#6 held (sustained); release only A3.
  // This advances to the E4 wait point with C#6 still physically down.
  await sendChordOn(page, [REQUIRED_C_SHARP_6, REQUIRED_A3]);
  await sendNoteOff(page, REQUIRED_A3);
  await waitForHighlightedNoteIds(page, HL_SECOND_BEAT);

  // The instrument re-sends Note On for the still-held C#6 (no intervening
  // Note Off). It must be ignored, not treated as a fresh wrong key.
  await sendNoteOn(page, REQUIRED_C_SHARP_6);
  await page.waitForTimeout(60);

  // Playing the required E4 must advance off the E4 wait point — the sustained
  // C#6 must not block it.
  await sendNoteOn(page, REQUIRED_E4);
  await page.waitForFunction(
    (blockedId) =>
      !Array.from(document.querySelectorAll("[data-color-id]")).some(
        (el) => el.getAttribute("data-color-id") === blockedId,
      ),
    HL_SECOND_BEAT[0],
    { timeout: 3_000 },
  );
});
