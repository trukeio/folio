/**
 * The polyfill entry point (`doc/milestones.md` M5.1).
 *
 * This is the file a project reaches by swapping its script tag. It puts
 * `Paged` on `window`, reads `window.PagedConfig`, waits for the DOM, and
 * paginates — the same four things `paged.polyfill.js` does, in the same
 * order, because a project that works today does so by relying on that order.
 *
 * `window.PagedConfig.auto = false` turns the automatic run off and leaves the
 * previewer for the project to drive, which is how every application that
 * wants a button rather than a page load uses Paged.js.
 */
import { clearHandlers, Previewer, registeredHandlers, registerHandlers } from "./preview.js";
import type { Flow, Handler, PreviewerSettings } from "./preview.js";

export type PagedConfig = {
  /** Paginate on load. Default true. */
  auto?: boolean;
  before?: () => void | Promise<void>;
  after?: (flow: Flow | undefined) => void | Promise<void>;
  content?: Element | string;
  stylesheets?: string[];
  renderTo?: Element | string;
  settings?: PreviewerSettings;
};

declare global {
  interface Window {
    Paged?: unknown;
    PagedConfig?: PagedConfig;
    /** Handlers queued by a script that loaded before this one (`tex.md` §2). */
    folioHandlers?: (new (previewer: Previewer) => Handler)[];
  }
}

/**
 * `Handler` is a class in Paged.js, and projects write `extends Paged.Handler`.
 * Ours carries no behaviour — the interface is the contract — but it has to
 * exist as a constructor, and it takes the previewer so a subclass can reach
 * back for the records.
 */
export class HandlerBase implements Handler {
  readonly previewer: Previewer;
  constructor(previewer: Previewer) {
    this.previewer = previewer;
  }
}

/** Resolves when the document is at least interactive. */
function ready(doc: Document): Promise<void> {
  if (doc.readyState === "interactive" || doc.readyState === "complete") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    doc.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
  });
}

/** Install `window.Paged` and run, exactly as the script tag it replaces did. */
export function install(win: Window & typeof globalThis): Previewer {
  const config = win.PagedConfig ?? {};
  registerHandlers(...(win.folioHandlers ?? []));
  const previewer = new Previewer(config.settings ?? {});

  win.Paged = {
    Previewer,
    Handler: HandlerBase,
    registerHandlers,
    registeredHandlers,
    clearHandlers,
    previewer,
  };

  void ready(win.document).then(async () => {
    await config.before?.();
    let flow: Flow | undefined;
    if (config.auto !== false) {
      flow = await previewer.preview(
        config.content ?? null,
        config.stylesheets ?? null,
        config.renderTo ?? null,
      );
    }
    await config.after?.(flow);
  });

  return previewer;
}

export default install(window);
