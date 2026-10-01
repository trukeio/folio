/**
 * The script-tag entry (`dist/folio-tex.js`, `doc/tex.md` §2).
 *
 * Registers a TeX handler with the polyfill and exposes the package as
 * `window.folioTeX`. Options are `window.FolioTeX`, read when the preview
 * runs. Loaded after the polyfill, it registers with `window.Paged`; loaded
 * before, there is no `Paged` yet, so it queues the handler on
 * `window.folioHandlers`, which the polyfill drains when it installs.
 */
import { createTeXHandler } from "./handler.js";
import type { TeXHandlerClass, TeXHandlerOptions } from "./handler.js";

declare global {
  interface Window {
    Paged?: unknown;
    FolioTeX?: TeXHandlerOptions;
    folioHandlers?: TeXHandlerClass[];
  }
}

export * from "./index.js";

/** The handler the script tag registered, for `Previewer({ handlers })`. */
export const TeXHandler = createTeXHandler(() => window.FolioTeX ?? {});

const paged = window.Paged as { registerHandlers?: (...classes: TeXHandlerClass[]) => void } | undefined;
if (paged?.registerHandlers !== undefined) paged.registerHandlers(TeXHandler);
else (window.folioHandlers ??= []).push(TeXHandler);
