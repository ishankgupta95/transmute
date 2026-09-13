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
  relatedTools: string[];
  aboutText: string;
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
  /**
   * <title> override for tools whose `h1` runs past ~60 chars once the
   * " | Transmute" template suffix lands. The on-page H1 keeps its longer
   * copy; only the tab/SERP title shortens.
   */
  titleTag?: string;
}

export const tools: Tool[] = [
  // ── Image Converters ──────────────────────────────────────────────
  {
    name: "HEIC to JPG",
    slug: "heic-to-jpg",
    titleTag: "Convert HEIC to JPG Online — Free & Private",
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
    relatedTools: ["webp-to-jpg", "png-to-jpg", "avif-to-jpg", "jpg-to-png"],
    aboutText: "HEIC (High Efficiency Image Container) is the default photo format on iPhones and iPads since iOS 11. While HEIC files are roughly half the size of JPGs at the same quality — saving significant storage space on your device — many websites, apps, email clients, and devices still do not support them. Windows PCs, older Android devices, most social media upload forms, and many photo printing services cannot open HEIC files, which makes sharing iPhone photos frustrating. This tool converts your HEIC photos to the universally compatible JPG format instantly — no upload to any server, no sign-up, no waiting. Everything happens locally in your browser using the Canvas API and the libheif decoder. Your photos stay on your device the entire time, ensuring complete privacy for personal and sensitive images. You can adjust the output quality to balance file size and visual fidelity, and batch convert multiple photos at once. Whether you are preparing iPhone photos for a website, sharing vacation pictures with family members on non-Apple devices, uploading product photos to an e-commerce platform, or simply need a format that works everywhere, this tool handles the conversion in seconds.",
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
    relatedTools: ["heic-to-jpg", "webp-to-jpg", "png-to-webp", "compress-image"],
    aboutText: "HEIC is what an iPhone writes by default, and almost nothing on the web reads it. WebP is read by every current browser and by most of the software behind them, so this is the conversion that gets a phone photo onto a page. Two things about the mechanics are worth stating plainly. First, no browser decodes HEIC natively, so this page fetches libheif — a 1.4 MB decoder and its WebAssembly binary, once, on your first HEIC, served from this site rather than from a CDN — and decodes with that. It is why the first photo takes noticeably longer than the second. Second, HEIC and WebP are both lossy, so what you get back is a second generation: the HEIC is decoded to pixels and those pixels are compressed again by a different codec. That cannot recover anything the first encode discarded, and it costs a little of its own, most visibly in smooth gradients and skin tones. The quality slider controls the second pass only. Metadata does not survive either — the photo is decoded and re-encoded through the Canvas API, so EXIF, GPS and the capture time are not carried into the WebP, which is often exactly what you want before posting one. If the destination wants JPG instead, the HEIC to JPG page takes the same files. Batch conversion is supported, and nothing is uploaded.",
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
    relatedTools: ["webp-to-png", "heic-to-jpg", "png-to-jpg", "jpg-to-webp"],
    aboutText: "WebP is a modern image format developed by Google that provides superior compression compared to JPG and PNG. While adoption has grown rapidly, not all software and platforms support WebP yet — older image editors like some versions of Photoshop, certain email clients, print services, and some social media platforms still require JPG. This tool converts your WebP files to the universally supported JPG format using your browser's Canvas API. No files leave your device, making it a safe choice for sensitive or personal photos. The conversion is instant and you can adjust the quality slider to balance file size and visual fidelity. Whether you are preparing images for a client presentation, uploading product photos to a marketplace that does not accept WebP, or simply need a format that works everywhere, this converter handles it in seconds. Batch processing is supported, so you can convert multiple WebP images at once.",
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
    relatedTools: ["webp-to-jpg", "png-to-jpg", "jpg-to-png", "svg-to-png"],
    aboutText: "Need a WebP image in PNG format? PNG is a lossless format that preserves transparency — ideal when you need pixel-perfect graphics with alpha channels for logos, icons, screenshots, or design assets. This tool converts your WebP images to PNG entirely in your browser, with no server upload and no quality loss from re-compression. The conversion uses the native Canvas API to decode the WebP and re-encode as PNG, preserving every detail including transparent regions. This is especially useful for graphic designers and web developers who need to edit images in tools that do not support WebP, or for anyone preparing assets that require lossless quality. Unlike online converters that upload your files to a remote server, this tool processes everything locally on your device, so your images remain completely private. You can convert multiple files in one batch: a single file downloads on its own, and a batch comes down as one ZIP. If you are working with WebP images from a website or CMS and need PNG versions for print or further editing, this tool gets the job done instantly.",
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
    relatedTools: ["jpg-to-png", "png-to-webp", "webp-to-jpg", "heic-to-jpg"],
    aboutText: "PNG files are great for graphics with transparency, but they tend to be much larger than JPGs — especially for photographs. A single PNG photo can easily be 5-10 MB, while the same image as a JPG might be under 1 MB. Converting PNG to JPG can dramatically reduce file size (often 60-80% smaller) while maintaining good visual quality. This makes JPG the better choice for sharing photos by email, uploading to social media, or embedding in documents where transparency is not needed. This tool lets you adjust the compression quality slider to find the perfect balance between file size and image quality. Preview the result before downloading to make sure it meets your standards.",
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
    relatedTools: ["png-to-jpg", "jpg-to-webp", "webp-to-png", "svg-to-png"],
    aboutText: "While JPG is the most common image format, there are times when you need a lossless format like PNG — for example, when editing images that will be re-saved multiple times, when you need transparency support, or when working with graphics that have sharp edges and text. JPG uses lossy compression, which means each time you edit and re-save a JPG, quality degrades slightly. Converting to PNG first preserves the current quality and prevents further degradation during your editing workflow. This tool converts your JPG files to PNG format entirely in your browser using the Canvas API. The resulting PNG is lossless, so no additional quality is lost during conversion. This is particularly useful for designers who need to add transparent backgrounds to photos, developers creating image assets for apps, or anyone preparing images for a workflow that requires lossless formats.",
  },
  {
    name: "JPG to WebP",
    slug: "jpg-to-webp",
    titleTag: "Convert JPG to WebP Online — Smaller Files",
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
    relatedTools: ["png-to-webp", "webp-to-jpg", "webp-to-png", "heic-to-jpg"],
    aboutText: "WebP is a modern image format that provides 25-35% smaller file sizes than JPG at equivalent visual quality. Converting your JPG images to WebP is one of the easiest ways to speed up your website, improve Core Web Vitals scores, or reduce storage and bandwidth usage. All major browsers — Chrome, Firefox, Safari, and Edge — now support WebP, making it a practical replacement for JPG in most web contexts. This tool performs the conversion entirely in your browser using the Canvas API, so no files are uploaded to any server and your images remain completely private. Adjust the quality slider to find the perfect balance between file size and visual fidelity for your specific use case. Web developers will appreciate the significant bandwidth savings, especially for image-heavy pages like portfolios, e-commerce catalogs, and media galleries. Bloggers and content creators can use this tool to optimize hero images and thumbnails before publishing. Batch processing support means you can convert an entire folder of JPGs to WebP in one go, saving time on large projects.",
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
    relatedTools: ["jpg-to-webp", "webp-to-png", "webp-to-jpg", "png-to-jpg"],
    aboutText: "PNG files can be very large, especially for photographs or complex graphics — a single high-resolution PNG can easily exceed 10 MB. WebP offers both lossy and lossless compression that is dramatically more efficient, often producing files 60-80% smaller than PNG while maintaining excellent visual quality. This is particularly impactful for web developers looking to improve page load times, reduce bandwidth costs, and boost Core Web Vitals scores. This tool converts your PNG files to WebP format entirely in your browser, with an adjustable quality slider so you can control the trade-off between file size and quality. For images where transparency is important, WebP supports alpha channels just like PNG, so you do not lose that capability in the conversion. Use cases include optimizing website assets, preparing images for content management systems, and compressing screenshots before sharing. Since all processing runs locally in your browser using the Canvas API, your images are never uploaded to any server. Batch support lets you convert multiple files at once.",
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
    relatedTools: ["jpg-to-png", "webp-to-png", "png-to-jpg", "png-to-webp"],
    aboutText: "SVG (Scalable Vector Graphics) files are resolution-independent and perfect for logos, icons, and illustrations. But many platforms — social media, messaging apps, document editors, and presentation software — require raster formats like PNG. This tool rasterizes your SVG and exports it as a crisp PNG image with full transparency support. The output size comes from the SVG itself: if the document declares its own width and height, those pixels are used as-is; if it only carries a viewBox, the drawing is scaled up until its longest edge is at least 1024 pixels, so a 24x24 icon still rasterizes into something usable rather than a thumbnail. That is a floor and not a target — a viewBox already larger than 1024 units is rasterized at its own size rather than shrunk to fit. There is no resolution control on this page — if you need a specific pixel size, set width and height on the SVG before uploading, or run the PNG through the Image Resizer afterwards. Common use cases include converting logo files for social media profiles, turning icon sets into raster images for app development, and creating raster versions of diagrams or illustrations for print. The tool uses the browser's native SVG rendering engine and Canvas API, so the output matches exactly what you see in your browser.",
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
    relatedTools: ["svg-to-png", "svg-to-webp", "png-to-jpg", "favicon-generator"],
    aboutText: "An SVG is a drawing rather than a picture: it has no pixels until something renders it, and rasterizing is a one-way trip — the JPG that comes back cannot be scaled up again without going soft. This page renders the SVG through the browser's own engine and encodes the result as JPG. The output size comes from the SVG itself, exactly as on the SVG to PNG page: if the document declares its own width and height, those pixels are used as-is; if it carries only a viewBox, the drawing is scaled up until its longest edge is at least 1024 pixels, so a 24x24 icon still rasterizes into something usable. That is a floor rather than a target: a viewBox bigger than 1024 units is left at its own size. There is no resolution control here — set width and height on the SVG before uploading if you need a particular size, or run the JPG through the Image Resizer afterwards. The thing to decide before converting is transparency. JPG has no alpha channel, so every transparent area of the drawing is filled with white before encoding, and a white logo on a clear background comes back as a white rectangle. If the background has to stay clear, use SVG to PNG or SVG to WebP instead. What JPG buys is universal acceptance and a small file for photographic or gradient-heavy artwork, which is still what most upload forms ask for. The SVG is rasterized through an image element and never inlined into this page. Nothing is uploaded.",
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
    relatedTools: ["svg-to-png", "svg-to-jpg", "png-to-webp", "image-to-base64"],
    aboutText: "WebP is what you want when an SVG has to become a raster image for the web and still keep its clear background. The rasterization is the same one the SVG to PNG page does — the browser's own rendering engine draws the document — and so is the sizing rule: a declared width and height are used as-is, and a document carrying only a viewBox is scaled up until its longest edge is at least 1024 pixels. That last number is a floor and never a ceiling, so a 2000 × 1000 artboard rasterizes at 2000 × 1000 rather than being shrunk to fit. There is no resolution control on this page; set the size on the SVG first if you need a specific one. Two things separate this from SVG to PNG. WebP files are usually smaller for the same drawing, and WebP has a lossy mode that PNG does not, which is the quality slider on this page. For flat vector artwork that mode is worth spending carefully: quantization shows up as a faint halo along hard edges and around text, so turn the quality up when the drawing is line work and leave it lower for gradients and illustration. The alpha channel survives either way, so a logo drawn on nothing stays drawn on nothing. Rasterizing is still one-way, so keep the SVG — it is the only version that can be re-rendered at another size. The drawing is rendered through an image element and never inlined into this page's DOM, and nothing is uploaded.",
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
    relatedTools: ["heic-to-jpg", "webp-to-jpg", "png-to-jpg", "jpg-to-webp"],
    aboutText: "AVIF is a cutting-edge image format based on the AV1 video codec, offering exceptional compression — often 50% smaller than JPG at similar quality. Developed by the Alliance for Open Media, AVIF is gaining traction on the web but support is still limited in many desktop applications, image editors, email clients, and older browsers. This tool converts AVIF images to the universally supported JPG format using your browser's native image decoding capabilities. If your browser supports AVIF (Chrome, Firefox, and recent versions of Safari do), the conversion happens instantly with no upload required. This is useful when you have downloaded AVIF images from a website and need to open them in software that only accepts JPG, or when you need to share photos with someone whose device does not support the newer format. The quality slider lets you control the compression level of the output JPG.",
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
    relatedTools: ["avif-to-jpg", "avif-to-webp", "webp-to-png", "png-to-jpg"],
    aboutText: "AVIF is the AV1 codec's still-image format, and it compresses hard — often half the bytes of a JPG at comparable quality. The trade is support: plenty of desktop software, older image editors and internal tools still cannot open one. This page decodes the AVIF with your browser's own decoder and writes the pixels out as PNG. That decoder is the whole story on the input side. Nothing about AVIF is implemented here — Chrome 85+, Firefox 93+ and Safari 16.4+ ship AVIF decoding, and on a browser without it the file simply will not open and the page says so rather than producing something wrong. On the output side PNG is lossless, so nothing is discarded twice: the pixels the AVIF decoder produced are the pixels in the file you download, and an alpha channel comes through intact. That is the reason to choose PNG here rather than JPG, which would flatten transparency onto white and add a second generation of compression. The cost is size. PNG has no lossy mode, so the download will usually be several times larger than the AVIF that produced it — that is the price of not re-compressing. If you want a smaller file and can accept another generation of loss, convert to WebP or JPG instead. Batch conversion is supported, and everything runs in this tab; no file is uploaded.",
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
    relatedTools: ["avif-to-png", "avif-to-jpg", "webp-to-jpg", "jpg-to-webp"],
    aboutText: "AVIF and WebP are both modern formats, so this is not a conversion out of the past — it is a conversion sideways, into the one more software will actually open. WebP has been in every major browser since 2020 and is read by design tools, content systems, chat apps and phone galleries that still show an AVIF as a broken thumbnail. Your browser decodes the AVIF (Chrome 85+, Firefox 93+ and Safari 16.4+ all can) and the Canvas API encodes the WebP. Be clear about what that costs. Both formats are lossy, so what comes back is a second generation: the AVIF is decoded to pixels — artifacts and all — and those pixels are compressed again by a different codec, which cannot recover detail and will add a little of its own. The quality slider governs the second pass only; the first one is already baked into the file you brought. Converting back to AVIF later will not undo any of it. Transparency does survive, because WebP carries an alpha channel, and the pixel dimensions are unchanged. If the destination accepts AVIF, the honest advice is not to convert at all — an AVIF is usually the smaller file. Batch conversion is supported. Everything happens in this tab, and no image is uploaded.",
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
    relatedTools: ["png-to-jpg", "tiff-to-jpg", "webp-to-jpg", "heic-to-jpg"],
    aboutText: "BMP (Bitmap) is an uncompressed image format that produces very large files — a simple photo can be 10-50 MB as a BMP. While BMP preserves every pixel without compression artifacts, the enormous file sizes make it impractical for sharing, uploading, or web use. Converting to JPG typically reduces file size by 90% or more while maintaining good visual quality for photographs. This tool loads your BMP file in the browser, draws it to a Canvas element, and re-exports it as a compressed JPG. No files are uploaded to any server, so your images stay private on your device. Adjust the quality slider to balance file size and image quality — higher quality produces larger files with fewer compression artifacts, while lower quality yields smaller files suitable for thumbnails or previews. Common use cases include converting screenshots from legacy Windows applications, processing scanned documents saved as BMP, and preparing images from older digital cameras that output BMP files. Batch processing is supported so you can convert multiple BMP files at once.",
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
    relatedTools: ["bmp-to-jpg", "png-to-jpg", "tiff-to-png", "compress-png"],
    aboutText: "A BMP stores pixels essentially raw — three or four bytes each, with no compression worth the name — which is why a plain screenshot arrives as tens of megabytes. PNG stores the same pixels and compresses them losslessly, so this is the rare conversion with no trade-off in it: the file gets substantially smaller and not a single pixel changes. That makes it the right conversion for anything where the pixels matter — a screenshot with text in it, a scanned line drawing, an exported interface mock, a sprite sheet out of an old tool. Converting the same BMP to JPG would make it smaller still, but JPG is lossy and puts ringing around every hard edge, which is precisely what this class of image is made of. How much smaller depends entirely on the picture. Flat colour, large blocks and repeated rows compress enormously; a photograph saved as BMP compresses far less, because photographic noise is not redundant. So this page promises no percentage: it shows the byte count before and the byte count after, and you can read the answer for your own file. A BMP carrying an alpha channel keeps it, since PNG has one too. Batch conversion is supported, and the file never leaves this tab.",
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
    relatedTools: ["heic-to-jpg", "bmp-to-jpg", "png-to-jpg", "avif-to-jpg"],
    aboutText: "TIFF (Tagged Image File Format) is widely used in photography, publishing, scanning, and archival because it supports high color depths, multiple layers, and lossless compression. But TIFF files are often very large — sometimes hundreds of megabytes — and are not natively supported by web browsers or many everyday applications. This tool converts TIFF images to the compact, universally supported JPG format using the utif2 library to decode the TIFF data and the Canvas API to re-encode as JPG. Common use cases include converting scanned documents for email or web upload, preparing professional photographs for online sharing, and converting medical or scientific images to a format that can be viewed on any device. The quality slider lets you control the compression level of the output JPG.",
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
    relatedTools: ["tiff-to-jpg", "bmp-to-png", "png-to-jpg", "compress-png"],
    aboutText: "TIFF is what scanners, fax gateways and print workflows write, and a single .tif routinely holds more than one image: a two-sided scan, a multi-page fax, a bracketed exposure set. Safari is the only browser that opens a TIFF on its own; everywhere else nothing happens at all. So this page decodes the file with the utif2 library and re-encodes the result as PNG, identically in every browser rather than leaning on the one that has a decoder. Two things follow, and both are worth knowing before you start. The first is that only the first page comes out. The decoder is asked for page 0, and rather than let a nine-page scan arrive as one image with no explanation, the tool counts the pages the file declares and tells you how many it found. If you need the others, this is not yet the tool for them. The second is what PNG gives you that JPG does not: it is lossless, so the pixels the TIFF decoder produced are written without a second, lossy pass over them, and an alpha channel survives the trip. That is the right choice for a scanned line drawing, a logo lifted out of a print file, or anything with flat colour and hard edges, where JPG's ringing shows immediately. Colour comes out as 8-bit sRGB, so a 16-bit-per-channel TIFF is reduced to 8 bits on the way through. Batch conversion is supported, and everything runs in this tab; the file is never uploaded.",
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
    relatedTools: ["heic-to-jpg", "webp-to-jpg", "compress-image", "exif-viewer"],
    aboutText: "A .jfif file is not a different format that needs converting — it already is a JPEG. JFIF (JPEG File Interchange Format) is the interchange container most JPEGs on disk use; Windows simply saves some downloaded JPEGs under the older .jfif extension. The problem is entirely on the other side: upload forms, CMS validators, and older apps check the file name rather than the bytes, and reject anything that is not .jpg or .jpeg. This tool does the only honest thing possible: it reads your file, verifies the bytes really carry the JPEG SOI marker, and hands the identical bytes back under a .jpg name. Nothing is decoded or re-encoded, so there is zero quality change and every byte of metadata — EXIF, color profile, all of it — survives untouched. You could rename the file yourself in Finder or Explorer and get the same result; what this page adds is the verification, so a mislabeled PNG or WebP wearing a .jfif name is caught here instead of failing somewhere less helpful. If the bytes are not JPEG, the tool refuses and says so rather than shipping a broken .jpg. Everything runs in your browser — the file never leaves your device.",
  },

  // ── Image Compressor ──────────────────────────────────────────────
  {
    name: "Image Compressor",
    slug: "compress-image",
    titleTag: "Compress Images Online — Free & Private",
    category: "image-tools",
    toolType: "image-compress",
    description: "Compress JPG, PNG, and WebP images by quality or to a target file size in KB. Smart binary search picks the best quality automatically.",
    hubLine: "By quality, or to an exact target in KB.",
    keywords: ["compress image", "image compressor", "reduce image size", "compress jpg", "compress png", "image optimizer"],
    h1: "Compress Images Online — Free, No Upload Required",
    subtitle: "Reduce image file size with quality or target-size compression — entirely in your browser.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp,.gif",
    relatedTools: ["compress-image-to-100kb", "compress-image-to-200kb", "compress-image-to-1mb", "resize-image", "compress-image-to-target-size", "compress-image-to-500kb"],
    aboutText: "Need to reduce your image file size for email, web upload, or social media? This tool compresses your images entirely in your browser — no upload to any server, ensuring your photos remain completely private. Choose between two compression modes: quality-based compression, where you adjust a slider to control the output quality, or target-size compression, where you specify an exact file size like 100 KB or 1 MB and the tool iteratively adjusts quality to hit your target as closely as possible. Supports JPG, PNG, WebP, AVIF, BMP, and GIF input formats. When an animated GIF is re-encoded, the output is a still of its first frame — and the result says so whenever that happens. Batch mode lets you compress multiple images at once, saving time when optimizing an entire gallery or folder of photos. Whether you need to meet a file size requirement for an online form, optimize images for faster website loading, reduce attachment sizes for email, or fit photos within social media upload limits, this compressor handles it all. The compression algorithm uses binary search to find the optimal quality level, giving you the best possible image quality within your size constraint.",
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
    relatedTools: ["compress-image", "compress-image-to-200kb", "compress-image-to-1mb", "resize-image", "compress-image-to-50kb", "resize-image-to-100kb"],
    aboutText: "Many websites, email providers, and online forms have a 100 KB file size limit for image uploads. Government portals, job application forms, university admissions, and ID photo submissions commonly require images under 100 KB. This tool compresses your image to fit under 100 KB by iteratively adjusting quality using a binary search algorithm until the target is reached, giving you the best possible visual quality within the size constraint. Everything runs in your browser — your images are never uploaded to any server, which is especially important when compressing sensitive documents like ID photos or personal documents. The tool supports JPG, PNG, WebP, AVIF, and BMP input formats. You can preview the compressed result before downloading to make sure it meets your quality standards. The tool lowers encoder quality first; if quality alone cannot get a very large photo under 100 KB, it also scales the image down in bounded steps, and the result tells you the new dimensions whenever that happens. Batch processing is available for compressing multiple images at once.",
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
    relatedTools: ["compress-image", "compress-image-to-100kb", "compress-image-to-1mb", "resize-image", "compress-image-to-500kb"],
    aboutText: "Need your image under 200 KB? Many platforms, application forms, and content management systems cap file uploads at 200 KB. This is a common limit for profile photos, forum avatars, online listings, and document attachments. This tool compresses your image to fit within that limit by using a binary search algorithm to find the optimal quality level — giving you the best visual result that still meets the size requirement. The compression happens entirely in your browser using the Canvas API, so no files are uploaded anywhere and your images remain completely private. Works with JPG, PNG, WebP, AVIF, and BMP input files. You can preview the compressed output before downloading to verify it looks good. The tool lowers encoder quality first and scales the image down only when quality alone cannot fit a very high-resolution source under 200 KB — the result notes the new dimensions whenever that happens. If you want exact control over the output dimensions, resize it first with the Image Resizer. This is perfect for preparing images for email signatures, online marketplaces, forum profiles, and any platform with a 200 KB upload restriction. Batch processing is supported.",
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
    relatedTools: ["compress-image", "compress-image-to-100kb", "compress-image-to-200kb", "resize-image", "compress-image-to-500kb"],
    aboutText: "Social media platforms, messaging apps, and many websites limit image uploads to 1 MB. This is a common restriction on platforms like WhatsApp, Slack, Discord, and various web forums. This tool compresses your image to fit under 1 MB while preserving as much quality as possible, using a binary search algorithm to find the optimal compression level that maximizes visual quality within the size constraint. The 1 MB limit is generous enough that most photos will retain excellent quality after compression. This tool supports JPG, PNG, WebP, AVIF, and BMP input formats. You can preview the result before downloading and see the exact output file size. All processing runs locally in your browser — your images stay on your device and are never uploaded to any server. This makes it safe for compressing personal photos, screenshots with sensitive information, or any images you prefer to keep private. Batch processing lets you compress multiple images at once.",
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
    relatedTools: ["resize-image-to-20kb", "compress-image-to-50kb", "compress-image-to-100kb", "compress-image"],
    aboutText: "Signature and photo uploads on exam registrations and government portals carry some of the strictest ceilings on the web — often 10 to 20 KB for a signature and 20 to 50 KB for a photo. This tool compresses your image to a 20 KB target right in your browser: encoder quality is binary-searched first, and because 20 KB is genuinely tiny — a full-resolution phone photo cannot get there at any quality — the engine also scales large images down in bounded steps, each between 50% and 90% of the current size and never below 64 px on the longest side. Whenever that happens, the result tells you the new dimensions, so nothing changes silently. Expect a photograph to come out a few hundred pixels on its longest side at this target; a small scan or signature crop may fit with no downscale at all. Opaque images are saved as JPG, images with transparency as WebP so the transparency survives. Nothing is uploaded — which matters for ID photos and signatures — and if re-encoding cannot beat your original, you get the original back unchanged.",
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
    relatedTools: ["compress-image-to-20kb", "compress-image-to-100kb", "resize-image-to-50kb", "compress-image"],
    aboutText: "A 50 KB cap turns up on exam registration portals, ID photo uploads, visa applications, and older content management systems. This page preloads the compressor with a 50 KB target: a binary search runs up to ten encode passes to find the highest quality that fits, and stops refining once a result lands within 5% of the ceiling — so a typical output sits just under 50 KB rather than far below it. For photos around 800 to 1200 px on the long side, 50 KB usually holds respectable quality; a much larger photo is scaled down in bounded steps first, and the result reports the new dimensions whenever that happens. The 50 KB figure is just this page's preloaded default — you can type any target into the size field. Everything runs in your browser, so ID photos and application documents never leave your device. Drop in several files at once and they compress in parallel across a pool of workers, downloading together as a single ZIP.",
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
    relatedTools: ["compress-image-to-200kb", "compress-image-to-1mb", "compress-image-to-target-size", "compress-image"],
    aboutText: "Half a megabyte is the comfortable end of the KB ladder: content management systems, marketplace listings, forum attachments, and many email gateways cap images around 500 KB, and most photographs fit under it with little visible loss. This tool binary-searches encoder quality for the largest result at or under 500 KB — photos up to roughly 3000 px on the long side typically pass without any downscaling, and only a truly enormous source would trigger the bounded dimension-stepping, which the result would disclose with its new width and height. The output is JPG for opaque images and WebP when the source has transparency, so logos and cut-outs keep their alpha channel. Every result is checked against your original: if re-encoding cannot produce a smaller file, you get your original back unchanged — a compressor should never grow a file. Batch mode compresses multiple images in parallel across a pool of workers and bundles them into a single ZIP. All of it runs locally in your browser; nothing is uploaded to any server.",
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
    relatedTools: ["compress-image", "compress-image-to-100kb", "compress-image-to-500kb", "photo-resizer-in-kb"],
    aboutText: "Every other page on this ladder preloads a specific number; this one is for the limit those pages don't cover. The target field accepts anything from 10 KB to 10,240 KB (10 MB) — type the exact figure a form demands, or tap one of the 50 KB, 100 KB, 200 KB, 500 KB, or 1 MB presets. The page opens with 200 KB preloaded purely so the field isn't empty: it is a starting point, not a limit, and any target you type replaces it. Under the hood a binary search runs up to ten encode passes toward the highest quality at or under your target, stopping once a result lands within 5% of the ceiling. If quality alone cannot reach a small target, the image is scaled down in bounded steps — never below 64 px on the longest side — and the result reports the new dimensions whenever that happens. If nothing beats your original, the original comes back unchanged. Opaque images come out as JPG, transparent ones as WebP. All processing happens in your browser; your images are never uploaded to any server.",
  },

  // ── Image Resizer ──────────────────────────────────────────────────
  {
    name: "Image Resizer",
    slug: "resize-image",
    titleTag: "Resize Images Online — Quality Resampling",
    category: "image-tools",
    toolType: "image-resize",
    description: "Resize images to exact dimensions or social media presets (Instagram, Twitter, LinkedIn). Lanczos3 resampling preserves sharpness.",
    hubLine: "Exact pixel dimensions, aspect ratio preserved.",
    keywords: ["resize image", "image resizer", "resize photo", "change image size", "image dimensions"],
    h1: "Resize Images Online — Free, High-Quality Resampling",
    subtitle: "Resize to exact dimensions or social media presets with Lanczos3 quality.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp,.gif",
    relatedTools: ["compress-image", "crop-image", "jpg-to-png", "png-to-webp", "resize-image-to-50kb", "photo-resizer-in-kb"],
    aboutText: "Need to resize an image for social media, a website, or a specific pixel size? This tool uses Lanczos3 resampling (via the pica library) for the highest-quality downscaling and upscaling — producing sharp, clean results without the blurriness or aliasing artifacts that basic resizing methods create. Choose from six presets — Instagram Post (1080x1080), Instagram Story (1080x1920), Twitter Header (1500x500), LinkedIn Banner (1584x396), Passport Photo (600x600), and YouTube Thumbnail (1280x720) — or enter custom dimensions with an optional aspect ratio lock to prevent distortion, or scale the original by a percentage. Whether you are preparing product images for an online store, creating consistently sized thumbnails for a blog, or formatting photos to meet a specific platform's requirements, this tool handles it in seconds. The aspect ratio lock ensures your images are never stretched or squished. Everything runs in your browser with no upload required, so your images remain completely private. Supports JPG, PNG, WebP, AVIF, BMP, and GIF input formats.",
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
    relatedTools: ["compress-image-to-20kb", "resize-image-to-50kb", "photo-resizer-in-kb", "resize-image"],
    aboutText: "To be upfront about what this page does: it runs Transmute's target-size compressor, not a dimension picker. You do not choose output dimensions here — the tool lowers encoder quality first, and scales the image down in bounded steps only when no quality setting can reach 20 KB at the current size. Each step lands between 50% and 90% of the previous dimensions, never below 64 px on the longest side, and whenever a downscale produced the final file, the result says exactly what happened: 'Scaled to width×height to reach the target size.' At a target this small, that disclosure is the rule rather than the exception — a full-resolution photo cannot reach 20 KB at any quality, so expect the output to be a few hundred pixels on its longest side. That is usually exactly what a signature or thumbnail upload field wants. If you need specific pixel dimensions instead of a byte ceiling, use the Image Resizer. Everything runs locally in your browser, and the output is never larger than your original file.",
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
    relatedTools: ["resize-image-to-20kb", "resize-image-to-100kb", "compress-image-to-50kb", "resize-image"],
    aboutText: "Despite the name, this tool does not ask you for pixel dimensions — it reduces file size, which is what a '50 KB' requirement actually measures. Encoder quality is binary-searched first at your image's existing dimensions; only when quality alone cannot reach 50 KB does the engine step the dimensions down, in bounded passes of 50% to 90% at a time with a hard floor of 64 px on the longest side — and the result reports the new dimensions whenever that happens, so a changed picture is never a silent one. Photos around 1000 px on the long side usually reach 50 KB on quality alone; a big phone photo will be scaled, and the result will say to what size. Opaque images come out as JPG, transparent ones as WebP so the transparency survives, and every result is compared against your original — if re-encoding can't do better, you get your original file back untouched. For exact output dimensions, use the Image Resizer instead. All processing runs in your browser; your photos never leave your device.",
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
    relatedTools: ["resize-image-to-50kb", "compress-image-to-100kb", "photo-resizer-in-kb", "resize-image"],
    aboutText: "A '100 KB photo' requirement is a file-size requirement, so this page runs Transmute's target-size compression engine: a binary search over encoder quality — up to ten passes, stopping once a result lands within 5% of the ceiling — finds the best quality at or under 100 KB at your image's current dimensions. Dimensions change only when they must: if no quality level can reach the target, the image steps down in bounded increments until it fits, and the result reports the new width and height whenever that happens. You never pick output dimensions on this page — if that is what you need, the Image Resizer does exact pixels, and the two combine well: resize first, then meet the byte ceiling here. Most photos up to about 1500 px on the long side reach 100 KB on quality alone. Drop in a whole batch and the files compress in parallel across a worker pool, arriving as one ZIP. Everything runs locally in your browser — nothing is uploaded, which matters for the ID photos and application documents this limit usually applies to.",
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
    relatedTools: ["resize-image-to-100kb", "resize-image-to-20kb", "compress-image-to-target-size", "resize-image"],
    aboutText: "Exam registration portals and government forms — Indian government sites are the best-known examples — specify photo and signature uploads in kilobytes: 20 KB, 50 KB, 100 KB, sometimes an exact range. This page is built for exactly that: type whatever KB figure your form demands, anything from 10 to 10,240 KB, or tap a preset, and the tool finds the best quality that fits. It opens preloaded with 100 KB, the most common ceiling in this family of forms — change it freely. To be clear about the mechanism, 'resizing in KB' is file-size compression: quality is lowered first, and pixel dimensions shrink in bounded steps only when quality alone cannot reach your number — never below 64 px on the longest side — with the result reporting the new dimensions whenever a downscale happened. The output is never larger than your original. For a form that also demands exact pixel dimensions, run the photo through the Image Resizer first, then bring it here for the KB ceiling. Everything runs in your browser; photos and signatures never leave your device.",
  },

  // ── Image Cropper ──────────────────────────────────────────────────
  {
    name: "Image Cropper",
    slug: "crop-image",
    titleTag: "Crop Images Online — Free Interactive Tool",
    category: "image-tools",
    toolType: "image-crop",
    description: "Crop images visually with interactive handles, aspect ratio presets, and rotation. Save the result as PNG, JPG or WebP — PNG by default.",
    hubLine: "Drag a region, pick PNG, JPG or WebP.",
    keywords: ["crop image", "image cropper", "crop photo online", "free image crop tool"],
    h1: "Crop Images Online — Free, Interactive Cropping Tool",
    subtitle: "Crop images with drag handles, aspect ratio presets, and rotation.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp,.gif",
    relatedTools: ["resize-image", "compress-image", "jpg-to-png", "png-to-webp"],
    aboutText: "This interactive image cropper lets you select exactly the area you want to keep with a visual drag-and-drop interface. Drag the crop handles to adjust the selection, or choose an aspect ratio preset — Free, 1:1 (perfect squares for profile photos), 4:3 (standard photos), 16:9 (widescreen and presentations), or 3:2 (classic photography). You can also rotate the image before cropping to straighten tilted photos or create a different composition. The result is saved at full resolution in the format you choose — PNG by default, or JPG or WebP with a quality slider — preserving all the detail in your selected area. PNG and WebP both carry an alpha channel, so the transparent corners a rotated crop leaves stay transparent; JPG cannot, so those areas are filled with white before encoding, and the result says so when that has happened. Common use cases include cropping photos for social media profiles, extracting a specific section from a screenshot, preparing product images with consistent dimensions, and removing unwanted edges from scanned documents. The tool supports JPG, PNG, WebP, AVIF, BMP, and GIF input formats. Everything runs entirely in your browser — no upload, no server processing, and no risk of your images being stored by a third party. This makes it safe for cropping personal photos, confidential screenshots, and sensitive documents.",
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
    relatedTools: ["compress-image", "resize-image", "crop-image", "jpg-to-png"],
    aboutText: "Every photo you take contains hidden metadata called EXIF data — camera model, lens, shutter speed, ISO, GPS coordinates, date and time, software version, and more. While this metadata is invaluable for photographers managing their workflow, it can be a serious privacy concern when sharing photos online. GPS coordinates can reveal your exact location, and timestamps can expose your daily patterns. This tool displays all EXIF metadata in a clean, organized table, grouped so you can see exactly what a photo carries: camera and image tags, GPS location, IPTC, XMP, and the colour profile. It also lets you download a clean copy with the metadata stripped, protecting your privacy before sharing on social media, forums, or messaging apps. The stripping works by decoding the picture and re-encoding it through the Canvas API, which is what leaves the metadata behind — but a re-encode builds a new image rather than cutting the tags out of your original bytes, and the difference is worth knowing. JPEG output is recompressed at 92% quality, so it gives up a little detail; the colour profile embedded in your file is not carried over, because the canvas works in sRGB and that is what comes out; anything deeper than 8 bits per channel is reduced to 8; an animated PNG or WebP keeps only its first frame; and a multi-page TIFF keeps only its first page. PNG stays PNG and WebP stays WebP, but HEIC, HEIF and TIFF come back as JPEG, because no browser can write those containers from a canvas. When the output is a JPEG the tool then sweeps every APP1 segment out of the encoded bytes, because Safari writes a fresh Exif block of its own into JPEGs it encodes and a re-encode on its own would not be the guarantee this page sells. Keep the original if you need the pixels untouched, and share the cleaned copy. You can also use this tool to check the camera settings behind a great shot, verify when a photo was taken, or inspect technical details for troubleshooting. Supports JPG, PNG, WebP, TIFF, and HEIC formats.",
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
    relatedTools: ["compress-image", "resize-image", "png-to-jpg", "svg-to-png"],
    aboutText: "Need to embed an image directly in your HTML, CSS, or JSON without a separate file? Base64 encoding converts binary image data into a text string that can be included inline in your code, eliminating the need for a separate HTTP request to load the image. This tool converts any image to a Base64-encoded data URI that you can paste directly into your source code. The output includes the full data:image/... prefix ready for use in img tags, CSS background-image properties, or JSON payloads. This is particularly useful for embedding small icons, logos, and UI elements directly in HTML emails (where external images are often blocked), single-file HTML documents, CSS stylesheets, and API responses that include image data. Copy the entire data URI to your clipboard with one click. The tool also shows the encoded string length so you can gauge the impact on your file size — keep in mind that Base64 encoding increases the data size by roughly 33%. Supports JPG, PNG, WebP, GIF, SVG, BMP, and AVIF formats.",
  },

  // ── PNG to ICO ─────────────────────────────────────────────────────
  {
    name: "PNG to ICO",
    slug: "png-to-ico",
    titleTag: "Convert PNG to ICO — Favicons Instantly",
    category: "image-tools",
    toolType: "png-to-ico",
    description: "Convert PNG images to ICO format for website favicons. Generates multi-size ICO files (16, 32, 48 px) compatible with every browser.",
    hubLine: "Multi-size Windows icon from one PNG.",
    keywords: ["png to ico", "favicon converter", "ico converter", "create favicon", "png to icon"],
    h1: "Convert PNG to ICO Online — Create Favicons Instantly",
    subtitle: "Turn any PNG into a multi-size ICO favicon file.",
    acceptFormats: ".png",
    relatedTools: ["favicon-generator", "svg-to-png", "resize-image", "compress-image"],
    aboutText: "ICO files are the standard format for website favicons — the small icon shown in browser tabs, bookmarks, and Windows shortcuts. While modern browsers accept PNG favicons, the ICO format remains essential for compatibility with older browsers, Windows desktop shortcuts, and certain platforms that specifically require .ico files. This tool converts your PNG image into a proper ICO file containing multiple sizes (16x16, 32x32, and 48x48) packed into a single file, following the ICO format specification. The tool automatically resizes your source image to each required dimension using high-quality resampling, so you only need to upload one image. For best results, start with a square PNG at 48x48 pixels or larger. Common use cases include creating favicons for websites, generating icons for Windows applications, and preparing shortcut icons for desktop tools.",
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
    relatedTools: ["png-to-ico", "svg-to-png", "resize-image", "compress-image"],
    aboutText: "Modern websites need favicons in multiple sizes to look sharp across every platform and device: 16x16 and 32x32 for browser tabs, 48x48 for Windows shortcuts, 180x180 for Apple Touch icons on iOS, and 192x192 plus 512x512 for Progressive Web App (PWA) manifests. Creating all these sizes manually is tedious and error-prone. This tool generates every required size from a single image upload, resizing with high-quality resampling to ensure crisp results at each dimension. All generated icons are packaged in a convenient ZIP file with the correct filenames, ready to drop into your project. The tool also generates the HTML link tags you need to add to your page head section, saving you from looking up the correct markup. Whether you are launching a new website, updating branding across an existing site, or setting up a PWA, this tool handles the entire favicon workflow in seconds. For best results, upload a square image at 512x512 pixels or larger.",
  },

  // ── Color Palette Extractor ────────────────────────────────────────
  {
    name: "Image Color Palette",
    slug: "image-color-palette",
    titleTag: "Extract a Color Palette from Any Image",
    category: "image-tools",
    toolType: "color-palette",
    description: "Extract the dominant colors from any image using median-cut quantization. Copy hex codes to the clipboard for design, branding, or CSS work.",
    hubLine: "Dominant colours as hex, sorted by weight.",
    keywords: ["image color palette", "extract colors from image", "dominant colors", "color picker from image"],
    h1: "Extract Color Palette from Image — Free & Instant",
    subtitle: "Upload an image and get its dominant colors with hex codes.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp,.gif",
    relatedTools: ["compress-image", "resize-image", "exif-viewer", "image-to-base64"],
    aboutText: "Want to know the dominant colors in an image? This tool analyzes your image using median-cut color quantization and extracts the most prominent colors, presenting them as a visual palette. Each color is shown as a swatch with its hex code and its share of the image, alongside a combined bar that weights every color by how much of the picture it covers. This is an invaluable resource for designers who want to build a cohesive color scheme from a photograph, brand reference image, or inspiration photo. Use the extracted palette to guide website designs, create matching social media graphics, choose paint colors inspired by a photo, or ensure brand consistency across materials. Click any color swatch to instantly copy its hex code to your clipboard, or copy the whole palette at once, ready to paste into your design tool or CSS. The tool works with JPG, PNG, WebP, AVIF, BMP, and GIF images.",
  },

  // ── Image Edit Verbs ───────────────────────────────────────────────
  {
    name: "Rotate Image",
    slug: "rotate-image",
    titleTag: "Rotate an Image Online — Free, No Upload",
    category: "image-tools",
    toolType: "rotate-image",
    description: "Rotate a photo 90°, 180°, or 270° in your browser and save it as PNG, JPG, or WebP. The turn lands on the picture your phone already shows you.",
    hubLine: "A quarter turn, a half turn, or the other quarter.",
    keywords: ["rotate image", "rotate photo online", "turn image 90 degrees", "free image rotator", "rotate picture 180"],
    h1: "Rotate an Image Online — 90°, 180° or 270°",
    subtitle: "Turn a picture a quarter, a half, or three quarters and save it as PNG, JPG or WebP.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp,.gif",
    relatedTools: ["flip-image", "crop-image", "add-border", "resize-image", "exif-viewer"],
    aboutText: "Rotating a photo in a browser sounds trivial until you meet the orientation tag. A picture taken on a phone is usually stored sideways with an EXIF Orientation flag telling viewers how to turn it, and the browser's decoder applies that flag before this page ever sees a pixel. So the turn you ask for composes on top of the picture as you already see it: the preview, the dimension readout and the download all describe the same image, which is the only arrangement you can check by eye. Choose a quarter turn right, a half turn, or a quarter turn left; the page shows the resulting dimensions before you run it, because a quarter turn swaps the sides. Output can be PNG, JPG or WebP, and it starts on whatever your source was, so a JPEG does not come back several times larger. This is a pixel rotation, not a metadata edit — the image is decoded, redrawn and re-encoded, EXIF and GPS are not carried through, and colour is written as sRGB. Everything runs in this tab; no file is uploaded.",
  },
  {
    name: "Flip Image",
    slug: "flip-image",
    titleTag: "Flip an Image Online — Free Mirror Tool",
    category: "image-tools",
    toolType: "flip-image",
    description: "Mirror a picture left to right or top to bottom in your browser, then save it as PNG, JPG, or WebP. Nothing is cropped and nothing is uploaded.",
    hubLine: "Mirror it left-to-right or top-to-bottom.",
    keywords: ["flip image", "mirror image online", "flip photo horizontally", "free image flipper", "flip picture vertically"],
    h1: "Flip an Image Online — Horizontal or Vertical Mirror",
    subtitle: "Mirror a picture left to right or top to bottom and save it as PNG, JPG or WebP.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp,.gif",
    relatedTools: ["rotate-image", "crop-image", "add-border", "resize-image", "compress-image"],
    aboutText: "A flip is a mirror, not a turn: horizontal swaps left and right, vertical reflects the picture in its own horizon. Neither moves an edge, so the file you get back has exactly the dimensions of the file you dropped — which is why this page can show the mirror on the canvas before anything is processed, and does. The same orientation rule applies as on the rotate page: a phone photo's EXIF Orientation tag has already been read and applied by the browser's decoder, so the mirror composes on top of the picture as displayed rather than on some hidden version underneath it. Output can be PNG, JPG or WebP and starts on the format you brought, so a JPEG does not come back several times larger as a PNG. Flipping here is a pixel operation, not a metadata edit — the image is decoded, redrawn and re-encoded, EXIF and GPS are not carried through, and colour is written as sRGB. Everything runs in this tab; no file is uploaded.",
  },
  {
    name: "Add Border to Image",
    slug: "add-border",
    titleTag: "Add a Border to an Image — Free Online Tool",
    category: "image-tools",
    toolType: "add-border",
    description: "Add a solid coloured border to an image — one width on every edge, or a width per edge — and read the exact output size before you save it.",
    hubLine: "One width on every edge, or a width per edge.",
    keywords: ["add border to image", "image border online", "add frame to photo", "picture border tool", "white border for instagram"],
    h1: "Add a Border to an Image — Any Colour, Any Edge",
    subtitle: "Paint a solid frame around a picture: one width on every edge, or a different width per edge.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp,.gif",
    relatedTools: ["crop-image", "resize-image", "rotate-image", "flip-image", "compress-image"],
    aboutText: "A border here is pure addition. The canvas is made larger than your picture, filled with the colour you choose, and your image is drawn whole inside it — nothing is cropped, nothing is scaled, and every pixel of the original is still an original pixel. Because the arithmetic is the one thing you cannot check by eye, the page writes it out: an 800 × 600 photo with 20 pixels on every edge becomes 840 × 640, and that line updates as you type. The edges start linked, so a single number frames the whole picture; break the link and Top, Right, Bottom and Left each take their own width, which is what a caption strip or an off-centre matte needs. The colour is a six-digit hex, typed or picked from the swatch. Output can be PNG, JPG or WebP and starts on the format you brought. The image is decoded, redrawn and re-encoded, so EXIF and GPS are not carried through and colour is written as sRGB. Everything runs in this tab; no file is uploaded.",
  },
  {
    name: "Image Watermarker",
    slug: "watermark-image",
    titleTag: "Watermark Images Online — Free Browser Tool",
    category: "image-tools",
    toolType: "watermark-image",
    description: "Add a text watermark to any image, right in your browser. Set the position, size, opacity, colour and rotation, and watch a live preview as you go.",
    hubLine: "Type it, place it, and see it before you save.",
    keywords: ["watermark image", "add watermark to photo", "image watermark online", "free watermark tool", "tiled watermark"],
    h1: "Add a Watermark to Images Online — Free and Private",
    subtitle: "Draw a text watermark into an image, with a live preview before you save.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.bmp,.gif,.avif",
    relatedTools: ["pixelate-image", "crop-image", "resize-image", "add-border", "compress-image"],
    aboutText: "This watermarker draws a line of text into the pixels of your image and hands back a new file. Type the text, pick one of six positions — the four corners, the centre, or tiled across the whole picture — and set its size as a share of the shorter edge, so the mark keeps its proportions whatever the image measures. Opacity, colour and rotation are yours too, and the preview redraws on every change, so nothing is a surprise at download time. Output is PNG, JPG or WebP; JPG cannot carry an alpha channel, so a source with transparency is filled with white before the text goes on, and the tool checks the decoded image and says so before it runs. Be clear about what a drawn watermark is: it becomes part of the picture, which is why it survives re-saving, screenshots and a format change — and equally why anyone can crop it off, clone it out or paint over it. It is a visible credit and an obstacle, not protection. Everything runs in this tab, and the image is never uploaded.",
  },
  {
    name: "Image Pixelator",
    slug: "pixelate-image",
    titleTag: "Pixelate Images Online — Free Browser Tool",
    category: "image-tools",
    toolType: "pixelate-image",
    description: "Pixelate a whole image or just one region of it in your browser. Drag to pick the area, choose a block size, and save as PNG, JPG or WebP.",
    hubLine: "Cover one region in blocks — or the whole picture.",
    keywords: ["pixelate image", "pixelate part of a photo", "pixelate face in photo", "censor image online", "free pixelate tool"],
    h1: "Pixelate an Image, or Just One Region of It",
    subtitle: "Cover a face, a plate or a code in blocks — with the region measured in the image's own pixels.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.bmp,.gif,.avif",
    relatedTools: ["watermark-image", "crop-image", "exif-viewer", "resize-image", "compress-image"],
    aboutText: "This pixelator replaces the detail in an image with flat blocks. Drag a rectangle on the preview to cover one part of the picture — a face, a number plate, a code in a screenshot — or leave the region alone and the whole image is pixelated. The rectangle is held in the image's own pixels rather than the screen's, so the X, Y, Width and Height fields always read what the engine will actually use, however the preview happens to be scaled to fit. Block size is yours to set, and the output is PNG, JPG or WebP. One thing has to be said plainly: this is not redaction. The blocks are baked into the downloaded file, so the detail underneath really is gone — but when what was covered comes from a small, known set, such as a six-digit code or a date, someone can re-render every candidate at the same block size and compare it against your blocks. If something must stay secret, crop it out rather than pixelate it. Everything runs in this tab, and the image is never uploaded.",
  },
  {
    name: "Circle Image Cropper",
    slug: "crop-circle",
    titleTag: "Crop an Image Into a Circle — Free Online Tool",
    category: "image-tools",
    toolType: "crop-circle",
    description: "Crop any image into a circle with transparent corners. Position and size the circle, then save it as a PNG or WebP — JPEG cannot hold transparency.",
    hubLine: "A circle with transparent corners, saved as PNG or WebP.",
    keywords: ["crop image into circle", "circle crop", "circular image cropper", "round profile picture", "circle photo cropper"],
    h1: "Crop an Image Into a Circle — Free, In Your Browser",
    subtitle: "Position the circle over the part you want, then save it as a PNG or WebP with transparent corners.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp,.gif",
    relatedTools: ["crop-image", "resize-image", "png-to-webp", "favicon-generator", "compress-image"],
    aboutText: "This tool cuts a circle out of an image and leaves everything outside it transparent. Drop a picture in, set the Diameter slider — it is measured against the shorter edge, so 100% is the largest circle the picture can hold — and use the Horizontal and Vertical controls to move that circle over the part you want. The ring drawn on the preview is computed from the same three numbers the engine is sent, so what you position is what gets cut. Output is PNG or WebP and deliberately nothing else: JPEG has no alpha channel, so a circle written as a JPEG is a circle painted on a white square, which is not what anyone means. One thing worth knowing before you download: the file is still a rectangle. Every raster image format is. The corners are transparent rather than absent, so the result looks like a circle wherever transparency is honoured — a website, a slide, a profile picture that gets masked round anyway — and like a square on a viewer that paints its own background behind it. Common uses are round avatars, circular logos, badge images and stickers. Everything runs in this tab: the picture is decoded, drawn and re-encoded on your own machine, and nothing is uploaded.",
  },
  {
    name: "Image Splitter",
    slug: "image-splitter",
    titleTag: "Split an Image Into a Grid — Free Online Tool",
    category: "image-tools",
    toolType: "image-splitter",
    description: "Split one image into a grid of up to 10 rows by 10 columns. The tiles add up to the original exactly and come down together as a ZIP file.",
    hubLine: "Rows and columns, and the tiles add up exactly.",
    keywords: ["split image", "image splitter", "cut image into grid", "instagram grid maker", "image tile cutter"],
    h1: "Split an Image Into a Grid of Tiles",
    subtitle: "Cut one picture into rows and columns. Save any tile on its own, or take the whole grid as a ZIP.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp,.gif",
    relatedTools: ["crop-image", "resize-image", "social-media-image-resizer", "compress-image", "create-zip"],
    aboutText: "This tool cuts one picture into a grid of separate image files — the nine squares of an Instagram carousel, the strips of a printable poster, the pieces of a sliding puzzle. Type the number of rows and columns you want, up to ten of each, press Split, and every tile appears as its own file. Click a tile to save it alone, or take the whole grid as a single ZIP. The part worth checking is the arithmetic, and the page prints it: under the grid you will see the tile widths added up term by term against the source's own width, and the heights likewise. A picture that does not divide evenly is not padded, stretched or trimmed — the leftover pixels are handed out one per tile, so a 1000-pixel width across three columns comes out as 333 + 334 + 333, and the sum on screen says so. Reassembled, the tiles are the original picture with no seam and no missing strip. Tiles are named after their position, row-major, so photo-r2c3.png is the third tile in the second row and a file browser sorts them back into reading order. Everything happens in this tab; the picture is never uploaded.",
  },
  {
    name: "Social Media Image Resizer",
    slug: "social-media-image-resizer",
    titleTag: "Social Media Image Resizer — Free Online Tool",
    category: "image-tools",
    toolType: "social-media-image-resizer",
    description: "Resize one picture into several social frame sizes at once — square, story, link card and more. Crop to fill or pad to fit, all in your browser.",
    hubLine: "One picture, several named frame sizes at once.",
    keywords: ["social media image resizer", "instagram image size", "story image resizer", "open graph image size", "resize image for social"],
    h1: "Resize an Image for Social Media",
    subtitle: "Write one picture out to several named frame sizes at once, cropped to fill or padded to fit.",
    acceptFormats: ".jpg,.jpeg,.png,.webp,.avif,.bmp,.gif",
    relatedTools: ["resize-image", "crop-image", "compress-image", "image-splitter", "crop-circle"],
    aboutText: "One picture, several frame sizes, one run. Pick the frames you want from the grid — a 1080 × 1080 square, a 1080 × 1920 story, a 1200 × 630 link card, a 1280 × 720 video thumbnail and more — and each is written as its own file. The pixel dimensions on each card are facts: they are exactly what this tool is asked to write, and the output proves them. The platform names beside them are only what a size is commonly used for. This page is a static file and cannot check anything against a platform today, so it does not claim to: if a network's requirement matters for what you are posting, check it there. Cover fills each frame edge to edge and crops whatever does not fit, which is the setting that loses parts of the picture; Contain fits the whole picture inside the frame and fills the space left over with a colour you choose. Each card previews the framing your current setting produces, so you can see what a story crop is about to cut before you run it. If a frame is bigger than your picture, the page says which ones and warns that those files are enlarged and will look softer. Everything runs in this tab and nothing is uploaded.",
  },

  // ── PNG Optimizer ──────────────────────────────────────────────────
  {
    name: "Compress PNG",
    slug: "compress-png",
    titleTag: "Compress PNG Losslessly — Free & Private",
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
    relatedTools: ["png-to-webp", "png-to-jpg", "compress-image", "resize-image", "png-to-ico"],
    aboutText: "Re-encoding a PNG through a canvas is not compression: the Canvas API has no compression level, no filter strategy and no palette knob anywhere in it, so a picture decoded to pixels and written back out often comes back larger than it went in. That round trip is not what happens here. This page runs oxipng 9.1.1, compiled to WebAssembly and served from this site, which searches PNG filter strategies and re-deflates the image data. Nothing is re-drawn, so every pixel comes out identical. How much you save depends entirely on what wrote the file. A PNG exported by a browser, a screenshot tool or a design app typically comes down 20–35% — measured at 31.5% on this site's own 1200 × 630 Chromium-rendered social image at level 2, and 35.2% at level 4. A PNG that has already been through pngcrush, oxipng or an exporter set to maximum compression comes down 0–3%, and in that case oxipng hands your file straight back byte for byte; the page says so plainly instead of pretending to have done work. A photograph saved as PNG is the worst case, measured at 8.5–9.6%, and the honest answer there is to convert it to WebP or JPEG rather than to squeeze the PNG. Effort levels 1 to 4 are offered and 5 and 6 are not, because they were measured returning byte-identical output to level 4 for roughly twice the time. Level 2 is the default: it does most of the work for a fraction of the wait. One optional switch rewrites fully-transparent pixels, which is the only thing on this page that changes a pixel value — and only pixels whose alpha is zero, which nothing can display. Input is capped twice, because the heap tracks the decoded picture and not the file on disk: 12 megapixels, and 48 MB of decoded raster. Depth costs what a pixel count cannot see — two real 4000 × 3000 exports measured 372 MB and 751 MB, at a size the first cap admits — and a browser tab never gets that memory back. The whole run is a single pass with no progress signal, so the page shows an indeterminate bar rather than a fabricated percentage, and reports the time the run actually took when it finishes. Nothing is uploaded; the engine runs in this tab.",
  },

  // ── ICO to PNG ─────────────────────────────────────────────────────
  {
    name: "ICO to PNG",
    slug: "ico-to-png",
    titleTag: "ICO to PNG Converter — Every Size Inside",
    category: "image-tools",
    toolType: "ico-to-png",
    description: "Unpack an .ico or .cur and save every size inside it as its own PNG. Icons already stored as PNG come out byte for byte, with no decode at all.",
    hubLine: "Every size in the file, not just the one a browser picks.",
    keywords: ["ico to png", "convert ico to png", "extract favicon", "open ico file", "icon to png", "favicon to png"],
    h1: "Convert ICO to PNG Online — Every Size Inside the File",
    subtitle: "Read the icon directory and save any size the file holds as its own PNG — byte for byte wherever the icon was already a PNG.",
    acceptFormats: ".ico,.cur",
    relatedTools: ["png-to-ico", "favicon-generator", "png-to-jpg", "compress-png", "resize-image"],
    aboutText: "An .ico is not one picture — it is a container holding several, typically 16 × 16, 32 × 32 and 48 × 48, sometimes a 256 × 256 as well. That matters because a browser handed the whole file decodes exactly one image out of it and never says which; the decoders in Chromium and WebKit prefer the largest size, then the greatest colour depth, and nothing in the platform lets a page ask for a different one. So the usual one-line convert quietly throws away most of what you gave it. This page reads the icon directory instead — six bytes of header and sixteen per entry — lists every image the file actually contains with its size and bit depth, and lets you take the ones you want. The directory also tells the page how each icon is stored, which decides what can honestly be claimed about it. An entry stored as a PNG is copied straight out as a byte slice: no decode, no canvas, no re-encode, so the file you get is byte for byte the one that was inside, and that is genuinely lossless. An entry stored as a bitmap cannot be, because a bitmap is not a PNG; it is decoded and written out again. Each icon is badged with which of the two it is, read out of the directory rather than guessed from the file's name, because one .ico can carry both kinds side by side. Files made by this site's own PNG to ICO tool store every entry as a PNG, so they round-trip through here untouched. Cursor files (.cur) use the identical container and work the same way, with the caveat that the hotspot coordinates a cursor carries are not part of a PNG and are dropped. If the directory declares images the file does not actually contain — a common symptom of a truncated download — the page counts them and says so instead of silently listing fewer icons than the file claims. Everything runs in this tab; nothing is uploaded.",
  },

  // ── Base64 to Image ────────────────────────────────────────────────
  {
    name: "Base64 to Image",
    slug: "base64-to-image",
    titleTag: "Base64 to Image — Decode & Download",
    category: "image-tools",
    toolType: "base64-to-image",
    description: "Paste a Base64 string or data URI and get the image file back. The format is read from the decoded bytes, so a mislabelled data URI still saves correctly.",
    hubLine: "Paste the string, get the file back.",
    keywords: ["base64 to image", "decode base64 image", "base64 to png", "data uri to image"],
    h1: "Base64 to Image — Decode a String Back to a File",
    subtitle: "Paste Base64 or a data URI and download the image it encodes.",
    acceptFormats: "",
    takesNoFile: true,
    relatedTools: ["image-to-base64", "base64-encode-decode", "png-to-jpg", "compress-image", "exif-viewer"],
    aboutText: "A Base64 string is an image with its bytes rewritten as text so it can travel inside HTML, CSS, JSON or an email body. This tool turns one back into a file. Paste a bare payload, a whole data: URI, a line-wrapped block out of a terminal or a PEM-style dump, or the entire img tag you copied from a page's source — the payload is pulled out of any of them. URL-safe Base64, the kind JWTs and many APIs emit, is translated for you, and missing padding is added back before anything is decoded. What the tool will not do is trust the label. The mediatype in front of a data URI is something a person typed, and data:image/png;base64, in front of JPEG bytes is one of the commonest pastes there is — so the format is read from the decoded magic bytes, the download is named from those, and any disagreement between the two is stated on the page rather than quietly resolved. The refusals are specific for the same reason: a percent-encoded data URI, a paste that was cut short mid-copy, and bytes that decode perfectly but are not an image are three different problems with three different answers, and the page tells you which one you have. Everything happens in this tab — the string never leaves your device.",
  },

  // ── Image DPI ──────────────────────────────────────────────────────
  {
    name: "Change Image DPI",
    slug: "change-image-dpi",
    titleTag: "Change Image DPI — 72, 150, 300 or 600",
    category: "image-tools",
    toolType: "change-image-dpi",
    description: "Set a PNG or JPEG to 72, 150, 300 or 600 DPI by rewriting its header. No pixels are touched and nothing is re-encoded — only the print size changes.",
    hubLine: "Print density only — the pixels stay exactly where they are.",
    keywords: ["change image dpi", "set image dpi", "300 dpi converter", "image dpi changer"],
    h1: "Change Image DPI — Set 72, 150, 300 or 600 DPI",
    subtitle: "Rewrite a PNG or JPEG's print density without touching a pixel.",
    acceptFormats: ".jpg,.jpeg,.png",
    relatedTools: ["resize-image", "crop-image", "compress-image", "exif-viewer", "jfif-to-jpg"],
    aboutText: "DPI is the number a printer or a layout application reads to decide how large to print the pixels a file already has. It is metadata, not pixels: a 3000 by 2000 photo is a ten-inch print at 300 DPI and a forty-one-inch print at 72, and in both cases it is the same three thousand by two thousand pixels. That is why this tool never decodes your image. It edits the header fields in place — a PNG's pHYs chunk and, where the file carries one, its eXIf resolution tags; a JPEG's JFIF density and its EXIF resolution tags — and hands the same compressed image data back, so what you download is your file with a different number in it rather than a re-encode. Writing only one of a file's two fields is the classic way to get this wrong: where a JPEG carries both, readers believe the EXIF one, so setting the JFIF alone looks right in a preview and changes nothing in InDesign. A PNG that carries an eXIf chunk behaves the same way — measured here, not assumed, because writing pHYs alone on such a file is a silent no-op. Both fields are written, in both formats. The page also shows what a density means in practice, printing the physical size in inches and centimetres before and after, and it says plainly when a file declares no density at all rather than repeating the 72 that a reader would have invented on its behalf. PNG and JPEG only — WebP has no DPI field to change.",
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
    relatedTools: ["json-to-csv", "csv-to-json", "xml-formatter", "jwt-decoder"],
    aboutText: "Working with JSON data from an API response, configuration file, or database export? Unformatted JSON is nearly impossible to read, especially when deeply nested. This tool formats messy JSON into readable, properly indented output, making it easy to scan and understand the structure of your data. The rewrite moves whitespace only — every string, number, and keyword is copied byte for byte, so a 64-bit id or a trailing zero survives exactly as you pasted it instead of being rounded through a double. It validates your JSON in real time and shows clear, descriptive error messages for invalid input, and where the browser's parser reports a position the output pane becomes the failure report: the exact line and column, plus three lines of context with the offending character marked. Toggle between formatted and minified views with one click, which is useful when you need compact JSON for API requests or configuration files. Common use cases include debugging API responses, formatting configuration files for readability, validating JSON payloads before sending them, and minifying JSON to reduce payload size.",
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
    relatedTools: ["csv-to-json", "json-formatter", "xml-formatter", "markdown-to-html"],
    aboutText: "Need to turn a JSON array into a spreadsheet? API responses, database exports, and analytics data often come as JSON arrays of objects, but spreadsheet tools like Excel and Google Sheets work with tabular CSV data. This tool bridges that gap by parsing your JSON array, extracting all unique keys as column headers, and generating a clean CSV file ready to open in any spreadsheet application. It handles nested objects by flattening them with dot notation, so a field like address.city becomes a single column. Arrays within objects are serialized cleanly. Download the resulting CSV file or copy it to your clipboard with one click. This is particularly useful for data analysts converting API data for reporting, developers exporting test data, and anyone who needs to review JSON data in a familiar spreadsheet format.",
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
    relatedTools: ["json-to-csv", "json-formatter", "xml-formatter", "html-to-markdown"],
    aboutText: "Have CSV data from a spreadsheet, database export, or log file that you need as JSON? Many APIs, configuration systems, and modern web applications expect JSON input, but your data might be in CSV format. This tool parses comma-separated CSV and converts it to a clean JSON array of objects, using the first row as property keys. It correctly handles quoted fields, escaped commas, multiline values, and the CRLF line endings Excel and Windows exports produce — the edge cases that trip up manual conversion attempts. Every value is emitted as a JSON string, so order ids with leading zeros and long numeric codes come through exactly as written rather than being reinterpreted as numbers. Copy the result to your clipboard or download it as a .json file. Common use cases include preparing data for API imports, converting spreadsheet data for use in web applications, transforming log files into structured JSON for analysis, and migrating data between systems with different format requirements.",
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
    relatedTools: ["json-formatter", "xml-formatter", "markdown-to-html", "text-diff"],
    aboutText: "Messy SQL queries are hard to read, debug, and review in code reviews. Whether you are dealing with a long query generated by an ORM, a complex report query with multiple joins, or a stored procedure inherited from a colleague, proper formatting makes all the difference. This tool formats your SQL with two-space indentation and consistent spacing, transforming unreadable one-liners into clean, structured queries. It supports multiple SQL dialects including Standard SQL, PostgreSQL, MySQL, MariaDB, SQLite, BigQuery, PL/SQL, and T-SQL, ensuring that dialect-specific syntax is handled correctly. Paste your query, pick the dialect, and choose whether keywords are upper-cased or left as you wrote them — the output re-runs the moment either changes, so what you see always matches the settings above it. This is essential for database developers, data analysts writing complex reports, backend engineers debugging queries, and anyone reviewing SQL in pull requests.",
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
    relatedTools: ["html-to-markdown", "markdown-to-pdf", "json-formatter", "xml-formatter", "text-diff"],
    aboutText: "This tool converts Markdown to clean, standards-compliant HTML in real time with a side-by-side preview so you can see exactly how your content will render. It supports GitHub Flavored Markdown (GFM) including tables, task lists, fenced code blocks, strikethrough, and autolinked URLs. Write or paste your Markdown on the left and instantly see the rendered output on the right; the preview is sanitized before it renders, while the HTML view and the copy button hand you the raw output untouched. Copy the HTML source code for embedding in websites, email templates, or CMS platforms, or stay in the rendered preview to check formatting. This is ideal for writing blog posts, README files, documentation, newsletter content, and any situation where you author in Markdown but need HTML output. Developers frequently use this tool to preview README files before committing, convert documentation for static site generators, and prepare formatted content for platforms that accept HTML input.",
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
    relatedTools: ["markdown-to-html", "markdown-to-pdf", "json-formatter", "xml-formatter", "html-entity-encode-decode"],
    aboutText: "Need to convert a web page or HTML snippet to Markdown? Whether you are migrating a blog from WordPress to a static site generator, extracting content from a web page for documentation, or converting email HTML to a more readable format, this tool handles the conversion cleanly. It uses the Turndown library to produce well-structured, readable Markdown from HTML source code, correctly handling headings, links, images, ordered and unordered lists, blockquotes, bold, italic, and other inline formatting, with ATX-style headings and fenced code blocks. Inline styles and presentational attributes are dropped; tables are flattened to their cell text rather than rebuilt as Markdown tables. The output follows standard Markdown conventions that work across GitHub, GitLab, Jekyll, Hugo, Gatsby, and other Markdown-based platforms. Paste your HTML on the left, press Convert to Markdown, and the result appears on the right, ready to copy to your clipboard in one click. This is particularly useful for content migration projects, converting legacy documentation to Markdown format, and pulling formatted content from web pages into your notes.",
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
    relatedTools: ["json-formatter", "sql-formatter", "html-to-markdown", "html-entity-encode-decode"],
    aboutText: "Unformatted XML is nearly impossible to read, especially when dealing with deeply nested configuration files, SOAP responses, or data feeds. This tool parses your XML using the browser's native DOMParser, validates it for well-formedness, and outputs it with proper indentation and line breaks so you can easily understand the structure. Syntax errors are clearly reported with descriptive messages and line information, helping you quickly locate missing closing tags, mismatched elements, or encoding issues. You can also minify formatted XML to a single line when compact output is needed for configuration files or API requests. Common use cases include formatting API responses from SOAP services, reviewing configuration files for applications like Maven or Spring, inspecting RSS and Atom feeds, and debugging XML payloads in enterprise integrations. The tool is also helpful for validating XML before submitting it to a parser or API that requires well-formed input.",
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
    relatedTools: ["url-encode-decode", "jwt-decoder", "html-entity-encode-decode", "hash-generator"],
    aboutText: "Base64 is a binary-to-text encoding scheme widely used in data URIs, email attachments (MIME), API payloads, JSON Web Tokens, and embedded resources. Whenever you need to represent binary data as plain text — for transmission through text-only protocols or embedding in source code — Base64 is the standard solution. This tool encodes plain text or a dropped file to Base64, and decodes Base64 strings back to readable text. Encoding reads a file's raw bytes, so images, PDFs, and other binary types come out as a string you can paste into a data URI or a config file, and UTF-8 text round-trips without mangling. Decoding accepts URL-safe Base64 (- and _, padding optional) as well as line-wrapped input such as PEM bodies and kubectl secret values. Use it to encode an image for a data URI, read a Base64 string returned by an API, or check what a section of a token actually contains — nothing is uploaded, so it is safe for values you would not paste into a web service.",
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
    relatedTools: ["base64-encode-decode", "html-entity-encode-decode", "jwt-decoder", "hash-generator"],
    aboutText: "URL encoding (also known as percent encoding) replaces special characters with %XX hex codes so they can be safely used in URLs and query parameters without breaking the URL structure. Characters like spaces, ampersands, equals signs, question marks, and non-ASCII Unicode characters all need encoding when included in URLs. This tool encodes text using JavaScript's encodeURIComponent function and decodes percent-encoded strings back to readable text. It is indispensable for web developers constructing API URLs with dynamic parameters, debugging query strings with encoded values, preparing redirect URLs, and working with OAuth callback URLs that contain encoded parameters. Paste a URL to see the decoded version and understand what parameters it contains, or type plain text to get the properly encoded version for safe inclusion in a URL. The tool correctly handles multi-byte Unicode characters, which is important for internationalized URLs.",
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
    relatedTools: ["base64-encode-decode", "json-formatter", "hash-generator", "url-encode-decode"],
    aboutText: "JSON Web Tokens (JWTs) are the industry standard for authentication and authorization across modern web applications and APIs. A JWT contains three Base64URL-encoded sections — the header (algorithm and token type), the payload (claims like user ID, roles, and expiration), and the signature. This tool splits a JWT into its three parts, decodes the header and payload, and displays each as formatted JSON you can copy with one click. It reads the exp (expiration) claim and tells you whether the token is still valid or has already expired, and shows the raw signature without verifying it — so never trust a token on the strength of what you read here. This is essential for developers debugging authentication flows, inspecting tokens returned by OAuth providers, verifying that tokens contain the expected claims, and troubleshooting authorization issues in API integrations. Simply paste your JWT and see the decoded contents instantly — no need to manually Base64-decode each section. The tool also shows the algorithm used for signing (HS256, RS256, etc.) so you can verify it matches your expectations.",
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
    relatedTools: ["url-encode-decode", "base64-encode-decode", "html-to-markdown", "xml-formatter"],
    aboutText: "HTML entities are used to represent special characters like <, >, &, and quotes in HTML documents. Without proper encoding, these characters can break your HTML structure or create security vulnerabilities like cross-site scripting (XSS). This tool encodes text by replacing special characters with their HTML entity equivalents (for example, & becomes &amp; and < becomes &lt;) and decodes HTML entities back to their original readable characters. This is essential for web developers who need to safely embed user-generated content in HTML pages, display code snippets in web pages without the browser interpreting them as markup, and prepare text for inclusion in HTML attributes. The tool handles both named entities (like &amp; and &copy;) and numeric entities (like &#169;). It is also useful for content writers who need to include special symbols like copyright marks, em dashes, or mathematical symbols in HTML.",
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
    relatedTools: ["password-generator", "hash-generator", "lorem-ipsum-generator", "timestamp-converter"],
    aboutText: "UUIDs (Universally Unique Identifiers) are 128-bit identifiers used as database primary keys, request IDs, session tokens, and unique resource identifiers across distributed systems. This tool generates two versions of UUIDs. UUID v4 uses cryptographically secure random numbers from the Web Crypto API, making each ID statistically unique without any coordination between systems — the standard choice for most use cases. UUID v7 is time-ordered, embedding a millisecond-precision timestamp in the first 48 bits, which makes it ideal for database primary keys because it maintains chronological ordering and improves index performance compared to random v4 UUIDs. Generate one UUID at a time for quick use, or bulk generate up to 100 for seeding databases, creating test fixtures, or preparing batch operations. Copy individual UUIDs with a single click or copy the entire list at once. The generated UUIDs follow the RFC 4122 and RFC 9562 specifications.",
  },
  {
    name: "Password Generator",
    slug: "password-generator",
    titleTag: "Password Generator — Strong & Secure",
    category: "developer-tools",
    toolType: "password-generator",
    acceptFormats: "",
    takesNoFile: true,
    description: "Generate cryptographically strong passwords with custom length and character sets. Powered by Web Crypto — never sent over the network.",
    hubLine: "Up to 128 characters, drawn without bias.",
    keywords: ["password generator", "generate password", "random password", "strong password", "secure password"],
    h1: "Password Generator — Strong & Cryptographically Secure",
    subtitle: "Generate random passwords with customizable length, character types, and strength meter.",
    relatedTools: ["uuid-generator", "hash-generator", "base64-encode-decode", "lorem-ipsum-generator"],
    aboutText: "Weak and reused passwords are the leading cause of account breaches and unauthorized access. Creating truly random passwords is something humans are notoriously bad at — we tend to use predictable patterns, dictionary words, and personal information that attackers can guess. This tool generates cryptographically secure random passwords using the Web Crypto API (crypto.getRandomValues), which provides the same quality of randomness used in encryption and security protocols, drawn without the modulo bias a naive generator introduces. Customize the length from 8 to 128 characters and toggle character types including uppercase letters, lowercase letters, numbers, and symbols to meet any password policy requirements — every class you tick is guaranteed to appear at least once. A strength meter rates each result Weak, Fair, Strong, or Very Strong from the entropy implied by its length and character mix. Bulk generate up to 20 passwords at once for setting up multiple accounts or creating credentials for a team. Copy any password to your clipboard with a single click.",
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
    relatedTools: ["password-generator", "uuid-generator", "base64-encode-decode", "text-diff"],
    aboutText: "Cryptographic hashes are one-way functions that produce a fixed-length fingerprint of any input data. They are fundamental to data integrity verification, password storage, digital signatures, and blockchain technology. This tool generates hashes using four widely used algorithms: SHA-1 and SHA-256 (the most common for checksums and general use), SHA-512 (maximum security), and MD5 (legacy compatibility and quick checksums). SHA-1, SHA-256, and SHA-512 are computed using the browser's native Web Crypto API for maximum performance, while MD5 uses the js-md5 library. You can hash text input directly or upload files to compute their checksum. File hashing is particularly useful for verifying software downloads — compare the hash against the one published by the developer to confirm the file has not been tampered with or corrupted during download. Other common use cases include generating content fingerprints for deduplication, creating deterministic identifiers from strings, and verifying data integrity after transfer.",
  },
  {
    name: "Lorem Ipsum Generator",
    slug: "lorem-ipsum-generator",
    titleTag: "Lorem Ipsum Generator — Words to Paragraphs",
    category: "developer-tools",
    toolType: "lorem-ipsum-generator",
    acceptFormats: "",
    takesNoFile: true,
    description: "Generate Lorem Ipsum placeholder text by paragraphs, sentences, or words. Adjustable length for design mockups, layouts, and content prototypes.",
    hubLine: "Word counts arrive without a full stop.",
    keywords: ["lorem ipsum generator", "placeholder text", "dummy text", "lipsum", "lorem ipsum"],
    h1: "Lorem Ipsum Generator — Paragraphs, Sentences & Words",
    subtitle: "Generate placeholder text for designs and mockups — copy with one click.",
    relatedTools: ["word-counter", "text-case-converter", "uuid-generator", "password-generator"],
    aboutText: "Lorem Ipsum is the standard placeholder text used in design, typography, and web development since the 1960s. When building website mockups, designing print layouts, or prototyping user interfaces, you need realistic-looking text that does not distract reviewers with actual content. Lorem Ipsum fills that role perfectly — it has a natural distribution of letters and word lengths that mimics real English text. This tool generates Lorem Ipsum in three formats: paragraphs (ideal for filling page layouts and article mockups), sentences (useful for shorter text blocks and card components), and individual words (perfect for labels, headings, and form placeholders). Choose the count you need and the text is generated instantly. The output always begins with the classic 'Lorem ipsum dolor sit amet...' opening for authenticity. Copy to your clipboard with one click and paste directly into your design tool, HTML file, or content management system. Whether you are a graphic designer mocking up a brochure, a web developer building a prototype, or a product manager creating wireframes, this tool saves you from typing gibberish.",
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
    relatedTools: ["base64-encode-decode", "url-encode-decode", "uuid-generator", "hash-generator"],
    aboutText: "QR codes are two-dimensional barcodes that can encode URLs, text, Wi-Fi credentials, contact information, and more. They are ubiquitous in marketing materials, product packaging, restaurant menus, event tickets, and business cards. This tool generates QR codes from any text input with customizable foreground and background colors, letting you match your brand palette or design requirements. Download your QR code as a PNG for print materials and presentations, or as an SVG for scalable, resolution-independent output that looks crisp at any size. Common use cases include creating QR codes for website URLs, app download links, Wi-Fi network credentials for guests, event registration pages, and vCard contact information. The generation uses the qrcode library and runs entirely in your browser — no data is sent to any server, which is important when encoding sensitive URLs containing authentication tokens or private network credentials. The generated QR codes follow standard specifications and are scannable by all modern smartphone cameras and QR reader apps.",
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
    relatedTools: ["css-gradient-generator", "box-shadow-generator", "image-color-palette", "qr-code-generator"],
    aboutText: "Working with colors in CSS, design tools, or brand guidelines? This tool pairs your browser's native color picker with precise input fields for HEX, RGB, and HSL, and all three update in real time as you change any one of them — making it easy to convert between color systems. Need the HEX code for an RGB color your designer specified? Just enter the RGB values and copy the HEX output. Working in HSL and need the RGB equivalent? Type a hue, saturation, and lightness and read the RGB values instantly; hue and saturation are held while you edit those fields, so taking lightness down to black and back returns the color you started with rather than grey. Copy any single format with the button beside it, or copy all three at once. A CSS block under the large preview shows the same color as hex, rgb(), and hsl() declarations, ready to paste into a stylesheet. Whether you are fine-tuning a website color scheme, converting colors between formats for documentation, or exploring color options for a design project, this tool handles it all.",
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
    relatedTools: ["color-picker", "box-shadow-generator", "image-color-palette", "qr-code-generator"],
    aboutText: "CSS gradients add visual depth, energy, and polish to web designs without requiring image files — they are resolution-independent, load instantly, and scale perfectly on any screen. This tool lets you build linear, radial, and conic gradients with an intuitive visual interface. Add and remove color stops, set each stop's color from a swatch or by typing a hex value, and move it with its own position slider; a separate angle slider steers linear and conic gradients. The live preview updates in real time as you make changes, so you can experiment freely and see results immediately. When you are happy with the gradient, copy the complete CSS code with one click — it is ready to paste into your stylesheet. This is perfect for creating hero section backgrounds, button hover effects, overlay gradients on images, decorative borders, and loading indicators. The tool takes as many color stops as you need, enabling smooth multi-color transitions across the whole bar. Whether you are a designer prototyping visual ideas or a developer implementing a design specification, this tool eliminates the guesswork of writing gradient CSS by hand.",
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
    relatedTools: ["css-gradient-generator", "color-picker", "image-color-palette", "qr-code-generator"],
    aboutText: "CSS box shadows add depth, elevation, and visual hierarchy to UI elements — they are a core part of modern web design, used in cards, buttons, modals, navigation bars, and floating action buttons. This tool lets you build box shadows visually with multiple layers, giving you fine-grained control over X and Y offset, blur radius, spread radius, color, and opacity for each layer. Multiple shadow layers can be combined to create realistic, nuanced elevation effects similar to Material Design's elevation system. Toggle inset shadows to create inner glow or pressed-button effects. The live preview updates instantly as you adjust any parameter, so you can experiment with different looks without writing a single line of CSS by hand. When you are satisfied with the result, copy the complete CSS code with one click and paste it into your stylesheet. This is invaluable for frontend developers implementing design systems, prototyping UI components, or recreating shadow effects from a design mockup.",
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
    relatedTools: ["text-diff", "text-case-converter", "json-formatter", "word-counter"],
    aboutText: "Regular expressions are one of the most powerful tools in a developer's toolkit, but their terse syntax makes them notoriously tricky to write and debug. This tool provides a real-time testing environment where you enter a regex pattern and a test string, and immediately see all matches highlighted directly in the text. Capture groups are listed under the text, each row labeled with the match and group number it came from alongside the captured value — essential for understanding complex patterns with multiple captures. Five JavaScript flags are one-tap toggles: global, case-insensitive, multiline, dotAll, and unicode, so you can quickly see how each one changes your matches. Evaluation runs in a worker under a hard timeout, so a catastrophically backtracking pattern cannot freeze the tab. Use it to build and verify patterns for form validation, log parsing, data extraction, search-and-replace operations, and any text processing task. Common patterns include email validation, URL matching, date extraction, and parsing structured log lines. The real-time feedback loop dramatically speeds up regex development compared to running test code repeatedly.",
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
    relatedTools: ["timestamp-converter", "uuid-generator", "regex-tester", "json-formatter"],
    aboutText: "Cron expressions define recurring schedules for automated tasks like database backups, report generation, cache clearing, and deployment pipelines — but the five-field syntax (minute, hour, day-of-month, month, day-of-week) can be confusing and error-prone. A misplaced asterisk or an off-by-one error can cause a job to run every minute instead of every hour, or skip days entirely. This tool eliminates that guesswork by letting you build cron expressions using visual dropdowns and toggles, or type an expression manually to see its human-readable description in plain English. It shows the next 5 scheduled run times calculated from the current moment, so you can verify that the schedule matches your intentions before deploying it. The tool supports standard 5-field cron format used by crontab on Linux/macOS, Kubernetes CronJobs, GitHub Actions scheduled workflows, AWS CloudWatch Events, and most task scheduling systems. Common schedules like 'every weekday at 9 AM,' 'first of every month,' and 'every 15 minutes' can be built in seconds.",
  },
  {
    name: "Timestamp Converter",
    slug: "timestamp-converter",
    titleTag: "Timestamp Converter — Unix, ISO & Human",
    category: "developer-tools",
    toolType: "timestamp-converter",
    acceptFormats: "",
    takesNoFile: true,
    description: "Convert between Unix timestamps in seconds or milliseconds, ISO 8601, and human-readable dates — edit any of the four fields and the rest follow.",
    hubLine: "Seconds or milliseconds, local or UTC.",
    keywords: ["timestamp converter", "unix timestamp", "epoch converter", "iso 8601", "date converter"],
    h1: "Timestamp Converter — Unix, ISO 8601 & Human-Readable",
    subtitle: "Convert between Unix timestamps, ISO 8601, and human-readable date formats.",
    relatedTools: ["cron-expression-generator", "uuid-generator", "json-formatter", "base64-encode-decode"],
    aboutText: "Working with timestamps in different formats is a daily task for developers, data engineers, and system administrators. Unix timestamps (seconds since January 1, 1970), ISO 8601 strings, and human-readable dates are all common in APIs, databases, log files, and configuration systems, but converting between them manually is tedious and error-prone. This tool converts seamlessly between Unix timestamps in seconds, Unix timestamps in milliseconds (used by JavaScript and Java), ISO 8601 strings (the standard for API communication), and a human-readable date and time. Type into any one of the four fields and the other three follow. Use the 'Now' button to capture the current timestamp for quick reference, and switch the human-readable line between this device's local zone and UTC so a log line and a server clock can be compared without guessing which one you are looking at. The rail also reports the weekday and your local zone name. Common use cases include decoding timestamps from API responses, converting log file timestamps for incident analysis, generating timestamps for database queries, and verifying token expiration times.",
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
    relatedTools: ["json-formatter", "text-case-converter", "word-counter", "regex-tester"],
    aboutText: "Need to find the differences between two text blocks? Whether you are comparing two versions of a configuration file, reviewing changes to a document, checking what was modified in a code snippet, or verifying that a migration script preserved content correctly, this tool makes differences immediately visible. Paste two texts into the left and right panels and the tool highlights additions in green, deletions in red and struck through, and unchanged text in the default color. Choose the granularity to suit the material: word by word for prose, or line by line for code and config. The result is one combined pane with additions and deletions interleaved, the way git diff shows them, and a Swap button flips which text counts as the original. The diffing algorithm uses the jsdiff library, which produces clean, minimal diffs that accurately represent the smallest set of changes between the two inputs. This is useful for developers comparing code versions, technical writers reviewing document edits, translators verifying changes between drafts, and anyone who needs to spot differences that are hard to catch by eye.",
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
    relatedTools: ["word-counter", "text-diff", "lorem-ipsum-generator", "regex-tester"],
    aboutText: "Need to change the case of variable names, titles, headings, or body text? Different contexts require different casing conventions — JavaScript uses camelCase for variables and PascalCase for classes, Python prefers snake_case, CSS uses kebab-case for class names, and titles follow Title Case rules. Manually reformatting text between these conventions is tedious and error-prone. This tool converts text between 7 common case formats: UPPERCASE, lowercase, Title Case, camelCase, snake_case, kebab-case, and PascalCase. Type or paste your text and click any format button to convert instantly. Copy the result with one click, ready to paste into your code editor, document, or CMS. Common use cases include converting database column names between snake_case and camelCase for API mappings, reformatting headings to Title Case for articles, converting class names between naming conventions when switching frameworks, and transforming UPPERCASE text from legacy systems to more readable formats. The tool handles multi-word inputs intelligently, splitting on spaces, underscores, hyphens, and camelCase boundaries.",
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
    relatedTools: ["text-case-converter", "text-diff", "lorem-ipsum-generator", "regex-tester"],
    aboutText: "Need to check the length of your text? Many platforms impose strict character or word limits — Twitter/X has a 280-character limit, meta descriptions should be under 160 characters, LinkedIn posts perform best under 1,300 characters, and academic abstracts often require 150-300 words. This tool counts characters (with and without spaces), words, sentences, and paragraphs in real time as you type or paste text. It also estimates the reading time based on an average reading speed of 225 words per minute, which is helpful for bloggers and content creators gauging how long their articles will take to read. The statistics update instantly with every keystroke, so you can edit your text and watch the counts change in real time. Whether you are writing a blog post, crafting a social media caption, preparing an essay with a word limit, editing a resume bullet point, or composing an email that needs to be concise, this tool keeps you informed about your text metrics.",
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
    relatedTools: ["compress-video-to-size", "video-trimmer", "text-diff", "text-case-converter", "word-counter"],
    aboutText: "Three things go wrong with subtitle files, and this page fixes all three. The first is the format: a player wants WebVTT and you have an SRT, or a site wants an SRT and someone sent you an ASS. The second is synchronisation — the words arrive two seconds before the mouth moves — which is a fixed offset applied to every cue. The third looks like the second and is not: a file timed against a 23.976 fps transfer and played at 25 drifts further out the longer it runs, because the error grows with elapsed time instead of staying constant. That one is fixed by re-timing between the two rates, which multiplies every cue time by timed-for over playing-at; getting the ratio the wrong way up doubles the drift rather than removing it, which is why the two rates are picked separately rather than guessed. The formats differ in small mechanical ways that break parsers. SRT writes its milliseconds after a comma and WebVTT after a full stop; WebVTT will not load in a browser without a WEBVTT line at the top; ASS stores hundredths of a second rather than thousandths, so writing ASS rounds outward, starts down and ends up, by up to 10 ms. All of that is handled. What cannot be handled is the other direction. ASS is a different model altogether — named styles, fonts and colours, on-screen positioning, karaoke timing inside the text itself — and converting one to SRT keeps the words and the times and discards every bit of the rest. The count of what went is printed rather than hidden: the cues that were vector drawings instead of words, the markup that had nowhere to go. Writing ASS produces a valid file with a single Default style; it is not a styled one. Encoding is the other half of the job. Subtitle files in the wild are frequently not UTF-8 — an older SRT is very often Windows-1252 — and reading one of those as UTF-8 with a forgiving decoder puts a replacement mark where every accent was, which is a file that looks converted and is quietly ruined. So the encoding is worked out rather than assumed: a byte-order mark is believed, BOM-less UTF-16 is spotted by its zero bytes, and the UTF-8 test is run strictly so that a file which is not UTF-8 fails it instead of coming back full of diamonds. Bytes that fail are read as Windows-1252 and labelled a guess, because a Cyrillic or Greek file is equally valid non-UTF-8, and a picker lets you name the codepage yourself when the guess is wrong. What gets written out is always UTF-8. The last of it is arithmetic on the timings. A negative shift that would start a cue before zero has that start pulled to 00:00:00; a cue that ends before zero is dropped rather than written out invalid; cues are sorted by start time and the SRT and WebVTT output is renumbered from 1; and overlapping cues are left exactly as they were, because two people talking at once is legal. Every one of those is counted on screen. Nothing is uploaded — the file is read, converted and written in this tab."
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
    relatedTools: ["split-pdf", "rotate-pdf", "pdf-page-reorder", "compress-pdf", "markdown-to-pdf"],
    aboutText: "Need to combine multiple PDFs into one document? Whether you are merging chapters of a report, combining scanned pages into a single file, assembling a portfolio, or packaging invoices for accounting, this tool makes it simple. Drag and drop your PDF files into the upload area, then reorder them by dragging to set the desired sequence. You can see the page count for each file before merging, helping you verify you have the right documents. Click merge and download a single consolidated PDF that preserves the formatting, fonts, and layout of every original document. The merge itself runs on pdf-lib, a pure-JavaScript PDF library, entirely inside your browser — no files are uploaded to any server, which is critical when working with confidential contracts, financial documents, legal filings, or medical records. This is a practical everyday tool for office workers, students, freelancers, and anyone who regularly works with PDF documents.",
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
    relatedTools: ["merge-pdf", "rotate-pdf", "pdf-page-reorder", "pdf-to-jpg"],
    aboutText: "Need specific pages from a large PDF? Whether you need to extract a single chapter from a textbook, pull out a signature page from a contract, isolate specific slides from a presentation PDF, or separate a multi-page scan into individual documents, this tool handles it with ease. Upload your PDF file and you will see thumbnail previews of every page. Click individual pages to select them, or type a page range using flexible syntax like 1-3, 5, 8-10 to select multiple ranges at once. The selected pages are extracted into a new PDF that you can download instantly, preserving the original formatting, fonts, and quality. This is especially useful for students extracting relevant chapters for study, professionals pulling specific pages for a client, and anyone who needs to share only part of a larger document.",
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
    relatedTools: ["merge-pdf", "split-pdf", "rotate-pdf", "pdf-to-jpg", "markdown-to-pdf"],
    aboutText: "PDF files become unexpectedly large for three boring reasons: objects nothing points at any more, streams that were never compressed in the first place, and a cross-reference table written in the older plain-text form. This is especially common with PDFs produced by word processors, design tools, and scanning software that accumulate revision history and orphaned objects. This tool makes one pass at each. It walks the document outward from the entries in its trailer and deletes every indirect object that walk cannot reach; it deflates the streams that arrived with no compression filter at all; and it rewrites the file with its objects packed into compressed object streams and a cross-reference stream. Because the first pass keeps whatever is reachable, the document's own metadata such as title and author survives unchanged, and so do form fields and their values, bookmarks, page labels, named destinations, annotations and embedded attachments — they all hang off the catalog, so keeping them is not a special case, it is the definition of the pass. What this tool deliberately does not do is re-encode your images, downsample them, or subset fonts. The pixels and the text come out byte for byte identical, which is why a PDF that is mostly photographs barely moves while one carrying orphaned objects or raw streams can lose the large majority of its size. And if the rewrite would come out larger than the file you gave it — which is what happens to a PDF already packed this way — the download hands back your original bytes and the readout honestly says nothing was saved. Common uses include shrinking PDFs before email attachments, meeting upload size limits on web portals, reducing storage for document archives, and preparing files for faster download. The compression is lossless: the visual content, text, and layout are identical to the original.",
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
    relatedTools: ["compress-pdf", "pdf-resizer", "pdf-to-jpg", "split-pdf", "merge-pdf"],
    aboutText: "Some PDFs are large because of how they are built, and some are large because of what is inside them. This tool is for the second kind. It walks every image the document embeds, decodes the ones stored as JPEG, redraws them and writes them back at a lower JPEG quality — and, when you give it a target size, at smaller pixel dimensions as well. That is a lossy edit and it cannot be undone, so keep your original. What it never touches is the text and the vector artwork: those come out exactly as they went in, which is why a report with photographs in it stays sharp everywhere the photographs are not. There are two ways to drive it. Quality offers three presets and makes a single pass at the one you pick. Target size takes a number in KB and searches for it — quality first, then progressively smaller image dimensions, rebuilding the document each time and keeping the best-looking result that still fits under your number — the highest quality that lands under it, not the smallest file it can make. When nothing fits, you get the closest size it managed and a plain statement that the target was not reached, rather than a file quietly larger than you asked for. The more interesting half is what it refuses to do. Only images stored as JPEG are eligible. An image held as JPEG 2000, CCITT fax, JBIG2 or a deflated bitmap is written back byte for byte as it came in, and so is anything carrying a transparency mask, anything with its own decode array or predictor parameters, anything in CMYK or an indexed or ICC-tagged colour space, and anything that is not eight bits per channel. Rewriting those needs codecs and colour handling this tool deliberately does not carry, and a wrong guess prints an inverted or falsely coloured page. Every skipped image is counted, grouped by reason and shown on screen, because a compressor that silently does nothing is worse than one that says so. There is a per-image guard too: if the re-encode comes back bigger than the image it replaced, the original image stays. Each image is processed once however many pages draw it, and the finished document is written back with its objects packed into object streams. If you would rather not lose anything, try Compress PDF first — it repacks the same file without touching a single pixel.",
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
    relatedTools: ["pdf-to-png", "pdf-to-webp", "images-to-pdf", "split-pdf", "compress-pdf"],
    aboutText: "Need images from a PDF? Whether you want to turn a presentation into individual slide images, extract pages from a brochure for social media, convert a scanned document into image files, or create thumbnails of a multi-page report, this tool renders every page of your PDF to a high-quality image using PDF.js. Choose between JPG output (smaller file sizes, ideal for photos and general use), PNG output (lossless quality, perfect for text-heavy documents and graphics with sharp edges), and WebP output (smaller still than JPG at similar quality — in browsers that can encode WebP, such as Chrome and Edge; Safari cannot, and the tool says so plainly instead of producing mislabeled files). Adjust the quality slider and scale factor to control the resolution of the output — increase the scale for crisp, high-DPI images suitable for print or retina displays. Download individual pages one at a time, or download all pages at once for convenience. The rendering engine faithfully reproduces text, vector graphics, embedded images, and complex layouts from the original PDF.",
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
    relatedTools: ["pdf-to-jpg", "pdf-to-webp", "png-to-pdf", "split-pdf"],
    aboutText: "PNG is the right output when a PDF page has to survive as pixels without losing anything — sharp text, thin rules, line art, screenshots headed for documentation. This tool renders every page of your PDF with PDF.js, the same engine Firefox uses to display PDFs, and encodes each page as a lossless PNG. Nothing is uploaded: the rendering and the encoding both run in your browser, which matters when the document is a contract, a medical record, or anything else you would rather not hand to a server. The scale slider controls the output resolution — 2× is the default and already crisp on screen; 4× doubles the pixel dimensions again for print or high-DPI displays. Expect PNG files to be noticeably larger than the JPG output of our PDF to JPG tool; that is the price of lossless — every character edge stays exactly as rendered, with none of JPG's compression ringing around text. There is no quality slider on this page because PNG has nothing to trade away. Each page becomes its own numbered PNG, downloadable individually from the page deck or all at once as a ZIP named after your document. The JPG and WebP outputs stay one toggle away on the same tool.",
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
    relatedTools: ["pdf-to-jpg", "pdf-to-png", "webp-to-pdf", "webp-to-jpg"],
    aboutText: "WebP squeezes a rendered PDF page into noticeably fewer bytes than JPG at a comparable quality setting, which makes it the format to pick when the pages are headed for the web — documentation images, slide renders for a post, page previews for a file listing. Every page of your PDF is rendered in your browser with PDF.js at your chosen scale (up to 4×), then encoded as a lossy WebP whose quality slider works exactly like the JPG one. Nothing is uploaded to any server. One caveat, stated plainly: the encoding uses your browser's own WebP encoder, and not every browser has one. Chrome, Edge, and other Chromium-based browsers encode WebP natively; Safari can decode WebP but cannot encode it — and rather than silently handing you PNG bytes wearing a .webp name, which is what a bare canvas encoder would do, this tool verifies the very first page's bytes and stops with a clear error pointing you to PDF to PNG instead. Multi-page documents arrive as a ZIP named after your PDF, one .webp per page, with individual page tiles for single downloads. If the images must open absolutely anywhere, PDF to JPG and PDF to PNG remain the universal choices.",
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
    relatedTools: ["jpg-to-pdf", "tiff-to-pdf", "pdf-to-jpg", "merge-pdf", "compress-pdf"],
    aboutText: "Need to turn a set of images into a PDF document? This is a common need when compiling photo portfolios, creating PDF versions of scanned documents, packaging design proofs for client review, or assembling receipts and invoices into a single file for accounting. Upload JPG, PNG, WebP, HEIC, or TIFF files, drag to reorder them into the sequence you want, choose a page size (A4 for international standard, Letter for US standard, or fit-to-image to match the exact dimensions of each image), and download a single polished PDF. JPG bytes are embedded without re-encoding and PNGs are repacked losslessly; WebP and HEIC are decoded in your browser and re-encoded — lossless PNG where an image carries transparency, JPEG at quality 0.92 where it is opaque — and every page of a multi-page TIFF becomes its own PDF page, with the true page count shown before you convert. Images are centered on each page, scaled to fit within the margins while preserving aspect ratio, and never enlarged past their natural size. The resulting PDF is clean and professional, suitable for sharing, printing, or archiving.",
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
    relatedTools: ["images-to-pdf", "png-to-pdf", "pdf-to-jpg", "merge-pdf"],
    aboutText: "JPG is the format cameras, phones, and scanners produce, and PDF is the format forms, portals, and offices expect — this tool bridges the two without touching your pixels. Each JPG is embedded into the PDF byte-for-byte using pdf-lib's native JPEG path: the file is never decoded or re-encoded, so there is zero quality loss and the PDF weighs roughly what the photos weigh. Drop in one photo or a whole set, drag the cards to set page order, and choose a page size — A4 or US Letter, where each image is centered inside a 40-point margin and scaled down (never up) to fit, or fit-to-image, where every page matches its photo's exact dimensions. Everything runs in your browser; no file leaves your device. Common uses include submitting receipts as one document, packaging scanned pages for a portal that only accepts PDF, and turning photo sets into a single shareable attachment. A misnamed file is no problem either — the tool routes on the actual bytes, not the extension.",
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
    relatedTools: ["images-to-pdf", "jpg-to-pdf", "pdf-to-png", "merge-pdf"],
    aboutText: "PNG screenshots, diagrams, and exports become a single PDF here, with nothing lost along the way. pdf-lib decodes each PNG and repacks its pixels into the document — for 8-bit PNGs, which is what virtually every screenshot and export is, every pixel value survives exactly; a rare 16-bit PNG is reduced to 8 bits per channel, and the result says so whenever that happens. An alpha channel is carried through as a soft mask, so transparent regions stay transparent in the file and appear over the page's white background in virtually every viewer. Upload one PNG or many, drag the thumbnails to set the page order, and pick a page size: A4 or US Letter center each image inside a 40-point margin without ever enlarging it past its natural size, while fit-to-image makes each page exactly as large as its image. The conversion happens entirely in your browser — screenshots of dashboards, contracts, or private chats never leave your device. It is a natural fit for assembling UI screenshots into a review document, turning chart exports into a report appendix, or converting a set of slides saved as PNGs back into one paginated file.",
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
    relatedTools: ["images-to-pdf", "heic-to-jpg", "jpg-to-pdf", "merge-pdf"],
    aboutText: "HEIC (High Efficiency Image Container) has been the iPhone's default photo format since iOS 11, and it is exactly the format that document portals, application forms, and office workflows tend to reject. This tool turns those photos into a single PDF without them ever leaving your device: each HEIC is decoded in your browser by the libheif decoder, then saved into the document as a JPEG at quality 0.92 — a re-encode with a slight, usually invisible cost — or as a lossless PNG in the rare case the image carries transparency. Add several photos and each becomes its own page; drag the cards to set the order. Pages come out as A4 or US Letter with the photo centered inside a 40-point margin and never enlarged beyond its natural size, or as fit-to-image pages that match each photo exactly. It is the quick path from photos of your documents on an iPhone to one PDF a form will actually accept — leases, receipts, whiteboards, handwritten notes.",
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
    relatedTools: ["images-to-pdf", "webp-to-jpg", "pdf-to-webp", "png-to-pdf"],
    aboutText: "PDF has no native WebP support — no embedder can copy WebP bytes into a document the way JPG bytes can be copied — so this tool decodes each WebP in your browser with the Canvas API and re-encodes it before pdf-lib writes the file. The policy is spelled out rather than silent: images with any transparency are saved into the PDF as lossless PNG so the transparency survives, and fully opaque images are saved as JPEG at quality 0.92, which keeps a photo-heavy PDF from ballooning. An animated WebP contributes its first frame only, and the tool tells you so on screen the moment the file is added — the loss is never silent. Reorder the pages by dragging, then choose A4, US Letter (image centered inside a 40-point margin, never upscaled), or fit-to-image, where each page matches its image exactly. Because WebP compresses harder than JPEG or PNG, the PDF will usually come out somewhat larger than the source files — the price of putting the pixels in a format PDF viewers understand.",
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
    relatedTools: ["images-to-pdf", "tiff-to-jpg", "merge-pdf", "split-pdf"],
    aboutText: "The thing that sets this tool apart: every page of a multi-page TIFF becomes a page of the PDF. A 30-page scanned contract or fax TIFF comes out as a 30-page PDF, not as page one with the rest silently dropped — the assembly strip shows the true page count the moment the file is added, before you convert anything. Decoding runs in your browser on the utif2 library, one page at a time so that even long scans do not exhaust memory, and each page is then re-encoded for the PDF: lossless PNG where the page carries transparency, JPEG at quality 0.92 where it is fully opaque. Both .tiff and .tif extensions are accepted, in either byte order. Choose A4 or US Letter — pages are centered inside a 40-point margin and never enlarged past their natural size — or fit-to-image to match every page's exact dimensions. Nothing is uploaded; scanned contracts and medical documents stay on your machine from drop to download.",
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
    relatedTools: ["split-pdf", "merge-pdf", "pdf-page-reorder", "compress-pdf"],
    aboutText: "Got a scanned PDF with pages in the wrong orientation? Scanned documents, faxes, and photos saved as PDFs often end up with some pages rotated sideways or upside down, making them difficult to read and unprofessional to share. This tool lets you fix that in seconds. Upload your PDF file and you will see thumbnail previews of every page. Select the pages you want to rotate — either click individual pages or select all at once — then choose the rotation angle: 90 degrees clockwise, 180 degrees (flip upside down), or 270 degrees (90 degrees counter-clockwise). Download the corrected PDF with all pages oriented correctly, preserving the original content quality and formatting. This is essential for office workers fixing scanned documents, students correcting PDF handouts, and anyone preparing documents for professional presentation or digital archiving. The rotation modifies only the page orientation metadata, so text, images, and layout remain untouched.",
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
    relatedTools: ["rotate-pdf", "merge-pdf", "split-pdf", "compress-pdf"],
    aboutText: "Need to add page numbers to a PDF? Professionally numbered pages are essential for reports, manuscripts, legal documents, meeting packets, and any multi-page document where readers need to navigate or reference specific pages. This tool adds page numbers to any PDF with full control over placement and formatting. Upload your file, choose where to place the numbers — top or bottom of the page, aligned left, center, or right — and set the starting number if your document does not begin at page one (useful when numbering starts after a cover page or table of contents). The page numbers are drawn using Helvetica font at a clean, readable size that looks professional in any context. Download the numbered PDF instantly. This is particularly useful for students preparing thesis documents, office workers assembling meeting materials, authors formatting manuscripts, and legal professionals preparing exhibits.",
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
    relatedTools: ["split-pdf", "merge-pdf", "rotate-pdf", "compress-pdf"],
    aboutText: "Need to rearrange the pages in a PDF? Whether pages were scanned out of order, you need to move an appendix to a different position, or you want to reorganize a presentation deck, this tool makes it simple with an intuitive drag-and-drop interface. Upload your PDF file and you will see thumbnail previews of every page, giving you a clear visual overview of the entire document. Drag and drop the page thumbnails into the order you want — the interface provides smooth, responsive reordering that works just like sorting files on your desktop. When you are satisfied with the arrangement, download the reordered PDF with a single click. The output preserves all original content, formatting, fonts, and quality — only the page sequence changes. This is useful for students reorganizing study materials, professionals restructuring reports and proposals, teachers rearranging handout pages, and anyone who has received a PDF with pages in the wrong order.",
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
    relatedTools: ["split-pdf", "delete-pdf-pages", "merge-pdf", "pdf-page-reorder", "rotate-pdf"],
    aboutText: "Extracting pages is two different jobs wearing one name, and this tool does both. Drop a PDF and you get a deck of page thumbnails; click the pages you want, or type them into the RANGE field as something like 1-3, 5, 8-10 — the deck and the field are the same selection in two shapes, so typing updates the tiles and clicking rewrites the text. Select all and Deselect all sit in the rail next to them. Then pick the output mode. One PDF gives you a single document holding the selected pages in their original order, which is the ordinary case. One per page gives you a separate PDF for each page you picked, named after the page number it came from — pick pages 3 and 9 and you get page-3.pdf and page-9.pdf, delivered together as a ZIP. Select exactly one page in that mode and there is nothing to zip, so the file saves on its own instead, and the readout says so before you press anything. The pages themselves are grafted across whole by pdf-lib rather than redrawn: fonts, embedded images and vector art come over exactly as they were, annotations travel with the page they sit on, and nothing is re-encoded or rasterised at any point. What does not come across is the layer that belongs to the document rather than to any page — the outline tree, the interactive form, named destinations and page labels. So an extracted file starts with no bookmarks, and if the source was a fillable form the result still draws every field and whatever was typed into it but is no longer a form: the boxes cannot be filled in or read back by a form tool. Front matter numbered i, ii, iii comes back as 1, 2, 3 for the same reason. Internal cross-references are followed through rather than left to fend for themselves: a link whose target page is one of the ones you picked is repointed at it and still works, and a link to a page you left behind has its destination stripped, so it does nothing instead of quietly jumping to the front of the document. A link that named its target rather than pointing straight at it goes dead either way, because the table of names is part of the same document layer that does not travel. All of that is equally true of merging and splitting here. Everything runs in your browser; the file never leaves your machine.",
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
    relatedTools: ["extract-pdf-pages", "split-pdf", "merge-pdf", "pdf-page-reorder", "rotate-pdf"],
    aboutText: "This is the page picker you already know, inverted: what you select is what leaves. That inversion is the whole tool and it is the one thing worth being sure about, so it is restated everywhere the selection is visible — a red cross on each doomed thumbnail, a header that counts the pages that will be removed, a rail readout showing Removing and Remaining side by side, and a button that says Delete rather than anything vaguer. Click thumbnails to mark pages, or type them into the RANGE field the same way you would anywhere else here; Select all and Deselect all are in the rail. The pages that survive are copied into a fresh document by pdf-lib, whole — their fonts, images and vector art travel with them untouched, their annotations come across on the pages they sit on, and the order they were in is the order they keep. What stays behind is everything that hangs off the document rather than off a page: the outline tree, the interactive form, named destinations and page labels. So the result starts with no bookmarks, roman-numeral front matter reverts to plain numbering, and a fillable form comes out still showing every field and its filled-in text but no longer fillable — the same losses merging and splitting here have. The pages you marked are genuinely gone from the file, not merely hidden from the page count — including their content streams, which is the part that is easy to get wrong when a page you kept still links to one you removed. Those links are handled: a cross-reference whose target survived is repointed at it, and one whose target you deleted has its destination stripped so the link sits there inert rather than jumping somewhere arbitrary. Two deliberate refusals. The set of pages to keep is worked out from the document itself at the moment of the edit, not from a page count read earlier, so a stale number can never delete the wrong thing. And selecting every page is blocked outright: a PDF with no pages is a structurally valid file that no reader will open, so the tool says so and leaves the button disabled rather than handing you one. Nothing is uploaded — the original file on your disk is never touched.",
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
    relatedTools: ["change-pdf-page-size", "rotate-pdf", "split-pdf", "pdf-to-jpg", "compress-pdf"],
    aboutText: "Wide margins, a scanner's black border, a slide deck with a footer nobody needs — cropping is how a PDF stops wasting the page. This tool renders your first page with PDF.js and puts a draggable frame over it. Move and resize the frame by its handles, or lock it to a ratio first: Free, 1:1, A4, 4:3 or 16:9. The strip under the page reports the frame's size in points and in millimetres as you drag, so you can hit a real measurement rather than eyeballing it, and Reset crop frame puts it back. The frame you set on page one is offered to every page in the document and clamped to each page's own visible area, so a file whose pages are not all the same size crops per page instead of producing broken sheets. Where the frame only partly covers a page, that page keeps the part that fits. Where it misses a page altogether — trimming a top band off a portrait document that also contains a landscape page, say — that page is left at its original size rather than reduced to an empty sheet, and nothing on screen calls that out, so check a mixed-size file before you rely on the result. What actually changes is the page geometry: both the crop box and the media box are rewritten to the rectangle you drew, which is what makes the new size stick in every viewer and on paper. The content is never scaled, moved or re-encoded — text stays selectable, images keep their pixels, and a page that was rotated stays rotated. One thing to be clear about, because it is the difference between a smaller page and a safe one: cropping hides content, it does not remove it. The marks outside your frame are still in the file, and any tool that widens the boxes back out gets them back. If the point is that nobody can ever see something, cropping is not redaction and this is not a redaction tool.",
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
    relatedTools: ["pdf-resizer", "crop-pdf", "rotate-pdf", "merge-pdf", "images-to-pdf"],
    aboutText: "A US Letter document that has to print on A4, a mixed-size scan that should be one uniform size, a Legal page that needs to fit a normal tray — this tool sets every page in a PDF to the same sheet. Pick A3, A4, A5, Letter, Legal or Tabloid, pick portrait or landscape, and the panel draws the two sheets to scale against each other, prints page one's current size in points, and spells the target out in millimetres and inches. Orientation opens on whatever the document already has, so the default run reshapes the sheet without also turning it sideways. The Content control is the one that matters. Scale to fit, the default, enlarges or shrinks everything on the page by a single factor and centres it on the new sheet, so nothing is cut off and nothing changes shape — the panel prints the exact percentage for page one. It also draws only what the page was actually showing: marks that sat outside the visible area — bleed, printer's marks, whatever a crop box was keeping out of sight, including anything you just trimmed away with Crop PDF — stay hidden instead of being scaled onto the new sheet with everything else. Box only leaves the content precisely where it is and changes the page rectangle around it, drawn from the bottom-left corner of the page as you see it, which means a smaller sheet cuts into the page and a larger one adds blank space; that corner is the same one on a rotated page and on a page whose visible area does not start at the file's own origin. Both the media box and the crop box are rewritten, which is what makes the new size hold in every viewer rather than only in some, and a page carrying a rotation is measured the way you see it rather than the way it is stored. Annotations — links, comments and the boxes a form field draws — travel with the content under Scale to fit: they get the same scale and the same centring shift, so a link still covers the words it sat on and a field box still sits on its own label. That was measured by resizing a page whose link rectangle exactly covered a drawn button and reading both back out of the result: zero drift on ten different shapes, including landscape flips, a rotated page and a page whose media box does not start at the origin. Box only does not move the content, so it leaves annotations alone for the same reason. One limitation is left, and it is narrow. A field's stored appearance — the picture a viewer draws for it — is not rewritten, and neither is the font size recorded alongside it. Readers stretch the stored picture to the field's new size, so it normally looks right; but a reader that redraws the field from scratch, which is what happens the moment someone types into it again, lays the text out at the point size the file still names and it comes out too small for the enlarged box. A flat document with no links, comments or form fields is unaffected by any of this. Nothing is uploaded and no image is ever re-encoded.",
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
    relatedTools: ["change-pdf-page-size", "compress-pdf", "crop-pdf", "split-pdf", "delete-pdf-pages"],
    aboutText: "\"Resize a PDF\" means two genuinely different things and people mean both, so this page offers both over the same dropped file and lets you switch between them without uploading it twice. Page size changes the physical sheet: choose A3, A4, A5, Letter, Legal or Tabloid, portrait or landscape, and either scale the page content to fit the new sheet and centre it or change the page box only and let a smaller sheet crop into the content. It is the same component the dedicated Change PDF Page Size tool uses, not a second implementation, so the two pages cannot end up describing the same operation differently — including its one real caveat, which is that a form field's stored appearance and the font size recorded with it are not rewritten, so a field that is filled in again after the resize can have its text redrawn too small for the box. The rectangles themselves move and scale with the content, so links and fields stay over what they belong to. File size makes the document smaller on disk without changing how a single page looks: objects nothing references any more are dropped, streams that arrived with no compression at all are deflated, and the file is repacked into object streams behind a cross-reference stream. Be clear about what that second half is not. It has no image encoder — a stream that already carries a filter, which is every embedded JPEG, is skipped by design — so it never re-encodes or downsamples a photograph, and a PDF that is mostly photos or scanned pages often comes back the same size to the byte. The wins come from structure, and on a document carrying wasted objects or raw streams they can be a third or more. There is no quality slider and no target size: you cannot ask it for under 500 KB. It makes one pass, reports what that was worth, and if the rewrite would not come out smaller you get your original bytes back.",
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
    relatedTools: ["pdf-to-jpg", "split-pdf", "merge-pdf", "word-counter", "text-diff"],
    aboutText: "Sometimes you just need the words. This tool reads the text layer a PDF already carries — the characters the file stores, page by page, in the order the document stores them — and hands it back as plain text you can copy or download as a .txt. Extraction starts the moment the file lands, with a progress readout per page, and everything runs in your browser using PDF.js, so a contract or a medical record never leaves your machine. Lines are reassembled from the text fragments the page is built out of, and paragraph breaks are inferred from the spacing between baselines rather than guessed at. A checkbox writes a marker line before each page so you can see where one ends and the next begins; turn it off and you get one continuous run of text. Now the limits, because they decide whether this tool is any use to you. There is no OCR. A scanned page is a picture of words, not words, and it comes back with nothing — when every page in a file is like that, the tool says exactly that and does not offer you an empty download, and when only some pages are, it names them. Multi-column pages come out one whole column after another rather than in reading order, and tables lose their rows and columns: cells arrive as separate lines with no structure holding them together. This is text extraction, not layout reconstruction, and it is honest about which one it is.",
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
    relatedTools: ["pdf-to-jpg", "recompress-pdf-images", "compress-pdf", "extract-pdf-pages", "pdf-to-text"],
    aboutText: "A PDF does not contain pictures of its pages. It contains a list of objects, and some of those objects are images — and this tool goes and gets them. What it will not do is take a screenshot of anything: the images come out at the resolution the document stores them at, which is very often smaller than they look, because a page can render a 900-pixel-wide photo across six inches of paper and it still looks fine. If what you want is the page itself, with its text and vector artwork and images laid out together, that is PDF to JPG, which renders each page instead; this page is the other job. The interesting half is how the images are lifted. An image stored in a PDF as JPEG already is a JPEG bitstream — the document is simply carrying it — so those are copied out byte for byte and given a .jpg name. Nothing is decoded and nothing is re-encoded, which means no colour shift and no second generation of JPEG loss. An image stored as raw deflated samples has no JPEG bytes to lift, so a PNG is built from the samples instead, and only where the meaning of those samples is unambiguous: DeviceRGB or DeviceGray, eight bits per component, no sample-inversion array and no filter parameters at all. Everything else is skipped on purpose. JPEG 2000, CCITT fax, JBIG2, LZW and run-length streams need codecs this page deliberately does not carry; an image that is a transparency mask, or that carries one, would come out showing what the mask was hiding; a decode array or a predictor changes what the samples mean; and indexed, separation and CMYK colour needs handling that a guess gets visibly wrong. A JPEG is allowed slightly more latitude than a rebuilt PNG for one reason: a JPEG file describes its own colour, so an ordinary sRGB photo tagged with a one- or three-component ICC profile comes out fine, while a CMYK one is refused rather than handed to you as a colour negative. Every skip is counted, grouped by reason and printed on screen, because a tool that quietly hands back four images out of twelve is worse than one that says which eight it left behind and why. Images are collected by walking the document's objects rather than its pages, so a logo drawn on all forty pages arrives once rather than forty times — and, by the same rule, an image no page draws any more, because an editor replaced it or its page was deleted, is still in the file and still comes out. One gap is worth naming rather than leaving to be discovered: a small image can be written straight into a page's content stream instead of being stored as an object of its own, and those are not read. They are nearly always rules, bullets and hairlines — but a document whose only picture is an inline one comes back with a count of zero, which is at least an honest zero. A minimum-size filter is offered for the opposite problem, hiding the icons and rules a PDF also carries; it hides rather than deletes, and the canvas says how many it is holding back. Extraction begins the moment the file lands, because there is nothing to configure first. A single image downloads on its own, under its own name; several come down as one ZIP. Everything runs in your browser, which is the point when the document is a scan of something personal.",
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
    relatedTools: ["unlock-pdf", "pdf-permissions", "repair-pdf", "compress-pdf", "merge-pdf"],
    aboutText: "A contract going out by email, a payslip, a scan of a passport — some documents should not open for whoever the message gets forwarded to. This page writes a password into the PDF itself using qpdf, the Apache-2.0 command-line PDF tool, compiled to WebAssembly and run inside your tab. Type a password, confirm it, and the document is encrypted with AES-256. AES-128 is offered for readers old enough not to understand the newer scheme, and RC4 — which the format still permits and which is broken — is never offered at all. Two passwords exist in a PDF and the difference matters. The user password is the one a reader is prompted for; the owner password is the one that lets a tool change the security settings afterwards. qpdf refuses to write a 256-bit file that has a user password and no owner password, so unless you set a separate owner password the tool uses the one you typed for both. That is the honest default: it is what most people mean, and it is what happens elsewhere without being said out loud. Now the limits, because they are the whole reason to read this. A password stops someone opening the file. It does not stop the person you gave the password to from opening it and saving a copy with the password taken off — this site has a page that does exactly that. It does not stop a screenshot, a photograph of the screen, or a forwarded printout. Restrictions on printing and copying can be written in alongside the password, but those are advisory flags a reader may honour or ignore, and PDF Permissions is the page that explains what they really are. There is no reset here. If you lose the password the document is gone, which is what encryption means and why nothing on this site can help you afterwards. A password longer than 127 bytes is refused before anything is written, because qpdf would accept it, encrypt with it, and then never let it back in. And a file that already carries a password has to be unlocked first — qpdf will not re-encrypt one, so the tool checks before it runs rather than failing halfway. Nothing is uploaded: the document and the password both stay in your tab.",
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
    relatedTools: ["protect-pdf", "pdf-permissions", "repair-pdf", "merge-pdf", "split-pdf"],
    aboutText: "Two different documents send people to a page like this. One asks for a password every time it opens. The other opens straight away and then refuses to print, or will not let you select a line of text out of it. This tool takes the encryption off both, using qpdf compiled to WebAssembly and run in your tab — but it is worth being exact about which one you have. If the document prompts for a password, you have to know that password. Type it in and you get back a copy with no password on it. If you do not know it, this page cannot help you, and neither can any honest tool: removing a password you know is not password recovery, and this is not a password recovery tool. There is no guessing, no dictionary, no queue that emails you a result later. A wrong password is reported as a wrong password — qpdf says so, the tool passes that on, and no file is written rather than one that is half decrypted. The second case is the interesting one. A PDF that opens without a prompt but will not print is carrying restrictions and an owner password only, and that comes off without you typing anything at all. This is not a trick, and it is not a weakness in this tool: it is what PDF permission flags are. They record what the author intends to allow, and any tool that can read the file can clear them. If that is a surprise, PDF Permissions is the page that explains it, and it is worth reading before you rely on those flags for anything. Removing the password removes those restrictions with it, because both live in the same encryption dictionary. The document is checked before anything runs, so the tool knows which of the three states your file is in — not encrypted, restricted only, or password required — and tells you which. That matters more than it sounds: decrypting a file that was never encrypted succeeds silently, so without that check the tool would happily report a successful unlock of nothing. Everything runs in your browser; the encrypted document and the password you type both stay on your machine.",
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
    relatedTools: ["protect-pdf", "unlock-pdf", "repair-pdf", "crop-pdf", "compress-pdf"],
    aboutText: "Start with the part every other page about this leaves out. A PDF permission flag is not a lock. It is a value written into the document saying what the author intends to allow — printing, editing, copying text — and a well-behaved reader honours it by greying the menu items out. Nothing enforces it. A reader that does not care ignores it, and any tool that can open the file can clear the flags outright, which for a document that opens without a prompt means with no password at all. This site ships that tool one page over, at Unlock PDF. We would rather say so here than sell you the opposite. So what is this good for? The ordinary case, which is most cases: telling colleagues, and their software, that this copy is the read-only one — that the printable version is elsewhere, that the figures are not to be lifted into a slide deck, that this is not the file to edit. That is a real thing to communicate and it is what the flags were designed for. They stop accidents, not adversaries. Three controls are offered because three are all that do anything. Printing can be allowed in full, restricted to low resolution, or denied outright. Editing runs from everything allowed down through annotations, form filling and page assembly to nothing. Copying text and graphics can be denied. The accessibility flag the format also defines is deliberately not offered: at the encryption revision this tool writes, setting it changes the permission bits not at all, so a checkbox for it would be a control that does nothing — which is worse than an absent one. The document stays openable by anyone. The restrictions are written into the encryption dictionary alongside an owner password, with the user password left empty, and that is the shape that lets any reader open the file while still recording what it may do with it. If you want a document that will not open without a password, that is Protect PDF instead — it runs the same qpdf pass with the user password filled in. qpdf, compiled to WebAssembly, writes the file in your tab, and nothing is uploaded.",
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
    relatedTools: ["compress-pdf", "protect-pdf", "unlock-pdf", "merge-pdf", "pdf-to-text"],
    aboutText: "A PDF is a pile of objects plus a table saying where in the file each one lives. When a download is interrupted, a program crashes mid-save, or something writes the file with its arithmetic wrong, that table stops matching the objects and readers start refusing the document — sometimes with a message about a damaged file, sometimes by opening a blank page. This tool hands the file to qpdf, compiled to WebAssembly and run in your tab. qpdf parses it, hunts down the objects by scanning the file when the table cannot be trusted, and writes out a fresh document with a rebuilt cross-reference table. There is nothing to configure, because the rewrite is the repair. Now be exact about the scope, because the word repair invites far more than this can do. What gets rebuilt is the index, not the contents. Objects that are genuinely not in the file cannot be reconstructed from a file that does not contain them, so a download that stopped halfway comes back as far as it got, at best. A file with no trailer dictionary, or one that never carried a PDF header at all, gives qpdf nothing to start from and it says so instead of handing you something. It does not undelete pages, recover text somebody removed, or reverse an edit. It is not a virus scanner and not a converter: a file that is not a PDF is reported as a file that is not a PDF. The most useful thing this page does is tell you the truth about your file afterwards. qpdf distinguishes between reading a document cleanly and having to reconstruct parts of it, and it reports each thing it worked around — a recovered object stream, a bad offset, an object it had to go looking for. Those warnings are shown rather than swallowed, so a file that had to be rebuilt is never presented as one that was fine all along, and when there was nothing to warn about the tool says the structure was already sound rather than claiming a rescue. Nothing is uploaded, which matters here more than most: a document too broken to open is exactly the kind you should not be handing to a stranger's server.",
  },
  {
    name: "Markdown to PDF",
    slug: "markdown-to-pdf",
    titleTag: "Markdown to PDF Converter — Free, In-Browser",
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
    relatedTools: ["markdown-to-html", "html-to-markdown", "merge-pdf", "compress-pdf"],
    aboutText: "Turn any Markdown document into a polished PDF without leaving your browser. Drop in a .md file or paste straight into the editor, watch a live preview update in real time, and click Export to send a beautifully typeset version to your browser's print dialog where you can save it as a PDF or send it directly to a printer. The output mimics the typography of MD Peek on iOS — a generous serif body face, a sans-serif heading rhythm, soft rounded code blocks, hairline tables, and a warm blockquote bar — instead of the stark default browser styling that makes most online converters look like school worksheets. GitHub-Flavored Markdown features are fully supported: tables, task lists rendered as Unicode glyphs that print consistently across browsers, fenced code blocks with Shiki syntax highlighting across roughly twenty popular languages, strikethrough, autolinks, and nested lists. Because the conversion happens entirely client-side, your writing never leaves your device — useful for confidential notes, technical specs, meeting minutes, exam answer keys, freelance invoices, or any draft you would rather not upload to a stranger's server. The resulting PDF carries selectable text, vector code blocks that scale crisply at any zoom, and small file sizes (typically 50 to 500 KB), all in a layout tuned for readable long-form prose.",
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
    relatedTools: ["wav-to-mp3", "m4a-to-mp3", "audio-trimmer", "merge-audio"],
    aboutText: "WAV is the standard uncompressed audio format used in professional audio editing, music production, broadcasting, and archiving. Many digital audio workstations (DAWs) like Audacity, Logic Pro, Ableton Live, and Pro Tools work best with WAV files, and some audio processing workflows strictly require uncompressed input. Converting MP3 to WAV restores a lossless container — it is important to understand that quality lost during the original MP3 compression cannot be recovered, but the WAV output ensures no further degradation occurs during editing, processing, or re-encoding. This tool decodes your MP3 using the browser's Web Audio API, which leverages your system's native audio codecs for accurate decoding, and re-encodes the raw PCM data as a standard WAV file. The entire process happens in your browser — no files are uploaded to any server, making it safe for converting private recordings, licensed music files, or confidential audio content. Common use cases include preparing audio clips for video editing software, converting podcast recordings for post-production, and creating uncompressed versions of audio files for archival purposes.",
  },
  {
    name: "WAV to MP3",
    slug: "wav-to-mp3",
    titleTag: "Convert WAV to MP3 Online — Free & Fast",
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
    relatedTools: ["mp3-to-wav", "m4a-to-mp3", "audio-trimmer", "merge-audio"],
    aboutText: "WAV files are uncompressed and can be very large — a 3-minute song at CD quality (44.1 kHz, 16-bit stereo) is roughly 30 MB. This makes WAV impractical for sharing via email, messaging apps, or web uploads. Converting to MP3 can reduce the file size by 80-90% while retaining good listening quality that most people cannot distinguish from the original. This tool uses the lamejs MP3 encoder running entirely in your browser via JavaScript — no server uploads, no plugins, and no software to install. Choose your preferred bitrate to match your needs: 128 kbps for spoken word and small file sizes, 192 kbps for a good balance between quality and size, and 256-320 kbps for near-transparent quality suitable for music. Common use cases include converting voice recordings for email sharing, compressing podcast recordings for distribution, preparing music files for portable devices with limited storage, and reducing the size of audio assets for web applications.",
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
    relatedTools: ["wav-to-mp3", "mp3-to-wav", "audio-trimmer", "merge-audio"],
    aboutText: "M4A is Apple's preferred audio format — used by iTunes, Apple Music, iPhone voice memos, and GarageBand exports. While M4A (AAC) offers better compression than MP3 at the same bitrate, MP3 remains the most universally compatible audio format, supported by virtually every device, media player, and platform in existence. This tool bridges that compatibility gap by decoding M4A files using your browser's built-in AAC decoder (via the Web Audio API) and re-encoding to MP3 with the lamejs encoder. No plugins, no uploads, and no server processing — everything happens locally in your browser. Choose your preferred bitrate from 128 kbps (smaller files, suitable for voice recordings) to 320 kbps (highest quality, ideal for music). Common use cases include converting iPhone voice memos for sharing with Android users, preparing iTunes music files for older MP3 players, converting podcast recordings for universal distribution, and making GarageBand exports compatible with platforms that only accept MP3. Since the conversion runs entirely on your device, your audio files remain completely private — important for personal voice memos, confidential recordings, and licensed music content.",
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
    relatedTools: ["mp3-to-wav", "wav-to-mp3", "m4a-to-mp3", "merge-audio"],
    aboutText: "Need to cut a section from an audio file? Whether you are creating a custom ringtone, extracting a sound effect, clipping a favorite part of a song, isolating a quote from an interview, or trimming silence from the beginning and end of a recording, this tool handles it with precision. Upload your MP3, WAV, OGG, M4A, or FLAC file and use the waveform display to visually set the start and end times for your clip. Fine-tune the selection with the IN and OUT sliders — the cut is made on the decoded samples, so it lands exactly where you asked rather than snapping to a keyframe the way video trimming does. Choose to export the trimmed clip as MP3 (smaller file size, great for sharing) or WAV (lossless quality, ideal for further editing). The tool decodes your audio using the Web Audio API, slices the AudioBuffer to the specified time range, and re-encodes it cleanly without any glitches or artifacts at the cut points. Everything runs in your browser — no files are uploaded to any server, keeping your audio completely private. This makes it safe for trimming confidential interviews, personal recordings, and licensed audio content.",
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
    relatedTools: ["audio-trimmer", "wav-to-mp3", "mp3-to-wav", "m4a-to-mp3"],
    aboutText: "Need to combine multiple audio files into one? Whether you are assembling podcast segments, joining music tracks into a continuous mix, combining voice recording takes, or building an audio compilation, this tool merges multiple audio files seamlessly. Upload your files in any combination of formats — MP3, WAV, OGG, M4A, and FLAC are all supported, and you can mix different formats in the same merge. Use the up and down arrows on each row to put them in the exact sequence you want, then download a single merged file as MP3 (compact, ideal for sharing) or WAV (lossless, ideal for further editing). The tool decodes each file using the Web Audio API, automatically resamples them to a consistent sample rate if the source files differ, concatenates the AudioBuffers in order, and re-encodes the result as a clean, continuous audio file. The transitions between files are seamless with no gaps or clicks.",
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
    relatedTools: ["change-audio-volume", "remove-silence", "audio-trimmer", "merge-audio", "mp3-converter"],
    aboutText: "Loudness is not volume, and it is not peak level. Two files can both peak at exactly 0 dBFS and still sound a long way apart, because what you hear is the average energy over time rather than the tallest sample in the file. That average has a unit — LUFS — and the places audio ends up publish targets in it: around −14 LUFS for music streaming, −16 for spoken word, −23 for EBU R128 television. This tool takes a file to one of those three targets using FFmpeg's loudnorm filter, which is a real loudness measurement rather than a peak search. It runs in two passes where it can. The first pass measures the programme loudness, the true peak and the loudness range of the whole file and prints them; the second pass feeds those numbers back and asks for a single, linear gain, which leaves the dynamics inside the file alone. Loudnorm does not always grant it: when one gain large enough to reach the target would push the true peak past the ceiling, it rides the gain across the file instead — the dynamics change and the result lands near the target rather than on it. It never announces that, so the second pass is asked for its own report and the page names whichever of the two gains it really applied. That first pass costs about 22 milliseconds per second of audio, which is roughly seven seconds for a five-minute episode, and the page shows what it measured. When the measurement comes back unusable — a digitally silent file reports an infinite loudness, which cannot be fed back — the run falls back to loudnorm's single-pass mode, which adjusts as it goes and lands near the target rather than on it. The page says which of the two passes really ran rather than claiming the better one. Two things are worth knowing before you use the output. Loudnorm negotiates a 192 kHz internal rate, so the sample rate is pinned back to the source's on the way out; MP3 can only carry nine sample rates, topping out at 48 kHz, so an MP3 export of a 96 kHz source is written at 48 kHz and anything else off that list is rounded up rather than to the nearest, which costs bytes instead of bandwidth; either way the page says so. And tags and cover art do not survive: the picture stream is not mapped and the metadata is explicitly dropped rather than copied across. Everything runs in this tab through FFmpeg compiled to WebAssembly, and nothing is uploaded.",
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
    relatedTools: ["normalize-audio", "reverse-audio", "remove-silence", "audio-trimmer", "merge-audio"],
    aboutText: "Sometimes the whole file is simply too quiet, or too loud, and what you want is not a loudness standard but a number of decibels. This tool applies exactly that: a gain, in dB, multiplied into every sample of the decoded file. +6 dB is roughly twice the amplitude, −6 dB roughly half, and the slider runs from −30 to +30 in half-decibel steps. There is no limiter and no compressor anywhere in the path, which is a deliberate choice and the reason the page reports what it does. A gain that pushes the loudest peak above full scale cannot be stored by any audio format; a tool that quietly flattened those peaks would be handing you a different sound from the one the number describes. So the peak is measured on the decoded samples before and after the multiply, both numbers are printed, and a run that goes over says by how much and how far to come back. The waveform on screen cannot answer that question on its own — it is normalised so the loudest bar fills the space, which is a picture of shape rather than level — so the clipping answer only appears once a run has really measured the file. On the MP3 and WAV arms nothing leaves the browser's own engines: the file is decoded with the Web Audio API, scaled in place, and encoded by a worker. FLAC output has no encoder in that worker, so that arm renders a lossless WAV and hands it to FFmpeg, which is also what decodes a container your browser refuses — WMA everywhere, and AAC or Ogg in some browsers. Length always comes out unchanged, and on the WAV and FLAC arms so do the channel count and sample rate. MP3 cannot: it carries at most two channels and 48 kHz, so a surround source is summed into stereo and anything above 48 kHz is resampled down. The run says which of those happened rather than leaving you to find out. Tags and cover art do not: decoding reduces the file to raw samples, where metadata stops existing.",
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
    relatedTools: ["change-audio-volume", "normalize-audio", "remove-silence", "audio-trimmer", "mp3-converter"],
    aboutText: "Reversing audio is the one effect that costs nothing at all in itself. The file is decoded to raw samples, each channel is walked from the last sample to the first into a new buffer of exactly the same shape, and that is the whole operation — no filter, no resampling, no interpolation, nothing that has to make a decision about the sound. Every sample that was in the file is still in the file, and the length comes out identical to what went in. The channel count and sample rate do too on the WAV and FLAC arms; MP3 is the exception, because it carries at most two channels and 48 kHz, so a surround or hi-res source is folded or resampled on the way out and the run says so. What it is used for is mostly play and mostly deliberate: reversed cymbals and risers, backwards-speech effects, the reversed-then-re-reversed reverb trick, checking whether a recording really does say the thing somebody claims it says. The cost, when there is one, lives entirely in the format you export to. WAV writes the reversed samples uncompressed at 16 bits, so nothing is thrown away, though a 24-bit source is still reduced to 16-bit on the way out. FLAC compresses them without discarding any, at roughly half the size of WAV, and is the export that costs nothing beyond the decode. MP3 is a fresh lossy encode: reversing a lossy source and exporting it as MP3 means the audio has been through two lossy encoders, which is worth knowing rather than worth avoiding at all costs. The reverse itself runs on the Web Audio API in this tab; a container your browser will not decode, and FLAC output, fall back to FFmpeg compiled to WebAssembly, which is downloaded only if one of those actually happens. Tags and cover art do not survive the decode.",
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
    relatedTools: ["normalize-audio", "audio-trimmer", "change-audio-volume", "merge-audio", "mp3-converter"],
    aboutText: "Recordings arrive with dead air on them. There is the pause before you started talking and the one after you stopped, and then there are the gaps in the middle — the moment before an answer, the space where somebody was thinking. This tool cuts either. Ends only trims the quiet run at the start and the quiet run at the end and leaves everything between them exactly as it was, pacing included; it is the mode for tidying a recording without editing it. Every gap removes each quiet stretch longer than the minimum gap wherever it falls, which shortens the file and changes its rhythm — pauses between sentences close up. That is what you want for a rough cut and not what you want for music. Two settings control what counts as quiet. The threshold is how quiet a stretch has to be: −50 dB catches room tone, and moving it nearer zero starts catching quiet speech and breath along with it, which also risks cutting into words. The minimum gap, which only matters in the second mode, leaves anything shorter alone — below about a third of a second you are closing the spaces between words rather than between sentences. The cutting is done by FFmpeg's silenceremove filter running in this tab, and the three durations on screen are FFmpeg's own report of what it read and what it wrote, so they carry its hundredth-of-a-second resolution rather than sample precision. The output sample rate is the source's on the WAV and FLAC arms — nothing here asks for a resample. MP3 is the exception it cannot help: MPEG layer III tops out at 48 kHz, so the encoder writes a 96 kHz source at 48 kHz, and the run reports it when that happens. Tags and cover art are not carried across: the picture stream is not mapped and the metadata is explicitly dropped rather than copied to the new file.",
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
    relatedTools: ["normalize-audio", "remove-silence", "audio-trimmer", "mp3-converter", "webcam-recorder"],
    aboutText: "A voice recorder that needs nothing installed and sends nothing anywhere. Pick a microphone, press Start Recording, and the browser asks for permission the way it does for any site; a level meter shows what it is actually hearing, so you find out that the wrong input is selected while you are still setting up rather than afterwards. Pause and resume are real — they call the recorder's own pause and resume — and Stop and save ends the take and offers it back for playback and download. The one thing this page will not do is pretend to be something it is not. There is no encoder on it at all. What you download is exactly what your browser's MediaRecorder wrote, and the page names that format after the fact rather than promising one in advance: in Chrome, Edge and Firefox that is normally Opus in a WebM container, and in a browser that supports none of the WebM forms it is whatever it does support, with the file extension following the container rather than a hopeful default. It is not an MP3, and no free browser recorder that claims to hand you one is doing it without a second encoding step. If you need MP3, record here and convert afterwards. The elapsed time on screen is this page's own clock rather than a property of the file: a recording is written in one-second chunks and carries no duration header, so some players show no length until they have read the whole thing. Recordings are limited only by your device's memory, and nothing is uploaded — the audio exists in this tab and in the file you save.",
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
    relatedTools: ["mp3-converter", "wav-to-flac", "ogg-to-mp3", "wav-to-mp3", "audio-trimmer"],
    aboutText: "FLAC is what you rip a CD to when you never want to make that decision again: it compresses audio without discarding any of it, so what comes back out is bit-for-bit the recording that went in. The cost is size — a FLAC album typically runs 250 to 400 MB — and a lot of the places you actually listen to music will not open the format at all. Older car head units, cheap MP3 players, console media apps, plenty of Bluetooth receivers and most upload forms want MP3. This tool decodes the FLAC and encodes an MP3 from it at the bitrate you choose. That is a real trade and worth stating plainly: FLAC is lossless, MP3 is not, so the output is smaller and permanently lossier than the source, and converting back will not undo it. What makes this the honest version of that trade is where you are starting from. A 320 kbps MP3 made from a lossless master is about as good as MP3 gets — one generation of loss, applied to audio that has none — while the same MP3 made from another lossy file is a second generation stacked on a first. Keep the FLAC files as the archive and treat the MP3s as copies for the devices that need them. The decode and the encode both run in this tab, through the Web Audio API and the lamejs encoder, so the music never leaves your device.",
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
    relatedTools: ["mp3-converter", "opus-to-mp3", "flac-to-mp3", "aac-to-mp3", "audio-trimmer"],
    aboutText: "OGG is a container, and the audio inside it is usually Vorbis — a lossy codec that was, for years, the free alternative to MP3 and AAC. It is still what a lot of game assets, older podcast feeds, Wikipedia audio, Bandcamp downloads and Linux desktop recordings arrive as. The problem is not quality; it is that Ogg Vorbis never won the compatibility argument. Plenty of car stereos, older iPods, DJ software, television media players and upload forms simply refuse the extension. Converting to MP3 fixes that, and this tool does it by decoding the Vorbis stream and encoding a fresh MP3 from the decoded samples. It is worth understanding what that costs. Vorbis already threw away the parts of the signal its model considered inaudible; MP3 now throws away the parts of what is left that its own, different model considers inaudible. That is generational loss, and it is why the two formats being roughly comparable in quality does not mean the conversion is free. There is no way to avoid it — MP3 cannot hold a Vorbis stream, so a container swap is not on the table — but you can keep it small by choosing 256 or 320 kbps, which gives the encoder enough room that the second generation stays inaudible for most listeners. Where the browser cannot decode Ogg itself, as on Safari, an FFmpeg engine served from this site takes over. Nothing is uploaded either way.",
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
    relatedTools: ["m4a-to-mp3", "mp3-converter", "m4a-to-wav", "ogg-to-mp3", "wav-to-mp3"],
    aboutText: "AAC is the codec that replaced MP3 nearly everywhere it mattered: it is what YouTube streams, what Apple Music sells, what a phone records video sound with, and what most broadcast and streaming pipelines carry. It usually arrives wrapped in an M4A or MP4 container, but it also travels raw, as an ADTS stream in a bare .aac file — the shape a lot of stream rippers, IPTV recorders and DAB radio captures produce. Both are accepted here. The reason to convert at all is compatibility rather than quality. AAC beats MP3 at the same bitrate, so the change is a downgrade on paper; what you get in exchange is a file that older car stereos, cheap players, editing software and upload forms will accept without argument. The conversion is a full decode and re-encode, and both formats are lossy, which makes the output a second generation of compression rather than a copy. Choose 256 or 320 kbps if the source is music and you want that second generation to stay inaudible; 128 kbps is plenty for speech, where the difference is hard to hear at any setting. Most browsers decode AAC natively through the Web Audio API. Where one will not — Firefox on some systems has no AAC decoder at all — the tool falls back to an FFmpeg engine served from this site, and you get the same MP3 out. Nothing is uploaded in either case.",
  },
  {
    name: "Opus to MP3",
    slug: "opus-to-mp3",
    titleTag: "Convert Opus to MP3 — Voice Notes & Audio",
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
    relatedTools: ["ogg-to-mp3", "mp3-converter", "aac-to-mp3", "audio-trimmer", "wav-to-mp3"],
    aboutText: "If you have a file ending in .opus, it is almost certainly a voice message. WhatsApp, Signal and Telegram all record voice notes as Opus in an Ogg container, and exporting a chat or saving a message hands you exactly that. Opus is an excellent codec — it was designed for real-time speech and it is genuinely better than MP3 at the low bitrates voice notes use — but almost nothing outside a browser or a messaging app will play the file. Windows Media Player, older iPhones, car stereos, transcription services, video editors and most upload forms all want MP3. This tool decodes the Opus stream and encodes an MP3 from it, which makes the file openable everywhere at the cost of a second generation of lossy compression. For speech that cost is small and 128 kbps is plenty; there is nothing to gain from 320 kbps when the source was recorded at 24. Expect the MP3 to be considerably larger than the Opus file even so, because MP3 is far less efficient at speech bitrates — a one-minute voice note that took 200 KB as Opus can land near 1 MB as a 128 kbps MP3. That is the price of a format everything opens. The decode runs through the browser where it can, through an FFmpeg engine served from this site where it cannot, and the recording never leaves your device.",
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
    relatedTools: ["m4a-to-mp3", "mp3-to-wav", "aac-to-mp3", "wav-to-flac", "audio-trimmer"],
    aboutText: "WAV is the format audio software expects. Digital audio workstations, mastering chains, forensic and transcription tools, sample libraries and broadcast delivery specs all assume uncompressed PCM, and several of them will refuse a compressed file outright rather than decode it for you. M4A is the opposite: it is what an iPhone voice memo, a GarageBand bounce, an iTunes purchase or a screen recording's audio track arrives as, and it holds AAC — compressed, lossy, and awkward to edit. Converting bridges the two. The tool decodes the M4A to raw samples and writes them into a standard 16-bit WAV at the file's own sample rate, which is what an editor wants to see. Two things are worth being clear about. The first is size: uncompressed audio runs about 10 MB per minute in stereo, so a 5 MB voice memo can land near 50 MB as a WAV. The second is quality. Decoding to WAV does not restore anything AAC discarded — that information is gone and no conversion brings it back. What the WAV gives you is a lossless container to work in, so that every edit, filter and bounce after this point costs nothing further. Most browsers decode AAC natively; where one will not, an FFmpeg engine served from this site does it instead. Either way the audio is processed in this tab and never uploaded.",
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
    relatedTools: ["flac-to-mp3", "wav-to-mp3", "mp3-to-wav", "m4a-to-wav", "merge-audio"],
    aboutText: "This is the one conversion on this page that costs nothing at all. FLAC is lossless compression: it models the waveform, stores the difference, and reproduces the original samples exactly when decoded. Run a WAV through FLAC and back and the result is bit-for-bit identical to what you started with — the same thing zipping a file does, but designed for audio and understood by audio software. The saving is real. Typical music compresses to 40 to 60 percent of its WAV size, which is why FLAC is the format of choice for archiving a CD collection, storing session masters, distributing live recordings and moving audio between studios without shipping gigabytes. Speech and quiet material often compress further; dense, loud, heavily limited material compresses less. Nothing about the conversion changes the sample rate, the bit depth or the channel layout, so a 96 kHz 24-bit master stays a 96 kHz 24-bit master. The trade-off is compatibility rather than quality: FLAC is well supported on desktop software, media servers and Android, and poorly supported in older car stereos and some Apple software, so it is an archive format rather than a delivery one. Encoding runs through FFmpeg compiled to WebAssembly inside this tab — a one-time engine download served from this site, never from a CDN — and the audio itself is never uploaded anywhere.",
  },
  {
    name: "MP3 Converter",
    slug: "mp3-converter",
    // "Any audio file" is the overclaim this registry already retired once, on
    // mp4-to-mp3's "any video file" subtitle (see the comment on that entry):
    // the picker takes eight extensions, and the description names them.
    titleTag: "MP3 Converter — WAV, M4A, FLAC, OGG to MP3",
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
    relatedTools: ["wav-to-mp3", "m4a-to-mp3", "flac-to-mp3", "ogg-to-mp3", "extract-audio"],
    aboutText: "MP3 is thirty years old, technically beaten by every codec that came after it, and still the only audio format you can hand to a stranger without asking what their device supports. That is what this page is for: one drop zone that takes the formats people actually end up with — WAV from a recorder, M4A from an iPhone, AAC from a stream, FLAC from an archive, OGG from a game or a Bandcamp download, Opus from a messaging app, WMA from an old Windows library — and writes an MP3 you can send anywhere. Pick the bitrate to match the material: 128 kbps for speech and voice memos, 192 kbps as a sensible default, 256 or 320 kbps for music you care about. Every conversion here is a decode followed by a fresh encode, never a rewrap, because MP3 cannot hold any other codec's data. When the source is lossless — WAV or FLAC — that is one clean generation of loss and 320 kbps gets you close to transparent. When the source is already lossy, the encode stacks a second generation on the first, which is unavoidable and worth spending a higher bitrate on. The browser decodes what it can through the Web Audio API; for the formats it cannot open, an FFmpeg engine served from this site takes over. The lamejs encoder writes the MP3. All of it happens in this tab.",
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
    relatedTools: ["mp3-converter", "aac-to-mp3", "ogg-to-mp3", "flac-to-mp3", "wav-to-mp3"],
    aboutText: "WMA is Microsoft's audio format, and if you have any it is probably because a Windows machine ripped a CD with the default settings some time between 1999 and 2012. The files still play in Windows Media Player and VLC, and almost nowhere else — no iPhone, no Mac without extra software, no browser, no modern car stereo, and no upload form. This is the one conversion on the site with no native path at all. Every other audio format here can be decoded by the browser itself on at least some platforms; WMA cannot be decoded by any of them, which means this page always loads the FFmpeg engine — a one-time download of roughly 31 megabytes, served from this site rather than a CDN, cached by your browser afterwards. Everything after that download happens in the tab: FFmpeg decodes the WMA, and the MP3 is encoded from the decoded samples. Because both formats are lossy, this is a second generation of compression, so choose 256 or 320 kbps for music you intend to keep and 128 kbps for anything that is mostly speech. One visible consequence of having no browser decoder: the waveform preview cannot draw itself for a WMA file, so the canvas says the preview is unavailable while the conversion runs perfectly well underneath it. The audio is never uploaded.",
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
    relatedTools: ["video-trimmer", "compress-video", "mp4-to-mp3", "webm-to-mp4"],
    aboutText: "Want to turn a video clip into a GIF? Animated GIFs remain one of the most popular formats for sharing short clips on social media, messaging apps, forums, and documentation. Unlike video files, GIFs play automatically in most contexts without requiring a video player. Upload your MP4, WebM, or MOV file, set the start and end time to select the exact clip you want, choose your preferred frame rate (lower for smaller files, higher for smoother animation), and set the output width to control file size. The tool decodes the video frame-by-frame in your browser and encodes the GIF with the gifenc library, building a per-frame 256-color palette for accurate color reproduction. Everything runs locally — no files are uploaded to any server, keeping your video content private. Common use cases include creating reaction GIFs, making product demo animations, illustrating UI interactions for documentation, and preparing eye-catching social media content.",
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
    relatedTools: ["video-to-gif", "compress-video", "mp4-to-mp3", "webm-to-mp4"],
    aboutText: "Need to cut a section from a video? Whether you are extracting a highlight from a long recording, clipping a specific scene for a presentation, trimming the beginning and end of a screen recording, or isolating a moment to share on social media, this tool makes it quick and easy. Upload your MP4, WebM, MOV, AVI, or MKV file and use the built-in video player to preview the content and set the start and end times. Download just the clip you need in the same format as the original, preserving video and audio quality. The trimming uses stream copy mode (no re-encoding), which means processing is near-instant regardless of the video length — it simply extracts the selected segment from the container without touching the compressed video data. This preserves the original resolution, bitrate, and quality exactly. The trade-off is that a stream copy can only cut on a keyframe, so the clip starts at the nearest keyframe at or before the time you picked — usually within a second or two, and frame-accurate cutting would require a full re-encode. Powered by FFmpeg.wasm running entirely in your browser via WebAssembly, so no video files are uploaded to any server. This makes it safe for trimming confidential meeting recordings, personal videos, and proprietary content.",
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
    relatedTools: ["video-trimmer", "video-to-gif", "wav-to-mp3", "m4a-to-mp3"],
    aboutText: "Want just the audio from a video? There are many situations where the audio track is all you need — extracting background music from a video, saving the audio from a lecture or conference talk for listening on the go, pulling the soundtrack from a movie trailer, converting a video podcast to an audio-only format for your podcast player, or saving the narration from a tutorial. Upload your MP4, WebM, MOV, AVI, or MKV file and extract the audio track as an MP3 file with your preferred bitrate. Choose from 128 kbps for spoken word content and smaller files, 192 kbps for a good balance, or 256-320 kbps for music where quality matters most. The tool uses FFmpeg.wasm to decode the video container and encode the audio stream, running entirely in your browser via WebAssembly. No video files are uploaded to any server, ensuring complete privacy for personal recordings, copyrighted content, and confidential meeting recordings. The extraction process focuses on the audio stream, so even very large video files produce compact MP3 output.",
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
    relatedTools: ["video-trimmer", "compress-video", "video-to-gif", "screen-recorder"],
    aboutText: "WebM is the default format for browser screen recordings and many web-based recording tools, but it has limited compatibility outside the web. Many devices, social media platforms (Instagram, TikTok, LinkedIn), video editors (iMovie, Premiere Pro, DaVinci Resolve), and messaging apps do not handle WebM well or at all. This tool transcodes your WebM file to H.264/AAC MP4 — the most widely supported video format across virtually every device, platform, and application. The H.264 codec provides excellent compression while maintaining sharp video quality, and AAC audio ensures the soundtrack comes through cleanly. Note that this is a genuine re-encode rather than a container swap: the WebM's VP8/VP9 video is decoded and re-encoded as H.264, so expect a small quality cost. Encoding uses the browser's built-in WebCodecs API with mp4-muxer — hardware-accelerated where your device offers it — and runs entirely in the tab, so no video files are uploaded to any server. In-browser encoding requires Chrome or Edge. This makes it safe for converting screen recordings of confidential work, product demos, internal presentations, and any other sensitive content. Common use cases include converting screen recordings for upload to social media, preparing tutorial videos for platforms that require MP4, and making recordings compatible with video editing software for post-production.",
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
    relatedTools: ["video-trimmer", "webm-to-mp4", "video-to-gif", "mp4-to-mp3"],
    aboutText: "Video files too large to share via email, messaging apps, or social media? Raw recordings and high-quality video files can easily be hundreds of megabytes or even gigabytes, far exceeding the limits of most sharing platforms. This tool offers smart compression presets optimized for common use cases: WhatsApp (720p resolution at approximately 1 Mbps, fitting within WhatsApp's file size limits), Email (480p at approximately 500 kbps, small enough for most email attachment limits), and Web (up to 1080p at approximately 2 Mbps, ideal for uploading to websites or cloud storage). The tool re-encodes your video to the H.264 codec using the browser's native WebCodecs API with mp4-muxer — hardware-accelerated where available, providing excellent visual quality at dramatically reduced file sizes. The compression typically reduces file size by 50-90% depending on the preset and source material. Everything runs in your browser — no video files are uploaded to any server, ensuring complete privacy for personal videos, confidential meeting recordings, and proprietary product demos. Supports MP4, WebM, and MOV input formats (in-browser encoding requires Chrome or Edge).",
  },
  {
    name: "Compress Video to Size",
    slug: "compress-video-to-size",
    titleTag: "Compress Video to 25 MB, 16 MB or 10 MB",
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
    relatedTools: ["compress-video", "video-trimmer", "webm-to-mp4", "video-to-gif", "subtitle-converter"],
    aboutText: "Every upload box has a number on it. Email attachments stop at about 25 MB, WhatsApp at 16 MB, a Discord message without Nitro at 10 MB — and a phone recording sails past all three within a minute. This page takes the number as the input. Pick 25, 16 or 10 MB, or type your own, and the compressor works backwards: it measures how long the clip runs, subtracts what the audio track will cost, leaves an allowance for the container's own bookkeeping, and divides the rest across the duration to get a video bitrate. It then picks the largest frame height that bitrate can honestly carry — spending few bits on many pixels is how a target gets met and a video gets destroyed — and encodes once. It will not spend a ceiling it does not need, either: aim 25 MB at a 4 MB clip and the bitrate is solved against what that clip already spends rather than against the 25 MB. What it cannot hand back is the clip itself. There is no pass-through here — every run is a fresh WebCodecs encode — so a file that already fits can come back no smaller, and when it does the page says so and tells you to keep your original. Nor can it promise the number. A video encoder is handed a bitrate, not a file size, and how close the finished file lands depends on the footage — a static talking head undershoots, a handheld pan through leaves overshoots, and no solver can know which you have before it encodes it. So the result is reported as what it is: the size actually produced, next to the size you asked for, with a plain statement when the target was not met rather than a file quietly larger than your limit. There is a floor as well, and it matters. Below a certain bitrate H.264 stops looking like your video and starts looking like blocks, so the solver will not go under it; a forty-minute recording asked to fit in 10 MB will come back at the floor, above your target, and say so. Trimming the clip first is the honest answer to that, and the video trimmer is one page over. The encoding runs on WebCodecs — the browser's own H.264 encoder, hardware-accelerated where the machine offers it — and mp4-muxer writes the MP4. That is the same path the main video compressor uses; the difference here is only which end of the arithmetic you supply. It also means this page needs a browser with WebCodecs, which today is Chrome and Edge: Safari and Firefox are told so up front rather than part-way through an encode. Nothing is uploaded — the clip is decoded, re-encoded and muxed inside this tab.",
  },
  {
    name: "Screen Recorder",
    slug: "screen-recorder",
    titleTag: "Screen Recorder — Free, In Your Browser",
    category: "video-tools",
    toolType: "screen-recorder",
    description: "Record your screen, window, or browser tab — with optional microphone audio. No extension required. Save as WebM, ready to share or edit.",
    hubLine: "Screen, window or tab, with optional mic.",
    keywords: ["screen recorder", "record screen online", "screen capture", "browser screen recorder", "screen recording tool"],
    h1: "Screen Recorder — Free Browser-Based Screen Capture",
    subtitle: "Record your screen, a window, or a tab — no extensions or downloads needed.",
    acceptFormats: "",
    takesNoFile: true,
    relatedTools: ["webm-to-mp4", "video-trimmer", "compress-video", "video-to-gif"],
    aboutText: "Record your screen directly from your browser using the native Screen Capture API — no browser extensions, desktop software, or sign-ups required. Choose to record your entire screen (great for full workflow demonstrations), a specific application window (ideal for focused tutorials), or a single browser tab (perfect for recording web app demos). Optionally include audio from your microphone for narration or voice-over, or capture system audio to record the sounds from your application. Preview the recording before saving to make sure it captured exactly what you need, then download as a WebM file. If you need MP4 format for broader compatibility, use the companion WebM to MP4 converter tool. Common use cases include creating software tutorials and how-to videos, recording bug reproduction steps for development teams, capturing online meeting highlights, making product demo videos, and documenting workflows for training materials. The recording uses your browser's built-in MediaRecorder API for efficient capture with minimal CPU overhead.",
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
    titleTag: "Convert Video to MP4 Online — Free & Private",
    category: "video-tools",
    toolType: "video-remux",
    description: "Convert MOV, MKV, AVI and M4V files to MP4 in your browser. Compatible video is rewrapped in milliseconds with no re-encode and no quality loss.",
    hubLine: "One container out, whatever went in.",
    keywords: ["video to mp4", "convert video to mp4", "video converter", "mp4 converter online", "change video format"],
    h1: "Convert Video to MP4 Online — Free, No Upload Required",
    subtitle: "Rewrap MOV, MKV, AVI or M4V as MP4 — usually without re-encoding a single frame.",
    acceptFormats: ".mov,.mkv,.avi,.m4v",
    maxSizeMB: 1536,
    relatedTools: ["mov-to-mp4", "mkv-to-mp4", "avi-to-mp4", "webm-to-mp4", "compress-video"],
    aboutText: "MP4 is the container almost everything opens: phones, TVs, browsers, editors, and every upload form that rejects everything else. Most of the time the video inside your MOV, MKV, AVI or M4V is already H.264 — the exact codec MP4 wants — and the only thing standing between you and a working file is the wrapper around it. This tool reads the file's streams first, then rewraps them. When the codec fits MP4, the compressed video data is copied across byte for byte: nothing is decoded, nothing is re-encoded, and the run finishes in milliseconds rather than minutes. The picture you get out is the picture you put in. When the codec does not fit — an iPhone recording in H.265, say, or an older AVI codec MP4 has no tag for — the tool tells you before it runs and offers a conversion to H.264 as an explicit second choice, with the cost stated plainly: that path decodes and re-encodes every frame, so it is slow and it is lossy. FFmpeg compiled to WebAssembly does the work inside the tab; the file is never uploaded.",
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
    relatedTools: ["video-to-mp4", "mp4-to-mov", "mkv-to-mp4", "compress-video", "video-trimmer"],
    aboutText: "MOV is Apple's QuickTime container, and it is what an iPhone, an iPad or a Mac screen recording hands you. MP4 is what everything else asks for. The two containers are close relatives — both are ISO base media files — so a MOV holding H.264 video can become an MP4 by rewriting the wrapper alone, with the compressed video and audio copied across untouched. That takes milliseconds and costs nothing in quality. The catch is that iPhones have shot H.265 (HEVC) by default for years, and an H.265 file wrapped as .mp4 is still an H.265 file: it will play on newer Apple hardware and fail on plenty of the places people are actually trying to upload to. So this tool reads the video stream before doing anything and tells you which case you are in. If it is H.264, it rewraps and says nothing was re-encoded. If it is H.265, it offers a real conversion to H.264 as a separate, clearly-labelled choice — slower, and lossy, because every frame is decoded and encoded again. Everything runs in your browser through FFmpeg compiled to WebAssembly.",
  },
  {
    name: "MP4 to MOV",
    slug: "mp4-to-mov",
    titleTag: "Convert MP4 to MOV Online — Free & Private",
    category: "video-tools",
    toolType: "video-remux",
    description: "Convert MP4 files to QuickTime MOV for Final Cut, iMovie and QuickTime Player. The video stream is copied across untouched — no re-encode.",
    hubLine: "Back into QuickTime's own wrapper.",
    keywords: ["mp4 to mov", "convert mp4 to mov", "mp4 to quicktime", "mov converter", "mp4 to mov online"],
    h1: "Convert MP4 to MOV Online — Free QuickTime Converter",
    subtitle: "Rewrap an MP4 as a QuickTime MOV without re-encoding the video.",
    acceptFormats: ".mp4,.m4v",
    maxSizeMB: 1536,
    relatedTools: ["mov-to-mp4", "video-to-mp4", "mp4-to-mkv", "mute-video", "video-trimmer"],
    aboutText: "Some Apple software is happier with a .mov extension than a .mp4 — older Final Cut and iMovie import paths, a few QuickTime workflows, and the occasional piece of broadcast software that keys off the container rather than the codec. Because MP4 and MOV are both ISO base media containers built from the same box structure, moving between them does not touch the video at all: the compressed H.264 or H.265 stream and its audio are copied straight into the new wrapper. The run takes milliseconds regardless of how long the clip is, and the result is bit-for-bit the same picture and sound — this is a container swap, not a conversion. The tool reads the file's streams first and shows you what it found, so the claim that nothing was re-encoded is made after the decision rather than before it. If a stream turns up that QuickTime's container cannot hold, you are told before the run rather than handed a file that fails to open. FFmpeg runs as WebAssembly inside the tab; the video is never uploaded anywhere.",
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
    relatedTools: ["video-to-mp4", "mp4-to-mkv", "avi-to-mp4", "mp4-to-mp3", "video-trimmer"],
    aboutText: "MKV is a superb container and a terrible one to hand somebody. Matroska will hold essentially any codec, which is why it is the default output of so many rippers and downloaders — and why iPhones, smart TVs, PowerPoint and most video editors refuse to open it. The video inside is very often plain H.264, so the fix is not a conversion at all: it is unwrapping the streams from Matroska and rewrapping them as MP4, with the compressed data copied across unchanged. That runs in milliseconds and the picture is identical to the source, because no frame is ever decoded. The tool inspects the streams before it starts, so it can tell you which case you are in rather than guessing. Where a stream cannot live in MP4 — MKV happily carries codecs MP4 has no tag for — you are told up front and offered an H.264 conversion as a separate choice, with its real cost named: that path re-encodes, so it is slow and lossy. FFmpeg runs as WebAssembly in the tab and nothing is uploaded.",
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
    relatedTools: ["mkv-to-mp4", "mp4-to-mov", "video-to-mp4", "mute-video", "video-trimmer"],
    aboutText: "Matroska is the container people reach for when MP4's rules get in the way: it takes almost any codec, any number of audio tracks, and subtitle and chapter structures MP4 handles badly or not at all. It is also what a lot of media-server and home-theatre software prefers. Going from MP4 to MKV is the easy direction — Matroska can hold whatever MP4 was holding — so the conversion is a pure container swap. The compressed video and audio are copied into the new wrapper byte for byte, nothing is decoded, and the run finishes in a few milliseconds no matter how long the clip is. Because the streams are untouched, the output is exactly as good as the input; the only thing that changes is the box around it, and the file size shifts slightly because the two containers keep their bookkeeping differently. The tool probes the file first and reports what it actually did, so the lossless claim is never made about a run that was not. Everything happens locally through FFmpeg compiled to WebAssembly.",
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
    relatedTools: ["video-to-mp4", "mkv-to-mp4", "mov-to-mp4", "compress-video", "video-trimmer"],
    aboutText: "AVI is a container from 1992, and it is what old camcorders, screen-capture utilities and Windows-era software left behind on a lot of hard drives. Modern phones, browsers and editors mostly will not open it. What is inside varies enormously: an AVI can hold H.264, in which case MP4 can take the stream as-is and the conversion is a millisecond-scale rewrap with no quality cost at all, or it can hold something much older — MPEG-4 Part 2, MJPEG, an ancient DivX variant — that MP4 has no clean tag for. Guessing between those two cases is how you end up with a zero-byte file and a tool that claims success, so this one reads the streams first and tells you which you have. Compatible files are copied straight over, unchanged. Incompatible ones are offered an H.264 conversion as an explicit choice, labelled for what it is: a full decode and re-encode, slow and lossy, but the only way that footage becomes portable. FFmpeg runs as WebAssembly inside your browser and the file never leaves your device.",
  },
  {
    name: "Mute Video",
    slug: "mute-video",
    titleTag: "Remove Audio from Video — Free & Private",
    category: "video-tools",
    toolType: "mute-video",
    description: "Remove the audio track from a video and keep the picture bit for bit. The video stream is copied, never re-encoded, so quality is untouched.",
    hubLine: "Drops the audio, copies the picture.",
    keywords: ["mute video", "remove audio from video", "silence video", "strip audio track", "video without sound"],
    h1: "Remove Audio from Video Online — Free Video Muter",
    subtitle: "Strip the audio track out of a video without re-encoding the picture.",
    acceptFormats: ".mp4,.mov,.mkv,.m4v",
    maxSizeMB: 1536,
    relatedTools: ["rotate-video", "video-trimmer", "mp4-to-mp3", "video-to-mp4", "compress-video"],
    aboutText: "Sometimes the audio is the problem: background chatter on a clip you want to post, copyrighted music that will get a video muted or taken down anyway, a screen recording that caught more of the room than you meant it to, or footage headed for an edit that will get its own soundtrack later. Muting a video does not require re-encoding it. The audio track is simply left out of the new file while the compressed video stream is copied across byte for byte — so the output is the same resolution, the same bitrate and the same picture as the source, just without the sound. On a short clip the whole operation is a few milliseconds, and it stays fast on long ones because no frame is ever decoded. The file keeps its original container, so a muted MP4 is still an MP4 and drops into the same places the original did. If you want the audio rather than the video, the MP4 to MP3 tool pulls the track out instead of discarding it. FFmpeg runs as WebAssembly in the tab; nothing is uploaded.",
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
    relatedTools: ["mute-video", "video-trimmer", "video-to-mp4", "video-to-gif", "compress-video"],
    aboutText: "A video shot sideways is almost never sideways in the file. MP4 and MOV both store a display matrix — a small piece of container metadata that tells a player how to turn the frames before showing them — and a phone that was held the wrong way simply writes the wrong value into it. Fixing that means rewriting one field, not re-encoding a single frame, and the difference is not subtle: on a ten-second 720p clip the flag rewrite measured six milliseconds against roughly seven and a half seconds for the equivalent re-encode, and the flag rewrite is lossless while the re-encode is not. The honest caveat is that a rotation flag is a request, not a guarantee. Most modern players — QuickTime, VLC, iOS, Android, current browsers — read it and rotate accordingly; some editors, some older players and some upload pipelines ignore it and will show the clip exactly as it was shot. The stored frame dimensions do not swap either — a 1920×1080 file rotated 90 degrees still reports 1920×1080 with a flag attached. Preview the result before you rely on it. FFmpeg runs as WebAssembly in your browser.",
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
    titleTag: "Extract Audio from Video — Free & Private",
    category: "video-tools",
    toolType: "extract-audio",
    description: "Extract the audio track from an MP4, WebM, MOV, AVI or MKV video. The default lifts the track out without re-encoding it; MP3 and WAV are one click away.",
    hubLine: "Lift the track out, or re-encode it.",
    keywords: ["extract audio from video", "video to audio", "rip audio from video", "get audio from mp4", "extract soundtrack"],
    h1: "Extract Audio from Video — Free, No Upload Required",
    subtitle: "Pull the audio track out of MP4, WebM, MOV, AVI or MKV — losslessly, or as MP3 or WAV.",
    acceptFormats: ".mp4,.webm,.mov,.avi,.mkv",
    relatedTools: ["mp4-to-mp3", "video-to-wav", "mp4-to-wav", "video-trimmer", "mute-video"],
    aboutText: "A video file is a box with separate streams inside it, and the audio is one of them. Getting it out does not require converting anything: FFmpeg can lift the encoded audio track from the container and write it into a new one without decoding a single sample, which takes milliseconds and is bit-for-bit lossless. That is what this tool does by default, and the page tells you afterwards whether the copy actually happened rather than promising it in advance. What you get back is the track in whatever codec the video was carrying — usually AAC from an MP4 or MOV, Opus or Vorbis from a WebM — in a container that matches. That is the right choice when you want the audio itself: a lecture to listen to, a podcast track pulled from its video version, a piece of music from a performance recording. The other two arms decode that track and encode it again. Choose MP3 when the file has to play on absolutely anything, at a bitrate no higher than the video's own audio track — going above it buys nothing. Choose WAV when the audio is heading into an editor, a transcription tool or a DAW that wants uncompressed samples. Both are re-encodes and both cost a generation of quality, which is why they sit behind a named choice rather than happening silently. FFmpeg runs as WebAssembly inside your browser and the video is never uploaded.",
  },
  {
    name: "Video to WAV",
    slug: "video-to-wav",
    // 62 chars with the " | Transmute" suffix, which ties the site's longest
    // title; the H1 keeps its longer copy and only the tab/SERP line shortens.
    titleTag: "Convert Video to WAV — Free Audio Extractor",
    category: "video-tools",
    toolType: "extract-audio",
    description: "Pull the audio out of a video and save it as uncompressed 16-bit WAV for editing and transcription. Works with MP4, WebM, MOV, AVI and MKV files.",
    hubLine: "Uncompressed audio, straight from video.",
    keywords: ["video to wav", "convert video to wav", "extract wav from video", "video audio to wav", "mkv to wav"],
    h1: "Convert Video to WAV Online — Free Audio Extractor",
    subtitle: "Extract a video's audio track as an uncompressed WAV file, ready for an editor.",
    acceptFormats: ".mp4,.webm,.mov,.avi,.mkv",
    relatedTools: ["extract-audio", "mp4-to-wav", "mp4-to-mp3", "mp3-to-wav", "audio-trimmer"],
    aboutText: "Audio software wants WAV. Digital audio workstations, transcription engines, forensic tools, subtitle timing software and most speech-to-text pipelines all expect uncompressed PCM, and several of them will reject a compressed file rather than decode it for you. Video files hardly ever carry uncompressed audio — the track inside is normally AAC, Opus, Vorbis, AC-3 or MP3, compressed to keep the file small — so getting from one to the other means decoding the track and writing the samples out uncompressed. That is what this tool does. Drop in an MP4, WebM, MOV, AVI or MKV and it demuxes the audio stream, decodes it, and writes a standard 16-bit WAV at the track's own sample rate. Two honest points about what that means. Decoding to WAV does not recover anything the original encoder discarded; the file is lossless from this point forward, not lossless all the way back. And it is big: expect roughly 10 MB per minute of stereo, so a two-hour recording lands over a gigabyte. If you only need something to listen to, the MP3 arm of the audio extractor is a far smaller file; WAV earns its size when the audio is going into a tool that needs samples rather than sound. FFmpeg compiled to WebAssembly does the work in this tab and the video is never uploaded.",
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
    relatedTools: ["extract-audio", "video-to-wav", "mp4-to-mp3", "video-trimmer", "wav-to-mp3"],
    aboutText: "The audio inside an MP4 is almost always AAC — compressed, lossy, and fine for listening but awkward for working with. Editing suites, mastering chains, transcription services and speech-to-text tools generally want uncompressed PCM in a WAV container, and some of them refuse anything else outright. This tool bridges the two: it demuxes the audio stream out of the MP4, decodes it, and writes a standard 16-bit WAV at the track's own sample rate, which is the shape those tools expect to receive. It is worth being clear about what the conversion does and does not do. It does not restore quality — whatever AAC discarded when the video was made is gone, and decoding to WAV cannot bring it back. What it does give you is a lossless working copy, so that every edit, filter and export after this point adds nothing further. The other thing to expect is size: uncompressed stereo audio runs about 10 MB per minute, so a one-hour recording becomes a file over half a gigabyte. When you just want something to listen to, MP3 is the better output and the audio extractor offers it. FFmpeg compiled to WebAssembly does the demux and the decode inside this tab; the video never leaves your device.",
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
    // 65 chars with the " | Transmute" suffix, past what a SERP line shows;
    // the H1 keeps the longer copy and only the tab/SERP title shortens.
    titleTag: "Video to Images — Free Frame Extractor",
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
    relatedTools: ["video-thumbnail", "video-to-gif", "split-video", "video-trimmer", "compress-video"],
    aboutText: "Turning a video into a folder of pictures is the sort of thing that normally means installing FFmpeg and learning a filtergraph. This does it in the browser instead, and it does it without FFmpeg at all: the clip is played through your browser's own video decoder, every frame it presents is drawn onto a canvas, and the canvas encodes it as PNG, JPEG or WebP. No conversion engine is downloaded and nothing is uploaded. There are two ways to choose which frames you get. Every N seconds takes the first frame at the very start of the clip and then one at each interval until the end, which is what you want for a contact sheet or a set of stills to pick from. Fixed count spaces the frames evenly and takes each one from the middle of its slice, so the first picture is a picture rather than the black leader most clips open on. One run saves at most 300 frames, and that ceiling is stated before you click as well as after: the page shows how many frames the settings ask for, how many will be saved, and where in the clip the run stops. It never quietly hands back a shorter set. Two other honesty notes. A video only carries pictures where it carries pictures, so asking for one every half-second from a clip shot at one frame per second cannot invent the ones in between — the saved frame is stamped with the time it really came from, and the run reports how many of the moments you asked for landed inside a picture already saved. And a browser that cannot write WebP from a canvas falls back to PNG, in which case the files are named .png and the page says so. The output is always a ZIP, even for a single frame, with each file named by its position and the exact moment it came from so 300 files still unzip in order.",
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
    relatedTools: ["video-to-images", "video-to-gif", "video-trimmer", "split-video", "compress-video"],
    aboutText: "A poster frame, a social card, a still to put in a document — one picture out of a video, taken from a moment you choose. Load the clip, scrub the player to the frame you want, press Use the player's position or move the time slider, and capture. The picture comes off your browser's own video decoder through a canvas; there is no conversion engine to download and the file is never uploaded. Two numbers on the page are reported rather than assumed, and both matter. The first is the time. A video carries pictures only at its own frame times, so a seek lands the playhead where you asked and the decoder presents the first frame at or after it — which is normally within a frame of your request and is occasionally further. What you get back is stamped with the time it really came from, and that is the time in the filename. A request inside the last quarter-second of a clip is also pulled back, because the frame walk needs a moment after the seek to present anything, and the page warns about that before you click rather than leaving you to notice it in the filename afterwards. The second is the size. The width choice never upscales: asking a 640-wide clip for a 1280-wide still gives you 640, so the picture is always real pixels, and the readouts print the size that was actually written. JPEG is the usual choice and the smallest; PNG is lossless and much larger, worth it when the still is going to be edited rather than posted; WebP is smaller than JPEG at the same setting, with a PNG fallback and a note on screen in browsers that cannot write it from a canvas. One frame is one frame — this is a still from your video, not a re-encode of it, so the picture quality is whatever the source carries at that moment.",
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
    relatedTools: ["merge-video", "video-trimmer", "video-to-images", "compress-video", "video-to-mp4"],
    aboutText: "Splitting a video normally means decoding every frame and encoding it again, which is slow and costs quality on every part. This does not do that. Each part is one FFmpeg run that copies the compressed picture and sound straight across, so a part holds the same bytes the source did and the whole job finishes in a fraction of the time a re-render would take. There are three ways to say where the cuts go: a number of equal parts, a fixed length for every part, or a list of times you type in seconds or minutes and seconds — where each time is the point one part ends and the next begins, so three times give four parts. The price of copying rather than re-encoding is the one thing this page repeats, because it is the tool's only real surprise: a stream copy can only cut at a keyframe. A boundary that falls between keyframes moves back to the nearest one, so a part starts a little earlier than you asked and runs a little longer. Measured on this engine with a 2.09-second clip, a part asked to be 1.000 second came out at 1.022, and one asked to start at 0.5 seconds and run for 1.0 came out at 1.510 because the seek snapped back to the keyframe at the start of the file. The table on screen therefore has two length columns — what was asked for, and what the written file actually measures, read back off each finished part. A page that showed only the first would be describing files that do not exist. Every part keeps the original format and quality, and they arrive together in one ZIP, because browsers cancel most of a burst of separate downloads. At most a hundred parts in one go: each one is its own pass through the engine.",
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
    relatedTools: ["split-video", "video-trimmer", "video-to-mp4", "compress-video", "merge-audio"],
    aboutText: "This tool joins clips end to end and never re-encodes anything, which means it is fast and lossless and also means it cannot join everything. The clips are copied into one file exactly as they are, so they have to share a video codec, a frame size, a pixel format, an audio codec, sample rate and channel count — or all be silent — a container the copy can be written into, and the timing base that container counts in. Two MP4s that agree on everything else and count time differently were measured on this build to produce a join whose picture runs out of step with its own sound, so that is checked too. Anything that does not match is refused, by file name and by the property that differs, before a single byte is written. That refusal is the point of the page rather than an error path, and there is a measurement behind it. FFmpeg's concat demuxer, handed clips that do not match, does not fail: it reports success and writes a file with clips missing. Measured on the build this page runs, an MP4 and an MKV holding identical H.264 video at the same size and pixel format with identical AAC audio produced exit code zero and a file containing only the first clip. Nothing in that pair differs except the container and the timing base it counts in — 1/57600 against 1/1000, measured side by side — which is why both are checked as well as everything inside them. Two independent guards enforce this. Every clip is read as it lands and compared against the first, so the mismatch table appears while you are still building the queue; and the join itself re-checks for the same reasons and then measures the finished file against the total length of its parts, failing if it comes up short or runs long. There is deliberately no fall back to re-encoding. A clip in the wrong container or codec can usually be rewrapped losslessly by the Video to MP4 tool, though the tool doing the rewrap picks its own timing base for the file it writes — measured here, an MKV rewrapped to MP4 came out counting in 1/16000 where the untouched MP4 counted in 1/57600, so the pair can come back and be refused on that row instead; a clip at a different frame size has to be re-encoded to match, which nothing here does in one step. Naming what differs and pointing at the fix is a better answer than a re-encode you did not ask for.",
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
    relatedTools: ["screen-recorder", "audio-recorder", "webm-to-mp4", "video-trimmer", "compress-video"],
    aboutText: "A camera recorder that needs no extension, no desktop software and no account, and that sends nothing anywhere. Pick a camera, decide whether to include microphone audio, and press Start Recording; the browser asks for permission the way it does for any site, the live preview appears as the recording starts rather than before it, and pause and resume work on the recorder itself. On a phone the Front and Rear choice picks between the cameras, which is what facingMode is for; most desktop webcams report no facing at all, so it changes nothing there, and it is ignored entirely once you name a specific camera. Camera and microphone are asked for in the same call, so turning the microphone off means the browser never requests it — this page cannot record you without also having asked. The device list is worth one note: browsers hide camera names until a page has been allowed to use one, so the picker may show a count without names until the first recording, after which the real names appear. What you download is exactly what your browser's MediaRecorder wrote, and the page names that format after the fact rather than promising one: normally VP9 or VP8 with Opus in a WebM container, and MP4 in a browser that supports none of the WebM forms, with the file extension following the container. If you need MP4 specifically, the WebM to MP4 tool converts it afterwards. The elapsed time is this page's own clock rather than a property of the file — a recording is written in one-second chunks and carries no duration header, so some players show no length until they have read the whole thing. Length is limited only by your device's memory.",
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
    relatedTools: ["json-to-yaml", "yaml-formatter", "json-formatter", "json-minify", "xml-formatter"],
    aboutText: "YAML and JSON describe the same kinds of data, but they do not describe them the same way, and the interesting part of converting one to the other is what happens where they disagree. A YAML stream can hold several documents separated by three dashes and JSON cannot, so a multi-document file comes out as a JSON array and the count is printed rather than assumed. YAML keys can be numbers, booleans, dates or whole sequences, while JSON keys are strings only, so any key that is not one is found in the source and listed with the string it becomes. A date key is the one to look at: it is converted through your own machine's time zone and locale, which is not something to discover a week later. Anchors and aliases are one node referenced twice, and JSON has no way to say that, so each alias is expanded and counted, which is exactly why the output is larger than the input. A cyclic anchor stops the conversion outright with the path named, instead of throwing somewhere nobody looks. Timestamps become ISO strings with a time attached. The parsing is js-yaml, reading its safe default schema, and the whole run happens in this tab — the file is never sent anywhere, and the same page converts back the other way with one click.",
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
    relatedTools: ["yaml-to-json", "yaml-formatter", "json-formatter", "json-minify", "json-to-csv"],
    aboutText: "Turning JSON into YAML sounds like the easy direction and is actually the lossy one. The YAML writer takes a JavaScript value rather than text, so the JSON has to be parsed first, and a JSON parse is where a number longer than about sixteen significant digits stops being the number you wrote. 12345678901234567890 comes back as 12345678901234567000, and a decimal point is no protection: 0.1234567890123456789 comes back as 0.12345678901234568, two digits shorter. Alongside that, the trailing zero on 1.0 disappears, 1e2 becomes 100, and a key written twice in the same object loses its earlier value with no error at all. None of that is avoidable on this page, so rather than hiding it, the raw JSON text is scanned before the parse runs and every literal that is about to change is listed with its line, what you wrote, and what it becomes. Read that list before you save the file; if the digits matter, quote them in the source so they arrive as strings. Beyond the numbers the conversion is ordinary. Pick two or four spaces of indent, choose whether long strings wrap into folded block scalars or run on, and take the result by copy or by download. Comments are not carried across, because JSON has none to carry, and the input has to be strict JSON — a trailing comma or a double-slash comment is a parse error, reported with its line and column.",
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
    relatedTools: ["yaml-to-json", "json-to-yaml", "json-formatter", "xml-formatter", "text-diff"],
    aboutText: "This is a YAML formatter that says what it is: the file is read into values with js-yaml and printed again, rather than having its whitespace shuffled around in place. That makes the output guaranteed-valid YAML meaning exactly what the input meant, and it means several things about the text do not come back. Comments are the big one — the parser discards them as it reads and never records where they were, so there is nothing left to write out. Blank lines go the same way, quoting is normalised to whatever the writer thinks each value needs, a merge key is resolved into the keys it merged, and an anchor you named &base comes back as &ref_0, and an anchor on a plain value rather than a mapping loses even that — the value is written out again at each use and the anchor is gone from the file. Where a change can be counted it is counted: how many documents the stream held, which keys were not strings and are about to be quoted or, worse, rendered through your local time zone, and how many nodes will be re-anchored. Validation comes free with the parse. An invalid file reports the parser's own message with the line, the column and the excerpt it prints, and nothing is rewritten until it parses cleanly. Indent, line width and alphabetical key sorting are yours to set, and sorting is off by default because it permanently loses the order the author chose.",
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
    relatedTools: ["json-formatter", "json-to-yaml", "yaml-to-json", "json-to-csv", "crlf-lf"],
    aboutText: "Minifying JSON is meant to be the safe half of formatting: nothing about the data changes, only the spaces between the tokens. Most minifiers do not manage that, because they run JSON.parse and then JSON.stringify, and that round trip is a pass through IEEE-754 doubles. A Snowflake or database id like 12345678901234567890 comes back as 12345678901234567000, a rate written 1.0 comes back as 1, 1e2 comes back as 100, and two keys with the same name silently become one. From a button labelled Minify, that is data corruption wearing a success message. This page uses the scanner the JSON formatter already ships: it walks the raw characters, copies every string, number and keyword through untouched, and emits the structural punctuation and none of the whitespace. Parsing happens separately, purely to decide whether the input is valid, and the browser's own error is what you are shown. The result is a byte count you can trust: source size, minified size, percentage saved, and how many of the removed bytes were whitespace rather than a byte-order mark. What it will not do is rename keys, reorder anything, drop empty fields, or strip a mark you did not ask about.",
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
    relatedTools: ["text-diff", "word-counter", "text-case-converter", "crlf-lf", "charset-converter"],
    aboutText: "A list of hostnames, an export of email addresses, a log of user agents, a column pasted out of a spreadsheet: the job is always the same few operations, and the part that goes wrong is always the counting. This page runs them in one fixed order — trim, drop blanks, de-duplicate, sort, reverse — and prints what each step cost. Lines in, lines out, duplicates removed and across how many repeated values, blank lines removed, whitespace trimmed from how many lines. A run that quietly took a hundred rows out of your list cannot pass for a clean one. Ordering uses the browser's own Unicode collation rather than raw code-point comparison, which is why apple sorts before Banana here and after Zebra in a naive sort, and why the natural mode puts file2 ahead of file10. De-duplication runs before the sort, so keeping the first occurrence means the first one in your file, not the first one after a re-order. Case sensitivity governs both the comparison and the duplicate test together. A leading UTF-8 byte-order mark is detached before any of that and written back at the front of the result, or dropped if you tick the box — it is never left attached to line one, where a sort would carry it into the middle of the file and where it would stop a marked line from matching its unmarked twin. There is no shuffle: it needs a random source, and a result you cannot reproduce is not one you can check.",
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
    relatedTools: ["charset-converter", "sort-dedupe-lines", "text-diff", "word-counter"],
    aboutText: "Line endings are invisible until they are not: Git reports every line of a file as changed when you edited one, and a shell script dies on its first line with a carriage return the shell tried to run as part of a command. The reason is rarely that a file uses the wrong ending. It is that the file uses more than one. So this page counts before it converts. Drop a file and it reports CRLF, LF and CR separately, marks the file as mixed when more than one kind is present, and says how many breaks will change against how many are already what you asked for. A carriage return followed by a line feed is counted once, as one CRLF, so a Windows file is never mis-reported as mixed. It also finds a UTF-8 byte-order mark and leaves it alone until you tick the box. Everything that is not a line ending is copied through, which is why the byte figure adds up exactly. One limit worth knowing: pasting cannot detect anything, because the browser normalises a textarea's value to LF before this page sees it. The file arm is the one that tells you the truth.",
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
    relatedTools: ["csv-to-json", "json-to-csv", "charset-converter", "crlf-lf", "sort-dedupe-lines"],
    aboutText: "A .xlsx workbook is a ZIP archive full of XML, and this tool opens it the way the format actually works: it unzips the package in your browser, reads the sheet list, the shared string table and the cells, and writes one CSV per sheet. No spreadsheet library is loaded to do it — the parsing runs straight against the ECMA-376 parts — so nothing sits between you and your own data, and nothing is uploaded. Two settings account for most of the reason people go looking for a converter at all. Excel in any locale where the decimal mark is a comma expects semicolons, and a comma-separated file opens there as one column per row. And without a byte-order mark, Excel on Windows reads a UTF-8 CSV in the system codepage and turns accented names into mojibake, while with one many scripting readers hand the mark back glued to your first column name. Both are switches here rather than assumptions. What a CSV cannot hold is stated rather than glossed over. Formulas arrive as the value Excel last cached, charts and formatting do not arrive at all, and a date in XLSX is a plain number behind a style — so the raw serial is written out and the page counts how many cells that affects.",
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
    relatedTools: ["subtitle-converter", "crlf-lf", "sort-dedupe-lines", "xlsx-to-csv", "base64-encode-decode"],
    aboutText: "A plain text file records nothing about its own encoding. It is a run of bytes, and the same bytes mean different letters depending on which table the reader uses — which is why a Czech subtitle file, a Russian CSV or an old Japanese log opens as a screenful of question marks and diamonds. This tool reads the bytes in whichever encoding you name and writes them back out as UTF-8, the encoding everything modern agrees on. Detection believes a byte-order mark, spots UTF-16 by its pattern of zero bytes, and otherwise tests the bytes strictly against UTF-8; bytes that fail that test are read as Windows-1252 and flagged as a guess, because a Cyrillic, Greek or Turkish file is equally valid non-UTF-8 and nothing can tell them apart from the bytes alone. That is why the preview is the point: you read the accented characters, and if they are wrong you name the real encoding and watch them change. The conversion runs one way only, and that is a browser limit rather than a missing feature. The browser can decode about forty encodings, but its encoder writes UTF-8 and nothing else, so there is no in-browser path to Shift_JIS or Windows-1251 bytes. The page reports bytes in, bytes out, whether a mark was found, and how many characters the decoder could not read at all.",
  },
  {
    name: "HAR Viewer",
    slug: "har-viewer",
    titleTag: "HAR Viewer — Inspect a Network Log Privately",
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
    relatedTools: ["json-formatter", "url-parser", "jwt-decoder", "http-status-codes", "charset-converter"],
    aboutText: "A HAR file is what your browser hands you when you right-click the Network panel and save. It is a verbatim recording of a browsing session, and that is exactly the problem: it carries the Cookie header from every request, the Authorization header from every API call, session tokens, API keys in vendor headers, and the body of every POST — including the one from the login form. Uploading that to a hosted viewer so you can read it is handing a stranger a working set of credentials. This page parses the file in your tab instead. You get a request table you can sort by status, size or time and filter by status class, method, resource type or a URL substring, and selecting any row opens its request and response headers, its query string, its request body and a timing breakdown. Everything printed is derived from the file: the totals skip requests whose size the recording marked unknown rather than counting them as zero, and the page says how many those were. The redact control replaces the credential headers by name and by pattern, empties both cookie arrays and removes the request body, then reports exactly how many values it took out. It does not touch URLs, query strings or response bodies, and the page says so rather than calling the result safe.",
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
    relatedTools: ["jwt-decoder", "hmac-generator", "base64-encode-decode", "hash-generator", "json-formatter"],
    aboutText: "A JSON Web Token is three base64url segments joined by dots: a header saying how it was signed, a payload of claims, and a signature over the first two. This page builds one. Edit the header and payload as JSON, pick HS256, HS384 or HS512, type the shared secret, and the token is signed in the tab with the browser's own Web Crypto — nothing is uploaded and the secret is used nowhere else. The important thing about a JWT is what it does not do. It is signed, not encrypted. Both leading segments are base64url, an encoding with no key involved, so anyone holding the token can read every claim in it, including anyone who finds it in a log line. Put nothing secret in the payload. Only HMAC algorithms are offered here: RS256 and ES256 sign with a private key, and a page that asks you to paste one into a text box is a credential-collection pattern regardless of intent. The claim helpers compute iat, nbf and exp in seconds rather than milliseconds, and each edit rewrites one span of your payload text, so a 64-bit id keeps all of its digits.",
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
    relatedTools: ["hash-generator", "jwt-encoder", "file-checksum", "base64-encode-decode", "jwt-decoder"],
    aboutText: "An HMAC is a keyed hash: it proves that whoever produced the value held the shared secret, and that the message has not been altered since. It signs webhook deliveries, AWS requests and half the internal APIs you will ever debug. This page computes one with the browser's own Web Crypto, over SHA-1, SHA-256, SHA-384 or SHA-512, and hands it back in hex and base64. The key encoding is a control rather than an assumption, and that is the point. A secret given to you as 64 hex characters is 32 bytes; read as text it is 64, and the two produce unrelated MACs with nothing anywhere to say which one you got. That single mistake is why most people arrive at a tool like this, so it is detected and named on screen. There is a verify field too: paste the value the other side sent — a whole signature header value works, since a leading sha256= is stripped — and it is checked against the hex, base64 and URL-safe spellings of the digest. That comparison is an ordinary string compare, not a constant-time one: fine for diagnosing a failing signature, not something to copy into a server. SHA-1 is offered because legacy APIs still require it.",
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
    relatedTools: ["hash-generator", "hmac-generator", "jwt-encoder", "base64-encode-decode"],
    aboutText: "A checksum is the cheapest way to tell whether the file that landed on your disk is the file the publisher meant to send. A mirror can be stale, a proxy can rewrite, a transfer can stop at 99 percent, and none of those announce themselves: the archive opens, the installer runs, and something is subtly wrong. This tool computes MD5, SHA-1, SHA-256 and SHA-512 for every file you drop, in a background worker so the tab keeps painting, and compares all four against whatever you paste into the expected-checksum box. It reads that paste as the release page wrote it: a bare digest, the two-space sha256sum form with a filename after it, the BSD parenthesised form, an OCI sha256: prefix, or an entire SHA256SUMS file, in which case each file is matched to the line that names it. The algorithm is worked out from the digest's length, and a paste a character short is refused rather than truncated to fit. The verdict names the algorithm that matched, or says plainly that none of them did. You can also save the digests back out as a coreutils-format sums file.",
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
    relatedTools: ["qr-code-generator", "password-generator", "hash-generator", "url-parser"],
    aboutText: "Reading a Wi-Fi password aloud across a room is how most guests get online, and it is the reason so many of them type it wrong. A Wi-Fi QR code folds the network name, the security type and the passphrase into one square that every modern phone camera recognises and offers to join from. This page builds that payload — the WIFI: field list ZXing defined — and draws the code in your browser with the qrcode library. The part that matters is the escaping. Semicolons, commas, colons, double quotes and backslashes are structural characters in that format, so a network called Cafe; Bar written straight in produces a perfectly scannable code for a network called Cafe. Each of those characters is backslash-escaped here in a single pass, and a name that is entirely hex digits is wrapped in quotes so a reader does not decode it as raw bytes. The finished payload is printed on screen exactly as encoded, and the passphrase is checked against the lengths WPA and WEP actually accept, so an impossible network is caught here rather than in front of a guest.",
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
    titleTag: "Chmod Calculator — Octal & Symbolic Permissions",
    category: "developer-tools",
    toolType: "chmod-calculator",
    acceptFormats: "",
    takesNoFile: true,
    description: "Tick a permission box, type 755, or type rwxr-xr-x — all three stay in step. Handles setuid, setgid and sticky, including the capital S and T rule.",
    hubLine: "a capital S means the bit is set and inert",
    keywords: ["chmod calculator", "chmod 755", "file permissions calculator", "octal to symbolic permissions", "setuid setgid sticky bit"],
    h1: "Chmod Calculator — Octal, Symbolic & Special Bits",
    subtitle: "Convert between the checkbox grid, the octal number and the rwx string, and copy the chmod command to run.",
    relatedTools: ["http-status-codes", "byte-converter", "hash-generator", "timestamp-converter", "regex-tester"],
    aboutText: "Unix file permissions are twelve bits, and the three ways of writing them — a checkbox grid, an octal number like 755, and a string like rwxr-xr-x — are the same twelve bits in different clothes. This calculator keeps all three live-linked in both directions: tick a box and the octal changes, type an octal and the boxes move, paste the permission column out of ls -l and everything else follows. It handles the special bits properly. setuid, setgid and the sticky bit sit above the nine permission bits, and ls renders them by overloading the execute column with s, S, t or T, where the capital form means the bit is set and the execute bit under it is not — so the bit is stored and does nothing. That distinction is the thing most calculators get wrong, and it is tested here against real chmod. You get both commands to run: the absolute chmod 755 file and the symbolic chmod u=rwx,go=rx file. The page also spells out what execute means on a directory — traverse rather than run — which is the confusion behind most permission problems.",
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
    relatedTools: ["url-parser", "chmod-calculator", "byte-converter", "jwt-decoder", "regex-tester"],
    aboutText: "A status code is three digits and a whole argument about what the server meant. This page is the full IANA registry: every registered code from 100 to 511 with its reason phrase, the RFC that defines it, and a plain-English description of when a server sends it. Search matches the number, the phrase and the description, so you can look up 429 or type captive portal and land on the right entry. Where a property is defined by the specification it is stated rather than implied. Twelve status codes are heuristically cacheable — a cache may reuse them with no freshness header at all — and those carry a flag; nothing here claims a response cannot be cached, because that is decided by headers rather than by the code. Every 3xx says what happens to the request method, which is the difference between a 301 that silently turns your POST into a GET and a 308 that does not. The codes no standard defines, from nginx's 499 to Cloudflare's 5xx range to LinkedIn's 999, sit in a separate labelled group, because they are in your logs and in no RFC.",
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
    relatedTools: ["chmod-calculator", "http-status-codes", "file-checksum", "compress-video-to-size", "timestamp-converter"],
    aboutText: "The reason anyone searches for a byte converter is that kB and KiB are not the same thing and were spelled the same way for thirty years. So this shows both at once: the decimal units built on powers of 1000, the binary units built on powers of 1024, and the bit units a network link is quoted in. Type a size into any row and every other row updates. The arithmetic is done in exact whole-number BigInt rather than in floating point, which matters more than it sounds. A JavaScript number stops representing integers exactly above 9,007,199,254,740,991, and that is 9.007 PB, inside the range this page is asked about. So the exact byte count is the value rather than the nearest double to it, and any row rounded for display is marked as rounded rather than quietly presented as the answer. A transfer-time helper divides by a link speed in bits per second, which is where the familiar factor-of-eight error lives. And the 1 TB drive that reads as 931 GiB is computed from the unit table on the page, not typed into the copy.",
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
    relatedTools: ["timestamp-converter", "cron-expression-generator", "url-parser", "aspect-ratio-calculator", "byte-converter"],
    aboutText: "Every scheduling mistake this page exists to prevent comes from one assumption: that a time zone has an offset. It does not. An offset belongs to a moment. New York is five hours behind UTC in January and four in July, Sydney runs the opposite way round, India sits five and a half hours ahead all year and Nepal five and three quarters. So nothing here adds or subtracts a stored number. Each row asks the browser's own copy of the IANA time zone database what the clock read at the exact instant you named, and prints the offset and the abbreviation that came back with it.\n\nThe board carries the date as well as the time, because the date is the half people drop. Thursday evening in London is Friday morning in Tokyo, and a column of bare times hides the day; zones on a different calendar date are marked as such.\n\nTwo readings of a clock face have no single answer, and both are reported rather than resolved quietly: the hour a spring forward deletes, and the hour a fall back runs twice. A Unix timestamp field drives the board in both directions, in seconds or milliseconds, chosen rather than guessed from the digits.",
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
    relatedTools: ["resize-image", "crop-image", "compress-video", "byte-converter", "url-parser"],
    aboutText: "An aspect ratio calculator is trivial arithmetic and still worth a page, because the useful part is the part most of them skip. 1366×768 — the resolution half the laptops in the world shipped with — is not 16:9. Reduced by its greatest common divisor it is 683:384, about 0.05% wider. That is invisible on a screen and it is exactly the difference between keeping a panel's ratio and making something 16:9, so this page reports the exact reduced pair first and the nearest named ratio second, with the percentage it is out by.\n\nEnter any two of width, height and ratio and the third is computed. The computed field is read-only, so the three can never contradict one another on screen. A ratio can be written 16:9, 16/9, 2.39:1 or as a bare decimal. Rounding happens once, at the end, and the footnote says what was rounded and from what value.\n\nThe fit mode scales one box into another and reports the letterbox or pillarbox bars in pixels, or, in cover mode, what gets cropped off each edge. The named ratios are stored as the integer pairs they really are: 21:9 is a marketing name that covers more than one shape — 2560×1080 is 64:27 and 3440×1440 is 43:18 — and the chip is stored as 64:27; 2.39:1 and 1.85:1 are the cinema projection standards, kept here as 239:100 and 37:20.",
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
    relatedTools: ["url-encode-decode", "jwt-decoder", "har-viewer", "json-formatter", "timezone-converter"],
    aboutText: "The browser's URL parser is not a splitter, it is a normaliser, and the gap between what you paste and what it returns is where a good share of URL bugs live. Hand it HTTP://Example.COM:80/a/../b and it gives back http://example.com/b — scheme and host lower-cased, the default port dropped, the dot segment resolved. Hand it an internationalised hostname and it gives back the xn-- form, because that is what DNS actually resolves. This page runs that same parser and then says what it changed, rather than presenting the result as your input.\n\nThe query string is a table with the raw and the decoded value side by side. Repeated keys stay repeats: tag=a&tag=b is two rows, because a server that reads the first and a server that reads the last will disagree about that URL, and collapsing the rows hides the disagreement. A value that still holds a percent sequence after one decode was encoded twice — the classic broken-redirect bug — and that is flagged per value.\n\nEditing the table rebuilds the URL. A reference that is not a whole URL — an absolute path, a scheme-relative host, a dotted relative path — resolves against a base URL you supply instead of simply being refused. Nothing is fetched: no request, no DNS lookup, no check that the address exists.",
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
    relatedTools: ["unzip-files", "create-zip", "file-checksum", "xlsx-to-csv", "docx-to-markdown"],
    aboutText: "An archive is a container: it holds files, their names, their folder structure and, usually, their compressed bytes. Opening one normally means installing something, or handing the file to a website that unpacks it on a server it owns. This page does neither. It runs libarchive — the same C library behind bsdtar and the archive support in a great deal of desktop software — compiled to WebAssembly and served from this site rather than a CDN, so opening an archive makes no request to anyone. Drop one in and you get its table of contents first: every entry, the path it stores, the size it declares, and whether it is a file, a folder, a symbolic link or an encrypted member. Tick what you want. One file downloads on its own; two or more are bundled into a single ZIP, because browsers cancel a burst of separate downloads. One thing this page cannot do is make an archive, and that is a property of the build rather than a rule anyone imposed: the binary carries sixteen format readers and not one format writer.",
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
    relatedTools: ["unzip-files", "extract-archive", "file-checksum", "xlsx-to-csv", "svg-optimizer"],
    aboutText: "A ZIP is a container with an index at the end of it, and this page builds one in your browser out of the files you pick. What it will not do is guess at the result. The archive is written, then read back, and the packed size, the container's own overhead and the saving on each file are numbers taken out of the finished bytes rather than predicted from the settings — which matters most when the answer is that nothing was saved at all. Photos, video, audio and anything already compressed have no repetition left for DEFLATE to find, so a ZIP of them comes out the same size or slightly larger, and the page says so rather than showing a hopeful percentage. The limits are stated rather than glossed over. A browser hands a page a flat list of files with no folder paths attached, so folder structure cannot survive, and a folder dragged onto the drop zone arrives as an unreadable stub. Modified dates are kept, to the two seconds a ZIP stores them in. Permissions are not, because the browser never sees them.",
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
    relatedTools: ["create-zip", "extract-archive", "xlsx-to-csv", "file-checksum", "qr-code-reader"],
    aboutText: "Opening an archive means trusting whatever is inside it, which is exactly why doing it on somebody else's server is a strange habit. This page reads the ZIP's own index in your browser and lists every entry — its path, its packed size, its unpacked size, the compression it uses — before anything is written out, so you can pull one file out of a large archive without unpacking the rest. Entries whose stored path tries to leave the folder you would extract into are refused and named on screen, not quietly rewritten to something that looks harmless: that rewrite is the standard behaviour of the underlying library, and it is the zip-slip vulnerability with its edge filed off rather than removed. Password-protected entries are named too. They cannot be opened here at all, because there is no decryption in this page and the reader refuses an archive whole when it meets one — the same is true of entries compressed with bzip2, LZMA or zstd. Nothing is uploaded, and nothing about the archive is sent anywhere.",
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
    relatedTools: ["html-to-markdown", "markdown-to-html", "markdown-to-pdf", "pdf-to-text", "unzip-files"],
    aboutText: "A .docx is a ZIP full of XML, and this reads it the way the format works: the package is unzipped in your browser, the body is mapped to a small, plain HTML, and that HTML is written out as Markdown by the same writer the HTML-to-Markdown page uses. Nothing is uploaded.\n\nWord can express far more than Markdown can, so the question is not whether something is lost — it is what, and how much. Rather than print a standing list of caveats, this page opens the package a second time and counts. Page headers and footers, comments, tracked deletions, underline, highlight, colour, embedded objects and macros are all real parts of a .docx and none survives; the panel above the preview names the ones your document has, with the numbers.\n\nWhat survives is the structure worth keeping. Headings come from Word's Heading styles rather than from font size, lists keep their nesting, footnotes become GFM footnotes, and tables become real pipe tables — except where a vertical merge means no pipe table could be honest, in which case the HTML is kept and the page says so.",
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
    relatedTools: ["svg-to-png", "xml-formatter", "barcode-generator", "json-minify", "qr-code-generator"],
    aboutText: "An SVG is text, and in most files the drawing is the smaller half of it. Anything exported from Illustrator, Figma or Inkscape arrives carrying an XML declaration, a DOCTYPE, editor namespaces, generator comments, layer names and coordinates written to six decimals on a canvas a hundred units wide. SVGO takes all of that out, and it is what almost every build pipeline already runs. Here it runs in your browser instead: parsed, rewritten and handed back inside the tab, with nothing uploaded. What this page adds is an account of what happened. It prints the bytes before and after and the percentage between them, read off the run rather than promised in advance — including the runs where the file comes out larger, which can happen to a drawing built on XML entities. And it names the seven default passes that can change more than the size: the one that renames and deletes ids, the one that dissolves the stylesheet, the one that drops attributes it does not recognise. Each is a checkbox that reports what it did to your file, not what it does in general.",
  },
  {
    name: "Barcode Generator",
    slug: "barcode-generator",
    titleTag: "Barcode Generator — EAN, UPC, Code 128, QR",
    category: "developer-tools",
    toolType: "barcode-generator",
    acceptFormats: "",
    takesNoFile: true,
    description: "Generate Code 128, EAN-13, UPC, ITF-14, QR, Data Matrix, PDF417 and Aztec barcodes in your browser. Validated per symbology, saved as SVG or PNG.",
    hubLine: "Refuses a wrong check digit instead of drawing it anyway.",
    keywords: ["barcode generator", "ean 13 generator", "code 128 generator", "upc barcode generator", "free barcode maker"],
    h1: "Barcode Generator — Code 128, EAN, UPC, QR and More",
    subtitle: "Eleven symbologies, each checked against its own rules before a single bar is drawn, and nothing leaves this tab.",
    relatedTools: ["qr-code-generator", "qr-code-reader", "wifi-qr-code", "svg-optimizer", "uuid-generator"],
    aboutText: "A barcode is a picture of a number, and the only thing that matters about it is that the number a scanner reads is the number you meant. This page builds eleven symbologies with BWIPP, the Barcode Writer in Pure PostScript project, compiled to JavaScript and drawn as an SVG in your own tab. Nothing is uploaded, which matters when the number on the label belongs to a product you have not announced. The validation is the point. EAN-13 wants twelve or thirteen digits, UPC-A eleven or twelve, ITF-14 thirteen or fourteen, and a check digit that does not match is refused with the digit it should have been rather than drawn anyway. Where a symbology transforms what you typed, the page prints the result before you generate anything: a twelve-digit EAN-13 gains its computed check digit, a UPC-E is expanded into the UPC-A it compresses so seven typed digits become twelve, and a UPC symbol is printed both ways — the twelve digits under its bars, and the thirteen-digit EAN-13, leading zero and all, that a software reader hands back for the very same symbol. Code 128 and Code 39 refuse accented characters, because they carry bytes rather than characters and a scanner would faithfully report mojibake.",
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
    relatedTools: ["qr-code-generator", "wifi-qr-code", "barcode-generator", "url-parser", "exif-viewer"],
    aboutText: "A QR code is a bitmap, so reading one back is a decoding problem, not a network one. Drop a photograph or screenshot here and the browser decodes the picture, hands the pixels to zxing-cpp compiled to WebAssembly, and searches it for every code — several, if the picture holds several. The engine is served from this site rather than the CDN its npm package points at by default, so scanning a code tells nobody that you scanned it. The part worth reading twice is what this page will not do. A decoded payload is printed as text and is never made clickable. A square looks identical whatever is inside it, which is why the stickers pasted over parking-meter codes work — so the host name is broken out into its own row, and a link carrying credentials in front of the host, a punycode lookalike or a zero-width character is named where it occurs. Wi-Fi payloads, vCards, MECARDs, calendar entries, mailto:, tel:, sms: and geo: are decomposed into labelled fields, and a two-factor enrolment secret is masked there and flagged in the raw text.",
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
    relatedTools: ["add-page-numbers","watermark-image","protect-pdf","pdf-permissions","compress-pdf"],
    aboutText:
      "A watermark is how a PDF says what it is before anyone reads a word of it: DRAFT, CONFIDENTIAL, a client's logo, a copy number. This tool puts one on your pages without uploading anything. Drop a PDF, choose a text mark or a PNG or JPEG image, and place it on the rendered first page — drag the ring where you want it, or type exact percentages across and down, or move it with the arrow keys. The two number fields and the drag are the same pair of numbers, so a keyboard reaches every position a mouse does. Position is a share of each page rather than a fixed measurement, so the mark lands in the same relative spot on a document whose pages are not all one size, and it is measured against the page as your reader sees it: a cropped page, a page whose box does not start at zero, and a page the reader turns ninety degrees are all handled. Size, colour, boldness, opacity and rotation are yours; tick tile and the mark repeats twelve times on a fixed grid, which is the classic diagonal look, and the anchor is then ignored. Tick place under the page content and your text and pictures print over the top of it instead. Stamp every page, only the first, only the last, or a range like 1-3, 5, 8-10. Two things worth knowing before you start. Text is drawn with a standard PDF font, which covers Latin letters, digits and punctuation including accents, curly quotes and the euro sign, but cannot draw Chinese, Japanese, Korean, Cyrillic, Greek, Arabic or emoji; the tool checks as you type and names any character it cannot draw rather than failing at the end. And the mark becomes part of the page's own drawing instructions, not a note clipped to it, so it survives printing and re-saving and nothing here can peel it off again. That is a label, not a lock: the page underneath is untouched, its text stays selectable, and a PDF editor can still remove the mark. Everything else in your document is left alone — bookmarks, links, form fields and the title all survive, because the file is re-saved rather than rebuilt from copies.",
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
    relatedTools: ["protect-pdf","merge-pdf","compress-pdf","add-page-numbers","extract-pdf-pages"],
    aboutText:
      "Most signing happens at the last minute: a form comes back, it needs a signature on page four, and the only thing between you and sending it is software you do not have. This page does that job in the tab you already have open. Drop the PDF in, draw your name on the pad with a mouse, a trackpad or a finger, and drag it onto the page. If you already have a picture of your signature, place a PNG or JPEG instead — that path needs no pointer at all, which is how to use this tool from a keyboard. Placement is expressed as three percentages of the page you can see: the left edge, the top edge, and how much of the page width the signature should span. Those three number fields are the placement, so dragging on the page and typing in the fields write the same values and cannot disagree. The height follows your signature’s own proportions rather than being set separately. Pick which page to sign, or put the same mark on every page. The pad exports a transparent PNG trimmed to the ink, so the page shows through around the strokes; a JPEG cannot do that, and this page says so when you choose one. The signature is drawn into the page’s content, which means a reader cannot click it and delete it, and the rest of your document is left alone — the file is loaded, one image is added, and it is written back out. Then be clear about what this is. It puts a picture of your signature on a page. It is not a certificate-based digital signature: no certificate is involved, nothing is cryptographically signed, and the result carries no signature field, so a PDF reader will report no signatures in it. It cannot prove who signed, and it cannot show that the document was altered afterwards. Whether a drawn signature is enough is between you and whoever asked for the document, and this page makes no claim about that. What it does promise is the ordinary one: nothing is uploaded, because the PDF and your signature are read, drawn and written entirely inside this tab.",
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
    relatedTools: ["images-to-pdf","jpg-to-pdf","add-page-numbers","crop-pdf","extract-images-from-pdf"],
    aboutText:
      "Adding a picture to a PDF that already exists — a logo on a letterhead, a stamp, a photo dropped into a report — is something the format is awkward about. A PDF page has no notion of moving anything: everything on it is drawn at fixed coordinates, so adding a picture means drawing it in too. That is what this tool does. Drop a PDF, choose a PNG or JPEG, and the page you are looking at is rendered with PDF.js and given a marker you can drag. Click or drag anywhere on the page to put the image's top-left corner there, or type exact percentages into the X and Y fields — the fields and the drag are the same two numbers, so the placement works from the keyboard alone and the marker cannot disagree with the file you download. Width is a percentage of the page's own width and the height follows the image's proportions, so nothing is stretched. Opacity thins the image, and Turn swings it counter-clockwise about its own bottom-left corner. You choose which pages get it: all of them, the first, the last, or one page you name. You also choose whether it is drawn over the page's content or under it, which is what a background letterhead wants — though a page with a filled background of its own will hide anything placed underneath. Three things worth knowing before you rely on the output. The picture is drawn into the page's content rather than added as an annotation object, so it is permanent: nobody can click it in a reader and drag it away, and neither can you. An image whose EXIF Orientation tag is not 1 has to be redrawn upright before it is embedded, because PDF readers ignore that tag, and for a JPEG that costs one re-encode — the canvas says so when it happens. A page the file stores with its own rotation is handled: the marker and the download agree at 0, 90, 180 and 270 degrees, which is pinned by a test over all four. It all runs in this tab: your browser reads both files and nothing is uploaded.",
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
    relatedTools: ["rotate-pdf","crop-pdf","add-page-numbers","merge-pdf","split-pdf"],
    aboutText:
      "Annotate PDF puts three kinds of mark on a page you choose: a translucent highlight block, an outlined box, and a short text note. The page is rendered with PDF.js exactly as a reader will see it, and you place marks on that picture — drag to set a rectangle, click to move one, or type its position and size into the X, Y, Width and Height fields. Those fields are the same four numbers the drag writes, so the page and the rail can never disagree and nothing here needs a mouse. Two things this page cannot do, and they are the two people assume it can. It does not select text: there is no text layer under the preview and the engine has no model of where the words sit, so a highlight is a coloured rectangle at the spot you chose, not a highlight that finds a line and follows it across a column break. And the marks are painted into the page's own content rather than attached as PDF annotation objects, so a reader shows no comment to click, no author, no reply and no delete. That makes them permanent in normal use — taking one out again means editing the page. If you want something a colleague can answer, this is the wrong tool. The rest is detail worth knowing before you rely on it. A highlight is a flat translucent block laid over the page, not a multiply blend, so the text underneath comes through tinted, and at full opacity it covers that text completely. Notes are drawn in Helvetica and can only carry the characters the standard PDF fonts cover, which is Latin letters, digits and punctuation including accents, curly quotes and the euro sign; Chinese, Cyrillic, Greek, Arabic and emoji are refused before you press the button rather than after. A note is never wrapped for you, so press Enter where a line should break, and be aware that extra lines land twenty-four points below the one before whatever size you pick. Only the page you marked is changed, and only by adding to it. Page sizes and page order are untouched, existing text stays selectable, and no image is re-encoded.",
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
    relatedTools: ["protect-pdf","merge-pdf","compress-pdf","pdf-to-text","pdf-permissions"],
    aboutText:
      "A PDF form is not a picture of a form. Somewhere inside the file is an AcroForm dictionary listing named fields, and this tool reads that list and gives you one control per field: a box to type in for a text field, a tick for a check box, a set of radio buttons for a radio group, a menu for a dropdown, and a multi-select for a list box. Fields the document marks read-only are listed with their stored values and locked. Push buttons, signature fields and anything the engine cannot identify are shown too, each with a line saying why there is nothing there to fill in. Only the fields you actually change are written, and that matters more than it sounds. Writing to a field makes the engine redraw it in a standard Helvetica, keeping its colour, size and alignment but replacing whatever font the document's author picked, so re-sending a value you never edited would restyle a field for nothing. No value you did not touch is altered. When the answers are in, you can also flatten the form. Flattening bakes every field into the page and then removes the fields, which is what people mean by wanting a copy nobody can edit: the text stays real, selectable text rather than turning into a picture, and the result cannot be filled in again. That option is refused for some documents. A field with no stored appearance makes the underlying flatten fail part-way through and leaves a file that will not save at all, so this page names those fields and turns the box off rather than letting you find out afterwards. Filling still works on those documents, and the form stays interactive. Two limits are worth knowing before you start. Field text is drawn with a standard PDF font that covers the Latin alphabet, accented letters, curly quotes, dashes and the euro sign; Chinese, Japanese, Korean, Cyrillic, Greek, Arabic and emoji cannot be encoded at all, so the page checks what you type and stops the run instead of failing halfway through it. And this cannot create a form. A document with lines and boxes drawn on the page has no fields in it, and nothing here adds any — if the form dictionary is missing, your file is handed back untouched. Everything runs in this tab; the PDF is never uploaded.",
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
    relatedTools: ["protect-pdf","pdf-permissions","compress-pdf","merge-pdf","pdf-to-text"],
    aboutText:
      "A PDF form is two things at once — a page you look at, and a set of fields laid over it that anyone opening the file can still type into. Flattening collapses the two. Each field's stored appearance, whether that is the text you typed, the tick in a box or the option you picked, is drawn into the page itself, and the field is then deleted. What is left reads exactly the same and has nothing to type into. This page shows you the form before it changes anything. Drop a PDF and it lists every field the document declares: the name the form gives it, which kind of control it is, the value it currently holds, whether it is read-only, required or capped in length, and which page it sits on. That reading pass parses the document and saves nothing, so looking cannot alter your file. Nothing is written until you ask for it, and the result arrives as a separate download. The interesting part is the refusal. A flatten draws from the appearance stream already stored with a field, and some fields have none: a signature field has nothing drawn in it until it is signed, and a radio group whose buttons were never given appearances has nothing either. Fields are removed as they are baked, so a failure part-way through leaves a document that cannot even be saved; rather than risk that, every field is checked first and the whole run is refused when any one of them is missing an appearance, with the offending fields named on screen. It is a deliberately strict check, and it will sometimes stop a form that would in fact have come through. Two things flattening is not. It is not a compression step: what was drawn in the field ends up on the page instead of being discarded, so the file comes back about the same size and can be a little larger — reach for Compress PDF afterwards if size is the point. And it is not reversible. Nothing here turns a flattened PDF back into a form, so keep the original if the answers might ever need to change.",
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
    relatedTools: ["exif-viewer","protect-pdf","pdf-permissions","compress-pdf","extract-images-from-pdf"],
    aboutText:
      "Files say more about you than the page or the picture does. A PDF carries an /Info dictionary — title, author, subject, keywords, the application that wrote it and the dates it was written — and often one or more XMP packets, which repeat much of that in XML and frequently travel inside embedded photographs as well. A photo carries EXIF: the camera and lens, the exposure, the timestamp, and on a phone the GPS coordinates of wherever you were standing. This page takes either kind of file, lists what it can read, and hands back a cleaned copy in a single press — the run saves the file for you, so there is no second button to hunt for. The two paths work differently, and the difference matters. For a PDF, every key in the /Info dictionary is deleted rather than blanked, and every XMP packet found on the catalog, on a page or on an embedded image goes with it; clearing the properties alone would leave the XMP still naming you. The pages are untouched, so the document looks and prints exactly as it did — which also means a name typed into a page is still on that page. For an image there is no way to cut the tags out. The picture is decoded, drawn onto a canvas and encoded again, and the metadata is simply not carried across, so the download is a new picture built from your pixels. JPEG and WebP output is written at the quality you set, so a little detail goes; the embedded colour profile is not carried over, because the canvas works in sRGB; anything deeper than 8 bits per channel comes back at 8; an animated PNG or WebP keeps only its first frame and a multi-page TIFF only its first page; and HEIC, HEIF and TIFF come back as JPEG, because no browser can write those containers from a canvas. Keep your original if you need the pixels untouched. After every run the cleaned file is read again by the same reader that listed the source, and the page prints what is left, so what you get is a measurement rather than a promise. Everything happens in this tab — the file never leaves your device.",
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
    relatedTools: ["annotate-pdf", "add-image-to-pdf", "sign-pdf", "delete-pdf-pages", "watermark-pdf"],
    aboutText:
      "Most tools called a PDF editor are really PDF markers, and this page says so on the way in: the text already in your document cannot be edited here. A PDF page is not a document in the word-processor sense. It is a list of drawing instructions \u2014 this glyph, this font, this size, at these coordinates \u2014 with no paragraphs, no line boxes and nothing to reflow. Neither pdf-lib nor PDF.js, the two libraries behind this page, can find the sentence a letter belongs to, change it and re-lay-out what follows. Adobe's own free tier cannot do it either. What you get instead are five things a PDF genuinely can do, and all five are exact. Add text anywhere on a page, in Helvetica or Helvetica Bold, at whatever size and colour you choose. Place a PNG or JPEG \u2014 a logo, a stamp, a photo \u2014 sized as a share of the page width, so nothing is stretched. Paint a whiteout rectangle over something you want out of sight. Draw freehand with a pointer. And delete whole pages you do not want. The page you are working on is rendered exactly as a reader will see it, marks are placed on that picture, and every mark remembers the page it belongs to, so you can work through several pages and apply the lot in one pass. Placement is expressed as percentages of the page as displayed, and those number fields are the mark \u2014 dragging on the page writes the same numbers \u2014 so text, images and whiteout boxes can be placed to the point from a keyboard alone. Freehand is the one exception, and this page says so rather than pretending. Two limits are worth reading twice. Whiteout is paint, not redaction: the covered text is still in the file and still copyable by anything that reads the page. And every mark is drawn into the page's own content rather than attached as an annotation object, so no reader will offer you a comment to click or a Delete. Nothing is uploaded, because your browser does all of it.",
  },

  // ── OCR ────────────────────────────────────────────────────────────
  {
    name: "Image to Text",
    slug: "image-to-text",
    titleTag: "Image to Text (OCR) — Free & Private",
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
    relatedTools: ["pdf-to-text", "pdf-to-jpg", "compress-image", "png-to-jpg", "qr-code-reader"],
    aboutText:
      "OCR is the one job on this site that people assume must involve a server, because for twenty years it did. It does not have to. Tesseract — the optical character recognition engine Google has maintained since 2006 — compiles to WebAssembly, and this page runs it in your tab against a picture the browser already has in memory. Nothing is uploaded, which for this particular tool is worth saying plainly: the images people run OCR over are receipts, invoices, passports, prescriptions, contracts and screenshots of private conversations, and every free OCR site that asks you to upload one has taken a copy of it. The cost of doing it this way is a download. The engine and its English language model are about 4.9 MB together, fetched from this site the first time you read an image and not before — the page itself pulls none of it. What comes back is a guess, not a transcript. Tesseract is very good on clean, high-contrast printed text: a screenshot, a PDF page rendered to an image, a flatbed scan of a printed document. It is markedly worse on photographs taken at an angle, on low-resolution images, on text over a busy background, and on anything decorative. It does not read handwriting at all — that is a different class of model, not a setting. Layout is the other limit worth knowing before you start. Tesseract reads down the page, so a two-column article comes back as the whole of the left column followed by the whole of the right, rather than as you would read it. Tables lose their structure entirely: the cells arrive as separate lines with nothing to say which row or column they came from. For a document that still has its text layer — most PDFs that were exported rather than scanned — PDF to Text will give you the characters exactly as the file stores them, with no guessing involved at all. Use this when the text only exists as pixels.",
  },

  // ── OCR for documents ──────────────────────────────────────────────
  {
    name: "OCR PDF",
    slug: "ocr-pdf",
    titleTag: "OCR a PDF — Make a Scan Searchable, Free & Private",
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
    relatedTools: ["pdf-to-text", "image-to-text", "pdf-to-jpg", "compress-pdf", "merge-pdf"],
    aboutText:
      "A scanned PDF is a stack of photographs. It may look like a document, but there is no text in it at all — searching finds nothing, selecting gets you nothing, and a screen reader has nothing to read. OCR is what puts the words back, and this page does it in your tab: Tesseract, compiled to WebAssembly, renders each page, reads it, and writes what it found back into the file as text nobody can see. What comes out is the same PDF plus a searchable layer. That last point is worth being precise about, because it is where tools of this kind usually mislead. The pages are not rebuilt. The scan's own images, their compression and any vector artwork are exactly the bytes that arrived; the recognised words are appended as invisible text at the coordinates they were found. So the document cannot silently reflow, lose a signature or change how it prints — and equally, this is not a conversion into something editable. The text is a layer over the picture, not a retyping of it. The accuracy is OCR accuracy, and here the errors are harder to notice than usual. On a page of readable text you can see when a word has been misread. Here you cannot: what you see is the original scan, which is right, while what you copy is the guess, which may not be. A misread digit in an invoice total does not announce itself. Check anything that matters against the page. Layout is the other limit. Reading runs down the page, so a two-column article comes back as the whole left column followed by the whole right one, and a table loses its rows and columns entirely. Handwriting is not supported at all — that is a different class of model, not a setting. Only English is served. And if your PDF was exported rather than scanned, it already has real text: PDF to Text will give you the characters the file stores, exactly, with no guessing involved, and this tool would only add a second and less accurate copy on top.",
  },

  // ── Personal-data exports ──────────────────────────────────────────
  {
    name: "VCF to CSV",
    slug: "vcf-to-csv",
    titleTag: "VCF to CSV — Convert Contacts, Free & Private",
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
    relatedTools: ["ics-to-csv", "csv-to-json", "json-to-csv", "xlsx-to-csv", "charset-converter"],
    aboutText:
      "A .vcf file is an address book, and an address book is one of the most revealing files a person owns — every name, number, email and home address of everyone they know. That is the reason this tool exists in the form it does. Every free VCF-to-CSV converter online asks you to upload that file to a server; this one reads it in the tab and sends nothing anywhere, which for this particular file type is the difference that matters. The conversion itself is less trivial than it looks, and the interesting parts are where converters usually go wrong. vCard folds long lines: any value over 75 characters is split across lines and continued with a leading space, so a note or an address routinely arrives in pieces. A parser that splits on newlines and stops does not crash — it silently truncates every long field and invents extra rows, which is the worst kind of failure because the output still looks like a contact list. This one unfolds first. Contacts also repeat properties: three emails and four phone numbers on one card is normal. Squashing those into a single cell separated by semicolons is what most converters do, and it destroys the thing people convert contacts for, because on re-import that cell is one string and every address after the first is lost. Here each occurrence gets its own numbered column, and the number of columns is derived from your file rather than fixed — a list whose busiest contact has two emails gets two email columns, not ten mostly empty ones. The structured name field is expanded into last, first, middle, prefix and suffix instead of being dumped as a semicolon string, and a structured address is joined into one readable cell. Anything the file carries that has no column is named on the page rather than dropped quietly. Photos are deliberately left out: a base64 portrait is not something a spreadsheet can use, and it would make the file enormous.",
  },
  {
    name: "ICS to CSV",
    slug: "ics-to-csv",
    titleTag: "ICS to CSV — Convert a Calendar, Free & Private",
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
    relatedTools: ["vcf-to-csv", "csv-to-json", "json-to-csv", "timezone-converter", "timestamp-converter"],
    aboutText:
      "An .ics export is a diary, and it says as much about a person as their contacts do — who they meet, where they go, and when they are not at home. So this reads it in your browser and uploads nothing, which is worth saying plainly for a file of this kind. Two decisions in the conversion are worth knowing about, because both are places where a more confident tool would quietly be wrong. The first is time zones. An iCalendar time can be UTC, it can be floating with no zone at all, or it can name a zone whose rules live in a VTIMEZONE block elsewhere in the same file. Converting all three into one zone means guessing which one you wanted, and when the guess is wrong every appointment moves by hours with nothing on screen to say so. This writes the wall-clock time exactly as the file stores it and puts the zone in a column of its own, where you can see it. A visible extra column is better than an invisible wrong time. The second is repetition. A weekly meeting is stored once, with a rule describing how it repeats — it is not stored as fifty-two events. Expanding that rule would turn one row into hundreds and would require resolving counts, end dates, exceptions and the calendar's own zone, each one a chance to invent an appointment that does not exist in the file. So a repeating event stays one row and its rule is written into a column. If you want the occurrences, a calendar application is the right thing to ask. Beyond that: reminders are kept out of the event's own columns, organisers and attendees are shown by name rather than as mailto: addresses, all-day events are marked, and any property with no column is named on the page instead of being dropped in silence.",
  },

  // ── GIF animation verbs ────────────────────────────────────────────
  {
    name: "Resize GIF",
    slug: "resize-gif",
    titleTag: "Resize a GIF — Free & Private",
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
    relatedTools: ["gif-speed-changer", "reverse-gif", "split-gif", "video-to-gif", "compress-image"],
    aboutText:
      "Most tools that claim to resize a GIF quietly hand back a still, because the ordinary way a browser reads an image keeps only the first frame. This one decodes the whole animation first, scales every frame, and writes them back with the delays the original stored. Scaling down is the useful direction: it is the single most effective way to make a GIF smaller, because the file cost is roughly the pixel count multiplied by the number of frames. Halving the dimensions removes three quarters of the pixels in every frame at once, which usually does far more than any amount of palette tuning. Everything happens in this tab. The animation is decoded frame by frame, worked on, and written back out with gifenc, which this site already carries for its video-to-GIF tool — so nothing is uploaded and no new engine is downloaded. One thing is worth knowing before you start: re-encoding a GIF is not lossless. A GIF can hold at most 256 colours per frame, and rebuilding the file means choosing that palette again. Flat colour, line art and text come through cleanly; fine gradients and photographic frames can band slightly. The original file on your disk is untouched either way.",
  },
  {
    name: "GIF Speed Changer",
    slug: "gif-speed-changer",
    titleTag: "Change GIF Speed — Free & Private",
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
    relatedTools: ["resize-gif", "reverse-gif", "split-gif", "video-to-gif", "video-trimmer"],
    aboutText:
      "Changing a GIF's speed means changing how long each frame is displayed, not adding or removing frames — and that distinction matters, because a tool that speeds things up by dropping frames makes the result visibly choppier while claiming to have done what you asked. Here every frame survives and only its delay is rescaled. There is a hard floor, and the page shows it rather than letting you drag past it into nothing. A GIF stores each frame's delay in hundredths of a second, so twenty milliseconds a frame is about as fast as the format can honestly describe; beyond that the file cannot say 'faster' and different browsers substitute their own timing anyway. Slowing down has no such limit. Everything happens in this tab. The animation is decoded frame by frame, worked on, and written back out with gifenc, which this site already carries for its video-to-GIF tool — so nothing is uploaded and no new engine is downloaded. One thing is worth knowing before you start: re-encoding a GIF is not lossless. A GIF can hold at most 256 colours per frame, and rebuilding the file means choosing that palette again. Flat colour, line art and text come through cleanly; fine gradients and photographic frames can band slightly. The original file on your disk is untouched either way.",
  },
  {
    name: "Reverse GIF",
    slug: "reverse-gif",
    titleTag: "Reverse a GIF — Free & Private",
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
    relatedTools: ["resize-gif", "gif-speed-changer", "split-gif", "video-to-gif"],
    aboutText:
      "Reversing an animation sounds like reversing a list, and that is where most implementations go slightly wrong. A GIF's delay belongs to the frame it is stored with — it means 'show this picture for this long' — so flipping the picture order while leaving the delays where they were produces an animation whose timing no longer matches its own frames. If the original paused on its last frame, a naively reversed copy pauses on what is now the last frame instead, and the rhythm is subtly wrong. This reverses the pairs, so a GIF that lingered at the end lingers at the beginning, exactly as it should. Everything happens in this tab. The animation is decoded frame by frame, worked on, and written back out with gifenc, which this site already carries for its video-to-GIF tool — so nothing is uploaded and no new engine is downloaded. One thing is worth knowing before you start: re-encoding a GIF is not lossless. A GIF can hold at most 256 colours per frame, and rebuilding the file means choosing that palette again. Flat colour, line art and text come through cleanly; fine gradients and photographic frames can band slightly. The original file on your disk is untouched either way.",
  },
  {
    name: "Split GIF into Frames",
    slug: "split-gif",
    titleTag: "Split a GIF into Frames — Free & Private",
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
    relatedTools: ["resize-gif", "gif-speed-changer", "reverse-gif", "video-to-images", "create-zip"],
    aboutText:
      "This gives you every frame of an animation as a separate picture, numbered in playing order and zero-padded so a two-hundred-frame archive unzips in the right sequence. The frames come out as PNG rather than GIF, and that is deliberate. Decoding an animation composites each frame into a complete picture — most GIF frames store only the rectangle that changed since the last one, so the decoder has to build the whole image before it can hand it over. Writing those complete frames back through a 256-colour palette would throw away what the decode just recovered, for no benefit. PNG keeps them exactly as they were reconstructed. Everything happens in this tab. The animation is decoded frame by frame, worked on, and written back out with gifenc, which this site already carries for its video-to-GIF tool — so nothing is uploaded and no new engine is downloaded. One thing is worth knowing before you start: re-encoding a GIF is not lossless. A GIF can hold at most 256 colours per frame, and rebuilding the file means choosing that palette again. Flat colour, line art and text come through cleanly; fine gradients and photographic frames can band slightly. The original file on your disk is untouched either way.",
  },

  {
    name: "GIF Maker",
    slug: "gif-maker",
    titleTag: "GIF Maker — Turn Images into a GIF, Free & Private",
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
    relatedTools: ["split-gif", "resize-gif", "gif-speed-changer", "video-to-gif", "reverse-gif"],
    aboutText:
      "This is the opposite of the frame splitter: stills go in and one animation comes out. Drop a set of pictures, choose how long each is shown, and the page builds a GIF in your browser — nothing is uploaded and no engine is downloaded, because the encoder this site already carries for its video-to-GIF tool does the work. Two details are worth knowing because they are where a GIF builder usually disappoints. The first is ordering. Files arrive from a drop in whatever order the operating system hands them over, which is rarely the order you meant, so they are sorted by filename using a numeric comparison — frame-2 lands before frame-10, not after it, which is what a plain alphabetical sort would do. If your pictures are named in sequence you will get the sequence you expect. The second is size. Every frame of a GIF has to be the same size: the format has one logical screen and places frames on it. Pictures dropped from a camera roll are never all the same shape, so each one is fitted inside the canvas with its aspect ratio kept and the spare space left transparent. The alternative — stretching each picture to fill — distorts faces and is what makes a home-made GIF look wrong in a way that is hard to name. Timing is a single delay applied to every frame, shown both in milliseconds and as a frame rate. GIF stores that delay in hundredths of a second, so around twenty milliseconds is the fastest the format can honestly describe.",
  },
  {
    name: "CSV to Markdown Table",
    slug: "csv-markdown-table",
    titleTag: "CSV to Markdown Table — and Back, Free & Private",
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
    relatedTools: ["csv-to-json", "json-to-csv", "xlsx-to-csv", "markdown-to-html", "vcf-to-csv"],
    aboutText:
      "Writing a Markdown table by hand is tedious and getting one out of a spreadsheet is worse, so this does both directions: a CSV becomes a table you can paste into a README, and a table pasted back becomes CSV again. Everything happens in the tab. The part worth caring about is escaping, because it is where hand-rolled converters quietly produce the wrong table rather than failing. A pipe character ends a cell in Markdown, so a single URL with a query string in it turns a two-column table into a three-column one — and the result is still a valid table, just not yours. Pipes are escaped here, and so are backslashes, which would otherwise eat the escape. Line breaks are the other case: a Markdown table row cannot contain one at all, so a multi-line CSV cell becomes a break tag, which is what every renderer expects and what survives a round trip back to CSV. Going the other way, the alignment row is recognised as structure rather than read as data, which is the mistake that inserts a row of dashes into your spreadsheet. Columns are padded so the Markdown source lines up in a plain text editor and in a diff — every renderer ignores that padding, so it costs nothing but readability, and it can be turned off. A ragged CSV, where some rows have fewer fields than others, is padded out rather than rejected, because a table with a missing cell is more useful than an error.",
  },
  {
    name: "Bcrypt Generator",
    slug: "bcrypt-generator",
    titleTag: "Bcrypt Generator & Checker — Free & Private",
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
    relatedTools: ["hash-generator", "hmac-generator", "password-generator", "jwt-encoder", "uuid-generator"],
    aboutText:
      "Bcrypt is what you store instead of a password. Unlike SHA-256 or MD5 it is deliberately slow and it salts every hash, and both of those properties exist to make a stolen database worth less. The salt means two people with the same password get different hashes, so a precomputed lookup table is useless. The slowness means an attacker testing billions of guesses pays the same multiplier you did — which is why the work factor is the only setting that matters here, and why each step of it doubles the cost rather than adding to it. Ten is what most frameworks default to and twelve is the common current advice; this page stops at fourteen, because beyond that the tab freezes for long enough that people assume it has crashed. The page shows how long your hash actually took on your own machine, which is a far better guide than any general recommendation. A bcrypt hash carries its own version, work factor and salt inside those sixty characters, which is why checking a password needs nothing but the hash itself — there is no separate salt to store and no configuration to remember. The checker here reports three outcomes rather than two: match, no match, and 'that is not a bcrypt hash'. Collapsing the third into the second is a common shortcut and it is a bad one, because it tells someone their password is wrong when what is actually wrong is the thing they pasted. Everything runs in your tab. That matters more here than on most pages, because using an online bcrypt tool means typing a real password into someone else's website; this one has nowhere to send it.",
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
