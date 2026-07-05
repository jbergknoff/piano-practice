import { expect, test } from "@playwright/test";
import {
  advanceAudioTime,
  getHighlightedNoteIds,
  installMocks,
  loadFile,
  mockCrypto,
  waitForFonts,
  waitForHighlightedNoteIds,
  waitForMockBluetoothConnected,
} from "./helpers";

// Same gate as the other screenshot-using specs.
const screenshotsEnabled = !process.env.SKIP_SCREENSHOTS;

/**
 * The Rondo Alla Turca clip (first 8 measures of Mozart's K. 331/3rd movement)
 * is a 2/4 piece at 120 BPM with dense multi-voice chords in the right hand
 * and Alberti-style figuration in the left. Past regressions had highlighted
 * notes splitting across adjacent beats — e.g. one chord member showing on
 * beat 1 while the rest of its chord showed on beat 1.5. These tests assert
 * the exact highlighted ID set at known chord onsets so a split would fail
 * the equality check.
 *
 * At 120 bpm, one quarter beat = 0.5s of audio. The fake AudioContext's
 * `currentTime` starts at 0 and `MidiPlayer.startSchedule` adds a 0.05s
 * LOOKAHEAD, so the effective beat is (currentTime - 0.05) * 2.
 *
 * The exact ID sets here were captured from the rendered DOM at known stable
 * builds — they are the expected behavior to preserve.
 */

test.beforeEach(async ({ page }) => {
  await mockCrypto(page);
  await installMocks(page);
  await page.goto("/");
  await loadFile(page, "rondo-alla-turca-clip.mxl");
  await waitForMockBluetoothConnected(page);
  await page.getByTitle("Play").click();
});

test("measure 6 multi-voice chord highlights all four notes together", async ({
  page,
}) => {
  // Land mid-way through the first chord beat of measure 6 (beat 0.5 of m6,
  // which is the F#5+A5 right-hand chord plus the bass Alberti pair). All
  // four members must light up together; a split would mean some member is
  // missing or stuck on the previous beat.
  await advanceAudioTime(page, 6.0);
  await waitForHighlightedNoteIds(page, [
    "p0-m6-n3-v0",
    "p0-m6-n3-v1",
    "p1-m6-n1-v0",
    "p1-m6-n1-v1",
  ]);
});

test("measure 6 chord-by-chord progression keeps each beat's set intact", async ({
  page,
}) => {
  // First three chord onsets inside measure 6. Each step is exactly a
  // quarter beat (0.25s of audio at 120bpm 2/4). The asserted ID set is the
  // entire highlighted set — if any member of the new chord leaks into the
  // previous step's set, or any member of the previous chord lingers, the
  // equality check fails.
  const steps: { advanceSeconds: number; expected: string[] }[] = [
    {
      advanceSeconds: 6.0,
      expected: ["p0-m6-n3-v0", "p0-m6-n3-v1", "p1-m6-n1-v0", "p1-m6-n1-v1"],
    },
    {
      advanceSeconds: 0.25,
      expected: ["p0-m6-n4-v0", "p0-m6-n4-v1", "p1-m6-n2-v0", "p1-m6-n2-v1"],
    },
    {
      // This step's chord duration overlaps the second grace note leading
      // into measure 7 (p0-m7-n1-v0), so it is highlighted alongside it.
      advanceSeconds: 0.25,
      expected: [
        "p0-m6-n5-v0",
        "p0-m6-n5-v1",
        "p0-m7-n1-v0",
        "p1-m6-n3-v0",
        "p1-m6-n3-v1",
      ],
    },
  ];

  for (const { advanceSeconds, expected } of steps) {
    await advanceAudioTime(page, advanceSeconds);
    await waitForHighlightedNoteIds(page, expected);
  }
});

test("measure 5 multi-voice chord beats also stay grouped", async ({
  page,
}) => {
  // Measure 5 mirrors measure 6's chord structure — verifying both rules out
  // a measure-specific edge case (vs. a general chord-grouping regression).
  await advanceAudioTime(page, 5.0);
  await waitForHighlightedNoteIds(page, [
    "p0-m5-n3-v0",
    "p0-m5-n3-v1",
    "p1-m5-n1-v0",
    "p1-m5-n1-v1",
  ]);

  // This chord's duration overlaps the first grace note leading into measure
  // 6 (p0-m6-n1-v0), so it is highlighted alongside it.
  await advanceAudioTime(page, 0.5);
  await waitForHighlightedNoteIds(page, [
    "p0-m5-n5-v0",
    "p0-m5-n5-v1",
    "p0-m6-n1-v0",
    "p1-m5-n3-v0",
    "p1-m5-n3-v1",
  ]);
});

test("no orphaned highlights across the m5→m6 barline", async ({ page }) => {
  // Cross the m5→m6 boundary and verify that the moment a new measure starts,
  // every highlighted ID belongs to the new measure — no leftover from the
  // outgoing one. (At this onset the chord is the first beat of m6: the right
  // hand has just one melody note, the left hand has its first Alberti note.)
  await advanceAudioTime(page, 5.75);
  await waitForHighlightedNoteIds(page, ["p0-m6-n2-v0", "p1-m6-n0-v0"]);

  const ids = await getHighlightedNoteIds(page);
  for (const id of ids) {
    expect(id).toContain("-m6-");
  }
});

test("sustained notes remain highlighted across a faster voice's beats", async ({
  page,
}) => {
  // Measure 4's right-hand note (p0-m4-n0-v0) sustains for a full quarter
  // beat while the left hand moves twice underneath it. Verify the right
  // hand's highlight stays put while the left hand's highlight updates —
  // this is the kind of multi-voice sustain that has been mis-handled in
  // past regressions where the highlight would briefly disappear.
  await advanceAudioTime(page, 3.75);
  await waitForHighlightedNoteIds(page, ["p0-m4-n0-v0", "p1-m4-n0-v0"]);

  await advanceAudioTime(page, 0.25);
  // Right hand sustains; left hand has advanced to n1.
  await waitForHighlightedNoteIds(page, [
    "p0-m4-n0-v0",
    "p1-m4-n1-v0",
    "p1-m4-n1-v1",
  ]);
});

test("rondo chord highlight screenshot (visual regression for #43/#44/#48)", async ({
  page,
}) => {
  // Stop on a beat where both hands have multi-voice chords — exactly the
  // visual signature past chord-splitting bugs would have broken.
  await advanceAudioTime(page, 6.0);
  await waitForHighlightedNoteIds(page, [
    "p0-m6-n3-v0",
    "p0-m6-n3-v1",
    "p1-m6-n1-v0",
    "p1-m6-n1-v1",
  ]);

  if (screenshotsEnabled) {
    await waitForFonts(page);
    await expect(page).toHaveScreenshot("rondo-m6-chord-highlight.png");
  }
});
