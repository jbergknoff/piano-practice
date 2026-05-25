import { defineConfig } from "@playwright/test";

const baseURL = process.env.BASE_URL ?? "http://localhost:3456";

// Browsers restrict SubtleCrypto (used by the app's file-hash logic) to
// secure contexts. Localhost qualifies automatically; other HTTP origins
// (e.g. http://server:3456 inside Docker) must be explicitly allowlisted.
const chromiumArgs = baseURL.startsWith("http://localhost")
  ? []
  : [`--unsafely-treat-insecure-origin-as-secure=${baseURL}`];

export default defineConfig({
  testDir: "tests/integration",
  outputDir: "tests/integration/results",
  use: {
    // BASE_URL is set to http://server:3456 inside Docker compose;
    // falls back to localhost for any direct (non-Docker) invocation.
    baseURL,
  },
  // When BASE_URL is not provided (direct / non-Docker run), start the Bun
  // static server automatically so tests work without any manual setup.
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: "bun scripts/serve.ts",
        url: "http://localhost:3456",
        reuseExistingServer: true,
      },
  // Store screenshot baselines inside the integration test tree
  snapshotDir: "tests/integration/fixtures/screenshots",
  // Flat names: <arg>-<projectName>.png — easy to find, no nested dirs
  snapshotPathTemplate: "{snapshotDir}/{arg}-{projectName}{ext}",
  projects: [
    {
      name: "chromium-landscape",
      use: {
        browserName: "chromium",
        viewport: { width: 844, height: 390 },
        launchOptions: { args: chromiumArgs },
      },
    },
    {
      name: "chromium-portrait",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        launchOptions: { args: chromiumArgs },
      },
    },
  ],
});
