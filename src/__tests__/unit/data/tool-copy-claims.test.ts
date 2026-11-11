import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getToolBySlug, type Tool } from "@/data/tools";
import { getToolCopy } from "@/data/tool-copy";
import { faqs } from "@/data/faqs";
import { getHowToSteps } from "@/lib/seo/tool-metadata";
import { getWorkspaceTool } from "@/data/workspace";

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


/*
 * THE COPY-CLAIM GATE for the three Phase-3 tools.
 *
 * Registry copy is shipped prose: `description` is the meta tag, `subtitle`
 * and `aboutText` are on the page, the FAQ answers are in the JSON-LD, and the
 * HowTo steps render as visible instructions. Every one of those is a claim
 * about code somebody else owns, and nothing in tsc, lint or the existing
 * registry tests reads a single word of it. The three tools here each have one
 * specific way to lie:
 *
 *   compress-video-to-size — promising a size a bitrate solver can only aim
 *     at, or crediting FFmpeg for an encode WebCodecs performs.
 *   extract-images-from-pdf — describing a verbatim lift over a path that has
 *     started decoding, or selling a page render as an extraction.
 *   subtitle-converter — presenting a stripped ASS file as a conversion, or
 *     staying quiet about encoding while emitting mojibake.
 *
 * So each block below anchors a sentence to the artifact it describes: the
 * preset numbers to the array the UI renders, the "no re-encode" claim to the
 * absence of a decoder in the module, the floor to the constant that enforces
 * it. Drift either half and this goes red.
 *
 * Every negative assertion ("the copy does not say FFmpeg") is paired with a
 * positive one over the same string, because a negative search passes just as
 * happily on an empty read or a typo'd path.
 */

const root = process.cwd();
const readSrc = (rel: string) => readFileSync(resolve(root, rel), "utf8");

/*
  These modules DOCUMENT the very things this file searches for — the header of
  pdf-extract-images.ts spends a paragraph on `createImageBitmap` explaining why
  it must never be called. Searching raw source would match the explanation
  instead of the code, so strip block comments and whole-line `//` comments
  before asking what a module actually does. (Whole-line only: a trailing `//`
  could be inside a string.) The same trick size-claims.test.ts uses.
*/
const codeOnly = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const COMPRESS_VIDEO_UI = readSrc("src/components/tools/CompressVideoUI.tsx");
const EXTRACT_PDF_IMAGES_UI = readSrc("src/components/tools/ExtractPdfImagesUI.tsx");
const SUBTITLE_UI = readSrc("src/components/tools/SubtitleConverterUI.tsx");
const VIDEO_COMPRESS = codeOnly(readSrc("src/lib/tools/video-compress.ts"));
const PDF_EXTRACT_IMAGES = codeOnly(readSrc("src/lib/tools/pdf-extract-images.ts"));
const SUBTITLES = codeOnly(readSrc("src/lib/tools/subtitles.ts"));

/** Every user-facing string a tool ships, as one lowercase haystack. */
function allCopy(tool: Tool): string {
  const own = faqs[tool.slug] ?? [];
  return [
    tool.name,
    tool.description,
    tool.hubLine ?? "",
    tool.h1,
    tool.subtitle,
    copyOf(tool.slug).aboutText,
    copyOf(tool.slug).titleTag ?? "",
    ...own.flatMap((f) => [f.question, f.answer]),
    ...getHowToSteps(tool.toolType),
  ]
    .join("\n")
    .toLowerCase();
}

const tool = (slug: string): Tool => {
  const t = getToolBySlug(slug);
  if (!t) throw new Error(`${slug} is not in the registry`);
  return t;
};

describe("the sources these claims are checked against are readable", () => {
  it("reads all four", () => {
    // The positive control for every negative assertion in this file.
    expect(COMPRESS_VIDEO_UI.length).toBeGreaterThan(1000);
    expect(VIDEO_COMPRESS.length).toBeGreaterThan(1000);
    expect(PDF_EXTRACT_IMAGES.length).toBeGreaterThan(1000);
    expect(SUBTITLES.length).toBeGreaterThan(1000);
    expect(EXTRACT_PDF_IMAGES_UI.length).toBeGreaterThan(1000);
    expect(SUBTITLE_UI.length).toBeGreaterThan(1000);
  });
});

describe("compress-video-to-size says what the engine does", () => {
  const t = tool("compress-video-to-size");
  const copy = allCopy(t);

  it("names WebCodecs and never credits FFmpeg", () => {
    /*
      The single most likely lie on this page. Every other compressor-shaped
      tool on the site runs FFmpeg.wasm, so "powered by FFmpeg" is the sentence
      that writes itself — and it would be false AND would advertise a 31 MB
      download this page never makes. `video-compress.ts` imports mp4-muxer and
      calls VideoEncoder; it does not import the FFmpeg loader.
    */
    expect(VIDEO_COMPRESS).toContain("mp4-muxer");
    expect(VIDEO_COMPRESS).not.toContain("ffmpeg-loader");
    expect(copy, "the copy never names the encoder it actually uses").toContain("webcodecs");
    /*
      Attribution, not the bare word: the FAQ says out loud that this page does
      NOT fall back to FFmpeg, which is both true and worth saying, and a blunt
      `not.toContain("ffmpeg")` would forbid the disclaimer along with the lie.
    */
    expect(copy, "the copy credits FFmpeg for a WebCodecs encode").not.toMatch(
      /(powered by|uses|using|runs on|built on|via|with|through) ffmpeg/,
    );
  });

  it("presents the size as a target rather than a promise", () => {
    // `met` is measured from the finished blob, so the copy has to describe an
    // aim plus a report — never a guarantee.
    expect(VIDEO_COMPRESS).toContain("met: blob.size <= sizeTarget.targetSizeKb * 1024");
    expect(copy).toMatch(/target, not a guarantee|aims at, not|not a guarantee/);
    expect(copy, "the copy never says the achieved size is reported").toMatch(
      /size actually (produced|reached)|size actually|actually produced/,
    );
    for (const forbidden of ["guaranteed size", "exactly the size", "always fits"]) {
      expect(copy, `the copy promises "${forbidden}"`).not.toContain(forbidden);
    }
  });

  it("makes no never-inflate promise this encoder cannot keep", () => {
    /*
      The copy used to read: "It will not go the other way and inflate: aim
      25 MB at a 4 MB clip and the answer is the 4 MB clip." Both halves were
      false, for two independent reasons, and only one of them is an engine
      bug.

      (a) There is no pass-through anywhere in `compressVideo`. Every run
          constructs a `VideoEncoder` and re-encodes, so the answer is never
          the clip you handed it — the component even carries a branch for
          `result.newSize >= file.size` telling the user to keep the original.
          No fix to the bitrate solver changes this, which is why the sentence
          had to go rather than wait for one.
      (b) `planSizeTarget`'s never-inflate cap is applied to the VIDEO bitrate
          only, and an AAC track of up to 128 kbps is muxed beside it: a
          4 MB / 60 s clip WITH audio plans 503,316 + 128,000 = 631,316 bps
          against a 559,241 bps source, 12.9% over.

      So the copy now claims only what holds either way — that the SOLVE is
      taken from what the clip already spends rather than from the ceiling —
      and says out loud that a run can come back no smaller. This test pins
      that it does not drift back into a guarantee.
    */
    expect(VIDEO_COMPRESS, "the encode path is gone; re-check the copy").toContain(
      "new VideoEncoder(",
    );
    /*
      "There is no pass-through here" is a claim about the module, and the
      obvious future fix for the inflate bug is to add one — hand the original
      back when it already fits. That would be a fine engine change and would
      make this sentence false, so it fails here rather than on the page: the
      only Blob this module returns is built from the muxer's own buffer.
    */
    expect(VIDEO_COMPRESS, "a pass-through arrived; the copy denies there is one").not.toMatch(
      /blob:\s*file\b/,
    );
    expect(VIDEO_COMPRESS).toContain("const blob = new Blob([muxer.target.buffer]");
    expect(copy, "the copy promises the original clip back from a re-encoder").not.toMatch(
      /will not .{0,40}inflate|does not inflate|never inflates|the answer is the 4 mb clip/,
    );
    // Paired positives, because a negative search passes on a typo'd read.
    expect(copy, "the copy never mentions the target at all").toContain("25 mb");
    expect(copy, "the copy hides that every run re-encodes").toMatch(/no pass-?through/);
    expect(copy, "the copy never admits a run can come back no smaller").toMatch(
      /come back no smaller|keep your original/,
    );
    // …and the sentence points at a branch that exists.
    expect(
      codeOnly(COMPRESS_VIDEO_UI),
      "the copy tells the user the page will say so, so the page has to",
    ).toMatch(/newSize >= file\.size/);
  });

  it("quotes the three ceilings the UI actually offers", () => {
    /*
      The preset cards are the first thing a reader sees, and the description,
      the FAQ and the HowTo step all name the same three numbers. Read them out
      of the component so a future change to a platform limit cannot leave four
      copies of the old figure behind.
    */
    const block = /const SIZE_PRESETS[\s\S]*?\n\];/.exec(COMPRESS_VIDEO_UI)?.[0];
    expect(block, "SIZE_PRESETS not found in CompressVideoUI.tsx").toBeTruthy();
    const mb = [...(block as string).matchAll(/mb:\s*(\d+)/g)].map((m) => m[1]);
    expect(mb.length, "no size presets parsed").toBeGreaterThan(0);
    for (const n of mb) {
      expect(copy, `the copy never mentions the ${n} MB preset`).toContain(`${n} mb`);
    }
    // …and the seed the registry hands the field is one of them.
    expect(mb).toContain(String(Math.round((t.defaultTargetSizeKb ?? 0) / 1024)));
  });

  it("only claims a floor while the engine has one", () => {
    expect(VIDEO_COMPRESS).toContain("SIZE_TARGET_MIN_VIDEO_BITRATE");
    expect(copy).toMatch(/floor/);
  });

  it("names only controls that ship in target-size mode", () => {
    // A HowTo step is rendered instruction, so every control it names has to
    // exist in the component the page mounts.
    const steps = getHowToSteps(t.toolType).join("\n");
    for (const control of ["TARGET SIZE", "Compress", "Email", "WhatsApp", "Discord"]) {
      expect(steps, `no step names ${control}`).toContain(control);
      expect(COMPRESS_VIDEO_UI, `${control} is named in a step but not in the UI`).toContain(
        control,
      );
    }
  });

  it("discloses the memory ceiling it shares with compress-video", () => {
    // Both slugs mount CompressVideoUI, which reads the note per slug; the
    // absent field would print "NO SIZE CAP" over a whole-file decode.
    expect(t.practicalLimitNote).toBeTruthy();
    expect(t.maxSizeMB).toBeUndefined();
    expect(COMPRESS_VIDEO_UI).toContain('getToolBySlug("compress-video-to-size")');
  });
});

describe("extract-images-from-pdf says what the engine does", () => {
  const t = tool("extract-images-from-pdf");
  const copy = allCopy(t);

  it("claims a verbatim lift only while nothing decodes a JPEG", () => {
    /*
      THE LOAD-BEARING ONE. "byte for byte", "no re-encode" and "no colour
      shift" are true precisely because the module never meets an image
      decoder — which is also what keeps it clear of the EXIF-orientation trap
      (`lib/tools/jpeg-orientation.ts`), where `createImageBitmap` rotates
      samples a PDF reader never rotates. Add a decode and all three sentences
      become false at once, silently.
    */
    for (const decoder of ["createImageBitmap", "document.createElement", "new Image("]) {
      expect(
        PDF_EXTRACT_IMAGES,
        `${decoder} appeared — the "byte for byte" copy is no longer true`,
      ).not.toContain(decoder);
    }
    expect(PDF_EXTRACT_IMAGES, "the verbatim lift is gone").toContain("liftJpeg");
    expect(copy).toContain("byte for byte");
  });

  it("sends page renders to pdf-to-jpg instead of pretending", () => {
    expect(getToolBySlug("pdf-to-jpg"), "the tool it points at must exist").toBeDefined();
    expect(copyOf(t.slug).relatedTools).toContain("pdf-to-jpg");
    expect(copy, "the copy never points at the page renderer").toContain("pdf to jpg");
    expect(copy, "the copy never says this is not a page render").toMatch(
      /not a page screenshot|not a screenshot|ignores the page/,
    );
  });

  it("warns that the stored resolution is the resolution", () => {
    expect(PDF_EXTRACT_IMAGES).toContain('dictNumber(dict, "Width")');
    expect(copy).toMatch(/stored|resolution/);
    expect(copy).toMatch(/smaller than they look|smaller than it looks/);
  });

  it("promises a per-reason skip readout the engine can actually produce", () => {
    // The copy says every skip is counted and named. That is only true while
    // the result carries grouped counts.
    expect(PDF_EXTRACT_IMAGES).toContain("skipped: PdfExtractSkip[]");
    expect(copy).toMatch(/counted|skip/);
  });

  it("promises one file per image, not one per drawing", () => {
    expect(PDF_EXTRACT_IMAGES).toContain("enumerateIndirectObjects()");
    expect(copy).toMatch(/objects rather than its pages|walking the document's objects/);
  });

  it("names only controls that ship, and no button the UI does not have", () => {
    /*
      The run starts on the drop (`handleFiles` calls `run(f)`), so a step that
      told the reader to click Extract would be an instruction they cannot
      follow. Assert both halves: the controls named exist, and the button that
      does not exist is not named.
    */
    const steps = getHowToSteps(t.toolType).join("\n");
    for (const control of ["MINIMUM SIZE", "Download"]) {
      expect(steps, `no step names ${control}`).toContain(control);
      expect(EXTRACT_PDF_IMAGES_UI, `${control} is in a step but not in the UI`).toContain(control);
    }
    expect(EXTRACT_PDF_IMAGES_UI, "the run no longer starts on the drop").toContain("void run(f)");
    expect(steps, "a step tells the reader to click a button that does not exist").not.toMatch(
      /click Extract|press Extract/i,
    );
  });

  it("routes multi-image output through the ZIP the registry advertises", () => {
    expect(t.description.toLowerCase()).toContain("zip");
    expect(getWorkspaceTool(t.slug)?.route).toContain("ZIP");
  });
});

describe("subtitle-converter says what the engine does", () => {
  const t = tool("subtitle-converter");
  const copy = allCopy(t);

  it("admits ASS styling does not survive", () => {
    /*
      `parseAss` reads a styling language into `{start,end,text}`. The copy has
      to say that out loud, because a stripped file presented as a conversion
      looks like success right up until someone plays it.
    */
    expect(SUBTITLES).toContain("export function parseAss");
    expect(copy).toMatch(/styl/);
    expect(copy).toMatch(/karaoke|positioning|position/);
  });

  it("discloses the encoding it guessed at rather than assuming UTF-8", () => {
    // The strict decode is the whole mechanism: without `fatal`, a
    // Windows-1252 file "converts" into replacement characters and reports
    // success. If that goes, the copy's encoding paragraph is a lie.
    expect(SUBTITLES).toContain("fatal: true");
    expect(SUBTITLES).toContain("decodeSubtitleBytes");
    expect(copy).toMatch(/utf-8/);
    expect(copy).toMatch(/windows-1252|legacy codepage|legacy encoding/);
  });

  it("never claims it burns subtitles into the picture", () => {
    /*
      The tempting overclaim, and the one the module cannot back: burning
      captions in re-encodes every frame, and there is no encoder anywhere in
      this engine. Asserting the ABSENCE of a phrase is useless here — the FAQ
      question is "Does this burn the subtitles into the video?", so the words
      appear in the denial. Assert the denial and the absence of the machinery
      instead.
    */
    for (const encoder of ["VideoEncoder", "canvas", "ffmpeg"]) {
      expect(SUBTITLES, `${encoder} appeared in a pure-text engine`).not.toContain(encoder);
    }
    expect(copy, "the copy never says the output is a separate file").toMatch(
      /sidecar|text tool: subtitles in, subtitles out/,
    );
    expect(copy, "the copy never denies burning captions in").toMatch(
      /is not what this page does|does not (burn|re-encode)/,
    );
  });

  it("names only controls that ship", () => {
    // Conversion is live as you type — there is no Convert button, and no step
    // may invent one.
    const steps = getHowToSteps(t.toolType).join("\n");
    for (const control of ["SOURCE", "CONVERT TO", "TIME SHIFT", "Re-time between frame rates"]) {
      expect(steps, `no step names ${control}`).toContain(control);
      expect(SUBTITLE_UI, `${control} is in a step but not in the UI`).toContain(control);
    }
    expect(steps, "a step invents a Convert button").not.toMatch(/click Convert|press Convert/i);
  });

  it("describes the frame-rate re-time as scaling, not shifting", () => {
    expect(SUBTITLES).toContain("export function retimeScale");
    expect(copy).toMatch(/frame rate|framerate|fps/);
    expect(copy).toMatch(/23\.976/);
  });
});
