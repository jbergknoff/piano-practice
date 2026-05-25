import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  // Fail fast in CI; allow retries locally for flaky font loading
  retries: process.env.CI ? 1 : 0,
  use: {
    // BASE_URL is set to http://server:3456 inside Docker compose;
    // falls back to localhost for any direct (non-Docker) invocation.
    baseURL: process.env.BASE_URL ?? "http://localhost:3456",
    // Mobile-first viewport matching the app's design
    viewport: { width: 390, height: 844 },
  },
  // Store screenshot baselines alongside the other test fixtures
  snapshotDir: "test-fixtures/screenshots",
  // Snapshot name includes the browser so adding more projects later is safe
  snapshotPathTemplate:
    "{snapshotDir}/{testFilePath}-snapshots/{arg}-{projectName}{ext}",
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
