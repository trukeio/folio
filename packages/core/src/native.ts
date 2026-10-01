/**
 * The shape of a deletion condition (`deletion.ts`, `plan.md` §8), and the
 * one probe a module may use to say whether a browser supports its feature.
 * A leaf, so that a polyfill module can import it without importing the
 * registry that imports every polyfill module.
 */

export type Deletion = {
  /** Short name, for reports. */
  name: string;
  /** The files that go with it, relative to `packages/core/src`. */
  files: readonly string[];
  /** What it stands in for. */
  feature: string;
  /** "Delete when …", in words. */
  when: string;
  /**
   * The WPT tests that decide it, as patterns over the pinned manifest's
   * paths. Empty when the pinned set has none, and then `untested` says why
   * and what would decide it instead: CI cannot.
   */
  tests: readonly RegExp[];
  untested?: string;
  /**
   * Whether this browser supports the feature natively, as far as a script
   * can tell. A parse check (`CSS.supports`) where the feature has syntax of
   * its own; `false` where it has none a script can probe, such as a
   * browser's own print fragmentation. Necessary, never sufficient: the WPT
   * run is what decides.
   */
  native: () => boolean;
};

/** `CSS.supports`, where there is a `CSS` to ask. */
export function supports(property: string, value: string): boolean {
  return typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports(property, value);
}
