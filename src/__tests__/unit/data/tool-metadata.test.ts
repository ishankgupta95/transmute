import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { tools, getToolBySlug } from "@/data/tools";
import { getToolCopy } from "@/data/tool-copy";
import { categories } from "@/data/categories";
import { faqs, PRIVACY_FAQ } from "@/data/faqs";
import { workspaceTools } from "@/data/workspace";
import { svgFallbackSize } from "@/lib/tools/image-convert";

/**
 * The server-only copy for a tool. `aboutText`, `relatedTools` and `titleTag`
 * moved off `Tool` into src/data/tool-copy.ts so they stop shipping to the
 * client — see that file's header. Throws rather than returning undefined: a
 * registry entry with no copy entry is a bug these suites should catch.
 */
const copyOf = (slug: string) => {
  const c = getToolCopy(slug);
  if (!c) throw new Error(`${slug} has no tool-copy entry`);
  return c;
};


/** src/, for the few claims below that live in a page or on disk. */
const SRC = join(dirname(new URL(import.meta.url).pathname), "../../../");

/*
  These files DOCUMENT the strings the scans below forbid — the retired
  homepage sentence and the retired hub caption are both quoted in the comment
  that explains why they went. Searching raw source would match the
  explanation, which is a gate that can only be satisfied by silence (the same
  trap size-claims.test.ts strips comments for).
*/
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const DESCRIPTION_MIN = 120;
const DESCRIPTION_MAX = 160;
const ABOUT_MIN_WORDS = 200;
const ABOUT_MAX_WORDS = 400;
const FAQ_MIN_RENDERED = 4;

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

const categorySlugs = new Set(categories.map((c) => c.slug));
const toolSlugs = new Set(tools.map((t) => t.slug));

describe("tool registry invariants", () => {
  it("has unique tool slugs", () => {
    expect(tools.length).toBe(toolSlugs.size);
  });

  it.each(tools.map((t) => [t.slug, t]))(
    "%s belongs to a known category",
    (_slug, tool) => {
      expect(categorySlugs.has(tool.category)).toBe(true);
    },
  );
});

describe("description length (§1.2: 120–160 chars)", () => {
  it.each(tools.map((t) => [t.slug, t]))(
    "%s description is within bounds",
    (_slug, tool) => {
      expect(tool.description.length).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
      expect(tool.description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    },
  );
});

/**
 * §1.2 asks for 200–400 words of aboutText. Both halves of that were skipped
 * together on the reason "today every tool's aboutText is below 200 words
 * (range 115–191)" — i.e. the floor was unreachable, so nothing ran.
 *
 * That reason died. The registry has been rewritten twice since and most of a
 * hundred aboutTexts have moved, in both directions: tools now clear the floor
 * routinely, and several clear the CEILING, which the skip was quietly
 * covering for as well. `it.each` over every tool was producing that many
 * skipped rows and asserting nothing about a registry whose copy was being
 * rewritten wholesale under it.
 *
 * The two halves are in different states and are now gated differently.
 *
 * THE CEILING RUNS, per tool. The aboutTexts over it are NAMED below rather
 * than waved through by a raised bound: moving 400 to 600 would retire the
 * gate for every tool at once, which is exactly what the skip already did.
 * Each waiver is checked from both sides — a slug on the list that no longer
 * exceeds the ceiling fails, so the list cannot rot, and the list cannot grow
 * without this file changing. Those eight are copy debt; the honest fix is
 * trimming them, not lengthening the rule.
 *
 * THE FLOOR IS A RATCHET, not a per-tool assertion. Most of the registry is
 * still short of 200 words. That is a content backlog rather than a defect,
 * and a hundred red rows every run is a suite nobody reads, so what is
 * asserted is that the backlog does not GROW — a new tool, or a copy pass that
 * shortens an existing one, goes red.
 *
 * Prose here names no slug and no word count on purpose: the sentence deleted
 * to write this one was a parenthetical citing a range ("115–191") that the
 * next copy pass falsified, and tool-surface-heights.test.ts carries the same
 * warning about the same mistake one directory over. The two constants below
 * are the only numbers, and both are checked rather than remembered — the
 * failure messages derive the current figures.
 */
const OVER_CEILING_WAIVERS = [
  "recompress-pdf-images",
  "extract-pdf-pages",
  "merge-video",
  "normalize-audio",
  "compress-video-to-size",
  "subtitle-converter",
  "change-pdf-page-size",
  "extract-images-from-pdf",
];

/** Tools currently short of the §1.2 floor. A ratchet, not a target. */
const UNDER_FLOOR_BUDGET = 100;

describe("aboutText word count (§1.2: 200–400 words)", () => {
  const overCeiling = tools.filter((t) => wordCount(copyOf(t.slug).aboutText) > ABOUT_MAX_WORDS);
  const underFloor = tools.filter((t) => wordCount(copyOf(t.slug).aboutText) < ABOUT_MIN_WORDS);

  it.each(tools.filter((t) => !OVER_CEILING_WAIVERS.includes(t.slug)).map((t) => [t.slug, t]))(
    "%s aboutText is at or under the ceiling",
    (slug, tool) => {
      expect(
        wordCount(copyOf(tool.slug).aboutText),
        `${slug} is ${wordCount(copyOf(tool.slug).aboutText)} words; the ceiling is ${ABOUT_MAX_WORDS}`,
      ).toBeLessThanOrEqual(ABOUT_MAX_WORDS);
    },
  );

  it("every waived slug is still over the ceiling", () => {
    // A waiver for a tool that has since been trimmed is a hole nobody closed.
    const stale = OVER_CEILING_WAIVERS.filter(
      (slug) => !overCeiling.some((t) => t.slug === slug),
    );
    expect(stale, `waived but no longer over ${ABOUT_MAX_WORDS} words`).toEqual([]);
  });

  it("the waiver list only shrinks", () => {
    expect(
      overCeiling.map((t) => `${t.slug} (${wordCount(copyOf(t.slug).aboutText)})`).sort(),
      "a new aboutText is over the ceiling; trim it rather than waiving it",
    ).toHaveLength(OVER_CEILING_WAIVERS.length);
  });

  it("the number of aboutTexts under the floor does not grow", () => {
    expect(
      underFloor.length,
      `${underFloor.length} tools are under ${ABOUT_MIN_WORDS} words; the recorded backlog is ${UNDER_FLOOR_BUDGET}. Shortest: ${underFloor
        .map((t) => `${t.slug} (${wordCount(copyOf(t.slug).aboutText)})`)
        .sort()
        .slice(0, 3)
        .join(", ")}`,
    ).toBeLessThanOrEqual(UNDER_FLOOR_BUDGET);
  });
});

describe("relatedTools resolution (§1.2)", () => {
  it.each(tools.map((t) => [t.slug, t]))(
    "%s relatedTools all resolve to existing tools",
    (slug, tool) => {
      for (const related of copyOf(tool.slug).relatedTools) {
        expect(getToolBySlug(related), `${slug} → ${related}`).toBeDefined();
      }
    },
  );

  it.each(tools.map((t) => [t.slug, t]))(
    "%s relatedTools does not list itself",
    (slug, tool) => {
      expect(copyOf(tool.slug).relatedTools).not.toContain(slug);
    },
  );

  it.each(tools.map((t) => [t.slug, t]))(
    "%s has no duplicate relatedTools entries",
    (_slug, tool) => {
      expect(new Set(copyOf(tool.slug).relatedTools).size).toBe(copyOf(tool.slug).relatedTools.length);
    },
  );
});

describe("FAQ structure (§1.2)", () => {
  it.each(tools.map((t) => [t.slug, t]))(
    "%s FAQ questions are unique within the tool",
    (slug) => {
      const rendered = [...(faqs[slug] ?? []), PRIVACY_FAQ];
      const questions = rendered.map((f) => f.question.trim().toLowerCase());
      expect(new Set(questions).size).toBe(questions.length);
    },
  );

  it("PRIVACY_FAQ question does not collide with any tool's own FAQ", () => {
    const privacyQ = PRIVACY_FAQ.question.trim().toLowerCase();
    for (const slug of Object.keys(faqs)) {
      const own = faqs[slug] ?? [];
      const collisions = own.filter(
        (f) => f.question.trim().toLowerCase() === privacyQ,
      );
      expect(collisions, `${slug} duplicates PRIVACY_FAQ`).toEqual([]);
    }
  });
});

describe("FAQ count (§1.2: ≥4 rendered per tool, including PRIVACY_FAQ)", () => {
  it.each(tools.map((t) => [t.slug, t]))(
    "%s has ≥4 rendered FAQs",
    (slug) => {
      const rendered = [...(faqs[slug] ?? []), PRIVACY_FAQ];
      expect(rendered.length).toBeGreaterThanOrEqual(FAQ_MIN_RENDERED);
    },
  );
});

/*
 * ─── COPY THAT NAMES A CAPABILITY ──────────────────────────────────────────
 *
 * Everything below pins a registry sentence to something outside the registry:
 * a browser behaviour, a shipped function's arithmetic, a package manifest, or
 * a file on disk. The three cases here were all written as absolutes and all
 * three were falsifiable by the reader.
 */

const copyFor = (slug: string) => {
  const tool = getToolBySlug(slug);
  expect(tool, `no such tool: ${slug}`).toBeDefined();
  return [
    tool!.description,
    tool!.subtitle,
    copyOf(slug).aboutText,
    ...(faqs[slug] ?? []).flatMap((f) => [f.question, f.answer]),
  ].join("\n");
};

describe("the TIFF pages hedge the way browsers actually behave", () => {
  /*
    MDN's image-format table lists TIFF as "Safari only", and a 188-byte
    uncompressed RGB TIFF loads in Playwright's WebKit through both <img> and
    createImageBitmap while Chromium refuses it with an InvalidStateError. So
    "No browser opens TIFF at all" — which tiff-to-png shipped with — is a
    sentence a Safari reader can disprove in the tab it is rendered in. The
    older sibling had it right all along: tiff-to-jpg says "most".

    The pages are still correct that the DECODE here does not depend on the
    browser: utif2 runs everywhere, which is the claim worth making.
  */
  const TIFF_SLUGS = ["tiff-to-png", "tiff-to-jpg"];

  it.each(TIFF_SLUGS)("%s makes no absolute claim about TIFF decoders", (slug) => {
    const copy = copyFor(slug);
    expect(copy, `${slug} copy does not mention TIFF at all`).toMatch(/TIFF/);
    expect(copy, `${slug} states an absolute WebKit disproves`).not.toMatch(/\bno browser\b/i);
  });

  it("tiff-to-png names the browser that is the exception", () => {
    expect(copyFor("tiff-to-png")).toMatch(/Safari/);
  });

  it("tiff-to-jpg keeps the hedge it shipped with", () => {
    // The negative above passes on an empty read; this is the paired positive.
    expect(copyFor("tiff-to-jpg")).toMatch(/most web browsers cannot display TIFF/i);
  });
});

describe("the SVG raster pages describe the fallback the code implements", () => {
  /*
    `svgFallbackSize` clamps with `Math.max(1, 1024 / Math.max(vw, vh))`, so
    1024 is a FLOOR: a viewBox-only document smaller than that is scaled up to
    it, and one larger is rasterised at its own size. Three pages stated the
    number as an outcome ("scaled so its longest edge is 1024 pixels", and in
    svg-to-webp's meta description "a viewBox-only file scales to 1024 px"),
    which is wrong for every artboard past 1024 units — an ordinary Figma or
    Illustrator export.

    The behaviour is derived here rather than quoted, so if the clamp is ever
    changed to a real target the copy goes red instead of quietly becoming
    right by accident.
  */
  const SVG_SLUGS = ["svg-to-png", "svg-to-jpg", "svg-to-webp"];
  const viewBoxOnly = (w: number, h: number) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"></svg>`;

  it("the 1024 in that copy is a floor, not a target", () => {
    expect(svgFallbackSize(viewBoxOnly(24, 24))).toEqual({
      width: 1024,
      height: 1024,
      explicit: false,
    });
    expect(svgFallbackSize(viewBoxOnly(2000, 1000))).toEqual({
      width: 2000,
      height: 1000,
      explicit: false,
    });
  });

  it.each(SVG_SLUGS)("%s does not promise a 1024 px longest edge", (slug) => {
    const copy = copyFor(slug);
    expect(copy, `${slug} does not mention the fallback at all`).toContain("1024");
    expect(copy, `${slug} states 1024 as the outcome`).not.toMatch(
      /scaled so (its|the) longest edge is 1024/i,
    );
    expect(copy, `${slug} states 1024 as the outcome`).not.toMatch(/scales to 1024/i);

    // Every sentence that names the number has to carry the direction too —
    // the two negatives above only cover the two phrasings that shipped.
    for (const sentence of copy.split(/(?<=[.;])\s+/).filter((s) => s.includes("1024"))) {
      expect(
        sentence,
        `${slug}: "${sentence.trim()}" names 1024 without saying it only scales up`,
      ).toMatch(/scaled up|scales up|at least|floor/i);
    }
  });
});

describe("compress-png's opening claim is about the Canvas API, not about other products", () => {
  /*
    It opened: 'Every other "PNG compressor" on the web is really a
    re-encoder'. An unmeasured absolute about every competing product — and
    refuted by the manifest of the package this very page installed, which
    describes itself as repackaged from Squoosh, a browser PNG compressor
    running this same oxipng build rather than a canvas round trip.

    Everything else in that passage is measured against the oxipng probe
    (31.5% / 35.2% on this site's own social image, 0–3% on an already
    optimised PNG, ~24 MB per megapixel), so the replacement keeps the
    mechanism and drops the comparison.
  */
  const copy = copyFor("compress-png");

  it("the counter-example is still in node_modules", () => {
    // The refutation is an artifact, not a memory: if the dependency is ever
    // swapped for one with no Squoosh lineage, this is where that shows up.
    const manifest = JSON.parse(
      readFileSync(join(SRC, "../node_modules/@jsquash/oxipng/package.json"), "utf8"),
    ) as { description?: string };
    expect(manifest.description ?? "").toMatch(/squoosh/i);
  });

  it("makes no claim about what every other site does", () => {
    expect(copy, "an unmeasured absolute about competitors is back").not.toMatch(/every other/i);
  });

  it("still states the mechanism the page replaces", () => {
    expect(copy).toMatch(/no compression level/i);
    expect(copy).toMatch(/canvas is not compression/i);
  });

  it("keeps the numbers that were measured", () => {
    expect(copy).toContain("31.5%");
    expect(copy).toContain("35.2%");
  });
});

/*
 * ─── PAGE COPY THAT MAKES A CLAIM ABOUT THE REGISTRY ──────────────────────
 *
 * Two page-level strings generalise over sets of tools, which makes them
 * registry claims rendered somewhere else. Neither had a gate.
 */

describe("the homepage's bundled-loader clause counts nothing it would have to recount", () => {
  /*
    It read "the JavaScript loaders for the two WebAssembly engines above" —
    true while the bundled-loader set was zxing-wasm and libarchive, and false
    the moment oxipng's wasm-bindgen glue joined them inside
    /workers/image.worker.js. A count in prose next to a table that grows is a
    sentence that is wrong between edits, so the clause names no count. The
    upper bound is asserted instead, because the newest loader is far below the
    "tens of kilobytes" the clause used to claim for every one of them.
  */
  // Comments first: the ENGINES block above the table quotes the retired
  // sentence verbatim to explain why it went, and a scan that matched the
  // explanation instead of the render would be satisfied by silence.
  const homepage = stripComments(readFileSync(join(SRC, "app/page.tsx"), "utf8"));
  const clause = /JavaScript loaders[\s\S]{0,240}?rather than hundreds/.exec(homepage)?.[0];

  it("finds the clause at all", () => {
    expect(homepage).toContain("BUNDLED, NOT SERVED");
    expect(clause, "the bundled-loader clause moved or was reworded away").toBeTruthy();
  });

  it("names no engine count", () => {
    expect(clause!, "a count is back, and it will be stale at the next engine").not.toMatch(
      /\b(one|two|three|four|five|[1-9])\b/i,
    );
  });

  it("bounds the loaders from above, anchored to the smallest one on disk", () => {
    expect(homepage).toMatch(/at most tens of kilobytes/);
    const loaderBytes = statSync(
      join(SRC, "../node_modules/@jsquash/oxipng/codec/pkg/squoosh_oxipng.js"),
    ).size;
    expect(
      homepage,
      `the page quotes a loader size that is not ${loaderBytes} bytes on disk`,
    ).toContain(loaderBytes.toLocaleString("en-US"));
  });
});

describe("the image hub's section captions are true of the cards under them", () => {
  /*
    "CHANGE THE FILE, KEEP THE FORMAT" sat over the 32 tools that are not
    `toolType === "image-convert"`, and the format half was false for sixteen
    of them — /ico-to-png (whose own H1 is "Convert ICO to PNG Online") two
    inches above a heading that reads "Format converters", /base64-to-image,
    /image-to-base64, /png-to-ico, /favicon-generator, /image-splitter,
    /exif-viewer, /image-color-palette and the eight edit pages that accept
    .avif/.bmp/.gif and write none of them.

    The page's own comment quotes the retired caption, so comments are stripped
    before the captions are read — a scan that matched the explanation would be
    a scan that can only be satisfied by silence (same trap size-claims.test.ts
    documents).
  */
  const hub = stripComments(readFileSync(join(SRC, "app/image-tools/page.tsx"), "utf8"));
  const captions = [...hub.matchAll(/title: "([^"]+)", caption: "([^"]+)"/g)].map(
    ([, title, caption]) => ({ title, caption }),
  );

  it("parses both sections out of the hub", () => {
    expect(captions.map((c) => c.title)).toEqual(["Utilities", "Format converters"]);
  });

  it("the section really does hold tools that change the format", () => {
    // The paired positive: without this the caption check below would pass on
    // a section where the claim happened to be true.
    const routeChangers = tools
      .filter((t) => t.category === "image-tools" && t.toolType !== "image-convert")
      .filter((t) => {
        const route = workspaceTools.find((w) => w.slug === t.slug)?.route ?? "";
        const [from, to] = route.split("→").map((s) => s.trim());
        return Boolean(from && to && from !== to);
      })
      .map((t) => t.slug);
    expect(routeChangers).toContain("ico-to-png");
    expect(routeChangers).toContain("base64-to-image");
    expect(routeChangers.length).toBeGreaterThanOrEqual(6);
  });

  it("so the utilities caption claims nothing about the format", () => {
    const utilities = captions.find((c) => c.title === "Utilities");
    expect(utilities, "the Utilities section is gone").toBeDefined();
    expect(
      utilities!.caption,
      "the caption makes a format claim over a section full of format changes",
    ).not.toMatch(/format/i);
  });

  it("and the converters caption still makes one, because there it is true", () => {
    const converters = captions.find((c) => c.title === "Format converters");
    expect(converters!.caption).toMatch(/format/i);
    expect(
      tools.filter((t) => t.category === "image-tools" && t.toolType === "image-convert").length,
    ).toBeGreaterThan(10);
  });
});
