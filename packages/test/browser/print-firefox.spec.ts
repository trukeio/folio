/**
 * Printing the host document from Firefox (`print.spec.ts` is Chromium's).
 *
 * `page.pdf` is Chromium's alone, so Firefox is printed the way a reader
 * would, through `window.print()`, silenced by preferences and sent to a
 * file. That path always uses the printer's paper (Letter), whatever `@page`
 * says — a plain `@page { size: A5 }` with no engine loaded comes out Letter
 * too — so this checks the count, the numbers and their placement, not the
 * sheet size. The preferences are launch options, which is why this is a
 * file of its own.
 */
import { expect, test } from "@playwright/test";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { A5, expectNumbersOnce, load, numbersOnScreen, textOf } from "./print-pdf.js";

/** Firefox's print-to-file, silenced: where `window.print()` writes its PDF. */
const FIREFOX_PDF = join(tmpdir(), `folio-print-${String(process.pid)}.pdf`);
const SAVE = "print.printer_Mozilla_Save_to_PDF";

test.use({
  launchOptions: {
    firefoxUserPrefs: {
      "print.always_print_silent": true,
      "print.show_print_progress": false,
      print_printer: "Mozilla Save to PDF",
      [`${SAVE}.print_to_file`]: true,
      [`${SAVE}.print_to_filename`]: FIREFOX_PDF,
      // No date, title or URL of Firefox's own in the margins.
      ...Object.fromEntries(
        ["headerleft", "headercenter", "headerright", "footerleft", "footercenter", "footerright"].map(
          (k) => [`${SAVE}.print_${k}`, ""],
        ),
      ),
    },
  },
});

test.skip(({ browserName }) => browserName !== "firefox", "Firefox's own print path");

test("each sheet is one page, printed once, unscaled", async ({ page }) => {
  // Before the fix Firefox did not double the number — it does not draw
  // `@page` margin boxes of its own — but it shrank each sheet into the
  // author's margins, which this catches by position.
  rmSync(FIREFOX_PDF, { force: true });
  await load(page, A5);
  const expected = await numbersOnScreen(page);

  await page.evaluate(() => setTimeout(() => window.print(), 0));
  // Written asynchronously; done when its size stops changing.
  let last = -1;
  await expect
    .poll(
      () => {
        const size = existsSync(FIREFOX_PDF) ? statSync(FIREFOX_PDF).size : 0;
        const done = size > 0 && size === last;
        last = size;
        return done;
      },
      { timeout: 30_000, intervals: [500] },
    )
    .toBe(true);

  expectNumbersOnce(await textOf(readFileSync(FIREFOX_PDF)), expected);
  rmSync(FIREFOX_PDF, { force: true });
});
