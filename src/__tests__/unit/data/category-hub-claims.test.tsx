import { render, within } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { CategoryHubPage } from "@/components/layout/CategoryHubPage";
import { categories } from "@/data/categories";
import { tools } from "@/data/tools";
import { workspaceTools, getWorkspaceTool } from "@/data/workspace";

/*
  The five category hubs make three claims in one 250-pixel stat strip, and
  every one of them was drifting.

  1. DOWNLOAD.  `CategoryHubPage` hardcoded `0 KB`, in the same green the
     UPLOAD / NEVER row uses. It was true on exactly one of the five hubs.
     /video-tools and /audio-tools can pull the ~31 MB FFmpeg core, /pdf-tools
     pulls 2.3 MB of qpdf, /image-tools 1.3 MB of heic2any — and the homepage
     ENGINES table, framed as "what each one costs you on first use", said so
     on the same site the whole time. The figure now comes from
     `Category.download`, and this file pins it to that table so the two
     surfaces cannot quote different rulers.

  2. ENGINE.  The audio hub said `WEB AUDIO`, full stop, while every audio tool
     also encodes MP3 through lamejs and falls back to FFmpeg for containers
     `decodeAudioData` refuses (`decodeViaFFmpeg`, `lib/tools/audio-decode.ts`).

  3. The "I HAVE A…" chips.  Under that heading a chip is a claim that some
     page IN THAT CATEGORY accepts the format. Two chips were outputs instead:
     `ICO` on the image hub (png-to-ico writes .ico; no tool on the site reads
     one) and `GIF` on the video hub (video-to-gif writes .gif and reads
     .mp4/.webm/.mov — .gif is read only by the image tools, one hub over).

  The workspace ENGINE labels get the same treatment at the bottom of the file,
  including the width budget that decides how much truth fits.
*/

const homepage = readFileSync(resolve(process.cwd(), "src/app/page.tsx"), "utf8");

/** `{ name: "qpdf", handles: "…", size: "2.3 MB", when: "…" }` rows. */
function engineSizes(): Map<string, string> {
  const out = new Map<string, string>();
  const re = /\{\s*name:\s*"([^"]+)",\s*handles:\s*"[^"]*",\s*size:\s*"([^"]+)"/g;
  for (const [, name, size] of homepage.matchAll(re)) out.set(name, size);
  return out;
}

/*
   THE THIRD SURFACE.

   The hub's DOWNLOAD figure was checked against the homepage ENGINES row, and
   the ENGINES row against nothing — so "0–1.0 MB" and "1.0 MB" agreed with each
   other and with no artifact, while /qr-code-reader's own rail rendered
   "1.1 MB, on first scan" from ZXING_FIRST_SCAN_BYTES. Two guards, one loop,
   and the surface framed as the ceiling was the lower of the two numbers.

   The loop is opened by anchoring to a FILE. `zxing_reader.wasm` is the artifact
   `npm run copy:wasm` stages into the origin root, it is what the site serves,
   and it is what the ruler at the top of `ENGINES` in src/app/page.tsx names:
   the byte count of a file this origin serves. Bump the package and both the
   homepage row and the hub go red together.

   Only ceilings whose artifact is checked out get an entry — FFmpeg's core and
   heic2any live in gitignored copies under public/, so pinning them here would
   go red on a clean tree for the wrong reason.
*/
const CEILING_ARTIFACT: Record<string, { path: string; render: (bytes: number) => string }> = {
  "zxing-wasm": {
    path: "node_modules/zxing-wasm/dist/reader/zxing_reader.wasm",
    render: (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`,
  },
};

/*
   THE SAME ANCHOR, FOR A ROW THAT IS NOT ANY HUB'S CEILING.

   CEILING_ARTIFACT is only ever reached through `CEILING[slug]`, so it can
   pin an engine only while that engine is the heaviest thing some hub fetches.
   Its exclusion note is about a different problem — FFmpeg's core and heic2any
   are gitignored copies under public/, so there is no checked-out file to
   stat.

   oxipng is in neither category, and fell through the gap between them. Its
   artifact IS checked out: `npm run copy:wasm` stages
   node_modules/@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm into public/,
   exactly the way it stages zxing_reader.wasm one table up. It is simply
   small — 160 KB against heic2any's 1.3 MB — so it is not the image hub's
   ceiling and no `CEILING` entry names it. The homepage printed "160 KB" and
   nothing on the site or on disk checked that: bump the package past 168,960
   bytes and the row is false with `npm test`, `npm run lint` and
   `npx tsc --noEmit` all green.

   The ruler is the DOWNLOAD column's own, and it is binary. KB rows carry no
   decimal — libarchive's 613,235 bytes is what settles that, since it is
   rowed "599 KB" and not "598.9 KB" — while MB rows carry one, which is what
   CEILING_ARTIFACT renders above.
*/
const ENGINE_ARTIFACT: Record<string, { path: string; render: (bytes: number) => string }> = {
  oxipng: {
    path: "node_modules/@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm",
    render: (bytes) => `${(bytes / 1024).toFixed(0)} KB`,
  },
};

/**
 * The heaviest engine each hub can make a browser fetch. Derived by hand from
 * the tools in each category and pinned here so a new tool that drags a bigger
 * engine into a category has to come past this line.
 */
const CEILING: Record<string, string | null> = {
  /*
     Re-checked on 2026-09-06, and UNCHANGED — which is the answer, not a
     skipped step. /compress-png added the first new image engine since
     heic2any: oxipng, 164,172 bytes of served WebAssembly, rowed at "160 KB"
     on the homepage. That is an eighth of heic2any's 1.3 MB, so the ceiling
     does not move and /image-tools still reads "0–1.3 MB". A ceiling is the
     heaviest engine a hub can make a browser fetch, so a new engine only
     rewrites this line when it is the new heaviest; ratcheting it to whatever
     landed most recently would understate the hub on the day a small engine
     ships and overstate it forever after.
  */
  "image-tools": "heic2any",
  "pdf-tools": "qpdf",
  "audio-tools": "FFmpeg WASM",
  "video-tools": "FFmpeg WASM",
  /*
     Was `null` — the one hub that genuinely fetched nothing. /qr-code-reader
     pulls the zxing-cpp reader and /extract-archive pulls libarchive, and
     zxing is the heavier of the two (1,093,289 vs 613,235 bytes of served
     WebAssembly), so it is the ceiling. Nothing is `null` any more, which is
     why the "spends the success colour" case below asserts the opposite of
     what it used to.
  */
  "developer-tools": "zxing-wasm",
};

/** Extensions that spell one format two ways, as the ACCEPTS gate spells them. */
const ALIASES: Record<string, string[]> = {
  JPG: ["jpg", "jpeg"],
  TIFF: ["tiff", "tif"],
  HEIC: ["heic", "heif"],
  MD: ["md", "markdown"],
};

const acceptedExts = (categorySlug: string) =>
  new Set(
    tools
      .filter((t) => t.category === categorySlug)
      .flatMap((t) =>
        t.acceptFormats
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter((s) => s.startsWith("."))
          .map((s) => s.slice(1)),
      ),
  );

describe("the homepage ENGINES table is readable", () => {
  it("reads its source", () => {
    // The positive control: every cross-check below is a lookup in this map.
    const sizes = engineSizes();
    expect(homepage.length).toBeGreaterThan(1000);
    expect(sizes.size).toBeGreaterThan(5);
    expect(sizes.get("qpdf")).toBeDefined();
    expect(sizes.get("FFmpeg WASM")).toBeDefined();
    expect(sizes.get("heic2any")).toBeDefined();
    expect(sizes.get("oxipng")).toBeDefined();
  });

  it.each(Object.entries(ENGINE_ARTIFACT))(
    "quotes %s at the size of the file copy:wasm stages",
    (name, artifact) => {
      const size = engineSizes().get(name);
      expect(size, `the ENGINES table has no row named ${name}`).toBeDefined();

      const bytes = statSync(resolve(process.cwd(), artifact.path)).size;
      expect(
        bytes,
        `${artifact.path} is missing — copy:wasm stages this file into public/`,
      ).toBeGreaterThan(0);

      expect(
        size,
        `the ENGINES row for ${name} says ${size}, but ${artifact.path} is ${bytes} bytes, which is ${artifact.render(bytes)}`,
      ).toBe(artifact.render(bytes));
    },
  );

  it("renders KB the way the rows that are already there render it", () => {
    /*
      The ruler check, and the reason it is a separate case: `render` is a
      function in this file, so a wrong one would agree with a wrong row and
      both cases above would pass. libarchive is the row that fixes it — its
      artifact is 613,235 bytes and the homepage says "599 KB", which is
      /1024 to the unit and not to one decimal. Anything in ENGINE_ARTIFACT
      quoting KB has to be on that same ruler.
    */
    const render = ENGINE_ARTIFACT.oxipng.render;
    expect(render(613235)).toBe("599 KB");
    expect(engineSizes().get("libarchive")).toBe(render(613235));
    expect(render(1024)).toBe("1 KB");
  });
});

describe("Category.download", () => {
  it.each(categories.map((c) => [c.slug, c] as const))(
    "%s quotes the homepage's own figure for its heaviest engine",
    (slug, category) => {
      const ceiling = CEILING[slug];
      if (ceiling === null) {
        expect(
          category.download,
          `${slug} fetches no engine, so 0 KB is the honest value`,
        ).toBe("0 KB");
        return;
      }
      const size = engineSizes().get(ceiling);
      expect(size, `no ENGINES row named ${ceiling}`).toBeDefined();
      expect(
        category.download,
        `${slug}'s heaviest engine is ${ceiling} at ${size}, per src/app/page.tsx`,
      ).toBe(`0–${size}`);

      // ...and where the artifact is on disk, it is the anchor rather than the
      // homepage string, so the two surfaces cannot agree on a wrong number.
      const artifact = CEILING_ARTIFACT[ceiling];
      if (!artifact) return;
      const bytes = statSync(resolve(process.cwd(), artifact.path)).size;
      expect(bytes, `${artifact.path} is missing — copy:wasm stages this file`).toBeGreaterThan(0);
      const fromFile = artifact.render(bytes);
      expect(
        size,
        `the ENGINES row for ${ceiling} says ${size}, but ${artifact.path} is ${bytes} bytes, which is ${fromFile}`,
      ).toBe(fromFile);
      expect(
        category.download,
        `${slug} quotes ${category.download} while the artifact behind its ceiling is ${bytes} bytes (${fromFile})`,
      ).toBe(`0–${fromFile}`);
    },
  );

  it("anchors at least one ceiling to a file rather than to another sentence", () => {
    // The paired positive for the `if (!artifact) return` above: if the map
    // emptied, every category would take the early return and the case would
    // pass while checking nothing new.
    const anchored = categories.filter((c) => CEILING_ARTIFACT[CEILING[c.slug] ?? ""]);
    expect(
      anchored.map((c) => c.slug),
      "no hub is pinned to an artifact any more — the homepage is checking itself",
    ).not.toEqual([]);
  });

  it("never says a flat 0 KB on a hub that fetches an engine", () => {
    // The exact defect: `CategoryHubPage` rendered "0 KB" on all five.
    //
    // Every CEILING is a named engine now, so the filter below can only be
    // empty — which is exactly how a negative assertion rots into decoration.
    // The two lines above it are the positive control: they prove there are
    // five categories to filter and that each one carries a download string,
    // so "no category lies" is a statement about five real rows rather than
    // about an empty array.
    expect(categories).toHaveLength(5);
    for (const c of categories) {
      expect(c.download, `${c.slug} has no download claim at all`).toMatch(/\S/);
    }
    const lying = categories.filter(
      (c) => c.download === "0 KB" && CEILING[c.slug] !== null,
    );
    expect(lying.map((c) => c.slug)).toEqual([]);
  });
});

describe("the hub stat strip renders what the category says", () => {
  const renderHub = (slug: string) => {
    const category = categories.find((c) => c.slug === slug)!;
    // Scoped to this render's own container: RTL binds its queries to
    // document.body, and the colour case mounts five hubs inside one test.
    const { container } = render(
      <CategoryHubPage
        breadcrumbName={category.shortName}
        breadcrumbHref={`/${slug}`}
        title={category.name}
        intro={category.description}
        sections={[
          { title: "All", tools: tools.filter((t) => t.category === slug).slice(0, 2) },
        ]}
      />,
    );
    return within(container).getByText("DOWNLOAD").nextElementSibling!;
  };

  it.each(categories.map((c) => [c.slug, c.download] as const))(
    "%s shows %s",
    (slug, download) => {
      expect(renderHub(slug).textContent).toBe(download);
    },
  );

  /*
     INVERTED on 2026-09-05, deliberately not moved to another hub.

     Green is the site's "costs you nothing" signal — it is what UPLOAD / NEVER
     uses one row down. This case used to hardcode developer-tools as the one
     hub entitled to it and assert the other four were not. /developer-tools now
     quotes a range, because /qr-code-reader and /extract-archive fetch
     WebAssembly, so there is no hub left to paint green at all.

     "None of the five is green" is a pure negative, and a pure negative passes
     just as well on a render that produced nothing. Three things stop that:

       1. every hub must render the OTHER arm of the same ternary
          (`text-neutral-300`), which can only happen if the element rendered
          and the condition was actually evaluated;
       2. every hub's stat must still read back its category's own string;
       3. the green arm must still exist in the component source — the case
          below. It is a reserve, not dead code: if a category ever returns to
          costing nothing, this assertion is the one that has to be inverted
          again, and (3) is what leaves something to invert.
  */
  it("has no hub left to spend the success colour on", () => {
    expect(categories.some((c) => c.download === "0 KB")).toBe(false);
    for (const { slug, download } of categories) {
      const stat = renderHub(slug);
      expect(stat.textContent, `${slug} lost its DOWNLOAD figure`).toBe(download);
      expect(
        stat.className,
        `${slug} rendered neither arm of the colour ternary — did the strip render at all?`,
      ).toContain("text-neutral-300");
      expect(stat.className, `${slug} paints a real download green`).not.toContain("text-success");
    }
  });

  it("keeps the success colour reachable for a hub that goes back to 0 KB", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/layout/CategoryHubPage.tsx"),
      "utf8",
    );
    expect(source.length).toBeGreaterThan(1000);
    expect(
      source,
      "the 0 KB → text-success branch was deleted, which would leave the case above passing for the wrong reason",
    ).toContain('"0 KB" ? "text-success"');
  });
});

describe("the I HAVE A… chips", () => {
  /*
     This used to skip /developer-tools entirely, on the premise that "the
     developer tools read pasted text and declare no acceptFormats, so their
     chips name kinds of text, not extensions a picker could be checked
     against". That premise expired. The hub accepts .yaml, .har, .xlsx, .csv,
     .log, .sh, .md, .txt and the subtitle extensions after Wave 4's developer
     fills, and .zip, .tar, .gz, .bz2, .xz, .7z, .rar, .svg, .docx and five
     image formats after the archive batch — twenty-odd real DropZone formats
     under a heading that says "I HAVE A…". Skipping the hub meant a wrong chip
     there was the one wrong chip on the site nothing would catch.

     So the exclusion is now per-CHIP rather than per-CATEGORY, and it is four
     names long. Each of these four is a real tool reached by pasting rather
     than by dropping, so there is no `acceptFormats` to check them against —
     but they are still true things to say you have.
  */
  const PASTED_TEXT_CHIPS: Record<string, string> = {
    XML: "/xml-formatter takes pasted XML",
    SQL: "/sql-formatter takes pasted SQL",
    HTML: "/html-to-markdown takes pasted HTML",
    JWT: "/jwt-decoder takes a pasted token",
  };

  it.each(categories.map((c) => [c.slug, c] as const))(
    "every %s chip is a format that category's DropZones accept",
    (slug, category) => {
      const exts = acceptedExts(slug);
      expect(exts.size, `${slug} has no file-taking tools`).toBeGreaterThan(0);
      for (const chip of category.formats) {
        if (PASTED_TEXT_CHIPS[chip]) continue;
        const candidates = ALIASES[chip] ?? [chip.toLowerCase()];
        expect(
          candidates.some((c) => exts.has(c)),
          `${slug} offers "I have a ${chip}" but no tool there accepts .${candidates[0]}`,
        ).toBe(true);
      }
    },
  );

  it("puts real chips through the check on every hub", () => {
    // The paired positive for that `continue`. If PASTED_TEXT_CHIPS ever grew
    // to cover a whole category, the case above would pass while asserting
    // nothing about it — the same failure mode the old blanket exclusion had,
    // just spelled differently.
    for (const category of categories) {
      const checked = category.formats.filter((f) => !PASTED_TEXT_CHIPS[f]);
      expect(
        checked.length,
        `${category.slug} exempts every chip it has, so its strip is unchecked`,
      ).toBeGreaterThan(0);
    }
  });

  it("exempts nothing a DropZone has since started accepting", () => {
    // An exemption is a claim that no picker in the category could check the
    // chip. A tool that begins accepting .xml or .html makes that false, and
    // the entry has to go so the chip is gated like every other one.
    const dev = acceptedExts("developer-tools");
    expect(dev.size, "no developer tool accepts files — read the registry").toBeGreaterThan(0);
    for (const [chip, why] of Object.entries(PASTED_TEXT_CHIPS)) {
      expect(
        dev.has(chip.toLowerCase()),
        `"${chip}" is exempt because ${why}, but a developer tool now accepts .${chip.toLowerCase()} — delete the exemption`,
      ).toBe(false);
    }
  });
});

/*
   THE HOMEPAGE CARD NO LONGER KEEPS ITS OWN COPY.

   `WORKSHOPS` in src/app/page.tsx used to carry an `engine` string per card
   beside the one in this file, kept in step by two comments asking the next
   editor to remember. It had already failed: the audio card rendered
   "WEB AUDIO" while /audio-tools rendered "WEB AUDIO · LAMEJS · FFMPEG" and
   "DOWNLOAD 0–31 MB" — the homepage understating a 31 MB fetch and a 254 KB one
   on the same click — and the developer card's own comment admitted "nothing
   but these two comments enforces it" while adding a third pair to the habit.

   The field is gone and the card renders `cat.engine`. These cases are what
   stops it coming back, because a copy that cannot exist cannot drift.
*/
describe("the homepage workshop card reads the category, not a copy of it", () => {
  it("renders cat.engine", () => {
    expect(homepage).toContain("WORKSHOPS");
    expect(
      homepage,
      "the card stopped reading the category object — the hand-sync is back",
    ).toContain("{cat.engine}");
  });

  it("keeps no second copy of any category's engine string", () => {
    for (const c of categories) {
      expect(
        homepage,
        `src/app/page.tsx hardcodes ${c.slug}'s engine string again; render cat.engine instead`,
      ).not.toContain(`engine: "${c.engine}"`);
    }
  });

  it("declares no engine field on WORKSHOPS at all", () => {
    // Stronger than the case above, which only catches a copy that currently
    // MATCHES. The audio card's bug was a copy that did not.
    const literal = homepage.slice(
      homepage.indexOf("const WORKSHOPS"),
      homepage.indexOf("const ENGINES"),
    );
    expect(literal.length, "WORKSHOPS or ENGINES moved — this slice reads nothing").toBeGreaterThan(
      500,
    );
    expect(literal, "WORKSHOPS carries an engine field again").not.toMatch(/^\s*engine:/m);
  });
});

/*
   THE CEILING MAY NOT UNDERSHOOT.

   `Category.download`'s high end is documented as "the heaviest engine any tool
   in the category can pull". Quoting the homepage ENGINES row satisfies that
   only while no BUNDLED library out-weighs the category's heaviest SERVED one —
   and bundled libraries are exactly what the site had stopped counting:
   /barcode-generator pulls about 925 KB of bwip-js and /docx-to-markdown about
   478 KB of mammoth, neither of which had a row or a mention anywhere.

   Today the developer hub's 1.0 MB zxing ceiling clears bwip-js's 925 KB by
   about 100 KB. That is close enough that the next encoder added to the site
   could quietly turn the hub's ceiling into a floor, so it is asserted rather
   than assumed.
*/
describe("no bundled library out-weighs its hub's stated ceiling", () => {
  const bundled = [
    ...homepage.matchAll(/\{\s*name:\s*"([^"]+)",\s*size:\s*"([^"]+)",\s*where:\s*"([^"]+)"\s*\}/g),
  ].map(([, name, size, where]) => ({ name, size, where }));

  /** "925 KB" / "1.0 MB" / "31 MB" on the table's own binary ruler. */
  const toBytes = (figure: string): number => {
    const [, n, unit] = figure.match(/^([\d.]+)\s*(KB|MB)$/) ?? [];
    expect(n, `cannot read a size out of "${figure}"`).toBeDefined();
    return Number(n) * (unit === "MB" ? 1024 * 1024 : 1024);
  };

  it("reads the BUNDLED list", () => {
    // The positive control: an empty list makes every comparison below vacuous.
    expect(bundled.length).toBeGreaterThanOrEqual(4);
    expect(bundled.map((b) => b.name)).toContain("bwip-js");
  });

  it.each(bundled.map((b) => [b.name, b] as const))("%s fits under its hub", (name, b) => {
    // `where` is one or more routes; every tool named has to be real, and they
    // all have to sit in the category whose ceiling is being checked.
    const slugs = [...b.where.matchAll(/\/([a-z0-9-]+)/g)].map(([, slug]) => slug);
    expect(slugs.length, `${name} names no route in "${b.where}"`).toBeGreaterThan(0);

    for (const slug of slugs) {
      const tool = tools.find((t) => t.slug === slug);
      expect(tool, `${name} is disclosed on /${slug}, which is not a tool`).toBeDefined();
      const category = categories.find((c) => c.slug === tool!.category)!;
      const ceiling = toBytes(category.download.split("–")[1]);
      expect(
        toBytes(b.size),
        `/${slug} pulls about ${b.size} of ${name}, over ${category.slug}'s stated ceiling of ${category.download}`,
      ).toBeLessThanOrEqual(ceiling);
    }
  });
});

describe("Category.engine names every engine the category runs", () => {
  it("credits lamejs and FFmpeg on the audio hub", () => {
    const audio = categories.find((c) => c.slug === "audio-tools")!;
    // Both are reachable from every audio tool: lamejs writes the MP3s, and
    // `decodeViaFFmpeg` opens what `decodeAudioData` will not.
    expect(audio.engine).toContain("LAMEJS");
    expect(audio.engine).toContain("FFMPEG");
    expect(audio.engine).toContain("WEB AUDIO");
  });
});

/*
  The workspace ENGINE label, and the width that constrains it.

  MEASURED in Chromium against the real page (`/m4a-to-mp3`, 1440×900): the
  ENGINE value in ToolPageLayout's spec tile is `min-w-0 truncate` with a
  clientWidth of 170 px, and font-mono at 11px (IBM Plex Mono) advances
  6.6 px per character. 25 characters measure 165 px and fit; 26 measure 172
  and render ellipsised. That is why the three-engine audio rows use a tight
  "·" — "WEB AUDIO · LAMEJS · FFMPEG" is 27 characters and would ship the
  claim with its last engine cut off.
*/
const ENGINE_MAX_CHARS = 25;

describe("workspace ENGINE labels", () => {
  it.each(workspaceTools.map((t) => [t.slug, t] as const))(
    "%s fits the spec tile",
    (_slug, tool) => {
      expect(tool.engine.length).toBeLessThanOrEqual(ENGINE_MAX_CHARS);
    },
  );

  // Every one of these decodes through `decodeAudioFile`, which dynamically
  // imports ffmpeg-loader and transcodes to WAV when the browser's decoder
  // refuses the container — a ~31 MB fetch that none of the rows named.
  const FFMPEG_FALLBACK_AUDIO = [
    "mp3-to-wav",
    "wav-to-mp3",
    "m4a-to-mp3",
    "audio-trimmer",
    "merge-audio",
  ];

  it.each(FFMPEG_FALLBACK_AUDIO)("%s names the FFmpeg fallback", (slug) => {
    expect(getWorkspaceTool(slug)!.engine).toContain("FFMPEG");
  });

  it.each(FFMPEG_FALLBACK_AUDIO)("%s still names the browser decoder", (slug) => {
    // The paired positive: adding FFMPEG must not have displaced Web Audio,
    // which is what actually decodes in Chrome and Safari.
    expect(getWorkspaceTool(slug)!.engine).toContain("WEB AUDIO");
  });
});
