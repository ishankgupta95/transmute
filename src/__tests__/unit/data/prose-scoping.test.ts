import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

/*
 * THE TYPOGRAPHY PLUGIN IS OFF THE CRITICAL PATH, AND THIS KEEPS IT THERE.
 *
 * `@tailwindcss/typography` emits ~30 KB raw / ~3.7 KB gzipped of `.prose`
 * rules. Declared in `globals.css` it landed in the ONE stylesheet every page
 * render-blocks on — including the 207 of 222 pages that never render a
 * `.prose` element. Moving the `@plugin` into `src/styles/prose.css`, imported
 * only by the three files that use it, took the shared sheet from 129,437 B
 * raw / 19,804 gzipped to 104,943 / 17,170 (measured 2026-09-13).
 *
 * Two ways that silently comes undone, and this file fails on both:
 *   1. Someone adds `@plugin "@tailwindcss/typography"` back to globals.css —
 *      everything keeps working, and 3.7 KB returns to every page.
 *   2. Someone uses a `prose` class in a NEW component without importing the
 *      stylesheet. That component renders UNSTYLED, which is how the first
 *      version of this split shipped: the blog was fixed and the two Markdown
 *      tools were not, because their `ssr: false` chunk pulls its own CSS in
 *      at runtime and nothing in the built HTML says so.
 *
 * The scan is over SOURCE, not over `out/`, so it holds on a clean checkout
 * with no build.
 */

const root = resolve(__dirname, "../../../..");
const PROSE_STYLESHEET = "src/styles/prose.css";
const PROSE_IMPORT = "@/styles/prose.css";

/** Files that are allowed to name a prose class, each of which must import the sheet. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(resolve(root, dir))) {
    const rel = join(dir, entry);
    const full = resolve(root, rel);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      sourceFiles(rel, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * A real `prose` CLASS, not the English word — and getting this wrong is the
 * default. The first version of this scan looked for `prose` within 400 chars
 * of a `className={`, and matched FOUR files whose only "prose" is an English
 * noun in a comment ("the reference prose sits…", "best for prose."). It
 * reported 7 consumers where there are 3.
 *
 * So: strip comments, then look only inside string literals, then require a
 * whitespace-delimited token that IS `prose` or begins `prose-`. "prose." with
 * a full stop is not a class, and neither is anything in a comment.
 */
function usesProseClass(source: string): boolean {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
  for (const [, literal] of code.matchAll(/["'`]([^"'`\n]*)["'`]/g)) {
    for (const token of literal.split(/\s+/)) {
      if (token === "prose" || token.startsWith("prose-")) return true;
    }
  }
  return false;
}

describe("the typography plugin stays off the critical path", () => {
  it("is declared in the scoped stylesheet, not in globals.css", () => {
    const globals = readFileSync(resolve(root, "src/app/globals.css"), "utf8");
    const scoped = readFileSync(resolve(root, PROSE_STYLESHEET), "utf8");

    expect(
      globals.includes("@tailwindcss/typography"),
      "globals.css is the sheet every page render-blocks on; the typography " +
        "plugin costs ~3.7 KB gzipped there and is used by 15 of 222 pages",
    ).toBe(false);
    // Positive control: the plugin has to be declared SOMEWHERE, or the blog
    // is unstyled and the assertion above passes for the wrong reason.
    expect(scoped).toContain('@plugin "@tailwindcss/typography"');
  });

  it("emits nothing but the plugin — no second copy of Tailwind", () => {
    const scoped = readFileSync(resolve(root, PROSE_STYLESHEET), "utf8");
    // `source(none)` is what keeps this file from re-scanning the whole app and
    // re-emitting every utility already in the shared sheet. Without it this
    // "optimisation" ships Tailwind twice.
    const imports = [...scoped.matchAll(/@import\s+"[^"]+"[^;]*/g)].map((m) => m[0]);
    expect(imports.length, "unexpected imports in the scoped sheet").toBeGreaterThan(0);
    for (const imp of imports) {
      expect(imp, `${imp} must not re-scan the app`).toContain("source(none)");
    }
    expect(scoped, "preflight belongs to the shared sheet only").not.toContain("preflight");
  });

  it("every file that uses a prose class imports the stylesheet", () => {
    const offenders = sourceFiles("src")
      .filter((rel) => rel !== PROSE_STYLESHEET)
      .filter((rel) => {
        const src = readFileSync(resolve(root, rel), "utf8");
        return usesProseClass(src) && !src.includes(PROSE_IMPORT);
      });

    expect(
      offenders,
      `these render a .prose element but never import ${PROSE_IMPORT}, so they ` +
        `ship UNSTYLED — add the import beside the component's other imports`,
    ).toEqual([]);
  });

  it("finds the consumers it is supposed to be guarding", () => {
    // Without this the test above passes vacuously the day the regex stops
    // matching — which is exactly how the first version of it "passed".
    const consumers = sourceFiles("src").filter((rel) =>
      usesProseClass(readFileSync(resolve(root, rel), "utf8")),
    );
    expect(consumers.length, "the prose-class scan matched nothing at all").toBeGreaterThan(0);
    expect(consumers.sort()).toEqual([
      "src/app/blog/[slug]/page.tsx",
      "src/components/tools/MarkdownToHtmlUI.tsx",
      "src/components/tools/MarkdownToPdfUI.tsx",
    ]);
  });
});
