import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { audioContextMockInitScript } from "./mocks/audio-context";
import { advanceAudioTime, loadFile, mockCryptoSubtle } from "./helpers";

// Minimal shape of a CDP CPU profile (the .cpuprofile DevTools format).
interface CpuProfile {
  nodes: Array<{ id: number; callFrame: { functionName: string } }>;
  samples: number[];
  timeDeltas: number[];
}

// Captures a Chrome CPU profile of a simulated Playalong run over the full
// (busy) Rondo alla Turca and writes it as a test artifact. Open the resulting
// .cpuprofile in Chrome DevTools → Performance → "Load profile…" to inspect
// where main-thread time goes — this is the desktop substitute for profiling on
// the phone. The feeder drives the real note-event path, so the profile
// reflects production rendering (marker overlay + highlight recompute).
//
// Assertions are deliberately load/structure checks, not a wall-clock budget —
// absolute timings vary too much across machines/CI to gate on without flaking.
test("capture Playalong CPU profile over the Rondo opening", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);

  await page.addInitScript(audioContextMockInitScript());
  await mockCryptoSubtle(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      "piano-practice:preferences",
      JSON.stringify({
        playalongPlayMusic: true,
        playalongMetronome: false,
        playalongCountIn: false,
      }),
    );
  });

  await page.goto("/?demo=1");
  await loadFile(page, "rondo-alla-turca-full.mxl");
  await expect(page.getByRole("button", { name: "Playalong" })).toHaveAttribute(
    "aria-pressed",
    "true",
    { timeout: 5000 },
  );

  const client = await page.context().newCDPSession(page);
  await client.send("Profiler.enable");
  await client.send("Profiler.setSamplingInterval", { interval: 200 });

  await page.getByTitle("Play").click();
  await client.send("Profiler.start");

  // Advance the fake audio clock through the first ~10 seconds of the piece in
  // small steps with short real-time waits, so position updates + the feeder's
  // note-ons actually render on the main thread during the captured window (the
  // profiler samples real time). The busy opening is representative; no need to
  // grind through the whole Rondo.
  for (let i = 0; i < 20; i++) {
    await advanceAudioTime(page, 0.5);
    await page.waitForTimeout(40);
  }

  const { profile } = (await client.send("Profiler.stop")) as {
    profile: CpuProfile;
  };

  // Write the artifact (loadable in DevTools) and attach it to the report.
  const profilePath = testInfo.outputPath("rondo-playalong.cpuprofile");
  fs.writeFileSync(profilePath, JSON.stringify(profile));
  await testInfo.attach("rondo-playalong.cpuprofile", {
    path: profilePath,
    contentType: "application/json",
  });

  // Summarize main-thread busy time (non-idle samples) for a quick read.
  const idleNodeIds = new Set(
    profile.nodes
      .filter((n) => n.callFrame.functionName === "(idle)")
      .map((n) => n.id),
  );
  let busyMicros = 0;
  let totalMicros = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const delta = profile.timeDeltas[i] ?? 0;
    totalMicros += delta;
    if (!idleNodeIds.has(profile.samples[i])) {
      busyMicros += delta;
    }
  }
  const markerCount = await page.locator("[data-player-marker]").count();
  console.log(
    `[perf] busy ${(busyMicros / 1000).toFixed(0)}ms / total ${(totalMicros / 1000).toFixed(0)}ms across ${profile.samples.length} samples; ${markerCount} markers; profile → ${profilePath}`,
  );

  // Sanity (non-flaky): the run rendered real work and produced a usable profile.
  expect(profile.samples.length).toBeGreaterThan(0);
  expect(busyMicros).toBeGreaterThan(0);
  expect(markerCount).toBeGreaterThan(20);
  expect(fs.statSync(profilePath).size).toBeGreaterThan(0);
});
