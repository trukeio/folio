import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Layer 1 of doc/plan.md §9: no browser, no DOM, synthetic boxes only.
    // Layers 2-4 (Playwright, WPT, differential) run from their own config.
    environment: "node",
    include: ["packages/*/src/**/*.test.ts"],
  },
});
