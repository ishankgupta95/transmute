import { test, expect, type Page } from "@playwright/test";
import {
  ARCHIVE_FIXTURE_MEMBERS,
  SAMPLES,
  captureDownload,
  uploadFixture,
  watchLibarchiveRequests,
} from "./support";
import type { FixtureFile } from "../helpers";

/**
 * `/extract-archive`, driven against two real containers holding the identical
 * three members (`scripts/generate-test-fixtures.mjs --engine-inputs`).
 *
 * Two things are proved, and the second is the reason the file exists.
 *
 *   1. libarchive compiled to WebAssembly lists a ZIP and a TAR correctly, and
 *      the bytes it hands back are the bytes that went in — checked by
 *      unpacking the download here rather than by trusting the screen.
 *   2. The engine came from THIS origin. `libarchive-wasm`'s glue would locate
 *      `libarchive.wasm` relative to whatever chunk loaded it;
 *      `archive-extract.ts` fetches it from `public/` and hands it over as
 *      `wasmBinary` instead. Nothing else in the repo would notice if that
 *      stopped being true, and the failure would be silent — the tool would go
 *      on working while telling a third party which tool this visitor opened.
 *
 * Why not a `.gz` as a third case: a bare gzip stream never reaches the engine
 * at all. `readArchive` routes it through the browser's own
 * `DecompressionStream` (`listing.viaGzipStream`), so a guard applied to that
 * path would be asserting on an engine with no reason to load.
 *
 * TITLES: `conversion-webkit` greps out /gif|FFmpeg|MP4/i against the project
 * name, the FILE PATH and every describe/test title. Nothing here may carry
 * one of those words — both containers must run in both engines, and there is
 * nothing Chromium-only in the path (plain WebAssembly, one `fetch`, and a
 * JSZip bundle on the way out).
 */

const surfaceOf = (page: Page) => page.locator("[data-tool-surface]");

/** The value beside a `StatStrip` label, read out of the label's own cell. */
async function stat(page: Page, label: string): Promise<string> {
  const cell = surfaceOf(page).getByText(label, { exact: true }).locator("xpath=..");
  return (await cell.innerText()).replace(label, "").trim();
}

const CONTAINERS: { kind: string; container: string; fixture: () => Promise<FixtureFile> }[] = [
  { kind: "a ZIP", container: "ZIP", fixture: () => SAMPLES.zip() },
  { kind: "a TAR", container: "TAR", fixture: () => SAMPLES.tar() },
];

test.describe("archive reader", () => {
  for (const { kind, container, fixture } of CONTAINERS) {
    test(`lists and unpacks ${kind} with an engine from this origin`, async ({ page }) => {
      /*
        Installed before the navigation: `libarchive.wasm` is fetched the
        moment the file is dropped, by the listing pass rather than by the
        extract, so the window this has to cover opens immediately.
      */
      const watch = watchLibarchiveRequests(page);
      await page.goto("/extract-archive");
      await uploadFixture(page, await fixture());

      const surface = surfaceOf(page);

      // The container was identified from its bytes, not from the extension.
      await expect(surface.getByText(new RegExp(`· ${container}$`))).toBeVisible({
        timeout: 60_000,
      });

      expect(await stat(page, "ENTRIES")).toBe("3");
      expect(await stat(page, "FILES")).toBe("3");
      expect(await stat(page, "UNPACKED SIZE")).toBe("96 B");

      // Every member is listed, by its stored path, ticked and sized. The
      // per-row checkbox carries the path in its accessible name, which is a
      // far tighter locator than a text match against a table of paths.
      for (const member of ARCHIVE_FIXTURE_MEMBERS) {
        const row = surface.getByRole("checkbox", { name: `Select ${member.path}` });
        await expect(row).toBeChecked();
      }
      await expect(surface.getByRole("checkbox")).toHaveCount(ARCHIVE_FIXTURE_MEMBERS.length);

      await expect(surface.locator('[role="alert"]').filter({ hasText: /\S/ })).toHaveCount(0);

      /*
        Now actually pull the members out. Three files come back bundled into
        one ZIP (a browser cancels a burst of separate downloads), so the
        assertion has to unpack that bundle — asserting on the screen alone
        would pass over an extractor that wrote three empty files.
      */
      const dl = await captureDownload(
        page,
        surface.getByRole("button", { name: "Download 3 files" }),
      );
      expect(dl.name).toBe("sample-archive-extracted.zip");

      // Dynamic, and `.default`: jszip is CJS, and this is the same form the
      // app's own `downloadFilesAsZip` uses to reach it.
      const JSZip = (await import("jszip")).default;
      const bundle = await JSZip.loadAsync(dl.bytes);
      const names = Object.keys(bundle.files).sort();
      expect(names).toEqual(ARCHIVE_FIXTURE_MEMBERS.map((m) => m.path).sort());
      for (const member of ARCHIVE_FIXTURE_MEMBERS) {
        const body = await bundle.files[member.path].async("string");
        expect(body, `${member.path} came back with different bytes than it went in with`)
          .toBe(member.body);
      }

      watch.assertSelfHostedAndUsed();
    });
  }
});
