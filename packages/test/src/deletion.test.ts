import { describe, expect, it } from "vitest";
/**
 * The deletion-condition gate of `plan.md` §8, kept honest: the registry in
 * `deletion.ts` must name tests that exist, and must account for every file
 * in core, so a new module cannot slip past it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { engine, polyfills } from "@truke/folio";

const here = new URL(".", import.meta.url).pathname;
const src = join(here, "../../core/src");
const manifest = JSON.parse(readFileSync(join(here, "../wpt-manifest.json"), "utf8")) as { tests: string[] };

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [relative(src, path)] : [];
  });
}

describe("the deletion registry", () => {
  it("names tests that are in the pinned WPT manifest", () => {
    for (const p of polyfills) {
      for (const pattern of p.tests) {
        expect(manifest.tests.some((t) => pattern.test(t)), `${p.name}: ${String(pattern)}`).toBe(true);
      }
    }
  });

  it("says why, and what decides it instead, where it names no test", () => {
    for (const p of polyfills.filter((p) => p.tests.length === 0)) {
      expect(p.untested ?? "", p.name).not.toBe("");
    }
  });

  it("accounts for every file in core, once: a polyfill's or the engine's", () => {
    const claimed = [...polyfills.flatMap((p) => p.files), ...engine.files];
    expect(claimed.length).toBe(new Set(claimed).size);
    expect(new Set(claimed)).toEqual(new Set(sources(src)));
  });

  it("gives every polyfill a nativeSupport that answers without throwing", () => {
    for (const p of polyfills) expect(typeof p.native()).toBe("boolean");
  });
});
