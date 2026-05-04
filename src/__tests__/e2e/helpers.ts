import { expect, type Page, type Locator, type Download } from "@playwright/test";

/**
 * Reusable helpers for Transmute E2E specs.
 *
 * Fixtures are generated programmatically (see `./fixtures.ts`) so the repo
 * doesn't grow with binary blobs. `uploadFile` accepts the {name, mimeType,
 * buffer} shape that those generators return and forwards it to
 * `setInputFiles`.
 *
 * Fixture inputs that aren't easy to synthesise (HEIC, TIFF, real MP3/MP4)
 * have shipped sample files under `src/__tests__/fixtures/samples/` and can
 * be uploaded via `uploadSampleFile`.
 */

export interface FixtureFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/**
 * Upload one or more programmatic file fixtures into a tool's DropZone.
 * The tool registers a single hidden <input type="file"> per upload affordance,
 * so we target it by accept attribute / aria-label.
 */
export async function uploadFile(
  page: Page,
  fixtures: FixtureFile | FixtureFile[],
  selector = 'input[type="file"]',
): Promise<void> {
  const input = page.locator(selector).first();
  await input.waitFor({ state: "attached" });
  await input.setInputFiles(Array.isArray(fixtures) ? fixtures : [fixtures]);
}

/**
 * Click an action that triggers a download and capture the resulting file.
 * Returns both the Download object and its suggested filename for assertions.
 */
export async function waitForDownload(
  page: Page,
  trigger: Locator | (() => Promise<void>),
  timeoutMs = 30_000,
): Promise<{ download: Download; suggestedFilename: string }> {
  const downloadPromise = page.waitForEvent("download", { timeout: timeoutMs });
  if (typeof trigger === "function") {
    await trigger();
  } else {
    await trigger.click();
  }
  const download = await downloadPromise;
  return { download, suggestedFilename: download.suggestedFilename() };
}

/**
 * Read the bytes of a captured download into a Buffer for size / format
 * assertions. Playwright streams the file to a temp path, so we read it from
 * the returned `path()`.
 */
export async function downloadBytes(download: Download): Promise<Buffer> {
  const path = await download.path();
  if (!path) throw new Error("Download has no path (was it cancelled?)");
  const fs = await import("node:fs/promises");
  return fs.readFile(path);
}

/**
 * Assert the SEO basics shared by every page archetype:
 *  - exactly one <h1>
 *  - meta description in 120-160 chars
 *  - canonical link present
 *  - JSON-LD blocks parse and contain the expected `@type` values
 *  - Open Graph + Twitter card tags are present
 *
 * Mirrors the unit-test contract in `src/__tests__/unit/data/tool-metadata.test.ts`
 * so anything passing in unit tests should pass here too.
 */
export async function assertSeoBasics(
  page: Page,
  options: {
    expectedJsonLdTypes?: string[];
    requireOgImage?: boolean;
    /**
     * When set, the meta description length must fall in this range.
     * Defaults to a generous 50-200 cap. Tool pages should pass [120, 160]
     * to mirror the unit-test contract; homepage/category/blog pages have
     * longer copy and only need to be present + non-trivial.
     */
    descriptionRange?: [number, number];
  } = {},
): Promise<void> {
  // Exactly one H1 — checked structurally in the unit suite, but worth
  // re-asserting against the rendered DOM.
  const h1Count = await page.locator("h1").count();
  expect(h1Count, "page should render exactly one <h1>").toBe(1);

  // Meta description present and within budget.
  const [minLen, maxLen] = options.descriptionRange ?? [50, 200];
  const description = await page
    .locator('meta[name="description"]')
    .getAttribute("content");
  expect(description, "meta description must exist").toBeTruthy();
  expect(description!.length).toBeGreaterThanOrEqual(minLen);
  expect(description!.length).toBeLessThanOrEqual(maxLen);

  // Canonical link.
  const canonical = await page
    .locator('link[rel="canonical"]')
    .getAttribute("href");
  expect(canonical, "canonical link must be set").toBeTruthy();

  // Open Graph + Twitter tags. og:title is set by the root layout and is
  // expected on every page. og:image is overridden by some category/blog
  // page metadata blocks that don't declare images, so it's checked
  // separately when callers opt-in via `requireOgImage: true`.
  await expect(page.locator('meta[property="og:title"]')).toHaveCount(1);
  if (options.requireOgImage) {
    await expect(page.locator('meta[property="og:image"]')).toHaveCount(1);
  }
  await expect(page.locator('meta[name="twitter:card"]')).toHaveCount(1);

  // JSON-LD blocks parse as JSON. If a caller passed expected @type values,
  // confirm at least one block carries each.
  const ldBlocks = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents();
  expect(ldBlocks.length, "at least one JSON-LD block expected").toBeGreaterThan(0);
  const parsed = ldBlocks.map((raw) => JSON.parse(raw) as unknown);

  for (const expected of options.expectedJsonLdTypes ?? []) {
    const matched = parsed.some((entry) => containsType(entry, expected));
    expect(matched, `expected JSON-LD with @type=${expected}`).toBe(true);
  }
}

function containsType(entry: unknown, type: string): boolean {
  if (!entry || typeof entry !== "object") return false;
  const obj = entry as Record<string, unknown>;
  if (obj["@type"] === type) return true;
  // @graph arrays nest the actual schema entries.
  if (Array.isArray(obj["@graph"])) {
    return (obj["@graph"] as unknown[]).some((g) => containsType(g, type));
  }
  return false;
}

/**
 * Wait until the tool's "Convert" / "Format" / etc. has rendered a download
 * affordance. Each tool labels its primary download button with a `Download`
 * lucide icon + accessible label "Download <filename>", so we look for the
 * button whose accessible name starts with "Download ".
 */
export function downloadButton(page: Page): Locator {
  return page.getByRole("button", { name: /^Download / });
}

/**
 * Locate the active inline `<ErrorMessage>` component. Resolves to the
 * non-empty `role="alert"` div — distinct from Next's `__next-route-announcer__`
 * which also carries `role="alert"` but starts empty. Filtering by text
 * content keeps the assertion robust against the announcer's presence.
 */
export function errorAlert(page: Page): Locator {
  return page.locator('[role="alert"]').filter({ hasText: /\S/ }).first();
}

