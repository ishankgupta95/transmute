import { describe, expect, it } from "vitest";
import { builtinPlugins } from "svgo/browser";
import {
  AUTO_OPTIMIZE_LIMIT,
  CUSTOM_PRESET,
  DEFAULT_PRECISION,
  DEFAULT_SETTINGS,
  OPT_IN_GROUP_LABEL,
  OPT_IN_LABELS,
  RISKY_DEFAULT_PLUGINS,
  SVG_PRESETS,
  SvgOptimizeError,
  buildConfig,
  decodeSvgBytes,
  encodingNote,
  firstElementName,
  indentSvg,
  inspectSvg,
  lossNotes,
  optimizeSvg,
  optimizedFileName,
  payloadNotes,
  presetIdFor,
  settingsKey,
  utf8Bytes,
  type RiskyPluginId,
  type SvgOptimizeSettings,
} from "@/lib/tools/svg-optimize";

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

/** Collapse the indentation these literals are written with. */
const svg = (strings: TemplateStringsArray, ...values: unknown[]): string =>
  String.raw({ raw: strings }, ...values).replace(/\n\s*/g, "");

const settings = (over: Partial<SvgOptimizeSettings> = {}): SvgOptimizeSettings => ({
  ...DEFAULT_SETTINGS,
  ...over,
});

const without = (...ids: RiskyPluginId[]) => settings({ disabled: ids });

const PLAIN = svg`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <!-- a comment nobody needs -->
  <rect x="10" y="10" width="80" height="80" fill="#ff0000"/>
</svg>`;

const WITH_IDS = svg`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <defs><linearGradient id="myBrandGradient"><stop offset="0" stop-color="#f00"/></linearGradient></defs>
  <rect id="hookedByJs" width="10" height="10" fill="url(#myBrandGradient)"/>
</svg>`;

const LABELLED = svg`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" role="img" aria-labelledby="t1">
  <title id="t1">Company logo</title><rect width="4" height="4"/>
</svg>`;

const LINKED = svg`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <a href="https://example.com"><rect width="4" height="4"/></a>
</svg>`;

const STYLED = svg`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <style>.a{fill:red}.a:hover{fill:blue}@media(prefers-color-scheme:dark){.a{fill:#fff}}</style>
  <rect class="a" width="4" height="4"/>
</svg>`;

/**
 * The stylesheet Illustrator and Figma write when the drawing has no CSS: an
 * element with nothing in it. `removeEmptyContainers` deletes it regardless of
 * `inlineStyles`, so no rule was ever inlined out of it.
 */
const EMPTY_STYLE = svg`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <style></style><rect width="4" height="4"/>
</svg>`;

/** The same case one step along: everything but a comment already stripped. */
const COMMENT_ONLY_STYLE = svg`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <style>/* generated, do not edit */</style><rect width="4" height="4"/>
</svg>`;

const SCRIPTED = svg`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <script>fetch("//elsewhere")</script>
  <rect width="4" height="4" onclick="go()" onload="boot()"/>
</svg>`;

/** A 1×1 transparent PNG, which is what most "SVGs" from a screenshot tool are. */
const PNG_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const RASTER = svg`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <image width="10" height="10" href="${PNG_DATA_URI}"/>
  <rect width="4" height="4"/>
</svg>`;

const DOCTYPED = svg`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [<!ENTITY brand "ACME Corporation">]>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>&brand;</title><rect width="4" height="4"/></svg>`;

const PRECISE = svg`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">
  <path d="M100.12345 200.98765 L 300.55555 400.11111 L 12.3456789 999.87654 Z"/>
</svg>`;

const HIDDEN = svg`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <rect id="tooltip" style="display:none" width="4" height="4"/><rect width="2" height="2"/>
</svg>`;

/**
 * An entity used often enough that expanding it costs more than the
 * declaration saved. This is the case that makes the tool report a NEGATIVE
 * saving, so it is a fixture rather than a hypothetical.
 */
const ENTITY_HEAVY = (() => {
  const long = "The Quick Brown Fox Jumped Over The Lazy Dog Again And Again";
  const uses = Array.from({ length: 8 }, (_, i) => `<text y="${i}">&b;</text>`).join("");
  return `<!DOCTYPE svg [<!ENTITY b "${long}">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${uses}</svg>`;
})();

/**
 * The other half of the entity case: the same DOCTYPE, on an editor export
 * whose entity is one short colour and which arrives carrying metadata and a
 * generator comment the run takes out. This one comes out SMALLER, which is why
 * the note derives its direction instead of asserting one.
 */
const ENTITY_LIGHT = (() => {
  const rects = Array.from(
    { length: 40 },
    (_, i) => `<rect x="${i}" y="${i}" width="5" height="5" fill="&c;"/>`,
  ).join("\n  ");
  const metadata =
    '<metadata><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><cc:Work xmlns:cc="http://creativecommons.org/ns#"><dc:format xmlns:dc="http://purl.org/dc/elements/1.1/">image/svg+xml</dc:format></cc:Work></rdf:RDF></metadata>';
  const comment =
    "<!-- Generated by an editor that writes a great deal of commentary into every file it saves, none of which any renderer reads -->";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE svg [<!ENTITY c "#ff0000">]>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  ${metadata}\n  ${comment}\n  ${rects}\n</svg>`;
})();

/** An Inkscape page export: real units, no viewBox. `removeDimensions` no-ops. */
const UNIT_SIZED = svg`<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm">
  <rect width="4" height="4"/>
</svg>`;

/* ── The config the settings actually produce ─────────────────────────────── */

describe("buildConfig", () => {
  it("names only plugins that really exist in preset-default", () => {
    /*
      SVGO does not fail on a bad override key — it prints "You are trying to
      configure X which is not part of preset-default" to the console and
      carries on with the plugin still enabled. So a typo in `RiskyPluginId`
      would ship a checkbox that silently does nothing, and only this
      assertion would notice.
    */
    const preset = builtinPlugins.find((p) => p.name === "preset-default");
    const names = new Set((preset?.plugins ?? []).map((p) => p.name));
    expect(names.size).toBeGreaterThan(0);
    for (const plugin of RISKY_DEFAULT_PLUGINS) {
      expect(names.has(plugin.id)).toBe(true);
    }
  });

  it("does not claim removeViewBox or removeDimensions are defaults", () => {
    // The folk warning about SVGO is that it strips your viewBox. In svgo 4
    // neither pass is in preset-default, and the copy on the page says so.
    const preset = builtinPlugins.find((p) => p.name === "preset-default");
    const names = (preset?.plugins ?? []).map((p) => p.name);
    expect(names).not.toContain("removeViewBox");
    expect(names).not.toContain("removeDimensions");
    expect(names).not.toContain("removeScripts");
    expect(names).not.toContain("removeRasterImages");
  });

  it("turns disabled ids into preset overrides and leaves the rest alone", () => {
    const config = buildConfig(without("cleanupIds", "mergePaths"));
    expect(config.plugins).toEqual([
      { name: "preset-default", params: { overrides: { cleanupIds: false, mergePaths: false } } },
    ]);
  });

  it("appends the opt-in passes only when asked", () => {
    expect(buildConfig(DEFAULT_SETTINGS).plugins).toHaveLength(1);
    const all = buildConfig(
      settings({ removeScripts: true, removeEmbeddedImages: true, removeDimensions: true }),
    );
    expect(all.plugins).toHaveLength(4);
    expect(all.plugins?.[1]).toBe("removeScripts");
    /*
      Our own pass, not SVGO's `removeRasterImages`: that one tests
      `attributes['xlink:href']` only, so it walks straight past the SVG 2
      `<image href="data:image/png;…">` every current exporter writes. The
      raster tests below run both spellings.
    */
    expect(all.plugins?.[2]).toMatchObject({ name: "transmute-strip-embedded-images" });
    expect(all.plugins?.[3]).toBe("removeDimensions");
  });

  it("clamps precision into the range the slider offers", () => {
    expect(buildConfig(settings({ precision: -4 })).floatPrecision).toBe(0);
    expect(buildConfig(settings({ precision: 99 })).floatPrecision).toBe(8);
    expect(buildConfig(settings({ precision: Number.NaN })).floatPrecision).toBe(DEFAULT_PRECISION);
  });
});

/* ── Refusals ─────────────────────────────────────────────────────────────── */

describe("firstElementName", () => {
  it("finds the root past a declaration, a DOCTYPE with an internal subset and a comment", () => {
    expect(firstElementName(DOCTYPED)).toBe("svg");
    expect(firstElementName(PLAIN)).toBe("svg");
    expect(firstElementName("﻿  <svg/>")).toBe("svg");
    expect(firstElementName("<!-- > not the end --><svg/>")).toBe("svg");
  });

  it("reports the wrong root rather than pretending", () => {
    expect(firstElementName("<html><body><p>hi</p></body></html>")).toBe("html");
    expect(firstElementName('<?xml version="1.0"?><rss version="2.0"/>')).toBe("rss");
  });

  it("is null when there is no start tag to find", () => {
    expect(firstElementName("")).toBeNull();
    expect(firstElementName("hello world")).toBeNull();
    expect(firstElementName("\x89PNG\r\n\x1a\n")).toBeNull();
    expect(firstElementName("<!-- never closed")).toBeNull();
  });
});

describe("optimizeSvg refusals", () => {
  it("refuses an empty file", () => {
    expect(() => optimizeSvg("   \n  ")).toThrow(SvgOptimizeError);
    try {
      optimizeSvg("");
    } catch (err) {
      expect((err as SvgOptimizeError).kind).toBe("empty");
    }
  });

  it("refuses a file whose first element is not <svg>, and names it", () => {
    /*
      SVGO does not check this itself: given the same HTML it returns
      "<html/>" and reports a ~96% saving. Confirmed below, so the refusal is
      guarding against a measured wrong answer rather than a supposed one.
    */
    const html = "<html><head><title>x</title></head><body><p>hello</p></body></html>";
    let thrown: SvgOptimizeError | null = null;
    try {
      optimizeSvg(html);
    } catch (err) {
      thrown = err as SvgOptimizeError;
    }
    expect(thrown).toBeInstanceOf(SvgOptimizeError);
    expect(thrown?.kind).toBe("not-svg");
    expect(thrown?.message).toContain("<html>");
  });

  it("reports a parse failure with the line and column", () => {
    let thrown: SvgOptimizeError | null = null;
    try {
      optimizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect></svg>');
    } catch (err) {
      thrown = err as SvgOptimizeError;
    }
    expect(thrown?.kind).toBe("parse");
    expect(thrown?.line).toBe(1);
    expect(typeof thrown?.column).toBe("number");
    expect(thrown?.message).toMatch(/line 1, column \d+/);
  });

  it("cannot be used to read a local file through an external entity", () => {
    // sax refuses SYSTEM entities outright rather than resolving them, so an
    // SVG dropped on this page has no way to reach anything.
    let thrown: SvgOptimizeError | null = null;
    try {
      optimizeSvg(
        '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><title>&xxe;</title></svg>',
      );
    } catch (err) {
      thrown = err as SvgOptimizeError;
    }
    expect(thrown?.kind).toBe("parse");
    expect(thrown?.message).toContain("Invalid character entity");
  });
});

/* ── The numbers ──────────────────────────────────────────────────────────── */

describe("optimizeSvg byte reporting", () => {
  it("derives every size from the run, in UTF-8 bytes", () => {
    const result = optimizeSvg(PLAIN);
    expect(result.inputBytes).toBe(utf8Bytes(PLAIN));
    expect(result.outputBytes).toBe(utf8Bytes(result.svg));
    expect(result.savedBytes).toBe(result.inputBytes - result.outputBytes);
    expect(result.savedBytes).toBeGreaterThan(0);
    expect(result.savedPercent).toBeCloseTo((result.savedBytes / result.inputBytes) * 100, 1);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("counts multi-byte characters as the bytes they cost", () => {
    // `String.length` would call this 1 character; the file carries 3 bytes.
    expect(utf8Bytes("→")).toBe(3);
    const withEmDash = '<svg xmlns="http://www.w3.org/2000/svg"><title>a — b</title></svg>';
    expect(optimizeSvg(withEmDash).inputBytes).toBe(withEmDash.length + 2);
  });

  it("reports a NEGATIVE saving when expanding entities makes the file bigger", () => {
    // Entities are expanded in place and the declaration is dropped, so a file
    // that used one to avoid repeating itself comes out longer.
    const result = optimizeSvg(ENTITY_HEAVY);
    expect(result.before.hasEntityDeclarations).toBe(true);
    expect(result.outputBytes).toBeGreaterThan(result.inputBytes);
    expect(result.savedBytes).toBeLessThan(0);
    expect(result.savedPercent).toBeLessThan(0);
    expect(result.svg).not.toContain("&b;");
    expect(result.svg).toContain("The Quick Brown Fox");
  });

  it("drops the DOCTYPE and reports that it was there", () => {
    const result = optimizeSvg(DOCTYPED);
    expect(result.before.hasDoctype).toBe(true);
    expect(result.after.hasDoctype).toBe(false);
    expect(result.svg).not.toContain("DOCTYPE");
    expect(result.svg).toContain("ACME Corporation");
  });
});

/* ── The risky defaults, each measured ────────────────────────────────────── */

describe("cleanupIds", () => {
  it("names every id that no longer exists in the output", () => {
    const result = optimizeSvg(WITH_IDS);
    expect(result.idsDropped).toContain("hookedByJs");
    expect(result.idsDropped).toContain("myBrandGradient");
    expect(result.svg).not.toContain("hookedByJs");
  });

  it("keeps them all when the pass is switched off", () => {
    const result = optimizeSvg(WITH_IDS, without("cleanupIds"));
    expect(result.idsDropped).toEqual([]);
    expect(result.svg).toContain('id="myBrandGradient"');
    expect(result.svg).toContain('id="hookedByJs"');
  });

  it("reports an aria reference it left pointing at nothing", () => {
    const result = optimizeSvg(LABELLED);
    expect(result.svg).toContain('aria-labelledby="t1"');
    expect(result.svg).not.toContain('id="t1"');
    expect(result.ariaRefsBroken).toEqual(["t1"]);
  });

  it("switches itself off when the file carries a <script> or a <style>", () => {
    /*
      SVGO's own safety valve: cleanupIds cannot read a stylesheet or a script
      for what it references, so it does nothing at all rather than guess
      (plugins/cleanupIds.js:159-164). The page says so, so the checkbox is
      not credited with an outcome it did not cause.
    */
    const scripted = WITH_IDS.replace("</svg>", "<script>go()</script></svg>");
    /*
      The stylesheet has to SURVIVE to get there. `.a` is used twice, so
      inlineStyles leaves it alone (onlyMatchedOnce), and the <style> element
      is still standing when cleanupIds runs. A one-use rule is inlined and
      the block deleted well before then, and the ids go as usual — which is
      exactly what the second half of this test pins.
    */
    const styled = WITH_IDS.replace(
      "<defs>",
      '<style>.a{fill:red}.a:hover{fill:blue}</style><rect class="a" width="1" height="1"/><rect class="a" x="2" width="1" height="1"/><defs>',
    );
    for (const source of [scripted, styled]) {
      const result = optimizeSvg(source);
      expect(result.idsDropped).toEqual([]);
      expect(result.svg).toContain('id="hookedByJs"');
    }
    // …and the same file with neither does lose them, so the valve is what
    // made the difference rather than something about the fixture.
    expect(optimizeSvg(WITH_IDS).idsDropped).toContain("hookedByJs");
    // A stylesheet that gets dissolved on the way past is not a valve.
    const dissolved = WITH_IDS.replace("</svg>", "<style>.x{fill:red}</style></svg>");
    expect(optimizeSvg(dissolved).idsDropped).toContain("hookedByJs");
  });

  it("leaves the accessible name intact when the pass is off", () => {
    const result = optimizeSvg(LABELLED, without("cleanupIds"));
    expect(result.ariaRefsBroken).toEqual([]);
    expect(result.svg).toContain('id="t1"');
  });
});

describe("removeUnknownsAndDefaults", () => {
  it("counts the <a href> it removed", () => {
    const result = optimizeSvg(LINKED);
    expect(result.before.linkHrefs).toBe(1);
    expect(result.after.linkHrefs).toBe(0);
    expect(result.linkHrefsDropped).toBe(1);
    expect(result.svg).not.toContain("example.com");
  });

  it("keeps the link, and role, when the pass is off", () => {
    expect(optimizeSvg(LINKED, without("removeUnknownsAndDefaults")).linkHrefsDropped).toBe(0);
    expect(optimizeSvg(LABELLED, without("removeUnknownsAndDefaults")).svg).toContain('role="img"');
    expect(optimizeSvg(LABELLED).svg).not.toContain('role="img"');
  });
});

describe("inlineStyles", () => {
  it("loses the :hover and @media rules with the <style> element", () => {
    const result = optimizeSvg(STYLED);
    expect(result.before.styleElements).toBe(1);
    expect(result.after.styleElements).toBe(0);
    expect(result.styleElementsDropped).toBe(1);
    expect(result.svg).not.toContain("hover");
    expect(result.svg).not.toContain("prefers-color-scheme");
    expect(result.svg).toContain("fill:red");
  });

  it("keeps the whole stylesheet when the pass is off", () => {
    const result = optimizeSvg(STYLED, without("inlineStyles"));
    expect(result.styleElementsDropped).toBe(0);
    expect(result.svg).toContain(":hover");
    expect(result.svg).toContain("prefers-color-scheme");
  });

  /*
    The same wrong-cause-plus-inert-remedy shape the id notes had: an empty or
    comment-only <style> is deleted by removeEmptyContainers, which is not on
    the rail, so unticking INLINE THE STYLESHEET does not bring it back — and
    there were no rules to write onto anything in the first place.
  */
  it("does not blame inlining for an empty <style> it never touched", () => {
    for (const source of [EMPTY_STYLE, COMMENT_ONLY_STYLE]) {
      const on = optimizeSvg(source, DEFAULT_SETTINGS);
      const offToo = optimizeSvg(source, without("inlineStyles"));

      // The element goes either way, so inlining cannot be what removed it.
      expect(on.styleElementsDropped).toBe(1);
      expect(offToo.styleElementsDropped).toBe(1);
      expect(offToo.svg).not.toContain("<style");
      // …and it carried no rules for the inlining explanation to be about.
      expect(on.before.styleElements).toBe(1);
      expect(on.before.styleElementsWithRules).toBe(0);

      expect(
        lossNotes(on, DEFAULT_SETTINGS).find((n) => n.includes("<style> block is gone")),
      ).toBeUndefined();
    }
  });

  it("still fires on a stylesheet that really did have rules inlined", () => {
    const result = optimizeSvg(STYLED);
    expect(result.before.styleElementsWithRules).toBe(1);
    expect(result.after.styleElementsWithRules).toBe(0);
    const note = lossNotes(result, DEFAULT_SETTINGS).find((n) =>
      n.includes("<style> block is gone"),
    );
    expect(note).toContain("Untick INLINE THE STYLESHEET to keep the block whole.");
  });
});

describe("the other risky defaults", () => {
  it("collapses a group and takes its id with it", () => {
    const source = svg`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
      <g id="layer1" class="animated"><path d="M0 0h4v4H0z"/></g></svg>`;
    expect(optimizeSvg(source).svg).not.toContain("<g");
    expect(optimizeSvg(source).idsDropped).toContain("layer1");
    expect(optimizeSvg(source, without("collapseGroups")).svg).toContain("<g");
    expect(optimizeSvg(source, without("collapseGroups", "cleanupIds")).svg).toContain(
      'id="layer1"',
    );
  });

  it("rewrites shapes as paths", () => {
    const source = svg`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
      <rect class="bar" width="4" height="4"/></svg>`;
    expect(optimizeSvg(source).svg).toContain("<path");
    expect(optimizeSvg(source, without("convertShapeToPath")).svg).toContain("<rect");
  });

  it("merges sibling paths into one element", () => {
    const source = svg`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
      <path fill="none" stroke="#000" d="M0 0L5 5"/><path fill="none" stroke="#000" d="M10 10L15 15"/></svg>`;
    const merged = optimizeSvg(source);
    expect(merged.after.elements).toBe(2); // <svg> + one <path>
    expect(optimizeSvg(source, without("mergePaths")).after.elements).toBe(3);
  });

  it("removes a display:none element", () => {
    expect(optimizeSvg(HIDDEN).svg).not.toContain("tooltip");
    expect(optimizeSvg(HIDDEN, without("removeHiddenElems", "cleanupIds")).svg).toContain(
      "tooltip",
    );
  });
});

/* ── Scripts and raster payloads ──────────────────────────────────────────── */

describe("scripts", () => {
  it("carries scripts and handlers straight through by default, and says so", () => {
    const result = optimizeSvg(SCRIPTED);
    expect(result.before.scripts).toBe(1);
    expect(result.before.eventAttributes).toBe(2);
    expect(result.after.scripts).toBe(1);
    expect(result.after.eventAttributes).toBe(2);
    expect(result.scriptsRemoved).toBe(0);
    expect(result.svg).toContain("fetch(");
    expect(result.svg).toContain("onclick");
  });

  it("removes both when asked, and counts what it removed", () => {
    const result = optimizeSvg(SCRIPTED, settings({ removeScripts: true }));
    expect(result.scriptsRemoved).toBe(1);
    expect(result.eventAttributesRemoved).toBe(2);
    expect(result.after.scripts).toBe(0);
    expect(result.svg).not.toContain("fetch(");
    expect(result.svg).not.toContain("onclick");
  });
});

describe("embedded raster images", () => {
  it("measures the data URI weight rather than guessing at it", () => {
    const result = optimizeSvg(RASTER);
    expect(result.before.embeddedImages).toBe(1);
    expect(result.before.linkedImages).toBe(0);
    expect(result.before.embeddedImageBytes).toBe(PNG_DATA_URI.length);
    // The bytes survive the run untouched: no SVG pass can compress a PNG.
    expect(result.svg).toContain(PNG_DATA_URI);
    expect(result.embeddedImagesRemoved).toBe(0);
  });

  /*
    A screenshot-tool "SVG": one big PNG in a bare wrapper. The share rounds to
    100%, and the note used to finish "it saves out of the other 0%" over a file
    that still had drawable bytes in it. The remainder is a count now, so it
    cannot round itself into a false statement.
  */
  it("states the un-shrinkable remainder in bytes, not a percentage that rounds to zero", () => {
    const huge = `data:image/png;base64,${"A".repeat(40_000)}`;
    const source = svg`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
      <image width="10" height="10" href="${huge}"/></svg>`;
    const result = optimizeSvg(source);
    const rest = result.outputBytes - result.after.embeddedImageBytes;

    expect(Math.round((result.after.embeddedImageBytes / result.outputBytes) * 100)).toBe(100);
    expect(rest).toBeGreaterThan(0);

    const note = payloadNotes(result, DEFAULT_SETTINGS).find((n) => n.includes("embedded raster"));
    expect(note).toContain(`it saves out of the other ${rest.toLocaleString()} bytes`);
    expect(note).not.toContain("the other 0%");
  });

  it("deletes the picture when asked, and counts it", () => {
    const result = optimizeSvg(RASTER, settings({ removeEmbeddedImages: true }));
    expect(result.embeddedImagesRemoved).toBe(1);
    expect(result.svg).not.toContain("data:image/png");
    expect(result.outputBytes).toBeLessThan(result.inputBytes / 2);
  });

  it("strips both the SVG 2 href and the legacy xlink:href spellings", () => {
    /*
      This is the whole reason the page does not use SVGO's own
      `removeRasterImages`: that plugin reads `attributes['xlink:href']` and
      nothing else, so the first of these two would come back untouched from a
      control that had promised to strip it.
    */
    const legacy = svg`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">
      <image width="10" height="10" xlink:href="${PNG_DATA_URI}"/><rect width="4" height="4"/></svg>`;
    for (const source of [RASTER, legacy]) {
      const result = optimizeSvg(source, settings({ removeEmbeddedImages: true }));
      expect(result.embeddedImagesRemoved).toBe(1);
      expect(result.after.embeddedImages).toBe(0);
    }
  });

  it("leaves a linked image alone, because deleting it would save nothing", () => {
    const linked = svg`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
      <image width="10" height="10" href="photo.png"/></svg>`;
    const result = optimizeSvg(linked, settings({ removeEmbeddedImages: true }));
    expect(result.after.linkedImages).toBe(1);
    expect(result.svg).toContain("photo.png");
  });

  it("tells a linked image apart from an embedded one", () => {
    const linked = svg`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
      <image width="10" height="10" href="photo.png"/></svg>`;
    const facts = inspectSvg(linked);
    expect(facts.linkedImages).toBe(1);
    expect(facts.embeddedImages).toBe(0);
    expect(facts.embeddedImageBytes).toBe(0);
  });
});

/* ── Precision and dimensions ─────────────────────────────────────────────── */

describe("precision", () => {
  it("rounds coordinates to the requested number of decimals", () => {
    expect(optimizeSvg(PRECISE, settings({ precision: 1 })).svg).toContain("100.1");
    expect(optimizeSvg(PRECISE, settings({ precision: 3 })).svg).toContain("100.123");
    expect(optimizeSvg(PRECISE, settings({ precision: 5 })).svg).toContain("100.12345");
  });

  it("trades bytes for accuracy monotonically", () => {
    const bytesAt = (precision: number) => optimizeSvg(PRECISE, settings({ precision })).outputBytes;
    expect(bytesAt(0)).toBeLessThan(bytesAt(3));
    expect(bytesAt(3)).toBeLessThan(bytesAt(6));
  });
});

describe("removeDimensions", () => {
  it("is off by default, so width, height and viewBox all survive", () => {
    const source = svg`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50">
      <rect width="4" height="4"/></svg>`;
    const result = optimizeSvg(source);
    expect(result.viewBoxLost).toBe(false);
    expect(result.dimensionsLost).toBe(false);
    expect(result.svg).toContain('width="100"');
    expect(result.svg).toContain("viewBox");
  });

  it("writes a viewBox from the dimensions before dropping them", () => {
    const noViewBox = svg`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50">
      <rect width="4" height="4"/></svg>`;
    const result = optimizeSvg(noViewBox, settings({ removeDimensions: true }));
    expect(result.before.hasViewBox).toBe(false);
    expect(result.after.hasViewBox).toBe(true);
    expect(result.dimensionsLost).toBe(true);
    expect(result.viewBoxLost).toBe(false);
    expect(result.svg).toContain('viewBox="0 0 100 50"');
  });
});

/* ── Presets, naming, decoding, the diff view ─────────────────────────────── */

describe("presets", () => {
  it("switches off every risky pass in Safe and none in SVGO default", () => {
    const safe = SVG_PRESETS.find((p) => p.id === "safe");
    expect(safe?.settings.disabled).toHaveLength(RISKY_DEFAULT_PLUGINS.length);
    expect(SVG_PRESETS.find((p) => p.id === "default")?.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps Safe honestly smaller-saving than the default preset", () => {
    const safe = SVG_PRESETS.find((p) => p.id === "safe")!.settings;
    expect(optimizeSvg(WITH_IDS, safe).outputBytes).toBeGreaterThan(
      optimizeSvg(WITH_IDS).outputBytes,
    );
  });

  it("round-trips a preset through presetIdFor, and calls a hand-edit custom", () => {
    for (const preset of SVG_PRESETS) {
      expect(presetIdFor(preset.settings)).toBe(preset.id);
    }
    expect(presetIdFor(settings({ precision: 7 }))).toBe(CUSTOM_PRESET);
    expect(settingsKey(without("cleanupIds", "mergePaths"))).toBe(
      settingsKey(without("mergePaths", "cleanupIds")),
    );
  });

  it("keeps the auto-run ceiling where the measurement put it", () => {
    expect(AUTO_OPTIMIZE_LIMIT).toBe(256 * 1024);
  });
});

describe("optimizedFileName", () => {
  it("inserts .min before the extension", () => {
    expect(optimizedFileName("logo.svg")).toBe("logo.min.svg");
    expect(optimizedFileName("Icon Set v2.SVG")).toBe("Icon Set v2.min.svg");
    expect(optimizedFileName("noextension")).toBe("noextension.min.svg");
    expect(optimizedFileName(".hidden")).toBe(".hidden.min.svg");
    expect(optimizedFileName("  ")).toBe("image.min.svg");
  });
});

describe("decodeSvgBytes", () => {
  const bytes = (...values: number[]) => new Uint8Array(values);

  it("strips a UTF-8 byte-order mark and reports the three bytes", () => {
    const decoded = decodeSvgBytes(bytes(0xef, 0xbb, 0xbf, 0x3c, 0x73, 0x76, 0x67, 0x2f, 0x3e));
    expect(decoded.text).toBe("<svg/>");
    expect(decoded.encoding).toBe("utf-8");
    expect(decoded.bomBytes).toBe(3);
  });

  it("reads a UTF-16 file, which is legal XML and halves on the way out", () => {
    const source = "<svg/>";
    const utf16 = new Uint8Array(2 + source.length * 2);
    utf16[0] = 0xff;
    utf16[1] = 0xfe;
    for (let i = 0; i < source.length; i++) utf16[2 + i * 2] = source.charCodeAt(i);
    const decoded = decodeSvgBytes(utf16);
    expect(decoded.text).toBe(source);
    expect(decoded.encoding).toBe("utf-16le");
    expect(utf8Bytes(decoded.text) * 2).toBeLessThan(utf16.length + 2);
  });

  it("assumes UTF-8 with no mark", () => {
    const decoded = decodeSvgBytes(new TextEncoder().encode("<svg/>"));
    expect(decoded).toEqual({ text: "<svg/>", encoding: "utf-8", bomBytes: 0 });
  });
});

describe("indentSvg", () => {
  it("puts each element on its own line without optimising anything", () => {
    const indented = indentSvg(PLAIN);
    expect(indented.split("\n").length).toBeGreaterThan(2);
    // `plugins: []` means no passes ran: the comment and the <rect> survive.
    expect(indented).toContain("<rect");
    expect(indented).toContain("a comment nobody needs");
  });

  it("hands back the source unchanged rather than throwing on garbage", () => {
    expect(indentSvg("not xml at all")).toBe("not xml at all");
  });
});

describe("inspectSvg", () => {
  it("reads the file without changing it", () => {
    const facts = inspectSvg(SCRIPTED);
    expect(facts.scripts).toBe(1);
    expect(facts.eventAttributes).toBe(2);
    expect(facts.elements).toBe(3);
  });

  it("does not mistake an attribute merely starting with 'on' for a handler", () => {
    const source = svg`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
      <stop offset="0.5" stop-color="#000"/></svg>`;
    expect(inspectSvg(source).eventAttributes).toBe(0);
  });
});

/* ── The sentences the page prints ────────────────────────────────────────── */

/*
  `payloadNotes`, `lossNotes` and `encodingNote` used to live inside
  SvgOptimizerUI, where jsdom cannot reach them — the canvas needs a real
  browser — so no test could ever run them and four of the sentences below were
  measurably false against the very run they were printed over. They are pure
  functions of a result now, and every claim they make is driven here with the
  same fixtures the optimiser is driven with.
*/

/** The controls that actually exist in the rail, in the case the copy uses. */
const CONTROL_NAMES = new Set<string>([
  OPT_IN_GROUP_LABEL,
  ...Object.values(OPT_IN_LABELS).map((label) => label.toUpperCase()),
  ...RISKY_DEFAULT_PLUGINS.map((plugin) => plugin.label.toUpperCase()),
]);

/** Multi-word ALL-CAPS runs — how this page names a control the reader must find. */
const CAPS_PHRASE = /\b[A-Z]{2,}(?: [A-Z]{2,})+\b/g;

/** Every note a settings/source pair produces, as one array. */
const notesFor = (source: string, over: Partial<SvgOptimizeSettings> = {}): string[] => {
  const config = settings(over);
  const result = optimizeSvg(source, config);
  return [...payloadNotes(result, config), ...lossNotes(result, config)];
};

describe("the notes name controls that exist", () => {
  it("tells the reader to tick the checkbox that is actually on the page", () => {
    const notes = notesFor(SCRIPTED);
    const note = notes.find((n) => n.includes("still in the output"));
    expect(note).toBeDefined();
    // The label the component renders, and the group it sits in.
    expect(note).toContain("tick SCRIPTS AND HANDLERS under ALSO REMOVE");
    // The name no control has ever carried.
    expect(note).not.toContain("REMOVE SCRIPTS AND HANDLERS");
  });

  it("never puts a control name in a note that the rail does not render", () => {
    const everyNote = [
      ...notesFor(SCRIPTED),
      ...notesFor(SCRIPTED, { removeScripts: true }),
      ...notesFor(WITH_IDS),
      ...notesFor(WITH_IDS, { disabled: ["cleanupIds"] }),
      ...notesFor(HIDDEN, { disabled: ["cleanupIds"] }),
      ...notesFor(LABELLED),
      ...notesFor(LINKED),
      ...notesFor(STYLED),
      ...notesFor(RASTER),
      ...notesFor(ENTITY_HEAVY),
      ...notesFor(UNIT_SIZED, { removeDimensions: true }),
      ...notesFor(PLAIN, { removeDimensions: true }),
    ];
    expect(everyNote.length).toBeGreaterThan(8);
    const named = new Set(everyNote.flatMap((note) => note.match(CAPS_PHRASE) ?? []));
    expect(named.size).toBeGreaterThan(0);
    for (const phrase of named) expect(CONTROL_NAMES).toContain(phrase);
  });
});

describe("the encoding note", () => {
  /** `source` written as UTF-16LE with a byte-order mark, the way Inkscape can. */
  const asUtf16le = (source: string): Uint8Array => {
    const out = new Uint8Array(2 + source.length * 2);
    out[0] = 0xff;
    out[1] = 0xfe;
    for (let i = 0; i < source.length; i++) {
      out[2 + i * 2] = source.charCodeAt(i) & 0xff;
      out[3 + i * 2] = source.charCodeAt(i) >> 8;
    }
    return out;
  };

  it("does not credit the saving with a UTF-16 conversion that is not in it", () => {
    const onDisk = asUtf16le(PLAIN);
    const decoded = decodeSvgBytes(onDisk);
    const result = optimizeSvg(decoded.text);

    /*
      The measurement that makes the old sentence false: both sides of the
      saving are UTF-8 counts of the decoded text, so the identical source read
      as plain UTF-8 saves exactly the same number of bytes. None of the
      conversion is in `savedBytes`.
    */
    expect(result.inputBytes).toBe(utf8Bytes(decoded.text));
    expect(result.savedBytes).toBe(optimizeSvg(PLAIN).savedBytes);
    expect(onDisk.length).toBeGreaterThan(result.inputBytes * 1.9);

    const note = encodingNote(decoded, onDisk.length, result.inputBytes);
    expect(note).toContain("not part of the saving");
    expect(note).toContain(`${onDisk.length.toLocaleString()} bytes on disk`);
    expect(note).toContain(`${result.inputBytes.toLocaleString()} going into the run`);
    expect(note).toContain(`${(onDisk.length - result.inputBytes).toLocaleString()} bytes`);
    expect(note).not.toMatch(/half the saving/i);
  });

  it("does not credit the saving with a byte-order mark that is not in it", () => {
    const plain = new TextEncoder().encode(PLAIN);
    const withBom = new Uint8Array(3 + plain.length);
    withBom.set([0xef, 0xbb, 0xbf]);
    withBom.set(plain, 3);
    const decoded = decodeSvgBytes(withBom);
    const result = optimizeSvg(decoded.text);

    expect(decoded.bomBytes).toBe(3);
    expect(result.savedBytes).toBe(optimizeSvg(PLAIN).savedBytes);

    const note = encodingNote(decoded, withBom.length, result.inputBytes);
    expect(note).toContain("not part of the saving");
    expect(note).toContain(`${withBom.length.toLocaleString()} bytes on disk`);
    expect(note).not.toMatch(/of the bytes saved are the mark/i);
  });

  /*
    The direction is derived, not assumed. UTF-16 is usually the bigger of the
    two, but a file whose text is mostly CJK is 2 bytes a character there and 3
    in UTF-8 — so the conversion costs bytes instead of saving them, and the
    sentence has to say so rather than repeating "roughly half the saving".
  */
  it("says which way the conversion went when UTF-16 was the smaller of the two", () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>${"漢字図形説明".repeat(
      40,
    )}</title><rect width="4" height="4"/></svg>`;
    const onDisk = asUtf16le(source);
    const decoded = decodeSvgBytes(onDisk);
    const sourceBytes = utf8Bytes(decoded.text);

    expect(onDisk.length).toBeLessThan(sourceBytes);

    const note = encodingNote(decoded, onDisk.length, sourceBytes);
    expect(note).toContain(
      `worth ${(sourceBytes - onDisk.length).toLocaleString()} bytes AGAINST you`,
    );
    expect(note).toContain("not part of the saving");
  });

  it("says nothing at all about a plain UTF-8 file", () => {
    const bytes = new TextEncoder().encode(PLAIN);
    expect(encodingNote(decodeSvgBytes(bytes), bytes.length, bytes.length)).toBeNull();
  });
});

describe("the XML entity note", () => {
  it("reports the direction this file actually went, not a standing claim", () => {
    // Grows: one long entity referenced eight times.
    const grew = optimizeSvg(ENTITY_HEAVY);
    expect(grew.savedBytes).toBeLessThan(0);
    const grewNote = lossNotes(grew, DEFAULT_SETTINGS).find((n) => n.includes("XML entities"));
    expect(grewNote).toContain(
      `it did not: the output is ${Math.abs(grew.savedBytes).toLocaleString()} bytes larger`,
    );

    // Shrinks: the same DOCTYPE on an editor export, where the entity is one
    // colour and the run has metadata and comments to take out instead.
    const shrank = optimizeSvg(ENTITY_LIGHT);
    expect(shrank.savedBytes).toBeGreaterThan(0);
    expect(shrank.before.hasEntityDeclarations).toBe(true);
    const shrankNote = lossNotes(shrank, DEFAULT_SETTINGS).find((n) => n.includes("XML entities"));
    expect(shrankNote).toContain(
      `it did: the output is ${shrank.savedBytes.toLocaleString()} bytes smaller`,
    );

    // The claim the page used to make over BOTH of those SAVED tiles.
    for (const note of [grewNote, shrankNote]) {
      expect(note).not.toMatch(/longer, not shorter/);
    }
  });
});

describe("the id and accessible-name notes", () => {
  /*
    An icon whose accessible name hangs off a visually-hidden <desc>, plus a
    hidden tooltip layer. removeHiddenElems deletes both elements — and their
    ids go with them — whether or not cleanupIds ever runs.
  */
  const HIDDEN_LABEL = svg`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" role="img" aria-labelledby="lbl">
    <desc id="lbl" style="display:none">Sales chart</desc>
    <rect id="tooltip" style="display:none" width="4" height="4"/>
    <rect width="10" height="10" fill="red"/>
  </svg>`;

  it("blames the pass that is on, not the one the user already unticked", () => {
    const config = settings({ disabled: ["cleanupIds"] });
    const result = optimizeSvg(HIDDEN_LABEL, config);

    // The setup: the remedy the page used to offer is already applied, and the
    // ids went anyway.
    expect(result.idsDropped).toEqual(["lbl", "tooltip"]);
    expect(result.ariaRefsBroken).toEqual(["lbl"]);
    expect(result.after.elements).toBeLessThan(result.before.elements);

    const notes = lossNotes(result, config);
    const idNote = notes.find((n) => n.includes("no longer exist"));
    const ariaNote = notes.find((n) => n.includes("accessible name"));
    expect(idNote).toBeDefined();
    expect(ariaNote).toBeDefined();

    for (const note of [idNote, ariaNote]) {
      // Not the wrong cause, and not a remedy that is already in force.
      expect(note).not.toMatch(/Untick RENAME AND DROP IDS/);
      expect(note).not.toMatch(/Unticking RENAME AND DROP IDS restores it/);
      expect(note).toContain("RENAME AND DROP IDS is already off");
      // The pass that did do it, by the name the rail gives it.
      expect(note).toContain("REMOVE HIDDEN ELEMENTS");
    }
    expect(idNote).toContain("they went with the 2 elements this run deleted");
  });

  it("still names the rename pass, and its remedy, when it is the one that ran", () => {
    const result = optimizeSvg(LABELLED);
    expect(result.ariaRefsBroken).toEqual(["t1"]);
    const notes = lossNotes(result, DEFAULT_SETTINGS);
    for (const note of notes.filter((n) => n.includes("id"))) {
      expect(note).toContain("Untick RENAME AND DROP IDS to keep them.");
      expect(note).not.toContain("already off");
    }
  });

  it("names only the element-deleting passes still switched on", () => {
    const config = settings({ disabled: ["cleanupIds", "removeHiddenElems"] });
    const result = optimizeSvg(HIDDEN_LABEL, config);
    // With the hidden pass off too, nothing removes them and there is no note.
    expect(result.idsDropped).toEqual([]);
    expect(lossNotes(result, config).find((n) => n.includes("no longer exist"))).toBeUndefined();
  });
});

describe("the removeDimensions no-op note", () => {
  it("says so when the pass was asked for and could not run", () => {
    const config = settings({ removeDimensions: true });
    const result = optimizeSvg(UNIT_SIZED, config);

    // The silence this note exists to break: the checkbox is ticked, the
    // attributes are still there, and no other flag on the result says so.
    expect(result.dimensionsLost).toBe(false);
    expect(result.after.hasViewBox).toBe(false);
    expect(result.svg).toContain('width="210mm"');

    const note = lossNotes(result, config).find((n) => n.includes("ROOT WIDTH AND HEIGHT"));
    expect(note).toBeDefined();
    expect(note).toContain('width="210mm" and height="297mm" are not plain numbers');
  });

  it("names only the value that blocked it when the units are mixed", () => {
    /*
      cleanupNumericValues converts 8.5in to 816 because that is shorter and
      leaves 11in alone because it is not, so the file arrives at
      removeDimensions with one plain number and one length. Measured against
      svgo 4.1.0.
    */
    const config = settings({ removeDimensions: true });
    const mixed = svg`<svg xmlns="http://www.w3.org/2000/svg" width="8.5in" height="11in">
      <rect width="4" height="4"/></svg>`;
    const result = optimizeSvg(mixed, config);
    expect(result.after.rootWidth).toBe("816");
    expect(result.after.rootHeight).toBe("11in");
    const note = lossNotes(result, config).find((n) => n.includes("ROOT WIDTH AND HEIGHT"));
    expect(note).toBeDefined();
    expect(note).toContain('height="11in" is not a plain number');
    expect(note).not.toContain('width="816"');
  });

  it("stays quiet when the pass did run", () => {
    const config = settings({ removeDimensions: true });
    const plainNumbers = svg`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50">
      <rect width="4" height="4"/></svg>`;
    const result = optimizeSvg(plainNumbers, config);
    expect(result.dimensionsLost).toBe(true);
    expect(lossNotes(result, config).find((n) => n.includes("ROOT WIDTH AND HEIGHT"))).toBeUndefined();
  });
});
