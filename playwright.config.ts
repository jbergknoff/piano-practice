import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/integration",
  outputDir: "tests/integration/results",
  use: {
    // BASE_URL is set to http://server:3456 inside Docker compose;
    // falls back to localhost for any direct (non-Docker) invocation.
    baseURL: process.env.BASE_URL ?? "http://localhost:3456",
  },
  // Store screenshot baselines inside the integration test tree
  snapshotDir: "tests/integration/fixtures/screenshots",
  // Flat names: <arg>-<projectName>.png — easy to find, no nested dirs
  snapshotPathTemplate: "{snapshotDir}/{arg}-{projectName}{ext}",
  projects: [
    {
      name: "chromium-landscape",
      use: { browserName: "chromium", viewport: { width: 844, height: 390 } },
    },
    {
      name: "chromium-portrait",
      use: { browserName: "chromium", viewport: { width: 390, height: 844 } },
    },
  ],
});
