import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tools, type Tool } from "@/data/tools";
import { ToolClient } from "@/components/tools/ToolClient";

/** src/components/tools, reached from this file rather than from the cwd. */
const TOOLS_DIR = join(
  dirname(new URL(import.meta.url).pathname),
  "../../../components/tools",
);

/*
  THE BLANK-SURFACE GATE.

  `ToolClient` is a `switch` over `Tool.toolType` that ends in
  `default: return null`. A registry entry whose toolType has no case therefore
  COMPILES, generates its page, renders its H1, its FAQs and its ACCEPTS row —
  and then draws nothing at all where the tool should be. Nothing in tsc catches
  it, and until now nothing but the all-tools Playwright sweep did either, which
  is the slowest and least specific gate in the repo.

  This is the fast one. It calls the switch directly rather than rendering it:
  every branch resolves to a `next/dynamic` wrapper, so the return value is the
  whole answer and no UI has to mount to get it.
*/

/*
  THE MIS-WIRE GATE — the other half, and the sharper one.

  "Not null" is a low bar. Every arm of the switch returns a JSX element, so
  `case "json-minify": return <SortDedupeLinesClient />;` type-checks, lints,
  passes the blank-surface gate above, and passes the all-tools Playwright sweep
  too — that sweep asserts the H1 (which comes from `tools.ts`, not from the UI)
  and the existence of one control inside `[data-tool-surface]`, and the wrong
  tool has both. The user gets Sort & Dedupe Lines under a "Minify JSON"
  heading and nothing anywhere goes red.

  So the mapping is written down HERE, by hand, and checked. This table is the
  spec; `ToolClient.tsx` is the implementation. Pasting a row out of the switch
  to make this file green is the one thing that defeats it — when a row and the
  switch disagree, decide which is right by opening the tool page, not by
  whichever is easier to edit.

  Keyed by `toolType`, because that is what the switch dispatches on. Several
  toolTypes are deliberately shared by many slugs (`image-convert` covers eleven
  pair pages, `video-remux` six, `yaml-json-converter` two) — those slugs read
  their direction off the registry and mount one component, so one row covers
  them all. The assertion still runs once per registered TOOL, so a failure
  names the slug that broke.

  The rows that are not a mechanical kebab→Pascal rename, and are correct:
    image-convert           -> ImageToolClient       (the generic pair-page UI)
    image-compress          -> ImageCompressorClient
    image-resize            -> ImageResizerClient
    image-crop              -> ImageCropperClient
    extract-images-from-pdf -> ExtractPdfImagesClient
    mp3-to-wav / wav-to-mp3 / m4a-to-mp3 -> AudioConvertClient
                            (three legacy toolTypes onto the one audio UI that
                             every newer pair page reaches via `audio-convert`)
    line-endings            -> CrlfLfClient          (the slug is `crlf-lf`; the
                             type is `line-endings` because the tool writes a
                             bare CR too)
*/
const EXPECTED_CLIENT: Record<string, string> = {
  // Image
  "image-convert": "ImageToolClient",
  "jfif-to-jpg": "JfifToJpgClient",
  "image-compress": "ImageCompressorClient",
  "image-resize": "ImageResizerClient",
  "image-crop": "ImageCropperClient",
  "exif-viewer": "ExifViewerClient",
  "image-to-base64": "ImageToBase64Client",
  "png-to-ico": "PngToIcoClient",
  "favicon-generator": "FaviconGeneratorClient",
  "color-palette": "ColorPaletteClient",

  /*
    Wave 4's image cluster — twelve toolTypes, twelve clients, every row a
    mechanical kebab→Pascal rename. Written out one per line rather than
    generated, because a generator would agree with a mis-wired switch by
    construction and this table's whole job is to disagree with it.

    Seven more slugs landed in the same batch — tiff-to-png, avif-to-png,
    avif-to-webp, bmp-to-png, svg-to-jpg, svg-to-webp and heic-to-webp — and
    are deliberately absent: they carry `image-convert` and mount the pair-page
    converter already rowed at the top of this block, so they need no row of
    their own. The assertion runs per TOOL, so all seven are still checked.
  */
  "rotate-image": "RotateImageClient",
  "flip-image": "FlipImageClient",
  "add-border": "AddBorderClient",
  "watermark-image": "WatermarkImageClient",
  "pixelate-image": "PixelateImageClient",
  "crop-circle": "CropCircleClient",
  "image-splitter": "ImageSplitterClient",
  "social-media-image-resizer": "SocialMediaImageResizerClient",
  "compress-png": "CompressPngClient",
  "ico-to-png": "IcoToPngClient",
  "base64-to-image": "Base64ToImageClient",
  "change-image-dpi": "ChangeImageDpiClient",

  // PDF
  "merge-pdf": "MergePdfClient",
  "split-pdf": "SplitPdfClient",
  "compress-pdf": "CompressPdfClient",
  "recompress-pdf-images": "RecompressPdfImagesClient",
  "pdf-to-jpg": "PdfToJpgClient",
  "images-to-pdf": "ImagesToPdfClient",
  "rotate-pdf": "RotatePdfClient",
  "add-page-numbers": "AddPageNumbersClient",
  "pdf-page-reorder": "PdfPageReorderClient",
  "extract-pdf-pages": "ExtractPdfPagesClient",
  "delete-pdf-pages": "DeletePdfPagesClient",
  "crop-pdf": "CropPdfClient",
  "change-pdf-page-size": "ChangePdfPageSizeClient",
  "pdf-resizer": "PdfResizerClient",
  "pdf-to-text": "PdfToTextClient",
  "extract-images-from-pdf": "ExtractPdfImagesClient",
  "protect-pdf": "ProtectPdfClient",
  "unlock-pdf": "UnlockPdfClient",
  "pdf-permissions": "PdfPermissionsClient",
  "repair-pdf": "RepairPdfClient",
  "watermark-pdf": "WatermarkPdfClient",
  "sign-pdf": "SignPdfClient",
  "add-image-to-pdf": "AddImageToPdfClient",
  "annotate-pdf": "AnnotatePdfClient",
  "fill-pdf-form": "FillPdfFormClient",
  "flatten-pdf": "FlattenPdfClient",
  "remove-metadata": "RemoveMetadataClient",
  "pdf-editor": "PdfEditorClient",
  "markdown-to-pdf": "MarkdownToPdfClient",

  // Audio
  "mp3-to-wav": "AudioConvertClient",
  "wav-to-mp3": "AudioConvertClient",
  "m4a-to-mp3": "AudioConvertClient",
  "audio-convert": "AudioConvertClient",
  "extract-audio": "ExtractAudioClient",
  "audio-trimmer": "AudioTrimmerClient",
  "merge-audio": "MergeAudioClient",
  "normalize-audio": "NormalizeAudioClient",
  "change-audio-volume": "ChangeAudioVolumeClient",
  "reverse-audio": "ReverseAudioClient",
  "remove-silence": "RemoveSilenceClient",
  "audio-recorder": "AudioRecorderClient",

  // Video
  "video-to-gif": "VideoToGifClient",
  "video-trimmer": "VideoTrimmerClient",
  "mp4-to-mp3": "Mp4ToMp3Client",
  "webm-to-mp4": "WebmToMp4Client",
  "compress-video": "CompressVideoClient",
  "compress-video-to-size": "CompressVideoToSizeClient",
  "screen-recorder": "ScreenRecorderClient",
  "video-remux": "VideoRemuxClient",
  "mute-video": "MuteVideoClient",
  "rotate-video": "RotateVideoClient",
  "video-to-images": "VideoToImagesClient",
  "video-thumbnail": "VideoThumbnailClient",
  "split-video": "SplitVideoClient",
  "merge-video": "MergeVideoClient",
  "webcam-recorder": "WebcamRecorderClient",

  // Developer — formatters and structured-data converters
  "json-formatter": "JsonFormatterClient",
  "json-minify": "JsonMinifyClient",
  "json-to-csv": "JsonToCsvClient",
  "csv-to-json": "CsvToJsonClient",
  "sql-formatter": "SqlFormatterClient",
  "markdown-to-html": "MarkdownToHtmlClient",
  "html-to-markdown": "HtmlToMarkdownClient",
  "xml-formatter": "XmlFormatterClient",
  "yaml-json-converter": "YamlJsonConverterClient",
  "yaml-formatter": "YamlFormatterClient",
  "xlsx-to-csv": "XlsxToCsvClient",
  "har-viewer": "HarViewerClient",
  "subtitle-converter": "SubtitleConverterClient",

  // Developer — encoders, digests, text
  "base64-encode-decode": "Base64EncodeDecodeClient",
  "url-encode-decode": "UrlEncodeDecodeClient",
  "html-entity-encode-decode": "HtmlEntityEncodeDecodeClient",
  "charset-converter": "CharsetConverterClient",
  "line-endings": "CrlfLfClient",
  "jwt-decoder": "JwtDecoderClient",
  "jwt-encoder": "JwtEncoderClient",
  "hash-generator": "HashGeneratorClient",
  "hmac-generator": "HmacGeneratorClient",
  "file-checksum": "FileChecksumClient",
  "text-diff": "TextDiffClient",
  "text-case-converter": "TextCaseConverterClient",
  "word-counter": "WordCounterClient",
  "sort-dedupe-lines": "SortDedupeLinesClient",

  // Developer — generators, calculators, reference
  "uuid-generator": "UuidGeneratorClient",
  "password-generator": "PasswordGeneratorClient",
  "lorem-ipsum-generator": "LoremIpsumGeneratorClient",
  "qr-code-generator": "QrCodeGeneratorClient",
  "wifi-qr-code": "WifiQrCodeClient",
  "color-picker": "ColorPickerClient",
  "css-gradient-generator": "CssGradientGeneratorClient",
  "box-shadow-generator": "BoxShadowGeneratorClient",
  "regex-tester": "RegexTesterClient",
  "cron-expression-generator": "CronExpressionGeneratorClient",
  "timestamp-converter": "TimestampConverterClient",
  "timezone-converter": "TimezoneConverterClient",
  "chmod-calculator": "ChmodCalculatorClient",
  "http-status-codes": "HttpStatusCodesClient",
  "byte-converter": "ByteConverterClient",
  "aspect-ratio-calculator": "AspectRatioCalculatorClient",
  "url-parser": "UrlParserClient",

  // Developer — archives, codes and document readers
  // Every row here is a mechanical kebab→Pascal rename. That used to be
  // followed by a list of the control each UI carries, written down as
  // evidence someone had opened the seven pages once; the third describe block
  // at the bottom of this file checks the same thing on every run instead, so
  // the list is gone rather than slowly going stale.
  "create-zip": "CreateZipClient",
  "unzip-files": "UnzipFilesClient",
  "extract-archive": "ExtractArchiveClient",
  "barcode-generator": "BarcodeGeneratorClient",
  "qr-code-reader": "QrCodeReaderClient",
  "svg-optimizer": "SvgOptimizerClient",
  "docx-to-markdown": "DocxToMarkdownClient",
};

/**
 * The name of the component a toolType actually mounts. Every arm returns a
 * `next/dynamic` wrapper declared as a named `function *Client()`, so the
 * element's `type.name` is that name — no UI mounts and nothing async runs.
 */
function mountedClientName(tool: Tool): string {
  const element = ToolClient({ tool }) as { type?: { name?: string } } | null;
  if (element === null) return "null (fell through to the default arm)";
  return element.type?.name || "an anonymous component";
}

describe("ToolClient — every registered tool resolves to a component", () => {
  it("finds the registry at all (a gate over an empty list cannot fail)", () => {
    expect(tools.length).toBeGreaterThan(80);
  });

  it("renders no blank surface for any toolType in the registry", () => {
    const blank = tools
      .filter((tool) => ToolClient({ tool }) === null)
      .map((tool) => `${tool.slug} (toolType "${tool.toolType}") falls through to default: null`);

    expect(blank).toEqual([]);
  });

  it("still returns null for a toolType nobody has written a case for", () => {
    /*
      The other half of the gate: it is worthless if `ToolClient` returns
      something for everything. This is the failure mode the test above detects,
      proven to still be detectable.
    */
    const unhandled = { ...tools[0], toolType: "not-a-real-tool-type" } as unknown as Tool;

    expect(ToolClient({ tool: unhandled })).toBeNull();
  });
});

describe("ToolClient — every tool mounts the UI its page promises", () => {
  it("has a written-down expectation for every toolType in the registry", () => {
    const unnamed = [
      ...new Set(
        tools
          .filter((tool) => !(tool.toolType in EXPECTED_CLIENT))
          .map((tool) => `${tool.toolType} (first seen on /${tool.slug})`),
      ),
    ];

    expect(
      unnamed,
      "a toolType reached tools.ts without naming the client it mounts — add a row to EXPECTED_CLIENT in this file",
    ).toEqual([]);
  });

  it("mounts exactly the client named for each tool's toolType", () => {
    const wrong = tools
      .filter((tool) => tool.toolType in EXPECTED_CLIENT)
      .map((tool) => ({
        tool,
        expected: EXPECTED_CLIENT[tool.toolType],
        actual: mountedClientName(tool),
      }))
      .filter(({ expected, actual }) => expected !== actual)
      .map(
        ({ tool, expected, actual }) =>
          `/${tool.slug} (toolType "${tool.toolType}") mounts ${actual}, expected ${expected}`,
      );

    expect(wrong, "ToolClient.tsx dispatches a toolType to the wrong UI").toEqual([]);
  });

  it("keeps no expectation for a toolType the registry no longer ships", () => {
    /*
      Without this the table rots: a retired toolType leaves behind a row that
      asserts nothing, and the next reader cannot tell a live row from a dead
      one.
    */
    const live = new Set<string>(tools.map((tool) => tool.toolType));
    const stale = Object.keys(EXPECTED_CLIENT).filter((toolType) => !live.has(toolType));

    expect(stale, "EXPECTED_CLIENT rows for toolTypes no tool uses").toEqual([]);
  });
});

/*
  THE LAST HOP — client wrapper to UI module.

  The two gates above stop at the client's NAME. `mountedClientName` reads
  `element.type.name` off the switch's return value, so `case "barcode": return
  <BarcodeGeneratorClient />;` satisfies them completely — and says nothing at
  all about what `BarcodeGeneratorClient` renders. Every one of those wrappers
  is two lines in a `*Clients.tsx` file:

      const BarcodeGeneratorUI = dynamic(() => import("./BarcodeGeneratorUI")…);
      export function BarcodeGeneratorClient() { return <BarcodeGeneratorUI />; }

  Both lines are hand-written, both are copy-paste of the line above, and a
  wrong one is invisible: the page renders a real tool under the right H1, with
  a control inside `[data-tool-surface]`, which is all the all-tools sweep
  checks. This file used to close that gap with a comment listing the control
  each of the seven newest UIs carries, as a note that someone had looked. A
  note is not a gate.

  So the hop is read out of the source rather than trusted. Nothing is imported
  and nothing mounts: these UIs pull FFmpeg, libarchive, zxing and canvas
  behind `next/dynamic`, none of which belong in a jsdom unit test, and the
  question here is which module the wrapper NAMES, which is a static fact.

  This is deliberately not a substitute for rendering tests of the UIs
  themselves — those live in `*UI.test.tsx` beside this file. It is the layer
  none of them can see, because each of them imports its own component directly
  and so cannot notice that the page mounts a different one.
*/

const CLIENT_SOURCES = readdirSync(TOOLS_DIR)
  .filter((name) => /Client(s)?\.tsx$/.test(name) && name !== "ToolClient.tsx")
  .map((name) => ({ name, source: readFileSync(join(TOOLS_DIR, name), "utf8") }));

/**
 * `export function XClient(…) { return <SomeUI … /> }` → `XClient` → `SomeUI`.
 *
 * The first JSX tag after `return` is the answer for every wrapper in the
 * tree: the ones taking a `tool` prop spread registry values onto that same
 * element and open no other tag before it.
 */
const MOUNTED_UI = new Map<string, { ui: string; file: string }>();
for (const { name, source } of CLIENT_SOURCES) {
  for (const match of source.matchAll(
    /export function (\w+Client)\s*\([^)]*\)\s*\{\s*return\s*\(?\s*<(\w+)/g,
  )) {
    MOUNTED_UI.set(match[1], { ui: match[2], file: name });
  }
}

/** `const X = dynamic(() => import("./M").then((m) => ({ default: m.E })))` → X → M/E. */
const DYNAMIC_BINDING = new Map<string, { module: string; exported: string; file: string }>();
for (const { name, source } of CLIENT_SOURCES) {
  for (const match of source.matchAll(
    /const (\w+) = dynamic\(\s*\(\) => import\("\.\/(\w+)"\)\.then\(\(m\) => \(\{ default: m\.(\w+) \}\)\)/g,
  )) {
    DYNAMIC_BINDING.set(match[1], { module: match[2], exported: match[3], file: name });
  }
}

/**
 * The four wrappers whose UI is not `<name minus "Client"> + "UI"`, and why.
 * A fifth appearing here unannounced is what the mechanical check below is
 * for: it is how a paste lands on the wrong UI and reads as normal.
 */
const UI_FOR_CLIENT: Record<string, string> = {
  // One converter UI behind every image pair page; the direction is a prop.
  ImageToolClient: "ImageConverterUI",
  // Likewise for audio: `mp3-to-wav`, `wav-to-mp3`, `m4a-to-mp3` and the
  // generic `audio-convert` all mount the one converter.
  AudioConvertClient: "AudioConverterUI",
  // `compress-video` and `compress-video-to-size` are the same UI in two
  // modes, so the size page's wrapper cannot be named after its own component.
  CompressVideoToSizeClient: "CompressVideoUI",
  // The tool is "merge audio"; the component was named for the noun.
  MergeAudioClient: "AudioMergerUI",
};

describe("ToolClient — every client wrapper mounts the UI its name promises", () => {
  it("finds a wrapper in the source for every client the registry reaches", () => {
    /*
      The gate over the gate. If the regex above stopped matching — a
      reformat, a wrapper written as an arrow const — `MOUNTED_UI` would empty
      out and every assertion below would pass vacuously.
    */
    const missing = [...new Set(Object.values(EXPECTED_CLIENT))]
      .filter((client) => client !== "ToolClient" && !MOUNTED_UI.has(client))
      .sort();

    expect(
      missing,
      "these clients are mounted by ToolClient.tsx but no wrapper for them was found in src/components/tools/*Client*.tsx — if they moved or changed shape, fix the parser in this file rather than deleting the rows",
    ).toEqual([]);
  });

  it("mounts <Name>UI from <Name>Client, except where a row says otherwise", () => {
    const wrong = [...MOUNTED_UI.entries()]
      .map(([client, { ui, file }]) => ({
        client,
        ui,
        file,
        expected: UI_FOR_CLIENT[client] ?? `${client.replace(/Client$/, "")}UI`,
      }))
      .filter(({ ui, expected }) => ui !== expected)
      .map(
        ({ client, ui, expected, file }) =>
          `${file}: ${client} mounts ${ui}, expected ${expected} — add a row to UI_FOR_CLIENT with the reason if this is deliberate`,
      );

    expect(wrong).toEqual([]);
  });

  it("imports each mounted UI from the module of the same name", () => {
    /*
      The other half of the paste. A wrapper can name the right component and
      still get the wrong one, because the name is a local `const`:
      `const BarcodeGeneratorUI = dynamic(() => import("./QrCodeReaderUI")…)`
      type-checks, lints, and mounts the reader under the generator's heading.
    */
    const wrong = [...new Set([...MOUNTED_UI.values()].map(({ ui }) => ui))]
      .sort()
      .map((ui) => ({ ui, binding: DYNAMIC_BINDING.get(ui) }))
      .filter(
        ({ ui, binding }) =>
          !binding || binding.module !== ui || binding.exported !== ui,
      )
      .map(({ ui, binding }) =>
        binding
          ? `${binding.file}: ${ui} is bound to import("./${binding.module}").${binding.exported}`
          : `${ui} is mounted by a client wrapper but has no dynamic() binding in any *Client*.tsx`,
      );

    expect(wrong).toEqual([]);
  });

  it("keeps a reason on file for every wrapper that breaks the naming rule", () => {
    /*
      Rot in the other direction: a row that outlives the deviation it excuses
      reads as "this one is special" forever, and the next wrapper named after
      the same component slips past unexamined.
    */
    const stale = Object.entries(UI_FOR_CLIENT)
      .filter(([client, ui]) => MOUNTED_UI.get(client)?.ui !== ui)
      .map(([client, ui]) => `${client} -> ${ui}`);

    expect(stale, "UI_FOR_CLIENT rows that no longer describe the source").toEqual([]);
  });
});
