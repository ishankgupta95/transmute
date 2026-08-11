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
 */

export type Archetype =
  | "image"
  | "batch"
  | "pdfpages"
  | "pdfdocs"
  | "video"
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
  /** Space-separated list of accepted input formats. */
  accept: string;
}

export const workspaceTools: WorkspaceTool[] = [
  { slug: "heic-to-jpg", name: "HEIC to JPG", cat: "IMAGE", route: "HEIC → JPG", kind: "batch", engine: "CANVAS 2D", accept: "HEIC HEIF" },
  { slug: "webp-to-jpg", name: "WebP to JPG", cat: "IMAGE", route: "WEBP → JPG", kind: "batch", engine: "CANVAS 2D", accept: "WEBP" },
  { slug: "webp-to-png", name: "WebP to PNG", cat: "IMAGE", route: "WEBP → PNG", kind: "batch", engine: "CANVAS 2D", accept: "WEBP" },
  { slug: "png-to-jpg", name: "PNG to JPG", cat: "IMAGE", route: "PNG → JPG", kind: "batch", engine: "CANVAS 2D", accept: "PNG" },
  { slug: "jpg-to-png", name: "JPG to PNG", cat: "IMAGE", route: "JPG → PNG", kind: "batch", engine: "CANVAS 2D", accept: "JPG JPEG" },
  { slug: "jpg-to-webp", name: "JPG to WebP", cat: "IMAGE", route: "JPG → WEBP", kind: "batch", engine: "CANVAS 2D", accept: "JPG JPEG" },
  { slug: "png-to-webp", name: "PNG to WebP", cat: "IMAGE", route: "PNG → WEBP", kind: "batch", engine: "CANVAS 2D", accept: "PNG" },
  { slug: "svg-to-png", name: "SVG to PNG", cat: "IMAGE", route: "SVG → PNG", kind: "image", engine: "CANVAS 2D", accept: "SVG" },
  { slug: "avif-to-jpg", name: "AVIF to JPG", cat: "IMAGE", route: "AVIF → JPG", kind: "batch", engine: "CANVAS 2D", accept: "AVIF" },
  { slug: "bmp-to-jpg", name: "BMP to JPG", cat: "IMAGE", route: "BMP → JPG", kind: "batch", engine: "CANVAS 2D", accept: "BMP" },
  { slug: "tiff-to-jpg", name: "TIFF to JPG", cat: "IMAGE", route: "TIFF → JPG", kind: "batch", engine: "CANVAS 2D", accept: "TIFF TIF" },
  { slug: "compress-image", name: "Image Compressor", cat: "IMAGE", route: "IMG → JPG", kind: "image", engine: "CANVAS 2D", accept: "JPG PNG WEBP AVIF BMP" },
  { slug: "compress-image-to-100kb", name: "Compress Image to 100 KB", cat: "IMAGE", route: "IMG → JPG", kind: "image", engine: "CANVAS 2D", accept: "JPG PNG WEBP AVIF" },
  { slug: "compress-image-to-200kb", name: "Compress Image to 200 KB", cat: "IMAGE", route: "IMG → JPG", kind: "image", engine: "CANVAS 2D", accept: "JPG PNG WEBP AVIF" },
  { slug: "compress-image-to-1mb", name: "Compress Image to 1 MB", cat: "IMAGE", route: "IMG → JPG", kind: "image", engine: "CANVAS 2D", accept: "JPG PNG WEBP AVIF" },
  { slug: "resize-image", name: "Resize Image", cat: "IMAGE", route: "IMG → IMG", kind: "image", engine: "CANVAS 2D", accept: "JPG PNG WEBP AVIF" },
  { slug: "crop-image", name: "Crop Image", cat: "IMAGE", route: "IMG → IMG", kind: "image", engine: "CANVAS 2D", accept: "JPG PNG WEBP" },
  { slug: "exif-viewer", name: "EXIF Viewer", cat: "IMAGE", route: "IMG → DATA", kind: "data", engine: "EXIFR", accept: "JPG TIFF HEIC" },
  { slug: "image-to-base64", name: "Image to Base64", cat: "IMAGE", route: "IMG → TXT", kind: "text", engine: "FILEREADER", accept: "JPG PNG WEBP SVG" },
  { slug: "png-to-ico", name: "PNG to ICO", cat: "IMAGE", route: "PNG → ICO", kind: "icons", engine: "CANVAS 2D", accept: "PNG" },
  { slug: "favicon-generator", name: "Favicon Generator", cat: "IMAGE", route: "PNG → ZIP", kind: "icons", engine: "CANVAS 2D", accept: "PNG SVG JPG" },
  { slug: "image-color-palette", name: "Image Color Palette", cat: "IMAGE", route: "IMG → HEX", kind: "color", engine: "CANVAS 2D", accept: "JPG PNG WEBP" },
  { slug: "merge-pdf", name: "Merge PDF", cat: "PDF", route: "PDF → PDF", kind: "pdfdocs", engine: "PDF-LIB", accept: "PDF" },
  { slug: "split-pdf", name: "Split PDF", cat: "PDF", route: "PDF → PDF", kind: "pdfpages", engine: "MUPDF WASM", accept: "PDF" },
  { slug: "compress-pdf", name: "Compress PDF", cat: "PDF", route: "PDF → PDF", kind: "pdfdocs", engine: "MUPDF WASM", accept: "PDF" },
  { slug: "pdf-to-jpg", name: "PDF to JPG", cat: "PDF", route: "PDF → JPG", kind: "pdfpages", engine: "PDFJS", accept: "PDF" },
  { slug: "images-to-pdf", name: "Images to PDF", cat: "PDF", route: "IMG → PDF", kind: "pdfdocs", engine: "PDF-LIB", accept: "JPG PNG WEBP" },
  { slug: "rotate-pdf", name: "Rotate PDF", cat: "PDF", route: "PDF → PDF", kind: "pdfpages", engine: "PDF-LIB", accept: "PDF" },
  { slug: "add-page-numbers", name: "Add Page Numbers", cat: "PDF", route: "PDF → PDF", kind: "pdfpages", engine: "PDF-LIB", accept: "PDF" },
  { slug: "pdf-page-reorder", name: "Reorder PDF Pages", cat: "PDF", route: "PDF → PDF", kind: "pdfpages", engine: "PDF-LIB", accept: "PDF" },
  { slug: "markdown-to-pdf", name: "Markdown to PDF", cat: "PDF", route: "MD → PDF", kind: "pdfdocs", engine: "PRINT ENGINE", accept: "MD MARKDOWN" },
  { slug: "mp3-to-wav", name: "MP3 to WAV", cat: "AUDIO", route: "MP3 → WAV", kind: "audio", engine: "WEB AUDIO", accept: "MP3" },
  { slug: "wav-to-mp3", name: "WAV to MP3", cat: "AUDIO", route: "WAV → MP3", kind: "audio", engine: "LAMEJS", accept: "WAV" },
  { slug: "m4a-to-mp3", name: "M4A to MP3", cat: "AUDIO", route: "M4A → MP3", kind: "audio", engine: "LAMEJS", accept: "M4A AAC" },
  { slug: "audio-trimmer", name: "Audio Trimmer", cat: "AUDIO", route: "AUDIO → MP3", kind: "audio", engine: "WEB AUDIO", accept: "MP3 WAV OGG M4A FLAC" },
  { slug: "merge-audio", name: "Merge Audio", cat: "AUDIO", route: "AUDIO → MP3", kind: "audio", engine: "WEB AUDIO", accept: "MP3 WAV M4A" },
  { slug: "video-to-gif", name: "Video to GIF", cat: "VIDEO", route: "MP4 → GIF", kind: "video", engine: "FFMPEG WASM", accept: "MP4 WEBM MOV" },
  { slug: "video-trimmer", name: "Video Trimmer", cat: "VIDEO", route: "MP4 → MP4", kind: "video", engine: "FFMPEG WASM", accept: "MP4 WEBM MOV" },
  { slug: "mp4-to-mp3", name: "MP4 to MP3", cat: "VIDEO", route: "MP4 → MP3", kind: "video", engine: "FFMPEG WASM", accept: "MP4 MOV M4V" },
  { slug: "webm-to-mp4", name: "WebM to MP4", cat: "VIDEO", route: "WEBM → MP4", kind: "video", engine: "FFMPEG WASM", accept: "WEBM" },
  { slug: "compress-video", name: "Compress Video", cat: "VIDEO", route: "MP4 → MP4", kind: "video", engine: "WEBCODECS", accept: "MP4 WEBM MOV" },
  { slug: "screen-recorder", name: "Screen Recorder", cat: "VIDEO", route: "⏺ → WEBM", kind: "record", engine: "MEDIARECORDER", accept: "SCREEN TAB WINDOW" },
  { slug: "json-formatter", name: "JSON Formatter", cat: "DEV", route: "TXT → JSON", kind: "text", engine: "NATIVE", accept: "JSON TEXT" },
  { slug: "json-to-csv", name: "JSON to CSV", cat: "DEV", route: "JSON → CSV", kind: "text", engine: "NATIVE", accept: "JSON" },
  { slug: "csv-to-json", name: "CSV to JSON", cat: "DEV", route: "CSV → JSON", kind: "text", engine: "NATIVE", accept: "CSV" },
  { slug: "sql-formatter", name: "SQL Formatter", cat: "DEV", route: "SQL → SQL", kind: "text", engine: "SQL-FORMATTER", accept: "SQL TEXT" },
  { slug: "markdown-to-html", name: "Markdown to HTML", cat: "DEV", route: "MD → HTML", kind: "text", engine: "MARKED", accept: "MD TEXT" },
  { slug: "html-to-markdown", name: "HTML to Markdown", cat: "DEV", route: "HTML → MD", kind: "text", engine: "TURNDOWN", accept: "HTML TEXT" },
  { slug: "xml-formatter", name: "XML Formatter", cat: "DEV", route: "XML → XML", kind: "text", engine: "NATIVE", accept: "XML TEXT" },
  { slug: "base64-encode-decode", name: "Base64 Encode / Decode", cat: "DEV", route: "TXT → B64", kind: "text", engine: "NATIVE", accept: "TEXT" },
  { slug: "url-encode-decode", name: "URL Encode / Decode", cat: "DEV", route: "TXT → URL", kind: "text", engine: "NATIVE", accept: "TEXT" },
  { slug: "jwt-decoder", name: "JWT Decoder", cat: "DEV", route: "JWT → JSON", kind: "text", engine: "NATIVE", accept: "TEXT" },
  { slug: "html-entity-encode-decode", name: "HTML Entities", cat: "DEV", route: "TXT → HTML", kind: "text", engine: "NATIVE", accept: "TEXT" },
  { slug: "uuid-generator", name: "UUID Generator", cat: "DEV", route: "— → UUID", kind: "gen", engine: "CRYPTO", accept: "NONE" },
  { slug: "password-generator", name: "Password Generator", cat: "DEV", route: "— → TXT", kind: "gen", engine: "CRYPTO", accept: "NONE" },
  { slug: "hash-generator", name: "Hash Generator", cat: "DEV", route: "TXT → HASH", kind: "gen", engine: "SUBTLECRYPTO", accept: "TEXT FILE" },
  { slug: "lorem-ipsum-generator", name: "Lorem Ipsum", cat: "DEV", route: "— → TXT", kind: "gen", engine: "NATIVE", accept: "NONE" },
  { slug: "qr-code-generator", name: "QR Code Generator", cat: "DEV", route: "TXT → PNG", kind: "color", engine: "QRCODE", accept: "TEXT" },
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

export const workspaceToolCount = workspaceTools.length;

const bySlug = new Map(workspaceTools.map((t) => [t.slug, t]));

export function getWorkspaceTool(slug: string): WorkspaceTool | undefined {
  return bySlug.get(slug);
}


/**
 * Pipeline chips shown above the canvas, per archetype. Both surfaces read
 * these: the tool pages (ToolPageLayout) and the /workspace shell.
 */
export const pipelineByArchetype: Record<Archetype, string[]> = {
  "image": ["Process", "Rename"],
  "batch": ["Convert", "Resize", "Rename"],
  "pdfpages": ["Read", "Extract"],
  "pdfdocs": ["Assemble", "Optimise"],
  "video": ["Trim", "Encode"],
  "audio": ["Trim", "Encode"],
  "text": ["Parse", "Transform"],
  "gen": ["Generate"],
  "icons": ["Resize ×7", "Zip"],
  "color": ["Sample", "Format"],
  "data": ["Read tags"],
  "record": ["Record", "Trim"],
};
