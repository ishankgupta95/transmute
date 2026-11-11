export type ToolType =
  | "image-convert"
  | "image-compress"
  | "image-resize"
  | "image-crop"
  | "exif-viewer"
  | "image-to-base64"
  | "png-to-ico"
  | "favicon-generator"
  | "color-palette"
  | "jfif-to-jpg"
  /*
    The Wave-4 image cluster. One type per slug, because no two of them mount
    the same surface: every edit verb has controls nothing else has — a
    rotation chip group, a mirror axis, four linked border widths, a
    watermark's six placements, a block size, a circle's diameter, a row and
    column grid, a matrix of named frame sizes — and the four that are not
    edit verbs share nothing with anything on the site. `compress-png` is
    deliberately not a mode of `image-compress`: that page re-encodes through
    a canvas and trades quality for bytes, while this one runs oxipng over the
    encoded PNG and changes no pixel at all, so sharing a type would mean
    branching on the slug for every control on both pages. `base64-to-image`
    is likewise not a direction of `image-to-base64` — one takes a file and
    the other takes pasted text, which is a different surface end to end.
    The seven format fills that landed in the same batch are NOT here:
    `tiff-to-png`, `avif-to-png`, `avif-to-webp`, `bmp-to-png`, `svg-to-jpg`,
    `svg-to-webp` and `heic-to-webp` all mount `ImageConverterUI` on
    `image-convert`, the way `svg-to-png` and `avif-to-jpg` already do, so
    they add pages without adding a type.
  */
  | "rotate-image"
  | "flip-image"
  | "add-border"
  | "watermark-image"
  | "pixelate-image"
  | "crop-circle"
  | "image-splitter"
  | "social-media-image-resizer"
  | "compress-png"
  | "image-to-text"
  | "ocr-pdf"
  | "vcf-to-csv"
  | "ics-to-csv"
  | "resize-gif"
  | "gif-speed-changer"
  | "reverse-gif"
  | "split-gif"
  | "gif-maker"
  | "csv-markdown-table"
  | "bcrypt-generator"
  | "ico-to-png"
  | "base64-to-image"
  | "change-image-dpi"
  | "json-formatter"
  | "json-to-csv"
  | "csv-to-json"
  | "sql-formatter"
  | "markdown-to-html"
  | "html-to-markdown"
  | "xml-formatter"
  | "base64-encode-decode"
  | "url-encode-decode"
  | "jwt-decoder"
  | "html-entity-encode-decode"
  | "uuid-generator"
  | "password-generator"
  | "hash-generator"
  | "lorem-ipsum-generator"
  | "qr-code-generator"
  | "color-picker"
  | "css-gradient-generator"
  | "box-shadow-generator"
  | "regex-tester"
  | "cron-expression-generator"
  | "timestamp-converter"
  | "text-diff"
  | "text-case-converter"
  | "word-counter"
  | "subtitle-converter"
  | "merge-pdf"
  | "split-pdf"
  | "compress-pdf"
  | "recompress-pdf-images"
  | "pdf-to-jpg"
  | "images-to-pdf"
  | "rotate-pdf"
  | "add-page-numbers"
  | "pdf-page-reorder"
  | "extract-pdf-pages"
  | "delete-pdf-pages"
  | "crop-pdf"
  | "change-pdf-page-size"
  | "pdf-resizer"
  | "pdf-to-text"
  | "extract-images-from-pdf"
  | "protect-pdf"
  | "unlock-pdf"
  | "pdf-permissions"
  | "repair-pdf"
  | "watermark-pdf"
  | "sign-pdf"
  | "add-image-to-pdf"
  | "annotate-pdf"
  | "fill-pdf-form"
  | "flatten-pdf"
  | "remove-metadata"
  | "pdf-editor"
  | "markdown-to-pdf"
  | "mp3-to-wav"
  | "wav-to-mp3"
  | "m4a-to-mp3"
  /*
    The two shared audio toolTypes. `audio-convert` carries eight format-pair
    pages and `extract-audio` three, all on one component each — the
    `image-convert` pattern (11 slugs, one type), not the one-type-per-slug
    shape the rest of the audio/video block still has. The three original pair
    pages above keep their own types so their URLs, tests and HowTo copy do not
    churn; `ToolClient.tsx` falls all four cases through to one client.
  */
  | "audio-convert"
  | "extract-audio"
  | "audio-trimmer"
  | "merge-audio"
  /*
    The audio-effects block. One type per slug, because no two of them share a
    component: the two FFmpeg filter pages (`normalize-audio`, `remove-silence`)
    build different filtergraphs and report different numbers, and the two Web
    Audio pages (`change-audio-volume`, `reverse-audio`) never load FFmpeg at
    all on their MP3/WAV arms.
  */
  | "normalize-audio"
  | "change-audio-volume"
  | "reverse-audio"
  | "remove-silence"
  | "audio-recorder"
  | "video-to-gif"
  | "video-trimmer"
  | "mp4-to-mp3"
  | "webm-to-mp4"
  | "compress-video"
  | "compress-video-to-size"
  | "screen-recorder"
  | "video-remux"
  | "mute-video"
  | "rotate-video"
  /*
    The frame, cut and join block. `video-to-images` and `video-thumbnail` walk
    the browser's own decoder (no FFmpeg at all); `split-video` and
    `merge-video` are FFmpeg stream copies. `webcam-recorder` shares
    `MediaRecorderShell` with `screen-recorder` and `audio-recorder` but keeps
    its own type, because the three pages differ in the stream they acquire and
    in every device control around it.
  */
  | "video-to-images"
  | "video-thumbnail"
  | "split-video"
  | "merge-video"
  | "webcam-recorder"
  /*
    The developer block below. `yaml-to-json` and `json-to-yaml` share one
    type because they share one component: the page reads the direction it
    opens on off this registry and a swap chip gets you the other way from
    either URL — the `image-convert` / `audio-convert` precedent above. Every
    other slug here keeps its own type, because no two of them mount the same
    surface, and the near-misses are the ones worth naming. `json-minify` is
    not a mode of `json-formatter`: that page is paste-only, this one takes a
    .json file and reports the byte saving, though both call the same lossless
    `minifyJson` scanner. `jwt-encoder` is not a mode of `jwt-decoder`:
    decoding takes a token and nothing else, signing takes a secret.
    `file-checksum` is not `hash-generator` with a field bolted on — it is a
    comparison surface hung off a hashing run — and `wifi-qr-code` is not
    `qr-code-generator` with a preset, but a structured payload with its own
    escaping and validation. Sharing a type with any of those would mean
    branching on the slug for every control on both pages. `line-endings` is
    the one type that is not its slug: people search for "crlf to lf", so the
    page is `crlf-lf`, but the tool writes bare CR too and the type says so.
  */
  | "yaml-json-converter"
  | "yaml-formatter"
  | "json-minify"
  | "sort-dedupe-lines"
  | "line-endings"
  | "xlsx-to-csv"
  | "charset-converter"
  | "har-viewer"
  | "jwt-encoder"
  | "hmac-generator"
  | "file-checksum"
  | "wifi-qr-code"
  | "chmod-calculator"
  | "http-status-codes"
  | "byte-converter"
  | "timezone-converter"
  | "aspect-ratio-calculator"
  | "url-parser"
  /*
    The archive, document and code-symbol block. Every slug here keeps its own
    type, because no two of them mount the same surface, and the near-misses
    are the ones worth naming. `unzip-files` and `extract-archive` are not one
    page with a mode: the first is JSZip over a plain .zip, already inside this
    site's JavaScript and fetching no engine, while the second pulls a
    WebAssembly libarchive to reach TAR, 7-Zip, RAR and the compressed-tar
    family, lists entries before extracting any of them, and carries a password
    field the ZIP reader has nothing to do with. `create-zip` writes instead of
    reading, which is a different call and a different rail.
    `docx-to-markdown` shares the turndown WRITER that `html-to-markdown`
    configures but not its surface — a binary package in rather than pasted
    text, plus an image choice, a table choice and a derived count of what the
    document lost. `svg-optimizer` is the nearest thing here to `json-minify`,
    a file in and a smaller file of the same format out, and still cannot share
    it: one moves whitespace and nothing else on purpose, the other runs
    thirty-four passes over a parsed tree and has to say which of them changed
    the drawing. `barcode-generator` is not `qr-code-generator` with a picker
    bolted on — that page draws one symbology onto a canvas, this one runs
    BWIPP over eleven, each with its own alphabet, length and check digit, and
    its whole surface is the validation. `qr-code-reader` is the other
    direction from both: it shares a LIB with `wifi-qr-code` (`qr-decode.ts`
    parses exactly the escaping `wifi-qr.ts` writes) and not one control.
  */
  | "extract-archive"
  | "create-zip"
  | "unzip-files"
  | "docx-to-markdown"
  | "svg-optimizer"
  | "barcode-generator"
  | "qr-code-reader";

export interface Tool {
  name: string;
  slug: string;
  category: string;
  toolType: ToolType;
  description: string;
  /**
   * One short editorial clause for the category-hub row. `description` is the
   * SEO meta blurb — two keyword-loaded sentences that the hub could only
   * render clamped. Where a `hubLine` exists the hub prefers it; everything
   * else (metadata, cards, schema) still reads `description`.
   */
  hubLine?: string;
  keywords: string[];
  h1: string;
  subtitle: string;
  acceptFormats: string;
  sourceFormat?: string;
  /** BMP is a source-only format — see `ImageConvertOptions`. */
  targetFormat?: "jpeg" | "png" | "webp";
  defaultTargetSizeKb?: number; // For compress variant pages
  /**
   * Hard input-size limit the tool actually enforces (FFmpeg tools call
   * `validateFFmpegInput`). Absent means genuinely uncapped — the status
   * surfaces render "NO SIZE CAP"/"NONE" from this field, so setting it
   * only where enforced is what keeps that claim honest.
   */
  maxSizeMB?: number;
  /**
   * The ceiling a tool HAS but does not ENFORCE — an honest disclosure, never
   * a check. `maxSizeMB` stays the enforced field and nothing here is ever
   * compared against `file.size`: a tool that sets this still accepts every
   * file it accepted before and still fails exactly where it failed before.
   * What changes is the copy. "NO SIZE CAP" (`DropZone.tsx`) and "MAX SIZE /
   * NONE" (`ToolPageLayout.tsx`) are absolute claims, and a tool that holds
   * the whole file in memory and then expands it cannot make them; those two
   * surfaces read this field and print "MEMORY-BOUND" plus the sentence
   * instead.
   *
   * One sentence, naming the MECHANISM that binds — the decode, the copy, the
   * buffer — not a bare number. A number on its own reads as a cap, and this
   * is not one; `ffmpeg-loader.ts:101-103` records why the bare number was
   * the wrong answer the last time this came up.
   *
   * Mutually exclusive with `maxSizeMB` by construction (a tool with a real
   * cap prints the cap), and pinned that way in
   * `src/__tests__/unit/data/size-claims.test.ts`.
   */
  practicalLimitNote?: string;
  /**
   * True for a tool whose input is not a file at all — the generators, the
   * colour and CSS builders, the text tools and the screen recorder. They
   * mount no drop zone and no `<input type="file">`, so NOTHING they render
   * makes a claim about file sizes, and counting them among "tools that take
   * a file of any size" (which the homepage tile did, all 24 of them) inflates
   * an honest count by 36%.
   *
   * `acceptFormats` is nearly this field and is not it: it is empty for these
   * 24 AND for `hash-generator` and `base64-encode-decode`, whose File chips
   * mount a real drop zone that accepts every type, which no extension list
   * describes. So the two are stated separately, and
   * `src/__tests__/unit/data/file-input-claims.test.ts` reads every one of the
   * 26 empty-`acceptFormats` UIs and fails if this flag disagrees with what
   * the component actually mounts.
   */
  takesNoFile?: true;
}

export const tools: Tool[] = [
  // ── Image Converters ──────────────────────────────────────────────
  {
    name: "HEIC to JPG",
    slug: "heic-to-jpg",
    category: "image-tools",
    toolType: "image-convert",
    description: "Convert iPhone HEIC and HEIF photos to JPG instantly in your browser. Batch-process multiple files with adjustable quality. No upload, no sign-up.",
    hubLine: "iPhone photos that everything else can open.",
    keywords: ["heic to jpg", "heif to jpeg", "convert heic", "heic converter", "iphone photo converter"],
    h1: "Convert HEIC to JPG Online — Free, No Upload Required",
    subtitle: "Turn iPhone HEIC photos into universally compatible JPG files, right in your browser.",
    acceptFormats: ".heic,.heif",
    sourceFormat: "heic",
    targetFormat: "jpeg",
  },
  {
    name: "HEIC to WebP",
    slug: "heic-to-webp",
    category: "image-tools",
    toolType: "image-convert",
    description: "Convert iPhone HEIC photos to WebP for the web. Decoding pulls the 1.4 MB libheif decoder once; both formats are lossy, so this is a second generation.",
    hubLine: "iPhone photos into what the web serves.",
    keywords: ["heic to webp", "heif to webp", "convert heic to webp", "iphone photo to webp"],
    h1: "Convert HEIC to WebP Online — Free, No Upload",
    subtitle: "Turn iPhone HEIC photos into WebP, the format the web actually serves.",
    acceptFormats: ".heic,.heif",
    sourceFormat: "heic",
    targetFormat: "webp",
  },
  {
    name: "WebP to JPG",
    slug: "webp-to-jpg",
    category: "image-tools",
    toolType: "image-convert",
    description: "Convert WebP images to JPG instantly for use in apps, email clients, or older software that doesn't support WebP. Adjustable quality, no uploads.",
    hubLine: "For software that still refuses WebP.",
    keywords: ["webp to jpg", "webp to jpeg", "convert webp", "webp converter"],
    h1: "Convert WebP to JPG Online — Free & Instant",
    subtitle: "Transform WebP images into JPG for universal compatibility.",
    acceptFormats: ".webp",
    sourceFormat: "webp",
    targetFormat: "jpeg",
  },
  {
    name: "WebP to PNG",
    slug: "webp-to-png",
    category: "image-tools",
    toolType: "image-convert",
    description: "Convert WebP to PNG with full alpha-channel transparency preserved. Lossless output for editing, print, or apps without WebP support.",
    hubLine: "Lossless, with transparency preserved.",
    keywords: ["webp to png", "convert webp to png", "webp converter png"],
    h1: "Convert WebP to PNG Online — Free, Lossless",
    subtitle: "Convert WebP to PNG with transparency preserved — no upload needed.",
    acceptFormats: ".webp",
    sourceFormat: "webp",
    targetFormat: "png",
  },
  {
    name: "PNG to JPG",
    slug: "png-to-jpg",
    category: "image-tools",
    toolType: "image-convert",
    description: "Convert PNG images to JPG with adjustable quality to dramatically reduce file size. Perfect for email, web uploads, and social media.",
    hubLine: "Smaller files where you do not need alpha.",
    keywords: ["png to jpg", "png to jpeg", "convert png to jpg", "png converter"],
    h1: "Convert PNG to JPG Online — Free & Fast",
    subtitle: "Shrink PNG files by converting to JPG with adjustable quality.",
    acceptFormats: ".png",
    sourceFormat: "png",
    targetFormat: "jpeg",
  },
  {
    name: "JPG to PNG",
    slug: "jpg-to-png",
    category: "image-tools",
    toolType: "image-convert",
    description: "Convert JPG to PNG for lossless quality and to add transparency support. Ideal before further editing or for design workflows.",
    hubLine: "Lossless container for further editing.",
    keywords: ["jpg to png", "jpeg to png", "convert jpg to png", "jpg converter"],
    h1: "Convert JPG to PNG Online — Free, Lossless",
    subtitle: "Convert JPG to lossless PNG format — supports transparency.",
    acceptFormats: ".jpg,.jpeg",
    sourceFormat: "jpg",
    targetFormat: "png",
  },
  {
    name: "JPG to WebP",
    slug: "jpg-to-webp",
    category: "image-tools",
    toolType: "image-convert",
    description: "Convert JPG to WebP for 25-35% smaller files at the same quality. Speed up websites and improve Core Web Vitals scores instantly.",
    hubLine: "Roughly 25% smaller at the same quality.",
    keywords: ["jpg to webp", "jpeg to webp", "convert jpg to webp", "webp converter"],
    h1: "Convert JPG to WebP Online — Smaller Files, Same Quality",
    subtitle: "Reduce image size by 25-35% by converting JPG to WebP.",
    acceptFormats: ".jpg,.jpeg",
    sourceFormat: "jpg",
    targetFormat: "webp",
  },
  {
    name: "PNG to WebP",
    slug: "png-to-webp",
    category: "image-tools",
    toolType: "image-convert",
    description: "Convert PNG to WebP for 60-80% smaller files with full transparency preserved. Cuts page weight without sacrificing visual quality.",
    hubLine: "Alpha kept, file size cut hard.",
    keywords: ["png to webp", "convert png to webp", "png webp converter"],
    h1: "Convert PNG to WebP Online — Up to 80% Smaller",
    subtitle: "Dramatically reduce PNG file sizes by converting to WebP.",
    acceptFormats: ".png",
    sourceFormat: "png",
    targetFormat: "webp",
  },
  {
    name: "SVG to PNG",
    slug: "svg-to-png",
    category: "image-tools",
    toolType: "image-convert",
    description: "Convert SVG to PNG in your browser — transparency preserved, and the SVG's own width and height set the raster size. Batch convert, no upload.",
    hubLine: "The SVG's own size sets the PNG's.",
    keywords: ["svg to png", "convert svg to png", "svg to image", "svg rasterize"],
    h1: "Convert SVG to PNG Online — Free, No Upload",
    subtitle: "Rasterize SVG vectors to crisp PNG images, transparency preserved.",
    acceptFormats: ".svg",
    sourceFormat: "svg",
    targetFormat: "png",
  },
  {
    name: "SVG to JPG",
    slug: "svg-to-jpg",
    category: "image-tools",
    toolType: "image-convert",
    description: "Rasterize SVG to JPG in your browser. The SVG's own width and height set the pixel size, and transparent areas are flattened onto white — JPG has no alpha.",
    hubLine: "Rasterized, and transparency goes white.",
    keywords: ["svg to jpg", "svg to jpeg", "convert svg to jpg", "rasterize svg"],
    h1: "Convert SVG to JPG Online — Free, No Upload",
    subtitle: "Rasterize SVG vectors to JPG, with transparent areas flattened onto white.",
    acceptFormats: ".svg",
    sourceFormat: "svg",
    targetFormat: "jpeg",
  },
  {
    name: "SVG to WebP",
    slug: "svg-to-webp",
    category: "image-tools",
    toolType: "image-convert",
    description: "Rasterize SVG to WebP in your browser, transparency kept. The SVG's own width and height set the pixel size; a small viewBox-only file scales up to 1024 px.",
    hubLine: "Rasterized, with the transparency kept.",
    keywords: ["svg to webp", "convert svg to webp", "svg rasterize webp", "vector to webp"],
    h1: "Convert SVG to WebP Online — Free, Transparency Kept",
    subtitle: "Rasterize SVG vectors to WebP images, transparency preserved.",
    acceptFormats: ".svg",
    sourceFormat: "svg",
    targetFormat: "webp",
  },
  {
    name: "AVIF to JPG",
    slug: "avif-to-jpg",
    category: "image-tools",
    toolType: "image-convert",
    description: "Convert AVIF images to JPG for compatibility with apps, email, and older software. AVIF decoded natively in your browser — no plugins.",
    hubLine: "Modern format into a universal one.",
    keywords: ["avif to jpg", "avif to jpeg", "convert avif", "avif converter"],
    h1: "Convert AVIF to JPG Online — Free & Instant",
    subtitle: "Convert next-gen AVIF images to universally compatible JPG.",
    acceptFormats: ".avif",
    sourceFormat: "avif",
    targetFormat: "jpeg",
  },
  {
    name: "AVIF to PNG",
    slug: "avif-to-png",
    category: "image-tools",
    toolType: "image-convert",
    description: "Convert AVIF to PNG using your browser's own AVIF decoder — Chrome 85+, Firefox 93+, Safari 16.4+. PNG output is lossless and keeps transparency.",
    hubLine: "Your browser's AVIF decoder, lossless out.",
    keywords: ["avif to png", "convert avif to png", "avif converter png", "open avif file"],
    h1: "Convert AVIF to PNG Online — Lossless, No Upload",
    subtitle: "Decode AVIF with your browser and write it back out as a lossless PNG.",
    acceptFormats: ".avif",
    sourceFormat: "avif",
    targetFormat: "png",
  },
  {
    name: "AVIF to WebP",
    slug: "avif-to-webp",
    category: "image-tools",
    toolType: "image-convert",
    description: "Convert AVIF to WebP, a modern format far more software will open. Both are lossy, so this is a second generation of loss — quality is yours to set.",
    hubLine: "Modern to modern — a second generation.",
    keywords: ["avif to webp", "convert avif to webp", "avif converter webp", "avif compatibility"],
    h1: "Convert AVIF to WebP Online — Free & Instant",
    subtitle: "Move a modern format into the modern format far more software will open.",
    acceptFormats: ".avif",
    sourceFormat: "avif",
    targetFormat: "webp",
  },
  {
    name: "BMP to JPG",
    slug: "bmp-to-jpg",
    category: "image-tools",
    toolType: "image-convert",
    description: "Convert legacy BMP bitmap files to compressed JPG. Reduce file size by 80-95% for easier sharing, storage, and modern web use.",
    hubLine: "Shrink uncompressed bitmaps dramatically.",
    keywords: ["bmp to jpg", "bmp to jpeg", "convert bmp", "bitmap to jpg"],
    h1: "Convert BMP to JPG Online — Free & Fast",
    subtitle: "Convert uncompressed BMP files to compact JPG — huge size savings.",
    acceptFormats: ".bmp",
    sourceFormat: "bmp",
    targetFormat: "jpeg",
  },
  {
    name: "BMP to PNG",
    slug: "bmp-to-png",
    category: "image-tools",
    toolType: "image-convert",
    description: "Convert BMP to PNG losslessly. BMP stores pixels uncompressed, so the PNG is usually far smaller while every pixel stays exactly as it was.",
    hubLine: "Same pixels, a fraction of the bytes.",
    keywords: ["bmp to png", "convert bmp to png", "bitmap to png", "bmp converter"],
    h1: "Convert BMP to PNG Online — Lossless & Much Smaller",
    subtitle: "Compress an uncompressed bitmap losslessly — every pixel identical.",
    acceptFormats: ".bmp",
    sourceFormat: "bmp",
    targetFormat: "png",
  },
  {
    name: "TIFF to JPG",
    slug: "tiff-to-jpg",
    category: "image-tools",
    toolType: "image-convert",
    description: "Convert TIFF images to JPG for sharing, email, and web use. Multi-page TIFFs convert their first page. Adjustable quality, nothing uploaded.",
    hubLine: "Scanner and print files for the web.",
    keywords: ["tiff to jpg", "tif to jpeg", "convert tiff", "tiff converter"],
    h1: "Convert TIFF to JPG Online — Free, No Upload",
    subtitle: "Convert TIFF images to compact JPG files — entirely in your browser.",
    acceptFormats: ".tiff,.tif",
    sourceFormat: "tiff",
    targetFormat: "jpeg",
  },
  {
    name: "TIFF to PNG",
    slug: "tiff-to-png",
    category: "image-tools",
    toolType: "image-convert",
    description: "Convert TIFF to PNG losslessly with transparency kept. A multi-page TIFF converts its first page, and the tool tells you how many pages it found.",
    hubLine: "Page one, and it says how many there were.",
    keywords: ["tiff to png", "tif to png", "convert tiff to png", "open tiff file"],
    h1: "Convert TIFF to PNG Online — Free, No Upload",
    subtitle: "Decode TIFF and save the first page as a lossless PNG, transparency kept.",
    acceptFormats: ".tif,.tiff",
    sourceFormat: "tiff",
    targetFormat: "png",
  },
  {
    name: "JFIF to JPG",
    slug: "jfif-to-jpg",
    category: "image-tools",
    toolType: "jfif-to-jpg",
    description: "Rename a JFIF file to JPG with a real byte check — .jfif already is JPEG, so the output is byte-identical. No re-encode, no quality change, EXIF kept.",
    hubLine: "The same bytes, wearing a name upload forms accept.",
    keywords: ["jfif to jpg", "convert jfif to jpg", "jfif file", "change jfif to jpg"],
    h1: "Convert JFIF to JPG Online — Free & Instant",
    subtitle: "A verified rename — .jfif already is JPEG, so the bytes come back identical under a .jpg name.",
    acceptFormats: ".jfif,.jpg,.jpeg",
  },

  // ── Image Compressor ──────────────────────────────────────────────
  {
    name: "Image Compressor",
    slug: "compress-image",
    category: "image-tools",
    toolType: "image-compress",
    description: "Compress JPG, PNG, and WebP images by quality or to a target file size in KB. Smart binary search picks the best quality automatically.",
    hubLine: "By quality, or to an exact target in KB.",
    keywords: ["compress image", "image compressor", "reduce image size", "compress jpg", "compress png", "image optimizer"],
    h1: "Compress Images Online — Free, No Upload Required",
    subtitle: "Reduce image file size with quality or target-size compression — entirely in your browser.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp,.gif",
  },
  {
    name: "Compress Image to 100 KB",
    slug: "compress-image-to-100kb",
    category: "image-tools",
    toolType: "image-compress",
    description: "Compress an image to a 100 KB target — for email attachments, government forms, and job applications that enforce a strict file size limit.",
    hubLine: "For passport forms and upload limits.",
    keywords: ["compress image to 100kb", "reduce image to 100kb", "image under 100kb", "100kb image compressor"],
    h1: "Compress Image to 100 KB Online — Free & Instant",
    subtitle: "Compress an image to a 100 KB target for email, forms, and uploads, at the best quality that fits.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp",
    defaultTargetSizeKb: 100,
  },
  {
    name: "Compress Image to 200 KB",
    slug: "compress-image-to-200kb",
    category: "image-tools",
    toolType: "image-compress",
    description: "Compress an image to a 200 KB target — for web uploads, document attachments, and the many platforms that cap uploads at 200 KB.",
    hubLine: "Binary-search quality against a hard ceiling.",
    keywords: ["compress image to 200kb", "reduce image to 200kb", "image under 200kb", "200kb image compressor"],
    h1: "Compress Image to 200 KB Online — Free & Instant",
    subtitle: "Compress an image to a 200 KB target, keeping the highest quality that fits under the ceiling.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp",
    defaultTargetSizeKb: 200,
  },
  {
    name: "Compress Image to 1 MB",
    slug: "compress-image-to-1mb",
    category: "image-tools",
    toolType: "image-compress",
    description: "Compress an image to a 1 MB target — for social media uploads, messaging apps, and email attachments with a reasonable size cap.",
    hubLine: "Large photos, under the limit, still sharp.",
    keywords: ["compress image to 1mb", "reduce image to 1mb", "image under 1mb", "1mb image compressor"],
    h1: "Compress Image to 1 MB Online — Free & Instant",
    subtitle: "Compress an image to a 1 MB target for social media, messaging, and uploads, at the best quality that fits.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp",
    defaultTargetSizeKb: 1024,
  },
  {
    name: "Compress Image to 20 KB",
    slug: "compress-image-to-20kb",
    category: "image-tools",
    toolType: "image-compress",
    description: "Compress an image to a 20 KB target — for signatures and photo uploads on exam and government forms. Large photos are scaled down, and the result says so.",
    hubLine: "The tiny end of the ladder — expect a downscale.",
    keywords: ["compress image to 20kb", "image under 20kb", "20kb photo", "compress signature to 20kb"],
    h1: "Compress Image to 20 KB Online — Free & Instant",
    subtitle: "Compress an image to a 20 KB target for signature and form uploads — large photos are scaled down, and the result says so.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp",
    defaultTargetSizeKb: 20,
  },
  {
    name: "Compress Image to 50 KB",
    slug: "compress-image-to-50kb",
    category: "image-tools",
    toolType: "image-compress",
    description: "Compress an image to a 50 KB target — for exam registrations, ID photos, and portals that cap uploads at 50 KB. Binary search keeps the best quality that fits.",
    hubLine: "Exam-form photos under a hard 50 KB bar.",
    keywords: ["compress image to 50kb", "reduce image to 50kb", "image under 50kb", "50kb image compressor"],
    h1: "Compress Image to 50 KB Online — Free & Instant",
    subtitle: "Compress an image to a 50 KB target for exam and application portals, at the best quality that fits.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp",
    defaultTargetSizeKb: 50,
  },
  {
    name: "Compress Image to 500 KB",
    slug: "compress-image-to-500kb",
    category: "image-tools",
    toolType: "image-compress",
    description: "Compress an image to a 500 KB target — for CMS uploads, marketplace listings, and forum attachments. Most photos keep high quality at half a megabyte.",
    hubLine: "Room enough that most photos stay sharp.",
    keywords: ["compress image to 500kb", "reduce image to 500kb", "image under 500kb", "500kb image compressor"],
    h1: "Compress Image to 500 KB Online — Free & Instant",
    subtitle: "Compress an image to a 500 KB target for web and CMS uploads, keeping the highest quality under the ceiling.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp",
    defaultTargetSizeKb: 500,
  },
  {
    name: "Compress Image to Target Size",
    slug: "compress-image-to-target-size",
    category: "image-tools",
    toolType: "image-compress",
    description: "Compress an image to any target size in KB — type a number from 10 to 10,240 or pick a preset. 200 KB is just the preloaded default, not a limit.",
    hubLine: "Any ceiling you type, best quality that fits.",
    keywords: ["compress image to target size", "compress image to specific size", "compress image to exact size kb", "custom image size compressor"],
    h1: "Compress Image to Any Target Size — Free & Private",
    subtitle: "Type any KB target from 10 to 10,240 — 200 KB is only the preloaded default — and the search finds the best quality that fits.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp",
    defaultTargetSizeKb: 200,
  },

  // ── Image Resizer ──────────────────────────────────────────────────
  {
    name: "Image Resizer",
    slug: "resize-image",
    category: "image-tools",
    toolType: "image-resize",
    description: "Resize images to exact dimensions or social media presets (Instagram, Twitter, LinkedIn). Lanczos3 resampling preserves sharpness.",
    hubLine: "Exact pixel dimensions, aspect ratio preserved.",
    keywords: ["resize image", "image resizer", "resize photo", "change image size", "image dimensions"],
    h1: "Resize Images Online — Free, High-Quality Resampling",
    subtitle: "Resize to exact dimensions or social media presets with Lanczos3 quality.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp,.gif",
  },
  {
    name: "Resize Image to 20 KB",
    slug: "resize-image-to-20kb",
    category: "image-tools",
    toolType: "image-compress",
    description: "Reduce an image to 20 KB: quality drops first, and dimensions shrink in bounded steps only when needed — the result reports the new size when it scales.",
    hubLine: "Quality first; pixels shrink only when they must.",
    keywords: ["resize image to 20kb", "reduce image size to 20kb", "resize photo to 20kb"],
    h1: "Resize Image to 20 KB Online — Free & Instant",
    subtitle: "Get an image under 20 KB: quality drops first, dimensions shrink in bounded steps only when they must — and the result reports the new size.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp",
    defaultTargetSizeKb: 20,
  },
  {
    name: "Resize Image to 50 KB",
    slug: "resize-image-to-50kb",
    category: "image-tools",
    toolType: "image-compress",
    description: "Reduce an image to 50 KB for forms and portals with a hard cap. Quality drops first, dimensions step down only when needed, and your file never grows.",
    hubLine: "A byte ceiling, not a dimension picker.",
    keywords: ["resize image to 50kb", "reduce image size to 50kb", "resize photo to 50kb"],
    h1: "Resize Image to 50 KB Online — Free & Instant",
    subtitle: "Get an image under 50 KB by lowering quality first and stepping dimensions down only when quality alone can't reach it.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp",
    defaultTargetSizeKb: 50,
  },
  {
    name: "Resize Image to 100 KB",
    slug: "resize-image-to-100kb",
    category: "image-tools",
    toolType: "image-compress",
    description: "Reduce an image to 100 KB for uploads that enforce the limit. Quality is binary-searched first; dimensions step down only when quality can't get there.",
    hubLine: "The common 100 KB bar, stepped down only on demand.",
    keywords: ["resize image to 100kb", "reduce image size to 100kb", "resize photo to 100kb"],
    h1: "Resize Image to 100 KB Online — Free & Instant",
    subtitle: "Get an image under 100 KB — quality is searched first, and dimensions step down only when the target needs it.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp",
    defaultTargetSizeKb: 100,
  },
  {
    name: "Photo Resizer in KB",
    slug: "photo-resizer-in-kb",
    category: "image-tools",
    toolType: "image-compress",
    description: "Resize a photo in KB — set a target like 20, 50, or 100 KB for exam and government portals. Quality drops first; dimensions scale only when they must.",
    hubLine: "Whatever KB figure the portal demands.",
    keywords: ["photo resizer in kb", "resize photo in kb", "photo kb resizer", "resize image in kb online"],
    h1: "Photo Resizer in KB — Free, Private & Online",
    subtitle: "Resize a photo to any KB limit a form demands — quality first, bounded dimension steps only when needed, and the result reports any new size.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp",
    defaultTargetSizeKb: 100,
  },

  // ── Image Cropper ──────────────────────────────────────────────────
  {
    name: "Image Cropper",
    slug: "crop-image",
    category: "image-tools",
    toolType: "image-crop",
    description: "Crop images visually with interactive handles, aspect ratio presets, and rotation. Save the result as PNG, JPG or WebP — PNG by default.",
    hubLine: "Drag a region, pick PNG, JPG or WebP.",
    keywords: ["crop image", "image cropper", "crop photo online", "free image crop tool"],
    h1: "Crop Images Online — Free, Interactive Cropping Tool",
    subtitle: "Crop images with drag handles, aspect ratio presets, and rotation.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp,.gif",
  },

  // ── EXIF Viewer ────────────────────────────────────────────────────
  {
    name: "EXIF Data Viewer & Remover",
    slug: "exif-viewer",
    category: "image-tools",
    toolType: "exif-viewer",
    description: "Inspect and strip EXIF metadata from photos — camera model, GPS coordinates, timestamps. Protect privacy before sharing online.",
    hubLine: "Camera, lens, GPS and timestamps.",
    keywords: ["exif viewer", "exif remover", "remove exif data", "photo metadata", "image metadata viewer"],
    h1: "View & Remove EXIF Data Online — Free, Private",
    subtitle: "See all metadata in your photos and strip it for privacy — right in your browser.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.tiff,.tif,.heic,.heif",
  },

  // ── Image to Base64 ────────────────────────────────────────────────
  {
    name: "Image to Base64",
    slug: "image-to-base64",
    category: "image-tools",
    toolType: "image-to-base64",
    description: "Convert images to Base64-encoded data URIs for embedding directly in HTML, CSS, JSON, or email. One-click copy to clipboard.",
    hubLine: "Data URI for inlining into CSS or HTML.",
    keywords: ["image to base64", "base64 encode image", "image base64 converter", "data uri image"],
    h1: "Image to Base64 Encoder — Free & Instant",
    subtitle: "Convert any image to a Base64 data URI for embedding in code.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.gif,.svg,.bmp,.avif",
  },

  // ── PNG to ICO ─────────────────────────────────────────────────────
  {
    name: "PNG to ICO",
    slug: "png-to-ico",
    category: "image-tools",
    toolType: "png-to-ico",
    description: "Convert PNG images to ICO format for website favicons. Generates multi-size ICO files (16, 32, 48 px) compatible with every browser.",
    hubLine: "Multi-size Windows icon from one PNG.",
    keywords: ["png to ico", "favicon converter", "ico converter", "create favicon", "png to icon"],
    h1: "Convert PNG to ICO Online — Create Favicons Instantly",
    subtitle: "Turn any PNG into a multi-size ICO favicon file.",
    acceptFormats: ".png",
  },

  // ── Favicon Generator ──────────────────────────────────────────────
  {
    name: "Favicon Generator",
    slug: "favicon-generator",
    category: "image-tools",
    toolType: "favicon-generator",
    description: "Generate a complete favicon set from one image — ICO, Apple Touch, Android, and PWA manifest icons. Download as a ready-to-deploy ZIP.",
    hubLine: "Eight assets and the head snippet.",
    keywords: ["favicon generator", "generate favicon", "favicon all sizes", "apple touch icon", "pwa icons"],
    h1: "Favicon Generator — All Sizes, One Upload",
    subtitle: "Generate 16×16, 32×32, 48×48, 180×180, 192×192, and 512×512 favicons from one image.",
    acceptFormats: ".png,.jpg,.jpeg,.svg,.webp",
  },

  // ── Color Palette Extractor ────────────────────────────────────────
  {
    name: "Image Color Palette",
    slug: "image-color-palette",
    category: "image-tools",
    toolType: "color-palette",
    description: "Extract the dominant colors from any image using median-cut quantization. Copy hex codes to the clipboard for design, branding, or CSS work.",
    hubLine: "Dominant colours as hex, sorted by weight.",
    keywords: ["image color palette", "extract colors from image", "dominant colors", "color picker from image"],
    h1: "Extract Color Palette from Image — Free & Instant",
    subtitle: "Upload an image and get its dominant colors with hex codes.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp,.gif",
  },

  // ── Image Edit Verbs ───────────────────────────────────────────────
  {
    name: "Rotate Image",
    slug: "rotate-image",
    category: "image-tools",
    toolType: "rotate-image",
    description: "Rotate a photo 90°, 180°, or 270° in your browser and save it as PNG, JPG, or WebP. The turn lands on the picture your phone already shows you.",
    hubLine: "A quarter turn, a half turn, or the other quarter.",
    keywords: ["rotate image", "rotate photo online", "turn image 90 degrees", "free image rotator", "rotate picture 180"],
    h1: "Rotate an Image Online — 90°, 180° or 270°",
    subtitle: "Turn a picture a quarter, a half, or three quarters and save it as PNG, JPG or WebP.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp,.gif",
  },
  {
    name: "Flip Image",
    slug: "flip-image",
    category: "image-tools",
    toolType: "flip-image",
    description: "Mirror a picture left to right or top to bottom in your browser, then save it as PNG, JPG, or WebP. Nothing is cropped and nothing is uploaded.",
    hubLine: "Mirror it left-to-right or top-to-bottom.",
    keywords: ["flip image", "mirror image online", "flip photo horizontally", "free image flipper", "flip picture vertically"],
    h1: "Flip an Image Online — Horizontal or Vertical Mirror",
    subtitle: "Mirror a picture left to right or top to bottom and save it as PNG, JPG or WebP.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp,.gif",
  },
  {
    name: "Add Border to Image",
    slug: "add-border",
    category: "image-tools",
    toolType: "add-border",
    description: "Add a solid coloured border to an image — one width on every edge, or a width per edge — and read the exact output size before you save it.",
    hubLine: "One width on every edge, or a width per edge.",
    keywords: ["add border to image", "image border online", "add frame to photo", "picture border tool", "white border for instagram"],
    h1: "Add a Border to an Image — Any Colour, Any Edge",
    subtitle: "Paint a solid frame around a picture: one width on every edge, or a different width per edge.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp,.gif",
  },
  {
    name: "Image Watermarker",
    slug: "watermark-image",
    category: "image-tools",
    toolType: "watermark-image",
    description: "Add a text watermark to any image, right in your browser. Set the position, size, opacity, colour and rotation, and watch a live preview as you go.",
    hubLine: "Type it, place it, and see it before you save.",
    keywords: ["watermark image", "add watermark to photo", "image watermark online", "free watermark tool", "tiled watermark"],
    h1: "Add a Watermark to Images Online — Free and Private",
    subtitle: "Draw a text watermark into an image, with a live preview before you save.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.bmp,.gif,.avif",
  },
  {
    name: "Image Pixelator",
    slug: "pixelate-image",
    category: "image-tools",
    toolType: "pixelate-image",
    description: "Pixelate a whole image or just one region of it in your browser. Drag to pick the area, choose a block size, and save as PNG, JPG or WebP.",
    hubLine: "Cover one region in blocks — or the whole picture.",
    keywords: ["pixelate image", "pixelate part of a photo", "pixelate face in photo", "censor image online", "free pixelate tool"],
    h1: "Pixelate an Image, or Just One Region of It",
    subtitle: "Cover a face, a plate or a code in blocks — with the region measured in the image's own pixels.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.bmp,.gif,.avif",
  },
  {
    name: "Circle Image Cropper",
    slug: "crop-circle",
    category: "image-tools",
    toolType: "crop-circle",
    description: "Crop any image into a circle with transparent corners. Position and size the circle, then save it as a PNG or WebP — JPEG cannot hold transparency.",
    hubLine: "A circle with transparent corners, saved as PNG or WebP.",
    keywords: ["crop image into circle", "circle crop", "circular image cropper", "round profile picture", "circle photo cropper"],
    h1: "Crop an Image Into a Circle — Free, In Your Browser",
    subtitle: "Position the circle over the part you want, then save it as a PNG or WebP with transparent corners.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp,.gif",
  },
  {
    name: "Image Splitter",
    slug: "image-splitter",
    category: "image-tools",
    toolType: "image-splitter",
    description: "Split one image into a grid of up to 10 rows by 10 columns. The tiles add up to the original exactly and come down together as a ZIP file.",
    hubLine: "Rows and columns, and the tiles add up exactly.",
    keywords: ["split image", "image splitter", "cut image into grid", "instagram grid maker", "image tile cutter"],
    h1: "Split an Image Into a Grid of Tiles",
    subtitle: "Cut one picture into rows and columns. Save any tile on its own, or take the whole grid as a ZIP.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp,.gif",
  },
  {
    name: "Social Media Image Resizer",
    slug: "social-media-image-resizer",
    category: "image-tools",
    toolType: "social-media-image-resizer",
    description: "Resize one picture into several social frame sizes at once — square, story, link card and more. Crop to fill or pad to fit, all in your browser.",
    hubLine: "One picture, several named frame sizes at once.",
    keywords: ["social media image resizer", "instagram image size", "story image resizer", "open graph image size", "resize image for social"],
    h1: "Resize an Image for Social Media",
    subtitle: "Write one picture out to several named frame sizes at once, cropped to fill or padded to fit.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp,.gif",
  },

  // ── PNG Optimizer ──────────────────────────────────────────────────
  {
    name: "Compress PNG",
    slug: "compress-png",
    category: "image-tools",
    toolType: "compress-png",
    description: "Re-compress a PNG losslessly with oxipng — every pixel identical, typically 20–35% off a browser or design-app export, 0–3% off an already-optimized one.",
    hubLine: "Real PNG re-compression. Every pixel identical.",
    keywords: ["compress png", "png optimizer", "lossless png compression", "reduce png file size", "oxipng", "shrink png"],
    h1: "Compress PNG Online — Lossless, Free & Private",
    subtitle: "Real PNG re-compression in your browser: fewer bytes, identical pixels, and an honest number when there is nothing left to win.",
    acceptFormats: ".png",
    practicalLimitNote:
      "Enforced: 12 megapixels and 48 MB of decoded image. oxipng holds the decoded raster in wasm memory, and a browser tab cannot give it back.",
  },

  // ── ICO to PNG ─────────────────────────────────────────────────────
  {
    name: "ICO to PNG",
    slug: "ico-to-png",
    category: "image-tools",
    toolType: "ico-to-png",
    description: "Unpack an .ico or .cur and save every size inside it as its own PNG. Icons already stored as PNG come out byte for byte, with no decode at all.",
    hubLine: "Every size in the file, not just the one a browser picks.",
    keywords: ["ico to png", "convert ico to png", "extract favicon", "open ico file", "icon to png", "favicon to png"],
    h1: "Convert ICO to PNG Online — Every Size Inside the File",
    subtitle: "Read the icon directory and save any size the file holds as its own PNG — byte for byte wherever the icon was already a PNG.",
    acceptFormats: ".ico,.cur",
  },

  // ── Base64 to Image ────────────────────────────────────────────────
  {
    name: "Base64 to Image",
    slug: "base64-to-image",
    category: "image-tools",
    toolType: "base64-to-image",
    description: "Paste a Base64 string or data URI and get the image file back. The format is read from the decoded bytes, so a mislabelled data URI still saves correctly.",
    hubLine: "Paste the string, get the file back.",
    keywords: ["base64 to image", "decode base64 image", "base64 to png", "data uri to image"],
    h1: "Base64 to Image — Decode a String Back to a File",
    subtitle: "Paste Base64 or a data URI and download the image it encodes.",
    acceptFormats: "",
    takesNoFile: true,
  },

  // ── Image DPI ──────────────────────────────────────────────────────
  {
    name: "Change Image DPI",
    slug: "change-image-dpi",
    category: "image-tools",
    toolType: "change-image-dpi",
    description: "Set a PNG or JPEG to 72, 150, 300 or 600 DPI by rewriting its header. No pixels are touched and nothing is re-encoded — only the print size changes.",
    hubLine: "Print density only — the pixels stay exactly where they are.",
    keywords: ["change image dpi", "set image dpi", "300 dpi converter", "image dpi changer"],
    h1: "Change Image DPI — Set 72, 150, 300 or 600 DPI",
    subtitle: "Rewrite a PNG or JPEG's print density without touching a pixel.",
    acceptFormats: ".jpg,.jpeg,.png",
  },
  // ── Developer Tools — Text/Data Formatters ─────────────────────────
  {
    name: "JSON Formatter",
    slug: "json-formatter",
    category: "developer-tools",
    toolType: "json-formatter",
    acceptFormats: "",
    takesNoFile: true,
    description: "Format, validate, and minify JSON, with long numeric ids left byte for byte. Syntax errors report the exact line and column — good for API responses.",
    hubLine: "A 64-bit id survives the round trip.",
    keywords: ["json formatter", "json validator", "json beautifier", "json minify", "format json online"],
    h1: "JSON Formatter & Validator — Free Online Tool",
    subtitle: "Paste JSON to format, validate, or minify — syntax errors report the exact line, entirely in your browser.",
  },
  {
    name: "JSON to CSV",
    slug: "json-to-csv",
    category: "developer-tools",
    toolType: "json-to-csv",
    acceptFormats: "",
    takesNoFile: true,
    description: "Convert JSON arrays to CSV with auto-detected headers. Handles nested objects and special characters. Open the result in Excel or Sheets.",
    hubLine: "Nested objects flatten to dotted columns.",
    keywords: ["json to csv", "convert json to csv", "json csv converter", "json to spreadsheet"],
    h1: "Convert JSON to CSV Online — Free & Instant",
    subtitle: "Parse a JSON array and generate a downloadable CSV file with headers.",
  },
  {
    name: "CSV to JSON",
    slug: "csv-to-json",
    category: "developer-tools",
    toolType: "csv-to-json",
    acceptFormats: "",
    takesNoFile: true,
    description: "Convert CSV data to a JSON array of objects, with the header row supplying the keys. Paste your CSV, then copy or download the JSON in one click.",
    hubLine: "Commas inside quotes stay in the field.",
    keywords: ["csv to json", "convert csv to json", "csv json converter", "csv parser"],
    h1: "Convert CSV to JSON Online — Free & Instant",
    subtitle: "Paste CSV data and get a formatted JSON array — no upload needed.",
  },
  {
    name: "SQL Formatter",
    slug: "sql-formatter",
    category: "developer-tools",
    toolType: "sql-formatter",
    acceptFormats: "",
    takesNoFile: true,
    description: "Format and beautify SQL queries with proper indentation and consistent spacing. Supports MySQL, PostgreSQL, MariaDB, T-SQL, BigQuery, and SQLite.",
    hubLine: "Eight dialects, keyword case your choice.",
    keywords: ["sql formatter", "sql beautifier", "format sql", "sql pretty print", "sql indent"],
    h1: "SQL Formatter — Beautify SQL Queries Online",
    subtitle: "Format messy SQL into clean, readable queries with proper indentation.",
  },
  {
    name: "Markdown to HTML",
    slug: "markdown-to-html",
    category: "developer-tools",
    toolType: "markdown-to-html",
    acceptFormats: "",
    takesNoFile: true,
    description: "Convert Markdown to clean HTML with live side-by-side preview. Supports GFM tables, code blocks, task lists, and inline formatting.",
    hubLine: "Rendered preview, or the raw HTML to copy.",
    keywords: ["markdown to html", "convert markdown", "markdown converter", "markdown preview", "md to html"],
    h1: "Markdown to HTML Converter — Live Preview",
    subtitle: "Write or paste Markdown and see the HTML output in real time.",
  },
  {
    name: "HTML to Markdown",
    slug: "html-to-markdown",
    category: "developer-tools",
    toolType: "html-to-markdown",
    acceptFormats: "",
    takesNoFile: true,
    description: "Convert HTML to clean, readable Markdown — preserves links, images, headings, and lists. Strips inline styles for a portable result.",
    hubLine: "ATX headings, fenced code, styles dropped.",
    keywords: ["html to markdown", "convert html to markdown", "html to md", "html markdown converter"],
    h1: "Convert HTML to Markdown Online — Free & Clean",
    subtitle: "Paste HTML and get clean, readable Markdown output.",
  },
  {
    name: "XML Formatter",
    slug: "xml-formatter",
    category: "developer-tools",
    toolType: "xml-formatter",
    acceptFormats: "",
    takesNoFile: true,
    description: "Format, validate, and indent XML, or minify it back to one line. Malformed tags surface the parser's own message — handy for SOAP and config files.",
    hubLine: "Mixed content is never re-indented.",
    keywords: ["xml formatter", "xml beautifier", "format xml", "xml validator", "xml pretty print"],
    h1: "XML Formatter & Validator — Free Online Tool",
    subtitle: "Format messy XML into readable, indented output with validation.",
  },

  // ── Developer Tools — Encoders/Decoders ───────────────────────────
  {
    name: "Base64 Encode/Decode",
    slug: "base64-encode-decode",
    category: "developer-tools",
    toolType: "base64-encode-decode",
    acceptFormats: "",
    description: "Encode text or a whole file to Base64, and decode Base64 back to text. Everything runs in this tab — no upload and no server round trip.",
    hubLine: "Line-wrapped or URL-safe input still decodes.",
    keywords: ["base64 encode", "base64 decode", "base64 converter", "encode base64", "decode base64"],
    h1: "Base64 Encode & Decode — Free Online Tool",
    subtitle: "Encode text or files to Base64 and decode Base64 strings — all in your browser.",
  },
  {
    name: "URL Encode/Decode",
    slug: "url-encode-decode",
    category: "developer-tools",
    toolType: "url-encode-decode",
    acceptFormats: "",
    takesNoFile: true,
    description: "Encode and decode URLs, query strings, and form parameters. Handles unicode, reserved characters, and percent-encoding correctly.",
    hubLine: "Percent-encoding for a single component.",
    keywords: ["url encode", "url decode", "urlencode", "urldecode", "percent encoding"],
    h1: "URL Encode & Decode — Free Online Tool",
    subtitle: "Encode special characters for URLs or decode percent-encoded strings.",
  },
  {
    name: "JWT Decoder",
    slug: "jwt-decoder",
    category: "developer-tools",
    toolType: "jwt-decoder",
    acceptFormats: "",
    takesNoFile: true,
    description: "Decode JWT tokens to inspect header, payload claims, and expiration. Tokens are parsed locally — never sent to a server, safe for production debugging.",
    hubLine: "Claims and expiry, without a signature check.",
    keywords: ["jwt decoder", "decode jwt", "jwt parser", "jwt debugger", "json web token"],
    h1: "JWT Decoder — Inspect JSON Web Tokens Online",
    subtitle: "Paste a JWT to decode its header, payload, and check expiration.",
  },
  {
    name: "HTML Entity Encode/Decode",
    slug: "html-entity-encode-decode",
    category: "developer-tools",
    toolType: "html-entity-encode-decode",
    acceptFormats: "",
    takesNoFile: true,
    description: "Encode and decode HTML entities — convert special characters like <, >, & to HTML-safe text and back. Supports numeric and named entities.",
    hubLine: "Encodes five characters, decodes them all.",
    keywords: ["html entity encode", "html entity decode", "html entities", "html special characters", "escape html"],
    h1: "HTML Entity Encode & Decode — Free Online Tool",
    subtitle: "Convert special characters to HTML entities and back.",
  },

  // ── Developer Tools — Generators ──────────────────────────────────
  {
    name: "UUID Generator",
    slug: "uuid-generator",
    category: "developer-tools",
    toolType: "uuid-generator",
    acceptFormats: "",
    takesNoFile: true,
    description: "Generate v4 (random) and v7 (time-ordered) UUIDs in bulk — up to 100 at a time. Cryptographically secure via the Web Crypto API.",
    hubLine: "Time-ordered v7, or plain random v4.",
    keywords: ["uuid generator", "generate uuid", "uuid v4", "uuid v7", "random uuid", "guid generator"],
    h1: "UUID Generator — v4 & v7, Bulk Generate",
    subtitle: "Generate random (v4) or time-based (v7) UUIDs — up to 100 at a time.",
  },
  {
    name: "Password Generator",
    slug: "password-generator",
    category: "developer-tools",
    toolType: "password-generator",
    acceptFormats: "",
    takesNoFile: true,
    description: "Generate cryptographically strong passwords with custom length and character sets. Powered by Web Crypto — never sent over the network.",
    hubLine: "Up to 128 characters, drawn without bias.",
    keywords: ["password generator", "generate password", "random password", "strong password", "secure password"],
    h1: "Password Generator — Strong & Cryptographically Secure",
    subtitle: "Generate random passwords with customizable length, character types, and strength meter.",
  },
  {
    name: "Hash Generator",
    slug: "hash-generator",
    category: "developer-tools",
    toolType: "hash-generator",
    acceptFormats: "",
    description: "Generate SHA-1, SHA-256, SHA-512, and MD5 hashes from text or files. Use for integrity checks, fingerprints, and quick deduplication.",
    hubLine: "MD5, SHA-1, SHA-256 and SHA-512 at once.",
    keywords: ["hash generator", "sha256", "md5 hash", "sha1", "sha512", "file hash", "checksum"],
    h1: "Hash Generator — SHA-256, SHA-512, MD5 & More",
    subtitle: "Generate MD5, SHA-1, SHA-256, and SHA-512 hashes from text or a file, entirely in your browser.",
    /*
      ⚠ NO `practicalLimitNote` HERE ANY MORE, AND THAT IS A CHANGE RATHER THAN
      AN OMISSION. Until 2026-09-13 the File arm read the whole file into ONE
      ArrayBuffer before the first digest started, so ceiling (2) in the
      derivation block atop ffmpeg-loader.ts bound this page with no FFmpeg
      anywhere near it: a 2.2 GB ISO — the most natural thing a person brings
      to a checksum tool — made `arrayBuffer()` reject outright.

      The digests are now computed off `blob.stream()` (hash-digest.ts), so
      nothing is ever resident and there is no allocation left to refuse. This
      is the one tool family on the site where the ceiling was pure accident:
      hash functions are incremental by construction, and only SubtleCrypto's
      single whole-buffer entry point was forcing the file to be materialised.
      The cost, measured, is throughput — ~39 MB/s for all four digests in JS
      in the browser, against SubtleCrypto's native speed — which is why the
      page shows a progress bar and why the trade is written down in
      hash-digest.ts.
    */
  },
  {
    name: "Lorem Ipsum Generator",
    slug: "lorem-ipsum-generator",
    category: "developer-tools",
    toolType: "lorem-ipsum-generator",
    acceptFormats: "",
    takesNoFile: true,
    description: "Generate Lorem Ipsum placeholder text by paragraphs, sentences, or words. Adjustable length for design mockups, layouts, and content prototypes.",
    hubLine: "Word counts arrive without a full stop.",
    keywords: ["lorem ipsum generator", "placeholder text", "dummy text", "lipsum", "lorem ipsum"],
    h1: "Lorem Ipsum Generator — Paragraphs, Sentences & Words",
    subtitle: "Generate placeholder text for designs and mockups — copy with one click.",
  },
  {
    name: "QR Code Generator",
    slug: "qr-code-generator",
    category: "developer-tools",
    toolType: "qr-code-generator",
    acceptFormats: "",
    takesNoFile: true,
    description: "Generate a scannable QR code from any URL or text you paste, in the colors you choose. Save it as a PNG bitmap or as a scalable SVG.",
    hubLine: "Pick both colours; save PNG or SVG.",
    keywords: ["qr code generator", "create qr code", "qr code maker", "generate qr code", "qr code"],
    h1: "QR Code Generator — Free, Customizable",
    subtitle: "Enter text or a URL and generate a downloadable QR code with custom colors.",
  },

  // ── Developer Tools — CSS Tools ───────────────────────────────────
  {
    name: "Color Picker & Converter",
    slug: "color-picker",
    category: "developer-tools",
    toolType: "color-picker",
    acceptFormats: "",
    takesNoFile: true,
    description: "Pick colors visually and convert between HEX, RGB, and HSL in real time. Type into any format's fields and copy the value you need in one click.",
    hubLine: "Sliding to black and back keeps your hue.",
    keywords: ["color picker", "hex to rgb", "rgb to hex", "hsl converter", "color converter", "color tool"],
    h1: "Color Picker & Converter — HEX, RGB, HSL",
    subtitle: "Pick a color visually or convert between HEX, RGB, and HSL formats.",
  },
  {
    name: "CSS Gradient Generator",
    slug: "css-gradient-generator",
    category: "developer-tools",
    toolType: "css-gradient-generator",
    acceptFormats: "",
    takesNoFile: true,
    description: "Build CSS gradients visually — linear, radial, and conic. Drag color stops, fine-tune angles, and copy production-ready CSS in one click.",
    hubLine: "Linear, radial or conic, with any stops.",
    keywords: ["css gradient generator", "gradient maker", "linear gradient", "radial gradient", "css gradient"],
    h1: "CSS Gradient Generator — Visual Builder",
    subtitle: "Design linear, radial, or conic gradients visually and copy the CSS code.",
  },
  {
    name: "Box Shadow Generator",
    slug: "box-shadow-generator",
    category: "developer-tools",
    toolType: "box-shadow-generator",
    acceptFormats: "",
    takesNoFile: true,
    description: "Build CSS box shadows visually with multiple stacked layers, inset toggle, and live preview. Copy production-ready CSS in one click.",
    hubLine: "Stacked layers, inset ones included.",
    keywords: ["box shadow generator", "css box shadow", "shadow generator", "css shadow", "box shadow css"],
    h1: "CSS Box Shadow Generator — Visual Builder",
    subtitle: "Design box shadows with multiple layers and copy the CSS code.",
  },

  // ── Developer Tools — Other Utilities ─────────────────────────────
  {
    name: "Regex Tester",
    slug: "regex-tester",
    category: "developer-tools",
    toolType: "regex-tester",
    acceptFormats: "",
    takesNoFile: true,
    description: "Test regular expressions with real-time match highlighting and capture group inspection. Toggle the g, i, m, s, and u flags as you type.",
    hubLine: "A runaway pattern times out, not your tab.",
    keywords: ["regex tester", "regex tester online", "test regex", "regular expression", "regex debugger"],
    h1: "Regex Tester — Real-Time Match Highlighting",
    subtitle: "Enter a regex and test string to see matches and capture groups highlighted in real time.",
  },
  {
    name: "Cron Expression Generator",
    slug: "cron-expression-generator",
    category: "developer-tools",
    toolType: "cron-expression-generator",
    acceptFormats: "",
    takesNoFile: true,
    description: "Build cron expressions visually with human-readable descriptions and the next 5 scheduled run times. Works for crontab, Kubernetes, and GitHub Actions.",
    hubLine: "Plain English, plus the next five runs.",
    keywords: ["cron expression generator", "cron builder", "crontab", "cron schedule", "cron job"],
    h1: "Cron Expression Generator — Visual Builder",
    subtitle: "Build cron expressions with a visual UI — see human-readable descriptions and next run times.",
  },
  {
    name: "Timestamp Converter",
    slug: "timestamp-converter",
    category: "developer-tools",
    toolType: "timestamp-converter",
    acceptFormats: "",
    takesNoFile: true,
    description: "Convert between Unix timestamps in seconds or milliseconds, ISO 8601, and human-readable dates — edit any of the four fields and the rest follow.",
    hubLine: "Seconds or milliseconds, local or UTC.",
    keywords: ["timestamp converter", "unix timestamp", "epoch converter", "iso 8601", "date converter"],
    h1: "Timestamp Converter — Unix, ISO 8601 & Human-Readable",
    subtitle: "Convert between Unix timestamps, ISO 8601, and human-readable date formats.",
  },
  {
    name: "Text Diff",
    slug: "text-diff",
    category: "developer-tools",
    toolType: "text-diff",
    acceptFormats: "",
    takesNoFile: true,
    description: "Compare two blocks of text and see every difference highlighted in one combined pane — additions marked in green, deletions struck through in red.",
    hubLine: "Differences by word, or by whole line.",
    keywords: ["text diff", "compare text", "diff tool", "text comparison", "find differences"],
    h1: "Text Diff — Compare Two Texts Online",
    subtitle: "Paste two texts and see every difference in one pane, by word or by line.",
  },
  {
    name: "Text Case Converter",
    slug: "text-case-converter",
    category: "developer-tools",
    toolType: "text-case-converter",
    acceptFormats: "",
    takesNoFile: true,
    description: "Convert text between UPPERCASE, lowercase, Title Case, camelCase, snake_case, kebab-case, and PascalCase. One click per format, then live as you type.",
    hubLine: "Seven cases, and Title Case spares acronyms.",
    keywords: ["text case converter", "uppercase", "lowercase", "camelcase", "snake case", "title case"],
    h1: "Text Case Converter — 7 Case Formats",
    subtitle: "Convert text between UPPERCASE, lowercase, Title Case, camelCase, snake_case, kebab-case, and PascalCase.",
  },
  {
    name: "Word Counter",
    slug: "word-counter",
    category: "developer-tools",
    toolType: "word-counter",
    acceptFormats: "",
    takesNoFile: true,
    description: "Count characters, words, sentences, paragraphs, and estimate reading time. Live updates as you type — perfect for essays, blog posts, and tweets.",
    hubLine: "Reading time at 225 words a minute.",
    keywords: ["word counter", "character count", "word count", "reading time", "text statistics"],
    h1: "Word & Character Counter — Free Online Tool",
    subtitle: "Count characters, words, sentences, paragraphs, and get a reading time estimate.",
  },
  {
    name: "Subtitle Converter",
    slug: "subtitle-converter",
    category: "developer-tools",
    toolType: "subtitle-converter",
    // The one developer tool that declares a picker string. The others read
    // pasted text and leave this empty; this page's File arm mounts a DropZone
    // over `SUBTITLE_ACCEPT`, so the ACCEPTS line derives from the same set the
    // picker takes (`workspace.ts`), rather than a literal that could drift.
    acceptFormats: ".srt,.vtt,.ass,.ssa",
    description: "Convert subtitles between SRT, WebVTT and ASS, shift every cue by an offset, or re-time between PAL and NTSC frame rates. ASS styling does not survive.",
    hubLine: "Convert, shift, or re-time to another frame rate.",
    keywords: ["subtitle converter", "srt to vtt", "ass to srt", "shift subtitle timing", "subtitle frame rate converter"],
    h1: "Subtitle Converter — SRT, WebVTT and ASS",
    subtitle: "Convert between SRT, WebVTT and ASS, shift every cue by a fixed offset, or re-time a file that was timed for a different frame rate.",
  },
  // ── PDF Tools ────────────────────────────────────────────────────────
  {
    name: "Merge PDF",
    slug: "merge-pdf",
    category: "pdf-tools",
    toolType: "merge-pdf",
    acceptFormats: ".pdf",
    description: "Merge multiple PDFs into one file. Drag to reorder the files, see each file's page count, and combine — no page-count or file-size limits.",
    hubLine: "Any number of files, in the order you set.",
    keywords: ["merge pdf", "combine pdf", "join pdf", "pdf merger", "merge pdf files"],
    h1: "Merge PDF Files Online — Free, No Upload",
    subtitle: "Drag and drop multiple PDFs to combine them into a single file — entirely in your browser.",
  },
  {
    name: "Split PDF",
    slug: "split-pdf",
    category: "pdf-tools",
    toolType: "split-pdf",
    acceptFormats: ".pdf",
    description: "Extract pages from a PDF into a new file — click page thumbnails or type a range like 1-3, 5, 8-10. Fonts and formatting are preserved.",
    hubLine: "Type 1-3, 5, 8-10 or click the pages.",
    keywords: ["split pdf", "extract pdf pages", "pdf splitter", "separate pdf pages"],
    h1: "Split PDF — Extract Pages Online",
    subtitle: "Upload a PDF, select the pages you need, and download a new PDF with just those pages.",
  },
  {
    name: "Compress PDF",
    slug: "compress-pdf",
    category: "pdf-tools",
    toolType: "compress-pdf",
    acceptFormats: ".pdf",
    description: "Reduce PDF file size — objects nothing references are dropped, uncompressed streams deflated, the structure repacked. Text and images stay untouched.",
    hubLine: "Returns your original if it cannot do better.",
    keywords: ["compress pdf", "reduce pdf size", "pdf compressor", "shrink pdf", "optimize pdf", "pdf smaller", "make pdf smaller"],
    h1: "Compress PDF — Reduce File Size Online",
    subtitle: "Reduce your PDF file size by dropping unreferenced objects and deflating the streams that arrived uncompressed.",
  },
  {
    name: "Recompress PDF Images",
    slug: "recompress-pdf-images",
    category: "pdf-tools",
    toolType: "recompress-pdf-images",
    acceptFormats: ".pdf",
    description: "Re-encode the JPEG images inside a PDF at a lower quality to shrink the file. Choose a quality preset or a target size in KB. Lossy and irreversible.",
    hubLine: "Lossy on purpose — the photos get re-encoded.",
    keywords: ["recompress pdf images", "compress pdf images", "reduce pdf image size", "lossy pdf compression", "shrink photo pdf"],
    h1: "Recompress PDF Images — Shrink a Photo-Heavy PDF",
    subtitle: "Re-encode the images inside a PDF at a lower quality to make the file smaller — lossy, irreversible, and entirely in your browser.",
  },
  {
    name: "PDF to JPG",
    slug: "pdf-to-jpg",
    category: "pdf-tools",
    toolType: "pdf-to-jpg",
    acceptFormats: ".pdf",
    description: "Convert each page of a PDF to a JPG, PNG, or WebP image. Multi-page PDFs export as a downloadable ZIP. Adjustable resolution for print or web.",
    hubLine: "One image per page at up to 4× scale.",
    keywords: ["pdf to jpg", "pdf to image", "convert pdf to jpg", "pdf to jpeg"],
    h1: "Convert PDF to JPG — Free Online Tool",
    subtitle: "Render each page of your PDF as a high-quality JPG, PNG, or WebP image.",
  },
  {
    name: "PDF to PNG",
    slug: "pdf-to-png",
    category: "pdf-tools",
    toolType: "pdf-to-jpg",
    acceptFormats: ".pdf",
    targetFormat: "png",
    description: "Convert each page of a PDF to a lossless PNG image. Multi-page PDFs download as a ZIP with one PNG per page. Renders at up to 4× scale for print.",
    hubLine: "Lossless page renders that keep text crisp.",
    keywords: ["pdf to png", "convert pdf to png", "pdf to png converter", "pdf pages to png"],
    h1: "Convert PDF to PNG — Free Online Tool",
    subtitle: "Render each page of your PDF as a lossless, pixel-crisp PNG image.",
  },
  {
    name: "PDF to WebP",
    slug: "pdf-to-webp",
    category: "pdf-tools",
    toolType: "pdf-to-jpg",
    acceptFormats: ".pdf",
    targetFormat: "webp",
    description: "Convert PDF pages to WebP images that come out smaller than JPG at similar quality. Needs a browser that can encode WebP, such as Chrome or Edge.",
    hubLine: "Smaller than JPG — in browsers that can encode WebP.",
    keywords: ["pdf to webp", "convert pdf to webp", "pdf pages to webp", "pdf to webp converter"],
    h1: "Convert PDF to WebP — Free Online Tool",
    subtitle: "Render each PDF page as a WebP image — smaller than JPG at similar quality.",
  },
  {
    name: "Images to PDF",
    slug: "images-to-pdf",
    category: "pdf-tools",
    toolType: "images-to-pdf",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.heic,.heif,.tiff,.tif",
    description: "Combine JPG, PNG, WebP, HEIC, and TIFF images into one PDF. Reorder pages, choose A4, Letter, or fit-to-image, and download a single document.",
    hubLine: "Five image formats, on A4, Letter or fit-to-image.",
    keywords: ["images to pdf", "convert images to pdf", "photo to pdf", "pictures to pdf"],
    h1: "Convert Images to PDF — Free Online Tool",
    subtitle: "Upload images, reorder them, choose a page size, and combine into a single PDF.",
  },
  {
    name: "JPG to PDF",
    slug: "jpg-to-pdf",
    category: "pdf-tools",
    toolType: "images-to-pdf",
    acceptFormats: ".jpg,.jpeg",
    description: "Combine JPG photos into one PDF — bytes are embedded without re-encoding, so nothing is lost. Reorder pages; A4, Letter, or fit-to-image output.",
    hubLine: "Your JPG bytes, embedded untouched.",
    keywords: ["jpg to pdf", "jpeg to pdf", "convert jpg to pdf", "jpg to pdf converter"],
    h1: "Convert JPG to PDF — Free Online Tool",
    subtitle: "Combine one or more JPG photos into a single PDF, with the bytes embedded untouched.",
  },
  {
    name: "PNG to PDF",
    slug: "png-to-pdf",
    category: "pdf-tools",
    toolType: "images-to-pdf",
    acceptFormats: ".png",
    description: "Turn PNG images into a single PDF. 8-bit PNGs are repacked losslessly and transparency survives as an alpha mask. Reorder pages; A4, Letter, or fit.",
    hubLine: "Lossless 8-bit repack; transparency survives.",
    keywords: ["png to pdf", "convert png to pdf", "png to pdf converter", "png image to pdf"],
    h1: "Convert PNG to PDF — Free Online Tool",
    subtitle: "Turn PNG screenshots and graphics into a single PDF with transparency intact.",
  },
  {
    name: "HEIC to PDF",
    slug: "heic-to-pdf",
    category: "pdf-tools",
    toolType: "images-to-pdf",
    acceptFormats: ".heic,.heif",
    description: "Convert iPhone HEIC photos into a single PDF, decoded right in your browser. Reorder pages and choose A4, Letter, or fit-to-image page sizes.",
    hubLine: "iPhone photos straight into a PDF.",
    keywords: ["heic to pdf", "convert heic to pdf", "iphone photo to pdf", "heif to pdf"],
    h1: "Convert HEIC to PDF — Free Online Tool",
    subtitle: "Turn iPhone HEIC photos into a single PDF document, decoded entirely in your browser.",
  },
  {
    name: "WebP to PDF",
    slug: "webp-to-pdf",
    category: "pdf-tools",
    toolType: "images-to-pdf",
    acceptFormats: ".webp",
    description: "Convert WebP images to a single PDF. Opaque images embed as JPEG, transparent ones as PNG; animated files keep frame one with a notice shown.",
    hubLine: "Decoded first — PDF has no WebP embedder.",
    keywords: ["webp to pdf", "convert webp to pdf", "webp to pdf converter", "webp image to pdf"],
    h1: "Convert WebP to PDF — Free Online Tool",
    subtitle: "Turn WebP images into a single PDF — decoded and re-encoded in your browser, no upload.",
  },
  {
    name: "TIFF to PDF",
    slug: "tiff-to-pdf",
    category: "pdf-tools",
    toolType: "images-to-pdf",
    acceptFormats: ".tiff,.tif",
    description: "Convert TIFF to PDF with every page kept — a 30-page scan becomes a 30-page PDF. Multi-page TIFFs decode in your browser with utif2; no upload.",
    hubLine: "Every TIFF page becomes a PDF page.",
    keywords: ["tiff to pdf", "convert tiff to pdf", "multi-page tiff to pdf", "tif to pdf"],
    h1: "Convert TIFF to PDF — Free Online Tool",
    subtitle: "Turn single- and multi-page TIFF scans into a PDF — every page of the TIFF becomes a page of the PDF.",
  },
  {
    name: "Rotate PDF",
    slug: "rotate-pdf",
    category: "pdf-tools",
    toolType: "rotate-pdf",
    acceptFormats: ".pdf",
    description: "Rotate PDF pages by 90°, 180°, or 270°. Select individual pages or rotate everything in one go — fixes scanned and sideways documents.",
    hubLine: "90°, 180° or 270°, added to the current angle.",
    keywords: ["rotate pdf", "rotate pdf pages", "pdf rotation", "turn pdf page"],
    h1: "Rotate PDF Pages — Free Online Tool",
    subtitle: "Select pages and rotate them 90°, 180°, or 270° — no upload needed.",
  },
  {
    name: "Add Page Numbers",
    slug: "add-page-numbers",
    category: "pdf-tools",
    toolType: "add-page-numbers",
    acceptFormats: ".pdf",
    description: "Add page numbers to any PDF — six positions (top or bottom; left, center, or right) and any starting number, set in 10pt Helvetica.",
    hubLine: "Six positions and any starting number.",
    keywords: ["add page numbers pdf", "pdf page numbers", "number pdf pages", "pdf pagination"],
    h1: "Add Page Numbers to PDF — Free Online Tool",
    subtitle: "Upload a PDF and add page numbers at any position — top or bottom, left, center, or right.",
  },
  {
    name: "Reorder PDF Pages",
    slug: "pdf-page-reorder",
    category: "pdf-tools",
    toolType: "pdf-page-reorder",
    acceptFormats: ".pdf",
    description: "Reorder pages in a PDF by dragging thumbnails. Visual previews of every page — rearrange chapters, sort scans, or swap sections.",
    hubLine: "Thumbnails move by drag or by arrow key.",
    keywords: ["reorder pdf pages", "rearrange pdf", "pdf page order", "move pdf pages"],
    h1: "Reorder PDF Pages — Free Online Tool",
    subtitle: "Drag and drop page thumbnails to rearrange your PDF — no upload needed.",
  },
  /*
    What a page graft actually carries — measured, not assumed.

    `graftPages` (pdf-engine-core.ts) builds its target with
    `PDFDocument.create()` and then only `copyPages` + `copyDocInfo`. copyPages
    walks the page sub-graph; NOTHING reads the source catalog. Ran the shipped
    engine over a 4-page source carrying /AcroForm (a filled text field plus a
    checked box), /Outlines, /Names (/Dests) and /PageLabels:

      SOURCE               catalog = /Type /Pages /AcroForm /PageLabels /Names /Outlines
                           getForm().getFields() = [applicant.name, agreed]
      splitPdf([0,1])      catalog = /Type /Pages          getFields() = []
      deletePdfPages([2])  catalog = /Type /Pages          getFields() = []
      splitPdfToPages[0]   catalog = /Type /Pages          getFields() = []

    The widget annotations DO survive in the page's /Annots (2 before, 2
    after), so the field still draws with its value visible — which is exactly
    what makes the old copy ("form fields come over exactly as they were")
    plausible-looking and wrong: it draws, but with no /AcroForm there is no
    /Fields, no /DA and no /NeedAppearances, so no viewer or form API can fill
    it, read it or export it. /PageLabels going the same way is separately
    visible: a document numbered i, ii, 1, 2 comes back 1, 2, 3, 4.

    For contrast, the in-place ops on the same fixture — rotatePdfPages,
    cropPdfPages, changePdfPageSize — all keep the full catalog and all four
    field names. So this is not a pdf-lib-wide limit the copy could be read as
    implicitly covering; it is specific to the graft, and the graft tools are
    exactly the ones whose copy used to promise otherwise.

    The engine's own comment on `sweepUnreachableObjects` has always said this
    ("copyPages carries pages and nothing else, and would silently drop all of
    it") — the copy is what was out of step. Keep these four losses named here,
    in delete-pdf-pages below, and in both tools' FAQ entries.

    WHAT CHANGED UNDER THIS COPY: internal links used to be broken and used to
    keep dropped pages in the file. `fixAnnotationPageRefs` repointed only /P,
    so a /Link's `/Dest [pageRef /Fit]` — or its `/A << /S /GoTo /D >>` — still
    pointed at the duplicate page object pdf-lib's copier dragged along, which
    no reader can locate and which the reachability sweep therefore refused to
    collect. It now walks the source and output /Annots arrays in lockstep,
    repoints destinations whose page survived, and deletes the key outright
    when it did not.

    Re-measured here on a 4-page report — page 1 carries three links (explicit
    /Dest -> page 4, /A /GoTo -> page 2, and a NAMED destination -> page 3) —
    by running the shipped functions against a build with the repoint and the
    two deletes disabled:

                              page objs / bytes      page-1 links resolve to
      deletePdfPages([2,3])   pre  4 / 1469          page 1, page 1, dead
                              now  2 / 1158          removed, page 2, removed
      deletePdfPages([1])     pre  5 / 1664
                              now  3 / 1457
      extract all four        pre  6 / 1679          page 1, page 1, dead
                              now  4 / 1659          page 4, page 2, dead
      mergePdfs([src])        pre  6 / 1679          page 1, page 1, dead
                              now  4 / 1659          page 4, page 2, dead

    The 2-page output of `deletePdfPages([2,3])` used to carry the deleted
    page's content stream verbatim — inflating object 7 gave back
    `<434F4E464944454E5449414C2053414C415259205441424C45> Tj`, i.e.
    "CONFIDENTIAL SALARY TABLE". It is not in the post-fix file at all. That is
    why delete-pdf-pages' description may now say pages are removed with no
    hedge, and why the copy says the deleted bytes are gone.

    The NAMED destination is dead either way and that is not a regression: the
    graft carries no /Names table, so there is nothing for the name to resolve
    against. When its target page is dropped the whole /A goes; when the target
    survives the link stays and points at a name nothing defines. Both shapes
    are described in the copy rather than glossed as "links survive".

    ONE THING THE COPY MUST NOT OVERCLAIM: merge repoints by source page-ref
    tag, and two documents from the same producer routinely number their page
    objects identically. Measured — merging a 3-page file into a 7-page file,
    both with page refs starting at "5 0 R", sent the FIRST file's link to page
    3 to the SECOND file's page 3 (merged page 6). A 4+2 merge, where the tags
    do not collide, is correct. So the merge FAQ says internal links work and
    names that exception; do not simplify it away.
  */
  {
    name: "Extract PDF Pages",
    slug: "extract-pdf-pages",
    category: "pdf-tools",
    toolType: "extract-pdf-pages",
    acceptFormats: ".pdf",
    description: "Pull pages out of a PDF as one document, or as a separate PDF for every page in a ZIP. Pages are copied whole, so nothing is re-rendered.",
    hubLine: "One file with the lot, or one file per page.",
    keywords: ["extract pdf pages", "pdf page extractor", "extract pages from pdf", "save pdf pages separately", "pdf to separate pages"],
    h1: "Extract Pages from a PDF — Free Online Tool",
    subtitle: "Pick the pages you want and save them as a single PDF — or as one PDF per page, zipped.",
  },
  {
    name: "Delete PDF Pages",
    slug: "delete-pdf-pages",
    category: "pdf-tools",
    toolType: "delete-pdf-pages",
    acceptFormats: ".pdf",
    description: "Remove pages from a PDF and download everything else. Click the pages to drop or type a range, and watch the remaining page count as you go.",
    hubLine: "Pick what leaves; the rest is copied whole.",
    keywords: ["delete pdf pages", "remove pages from pdf", "pdf page remover", "delete page from pdf", "erase pdf pages"],
    h1: "Delete Pages from a PDF — Free Online Tool",
    subtitle: "Mark the pages you want gone and download the document without them.",
  },
  /*
    The zero-overlap page is why this copy says "offered to every page" rather
    than "applied to every page".

    `cropPdfPages` maps the visual frame into each page's content space and
    intersects it with that page's own visible rect; `intersectRect` returns
    null when the extent is non-positive and the loop then does `continue`.
    Skipping is the right output — the alternative is a degenerate sheet — but
    it means the page comes out at its ORIGINAL FULL SIZE, which is the exact
    opposite of "keeps whatever of the frame fits".

    Measured on a 3-page mixed-size document (A4 portrait, A4 landscape, a
    595x200 strip) with a top-band frame at visual (50, 600, 400x200):

      page 1  MediaBox 50,600 400x200   cropped
      page 2  MediaBox 0,0 841.89x595.28  UNTOUCHED (landscape is only 595 tall)
      page 3  MediaBox 0,0 595.28x200     UNTOUCHED

    The partial-overlap case does behave as the old copy said — the same
    document with a frame at (30, 100, 400x300) gives page 3 a 400x100 sliver —
    so only the disjoint case was mis-described. The engine returns bytes only
    (PdfJobResult has no channel for a skipped-page count) and the UI still
    prints "PAGES: ALL n", so the honest move until that plumbing exists is to
    say the skip happens and that nothing flags it.
  */
  {
    name: "Crop PDF",
    slug: "crop-pdf",
    category: "pdf-tools",
    toolType: "crop-pdf",
    acceptFormats: ".pdf",
    description: "Crop a PDF by dragging a frame over the first page. Cropping moves the page boxes — it hides what falls outside, it does not delete it.",
    hubLine: "Drag a frame; every page gets it.",
    keywords: ["crop pdf", "crop pdf pages", "trim pdf margins", "pdf cropper", "remove pdf margins"],
    h1: "Crop PDF Pages — Free Online Tool",
    subtitle: "Drag a crop frame over page one and apply it to every page in the document.",
  },
  /*
    The annotation caveat below, re-measured after the engine changed under it.

    This copy USED to describe a displacement, because there was one. The
    content got a full `cm` carrying the centring terms ex/ey while annotations
    got `page.scaleAnnotations(s, s)` — a multiply about the origin with NO
    translation — so content landed at s·p + e and its annotations at s·p, and
    the two agreed only when ex = ey = 0. `changePdfPageSize` now calls
    `transformAnnotations(page, scale, ex, ey)` instead, which gives /Rect,
    /QuadPoints, /Vertices, /L and /InkList the same affine the content gets.

    Re-measured through this repo's own pdfjs, on a page whose /Link /Rect
    exactly covers a drawn 200 × 40 button: for each resize the button's
    painted device rect and the annotation's rect (via
    `convertToViewportPoint`) are compared corner to corner. Two builds of the
    same engine, one with the old `scaleAnnotations` line restored:

                                        OLD drift    NOW
      A4     -> Letter                    26.00 pt   0.00 pt
      Letter -> A4                        35.76 pt   0.00 pt
      Letter -> Legal                    108.00 pt   0.00 pt
      A4     -> A5                         0.97 pt   0.00 pt
      A4     -> A3                         0.04 pt   0.00 pt
      Letter -> A4 landscape             190.95 pt   0.00 pt
      Legal  -> Tabloid landscape        371.57 pt   0.00 pt
      A4     -> Letter, MediaBox [20 30…] 29.12 pt   0.00 pt
      A4     -> Letter, /Rotate 90       179.63 pt   0.00 pt
      A4     -> Legal,  /Rotate 270      287.63 pt   0.00 pt

    So the displacement sentence is now false in the other direction and had to
    go. Do NOT reinstate those numbers.

    What is left is the /AP one, and it is narrower than it reads. Measured on
    a widget with a real appearance stream, /Rect [80 300 280 340] and
    /AP /N /BBox [0 0 200 40], resized Letter -> A3:

      /Rect      200.00 x 40.00  ->  275.13 x 55.03   (scaled, correct)
      /AP /BBox  200.00 x 40.00  ->  200.00 x 40.00   (untouched)
      /DA        "/Helv 12 Tf 0 g" -> "/Helv 12 Tf 0 g" (untouched)

    A conforming viewer maps the appearance's bounding box onto the rectangle
    (PDF 32000-1 12.5.5), and pdfjs does: its `beginAnnotation` transform for
    that output is [1.3756, 0, 0, 1.3756, 110.05, 463.21], i.e. the stored
    picture is stretched by exactly the page's scale factor and looks right.
    The residue is the /DA font size, which still names 12 pt — so a viewer
    that REDRAWS the field rather than using the stored picture (which is what
    happens the moment someone types into it again) lays the text out at 12 pt
    inside a box that is now 1.38x bigger. That is the caveat worth stating,
    and it is smaller than "the box and its text come out at different sizes",
    which is what this comment used to license. Say the narrow, true thing.
  */
  {
    name: "Change PDF Page Size",
    slug: "change-pdf-page-size",
    category: "pdf-tools",
    toolType: "change-pdf-page-size",
    acceptFormats: ".pdf",
    description: "Resize every page of a PDF to A3, A4, A5, Letter, Legal or Tabloid. Scale the content to fit and centre it, or move the page box only.",
    hubLine: "Six sheet sizes, scaled to fit or box only.",
    keywords: ["change pdf page size", "resize pdf pages", "pdf to a4", "letter to a4 pdf", "pdf page dimensions"],
    h1: "Change PDF Page Size — Free Online Tool",
    subtitle: "Turn every page into A3, A4, A5, Letter, Legal, or Tabloid — portrait or landscape.",
  },
  {
    name: "PDF Resizer",
    slug: "pdf-resizer",
    category: "pdf-tools",
    toolType: "pdf-resizer",
    acceptFormats: ".pdf",
    description: "Resize a PDF two ways from one file: change every page to A4, Letter or Legal, or shrink the file itself with a lossless structural rewrite.",
    hubLine: "Page size or file size, over the same file.",
    keywords: ["pdf resizer", "resize pdf", "pdf size reducer", "change pdf size", "make pdf smaller"],
    h1: "PDF Resizer — Change Page Size or File Size",
    subtitle: "One dropped PDF, two jobs: resize the pages, or shrink the file — switch between them freely.",
  },
  {
    name: "PDF to Text",
    slug: "pdf-to-text",
    category: "pdf-tools",
    toolType: "pdf-to-text",
    acceptFormats: ".pdf",
    description: "Extract the text of a PDF and copy it or save it as a .txt file. There is no OCR here, so scanned pages come back empty — and it says so.",
    hubLine: "The text layer, not an OCR guess.",
    keywords: ["pdf to text", "extract text from pdf", "pdf to txt", "copy text from pdf", "pdf text extractor"],
    h1: "Convert PDF to Text — Free Online Tool",
    subtitle: "Pull the text out of a PDF and copy it or download it as a plain .txt file.",
  },
  {
    name: "Extract Images from PDF",
    slug: "extract-images-from-pdf",
    category: "pdf-tools",
    toolType: "extract-images-from-pdf",
    acceptFormats: ".pdf",
    description: "Pull the images a PDF already embeds out as JPG or PNG files, at the resolution they are stored at. Not a page screenshot — several images arrive as a ZIP.",
    hubLine: "The stored images, not a page render.",
    keywords: ["extract images from pdf", "pdf image extractor", "save images from pdf", "get pictures out of a pdf", "pdf embedded images"],
    h1: "Extract Images from a PDF — Free & Private",
    subtitle: "Lift out the images the document already contains, at the resolution it stores them at — JPEGs are copied byte for byte rather than re-encoded.",
  },
  /*
    The four tools below run qpdf 12.4.1 (Apache-2.0) compiled to WebAssembly,
    and every non-obvious claim in their copy is a measurement, not a reading of
    the docs. The ones the copy is built on:

      - A user password with no owner password is REJECTED at --bits=256 (rc 2).
        Setting owner == user is accepted with rc 0 and no warning, which is why
        that is the default and why the copy says so out loud.
      - A password over 127 UTF-8 BYTES encrypts with rc 0 and an empty stderr,
        and then can never be entered again — not the original, not any
        truncation. The UI refuses it before qpdf is called; qpdf will not warn.
      - Re-encrypting an already-protected file fails rc 2 "invalid password",
        so protect-pdf pre-flights and points at unlock-pdf instead.
      - `--decrypt` with NO password strips a restrictions-only file's
        permission flags (rc 0). That is a fact about the format, not a bug
        here, and it is why pdf-permissions leads with "advisory".
      - Measured P values at --bits=256 (revision 6): none -4, --print=low
        -2052, --print=none -2056, --modify=annotate -12, --modify=form -44,
        --modify=assembly -300, --modify=none -1324, --extract=n -20, and
        --accessibility=n -4 — i.e. NO EFFECT. That last one is why there is no
        accessibility control: it would be a checkbox that changes nothing.
      - qpdf exit 3 is "completed with warnings" and is a SUCCESS: the output
        is written and valid. repair-pdf exists on files that exit 3, so the
        copy treats warnings as information rather than failure.
  */
  {
    name: "Protect PDF",
    slug: "protect-pdf",
    category: "pdf-tools",
    toolType: "protect-pdf",
    acceptFormats: ".pdf",
    description: "Add a password to a PDF with AES-256 encryption, entirely in your browser. The document and the password both stay on your machine — nothing is uploaded.",
    hubLine: "AES-256, and the password stays local.",
    keywords: ["password protect pdf", "add password to pdf", "encrypt pdf", "pdf password protection", "lock pdf with password"],
    h1: "Password Protect a PDF — Free Online Tool",
    subtitle: "Encrypt a PDF with a password you choose — AES-256 by default, and neither the file nor the password leaves your browser.",
  },
  {
    name: "Unlock PDF",
    slug: "unlock-pdf",
    category: "pdf-tools",
    toolType: "unlock-pdf",
    acceptFormats: ".pdf",
    description: "Remove a password you already know from a PDF, in your browser. You supply the password; nothing is uploaded. This is not a password recovery tool.",
    hubLine: "A password you know, taken back off.",
    keywords: ["remove pdf password", "unlock pdf", "remove password from pdf", "decrypt pdf", "pdf password remover"],
    h1: "Remove a PDF Password — Free Online Tool",
    subtitle: "Take the password off a PDF you can already open — this removes a password you know, it does not recover one you have forgotten.",
  },
  {
    name: "PDF Permissions",
    slug: "pdf-permissions",
    category: "pdf-tools",
    toolType: "pdf-permissions",
    acceptFormats: ".pdf",
    description: "Set what a PDF says readers may print, edit or copy. These flags are advisory: a reader can ignore them, and any tool with the owner password clears them.",
    hubLine: "A stated intention, not a lock.",
    keywords: ["pdf permissions", "restrict pdf printing", "pdf owner password", "disable pdf editing", "pdf security settings"],
    h1: "Set PDF Permissions — Print, Copy, Edit",
    subtitle: "Write printing, editing and copying restrictions into a PDF — a stated intention a reader may honour, not a lock.",
  },
  {
    name: "Repair PDF",
    slug: "repair-pdf",
    category: "pdf-tools",
    toolType: "repair-pdf",
    acceptFormats: ".pdf",
    description: "Rebuild a damaged PDF's cross-reference table by re-writing the file with qpdf. It repairs the index, not missing content — and says when nothing was wrong.",
    hubLine: "Rebuilds the index, not missing bytes.",
    keywords: ["repair pdf", "fix corrupted pdf", "pdf repair tool", "recover damaged pdf", "pdf won't open"],
    h1: "Repair a Damaged PDF — Free Online Tool",
    subtitle: "Rebuild a PDF whose cross-reference table is damaged — and find out plainly when there was nothing to fix.",
  },
  {
    name: "Markdown to PDF",
    slug: "markdown-to-pdf",
    category: "pdf-tools",
    toolType: "markdown-to-pdf",
    acceptFormats: ".md,.markdown,.txt,text/markdown",
    description: "Convert Markdown to a polished PDF in your browser. Serif typography, syntax-highlighted code, GFM tables and task lists. No upload required.",
    hubLine: "Serif or sans, with syntax-highlighted code.",
    keywords: [
      "markdown to pdf",
      "md to pdf",
      "convert markdown to pdf",
      "markdown pdf converter",
      "export markdown pdf",
    ],
    h1: "Convert Markdown to PDF — Free, Online, In-Browser",
    subtitle: "Type or upload Markdown, preview MD Peek-style typography, and export to PDF — all in your browser.",
  },

  // ── Audio Tools ──────────────────────────────────────────────────
  //
  // Every tool below reaches `decodeAudioFile` (audio-decode.ts:274), which
  // reads the whole file into an ArrayBuffer at :279 and hands it to
  // `decodeAudioData` (:253, :261). What comes back is a float32 AudioBuffer —
  // 44,100 × 2 × 4 bytes per second of 44.1 kHz stereo, about 21 MB a minute,
  // and roughly twice what the same audio occupies as 16-bit PCM on disk.
  // That is a ceiling, so none of these five may print "NO SIZE CAP"; none of
  // them enforces one either, so none may set `maxSizeMB`. `practicalLimitNote`
  // is the third thing, and each one below names the multiplier it pays.
  {
    name: "MP3 to WAV",
    slug: "mp3-to-wav",
    category: "audio-tools",
    toolType: "mp3-to-wav",
    description: "Convert MP3 to lossless uncompressed WAV using the Web Audio API. Perfect for audio editing, mastering, and DAW import workflows.",
    hubLine: "16-bit PCM at the file's own sample rate.",
    keywords: ["mp3 to wav", "convert mp3 to wav", "mp3 converter", "mp3 to wav online"],
    h1: "Convert MP3 to WAV Online — Free & Instant",
    subtitle: "Decode MP3 to uncompressed WAV for editing, mixing, or archival.",
    acceptFormats: ".mp3",
    // audio-encode-wav.ts:31-32 decodes the whole MP3 before a byte of WAV is
    // written, and audio-client's `encodeWav` builds the output beside it.
    practicalLimitNote:
      "Nothing is enforced, but the MP3 is decoded to 32-bit float in this tab — roughly 20 MB per minute of 44.1 kHz stereo — with the WAV written alongside at about 10 MB a minute, so multi-hour files can exhaust memory.",
  },
  {
    name: "WAV to MP3",
    slug: "wav-to-mp3",
    category: "audio-tools",
    toolType: "wav-to-mp3",
    description: "Convert WAV to MP3 at 128, 192, 256, or 320 kbps. Shrink audio files by up to 90% while keeping listening quality intact.",
    hubLine: "Four bitrates, from 128 up to 320 kbps.",
    keywords: ["wav to mp3", "convert wav to mp3", "wav converter", "wav to mp3 online", "compress wav"],
    h1: "Convert WAV to MP3 Online — Free & Adjustable Bitrate",
    subtitle: "Compress WAV files to MP3 with selectable bitrate — 128, 192, 256, or 320 kbps.",
    acceptFormats: ".wav",
    // The only tool here whose input is already uncompressed, so the float32
    // expansion is exactly 2x and worth naming as such. audio-encode-mp3.ts:65.
    practicalLimitNote:
      "Nothing is enforced, but the whole WAV is held in memory while it is decoded to 32-bit float — twice what 16-bit samples take on disk — so a multi-hour master needs several times its own size in RAM before the MP3 encode starts.",
  },
  {
    name: "M4A to MP3",
    slug: "m4a-to-mp3",
    category: "audio-tools",
    toolType: "m4a-to-mp3",
    description: "Convert M4A and AAC files to MP3 — including iPhone voice memos and iTunes purchases. Works with all M4A variants in your browser.",
    hubLine: "FFmpeg decodes what the browser will not.",
    keywords: ["m4a to mp3", "convert m4a to mp3", "aac to mp3", "iphone audio converter", "m4a converter"],
    h1: "Convert M4A to MP3 Online — Free & Instant",
    subtitle: "Turn iPhone voice memos and iTunes M4A files into universally compatible MP3.",
    acceptFormats: ".m4a,.aac",
    /*
      The sharpest of the five, and the one the hubLine above advertises.
      `decodeViaFFmpeg` (audio-decode.ts:217-241) is the only FFmpeg caller on
      the site that writes its input rather than mounting it (:227 — a full
      copy), and its output is `pcm_s16le` (:228): 176.4 kB/s against a
      128 kbps source's 16 kB/s, so ~11x, and that WAV has to survive MEMFS
      before it is decoded to float32 again. `validateFFmpegInput` is never
      called on this path.
    */
    practicalLimitNote:
      "Nothing is enforced, but the file is decoded to 32-bit float in this tab — and where the browser will not decode AAC, the FFmpeg fallback first expands it to a 16-bit WAV around ten times the size of a 128 kbps source, which has to fit in memory too.",
  },
  {
    name: "Audio Trimmer",
    slug: "audio-trimmer",
    category: "audio-tools",
    toolType: "audio-trimmer",
    description: "Trim audio clips by setting precise start and end times. Export as MP3 or WAV — great for ringtones, podcast edits, and sample prep.",
    hubLine: "The cut lands on the sample you asked for.",
    keywords: ["audio trimmer", "trim audio online", "cut audio", "audio cutter", "trim mp3", "cut mp3 online"],
    h1: "Trim Audio Online — Free Audio Cutter",
    subtitle: "Upload any audio file, set start and end times, and download the trimmed clip.",
    acceptFormats: ".mp3,.wav,.ogg,.m4a,.flac,.aac",
    // Two full decodes, not one: AudioTrimmerUI.tsx:158 draws the waveform
    // through media-preview.ts:95 on drop, then audio-trim.ts:30 decodes again
    // to make the cut. Sequential, not simultaneous — but each pays the price.
    practicalLimitNote:
      "Nothing is enforced, but the file is decoded to 32-bit float twice over — once on drop to draw the waveform, once to make the cut — at roughly 20 MB per minute of 44.1 kHz stereo each time.",
  },
  {
    name: "Merge Audio",
    slug: "merge-audio",
    category: "audio-tools",
    toolType: "merge-audio",
    description: "Merge multiple audio files into one continuous track. Reorder clips with the up and down arrows and export as MP3 or WAV at your chosen bitrate.",
    hubLine: "Mixed formats, matched to the highest rate.",
    keywords: ["merge audio", "combine audio files", "join audio", "audio merger", "concatenate audio online"],
    h1: "Merge Audio Files Online — Free Audio Joiner",
    subtitle: "Upload multiple audio files, arrange the order, and download a single merged file.",
    acceptFormats: ".mp3,.wav,.ogg,.m4a,.flac,.aac",
    // The worst shape on the site, and the only one where the user chooses N.
    // audio-merge.ts:24 decodes every input CONCURRENTLY (`Promise.all`), :30
    // resamples each (a second buffer unless the rate already matches, :86-88),
    // and :38-51 copies them all into one more.
    practicalLimitNote:
      "Nothing is enforced, but every file you add is decoded to 32-bit float at the same time — not one after another — then resampled, then copied again into one merged buffer, so the peak is several times the decoded size of the whole queue at roughly 20 MB per minute of 44.1 kHz stereo.",
  },

  // ── Audio effects ────────────────────────────────────────────────
  //
  // The site's first FFmpeg filtergraphs (`-af`), and its first two Web Audio
  // effects. Two of the five run inside FFmpeg and two never load it on their
  // MP3/WAV arms; the fifth records and has no engine at all.
  //
  // All four file-taking pages carry a `practicalLimitNote` rather than a
  // `maxSizeMB`: `audio-effects.ts` deliberately does NOT call
  // `validateFFmpegInput` (that function caps only the stream-copy shape and
  // its message is written about video trimming), so there is no enforced
  // number to print. What binds is memory — the waveform decode on every one
  // of them, plus a whole output file held in the engine or a whole set of
  // float channels held in the tab.
  {
    name: "Normalize Audio",
    slug: "normalize-audio",
    category: "audio-tools",
    toolType: "normalize-audio",
    description: "Bring a recording to a broadcast loudness target with FFmpeg's loudnorm filter. The whole file is measured first, and the page says how it was corrected.",
    hubLine: "Measured first, correction reported.",
    keywords: ["normalize audio", "audio normalizer", "lufs normalization", "loudness normalization", "normalize mp3 volume"],
    h1: "Normalize Audio Online — Free LUFS Loudness Tool",
    subtitle: "Pick a podcast, streaming or broadcast target and let the file be measured before anything is changed.",
    acceptFormats: ".mp3,.wav,.ogg,.m4a,.flac,.aac,.opus,.wma",
    // The waveform on drop is one full decode (`computeWaveform`), and the
    // normalise itself holds a whole output file in the engine's MEMFS before
    // it is read back out. Neither is checked against `file.size` anywhere.
    practicalLimitNote:
      "Nothing is enforced, but the waveform is decoded to 32-bit float in this tab at roughly 20 MB per minute of 44.1 kHz stereo, and the normalised file is built whole in the engine's memory before it is handed back.",
  },
  {
    name: "Change Audio Volume",
    slug: "change-audio-volume",
    category: "audio-tools",
    toolType: "change-audio-volume",
    description: "Turn an audio file up or down by an exact number of decibels. Every sample is multiplied by one gain, with no limiter, and clipping is reported.",
    hubLine: "One multiply per sample, clipping named.",
    keywords: ["change audio volume", "increase audio volume", "make audio louder", "audio gain online", "lower mp3 volume"],
    h1: "Change Audio Volume Online — Free Gain Tool",
    subtitle: "Set a gain in decibels; the peak is measured on the decoded file and clipping is reported rather than hidden.",
    acceptFormats: ".mp3,.wav,.ogg,.m4a,.flac,.aac,.opus,.wma",
    // Two decodes, sequentially: the waveform on drop, then the file itself in
    // `changeAudioVolume`, which also `.slice()`s every channel before scaling.
    practicalLimitNote:
      "Nothing is enforced, but the file is decoded to 32-bit float in this tab — once to draw the waveform and once to scale it, at roughly 20 MB per minute of 44.1 kHz stereo — and the scaled copy is held alongside the original.",
  },
  {
    name: "Reverse Audio",
    slug: "reverse-audio",
    category: "audio-tools",
    toolType: "reverse-audio",
    description: "Play an audio file backwards. Every sample is walked back to front in your browser and the length never changes; export WAV or FLAC to keep the rate as well.",
    hubLine: "Same samples, opposite order.",
    keywords: ["reverse audio", "play audio backwards", "reverse mp3", "backwards audio online", "audio reverser"],
    h1: "Reverse Audio Online — Free Backwards Audio Tool",
    subtitle: "Turn a clip back to front sample by sample, then export it as MP3, WAV or FLAC.",
    acceptFormats: ".mp3,.wav,.ogg,.m4a,.flac,.aac,.opus,.wma",
    // The waveform on drop and the reverse itself are two separate decodes,
    // and the reversed copy is a second set of float channels beside the first.
    practicalLimitNote:
      "Nothing is enforced, but the file is decoded to 32-bit float in this tab — once for the waveform and once to reverse it, at roughly 20 MB per minute of 44.1 kHz stereo — with the reversed copy held beside the original.",
  },
  {
    name: "Remove Silence",
    slug: "remove-silence",
    category: "audio-tools",
    toolType: "remove-silence",
    description: "Trim the quiet at the start and end of a recording, or close every gap in it. FFmpeg's silenceremove filter cuts, and the seconds removed are shown.",
    hubLine: "The quiet parts, measured and cut.",
    keywords: ["remove silence from audio", "trim silence", "cut silence mp3", "silence remover online", "remove dead air"],
    h1: "Remove Silence from Audio Online — Free Trimmer",
    subtitle: "Cut the dead air at the ends of a recording, or every pause inside it, and see how many seconds went.",
    acceptFormats: ".mp3,.wav,.ogg,.m4a,.flac,.aac,.opus,.wma",
    // The waveform on drop is a full in-tab decode; the cut itself holds one
    // whole output file in the engine's MEMFS before it is read back.
    practicalLimitNote:
      "Nothing is enforced, but the waveform is decoded to 32-bit float in this tab at roughly 20 MB per minute of 44.1 kHz stereo, and the trimmed file is built whole in the engine's memory before it is handed back.",
  },
  {
    name: "Audio Recorder",
    slug: "audio-recorder",
    category: "audio-tools",
    toolType: "audio-recorder",
    description: "Record from your microphone in the browser and save the clip. Your browser's own recorder writes the file — WebM with Opus in most, and never an MP3.",
    hubLine: "Whatever your browser's recorder writes.",
    keywords: ["audio recorder", "voice recorder online", "record audio in browser", "microphone recorder", "online sound recorder"],
    h1: "Audio Recorder — Free Online Voice Recorder",
    subtitle: "Record from a microphone with a live level meter, pause and resume, then download the clip.",
    acceptFormats: "",
    takesNoFile: true,
  },

  // ── Audio format converters ──────────────────────────────────────
  //
  // Eight slugs, one `audio-convert` toolType, one component. Every one of
  // them DECODES AND RE-ENCODES — there is no stream copy anywhere in this
  // block — so the copy has to keep three cases apart rather than blur them
  // into "convert":
  //   lossless → lossy   flac-to-mp3 (a real trade, stated as one)
  //   lossy    → lossy   ogg/aac/opus/wma → mp3 (a SECOND generation of loss,
  //                      on audio that has already lost information)
  //   lossless → lossless wav-to-flac (the only one that may say "no loss")
  //
  // The whole block reaches `decodeAudioFile` (audio-decode.ts:274) and,
  // through `AudioConverterUI`'s waveform, `computeWaveform`
  // (media-preview.ts:87) — two separate full decodes to float32, sequential
  // rather than simultaneous. `computeWaveform` has no FFmpeg tier by design
  // (media-preview.ts:80-85), so on the formats only FFmpeg can open the
  // preview fails and the stage says so while the conversion still runs.
  // None of the eight enforces a limit, so none may set `maxSizeMB`; each
  // one's `practicalLimitNote` names the multiplier IT pays.
  //
  // NO NEW REGISTRY FIELD carries the output format. `AudioConverterUI` holds
  // it in `useState` seeded by `AudioToolClients.audioTarget`, which reads
  // `targetFormat` through a widening assignment and falls back to the slug's
  // own `-to-<ext>` tail — the same rule `VideoToolClients.remuxTarget` uses.
  // Every slug in this block resolves correctly from its tail, and the hub
  // (`mp3-converter`, no tail) lands on MP3, so widening the image-only
  // `targetFormat` union at :88 — and forcing a narrowing cast into
  // `ImageToolClients.tsx:34` and `PdfToolClients.tsx:30` — would buy nothing.
  // The format is a SEED, not a lock: the FORMAT chips offer MP3/WAV/FLAC on
  // all eight pages, so each entry's copy describes its default, not its only
  // output.
  {
    name: "FLAC to MP3",
    slug: "flac-to-mp3",
    category: "audio-tools",
    toolType: "audio-convert",
    description: "Convert FLAC to MP3 at 128 to 320 kbps. Lossless archives become files a phone or car stereo will actually play, decoded and re-encoded in your browser.",
    hubLine: "The lossless archive, made portable.",
    keywords: ["flac to mp3", "convert flac to mp3", "flac converter", "flac to mp3 online", "lossless to mp3"],
    h1: "Convert FLAC to MP3 Online — Free & Private",
    subtitle: "Turn lossless FLAC files into MP3s that play on any phone, car stereo or media player.",
    acceptFormats: ".flac",
    // FLAC on disk is roughly half a WAV, so float32 is about 4x the file you
    // dropped — and it happens twice, once for the waveform and once to
    // convert.
    practicalLimitNote:
      "Nothing is enforced, but the FLAC is decoded to 32-bit float in this tab — roughly four times its own size, and once to draw the waveform before the conversion decodes it again — so a full album-length file can exhaust memory.",
  },
  {
    name: "OGG to MP3",
    slug: "ogg-to-mp3",
    category: "audio-tools",
    toolType: "audio-convert",
    description: "Convert Ogg Vorbis audio to MP3 for players that will not open OGG. Both formats are lossy, so pick 256 or 320 kbps to keep the second encode clean.",
    hubLine: "Lossy in, lossy out — so pick a high bitrate.",
    keywords: ["ogg to mp3", "convert ogg to mp3", "ogg vorbis to mp3", "ogg converter", "oga to mp3"],
    h1: "Convert OGG to MP3 Online — Free & Instant",
    subtitle: "Turn Ogg Vorbis files into MP3s that every player and phone will open.",
    acceptFormats: ".ogg,.oga",
    practicalLimitNote:
      "Nothing is enforced, but the OGG is decoded to 32-bit float in this tab — more than twenty times what a 128 kbps file takes on disk — and again on drop to draw the waveform, so long recordings can exhaust memory.",
  },
  {
    name: "AAC to MP3",
    slug: "aac-to-mp3",
    category: "audio-tools",
    toolType: "audio-convert",
    description: "Convert raw AAC and M4A audio to MP3 at up to 320 kbps. Both are lossy formats, so the file is fully decoded and re-encoded in your browser.",
    hubLine: "Raw ADTS streams as well as M4A.",
    keywords: ["aac to mp3", "convert aac to mp3", "aac converter", "adts to mp3", "aac to mp3 online"],
    h1: "Convert AAC to MP3 Online — Free & Instant",
    subtitle: "Turn AAC and M4A audio into MP3 files that play on anything.",
    acceptFormats: ".aac,.m4a",
    // Same shape as m4a-to-mp3: where the browser will not decode AAC, the
    // FFmpeg tier writes a pcm_s16le WAV first (audio-decode.ts:228) and that
    // intermediate has to fit in memory too.
    practicalLimitNote:
      "Nothing is enforced, but the file is decoded to 32-bit float in this tab, and where the browser will not decode AAC the FFmpeg fallback first expands it to a 16-bit WAV around ten times the size of a 128 kbps source.",
  },
  {
    name: "Opus to MP3",
    slug: "opus-to-mp3",
    category: "audio-tools",
    toolType: "audio-convert",
    description: "Convert Opus audio and WhatsApp voice notes to MP3 that any player opens. Opus is lossy, so the re-encode is a second generation — 128 kbps suits speech.",
    hubLine: "The WhatsApp voice-note format.",
    keywords: ["opus to mp3", "convert opus to mp3", "whatsapp voice note to mp3", "opus converter", "voice message to mp3"],
    h1: "Convert Opus to MP3 Online — WhatsApp Voice Notes Included",
    subtitle: "Turn .opus voice messages and audio files into MP3s that play anywhere.",
    acceptFormats: ".opus,.ogg",
    practicalLimitNote:
      "Nothing is enforced, but the file is decoded to 32-bit float in this tab — a voice note at 24 kbps expands more than fiftyfold, which is nothing at voice-note length and real over an hour of recording.",
  },
  {
    name: "M4A to WAV",
    slug: "m4a-to-wav",
    category: "audio-tools",
    toolType: "audio-convert",
    description: "Convert M4A and AAC audio to uncompressed 16-bit WAV for editing, mastering, and DAW import. The file grows about tenfold; nothing is uploaded.",
    hubLine: "Voice memos into an editor's format.",
    keywords: ["m4a to wav", "convert m4a to wav", "aac to wav", "voice memo to wav", "m4a to wav online"],
    h1: "Convert M4A to WAV Online — Free & Instant",
    subtitle: "Decode M4A and AAC audio to uncompressed WAV for editing, mixing or archival.",
    acceptFormats: ".m4a,.aac",
    // Two costs stacked: the FFmpeg tier's pcm_s16le intermediate where the
    // browser will not decode AAC, and the WAV being written alongside the
    // decoded float32 buffer.
    practicalLimitNote:
      "Nothing is enforced, but the file is decoded to 32-bit float in this tab with the WAV written alongside it at about 10 MB a minute, so a long recording needs many times its own size in memory.",
  },
  {
    name: "WAV to FLAC",
    slug: "wav-to-flac",
    category: "audio-tools",
    toolType: "audio-convert",
    description: "Convert WAV to FLAC and keep every sample — FLAC is lossless, typically 40 to 60 percent smaller, and decodes back to the identical waveform.",
    hubLine: "Half the size, every sample intact.",
    keywords: ["wav to flac", "convert wav to flac", "flac encoder", "lossless compression audio", "wav to flac online"],
    h1: "Convert WAV to FLAC Online — Free & Lossless",
    subtitle: "Compress WAV files to FLAC without discarding a single sample.",
    acceptFormats: ".wav",
    // The only slug in this block whose ENCODE is FFmpeg's rather than the
    // audio worker's, and the FFmpeg arm is file→file (audio-convert.ts) — so
    // on the FLAC path the float32 decode is the WAVEFORM's, not the
    // conversion's. Switch the FORMAT chips to MP3 or WAV and the conversion
    // decodes as well, which is why the sentence names the tab rather than a
    // particular arm.
    practicalLimitNote:
      "Nothing is enforced, but the WAV is decoded to 32-bit float in this tab to draw the waveform — twice what 16-bit samples take on disk — and the FLAC is built in the engine's own memory before it reaches you, so a multi-hour master can exhaust the tab.",
  },
  {
    name: "MP3 Converter",
    slug: "mp3-converter",
    category: "audio-tools",
    toolType: "audio-convert",
    description: "Convert WAV, M4A, AAC, FLAC, OGG, Opus or WMA audio to MP3 at 128 to 320 kbps. Everything is decoded and re-encoded in your browser — no uploads.",
    hubLine: "Whatever you have in, MP3 out.",
    keywords: ["mp3 converter", "convert to mp3", "audio to mp3", "online mp3 converter", "free mp3 converter"],
    h1: "MP3 Converter — Convert Audio Files to MP3 Online",
    subtitle: "Drop in a WAV, M4A, AAC, FLAC, OGG, Opus or WMA file and get an MP3 at the bitrate you choose.",
    // .wma is here for the same reason /wma-to-mp3 exists: the shipped core
    // decodes it (see that entry). If the WMA route is ever dropped, this
    // extension and the WMA chip in categories.ts come out with it.
    acceptFormats: ".mp3,.wav,.m4a,.aac,.flac,.ogg,.opus,.wma",
    practicalLimitNote:
      "Nothing is enforced, but whatever you drop is decoded to 32-bit float in this tab — roughly 20 MB per minute of 44.1 kHz stereo, and more than twenty times the size of a compressed source — before the MP3 encode starts.",
  },
  {
    name: "WMA to MP3",
    slug: "wma-to-mp3",
    category: "audio-tools",
    toolType: "audio-convert",
    description: "Convert Windows Media Audio to MP3. No browser decodes WMA, so an FFmpeg engine served from this site does it — a one-time 31 MB download.",
    hubLine: "The one format no browser can open.",
    keywords: ["wma to mp3", "convert wma to mp3", "wma converter", "windows media audio to mp3", "wma to mp3 online"],
    h1: "Convert WMA to MP3 Online — Free & Private",
    subtitle: "Turn old Windows Media Audio files into MP3s that play on anything.",
    acceptFormats: ".wma",
    /*
      MEASURED against the shipped public/ffmpeg-core.wasm (FFmpeg n5.1.4):
      wmav1/wmav2/wmapro/wmalossless decoders and the ASF demuxer are all
      present, and `-i in.wma -acodec pcm_s16le -f wav out.wav` — the exact
      argv `decodeViaFFmpeg` runs at audio-decode.ts:228 — returned 0 in 4 ms
      with real signal in the output (peak 26230/32767 over 262,111 non-zero
      samples). This is the only slug in the block with NO browser decode path
      at all, so the FFmpeg tier is not a fallback here, it is the engine.
    */
    practicalLimitNote:
      "Nothing is enforced, but every WMA goes through FFmpeg, which expands it to a 16-bit WAV around ten times the size of a 128 kbps source before that is decoded to 32-bit float in this tab — so both have to fit in memory.",
  },

  // ── Video Tools ──────────────────────────────────────────────────
  {
    name: "Video to GIF",
    slug: "video-to-gif",
    category: "video-tools",
    toolType: "video-to-gif",
    description: "Convert video clips to animated GIFs with custom start/end time, frame rate, and width. Runs entirely in your browser — no upload, no sign-up.",
    hubLine: "A fresh 256-colour palette every frame.",
    keywords: ["video to gif", "mp4 to gif", "convert video to gif", "gif maker", "gif converter online"],
    h1: "Convert Video to GIF Online — Free GIF Maker",
    subtitle: "Upload a video, select a clip range, and download an animated GIF — all in your browser.",
    acceptFormats: ".mp4,.webm,.mov",
  },
  {
    name: "Video Trimmer",
    slug: "video-trimmer",
    category: "video-tools",
    toolType: "video-trimmer",
    description: "Trim video clips by setting start and end times. Lossless stream copy preserves the original codec — exports in the same format as input.",
    hubLine: "Cut on a keyframe, without touching quality.",
    keywords: ["video trimmer", "trim video online", "cut video", "video cutter", "trim mp4 online"],
    h1: "Trim Video Online — Free Video Cutter",
    subtitle: "Upload a video, set start and end times, and download the trimmed clip instantly.",
    acceptFormats: ".mp4,.webm,.mov,.avi,.mkv",
    // Derived, not chosen: a stream copy has to hold the trimmed clip in the
    // tab, and a browser tops out near 1.8 GB in one file. See the derivation
    // block at the top of src/lib/tools/ffmpeg-loader.ts.
    maxSizeMB: 1536,
  },
  {
    name: "MP4 to MP3",
    slug: "mp4-to-mp3",
    category: "video-tools",
    toolType: "mp4-to-mp3",
    description: "Extract audio from MP4 videos as MP3 with adjustable bitrate. Perfect for ripping podcast tracks, lecture recordings, and music videos.",
    hubLine: "The audio track only, at 128 to 320 kbps.",
    keywords: ["mp4 to mp3", "extract audio from video", "video to audio", "mp4 audio extractor", "convert mp4 to mp3"],
    h1: "Extract Audio from MP4 — Convert to MP3 Online",
    // "any video file" was an overclaim even before Wave 3 — the picker takes
    // five containers, not all of them. The list here is the same one the
    // DropZone and the ACCEPTS row already show.
    subtitle: "Pull the audio track out of an MP4, WebM, MOV, AVI or MKV and download it as an MP3.",
    acceptFormats: ".mp4,.webm,.mov,.avi,.mkv",
    // No cap: the source is mounted into FFmpeg rather than copied into
    // memory, so only the (much smaller) MP3 has to be held. Verified at
    // 2500 MB — see src/lib/tools/ffmpeg-loader.ts.
  },
  {
    name: "WebM to MP4",
    slug: "webm-to-mp4",
    category: "video-tools",
    toolType: "webm-to-mp4",
    description: "Convert WebM screen recordings to universally compatible MP4 (H.264). Plays everywhere — iOS, social media, presentation software.",
    hubLine: "A true re-encode to H.264, not a rewrap.",
    keywords: ["webm to mp4", "convert webm to mp4", "webm converter", "screen recording to mp4"],
    h1: "Convert WebM to MP4 Online — Free & Instant",
    subtitle: "Turn WebM screen recordings into universally compatible MP4 files.",
    acceptFormats: ".webm",
    /*
      Unlike the FFmpeg tools this one never mounts anything: webm-to-mp4.ts:44
      calls `decodeAudio(file)`, which is `video-utils.ts:109` — one
      `await file.arrayBuffer()` for the entire recording — and the MP4 lands
      in an `ArrayBufferTarget` (:86). The provable wall is V8's single-buffer
      limit, measured in this repo at 2040 MiB ok / 2047 MiB RangeError
      (ffmpeg-loader.ts:33-37); the practical one is far lower, and the
      /compress-video FAQ has said ~100 MB since before this field existed.
    */
    practicalLimitNote:
      "Nothing is enforced, but the whole recording is read into one buffer to decode its audio to 32-bit float, and the MP4 is built up in another beside it — so files much past ~100 MB risk exhausting the tab.",
  },
  {
    name: "Compress Video",
    slug: "compress-video",
    category: "video-tools",
    toolType: "compress-video",
    description: "Compress video files with one-click presets for WhatsApp, email, and web. Powered by WebCodecs and mp4-muxer for fast in-browser encoding.",
    hubLine: "720p for WhatsApp, 480p for email.",
    keywords: ["compress video", "reduce video size", "video compressor", "compress mp4", "video for whatsapp"],
    h1: "Compress Video Online — Free Video Compressor",
    subtitle: "Shrink video files with presets optimized for WhatsApp, Email, or Web sharing.",
    acceptFormats: ".mp4,.webm,.mov",
    // Same three allocations as webm-to-mp4: video-compress.ts:72 →
    // video-utils.ts:109 (`await file.arrayBuffer()`), then the decoded
    // float32 AudioBuffer, then the `ArrayBufferTarget` at :112. The ~100 MB
    // is this page's own FAQ answer (faqs.ts, "Is there a file size limit?"),
    // which was the only honest thing on the page about size before this.
    practicalLimitNote:
      "Nothing is enforced, but the whole file is read into one buffer to decode its audio to 32-bit float, and the compressed MP4 is built up in another beside it — so clips much past ~100 MB risk exhausting the tab.",
  },
  {
    name: "Compress Video to Size",
    slug: "compress-video-to-size",
    category: "video-tools",
    toolType: "compress-video-to-size",
    description: "Target 25 MB for email, 16 MB for WhatsApp or 10 MB for Discord. A bitrate is solved from the clip's duration and the size actually reached is shown.",
    hubLine: "Pick the number; the bitrate follows.",
    keywords: ["compress video to 25mb", "compress video to size", "video under 10mb for discord", "compress video for whatsapp", "target size video compressor"],
    h1: "Compress a Video to a Target Size — 25, 16 or 10 MB",
    subtitle: "Give the compressor a size to aim at. It solves for a bitrate from your clip's length, then reports the size it actually produced.",
    acceptFormats: ".mp4,.webm,.mov",
    // 25 MB in KB — the email ceiling, the widest of the three presets. A SEED
    // for the MB field (`CompressVideoUI` divides it back by 1024), not a lock:
    // the field stays editable, exactly as the image compressor's KB seeds do.
    defaultTargetSizeKb: 25600,
    // Same three allocations as compress-video, which this page shares an
    // encoder with: the input is read into one ArrayBuffer so its audio can be
    // decoded to 32-bit float, and the muxer's `ArrayBufferTarget` grows
    // beside both.
    practicalLimitNote:
      "Nothing is enforced, but the whole clip is read into one buffer so its audio can be decoded to 32-bit float, and the new MP4 is assembled in another beside it — so much past ~100 MB risks exhausting the tab.",
  },
  {
    name: "Screen Recorder",
    slug: "screen-recorder",
    category: "video-tools",
    toolType: "screen-recorder",
    description: "Record your screen, window, or browser tab — with optional microphone audio. No extension required. Save as WebM, ready to share or edit.",
    hubLine: "Screen, window or tab, with optional mic.",
    keywords: ["screen recorder", "record screen online", "screen capture", "browser screen recorder", "screen recording tool"],
    h1: "Screen Recorder — Free Browser-Based Screen Capture",
    subtitle: "Record your screen, a window, or a tab — no extensions or downloads needed.",
    acceptFormats: "",
    takesNoFile: true,
  },

  // ── Container tools (remux-first) ────────────────────────────────
  //
  // All eight below are FFmpeg stream copies on their default path, so they
  // call `validateFFmpegInput(file, "stream-copy")` and every one declares
  // the cap that function actually enforces (STREAM_COPY_MAX_INPUT_BYTES =
  // 1536 MB). Leaving `maxSizeMB` off would print "NO SIZE CAP" on a page
  // that does have one.
  //
  // Timings quoted in the copy below are measured against the shipped
  // public/ffmpeg-core.wasm (FFmpeg n5.1.4, @ffmpeg/core 0.12.10):
  //   -c copy → .mov  12 ms (speed=774x) · -c copy → .mkv  4 ms (1.72e+03x)
  //   -an -c copy     7 ms  · -metadata:s:v:0 rotate=90  6 ms
  //   the same rotation as a -vf transpose=1 re-encode  7,579 ms
  // Nothing here claims H.265/VP9/AV1 *output*: in this build libx265
  // deadlocks, libvpx-vp9 traps, and libaom is absent. The HEVC branch
  // transcodes to H.264 (libx264) and says so.
  {
    name: "Video to MP4",
    slug: "video-to-mp4",
    category: "video-tools",
    toolType: "video-remux",
    description: "Convert MOV, MKV, AVI and M4V files to MP4 in your browser. Compatible video is rewrapped in milliseconds with no re-encode and no quality loss.",
    hubLine: "One container out, whatever went in.",
    keywords: ["video to mp4", "convert video to mp4", "video converter", "mp4 converter online", "change video format"],
    h1: "Convert Video to MP4 Online — Free, No Upload Required",
    subtitle: "Rewrap MOV, MKV, AVI or M4V as MP4 — usually without re-encoding a single frame.",
    acceptFormats: ".mov,.mkv,.avi,.m4v",
    maxSizeMB: 1536,
  },
  {
    name: "MOV to MP4",
    slug: "mov-to-mp4",
    category: "video-tools",
    toolType: "video-remux",
    description: "Turn QuickTime MOV files into MP4. H.264 clips are rewrapped losslessly; H.265 iPhone recordings can be converted to H.264 instead.",
    hubLine: "The iPhone case, probed before it runs.",
    keywords: ["mov to mp4", "convert mov to mp4", "quicktime to mp4", "iphone video to mp4", "mov converter"],
    h1: "Convert MOV to MP4 Online — Free & Instant",
    subtitle: "Turn QuickTime MOV recordings into MP4 files that play everywhere.",
    acceptFormats: ".mov",
    maxSizeMB: 1536,
  },
  {
    name: "MP4 to MOV",
    slug: "mp4-to-mov",
    category: "video-tools",
    toolType: "video-remux",
    description: "Convert MP4 files to QuickTime MOV for Final Cut, iMovie and QuickTime Player. The video stream is copied across untouched — no re-encode.",
    hubLine: "Back into QuickTime's own wrapper.",
    keywords: ["mp4 to mov", "convert mp4 to mov", "mp4 to quicktime", "mov converter", "mp4 to mov online"],
    h1: "Convert MP4 to MOV Online — Free QuickTime Converter",
    subtitle: "Rewrap an MP4 as a QuickTime MOV without re-encoding the video.",
    acceptFormats: ".mp4,.m4v",
    maxSizeMB: 1536,
  },
  {
    name: "MKV to MP4",
    slug: "mkv-to-mp4",
    category: "video-tools",
    toolType: "video-remux",
    description: "Convert Matroska MKV files to MP4 so they play on phones, TVs and editors. H.264 video is copied straight across — no re-encode, no quality loss.",
    hubLine: "Matroska out, something a phone opens in.",
    keywords: ["mkv to mp4", "convert mkv to mp4", "matroska to mp4", "mkv converter", "mkv to mp4 online"],
    h1: "Convert MKV to MP4 Online — Free & Lossless",
    subtitle: "Rewrap Matroska MKV files as MP4 without re-encoding the video.",
    acceptFormats: ".mkv",
    maxSizeMB: 1536,
  },
  {
    name: "MP4 to MKV",
    slug: "mp4-to-mkv",
    category: "video-tools",
    toolType: "video-remux",
    description: "Convert MP4 files to Matroska MKV. MKV holds almost any codec, so the video and audio streams are copied across untouched in a few milliseconds.",
    hubLine: "The container that takes anything.",
    keywords: ["mp4 to mkv", "convert mp4 to mkv", "mp4 to matroska", "mkv converter", "mp4 to mkv online"],
    h1: "Convert MP4 to MKV Online — Free & Lossless",
    subtitle: "Rewrap an MP4 as Matroska MKV without touching the video data.",
    acceptFormats: ".mp4,.m4v",
    maxSizeMB: 1536,
  },
  {
    name: "AVI to MP4",
    slug: "avi-to-mp4",
    category: "video-tools",
    toolType: "video-remux",
    description: "Convert old AVI files to MP4 for modern players and phones. Where the codec fits MP4 the stream is copied over; otherwise convert to H.264 instead.",
    hubLine: "Old camcorder files, made portable.",
    keywords: ["avi to mp4", "convert avi to mp4", "avi converter", "avi to mp4 online", "old video to mp4"],
    h1: "Convert AVI to MP4 Online — Free & Instant",
    subtitle: "Bring AVI files from old cameras and camcorders into MP4.",
    acceptFormats: ".avi",
    maxSizeMB: 1536,
  },
  {
    name: "Mute Video",
    slug: "mute-video",
    category: "video-tools",
    toolType: "mute-video",
    description: "Remove the audio track from a video and keep the picture bit for bit. The video stream is copied, never re-encoded, so quality is untouched.",
    hubLine: "Drops the audio, copies the picture.",
    keywords: ["mute video", "remove audio from video", "silence video", "strip audio track", "video without sound"],
    h1: "Remove Audio from Video Online — Free Video Muter",
    subtitle: "Strip the audio track out of a video without re-encoding the picture.",
    acceptFormats: ".mp4,.mov,.mkv,.m4v",
    maxSizeMB: 1536,
  },
  {
    name: "Rotate Video",
    slug: "rotate-video",
    category: "video-tools",
    toolType: "rotate-video",
    description: "Rotate a video 90, 180 or 270 degrees by rewriting the container's rotation flag. Milliseconds, no re-encode — but some players ignore the flag.",
    hubLine: "A flag rewrite, not a re-encode.",
    keywords: ["rotate video", "rotate video online", "turn video sideways", "fix sideways video", "rotate mp4"],
    h1: "Rotate Video Online — Free, No Re-Encode",
    subtitle: "Turn a sideways clip upright by rewriting its rotation flag — no re-encoding.",
    acceptFormats: ".mp4,.mov,.m4v",
    maxSizeMB: 1536,
  },

  // ── Audio extraction (video in, audio out) ───────────────────────
  //
  // These three file under /video-tools for the same reason `mp4-to-mp3`
  // always has: the input is a video container and the job is demuxing one.
  //
  // `ExtractAudioUI` opens on the arm the slug names — "Keep original" for the
  // hub, WAV for the two `-to-wav` pages — and the copy arm is the ONLY
  // lossless conversion in this whole cluster: `-c:a copy` lifts the encoded
  // track out of the container without decoding a sample (measured at 29 ms).
  // MP3 and WAV are re-encodes and every sentence below says so.
  //
  // NEITHER `maxSizeMB` NOR `practicalLimitNote`, exactly like `mp4-to-mp3`:
  // the source is MOUNTED rather than copied (`ffmpegInputLimitBytes`
  // ("audio-extract") → null, verified end to end at 2500 MB), so the input
  // really is uncapped and both size surfaces may say so. The ceiling that is
  // real here sits on the way OUT — an uncompressed WAV is built in the tab in
  // one piece at ~10 MB a minute — and it is disclosed where it belongs: the
  // WAV arm's own QUALITY_NOTE in `ExtractAudioUI`, and the size FAQ on each
  // of these pages. Both size fields render beside the FILE PICKER and are
  // claims about the file you hand over; putting an output ceiling there would
  // have printed "MEMORY-BOUND" in the page's spec row while the drop zone
  // under it still read "NO SIZE CAP".
  {
    name: "Extract Audio",
    slug: "extract-audio",
    category: "video-tools",
    toolType: "extract-audio",
    description: "Extract the audio track from an MP4, WebM, MOV, AVI or MKV video. The default lifts the track out without re-encoding it; MP3 and WAV are one click away.",
    hubLine: "Lift the track out, or re-encode it.",
    keywords: ["extract audio from video", "video to audio", "rip audio from video", "get audio from mp4", "extract soundtrack"],
    h1: "Extract Audio from Video — Free, No Upload Required",
    subtitle: "Pull the audio track out of MP4, WebM, MOV, AVI or MKV — losslessly, or as MP3 or WAV.",
    acceptFormats: ".mp4,.webm,.mov,.avi,.mkv",
  },
  {
    name: "Video to WAV",
    slug: "video-to-wav",
    category: "video-tools",
    toolType: "extract-audio",
    description: "Pull the audio out of a video and save it as uncompressed 16-bit WAV for editing and transcription. Works with MP4, WebM, MOV, AVI and MKV files.",
    hubLine: "Uncompressed audio, straight from video.",
    keywords: ["video to wav", "convert video to wav", "extract wav from video", "video audio to wav", "mkv to wav"],
    h1: "Convert Video to WAV Online — Free Audio Extractor",
    subtitle: "Extract a video's audio track as an uncompressed WAV file, ready for an editor.",
    acceptFormats: ".mp4,.webm,.mov,.avi,.mkv",
  },
  {
    name: "MP4 to WAV",
    slug: "mp4-to-wav",
    category: "video-tools",
    toolType: "extract-audio",
    description: "Extract the audio track from an MP4 as an uncompressed WAV file, ready for a DAW or a transcription tool. Runs entirely in your browser, no upload.",
    hubLine: "MP4 in, editor-ready PCM out.",
    keywords: ["mp4 to wav", "convert mp4 to wav", "mp4 audio to wav", "extract wav from mp4", "mp4 to wav online"],
    h1: "Convert MP4 to WAV Online — Free & Instant",
    subtitle: "Turn an MP4's audio track into an uncompressed WAV file for editing or transcription.",
    acceptFormats: ".mp4,.m4v,.mov",
  },

  // ── Frames, cuts and joins ───────────────────────────────────────
  //
  // Two shapes in one block, and they carry opposite size fields on purpose.
  //
  // `video-to-images` and `video-thumbnail` touch FFmpeg nowhere: they play or
  // seek the clip through the browser's own decoder and draw the presented
  // frames onto a canvas, the same walk `video-to-gif.ts` uses. Nothing
  // enforces a size there, so both declare the memory ceiling instead.
  //
  // `split-video` and `merge-video` are FFmpeg stream copies and both call
  // `validateFFmpegInput(file, "stream-copy")`, so both print the cap that
  // function really enforces (STREAM_COPY_MAX_INPUT_BYTES = 1536 MB).
  //
  // Measured against the shipped public/ffmpeg-core.wasm (FFmpeg n5.1.4):
  //   -ss 0 -t 1 -c copy on a 2.090 s clip   → a 1.022 s part (keyframe drift)
  //   -ss 0.5 -t 1 -c copy on the same clip  → 1.510 s (the seek snapped to 0)
  //   -f concat -c copy, two matching clips  → 4.180 s, 12 ms
  //   -f concat -c copy, .mp4 + .mkv holding IDENTICAL h264/aac streams
  //                                          → EXIT 0 and a 2.090 s file.
  // That last row is why `merge-video` refuses instead of trusting the exit
  // code, and why its copy never implies it can join anything.
  {
    name: "Video to Images",
    slug: "video-to-images",
    category: "video-tools",
    toolType: "video-to-images",
    description: "Save frames from a video as PNG, JPEG or WebP in one ZIP. Sample every few seconds or ask for a fixed count, up to 300 frames in a single run.",
    hubLine: "Frames out, at the times you asked.",
    keywords: ["video to images", "extract frames from video", "video frame extractor", "video to png", "mp4 to jpg frames"],
    h1: "Convert Video to Images Online — Free Frame Extractor",
    subtitle: "Pull frames out of a clip at a set interval or a fixed count and download them all as one ZIP.",
    // The engine is the browser's own <video> element (video-frames.ts calls
    // `playAndExtractFrames`, no FFmpeg), so this list can only be as wide as
    // the tab's demuxers. MEASURED in headless Chromium, Firefox and WebKit
    // against `src/__tests__/fixtures/samples/sample-video.avi`: `canPlayType`
    // is empty for video/x-msvideo and the element fires `error` with
    // DEMUXER_ERROR_COULD_NOT_OPEN, so no AVI ever reaches a frame. MKV plays
    // in Chromium and Firefox but not WebKit, and rides out with AVI so that
    // the three tools sharing this walk share one accept list. Matches
    // `video-to-gif` (:2097) and `compress-video` (:2174), which walk the same
    // element. /avi-to-mp4 and /mkv-to-mp4 are the honest routes in.
    acceptFormats: ".mp4,.webm,.mov",
    // Every frame is a separate encoded image held in the tab until the ZIP is
    // assembled — that, not the input file, is what runs a tab out of memory.
    practicalLimitNote:
      "Nothing is enforced, but the clip is decoded by this tab and each frame is kept in memory as its own image until the ZIP is built, so a long run at full resolution is what exhausts the tab rather than a big input.",
  },
  {
    name: "Video Thumbnail",
    slug: "video-thumbnail",
    category: "video-tools",
    toolType: "video-thumbnail",
    description: "Grab one still from a video at the moment you pick and save it as JPEG, PNG or WebP. The time the frame really came from is what the file is named.",
    hubLine: "One still, at the frame that exists.",
    keywords: ["video thumbnail", "video thumbnail maker", "grab frame from video", "screenshot from video", "video still capture"],
    h1: "Video Thumbnail Maker — Free Frame Grabber",
    subtitle: "Scrub to a moment, capture the frame the decoder presents there, and download it as an image.",
    // Same engine and the same measurement as `video-to-images` above: the
    // browser's own <video>, which has no AVI demuxer anywhere and no MKV
    // demuxer in WebKit.
    acceptFormats: ".mp4,.webm,.mov",
    // The clip is loaded into a <video> in this tab and the frame is drawn
    // into a canvas at the source's own size; neither is checked against
    // `file.size`.
    practicalLimitNote:
      "Nothing is enforced, but the clip is decoded by this tab's own player and the frame is drawn into a canvas at full size, so what binds is the memory a browser gives one page rather than anything measured about the file.",
  },
  {
    name: "Split Video",
    slug: "split-video",
    category: "video-tools",
    toolType: "split-video",
    description: "Cut a video into parts without re-encoding a frame. Boundaries land on keyframes, so each part's measured length is shown beside the one you asked for.",
    hubLine: "Copied out, keyframe by keyframe.",
    keywords: ["split video", "cut video into parts", "video splitter online", "split mp4", "divide video into segments"],
    h1: "Split Video Online — Free, No Re-Encode",
    subtitle: "Cut a clip into equal parts, fixed lengths, or at times you type, and download them all as one ZIP.",
    acceptFormats: ".mp4,.webm,.mov,.avi,.mkv",
    maxSizeMB: 1536,
  },
  {
    name: "Merge Video",
    slug: "merge-video",
    category: "video-tools",
    toolType: "merge-video",
    description: "Join clips end to end without re-encoding anything. Clips that do not match are refused by name and property rather than silently dropped from the file.",
    hubLine: "Never re-encodes, refuses mismatches.",
    keywords: ["merge video", "combine videos online", "join video files", "video merger", "concatenate mp4"],
    h1: "Merge Video Files Online — Free, No Re-Encode",
    subtitle: "Join clips that share a codec, frame size and container into one file, copied across byte for byte.",
    acceptFormats: ".mp4,.mov,.mkv,.webm",
    maxSizeMB: 1536,
  },
  {
    name: "Webcam Recorder",
    slug: "webcam-recorder",
    category: "video-tools",
    toolType: "webcam-recorder",
    description: "Record your camera and microphone in the browser with a live preview. Your browser's recorder writes the file, usually WebM, and nothing is uploaded.",
    hubLine: "Camera and mic, asked for together.",
    keywords: ["webcam recorder", "record webcam online", "browser camera recorder", "record video from camera", "online webcam recording"],
    h1: "Webcam Recorder — Free Browser Camera Recording",
    subtitle: "Record from your camera with a live preview, pause and resume, then download the clip.",
    acceptFormats: "",
    takesNoFile: true,
  },
  // ── Developer Tools — YAML ────────────────────────────────────────
  //
  // All three read js-yaml's default schema, which constructs no arbitrary
  // types. The two converters share a component and differ only in the
  // direction the page opens on; the formatter does not convert at all — it
  // parses YAML and re-emits it, and its controls (key sorting, line width)
  // mean nothing to the pair above it.
  {
    name: "YAML to JSON",
    slug: "yaml-to-json",
    category: "developer-tools",
    toolType: "yaml-json-converter",
    acceptFormats: ".yaml,.yml",
    description: "Convert YAML to JSON in your browser, multi-document streams included. Non-string keys, expanded anchors and timestamps are counted on screen.",
    hubLine: "Multi-document streams become a JSON array.",
    keywords: ["yaml to json", "convert yaml to json", "yaml json converter", "yaml parser online", "multi document yaml"],
    h1: "YAML to JSON Converter — Free & Instant",
    subtitle: "Drop a .yaml file or paste it in, and get JSON — with every key, anchor and timestamp the two formats disagree about counted on screen.",
  },
  {
    name: "JSON to YAML",
    slug: "json-to-yaml",
    category: "developer-tools",
    toolType: "yaml-json-converter",
    acceptFormats: ".json",
    description: "Convert JSON to YAML at 2 or 4 spaces. The parse this needs costs big integers and duplicate keys, so every literal it changes is listed first.",
    hubLine: "Lists the literals the parse is about to change.",
    keywords: ["json to yaml", "convert json to yaml", "json yaml converter", "yaml generator online"],
    h1: "JSON to YAML Converter — Free & Instant",
    subtitle: "Drop a .json file or paste it in, and get YAML — with every number and duplicate key the conversion changes named before you download.",
  },
  {
    name: "YAML Formatter",
    slug: "yaml-formatter",
    category: "developer-tools",
    toolType: "yaml-formatter",
    acceptFormats: ".yaml,.yml",
    description: "Validate and re-indent YAML, with optional key sorting and a line-width control. Parse errors name the line and column; comments do not survive.",
    hubLine: "Valid YAML out, or the exact line it broke on.",
    keywords: ["yaml formatter", "yaml validator", "format yaml online", "yaml lint", "yaml beautifier"],
    h1: "YAML Formatter & Validator — Free Online Tool",
    subtitle: "Check a YAML file parses, then re-indent it — with the comments, quoting and anchor names the rewrite costs you spelled out.",
  },
  // ── Developer Tools — Line-level text ─────────────────────────────
  //
  // Three pages that rewrite bytes rather than rebuild a document, and
  // `json-minify` is the one that has to say so: it calls the same
  // `minifyJson` scanner `json-formatter` does, which moves whitespace and
  // copies every value byte for byte, because the JSON.parse round trip
  // these pages exist to avoid is what rounds a 64-bit id.
  {
    name: "JSON Minify",
    slug: "json-minify",
    category: "developer-tools",
    toolType: "json-minify",
    acceptFormats: ".json",
    description: "Strip every byte of insignificant whitespace from JSON and see the exact saving. Values are copied character for character, so a 64-bit id survives.",
    hubLine: "The whitespace goes; the numbers do not move.",
    keywords: ["json minify", "minify json online", "json compressor", "compact json", "json whitespace remover"],
    h1: "Minify JSON Online — Free & Instant",
    subtitle: "Drop a .json file or paste the text, and get it back with every byte of insignificant whitespace gone.",
  },
  {
    name: "Sort & Dedupe Lines",
    slug: "sort-dedupe-lines",
    category: "developer-tools",
    toolType: "sort-dedupe-lines",
    acceptFormats: ".txt,.csv,.log",
    description: "Sort, de-duplicate and tidy a list of lines, with the lines in, lines out, duplicates and blanks all counted. Ordering is Unicode collation, not bytes.",
    hubLine: "Every line that left is counted on screen.",
    keywords: ["sort lines online", "remove duplicate lines", "dedupe list", "alphabetize list", "natural sort lines"],
    h1: "Sort and Deduplicate Lines Online",
    subtitle: "Sort a list, drop the duplicates and the blank rows, and see exactly how many lines left and why.",
  },
  {
    name: "Line Ending Converter",
    slug: "crlf-lf",
    category: "developer-tools",
    toolType: "line-endings",
    acceptFormats: ".txt,.csv,.log,.md,.sh",
    description: "Convert line endings between CRLF, LF and CR, and see what a file actually has first — including a mix, counted per kind. Strips a BOM if you ask.",
    hubLine: "A mixed file is counted, not guessed at.",
    keywords: ["crlf to lf", "convert line endings", "dos2unix online", "fix mixed line endings", "windows line endings"],
    h1: "CRLF to LF Converter — Fix Mixed Line Endings",
    subtitle: "Detect what a text file actually uses, mixed endings included, then rewrite every break as CRLF, LF or CR.",
  },
  // ── Developer Tools — Spreadsheets ────────────────────────────────
  //
  // An .xlsx is a ZIP of XML, so this unzips with the jszip already bundled
  // for the ZIP downloads rather than adding a spreadsheet library. Dates
  // come out as the serial numbers the file actually stores — the page and
  // its FAQ say so rather than guessing at a display format.
  {
    name: "XLSX to CSV",
    slug: "xlsx-to-csv",
    category: "developer-tools",
    toolType: "xlsx-to-csv",
    acceptFormats: ".xlsx",
    description: "Convert an Excel .xlsx workbook to CSV in your browser. Pick which sheets to export, choose comma, semicolon or tab, and see the real quoting first.",
    hubLine: "One CSV per sheet, plus the semicolon Excel wants.",
    keywords: ["xlsx to csv", "excel to csv", "convert xlsx to csv", "xlsx converter", "excel spreadsheet to csv"],
    h1: "Convert XLSX to CSV Online — Free, No Upload",
    subtitle: "Unzip an Excel workbook in your browser and write one CSV per sheet — nothing leaves this tab.",
  },
  // ── Developer Tools — Encodings and network logs ──────────────────
  //
  // `charset-converter` shares the strict-UTF-8-then-guess detector with
  // `subtitle-converter` and writes UTF-8 only, because TextEncoder cannot
  // write anything else — that is a browser limit, not a missing feature,
  // and the copy states it. `har-viewer` sits beside it because a HAR is a
  // text log whose whole risk is what it carries: cookies, Authorization
  // headers and the body of the login POST.
  {
    name: "Charset Converter",
    slug: "charset-converter",
    category: "developer-tools",
    toolType: "charset-converter",
    acceptFormats: ".txt,.csv,.log,.srt,.md",
    description: "Read a text file in Windows-1252, Shift_JIS, KOI8-R or any of 25 encodings and save it as UTF-8. UTF-8 is the only encoding a browser can write.",
    hubLine: "legacy codepages in, UTF-8 out",
    keywords: ["charset converter", "convert to utf-8", "fix mojibake", "windows-1252 to utf-8", "text encoding converter"],
    h1: "Charset Converter — Legacy Encodings to UTF-8",
    subtitle: "Read a file in Windows-1252, Shift_JIS, KOI8-R or any of 25 encodings, see the accents come out right, and save it as UTF-8.",
  },
  {
    name: "HAR Viewer",
    slug: "har-viewer",
    category: "developer-tools",
    toolType: "har-viewer",
    acceptFormats: ".har,.json",
    description: "Open a .har network log without uploading it. Filter and sort every request, read headers and timings, and export a copy with cookies and tokens stripped.",
    hubLine: "your cookies and tokens stay in the tab",
    keywords: ["har viewer", "har file analyzer", "network log viewer", "har redact", "open har file"],
    h1: "HAR Viewer — Read a Network Log Without Uploading It",
    subtitle: "A HAR carries your cookies, auth headers and login POST body. This one reads it in the tab and can strip those before you send it on.",
    practicalLimitNote:
      "Nothing is enforced, but the whole file is read as one JavaScript string — Chrome refuses one past about 512 MB — and the parsed document and its request views then sit in tab memory beside it, measured at about 3.4 times the file's size on a 34 MB capture, with a second copy built while a redacted export is written.",
  },
  // ── Developer Tools — Web Crypto ──────────────────────────────────
  //
  // HMAC in all three. `jwt-encoder` signs with HS256/384/512 and asks for
  // no private key at all; `hmac-generator` MACs a message and can check one
  // the other side sent; `file-checksum` is the hashing worker with a
  // comparison surface on top. That last one carries a practical note rather
  // than a cap because it reads the file into a single buffer and hands it
  // over whole — nothing is enforced, and the sentence says which allocation
  // binds.
  {
    name: "JWT Encoder",
    slug: "jwt-encoder",
    category: "developer-tools",
    toolType: "jwt-encoder",
    acceptFormats: "",
    takesNoFile: true,
    description: "Sign a JWT with HS256, HS384 or HS512 in your browser. Header and payload editors, computed iat, exp and nbf claims, and unpadded base64url output.",
    hubLine: "HMAC algorithms only — no private key asked for.",
    keywords: ["jwt encoder", "sign jwt", "jwt generator", "create jwt token", "hs256 jwt"],
    h1: "JWT Encoder — Sign HS256, HS384 & HS512 Tokens",
    subtitle: "Build the header and payload, sign with your secret, and copy the token — a JWT is signed, not encrypted, so every claim in it stays readable.",
  },
  {
    name: "HMAC Generator",
    slug: "hmac-generator",
    category: "developer-tools",
    toolType: "hmac-generator",
    acceptFormats: "",
    takesNoFile: true,
    description: "Compute HMAC-SHA1, SHA-256, SHA-384 or SHA-512 with a text, hex or base64 key. Hex and base64 output, plus a field to check a MAC someone else sent.",
    hubLine: "Key encoding is a control, because it is the bug.",
    keywords: ["hmac generator", "hmac sha256", "hmac calculator", "verify webhook signature", "hmac online"],
    h1: "HMAC Generator & Verifier — SHA-1 to SHA-512",
    subtitle: "Compute an HMAC over a message with a text, hex or base64 key, and check a MAC the other side sent you.",
  },
  {
    name: "File Checksum",
    slug: "file-checksum",
    category: "developer-tools",
    toolType: "file-checksum",
    acceptFormats: "",
    description: "Hash any file and check it against the checksum the publisher printed. Reads shasum, BSD and SHA256SUMS lines, and names the algorithm that matched.",
    hubLine: "Reads the whole shasum line, not just the hash.",
    keywords: ["file checksum", "verify checksum", "sha256 checksum", "checksum verifier", "verify download hash"],
    h1: "File Checksum Verifier — Match a Published Hash",
    subtitle: "Drop a download, paste the checksum from the release page, and see which algorithm matched — or that none did.",
    /*
      ⚠ NO `practicalLimitNote`, deliberately — see the fuller note on
      /hash-generator. This page used to read every file into one ArrayBuffer
      and hand it to the worker whole, which put the renderer's ~2 GB
      single-allocation wall in front of exactly the files a checksum tool is
      for (an ISO, a database dump). It streams since 2026-09-13, so the
      ceiling is gone rather than merely undisclosed.
    */
  },
  // ── Developer Tools — Wi-Fi QR ────────────────────────────────────
  //
  // The payload is `WIFI:T:WPA;S:<ssid>;P:<pass>;;`, so a semicolon, comma,
  // colon or backslash inside the name or the passphrase has to be escaped
  // or the reader gets half a password. That escaping is most of the tool;
  // the drawing is the same `qrcode` call `qr-code-generator` makes.
  {
    name: "Wi-Fi QR Code Generator",
    slug: "wifi-qr-code",
    category: "developer-tools",
    toolType: "wifi-qr-code",
    acceptFormats: "",
    takesNoFile: true,
    description: "Generate a QR code that joins a Wi-Fi network. SSID, password and security type, escaped properly — and the password is readable to anyone who scans it.",
    hubLine: "Escapes the semicolons that break hand-built codes.",
    keywords: ["wifi qr code", "wifi qr code generator", "guest wifi qr code", "scan to join wifi", "wifi password qr"],
    h1: "Wi-Fi QR Code Generator — Scan to Join",
    subtitle: "Turn a network name and password into a QR code any phone camera can join from, built and drawn in this tab.",
  },
  // ── Developer Tools — Reference and calculators ───────────────────
  //
  // Six pages that take no file at all and ship their data with the page.
  // Nothing here loads an engine and nothing here fetches: the status-code
  // registry, the permission bits, the two unit columns and the ratio
  // arithmetic are all in the bundle, and `url-parser` and
  // `timezone-converter` read the browser's own URL parser and Intl tables
  // rather than a table of offsets that would be wrong twice a year.
  {
    name: "Chmod Calculator",
    slug: "chmod-calculator",
    category: "developer-tools",
    toolType: "chmod-calculator",
    acceptFormats: "",
    takesNoFile: true,
    description: "Tick a permission box, type 755, or type rwxr-xr-x — all three stay in step. Handles setuid, setgid and sticky, including the capital S and T rule.",
    hubLine: "a capital S means the bit is set and inert",
    keywords: ["chmod calculator", "chmod 755", "file permissions calculator", "octal to symbolic permissions", "setuid setgid sticky bit"],
    h1: "Chmod Calculator — Octal, Symbolic & Special Bits",
    subtitle: "Convert between the checkbox grid, the octal number and the rwx string, and copy the chmod command to run.",
  },
  {
    name: "HTTP Status Codes",
    slug: "http-status-codes",
    category: "developer-tools",
    toolType: "http-status-codes",
    acceptFormats: "",
    takesNoFile: true,
    description: "Every IANA-registered status code with its RFC, reason phrase and what it means. Search by code, phrase or symptom; vendor codes are kept separate.",
    hubLine: "vendor codes kept in their own labelled group",
    keywords: ["http status codes", "http status code list", "what does 502 mean", "http response codes", "429 too many requests"],
    h1: "HTTP Status Codes — The Full IANA Registry",
    subtitle: "Every registered code with its RFC, plus the nginx and Cloudflare codes no standard defines.",
  },
  {
    name: "Byte Converter",
    slug: "byte-converter",
    category: "developer-tools",
    toolType: "byte-converter",
    acceptFormats: "",
    takesNoFile: true,
    description: "Convert between bits, bytes, kB and KiB with the decimal and binary columns side by side. Exact byte counts in BigInt, plus a transfer-time estimate.",
    hubLine: "decimal and binary, side by side",
    keywords: ["byte converter", "mb to mib", "gb vs gib", "bytes to gb", "data size converter"],
    h1: "Byte Converter — MB vs MiB, Exactly",
    subtitle: "Enter a size in any unit and read every other one at once — decimal, binary and bits.",
  },
  {
    name: "Time Zone Converter",
    slug: "timezone-converter",
    category: "developer-tools",
    toolType: "timezone-converter",
    acceptFormats: "",
    takesNoFile: true,
    description: "Convert one instant across as many time zones as you need. Every offset and abbreviation is read for that exact moment, so daylight saving is never assumed.",
    hubLine: "offsets read per instant, DST traps and all",
    keywords: ["time zone converter", "meeting planner time zones", "utc to local time", "dst time converter", "world clock converter"],
    h1: "Time Zone Converter — One Instant, Every Zone",
    subtitle: "Convert one moment into as many zones as you need, with the date, the UTC offset and the abbreviation for that exact instant.",
  },
  {
    name: "Aspect Ratio Calculator",
    slug: "aspect-ratio-calculator",
    category: "developer-tools",
    toolType: "aspect-ratio-calculator",
    acceptFormats: "",
    takesNoFile: true,
    description: "Solve for width, height or ratio, and fit one box inside another. Ratios reduce with a GCD, so 1366×768 is reported as 683:384 rather than as 16:9.",
    hubLine: "1366×768 is 683:384, and it says so",
    keywords: ["aspect ratio calculator", "16:9 calculator", "resize keeping aspect ratio", "letterbox calculator", "pixel dimensions calculator"],
    h1: "Aspect Ratio Calculator — Solve for Any Side",
    subtitle: "Enter any two of width, height and ratio and the third follows, reduced with a GCD rather than rounded to a famous name.",
  },
  {
    name: "URL Parser",
    slug: "url-parser",
    category: "developer-tools",
    toolType: "url-parser",
    acceptFormats: "",
    takesNoFile: true,
    description: "Break any URL into protocol, host, port, path, query and hash. Repeated query keys stay repeats, and double-encoded values are flagged rather than hidden.",
    hubLine: "repeats kept, punycode shown, nothing fetched",
    keywords: ["url parser", "query string parser", "parse url online", "url component viewer", "punycode hostname"],
    h1: "URL Parser — Every Part of a URL, Decoded",
    subtitle: "Break a URL into its parts, read the query string as a table, and see exactly what the parser rewrote on the way through.",
  },
  // ── Developer Tools — Archives, Documents & Code Symbols ─────────
  //
  // Wave 4's second batch. The first four are ZIP readers and writers of one
  // kind or another, and are deliberately four tools rather than one:
  // `unzip-files` reads a plain .zip with JSZip, which this site already
  // ships as JavaScript; `create-zip` writes one with the same library;
  // `extract-archive` fetches a 599 KB WebAssembly libarchive, because TAR,
  // 7-Zip and RAR are outside what JSZip can open at all; and
  // `docx-to-markdown` is a ZIP reader of one very particular layout, which
  // is why it sits here rather than beside the Markdown pages whose writer it
  // borrows. The last three are not archives at all — an optimiser, a symbol
  // writer and a symbol reader — and are grouped here only because they
  // landed together; the ToolType block above says why none of them could
  // share a type with the page it most resembles.
  {
    name: "Extract Archive",
    slug: "extract-archive",
    category: "developer-tools",
    toolType: "extract-archive",
    acceptFormats: ".zip,.tar,.gz,.tgz,.bz2,.xz,.7z,.rar",
    description: "Unpack ZIP, TAR, 7z, RAR, tar.gz, tar.xz and tar.bz2 archives in your browser. List what is inside, pick the files you need, and download only those.",
    hubLine: "seven archive formats, opened in the tab",
    keywords: ["extract archive", "open 7z online", "extract rar files", "untar online", "open tar.gz"],
    h1: "Extract Files From a ZIP, TAR, 7z or RAR Archive",
    subtitle: "List everything inside an archive, tick the files you want, and pull them out — without uploading the archive anywhere.",
    practicalLimitNote:
      "Nothing is enforced, but extraction copies the whole archive into the engine's memory in one block and allocates each file you pull out beside it, so a run holds the archive about twice over — measured at 88 MB of engine memory for a 48 MB tar whose largest member was 32 MB.",
  },
  {
    name: "Create ZIP",
    slug: "create-zip",
    category: "developer-tools",
    toolType: "create-zip",
    acceptFormats: "",
    description: "Zip files together in your browser, choose the compression, and read the real packed size back out of the finished archive. Nothing is uploaded.",
    hubLine: "many files in, one .zip out, with the real saving measured",
    keywords: ["create zip", "zip files online", "make a zip file", "zip compressor", "combine files into zip"],
    h1: "Create a ZIP File Online — Free, No Upload",
    subtitle: "Pack any number of files into one archive in your browser, and see what each one actually weighed inside it.",
    practicalLimitNote:
      "Nothing is enforced, but every file is held in memory at once while the finished archive is built whole beside them — zipping 256 MB of already-compressed files was measured at about 1.5 GB of peak memory.",
  },
  {
    name: "Unzip Files",
    slug: "unzip-files",
    category: "developer-tools",
    toolType: "unzip-files",
    acceptFormats: ".zip",
    description: "Open a .zip in your browser: every entry listed with its real size, take out only the files you want, and paths that try to escape are refused.",
    hubLine: "see inside an archive before you unpack any of it",
    keywords: ["unzip files", "open zip file online", "extract zip", "zip viewer", "unzip without software"],
    h1: "Unzip Files Online — Free, No Upload",
    subtitle: "List everything inside a .zip with its real size, then pull out just the files you want — all in this tab.",
    practicalLimitNote:
      "Nothing is enforced, and what binds is the UNPACKED total rather than the archive's own size — a small archive can hold an enormous amount, and extracting it was measured at about three times that unpacked total in memory.",
  },
  {
    name: "DOCX to Markdown",
    slug: "docx-to-markdown",
    category: "developer-tools",
    toolType: "docx-to-markdown",
    acceptFormats: ".docx",
    description: "Convert a Word .docx to Markdown in your browser. Tables come through as pipe tables, footnotes as [^1], and the page counts what Markdown could not carry.",
    hubLine: "counts the headers, comments and merges it dropped",
    keywords: ["docx to markdown", "word to markdown", "convert docx to md", "word document to markdown", "docx converter"],
    h1: "Convert DOCX to Markdown — Free, No Upload",
    subtitle: "Read a Word document in your browser and get Markdown, with a count of everything the trip cost.",
  },
  {
    name: "SVG Optimizer",
    slug: "svg-optimizer",
    category: "developer-tools",
    toolType: "svg-optimizer",
    acceptFormats: ".svg",
    description: "Minify an SVG with SVGO in your browser and read the real byte saving. Every default pass that can change how it renders is named, and can be switched off.",
    hubLine: "the real byte saving, plus every pass that can change the picture",
    keywords: ["svg optimizer", "minify svg", "svgo online", "compress svg", "reduce svg file size"],
    h1: "SVG Optimizer — Minify SVG Files in Your Browser",
    subtitle: "Run SVGO on a vector file without uploading it, and read exactly what each pass took out.",
    practicalLimitNote:
      "Nothing is enforced, but the whole file is parsed into one object per element and per attribute, held in this tab while thirty-odd passes rewrite it, and the run blocks the page until it finishes — so the ceiling here is this tab's own memory rather than a cap set for you.",
  },
  {
    name: "Barcode Generator",
    slug: "barcode-generator",
    category: "developer-tools",
    toolType: "barcode-generator",
    acceptFormats: "",
    takesNoFile: true,
    description: "Generate Code 128, EAN-13, UPC, ITF-14, QR, Data Matrix, PDF417 and Aztec barcodes in your browser. Validated per symbology, saved as SVG or PNG.",
    hubLine: "Refuses a wrong check digit instead of drawing it anyway.",
    keywords: ["barcode generator", "ean 13 generator", "code 128 generator", "upc barcode generator", "free barcode maker"],
    h1: "Barcode Generator — Code 128, EAN, UPC, QR and More",
    subtitle: "Eleven symbologies, each checked against its own rules before a single bar is drawn, and nothing leaves this tab.",
  },
  {
    name: "QR Code Reader",
    slug: "qr-code-reader",
    category: "developer-tools",
    toolType: "qr-code-reader",
    acceptFormats: ".png,.jpg,.jpeg,.webp,.gif,.bmp",
    description: "Scan a QR code or barcode out of a photo or screenshot in your browser. Reads every code in the picture and shows decoded links as text, not as links.",
    hubLine: "decoded links stay text, never clickable",
    keywords: ["qr code reader", "scan qr code from image", "qr code scanner online", "read barcode from photo", "decode qr code"],
    h1: "QR Code Reader — Scan a Code From an Image",
    subtitle: "Drop a photo or screenshot and read every code in it, decoded in this tab and never turned into a link you can tap by mistake.",
  },
  {
    name: "Watermark PDF",
    slug: "watermark-pdf",
    category: "pdf-tools",
    toolType: "watermark-pdf",
    acceptFormats: ".pdf",
    description: "Stamp text or a logo onto a PDF in your browser. Set the size, colour, opacity and angle, drag it into place, or tile it across the page.",
    hubLine: "Text or a logo, on the pages you choose.",
    keywords: ["watermark pdf","add watermark to pdf","pdf watermark","stamp pdf","confidential watermark pdf"],
    h1: "Watermark PDF — Free Online Tool",
    subtitle: "Place text or an image on your pages, drag it exactly where you want it, and download the stamped PDF.",
  },
  {
    name: "Sign PDF",
    slug: "sign-pdf",
    category: "pdf-tools",
    toolType: "sign-pdf",
    acceptFormats: ".pdf",
    description: "Sign a PDF in your browser: draw your signature or upload a PNG, place it on any page, and download the result. A drawn mark, not a digital signature.",
    hubLine: "Draw a signature, place it, done.",
    keywords: ["sign pdf","sign pdf online","add signature to pdf","draw signature on pdf","pdf signature image"],
    h1: "Sign a PDF Online — Draw or Place Your Signature",
    subtitle: "Draw a signature with your pointer or place a PNG, position it on any page, and download the signed PDF.",
  },
  {
    name: "Add Image to PDF",
    slug: "add-image-to-pdf",
    category: "pdf-tools",
    toolType: "add-image-to-pdf",
    acceptFormats: ".pdf",
    description: "Place a PNG or JPEG onto the pages of an existing PDF. Drag it where you want it or type exact percentages, then set its width, opacity and turn.",
    hubLine: "Drop a logo, stamp or photo onto any page.",
    keywords: ["add image to pdf","insert image into pdf","add logo to pdf","put a picture in a pdf","place png on pdf"],
    h1: "Add an Image to a PDF — Free Online Tool",
    subtitle: "Place a PNG or JPEG on one page or every page, and drag it exactly where you want it.",
  },
  {
    name: "Annotate PDF",
    slug: "annotate-pdf",
    category: "pdf-tools",
    toolType: "annotate-pdf",
    acceptFormats: ".pdf",
    description: "Draw highlight blocks, outline boxes and text notes onto one page of a PDF. The marks are painted into the page, and nothing here selects text.",
    hubLine: "Place marks by hand — nothing selects text.",
    keywords: ["annotate pdf","highlight pdf","add note to pdf","pdf markup","draw on pdf"],
    h1: "Annotate PDF — Free Online Tool",
    subtitle: "Place highlight blocks, outline boxes and text notes on one page, then download the marked PDF.",
  },
  {
    name: "Fill PDF Form",
    slug: "fill-pdf-form",
    category: "pdf-tools",
    toolType: "fill-pdf-form",
    acceptFormats: ".pdf",
    description: "Fill in a PDF's real form fields — text, check boxes, radio groups, dropdowns and list boxes — then flatten them or leave the form editable.",
    hubLine: "Type into a PDF's real form fields.",
    keywords: ["fill pdf form","pdf form filler","fill out pdf online","acroform filler","flatten pdf form"],
    h1: "Fill a PDF Form — Free Online PDF Form Filler",
    subtitle: "Read a PDF's form fields, type into them, and download the filled copy — flattened or still editable.",
  },
  {
    name: "Flatten PDF",
    slug: "flatten-pdf",
    category: "pdf-tools",
    toolType: "flatten-pdf",
    acceptFormats: ".pdf",
    description: "See every field a PDF form holds, then flatten it: the values are drawn into the page and the fields are removed, right in your browser.",
    hubLine: "Bakes the answers in and deletes the fields.",
    keywords: ["flatten pdf","flatten pdf form","make pdf form non-editable","bake pdf form fields","lock a filled pdf form"],
    h1: "Flatten PDF — Bake Form Fields Into the Page",
    subtitle: "See exactly what a PDF form holds, then flatten it so the answers become page content with nothing left to type into.",
  },
  {
    name: "Remove Metadata",
    slug: "remove-metadata",
    category: "pdf-tools",
    toolType: "remove-metadata",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.tiff,.tif,.heic,.heif,.pdf",
    description: "Strip a PDF's document properties and XMP packets, or a photo's EXIF, IPTC and GPS tags, and get the cleaned file back in one press.",
    hubLine: "PDF properties and XMP, or a photo's EXIF and GPS.",
    keywords: ["remove metadata","remove pdf metadata","strip exif data","remove gps from photo","clear document properties"],
    h1: "Remove Metadata from PDFs and Photos — Free & Private",
    subtitle: "Clear a document's properties or a photo's EXIF and GPS in your browser — one press cleans the file and saves it.",
  },
  {
    name: "PDF Editor",
    slug: "pdf-editor",
    category: "pdf-tools",
    toolType: "pdf-editor",
    acceptFormats: ".pdf",
    description: "Add text, an image, a whiteout box or freehand ink to a PDF, and delete pages. It marks over the page \u2014 the text already in it cannot be retyped.",
    hubLine: "Add marks, cover text, drop pages.",
    keywords: ["pdf editor", "edit pdf", "edit pdf online", "add text to pdf", "free pdf editor"],
    h1: "PDF Editor \u2014 Edit a PDF in Your Browser",
    subtitle: "Add text, a picture, a whiteout box or freehand ink to any page, delete the pages you don't want, and download the result.",
  },

  // ── OCR ────────────────────────────────────────────────────────────
  {
    name: "Image to Text",
    slug: "image-to-text",
    category: "image-tools",
    toolType: "image-to-text",
    description:
      "Read printed text out of a photo, screenshot or scan with Tesseract OCR, running in your browser. The picture is never uploaded — the engine is.",
    hubLine: "OCR that runs in the tab. The picture never leaves it.",
    keywords: [
      "image to text",
      "ocr online",
      "extract text from image",
      "photo to text",
      "screenshot to text",
      "jpg to text",
      "png to text",
    ],
    h1: "Image to Text — Free OCR in Your Browser",
    subtitle:
      "Pull the printed words out of a picture without uploading it. Tesseract is compiled to WebAssembly and runs in this tab.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.bmp,.gif",
    practicalLimitNote:
      "Nothing is enforced, but the ceiling is real: the engine holds the decoded picture and the 4.1 MB English model in wasm memory at the same time, so a very large scan can exhaust the tab before it finishes.",
  },

  // ── OCR for documents ──────────────────────────────────────────────
  {
    name: "OCR PDF",
    slug: "ocr-pdf",
    category: "pdf-tools",
    toolType: "ocr-pdf",
    description:
      "Make a scanned PDF searchable by laying invisible OCR text over the pages. The pages themselves are not changed, and nothing is uploaded.",
    hubLine: "Searchable scans. The page image is left alone.",
    keywords: [
      "ocr pdf",
      "searchable pdf",
      "scanned pdf to text",
      "make pdf searchable",
      "pdf ocr online",
      "recognize text in pdf",
    ],
    h1: "OCR a PDF — Make a Scanned Document Searchable",
    subtitle:
      "Adds an invisible text layer to a scan so you can search, select and copy it. The pages look exactly as they did.",
    acceptFormats: ".pdf",
    practicalLimitNote:
      "Nothing is enforced about file size, but 50 pages is: each page is rendered at about 300 dpi and held in wasm memory beside the language model, and beyond that a tab is likely to run out before it finishes.",
  },

  // ── Personal-data exports ──────────────────────────────────────────
  {
    name: "VCF to CSV",
    slug: "vcf-to-csv",
    category: "developer-tools",
    toolType: "vcf-to-csv",
    description:
      "Turn a .vcf contacts export into a spreadsheet. Each contact becomes a row, repeated emails and phones get their own columns, and nothing is uploaded.",
    hubLine: "Your address book as a spreadsheet, read in the tab.",
    keywords: ["vcf to csv", "vcard to csv", "contacts to spreadsheet", "convert vcf", "export contacts csv"],
    h1: "VCF to CSV — Convert a Contacts Export to a Spreadsheet",
    subtitle:
      "Reads a vCard file and writes a CSV you can open in any spreadsheet. Your contacts stay in this tab.",
    acceptFormats: ".vcf,.vcard",
  },
  {
    name: "ICS to CSV",
    slug: "ics-to-csv",
    category: "developer-tools",
    toolType: "ics-to-csv",
    description:
      "Turn an .ics calendar export into a spreadsheet. One row per event, with the time zone kept in its own column rather than guessed at.",
    hubLine: "Your calendar as a spreadsheet, read in the tab.",
    keywords: ["ics to csv", "ical to csv", "calendar to spreadsheet", "convert ics", "export calendar csv"],
    h1: "ICS to CSV — Convert a Calendar Export to a Spreadsheet",
    subtitle:
      "Reads an iCalendar file and writes a CSV you can open in any spreadsheet. Your calendar stays in this tab.",
    acceptFormats: ".ics,.ical,.ifb",
  },

  // ── GIF animation verbs ────────────────────────────────────────────
  {
    name: "Resize GIF",
    slug: "resize-gif",
    category: "image-tools",
    toolType: "resize-gif",
    description:
      "Make an animated GIF smaller without turning it into a still. Every frame is scaled and the timing is kept, and it all happens in your browser.",
    hubLine: "Scales every frame and keeps the animation.",
    keywords: ["resize gif", "shrink gif", "gif resizer", "make gif smaller", "scale animated gif"],
    h1: "Resize a GIF Online — Keeps the Animation",
    subtitle:
      "Scales an animated GIF down and re-encodes every frame, keeping the frame timing exactly as it was.",
    acceptFormats: ".gif",
    practicalLimitNote:
      "Nothing is enforced, but every frame is held decoded in memory at once, so a long GIF at full size can exhaust the tab before it finishes.",
  },
  {
    name: "GIF Speed Changer",
    slug: "gif-speed-changer",
    category: "image-tools",
    toolType: "gif-speed-changer",
    description:
      "Speed up or slow down an animated GIF in your browser. Every frame delay is rescaled and no frames are added or dropped, so nothing gets choppier.",
    hubLine: "Re-times an animation without dropping frames.",
    keywords: ["gif speed changer", "speed up gif", "slow down gif", "change gif speed", "gif fps"],
    h1: "Change the Speed of a GIF — Faster or Slower",
    subtitle:
      "Rescales how long each frame is shown. No frames are added or thrown away, so nothing gets choppier than it started.",
    acceptFormats: ".gif",
    practicalLimitNote:
      "Nothing is enforced, but every frame is held decoded in memory at once, so a long GIF at full size can exhaust the tab before it finishes.",
  },
  {
    name: "Reverse GIF",
    slug: "reverse-gif",
    category: "image-tools",
    toolType: "reverse-gif",
    description:
      "Play an animated GIF backwards in your browser. The frame order and the frame delays are reversed together, so it keeps its own rhythm in reverse.",
    hubLine: "Plays it backwards, timings and all.",
    keywords: ["reverse gif", "play gif backwards", "gif reverser", "backwards gif"],
    h1: "Reverse a GIF Online — Play It Backwards",
    subtitle:
      "Reverses the frames and their delays together, which is what makes a reversed animation keep its own rhythm.",
    acceptFormats: ".gif",
    practicalLimitNote:
      "Nothing is enforced, but every frame is held decoded in memory at once, so a long GIF at full size can exhaust the tab before it finishes.",
  },
  {
    name: "Split GIF into Frames",
    slug: "split-gif",
    category: "image-tools",
    toolType: "split-gif",
    description:
      "Pull every frame out of an animated GIF as a numbered PNG and download them as a ZIP. Runs in your browser, so the animation is never uploaded.",
    hubLine: "Every frame as its own PNG, in order.",
    keywords: ["split gif", "gif to frames", "extract gif frames", "gif frame extractor", "gif to png"],
    h1: "Split a GIF into Frames — Every Frame as a PNG",
    subtitle:
      "Extracts each frame as a numbered PNG and hands them back as a ZIP, in the order they play.",
    acceptFormats: ".gif",
    practicalLimitNote:
      "Nothing is enforced, but every frame is held decoded in memory at once, so a long GIF at full size can exhaust the tab before it finishes.",
  },

  {
    name: "GIF Maker",
    slug: "gif-maker",
    category: "image-tools",
    toolType: "gif-maker",
    description:
      "Build an animated GIF from a set of still images in your browser. Frames are ordered by filename and nothing is ever uploaded.",
    hubLine: "Stills in, one animation out.",
    keywords: ["gif maker", "images to gif", "make a gif", "photos to gif", "create animated gif"],
    h1: "GIF Maker — Turn a Set of Images into an Animation",
    subtitle:
      "Drop several pictures and get one animated GIF. You choose how long each frame is shown.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.bmp,.gif",
    practicalLimitNote:
      "Nothing is enforced, but every picture is decoded into memory at once, so a few hundred full-size photos can exhaust the tab before the animation is built.",
  },
  {
    name: "CSV to Markdown Table",
    slug: "csv-markdown-table",
    category: "developer-tools",
    toolType: "csv-markdown-table",
    description:
      "Convert a CSV into a Markdown table, or a Markdown table back into CSV. Pipes and line breaks are escaped so the columns survive.",
    hubLine: "CSV to a Markdown table, and back again.",
    keywords: ["csv to markdown", "markdown table generator", "csv to markdown table", "markdown to csv", "make markdown table"],
    h1: "CSV to Markdown Table — and Back Again",
    subtitle:
      "Paste or drop a CSV and get a Markdown table you can put straight into a README. It converts the other way too.",
    acceptFormats: ".csv,.md,.markdown",
  },
  {
    name: "Bcrypt Generator",
    slug: "bcrypt-generator",
    category: "developer-tools",
    toolType: "bcrypt-generator",
    takesNoFile: true,
    description:
      "Generate a bcrypt hash from a password, or check a password against an existing hash. It runs in your browser, so nothing you type is sent anywhere.",
    hubLine: "Bcrypt hashes, made and checked in the tab.",
    keywords: ["bcrypt generator", "bcrypt hash", "bcrypt checker", "hash password", "bcrypt online"],
    h1: "Bcrypt Generator and Checker",
    subtitle:
      "Hash a password with bcrypt at a work factor you choose, or verify one against a hash you already have.",
    acceptFormats: "",
  },
];

export function getToolBySlug(slug: string): Tool | undefined {
  return tools.find((t) => t.slug === slug);
}

export function getToolsByCategory(category: string): Tool[] {
  return tools.filter((t) => t.category === category);
}

/**
 * Tool types whose whole job is moving a file from one format to another. The
 * rest — compress, resize, trim, generate, inspect — either keep the format or
 * produce a different kind of artifact, and read as utilities on a category hub.
 */
const CONVERTER_TOOL_TYPES = new Set<ToolType>([
  "image-convert",
  "jfif-to-jpg",
  "pdf-to-jpg",
  "images-to-pdf",
  "markdown-to-pdf",
  "mp3-to-wav",
  "wav-to-mp3",
  "m4a-to-mp3",
  // Both shared audio types: every slug on them takes one format in and writes
  // another out. Left off this Set they would have landed silently in the
  // "Utilities" half of /audio-tools and /video-tools, which is the fallback
  // bucket — the Set is opt-IN and no test would have caught it.
  "audio-convert",
  "extract-audio",
  "video-to-gif",
  "mp4-to-mp3",
  "webm-to-mp4",
  // The six container tools. `mute-video` and `rotate-video` deliberately stay
  // out: both write the same container back, so they are utilities, not
  // format converters.
  "video-remux",
  /*
    Frames out of a video, which is the same job `pdf-to-jpg` does for a
    document and that tool is in this Set. `video-thumbnail` deliberately is
    NOT: it hands back one still chosen from a moment, not the clip converted
    into anything, which is the same reason `extract-images-from-pdf` sits in
    Utilities. `split-video` and `merge-video` also stay out — both write the
    format they were given straight back.
  */
  "video-to-images",
  "json-to-csv",
  "csv-to-json",
  "markdown-to-html",
  "html-to-markdown",
  "image-to-text",
  "vcf-to-csv",
  "ics-to-csv",
  "split-gif",
  "gif-maker",
  "csv-markdown-table",
  "base64-encode-decode",
  "url-encode-decode",
  "jwt-decoder",
  "html-entity-encode-decode",
]);

export function isConverter(tool: Tool): boolean {
  return CONVERTER_TOOL_TYPES.has(tool.toolType);
}

/** Split a category's tools into the two groups a hub page shows. */
export function splitByJob(list: Tool[]): { utilities: Tool[]; converters: Tool[] } {
  return {
    utilities: list.filter((t) => !isConverter(t)),
    converters: list.filter(isConverter),
  };
}
