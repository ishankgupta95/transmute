/**
 * Workspace metadata — the rail entry (name, category, IN → OUT route,
 * engine, accepted formats) and archetype for every tool, plus the
 * per-archetype pipeline chips. Read by BOTH surfaces: the tool pages
 * (ToolPageLayout's pipeline strip / ENGINE / ACCEPTS lines) and the
 * /workspace shell.
 *
 * The seeded presets/controls/samples that used to live here retired with
 * Phase 4 — the workspace now mounts the real tool components, which carry
 * their own controls. Every slug here also exists in the tool registry
 * (`src/data/tools.ts`); the unit tests assert the two stay in step.
 *
 * `accept` and `engine` are honesty claims, not decoration: `accept` is
 * DERIVED from the registry's `acceptFormats` (the same string that becomes
 * the `<DropZone accept=…>` on the page), so the ACCEPTS line can no longer
 * drift from the file picker sitting under it. `engine` names the library
 * the tool's `lib/` module actually imports.
 */

import { getToolBySlug } from "@/data/tools";

export type Archetype =
  | "image"
  | "batch"
  | "pdfpages"
  | "pdfdocs"
  | "video"
  | "gif"
  | "extract"
  | "transcode"
  | "audio"
  | "text"
  | "gen"
  | "icons"
  | "color"
  | "data"
  | "record";

export type WorkspaceCategory = "IMAGE" | "PDF" | "AUDIO" | "VIDEO" | "DEV";

export const workspaceCategories = [
  "ALL",
  "IMAGE",
  "PDF",
  "AUDIO",
  "VIDEO",
  "DEV",
] as const;

export type WorkspaceFilter = (typeof workspaceCategories)[number];

export interface WorkspaceTool {
  slug: string;
  name: string;
  cat: WorkspaceCategory;
  /** Short "IN → OUT" route label shown under the tool name in the rail. */
  route: string;
  kind: Archetype;
  /** The library or browser API that does the work. */
  engine: string;
  /**
   * Space-separated list of accepted input formats. Derived from the
   * registry's `acceptFormats` for every tool that takes files; the literal
   * below is the fallback for the tools whose input is not a file at all
   * (generators, the text tools, the screen recorder).
   */
  accept: string;
}

/**
 * Extensions that spell the same format two ways. Advertising both doubles
 * the width of a line that has to `truncate`, and tells the user nothing —
 * so the alias is dropped whenever its canonical partner is also accepted.
 */
const ACCEPT_ALIASES: Record<string, string> = {
  jpeg: "jpg",
  tif: "tiff",
  heif: "heic",
  markdown: "md",
};

/**
 * Turn a registry `acceptFormats` string into the ACCEPTS label. Bare MIME
 * tokens are dropped (markdown-to-pdf carries `text/markdown`, which would
 * otherwise render as `ACCEPTS TEXT/MARKDOWN`), and aliases collapse.
 */
function acceptLabel(slug: string): string {
  const raw = getToolBySlug(slug)?.acceptFormats ?? "";
  const exts = raw
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.startsWith("."))
    .map((t) => t.slice(1));
  const present = new Set(exts);
  const out: string[] = [];
  for (const ext of exts) {
    const canonical = ACCEPT_ALIASES[ext];
    if (canonical && present.has(canonical)) continue;
    const token = (canonical ?? ext).toUpperCase();
    if (!out.includes(token)) out.push(token);
  }
  return out.join(" ");
}

const rawWorkspaceTools: WorkspaceTool[] = [
  { slug: "heic-to-jpg", name: "HEIC to JPG", cat: "IMAGE", route: "HEIC → JPG", kind: "batch", engine: "HEIC2ANY", accept: "HEIC" },
  { slug: "webp-to-jpg", name: "WebP to JPG", cat: "IMAGE", route: "WEBP → JPG", kind: "batch", engine: "CANVAS 2D", accept: "WEBP" },
  { slug: "webp-to-png", name: "WebP to PNG", cat: "IMAGE", route: "WEBP → PNG", kind: "batch", engine: "CANVAS 2D", accept: "WEBP" },
  { slug: "png-to-jpg", name: "PNG to JPG", cat: "IMAGE", route: "PNG → JPG", kind: "batch", engine: "CANVAS 2D", accept: "PNG" },
  { slug: "jpg-to-png", name: "JPG to PNG", cat: "IMAGE", route: "JPG → PNG", kind: "batch", engine: "CANVAS 2D", accept: "JPG" },
  { slug: "jpg-to-webp", name: "JPG to WebP", cat: "IMAGE", route: "JPG → WEBP", kind: "batch", engine: "CANVAS 2D", accept: "JPG" },
  { slug: "png-to-webp", name: "PNG to WebP", cat: "IMAGE", route: "PNG → WEBP", kind: "batch", engine: "CANVAS 2D", accept: "PNG" },
  { slug: "svg-to-png", name: "SVG to PNG", cat: "IMAGE", route: "SVG → PNG", kind: "image", engine: "CANVAS 2D", accept: "SVG" },
  { slug: "avif-to-jpg", name: "AVIF to JPG", cat: "IMAGE", route: "AVIF → JPG", kind: "batch", engine: "CANVAS 2D", accept: "AVIF" },
  { slug: "bmp-to-jpg", name: "BMP to JPG", cat: "IMAGE", route: "BMP → JPG", kind: "batch", engine: "CANVAS 2D", accept: "BMP" },
  { slug: "tiff-to-jpg", name: "TIFF to JPG", cat: "IMAGE", route: "TIFF → JPG", kind: "batch", engine: "UTIF2", accept: "TIFF" },
  { slug: "jfif-to-jpg", name: "JFIF to JPG", cat: "IMAGE", route: "JFIF → JPG", kind: "image", engine: "BYTE COPY", accept: "JFIF JPG" },
  { slug: "compress-image", name: "Image Compressor", cat: "IMAGE", route: "IMG → JPG · WEBP", kind: "image", engine: "CANVAS 2D", accept: "JPG PNG WEBP AVIF BMP GIF" },
  { slug: "compress-image-to-100kb", name: "Compress Image to 100 KB", cat: "IMAGE", route: "IMG → JPG · WEBP", kind: "image", engine: "CANVAS 2D", accept: "JPG PNG WEBP AVIF BMP" },
  { slug: "compress-image-to-200kb", name: "Compress Image to 200 KB", cat: "IMAGE", route: "IMG → JPG · WEBP", kind: "image", engine: "CANVAS 2D", accept: "JPG PNG WEBP AVIF BMP" },
  { slug: "compress-image-to-1mb", name: "Compress Image to 1 MB", cat: "IMAGE", route: "IMG → JPG · WEBP", kind: "image", engine: "CANVAS 2D", accept: "JPG PNG WEBP AVIF BMP" },
  { slug: "compress-image-to-20kb", name: "Compress Image to 20 KB", cat: "IMAGE", route: "IMG → JPG · WEBP", kind: "image", engine: "CANVAS 2D", accept: "JPG PNG WEBP AVIF BMP" },
  { slug: "compress-image-to-50kb", name: "Compress Image to 50 KB", cat: "IMAGE", route: "IMG → JPG · WEBP", kind: "image", engine: "CANVAS 2D", accept: "JPG PNG WEBP AVIF BMP" },
  { slug: "compress-image-to-500kb", name: "Compress Image to 500 KB", cat: "IMAGE", route: "IMG → JPG · WEBP", kind: "image", engine: "CANVAS 2D", accept: "JPG PNG WEBP AVIF BMP" },
  { slug: "compress-image-to-target-size", name: "Compress Image to Target Size", cat: "IMAGE", route: "IMG → JPG · WEBP", kind: "image", engine: "CANVAS 2D", accept: "JPG PNG WEBP AVIF BMP" },
  { slug: "resize-image", name: "Resize Image", cat: "IMAGE", route: "IMG → IMG", kind: "image", engine: "PICA", accept: "JPG PNG WEBP AVIF BMP GIF" },
  { slug: "resize-image-to-20kb", name: "Resize Image to 20 KB", cat: "IMAGE", route: "IMG → JPG · WEBP", kind: "image", engine: "CANVAS 2D", accept: "JPG PNG WEBP AVIF BMP" },
  { slug: "resize-image-to-50kb", name: "Resize Image to 50 KB", cat: "IMAGE", route: "IMG → JPG · WEBP", kind: "image", engine: "CANVAS 2D", accept: "JPG PNG WEBP AVIF BMP" },
  { slug: "resize-image-to-100kb", name: "Resize Image to 100 KB", cat: "IMAGE", route: "IMG → JPG · WEBP", kind: "image", engine: "CANVAS 2D", accept: "JPG PNG WEBP AVIF BMP" },
  { slug: "photo-resizer-in-kb", name: "Photo Resizer in KB", cat: "IMAGE", route: "IMG → JPG · WEBP", kind: "image", engine: "CANVAS 2D", accept: "JPG PNG WEBP AVIF BMP" },
  { slug: "crop-image", name: "Crop Image", cat: "IMAGE", route: "IMG → IMG", kind: "image", engine: "CANVAS 2D", accept: "JPG PNG WEBP AVIF BMP GIF" },
  { slug: "exif-viewer", name: "EXIF Viewer", cat: "IMAGE", route: "IMG → DATA", kind: "data", engine: "EXIFREADER", accept: "JPG PNG WEBP TIFF HEIC" },
  { slug: "image-to-base64", name: "Image to Base64", cat: "IMAGE", route: "IMG → TXT", kind: "text", engine: "FILEREADER", accept: "JPG PNG WEBP GIF SVG BMP AVIF" },
  { slug: "png-to-ico", name: "PNG to ICO", cat: "IMAGE", route: "PNG → ICO", kind: "icons", engine: "CANVAS 2D", accept: "PNG" },
  { slug: "favicon-generator", name: "Favicon Generator", cat: "IMAGE", route: "PNG → ZIP", kind: "icons", engine: "CANVAS 2D · JSZIP", accept: "PNG JPG SVG WEBP" },
  { slug: "image-color-palette", name: "Image Color Palette", cat: "IMAGE", route: "IMG → HEX", kind: "color", engine: "CANVAS 2D", accept: "JPG PNG WEBP AVIF BMP GIF" },
  { slug: "merge-pdf", name: "Merge PDF", cat: "PDF", route: "PDF → PDF", kind: "pdfdocs", engine: "MUPDF WASM", accept: "PDF" },
  { slug: "split-pdf", name: "Split PDF", cat: "PDF", route: "PDF → PDF", kind: "pdfpages", engine: "MUPDF WASM", accept: "PDF" },
  { slug: "compress-pdf", name: "Compress PDF", cat: "PDF", route: "PDF → PDF", kind: "pdfdocs", engine: "MUPDF WASM", accept: "PDF" },
  { slug: "pdf-to-jpg", name: "PDF to JPG", cat: "PDF", route: "PDF → JPG · PNG · WEBP", kind: "pdfpages", engine: "PDFJS", accept: "PDF" },
  { slug: "pdf-to-png", name: "PDF to PNG", cat: "PDF", route: "PDF → PNG", kind: "pdfpages", engine: "PDFJS", accept: "PDF" },
  { slug: "pdf-to-webp", name: "PDF to WebP", cat: "PDF", route: "PDF → WEBP", kind: "pdfpages", engine: "PDFJS", accept: "PDF" },
  { slug: "images-to-pdf", name: "Images to PDF", cat: "PDF", route: "IMG → PDF", kind: "pdfdocs", engine: "PDF-LIB", accept: "JPG PNG WEBP HEIC TIFF" },
  { slug: "jpg-to-pdf", name: "JPG to PDF", cat: "PDF", route: "JPG → PDF", kind: "pdfdocs", engine: "PDF-LIB", accept: "JPG" },
  { slug: "png-to-pdf", name: "PNG to PDF", cat: "PDF", route: "PNG → PDF", kind: "pdfdocs", engine: "PDF-LIB", accept: "PNG" },
  { slug: "heic-to-pdf", name: "HEIC to PDF", cat: "PDF", route: "HEIC → PDF", kind: "pdfdocs", engine: "HEIC2ANY · PDF-LIB", accept: "HEIC" },
  { slug: "webp-to-pdf", name: "WebP to PDF", cat: "PDF", route: "WEBP → PDF", kind: "pdfdocs", engine: "CANVAS 2D · PDF-LIB", accept: "WEBP" },
  { slug: "tiff-to-pdf", name: "TIFF to PDF", cat: "PDF", route: "TIFF → PDF", kind: "pdfdocs", engine: "UTIF2 · PDF-LIB", accept: "TIFF" },
  { slug: "rotate-pdf", name: "Rotate PDF", cat: "PDF", route: "PDF → PDF", kind: "pdfpages", engine: "MUPDF WASM", accept: "PDF" },
  { slug: "add-page-numbers", name: "Add Page Numbers", cat: "PDF", route: "PDF → PDF", kind: "pdfpages", engine: "MUPDF WASM", accept: "PDF" },
  { slug: "pdf-page-reorder", name: "Reorder PDF Pages", cat: "PDF", route: "PDF → PDF", kind: "pdfpages", engine: "MUPDF WASM", accept: "PDF" },
  { slug: "markdown-to-pdf", name: "Markdown to PDF", cat: "PDF", route: "MD → PDF", kind: "text", engine: "MARKED · PRINT", accept: "MD TXT" },
  { slug: "mp3-to-wav", name: "MP3 to WAV", cat: "AUDIO", route: "MP3 → WAV", kind: "audio", engine: "WEB AUDIO", accept: "MP3" },
  { slug: "wav-to-mp3", name: "WAV to MP3", cat: "AUDIO", route: "WAV → MP3", kind: "audio", engine: "WEB AUDIO · LAMEJS", accept: "WAV" },
  { slug: "m4a-to-mp3", name: "M4A to MP3", cat: "AUDIO", route: "M4A → MP3", kind: "audio", engine: "WEB AUDIO · LAMEJS", accept: "M4A AAC" },
  { slug: "audio-trimmer", name: "Audio Trimmer", cat: "AUDIO", route: "AUDIO → MP3 · WAV", kind: "audio", engine: "WEB AUDIO · LAMEJS", accept: "MP3 WAV OGG M4A FLAC AAC" },
  { slug: "merge-audio", name: "Merge Audio", cat: "AUDIO", route: "AUDIO → MP3 · WAV", kind: "audio", engine: "WEB AUDIO · LAMEJS", accept: "MP3 WAV OGG M4A FLAC AAC" },
  { slug: "video-to-gif", name: "Video to GIF", cat: "VIDEO", route: "MP4 → GIF", kind: "gif", engine: "GIFENC", accept: "MP4 WEBM MOV" },
  { slug: "video-trimmer", name: "Video Trimmer", cat: "VIDEO", route: "MP4 → MP4", kind: "video", engine: "FFMPEG WASM", accept: "MP4 WEBM MOV AVI MKV" },
  { slug: "mp4-to-mp3", name: "MP4 to MP3", cat: "VIDEO", route: "MP4 → MP3", kind: "extract", engine: "FFMPEG WASM", accept: "MP4 WEBM MOV AVI MKV" },
  { slug: "webm-to-mp4", name: "WebM to MP4", cat: "VIDEO", route: "WEBM → MP4", kind: "transcode", engine: "WEBCODECS", accept: "WEBM" },
  { slug: "compress-video", name: "Compress Video", cat: "VIDEO", route: "MP4 → MP4", kind: "transcode", engine: "WEBCODECS", accept: "MP4 WEBM MOV" },
  { slug: "screen-recorder", name: "Screen Recorder", cat: "VIDEO", route: "⏺ → WEBM", kind: "record", engine: "MEDIARECORDER", accept: "SCREEN TAB WINDOW" },
  { slug: "json-formatter", name: "JSON Formatter", cat: "DEV", route: "TXT → JSON", kind: "text", engine: "NATIVE", accept: "JSON TEXT" },
  { slug: "json-to-csv", name: "JSON to CSV", cat: "DEV", route: "JSON → CSV", kind: "text", engine: "NATIVE", accept: "JSON" },
  { slug: "csv-to-json", name: "CSV to JSON", cat: "DEV", route: "CSV → JSON", kind: "text", engine: "NATIVE", accept: "CSV" },
  { slug: "sql-formatter", name: "SQL Formatter", cat: "DEV", route: "SQL → SQL", kind: "text", engine: "SQL-FORMATTER", accept: "SQL TEXT" },
  { slug: "markdown-to-html", name: "Markdown to HTML", cat: "DEV", route: "MD → HTML", kind: "text", engine: "MARKED", accept: "MD TEXT" },
  { slug: "html-to-markdown", name: "HTML to Markdown", cat: "DEV", route: "HTML → MD", kind: "text", engine: "TURNDOWN", accept: "HTML TEXT" },
  { slug: "xml-formatter", name: "XML Formatter", cat: "DEV", route: "XML → XML", kind: "text", engine: "NATIVE", accept: "XML TEXT" },
  { slug: "base64-encode-decode", name: "Base64 Encode / Decode", cat: "DEV", route: "TXT → B64", kind: "text", engine: "NATIVE", accept: "TEXT FILE" },
  { slug: "url-encode-decode", name: "URL Encode / Decode", cat: "DEV", route: "TXT → URL", kind: "text", engine: "NATIVE", accept: "TEXT" },
  { slug: "jwt-decoder", name: "JWT Decoder", cat: "DEV", route: "JWT → JSON", kind: "text", engine: "NATIVE", accept: "TEXT" },
  { slug: "html-entity-encode-decode", name: "HTML Entities", cat: "DEV", route: "TXT → HTML", kind: "text", engine: "NATIVE", accept: "TEXT" },
  { slug: "uuid-generator", name: "UUID Generator", cat: "DEV", route: "— → UUID", kind: "gen", engine: "CRYPTO", accept: "NONE" },
  { slug: "password-generator", name: "Password Generator", cat: "DEV", route: "— → TXT", kind: "gen", engine: "CRYPTO", accept: "NONE" },
  { slug: "hash-generator", name: "Hash Generator", cat: "DEV", route: "TXT → HASH", kind: "gen", engine: "SUBTLECRYPTO · MD5", accept: "TEXT FILE" },
  { slug: "lorem-ipsum-generator", name: "Lorem Ipsum", cat: "DEV", route: "— → TXT", kind: "gen", engine: "NATIVE", accept: "NONE" },
  { slug: "qr-code-generator", name: "QR Code Generator", cat: "DEV", route: "TXT → PNG", kind: "gen", engine: "QRCODE", accept: "TEXT" },
  { slug: "color-picker", name: "Color Picker", cat: "DEV", route: "— → HEX", kind: "color", engine: "NATIVE", accept: "NONE" },
  { slug: "css-gradient-generator", name: "CSS Gradient", cat: "DEV", route: "— → CSS", kind: "color", engine: "NATIVE", accept: "NONE" },
  { slug: "box-shadow-generator", name: "Box Shadow", cat: "DEV", route: "— → CSS", kind: "color", engine: "NATIVE", accept: "NONE" },
  { slug: "regex-tester", name: "Regex Tester", cat: "DEV", route: "TXT → MATCH", kind: "text", engine: "NATIVE", accept: "TEXT" },
  { slug: "cron-expression-generator", name: "Cron Expression", cat: "DEV", route: "TXT → CRON", kind: "text", engine: "NATIVE", accept: "TEXT" },
  { slug: "timestamp-converter", name: "Timestamp Converter", cat: "DEV", route: "NUM → DATE", kind: "text", engine: "NATIVE", accept: "TEXT" },
  { slug: "text-diff", name: "Text Diff", cat: "DEV", route: "TXT → DIFF", kind: "text", engine: "DIFF", accept: "TEXT" },
  { slug: "text-case-converter", name: "Text Case Converter", cat: "DEV", route: "TXT → TXT", kind: "text", engine: "NATIVE", accept: "TEXT" },
  { slug: "word-counter", name: "Word Counter", cat: "DEV", route: "TXT → STATS", kind: "text", engine: "NATIVE", accept: "TEXT" },
];

/**
 * The shipped table. `accept` is replaced by the label derived from the
 * registry wherever the tool takes files, so the ACCEPTS line, the pipeline
 * strip and the spec tile cannot state a format set the `<DropZone>` on the
 * same screen would reject (or omit one it takes).
 */
export const workspaceTools: WorkspaceTool[] = rawWorkspaceTools.map((tool) => {
  const derived = acceptLabel(tool.slug);
  return derived && derived !== tool.accept ? { ...tool, accept: derived } : tool;
});

export const workspaceToolCount = workspaceTools.length;

const bySlug = new Map(workspaceTools.map((t) => [t.slug, t]));

export function getWorkspaceTool(slug: string): WorkspaceTool | undefined {
  return bySlug.get(slug);
}


/**
 * Pipeline chips shown above the canvas, per archetype. Both surfaces read
 * these: the tool pages (ToolPageLayout) and the /workspace shell.
 *
 * A chip is a claim about what runs, so every chip here has to hold for EVERY
 * tool carrying that archetype — the honest denominator, not the most
 * interesting member. That rule retired a run of chips that lied:
 *  - "batch" advertised a "Resize" step; the one-way converters (heic-to-jpg,
 *    webp-to-jpg, png-to-jpg, …) decode and re-encode and never scale.
 *  - "audio" advertised "Trim", which mp3-to-wav, wav-to-mp3, m4a-to-mp3 and
 *    merge-audio never do. Decode → encode is what all five share.
 *  - "video" (video-trimmer alone) advertised "Encode", but video-trim.ts runs
 *    FFmpeg with `-c copy`: the clip is remuxed, never re-encoded.
 *  - "pdfpages" advertised "Extract"; rotate, page numbers and reorder write
 *    the same pages back out.
 *  - "icons" advertised "Resize ×7 / Zip", which is favicon-generator only —
 *    png-to-ico writes three sizes into one .ico and zips nothing.
 *  - "record" advertised "Trim"; ScreenRecorderUI records, pauses and stops,
 *    and has no trimming UI at all.
 *  - "color" advertised "Sample", true only of image-color-palette.
 *
 * Two tools moved archetype for the same reason rather than dragging a false
 * chip along: qr-code-generator (nothing is sampled — it generates, like the
 * other "gen" tools) and markdown-to-pdf (it parses Markdown and transforms it
 * into a print document; the browser's print dialog writes the PDF, so the
 * document-level "Write PDF" step is not the tool's).
 */
export const pipelineByArchetype: Record<Archetype, string[]> = {
  "image": ["Process", "Rename"],
  "batch": ["Decode", "Encode", "Rename"],
  "pdfpages": ["Read pages", "Write"],
  "pdfdocs": ["Read", "Write PDF"],
  "video": ["Trim", "Remux"],
  "gif": ["Sample", "Quantise", "Encode"],
  "extract": ["Demux", "Encode"],
  "transcode": ["Decode", "Encode", "Mux"],
  "audio": ["Decode", "Encode"],
  "text": ["Parse", "Transform"],
  "gen": ["Generate"],
  "icons": ["Resize", "Pack"],
  "color": ["Pick", "Format"],
  "data": ["Read tags"],
  "record": ["Capture", "Record"],
};
