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

// Captures a Chrome CPU profile of a simulated Playalong run and writes it as a
// test artifact. Open the .cpuprofile in Chrome DevTools → Performance → "Load
// profile…" to see where main-thread time goes — the desktop substitute for
// profiling on the phone. The feeder drives the real note-event path, so the
// profile reflects production rendering (marker overlay + highlight recompute).
//
// IMPORTANT — what this does and does not measure:
//   - A CPU profile captures main-thread JS + style/layout only. It does NOT
//     include paint / raster / GPU compositing, and this run is headless, so
//     paint-to-screen is skipped entirely. Treat the numbers as the *scripting*
//     half of the cost, not the whole picture.
//   - At native desktop speed a short run is mostly idle, so the default below
//     is a light artifact + sanity check, not a wall-clock budget (absolute
//     timings aren't portable across CI machines).
//
// Reproduce the phone-like A/B locally with env overrides, e.g.:
//   PERF_CPU_THROTTLE=6 PERF_STEPS=200 PERF_FULL=1 make integration-test
// (6× CPU slowdown == DevTools "CPU: 6× slowdown"; PERF_FULL plays the whole
// piece so markers accumulate and the marker overlay's O(markers) reconcile
// shows up). The printed `[perf]` line reports busy time and the longest single
// task (the felt hitch).
test("capture a Playalong CPU profile as a loadable artifact", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);

  const cpuThrottle = Number(process.env.PERF_CPU_THROTTLE ?? "1");
  const steps = Number(process.env.PERF_STEPS ?? "24");
  // Default: the short clip for a fast CI artifact. PERF_FULL plays the whole
  // piece (no focus range) so markers accumulate across hundreds of presses and
  // the marker overlay's O(markers) reconcile shows up — pair it with
  // PERF_STEPS and PERF_CPU_THROTTLE for a phone-like stress run.
  const full = Boolean(process.env.PERF_FULL);
  const fixture = full
    ? "rondo-alla-turca-full.mxl"
    : "rondo-alla-turca-clip.mxl";
  const url = "/?demo=1";

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

  await page.goto(url);
  await loadFile(page, fixture);
  await expect(page.getByRole("button", { name: "Playalong" })).toHaveAttribute(
    "aria-pressed",
    "true",
    { timeout: 5000 },
  );

  const client = await page.context().newCDPSession(page);
  if (cpuThrottle > 1) {
    await client.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottle });
  }
  await client.send("Profiler.enable");
  await client.send("Profiler.setSamplingInterval", { interval: 200 });

  await page.getByTitle("Play").click();
  await client.send("Profiler.start");

  // Advance the fake audio clock in small steps with short real-time waits, so
  // position updates + the feeder's note-ons actually render on the main thread
  // during the captured window (the profiler samples real time).
  for (let i = 0; i < steps; i++) {
    await advanceAudioTime(page, 0.5);
    await page.waitForTimeout(20);
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

  // Summarize: total busy time AND the longest single task (consecutive
  // non-idle samples) — the latter is what corresponds to a dropped-frame
  // hitch, the felt "lag".
  const idleNodeIds = new Set(
    profile.nodes
      .filter((n) => n.callFrame.functionName === "(idle)")
      .map((n) => n.id),
  );
  let busyMicros = 0;
  let totalMicros = 0;
  let longestTaskMicros = 0;
  let currentTaskMicros = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const delta = profile.timeDeltas[i] ?? 0;
    totalMicros += delta;
    if (idleNodeIds.has(profile.samples[i])) {
      currentTaskMicros = 0;
    } else {
      busyMicros += delta;
      currentTaskMicros += delta;
      longestTaskMicros = Math.max(longestTaskMicros, currentTaskMicros);
    }
  }
  const markerCount = await page.locator("[data-player-marker]").count();
  console.log(
    `[perf] throttle ${cpuThrottle}x; busy ${(busyMicros / 1000).toFixed(0)}ms / total ${(totalMicros / 1000).toFixed(0)}ms; longestTask ${(longestTaskMicros / 1000).toFixed(0)}ms; ${markerCount} markers; profile → ${profilePath}`,
  );

  // Sanity (non-flaky): the run rendered real work and produced a usable profile.
  expect(profile.samples.length).toBeGreaterThan(0);
  expect(busyMicros).toBeGreaterThan(0);
  expect(markerCount).toBeGreaterThan(20);
  expect(fs.statSync(profilePath).size).toBeGreaterThan(0);
});
