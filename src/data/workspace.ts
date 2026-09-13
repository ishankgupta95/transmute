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
  | "pdfimages"
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
  | "record"
  /*
    Two archetypes added with the audio-effects and frame clusters, because no
    existing chip list held for them. `audiofilter` is the two pages that build
    an FFmpeg filtergraph — "Decode, Encode" understates a run whose whole
    point is the filter in the middle. `frames` is the two pages that sample
    pictures out of a clip: not a Remux, not a Demux, and not the audio
    Decode→Encode either.
  */
  | "audiofilter"
  | "frames";

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
  { slug: "heic-to-jpg", name: "HEIC to JPG", cat: "IMAGE", route: "HEIC → JPG", kind: "batch", engine: "LIBHEIF", accept: "HEIC" },
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
  // The route stopped saying "IMG → IMG" when the cropper gained the shared
  // output-format picker: it writes PNG, JPG or WebP now, and the row that
  // feeds the ACCEPTS/route strip has to say which. `resize-image` above still
  // says "IMG → IMG" because it genuinely re-encodes back to the source type.
  { slug: "crop-image", name: "Crop Image", cat: "IMAGE", route: "IMG → PNG · JPG · WEBP", kind: "image", engine: "CANVAS 2D", accept: "JPG PNG WEBP AVIF BMP GIF" },
  { slug: "exif-viewer", name: "EXIF Viewer", cat: "IMAGE", route: "IMG → DATA", kind: "data", engine: "EXIFREADER", accept: "JPG PNG WEBP TIFF HEIC" },
  { slug: "image-to-base64", name: "Image to Base64", cat: "IMAGE", route: "IMG → TXT", kind: "text", engine: "FILEREADER", accept: "JPG PNG WEBP GIF SVG BMP AVIF" },
  { slug: "png-to-ico", name: "PNG to ICO", cat: "IMAGE", route: "PNG → ICO", kind: "icons", engine: "CANVAS 2D", accept: "PNG" },
  { slug: "favicon-generator", name: "Favicon Generator", cat: "IMAGE", route: "PNG → ZIP", kind: "icons", engine: "CANVAS 2D · JSZIP", accept: "PNG JPG SVG WEBP" },
  { slug: "image-color-palette", name: "Image Color Palette", cat: "IMAGE", route: "IMG → HEX", kind: "color", engine: "CANVAS 2D", accept: "JPG PNG WEBP AVIF BMP GIF" },
  /*
    ── Wave 4's image cluster ────────────────────────────────────────────────
    Nineteen rows. Twelve are pages with a component of their own; the last
    seven are registry data only — `tiff-to-png`, the two AVIF pairs,
    `bmp-to-png`, the two SVG rasterisers and `heic-to-webp` all mount the same
    ImageConverterClient that `avif-to-jpg` and `svg-to-png` at the top of this
    block already mount, so their rows are the only thing that distinguishes
    them here.

    No new archetype, and none was needed. The eight edit verbs, `compress-png`,
    `ico-to-png` and `change-image-dpi` take `image` ("Process, Rename") — the
    same chips `crop-image` and `resize-image` already carry. The four pairwise
    format converters take `batch` ("Decode, Encode, Rename") like the nine
    converters above, and the two SVG pages follow `svg-to-png` onto `image`
    rather than `batch`, because rasterising a document is not the decode of a
    picture that chip claims.

    Two rows a reviewer would expect on `batch` are deliberately not:
      - `compress-png` never produces a raster at all. oxipng recompresses the
        IDAT stream in place, and "Decode, Encode" is precisely the canvas
        round-trip that page exists to replace — the chip would advertise the
        no-op.
      - `ico-to-png` slices a PNG-encoded directory entry straight out of the
        .ico, and the page calls that entry lossless on exactly that basis. A
        chip list promising an encode would contradict the claim under it.
    `base64-to-image` takes `text`, mirroring `image-to-base64` above, which
    runs the same trip the other way: this page parses text it was handed and
    transforms it, and generates nothing out of settings.

    `engine` names what each page runs. OXIPNG is the new WebAssembly this
    origin serves; ICO PARSER is our own directory walk rather than a library,
    because `createImageBitmap` on an .ico returns one image and will not say
    which entry it picked; BYTE REWRITE is `change-image-dpi`, which must never
    decode, since every canvas re-encode destroys the density field it is there
    to set; and ATOB is the browser's own base64 decoder.

    `image-splitter` is the one multi-file output, and its route says ZIP
    rather than a format list because the archive is what the page hands over.
    jszip is imported at save time, so both names belong on the row.

    `heic-to-webp` is the only row in the batch that moves the homepage
    conversion matrix — see the "Deliberately still empty" note in
    `src/components/home/ConversionMatrix.tsx`.
  */
  { slug: "rotate-image", name: "Rotate Image", cat: "IMAGE", route: "IMG → PNG · JPG · WEBP", kind: "image", engine: "CANVAS 2D", accept: "JPG PNG WEBP AVIF BMP GIF" },
  { slug: "flip-image", name: "Flip Image", cat: "IMAGE", route: "IMG → PNG · JPG · WEBP", kind: "image", engine: "CANVAS 2D", accept: "JPG PNG WEBP AVIF BMP GIF" },
  { slug: "watermark-image", name: "Watermark Image", cat: "IMAGE", route: "IMG → PNG · JPG · WEBP", kind: "image", engine: "CANVAS 2D", accept: "JPG PNG WEBP BMP GIF AVIF" },
  { slug: "pixelate-image", name: "Pixelate Image", cat: "IMAGE", route: "IMG → PNG · JPG · WEBP", kind: "image", engine: "CANVAS 2D", accept: "JPG PNG WEBP BMP GIF AVIF" },
  // PNG and WebP only: the circle is cut with `destination-in`, so the output
  // format has to carry alpha or the corners come back as a filled rectangle.
  { slug: "crop-circle", name: "Circle Image Cropper", cat: "IMAGE", route: "IMG → PNG · WEBP", kind: "image", engine: "CANVAS 2D", accept: "JPG PNG WEBP AVIF BMP GIF" },
  { slug: "add-border", name: "Add Border", cat: "IMAGE", route: "IMG → PNG · JPG · WEBP", kind: "image", engine: "CANVAS 2D", accept: "JPG PNG WEBP AVIF BMP GIF" },
  { slug: "social-media-image-resizer", name: "Social Media Image Resizer", cat: "IMAGE", route: "IMG → PNG · JPG · WEBP", kind: "image", engine: "CANVAS 2D", accept: "JPG PNG WEBP AVIF BMP GIF" },
  { slug: "image-splitter", name: "Image Splitter", cat: "IMAGE", route: "IMG → ZIP", kind: "image", engine: "CANVAS 2D · JSZIP", accept: "JPG PNG WEBP AVIF BMP GIF" },
  { slug: "compress-png", name: "Compress PNG", cat: "IMAGE", route: "PNG → PNG", kind: "image", engine: "OXIPNG", accept: "PNG" },
  { slug: "resize-gif", name: "Resize GIF", cat: "IMAGE", route: "GIF → GIF", kind: "image", engine: "GIFENC", accept: "GIF" },
  { slug: "gif-speed-changer", name: "GIF Speed Changer", cat: "IMAGE", route: "GIF → GIF", kind: "image", engine: "GIFENC", accept: "GIF" },
  { slug: "reverse-gif", name: "Reverse GIF", cat: "IMAGE", route: "GIF → GIF", kind: "image", engine: "GIFENC", accept: "GIF" },
  { slug: "split-gif", name: "Split GIF into Frames", cat: "IMAGE", route: "GIF → ZIP", kind: "image", engine: "GIFENC", accept: "GIF" },
  { slug: "gif-maker", name: "GIF Maker", cat: "IMAGE", route: "IMAGES → GIF", kind: "image", engine: "GIFENC", accept: "JPG PNG WEBP BMP GIF" },
  { slug: "bcrypt-generator", name: "Bcrypt Generator", cat: "DEV", route: "— → HASH", kind: "gen", engine: "BCRYPTJS", accept: "NONE" },
  { slug: "csv-markdown-table", name: "CSV to Markdown Table", cat: "DEV", route: "CSV → MD", kind: "text", engine: "NATIVE JS", accept: "CSV MD" },
  { slug: "vcf-to-csv", name: "VCF to CSV", cat: "DEV", route: "VCF → CSV", kind: "text", engine: "NATIVE JS", accept: "VCF" },
  { slug: "ics-to-csv", name: "ICS to CSV", cat: "DEV", route: "ICS → CSV", kind: "text", engine: "NATIVE JS", accept: "ICS" },
  { slug: "ocr-pdf", name: "OCR PDF", cat: "PDF", route: "PDF → PDF", kind: "pdfpages", engine: "TESSERACT · PDF-LIB", accept: "PDF" },
  { slug: "image-to-text", name: "Image to Text", cat: "IMAGE", route: "IMG → TEXT", kind: "text", engine: "TESSERACT", accept: "JPG PNG WEBP BMP GIF" },
  { slug: "ico-to-png", name: "ICO to PNG", cat: "IMAGE", route: "ICO → PNG", kind: "image", engine: "ICO PARSER", accept: "ICO CUR" },
  // No file in — the input is pasted text — so `accept` stays the literal, the
  // same shape `base64-encode-decode` and the two recorders use. It says TEXT
  // and not a format list on purpose: the homepage matrix's empty-cell walk
  // reads this label as the tool's statement of what it accepts whenever
  // `acceptFormats` is empty, and a format token here would be read as a claim
  // about a grid row.
  { slug: "base64-to-image", name: "Base64 to Image", cat: "IMAGE", route: "TXT → IMG", kind: "text", engine: "ATOB", accept: "TEXT" },
  { slug: "change-image-dpi", name: "Change Image DPI", cat: "IMAGE", route: "IMG → IMG", kind: "image", engine: "BYTE REWRITE", accept: "JPG PNG" },
  { slug: "tiff-to-png", name: "TIFF to PNG", cat: "IMAGE", route: "TIFF → PNG", kind: "batch", engine: "UTIF2", accept: "TIFF" },
  { slug: "avif-to-png", name: "AVIF to PNG", cat: "IMAGE", route: "AVIF → PNG", kind: "batch", engine: "CANVAS 2D", accept: "AVIF" },
  { slug: "avif-to-webp", name: "AVIF to WebP", cat: "IMAGE", route: "AVIF → WEBP", kind: "batch", engine: "CANVAS 2D", accept: "AVIF" },
  { slug: "bmp-to-png", name: "BMP to PNG", cat: "IMAGE", route: "BMP → PNG", kind: "batch", engine: "CANVAS 2D", accept: "BMP" },
  { slug: "svg-to-jpg", name: "SVG to JPG", cat: "IMAGE", route: "SVG → JPG", kind: "image", engine: "CANVAS 2D", accept: "SVG" },
  { slug: "svg-to-webp", name: "SVG to WebP", cat: "IMAGE", route: "SVG → WEBP", kind: "image", engine: "CANVAS 2D", accept: "SVG" },
  { slug: "heic-to-webp", name: "HEIC to WebP", cat: "IMAGE", route: "HEIC → WEBP", kind: "batch", engine: "LIBHEIF", accept: "HEIC" },
  { slug: "merge-pdf", name: "Merge PDF", cat: "PDF", route: "PDF → PDF", kind: "pdfdocs", engine: "PDF-LIB", accept: "PDF" },
  { slug: "split-pdf", name: "Split PDF", cat: "PDF", route: "PDF → PDF", kind: "pdfpages", engine: "PDF-LIB", accept: "PDF" },
  { slug: "compress-pdf", name: "Compress PDF", cat: "PDF", route: "PDF → PDF", kind: "pdfdocs", engine: "PDF-LIB", accept: "PDF" },
  // pdf-lib does the document surgery; the JPEG decode/re-encode is an
  // OffscreenCanvas round-trip in the worker, so both are named.
  { slug: "recompress-pdf-images", name: "Recompress PDF Images", cat: "PDF", route: "PDF → PDF", kind: "pdfdocs", engine: "CANVAS 2D · PDF-LIB", accept: "PDF" },
  { slug: "pdf-to-jpg", name: "PDF to JPG", cat: "PDF", route: "PDF → JPG · PNG · WEBP", kind: "pdfpages", engine: "PDFJS", accept: "PDF" },
  { slug: "pdf-to-png", name: "PDF to PNG", cat: "PDF", route: "PDF → PNG", kind: "pdfpages", engine: "PDFJS", accept: "PDF" },
  { slug: "pdf-to-webp", name: "PDF to WebP", cat: "PDF", route: "PDF → WEBP", kind: "pdfpages", engine: "PDFJS", accept: "PDF" },
  { slug: "images-to-pdf", name: "Images to PDF", cat: "PDF", route: "IMG → PDF", kind: "pdfdocs", engine: "PDF-LIB", accept: "JPG PNG WEBP HEIC TIFF" },
  { slug: "jpg-to-pdf", name: "JPG to PDF", cat: "PDF", route: "JPG → PDF", kind: "pdfdocs", engine: "PDF-LIB", accept: "JPG" },
  { slug: "png-to-pdf", name: "PNG to PDF", cat: "PDF", route: "PNG → PDF", kind: "pdfdocs", engine: "PDF-LIB", accept: "PNG" },
  { slug: "heic-to-pdf", name: "HEIC to PDF", cat: "PDF", route: "HEIC → PDF", kind: "pdfdocs", engine: "LIBHEIF · PDF-LIB", accept: "HEIC" },
  { slug: "webp-to-pdf", name: "WebP to PDF", cat: "PDF", route: "WEBP → PDF", kind: "pdfdocs", engine: "CANVAS 2D · PDF-LIB", accept: "WEBP" },
  { slug: "tiff-to-pdf", name: "TIFF to PDF", cat: "PDF", route: "TIFF → PDF", kind: "pdfdocs", engine: "UTIF2 · PDF-LIB", accept: "TIFF" },
  { slug: "rotate-pdf", name: "Rotate PDF", cat: "PDF", route: "PDF → PDF", kind: "pdfpages", engine: "PDF-LIB", accept: "PDF" },
  { slug: "add-page-numbers", name: "Add Page Numbers", cat: "PDF", route: "PDF → PDF", kind: "pdfpages", engine: "PDF-LIB", accept: "PDF" },
  { slug: "pdf-page-reorder", name: "Reorder PDF Pages", cat: "PDF", route: "PDF → PDF", kind: "pdfpages", engine: "PDF-LIB", accept: "PDF" },
  // `engine` names what the tool actually runs. The three geometry tools below
  // are pdf-lib operations, but their UIs also open the document with pdfjs to
  // render or measure page 1 — so both libraries are named rather than the one
  // that does the writing.
  { slug: "extract-pdf-pages", name: "Extract PDF Pages", cat: "PDF", route: "PDF → PDF · ZIP", kind: "pdfpages", engine: "PDF-LIB", accept: "PDF" },
  { slug: "delete-pdf-pages", name: "Delete PDF Pages", cat: "PDF", route: "PDF → PDF", kind: "pdfpages", engine: "PDF-LIB", accept: "PDF" },
  { slug: "crop-pdf", name: "Crop PDF", cat: "PDF", route: "PDF → PDF", kind: "pdfpages", engine: "PDFJS · PDF-LIB", accept: "PDF" },
  { slug: "pdf-editor", name: "PDF Editor", cat: "PDF", route: "PDF \u2192 PDF", kind: "pdfpages", engine: "PDFJS \u00b7 PDF-LIB", accept: "PDF" },
  { slug: "watermark-pdf", name: "Watermark PDF", cat: "PDF", route: "PDF → PDF", kind: "pdfpages", engine: "PDFJS · PDF-LIB", accept: "PDF" },
  { slug: "sign-pdf", name: "Sign PDF", cat: "PDF", route: "PDF → PDF", kind: "pdfpages", engine: "PDFJS · PDF-LIB", accept: "PDF" },
  { slug: "add-image-to-pdf", name: "Add Image to PDF", cat: "PDF", route: "PDF → PDF", kind: "pdfpages", engine: "PDFJS · PDF-LIB", accept: "PDF" },
  { slug: "annotate-pdf", name: "Annotate PDF", cat: "PDF", route: "PDF → PDF", kind: "pdfpages", engine: "PDFJS · PDF-LIB", accept: "PDF" },
  { slug: "fill-pdf-form", name: "Fill PDF Form", cat: "PDF", route: "PDF → PDF", kind: "pdfdocs", engine: "PDF-LIB", accept: "PDF" },
  { slug: "flatten-pdf", name: "Flatten PDF", cat: "PDF", route: "PDF → PDF", kind: "pdfdocs", engine: "PDF-LIB", accept: "PDF" },
  { slug: "remove-metadata", name: "Remove Metadata", cat: "PDF", route: "PDF · IMAGE → CLEANED", kind: "data", engine: "CANVAS 2D · PDF-LIB", accept: "JPG PNG WEBP TIFF HEIC PDF" },
  { slug: "change-pdf-page-size", name: "Change PDF Page Size", cat: "PDF", route: "PDF → PDF", kind: "pdfpages", engine: "PDFJS · PDF-LIB", accept: "PDF" },
  { slug: "pdf-resizer", name: "PDF Resizer", cat: "PDF", route: "PDF → PDF", kind: "pdfdocs", engine: "PDFJS · PDF-LIB", accept: "PDF" },
  { slug: "pdf-to-text", name: "PDF to Text", cat: "PDF", route: "PDF → TXT", kind: "text", engine: "PDFJS", accept: "PDF" },
  // The one tool in the category that reads the object graph rather than the
  // pages — which is why it carries its own archetype: "Read pages" would be
  // the wrong claim, and "Demux" (the `extract` archetype's chip) is a video
  // word for something this does not do.
  { slug: "extract-images-from-pdf", name: "Extract Images from PDF", cat: "PDF", route: "PDF → JPG · PNG · ZIP", kind: "pdfimages", engine: "PDF-LIB · JSZIP", accept: "PDF" },
  // The only four tools on the site that run qpdf, and the only PDF tools that
  // touch neither pdf-lib nor pdfjs: encryption, decryption and structural
  // repair are all one qpdf invocation over the whole document, so "QPDF" on
  // its own is the honest engine label rather than a pair.
  { slug: "protect-pdf", name: "Protect PDF", cat: "PDF", route: "PDF → PDF", kind: "pdfdocs", engine: "QPDF", accept: "PDF" },
  { slug: "unlock-pdf", name: "Unlock PDF", cat: "PDF", route: "PDF → PDF", kind: "pdfdocs", engine: "QPDF", accept: "PDF" },
  { slug: "pdf-permissions", name: "PDF Permissions", cat: "PDF", route: "PDF → PDF", kind: "pdfdocs", engine: "QPDF", accept: "PDF" },
  { slug: "repair-pdf", name: "Repair PDF", cat: "PDF", route: "PDF → PDF", kind: "pdfdocs", engine: "QPDF", accept: "PDF" },
  { slug: "markdown-to-pdf", name: "Markdown to PDF", cat: "PDF", route: "MD → PDF", kind: "text", engine: "MARKED · PRINT", accept: "MD TXT" },
  // All five audio tools decode through `decodeAudioFile`
  // (`lib/tools/audio-decode.ts`), which dynamically imports `ffmpeg-loader`
  // and transcodes to WAV whenever `decodeAudioData` rejects the container —
  // M4A/AAC in Firefox, Ogg in Safari, and any of the six extensions when the
  // browser's own decoder balks (`FFMPEG_FALLBACK_EXTS` covers mp3 and wav
  // too). That is a ~31 MB fetch, and none of these rows named it.
  //
  // The separator is tightened to a bare "·" on the four rows that need three
  // names. MEASURED: the ENGINE value in ToolPageLayout's 250 px spec tile is
  // `min-w-0 truncate` with 170 px of room at font-mono 11px = 6.6 px/char,
  // i.e. 25 characters. "WEB AUDIO · LAMEJS · FFMPEG" is 27 and renders
  // ellipsised (scrollWidth 178 > clientWidth 170); at 23 characters this form
  // fits with room to spare. mp3-to-wav needs only two names, so it keeps the
  // site-wide " · ".
  { slug: "mp3-to-wav", name: "MP3 to WAV", cat: "AUDIO", route: "MP3 → WAV", kind: "audio", engine: "WEB AUDIO · FFMPEG", accept: "MP3" },
  { slug: "wav-to-mp3", name: "WAV to MP3", cat: "AUDIO", route: "WAV → MP3", kind: "audio", engine: "WEB AUDIO·LAMEJS·FFMPEG", accept: "WAV" },
  { slug: "m4a-to-mp3", name: "M4A to MP3", cat: "AUDIO", route: "M4A → MP3", kind: "audio", engine: "WEB AUDIO·LAMEJS·FFMPEG", accept: "M4A AAC" },
  { slug: "audio-trimmer", name: "Audio Trimmer", cat: "AUDIO", route: "AUDIO → MP3 · WAV", kind: "audio", engine: "WEB AUDIO·LAMEJS·FFMPEG", accept: "MP3 WAV OGG M4A FLAC AAC" },
  { slug: "merge-audio", name: "Merge Audio", cat: "AUDIO", route: "AUDIO → MP3 · WAV", kind: "audio", engine: "WEB AUDIO·LAMEJS·FFMPEG", accept: "MP3 WAV OGG M4A FLAC AAC" },
  /*
    The audio-effects rows. The two `audiofilter` pages name the FILTER rather
    than the library, because that is what distinguishes them — both are
    entirely FFmpeg, decode and encode included (`audio-effects.ts`
    normalizeAudio / removeSilence).

    The two Web Audio pages carry the same three-name engine as audio-trimmer,
    and for the same reasons: `decodeAudioFile` falls back to FFmpeg for any
    container the browser refuses, and FLAC output has no encoder in the audio
    worker, so that arm hands a lossless WAV to `convertAudio` — FFmpeg. A flat
    "WEB AUDIO" would be untrue of both arms. 23 chars, so it fits the 25-char
    spec tile.
  */
  { slug: "normalize-audio", name: "Normalize Audio", cat: "AUDIO", route: "AUDIO → MP3 · WAV · FLAC", kind: "audiofilter", engine: "FFMPEG LOUDNORM", accept: "MP3 WAV OGG M4A FLAC AAC OPUS WMA" },
  { slug: "change-audio-volume", name: "Change Audio Volume", cat: "AUDIO", route: "AUDIO → MP3 · WAV · FLAC", kind: "audio", engine: "WEB AUDIO·LAMEJS·FFMPEG", accept: "MP3 WAV OGG M4A FLAC AAC OPUS WMA" },
  { slug: "reverse-audio", name: "Reverse Audio", cat: "AUDIO", route: "AUDIO → MP3 · WAV · FLAC", kind: "audio", engine: "WEB AUDIO·LAMEJS·FFMPEG", accept: "MP3 WAV OGG M4A FLAC AAC OPUS WMA" },
  { slug: "remove-silence", name: "Remove Silence", cat: "AUDIO", route: "AUDIO → MP3 · WAV · FLAC", kind: "audiofilter", engine: "FFMPEG SILENCEREMOVE", accept: "MP3 WAV OGG M4A FLAC AAC OPUS WMA" },
  // No file in, so `accept` is the literal rather than a derived label — the
  // same shape screen-recorder uses, and the "⏺" side keeps the route to one
  // arrow.
  { slug: "audio-recorder", name: "Audio Recorder", cat: "AUDIO", route: "⏺ → WEBM · OGG · M4A", kind: "record", engine: "MEDIARECORDER", accept: "MICROPHONE" },
  // The eight `audio-convert` pages. All eight carry `kind: "audio"`, whose
  // chips are ["Decode", "Encode"] — true of every one of them, because not a
  // single conversion in this block is a stream copy. `engine` names all three
  // libraries for the MP3 targets (lamejs writes the MP3, FFmpeg decodes what
  // the browser will not); wma-to-mp3 names FFmpeg first because there is no
  // browser decoder for WMA at all, and wav-to-flac names it because the FLAC
  // ENCODE is FFmpeg's — the audio worker writes MP3 and WAV only.
  { slug: "flac-to-mp3", name: "FLAC to MP3", cat: "AUDIO", route: "FLAC → MP3", kind: "audio", engine: "WEB AUDIO·LAMEJS·FFMPEG", accept: "FLAC" },
  { slug: "ogg-to-mp3", name: "OGG to MP3", cat: "AUDIO", route: "OGG → MP3", kind: "audio", engine: "WEB AUDIO·LAMEJS·FFMPEG", accept: "OGG OGA" },
  { slug: "aac-to-mp3", name: "AAC to MP3", cat: "AUDIO", route: "AAC → MP3", kind: "audio", engine: "WEB AUDIO·LAMEJS·FFMPEG", accept: "AAC M4A" },
  { slug: "opus-to-mp3", name: "Opus to MP3", cat: "AUDIO", route: "OPUS → MP3", kind: "audio", engine: "WEB AUDIO·LAMEJS·FFMPEG", accept: "OPUS OGG" },
  { slug: "m4a-to-wav", name: "M4A to WAV", cat: "AUDIO", route: "M4A → WAV", kind: "audio", engine: "WEB AUDIO · FFMPEG", accept: "M4A AAC" },
  { slug: "wav-to-flac", name: "WAV to FLAC", cat: "AUDIO", route: "WAV → FLAC", kind: "audio", engine: "FFMPEG · WEB AUDIO", accept: "WAV" },
  { slug: "mp3-converter", name: "MP3 Converter", cat: "AUDIO", route: "AUDIO → MP3", kind: "audio", engine: "WEB AUDIO·LAMEJS·FFMPEG", accept: "MP3 WAV M4A AAC FLAC OGG OPUS WMA" },
  { slug: "wma-to-mp3", name: "WMA to MP3", cat: "AUDIO", route: "WMA → MP3", kind: "audio", engine: "FFMPEG · LAMEJS", accept: "WMA" },
  { slug: "video-to-gif", name: "Video to GIF", cat: "VIDEO", route: "MP4 → GIF", kind: "gif", engine: "GIFENC", accept: "MP4 WEBM MOV" },
  { slug: "video-trimmer", name: "Video Trimmer", cat: "VIDEO", route: "MP4 → MP4", kind: "video", engine: "FFMPEG WASM", accept: "MP4 WEBM MOV AVI MKV" },
  { slug: "mp4-to-mp3", name: "MP4 to MP3", cat: "VIDEO", route: "MP4 → MP3", kind: "extract", engine: "FFMPEG WASM", accept: "MP4 WEBM MOV AVI MKV" },
  { slug: "webm-to-mp4", name: "WebM to MP4", cat: "VIDEO", route: "WEBM → MP4", kind: "transcode", engine: "WEBCODECS", accept: "WEBM" },
  { slug: "compress-video", name: "Compress Video", cat: "VIDEO", route: "MP4 → MP4", kind: "transcode", engine: "WEBCODECS", accept: "MP4 WEBM MOV" },
  { slug: "compress-video-to-size", name: "Compress Video to Size", cat: "VIDEO", route: "VIDEO → MP4", kind: "transcode", engine: "WEBCODECS", accept: "MP4 WEBM MOV" },
  { slug: "screen-recorder", name: "Screen Recorder", cat: "VIDEO", route: "⏺ → WEBM", kind: "record", engine: "MEDIARECORDER", accept: "SCREEN TAB WINDOW" },
  { slug: "webcam-recorder", name: "Webcam Recorder", cat: "VIDEO", route: "⏺ → WEBM · MP4", kind: "record", engine: "MEDIARECORDER", accept: "CAMERA MIC" },
  /*
    The frame pages import no engine at all: `video-frames.ts` walks the
    browser's own decoder through a canvas (the `playAndExtractFrames` reuse)
    and only `video-to-images` pulls in jszip, for the archive. So the ZIP tool
    names both and the single-still tool names only the canvas — naming an
    engine neither downloads would be the drift this field exists to stop.
  */
  { slug: "video-to-images", name: "Video to Images", cat: "VIDEO", route: "VIDEO → PNG · JPG · WEBP", kind: "frames", engine: "CANVAS · JSZIP", accept: "MP4 WEBM MOV" },
  { slug: "video-thumbnail", name: "Video Thumbnail", cat: "VIDEO", route: "VIDEO → JPG · PNG · WEBP", kind: "frames", engine: "CANVAS", accept: "MP4 WEBM MOV" },
  // Both are `-c copy` stream copies, so both sit on "video": ["Remux"] with
  // the container tools rather than on a chip list that would imply a decode.
  { slug: "split-video", name: "Split Video", cat: "VIDEO", route: "VIDEO → ZIP OF PARTS", kind: "video", engine: "FFMPEG WASM", accept: "MP4 WEBM MOV AVI MKV" },
  { slug: "merge-video", name: "Merge Video", cat: "VIDEO", route: "VIDEO · VIDEO → ONE", kind: "video", engine: "FFMPEG WASM", accept: "MP4 MOV MKV WEBM" },
  { slug: "video-to-mp4", name: "Video to MP4", cat: "VIDEO", route: "MOV · MKV · AVI → MP4", kind: "video", engine: "FFMPEG WASM", accept: "MOV MKV AVI M4V" },
  { slug: "mov-to-mp4", name: "MOV to MP4", cat: "VIDEO", route: "MOV → MP4", kind: "video", engine: "FFMPEG WASM", accept: "MOV" },
  { slug: "mp4-to-mov", name: "MP4 to MOV", cat: "VIDEO", route: "MP4 → MOV", kind: "video", engine: "FFMPEG WASM", accept: "MP4 M4V" },
  { slug: "mkv-to-mp4", name: "MKV to MP4", cat: "VIDEO", route: "MKV → MP4", kind: "video", engine: "FFMPEG WASM", accept: "MKV" },
  { slug: "mp4-to-mkv", name: "MP4 to MKV", cat: "VIDEO", route: "MP4 → MKV", kind: "video", engine: "FFMPEG WASM", accept: "MP4 M4V" },
  { slug: "avi-to-mp4", name: "AVI to MP4", cat: "VIDEO", route: "AVI → MP4", kind: "video", engine: "FFMPEG WASM", accept: "AVI" },
  { slug: "mute-video", name: "Mute Video", cat: "VIDEO", route: "VIDEO → MUTED", kind: "video", engine: "FFMPEG WASM", accept: "MP4 MOV MKV M4V" },
  { slug: "rotate-video", name: "Rotate Video", cat: "VIDEO", route: "VIDEO → ROTATED", kind: "video", engine: "FFMPEG WASM", accept: "MP4 MOV M4V" },
  // The three `extract-audio` pages, alongside `mp4-to-mp3` in the same
  // archetype — which is why "extract" lost its "Encode" chip below: the hub
  // OPENS on the lossless copy arm, so an encode is not what its default run
  // performs.
  { slug: "extract-audio", name: "Extract Audio", cat: "VIDEO", route: "VIDEO → AUDIO", kind: "extract", engine: "FFMPEG WASM", accept: "MP4 WEBM MOV AVI MKV" },
  { slug: "video-to-wav", name: "Video to WAV", cat: "VIDEO", route: "VIDEO → WAV", kind: "extract", engine: "FFMPEG WASM", accept: "MP4 WEBM MOV AVI MKV" },
  { slug: "mp4-to-wav", name: "MP4 to WAV", cat: "VIDEO", route: "MP4 → WAV", kind: "extract", engine: "FFMPEG WASM", accept: "MP4 M4V MOV" },
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
  // The first DEV row whose `accept` is DERIVED rather than literal: the File
  // arm mounts a real DropZone, so the registry carries a picker string and the
  // ACCEPTS line is pinned to it by the same gate the media tools use. The
  // Wave 4 block below is mostly more of the same.
  { slug: "subtitle-converter", name: "Subtitle Converter", cat: "DEV", route: "SUBS → SRT · VTT · ASS", kind: "text", engine: "NATIVE", accept: "SRT VTT ASS SSA" },
  /*
    ── Wave 4's developer fills ──────────────────────────────────────────────
    Nineteen rows and only two archetypes between them: `text` for the pages
    that transform something you already have, `gen` for the four that make a
    new artefact out of settings. Nothing here needed a new archetype, which is
    the point — an archetype is a pipeline claim, and "Parse, Transform" or
    "Generate" is exactly what these run.

    Three kinds of `accept` sit side by side below. The nine rows that name
    extensions have theirs DERIVED from the registry like `subtitle-converter`
    above, so the literal is documentation. The nine that take no file at all
    keep the literal "NONE", the same way `uuid-generator` does. And
    `file-checksum` says "ANY FILE" because it genuinely reads anything — a
    disc image, a .deb, a font — so there is no extension list to derive and
    none to hide.

    `engine` names what each tool's `lib/` module actually imports: js-yaml on
    the three YAML pages, `Intl.Collator` on the one page whose ordering is
    collation rather than code points, `Intl.DateTimeFormat` on the zone board,
    `TextDecoder` on the re-decoder, jszip plus the browser's own DOMParser on
    the OOXML unzip, and `crypto.subtle` on the two MAC pages. Not one of these
    nineteen fetches an engine over the network, which is why the developer
    hub's DOWNLOAD stat still read `0 KB` after this batch — and why it stopped
    reading `0 KB` in the next one, when the QR reader and the archive
    extractor arrived carrying WebAssembly of their own.
  */
  { slug: "yaml-to-json", name: "YAML to JSON", cat: "DEV", route: "YAML → JSON", kind: "text", engine: "JS-YAML", accept: "YAML YML" },
  { slug: "json-to-yaml", name: "JSON to YAML", cat: "DEV", route: "JSON → YAML", kind: "text", engine: "JS-YAML", accept: "JSON" },
  { slug: "yaml-formatter", name: "YAML Formatter", cat: "DEV", route: "YAML → YAML", kind: "text", engine: "JS-YAML", accept: "YAML YML" },
  { slug: "json-minify", name: "JSON Minify", cat: "DEV", route: "JSON → JSON", kind: "text", engine: "NATIVE", accept: "JSON" },
  { slug: "sort-dedupe-lines", name: "Sort & Dedupe Lines", cat: "DEV", route: "TXT → TXT", kind: "text", engine: "INTL.COLLATOR", accept: "TXT CSV LOG" },
  { slug: "crlf-lf", name: "Line Ending Converter", cat: "DEV", route: "TXT → CRLF · LF · CR", kind: "text", engine: "NATIVE", accept: "TXT CSV LOG MD SH" },
  { slug: "charset-converter", name: "Charset Converter", cat: "DEV", route: "TEXT → UTF-8", kind: "text", engine: "TEXTDECODER", accept: "TXT CSV LOG SRT MD" },
  { slug: "har-viewer", name: "HAR Viewer", cat: "DEV", route: "HAR → TABLE · HAR", kind: "text", engine: "NATIVE", accept: "HAR JSON" },
  { slug: "xlsx-to-csv", name: "XLSX to CSV", cat: "DEV", route: "XLSX → CSV", kind: "text", engine: "JSZIP · DOMPARSER", accept: "XLSX" },
  { slug: "jwt-encoder", name: "JWT Encoder", cat: "DEV", route: "JSON → JWT", kind: "gen", engine: "SUBTLECRYPTO", accept: "NONE" },
  { slug: "hmac-generator", name: "HMAC Generator", cat: "DEV", route: "TXT → MAC", kind: "gen", engine: "SUBTLECRYPTO", accept: "NONE" },
  { slug: "file-checksum", name: "File Checksum", cat: "DEV", route: "FILE → VERDICT", kind: "gen", engine: "SUBTLECRYPTO · MD5", accept: "ANY FILE" },
  { slug: "wifi-qr-code", name: "Wi-Fi QR Code", cat: "DEV", route: "— → QR", kind: "gen", engine: "QRCODE", accept: "NONE" },
  { slug: "chmod-calculator", name: "Chmod Calculator", cat: "DEV", route: "OCTAL → RWX", kind: "text", engine: "NATIVE", accept: "NONE" },
  { slug: "http-status-codes", name: "HTTP Status Codes", cat: "DEV", route: "CODE → MEANING", kind: "text", engine: "NATIVE", accept: "NONE" },
  { slug: "timezone-converter", name: "Time Zone Converter", cat: "DEV", route: "TIME → ZONES", kind: "text", engine: "INTL", accept: "NONE" },
  { slug: "byte-converter", name: "Byte Converter", cat: "DEV", route: "SIZE → UNITS", kind: "text", engine: "NATIVE · BIGINT", accept: "NONE" },
  { slug: "aspect-ratio-calculator", name: "Aspect Ratio", cat: "DEV", route: "SIZE → RATIO", kind: "text", engine: "NATIVE", accept: "NONE" },
  { slug: "url-parser", name: "URL Parser", cat: "DEV", route: "URL → PARTS", kind: "text", engine: "URL API", accept: "NONE" },
  /*
    ── Wave 4 · batch 2: the archive, document and code-reading fills ─────────
    Seven rows, and the first DEV rows that are not already whole when the page
    finishes loading. `create-zip` and `unzip-files` share jszip, which the
    multi-file download path pulls anyway; `barcode-generator`, `svg-optimizer`
    and `docx-to-markdown` each code-split a JS library into their own chunk.
    The last two are the ones that changed a site-wide claim: `qr-code-reader`
    and `extract-archive` fetch a separate WebAssembly file from THIS origin on
    first use, the way the FFmpeg core and qpdf do, which is why the developer
    hub's DOWNLOAD stat no longer reads `0 KB` (see `src/data/categories.ts`).

    `unzip-files` says "NATIVE · JSZIP" and not plain "JSZIP" because half of
    what that page shows never touches jszip: `zip-tools.ts` parses the central
    directory itself — jszip's `loadAsync` is all-or-nothing and cannot name
    the one entry that stopped it — and jszip only inflates the entries that
    reader already judged safe. Both halves are visible on the page, so both
    are named here. `create-zip` writes through jszip alone, so it says so.

    Archetypes: `gen` for the two pages that make a new artefact out of what
    you handed them (`create-zip`, `barcode-generator`), `text` for the five
    that take something apart and write it back out. The three archive pages
    wear "Parse, Transform" less comfortably than the rest — an archive is read
    and its members are inflated, which is a transform of bytes rather than of
    a document — and both build agents independently asked for an `archive`
    archetype chipped "Read entries / Write files". That is a three-file change
    (the union above, `pipelineByArchetype` below, and the hand-copied
    `ARCHETYPES` list in `workspace.test.ts`); this pass was scoped to add no
    archetype, so it is filed as a follow-up rather than shipped half-done.
  */
  { slug: "create-zip", name: "Create ZIP", cat: "DEV", route: "FILES → ZIP", kind: "gen", engine: "JSZIP", accept: "ANY FILE" },
  { slug: "unzip-files", name: "Unzip Files", cat: "DEV", route: "ZIP → FILES", kind: "text", engine: "NATIVE · JSZIP", accept: "ZIP" },
  { slug: "extract-archive", name: "Extract Archive", cat: "DEV", route: "ARCHIVE → FILES · ZIP", kind: "text", engine: "LIBARCHIVE-WASM", accept: "ZIP TAR GZ TGZ BZ2 XZ 7Z RAR" },
  { slug: "barcode-generator", name: "Barcode Generator", cat: "DEV", route: "— → BARCODE", kind: "gen", engine: "BWIP-JS", accept: "NONE" },
  { slug: "qr-code-reader", name: "QR Code Reader", cat: "DEV", route: "IMG → TEXT", kind: "text", engine: "ZXING-WASM", accept: "PNG JPG WEBP GIF BMP" },
  { slug: "svg-optimizer", name: "SVG Optimizer", cat: "DEV", route: "SVG → SVG", kind: "text", engine: "SVGO", accept: "SVG" },
  { slug: "docx-to-markdown", name: "DOCX to Markdown", cat: "DEV", route: "DOCX → MD", kind: "text", engine: "MAMMOTH · TURNDOWN", accept: "DOCX" },
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
 *  - "video" then advertised "Trim", which was true of its one member and of
 *    nothing else. The container tools, mute-video and rotate-video all joined
 *    the archetype in Wave 3 and none of them trims, so the honest denominator
 *    across all nine is the one step every single run performs: "Remux". (The
 *    container tools can also offer an explicit H.264 transcode when the source
 *    codec will not fit the target container — that is a second path the user
 *    has to choose, and the chips describe the default one every tool shares.)
 *  - "pdfpages" advertised "Extract"; rotate, page numbers and reorder write
 *    the same pages back out.
 *  - "icons" advertised "Resize ×7 / Zip", which is favicon-generator only —
 *    png-to-ico writes three sizes into one .ico and zips nothing.
 *  - "extract" advertised "Encode", true of mp4-to-mp3 and of the two WAV
 *    extractors but NOT of the `extract-audio` hub, which opens on `-c:a copy`
 *    and re-encodes only if you ask it to. By the same rule the container
 *    tools' chips follow — describe the default run every member shares — the
 *    only step all four perform is the demux.
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
  /*
    extract-images-from-pdf, and only that tool. It could not borrow any of the
    three archetypes that look close: "pdfpages" claims "Read pages" and this
    walks the object graph precisely so it does NOT iterate pages (an image
    drawn on forty pages must come out once); "pdfdocs" claims "Write PDF" and
    the output is image files; "extract" claims "Demux", which is what the four
    audio-extraction tools do to a media container and is not what reading an
    XObject out of a PDF is.
  */
  "pdfimages": ["Read objects", "Write images"],
  "video": ["Remux"],
  "gif": ["Sample", "Quantise", "Encode"],
  "extract": ["Demux"],
  "transcode": ["Decode", "Encode", "Mux"],
  "audio": ["Decode", "Encode"],
  "text": ["Parse", "Transform"],
  "gen": ["Generate"],
  "icons": ["Resize", "Pack"],
  "color": ["Pick", "Format"],
  "data": ["Read tags"],
  "record": ["Capture", "Record"],
  /*
    normalize-audio and remove-silence. Both decode inside FFmpeg, run one
    `-af` filtergraph, and encode the result — so all three chips hold for both,
    which is the honest-denominator rule this file is built on. The two Web
    Audio effects (change-audio-volume, reverse-audio) deliberately do NOT take
    this archetype: they build no filtergraph at all, and "Filter" would be a
    chip about something that never runs.
  */
  "audiofilter": ["Decode", "Filter", "Encode"],
  /*
    video-to-images and video-thumbnail. Both play or seek the clip through the
    browser's own decoder, take the frames it presents, and encode them on a
    canvas. "Sample" is the same word `gif` uses for the same walk — these two
    reuse `playAndExtractFrames` — and they stop one step short of it, because
    neither quantises a palette.
  */
  "frames": ["Sample", "Encode"],
};
