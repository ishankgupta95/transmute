import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { HTML_LANG, OG_LOCALE } from "@/lib/seo/locale";

/*
 * ⚠ THIS GATE EXISTS BECAUSE THE THING IT CHECKS WAS ALREADY BROKEN IN THE
 * SHIPPED EXPORT, AND NOTHING NOTICED.
 *
 * Measured 2026-09-13 over the built `out/`: **10 of 222 pages carried
 * `og:locale`**. The other 212 — every tool page, every blog post, every
 * category hub — carried none. `og:title` was present on 221, so the pages
 * were not missing their Open Graph block; they were missing one FIELD of it.
 *
 * The cause is a Next.js rule that is easy to be wrong about: a page's
 * `openGraph` REPLACES the root layout's, it does not merge with it. So the
 * root declaring `locale: "en_US"` bought nothing for any page that declared
 * an `openGraph` block of its own, and eight files do.
 *
 * A literal in nine separate metadata blocks is a thing you forget in the
 * tenth. They now all read `OG_LOCALE`, and this checks that they do — over
 * SOURCE, so it holds on a clean checkout with no build.
 */

const root = resolve(__dirname, "../../../..");
const LOCALE_MODULE = "@/lib/seo/locale";

function filesUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(resolve(root, dir))) {
    const rel = join(dir, entry);
    if (statSync(resolve(root, rel)).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      filesUnder(rel, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(rel);
    }
  }
  return out;
}

/** Every file that declares an `openGraph` metadata block. */
const openGraphFiles = [...filesUnder("src/app"), ...filesUnder("src/lib")].filter((rel) =>
  /^\s*openGraph: \{/m.test(readFileSync(resolve(root, rel), "utf8")),
);

describe("every page declares its locale, from one source", () => {
  it("finds the openGraph blocks at all", () => {
    // The scan is the gate. If this glob ever breaks, everything below passes
    // over an empty list and reports success for a site with no locale at all.
    expect(openGraphFiles.length).toBeGreaterThanOrEqual(8);
    expect(openGraphFiles).toContain("src/lib/seo/tool-metadata.ts");
    expect(openGraphFiles).toContain("src/app/layout.tsx");
  });

  it("every openGraph block sets a locale", () => {
    const missing = openGraphFiles.filter(
      (rel) => !/^\s*locale: /m.test(readFileSync(resolve(root, rel), "utf8")),
    );
    expect(
      missing,
      "a page's openGraph REPLACES the root layout's rather than merging with " +
        "it, so a block without `locale` ships a page with no og:locale at all",
    ).toEqual([]);
  });

  it("takes the locale from the shared module, never a literal", () => {
    const offenders: string[] = [];
    for (const rel of openGraphFiles) {
      const src = readFileSync(resolve(root, rel), "utf8");
      const locales = [...src.matchAll(/^\s*locale: (.+?),$/gm)].map((m) => m[1]);
      for (const value of locales) {
        // A quoted value is a literal — the exact shape that went stale.
        if (/^["'`]/.test(value)) offenders.push(`${rel}: locale: ${value}`);
      }
      if (locales.length && !src.includes(LOCALE_MODULE)) {
        offenders.push(`${rel}: sets a locale without importing ${LOCALE_MODULE}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the html lang attribute comes from the same source", () => {
    const layout = readFileSync(resolve(root, "src/app/layout.tsx"), "utf8");
    expect(layout).toContain("lang={HTML_LANG}");
    expect(layout, "a hardcoded lang and a computed og:locale can disagree").not.toMatch(
      /lang="[a-z]{2}"/,
    );
  });

  it("the two locale values are well formed, and differ in the right way", () => {
    /*
      `<html lang>` is BCP 47 and hyphenates; Open Graph underscores. Writing
      one where the other belongs emits a locale no validator accepts, and
      nothing on the page looks wrong when you do — which is why both shapes
      are asserted rather than just their spelling.
    */
    expect(HTML_LANG, "html lang").toMatch(/^[a-z]{2}(-[A-Z]{2})?$/);
    expect(OG_LOCALE, "og:locale").toMatch(/^[a-z]{2}(_[A-Z]{2})?$/);
    expect(OG_LOCALE, "Open Graph underscores its region").not.toContain("-");
    expect(HTML_LANG, "BCP 47 hyphenates its region").not.toContain("_");
  });
});
