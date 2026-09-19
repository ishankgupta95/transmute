import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tools } from "../../../data/tools";
import { categories } from "../../../data/categories";

/**
 * The systematic surface sweep (plan.md Phase 1): every route, at every
 * breakpoint the design docs specify, checked for the two failure classes a
 * per-page functional spec never sees.
 *
 *  1. **Horizontal overflow** — an element wider than the viewport. This is
 *     the single most common responsive regression and it is invisible to
 *     desktop-only specs. Checked against `documentElement.scrollWidth`,
 *     which is the browser's own answer to "does this page scroll sideways".
 *  2. **Console errors** — React hydration mismatches, failed chunk loads and
 *     uncaught exceptions all land here and nowhere else. A tool page can
 *     render its H1 perfectly while its client component has already thrown.
 *
 * Both are asserted per-viewport across the whole route table so a new tool
 * (or a new page) is covered the moment it lands in the registry — nothing is
 * hand-curated. Failures report every offending route at once rather than
 * stopping at the first, so one run gives the full picture.
 */

const ROUTES: string[] = [
  "/",
  ...categories.map((c) => `/${c.slug}`),
  ...tools.map((t) => `/${t.slug}`),
  "/all-tools",
  "/workspace",
  "/open",
  "/offline-access",
  "/about",
  "/privacy",
  "/licenses",
];

const VIEWPORTS = [
  { label: "desktop", width: 1440, height: 900 },
  { label: "tablet", width: 768, height: 1024 },
  { label: "mobile", width: 375, height: 812 },
] as const;

/**
 * Console noise that is not a defect:
 *  - Next.js dev-only hints and HMR chatter.
 *  - Font/analytics requests blocked in a sandboxed run.
 *  - The `<img>` LCP hint ESLint also warns about (blob: URLs can't use next/image).
 */
const IGNORED_CONSOLE = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /googletagmanager|google-analytics|gtag/i,
  /Using `<img>` could result in slower LCP/i,
];

function collectErrors(page: Page, sink: string[]): void {
  const record = (text: string) => {
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
    sink.push(text);
  };
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") record(msg.text());
  });
  page.on("pageerror", (err) => record(`pageerror: ${err.message}`));
}

/**
 * The widest horizontal extent of the document. A page is "clean" when this
 * is no wider than the viewport (plus 1px for subpixel rounding).
 */
async function overflowWidth(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth);
}

/**
 * Guards the sweep against passing vacuously: if the registry imports ever
 * resolve to empty arrays the loops below would assert nothing at all.
 */
test("the sweep covers the whole route table", () => {
  expect(tools.length).toBeGreaterThan(60);
  expect(categories.length).toBe(5);
  expect(ROUTES.length).toBe(
    // home + categories + tools + /all-tools + /workspace + /open
    // + /offline-access + about/privacy/licenses
    1 + categories.length + tools.length + 1 + 1 + 1 + 1 + 3,
  );
});

/*
 * THE ARITHMETIC ABOVE COUNTS THE ARRAY, NOT THE SITE — WHICH IS HOW TWO
 * ROUTES WENT UNSWEPT.
 *
 * `/open` (the share-target landing route) and `/offline-access` are both real
 * static pages `npm run build` emits, and neither was in ROUTES. The guard did
 * not catch it, because its expected value was derived from the literal it was
 * checking: someone writing the array and the sum in the same edit gets a green
 * test for whatever they happened to list. Every tool and category route is
 * safe from that — those come from a registry — but the hand-written tail is
 * exactly where the omission was, and hand-counting is exactly what could not
 * see it.
 *
 * So the tail is checked against the filesystem instead. A `page.tsx` inside a
 * `src/app` directory IS the route table for these pages: one directory per
 * static route, plus the root `page.tsx` for "/" and `[slug]` for the
 * registry-driven tool pages, both excluded here. A new page directory is
 * swept the moment it lands, and until someone adds it to ROUTES this goes red
 * naming it.
 */
test("every static page directory in src/app is swept", () => {
  const appDir = resolve(__dirname, "../../../app");
  const routeDirs = readdirSync(appDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "[slug]")
    .filter((e) => existsSync(join(appDir, e.name, "page.tsx")))
    .map((e) => `/${e.name}`);

  // Positive control: if the scan ever stops finding directories, the
  // assertion below passes over an empty list and proves nothing.
  expect(routeDirs.length, "no page directories found under src/app").toBeGreaterThan(5);
  expect(existsSync(join(appDir, "page.tsx")), 'the root "/" page').toBe(true);

  const unswept = routeDirs.filter((r) => !ROUTES.includes(r));
  expect(
    unswept,
    "these are real static routes the build emits but the sweep never visits — " +
      "add them to ROUTES and update the count above",
  ).toEqual([]);
});

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.label} (${viewport.width}px)`, () => {
    test(`no route overflows horizontally or logs a console error`, async ({
      page,
    }) => {
      test.setTimeout(300_000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      const overflowing: string[] = [];
      const erroring: string[] = [];

      for (const route of ROUTES) {
        const consoleErrors: string[] = [];
        collectErrors(page, consoleErrors);

        await page.goto(route, { waitUntil: "domcontentloaded" });
        // Client components mount and lay out after hydration; without this the
        // measurement can race a not-yet-rendered tool shell.
        await page.waitForLoadState("networkidle").catch(() => {});

        const width = await overflowWidth(page);
        if (width > viewport.width + 1) {
          overflowing.push(`${route} → ${width}px (viewport ${viewport.width})`);
        }
        if (consoleErrors.length > 0) {
          erroring.push(`${route} → ${consoleErrors.slice(0, 2).join(" | ")}`);
        }
        page.removeAllListeners("console");
        page.removeAllListeners("pageerror");
      }

      expect(
        overflowing,
        `routes overflowing at ${viewport.width}px:\n${overflowing.join("\n")}`,
      ).toEqual([]);
      expect(
        erroring,
        `routes logging console errors at ${viewport.width}px:\n${erroring.join("\n")}`,
      ).toEqual([]);
    });
  });
}
