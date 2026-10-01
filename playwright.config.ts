import { defineConfig, devices } from "@playwright/test";

/**
 * Layers 2-4 of `doc/plan.md` §9: structural browser tests, WPT reftests and
 * the differential corpus, on all three engines.
 *
 * `deviceScaleFactor: 1` is not incidental. Vivliostyle's `pixelRatio=0` lesson
 * is that fragmentation snapshots are only comparable at a fixed device pixel
 * ratio; without it, results differ by machine and the whole layer is noise.
 */
export default defineConfig({
  testDir: "packages/test/browser",
  // Fragmentation is deterministic or it is broken (plan.md §9). A retry would
  // hide exactly the bug this suite exists to find.
  retries: 0,
  fullyParallel: true,
  reporter: process.env["CI"] === undefined ? "list" : [["list"], ["html"]],
  use: {
    deviceScaleFactor: 1,
    viewport: { width: 1024, height: 768 },
  },
  // A golden image that has never been recorded on this host is recorded, not
  // failed: the baselines are host-specific (M4.6), and a missing one is a
  // platform that has not been seen before rather than a regression. A
  // *changed* one still fails.
  updateSnapshots: "missing",
  // The engine is bundled before any browser test runs: tests call
  // window.folio, not a stringified function.
  globalSetup: "./packages/test/bundle.mjs",
  webServer: {
    command: "node packages/test/serve.mjs",
    url: "http://127.0.0.1:5177/health",
    reuseExistingServer: true,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], deviceScaleFactor: 1 } },
    { name: "firefox", use: { ...devices["Desktop Firefox"], deviceScaleFactor: 1 } },
    { name: "webkit", use: { ...devices["Desktop Safari"], deviceScaleFactor: 1 } },
  ],
});
