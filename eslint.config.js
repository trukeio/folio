import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** Harness scripts and build config: node, ESM, outside the TS project. */
const scripts = ["**/*.mjs", "eslint.config.js", "*.config.ts"];

export default tseslint.config(
  {
    // Vendored corpus, fixtures and generated baselines are not ours to lint.
    ignores: [
      "packages/test/fixtures/**",
      "packages/test/baselines/**",
      "packages/test/spike/**",
      "packages/test/.bundle/**",
      "packages/test/.wpt-cache/**",
      "**/dist/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
    },
  },
  // Two separate blocks: spreading disableTypeChecked and then declaring
  // `languageOptions` in the same object replaces the parser settings it just
  // set, and every script goes back to being type-checked against no project.
  { files: scripts, ...tseslint.configs.disableTypeChecked },
  {
    files: scripts,
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        URL: "readonly",
        globalThis: "readonly",
        document: "readonly",
        window: "readonly",
        // The runner scripts hand functions to `page.evaluate`, so the page's
        // globals are legitimate names inside them.
        NodeFilter: "readonly",
        setTimeout: "readonly",
        fetch: "readonly",
        Buffer: "readonly",
      },
    },
  },
);
