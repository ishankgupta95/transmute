import { test, expect } from "@playwright/test";

import { FILE_HANDLER_ACCEPT, SHARE_ACCEPT_TYPES } from "@/lib/pwa/open-with";
import { SHARE_TARGET_ACTION, SHARE_TARGET_FILE_FIELD } from "@/lib/pwa/share-target";

/**
 * The manifest as SHIPPED, not as written.
 *
 * `src/app/manifest.ts` is a Route Handler, and under `output: "export"` Next
 * runs it at build time and writes the result to `out/manifest.webmanifest`.
 * Between the source and that file sit `dynamic = "force-static"`, the
 * metadata route's own serialisation, and two keys — `share_target` and
 * `file_handlers` — that no unit test of the source function can prove
 * survived. A typed value that Next drops on the way out would leave the unit
 * test green and the OS integration silently absent.
 *
 * Fetched through `page.request` rather than `fetch` inside the page: an
 * `APIRequestContext` does not pass through the service worker, so this reads
 * what the origin serves rather than whatever a cache is holding.
 */
test.describe("web app manifest", () => {
  test("is served, parses, and is linked from the document", async ({ page }) => {
    await page.goto("/");

    const href = await page.locator('link[rel="manifest"]').first().getAttribute("href");
    expect(href, "the document must link its manifest or nothing installs").not.toBeNull();

    const response = await page.request.get(new URL(href as string, page.url()).toString());
    expect(response.status()).toBe(200);

    // Parsed, not regex-matched: a manifest a browser cannot parse is a
    // manifest that does nothing, and `json()` throws on one.
    const manifest = (await response.json()) as Record<string, unknown>;
    expect(manifest.name).toBeTruthy();
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(Array.isArray(manifest.icons)).toBe(true);
  });

  test("carries share_target, matching the constants both ends read", async ({ page }) => {
    const response = await page.request.get("/manifest.webmanifest");
    const manifest = (await response.json()) as Record<string, never>;

    const share = manifest.share_target as
      | {
          action: string;
          method: string;
          enctype: string;
          params: { files: { name: string; accept: string[] }[] };
        }
      | undefined;

    expect(share, "share_target is the whole point of the share-sheet work").toBeDefined();

    /*
      Compared against the SOURCE constants rather than string literals. The
      service worker matches the incoming POST on `SHARE_TARGET_ACTION` and
      reads the files out of the field named `SHARE_TARGET_FILE_FIELD`; if the
      manifest and the worker ever named different things the share sheet would
      still offer Transmute and the hand-off would then find nothing. The
      literals are in exactly one place, and this proves the export used it.
    */
    expect(share?.action).toBe(SHARE_TARGET_ACTION);
    expect(share?.method?.toLowerCase()).toBe("post");
    expect(share?.enctype).toBe("multipart/form-data");
    expect(share?.params?.files?.[0]?.name).toBe(SHARE_TARGET_FILE_FIELD);
    expect(share?.params?.files?.[0]?.accept).toEqual([...SHARE_ACCEPT_TYPES]);

    /*
      And the three keys deliberately NOT declared. `title`, `text` and `url`
      are the other params the spec allows, and declaring any of them would put
      a file converter in the share sheet for plain text and links — an
      over-claim, with a landing page that has nothing to do with what was
      shared. An absence is easy to lose in a refactor, so it is asserted.
    */
    for (const key of ["title", "text", "url"]) {
      expect(Object.keys(share?.params ?? {}), `share_target must not accept ${key}`).not.toContain(
        key,
      );
    }
  });

  test("carries file_handlers, matching the derived accept map", async ({ page }) => {
    const response = await page.request.get("/manifest.webmanifest");
    const manifest = (await response.json()) as Record<string, never>;

    const handlers = manifest.file_handlers as
      | { action: string; accept: Record<string, string[]> }[]
      | undefined;

    expect(handlers, "file_handlers is what puts Transmute in Open With").toBeDefined();
    expect(handlers?.[0]?.action).toBe(SHARE_TARGET_ACTION);

    /*
      The accept map is DERIVED in open-with.ts — an extension is declared only
      where at least five tools accept it, counted off the registry — so a
      literal list here would be a second, rotting copy of a computed thing.
      Comparing the shipped map to the computed one is what makes this a test
      of the export rather than of a hand-written table.
    */
    const shipped = handlers?.[0]?.accept ?? {};
    expect(Object.keys(shipped).sort()).toEqual(Object.keys(FILE_HANDLER_ACCEPT).sort());
    for (const [mime, extensions] of Object.entries(FILE_HANDLER_ACCEPT)) {
      expect(shipped[mime]).toEqual([...extensions]);
      // Every entry must be an extension, not a bare name: the spec requires
      // the leading dot and a browser rejects the whole handler without it.
      for (const extension of shipped[mime] ?? []) {
        expect(extension.startsWith("."), `${mime}: ${extension} needs a leading dot`).toBe(true);
      }
    }
    expect(Object.keys(shipped).length).toBeGreaterThan(0);
  });
});
