import Link from "next/link";
import { categories } from "@/data/categories";
import { getToolBySlug, tools, type Tool } from "@/data/tools";
import { getWorkspaceTool } from "@/data/workspace";
import { HeroSearch } from "@/components/home/HeroSearch";
import { LiveEngine } from "@/components/home/LiveEngine";
import { ConversionMatrix } from "@/components/home/ConversionMatrix";

const BASE_URL = "https://transmute.tools";
const TOOL_COUNT = tools.length;

// Hand-curated until we have GA4 top-N data; mixes commercial-intent search volume
// with category breadth (image, PDF, video, developer).
const POPULAR: { slug: string; desc: string }[] = [
  { slug: "heic-to-jpg", desc: "iPhone photos that Windows and web forms will actually accept." },
  { slug: "compress-image", desc: "By quality, or to an exact target like 100 KB." },
  { slug: "merge-pdf", desc: "Drag to reorder whole documents, then combine." },
  { slug: "compress-pdf", desc: "Drops dead objects, deflates raw streams, keeps your images." },
  { slug: "video-to-gif", desc: "Trim, set frame rate and width, see the size first." },
  { slug: "json-formatter", desc: "Format, validate and minify with line-accurate errors." },
  { slug: "jwt-decoder", desc: "Header, claims and expiry — parsed locally, safe on prod tokens." },
  { slug: "qr-code-generator", desc: "URLs, Wi-Fi and contact cards, as PNG or SVG." },
  { slug: "screen-recorder", desc: "Screen, window or tab, with optional narration." },
  { slug: "favicon-generator", desc: "Seven assets and the head snippet from one square." },
];

const popularTools = POPULAR.map((p) => ({ ...p, tool: getToolBySlug(p.slug) })).filter(
  (p): p is typeof p & { tool: Tool } => p.tool !== undefined,
);

/*
  What each workshop covers. What RUNS it is not repeated here.

  Every card used to carry its own `engine` string beside the one in
  data/categories.ts, kept in step by a pair of comments that asked the next
  editor to remember. They did not: this card said "WEB AUDIO" while the audio
  hub one click away said "WEB AUDIO · LAMEJS · FFMPEG" and "DOWNLOAD 0–31 MB",
  so the homepage understated a 31 MB fetch and a 254 KB one. The field is gone
  and the card reads `cat.engine` straight off the category it is already
  looping over, which is the only way two surfaces cannot disagree.
*/
const WORKSHOPS: Record<string, { blurb: string; icon: React.ReactNode }> = {
  "image-tools": {
    blurb: "HEIC, WebP, AVIF, compression to an exact KB, crop, resize, favicons, EXIF.",
    icon: (
      <>
        <rect x="32" y="48" width="192" height="160" rx="16" />
        <circle cx="96" cy="104" r="16" />
        <path d="M32 176l52-52a16 16 0 0 1 22 0l70 70" />
        <path d="M152 152l28-28a16 16 0 0 1 22 0l22 22" />
      </>
    ),
  },
  "pdf-tools": {
    blurb: "Merge, split, rotate, reorder pages, compress, add numbers, images to PDF.",
    icon: (
      <>
        <path d="M56 128V40a8 8 0 0 1 8-8h96l40 40v56" />
        <polyline points="152 32 152 88 208 88" />
        <path d="M48 168h20a20 20 0 0 1 0 40H48v-40z" />
        <path d="M120 168h16a20 20 0 0 1 20 20v0a20 20 0 0 1-20 20h-16v-40z" />
        <path d="M208 168h-28v40" />
        <line x1="180" y1="190" x2="202" y2="190" />
      </>
    ),
  },
  "audio-tools": {
    blurb: "Trim on a waveform, merge clips, convert between MP3, WAV and M4A.",
    icon: (
      <>
        <path d="M96 200V56l112-24v144" />
        <circle cx="60" cy="200" r="36" />
        <circle cx="172" cy="176" r="36" />
      </>
    ),
  },
  "video-tools": {
    blurb: "Trim, compress, record your screen, pull the audio out, convert to GIF.",
    icon: (
      <>
        <rect x="24" y="56" width="176" height="144" rx="16" />
        <path d="M200 108l40-28v96l-40-28" />
        <path d="M96 104l40 24-40 24z" />
      </>
    ),
  },
  "developer-tools": {
    blurb: "JSON, JWT, regex, hashes, UUIDs, cron, gradients, diffs, timestamps.",
    icon: (
      <>
        <polyline points="64 88 16 128 64 168" />
        <polyline points="192 88 240 128 192 168" />
        <line x1="152" y1="48" x2="104" y2="208" />
      </>
    ),
  },
};

/*
  ───────────────────────────────────────────────────────────────────────────
  THE RULE THIS COLUMN OBEYS. One ruler, stated once, and it is short:
  a row is an engine THIS ORIGIN SERVES AS ITS OWN FILE, and its DOWNLOAD
  figure is the byte count of that file. Nothing else gets a row.
  ───────────────────────────────────────────────────────────────────────────

  That rule is why the figures below are measurements of files rather than
  estimates, why `engine-disclosure.test.ts` can pin one to a file in public/
  or node_modules/ and go red when the file changes size, and why a reader can
  settle any of them against a line in the Network tab. (Not every row is
  pinned yet — pdf-lib's "320 KB" is the one figure here that answers to no
  file: the chunk /workers/ actually serves for it measured 431,490 bytes on
  this build, and the blog post quotes ~445 KB. It is flagged, not fixed, in
  this pass because inventing a fourth number for it is worse than leaving one
  wrong one visible.)

  It was being broken by the two rows that are no longer here. `pica` (36 KB)
  and `utif2` (96 KB) are not served files: they are bundled into whichever
  code-split chunk the importing tool lands in — `await import("utif2")` in
  lib/tools/image-convert.ts is the same mechanism as `import("bwip-js/generic")`
  in lib/tools/barcode.ts — and the paragraph that used to sit at the bottom of
  this comment cited exactly that mechanism as the reason bwip-js, svgo and
  mammoth had no row. One mechanism, two verdicts, and the three excluded were
  each an order of magnitude bigger than the two included: 947,409 / 579,847 /
  489,613 bytes against 96 KB and 36 KB.

  Measuring is the deeper reason, not squeamishness. A bundled library has no
  size of its own — it has whatever chunk the bundler put it in, alongside
  whatever else that page happened to need. In the static export the chunks
  carrying `utif2` measure 60,485, 36,086 and 380,757 bytes, the last of those
  because utif2 is sharing a chunk with pdf-lib. There is no one number to put
  in a column beside qpdf's 2,403,819 exact bytes, so putting one there makes
  the column mean two things.

  So bundled code is DISCLOSED rather than ROWED. `BUNDLED` below feeds a
  paragraph under the table naming every bundled library that costs a real
  download, with a figure measured off this site's own static export and marked
  "about". What is not allowed, anywhere on the site, is silence: /licenses
  described /barcode-generator as fetching nothing while it fetched 947,409
  bytes of BWIPP encoder, and that is the defect this whole comment exists to
  close.

  Every claim here is checked against the actual engine per tool — the design
  doc's seeded table credited FFmpeg with GIF encoding (it's gifenc) and
  undersold its own download. Sizes are the files we actually serve.

  Canvas 2D used to be credited with "every image conversion, compression,
  resize and crop", and three of those it does not do: resizing is pica's
  Lanczos3 in both the main-thread (lib/tools/image-resize.ts) and worker
  (lib/workers/image.worker.ts) paths, and HEIC and TIFF are decoded by
  libheif and utif2 before Canvas ever sees a bitmap. libheif keeps a row
  because /vendor/libheif.js and its .wasm are files we serve; pica and utif2 are named
  under the table for the reason above. pdf.js did every page thumbnail and
  every PDF→image render with no row at all; pdf-lib's row used to say only
  "building a PDF out of images", which stopped being true when it absorbed all
  seven page and document operations.

  This table used to carry a 10 MB MuPDF WASM row that loaded on the first PDF;
  that engine is gone from the app entirely, so merging, splitting, rotating,
  reordering, numbering and compressing cost nothing beyond pdf-lib.

  qpdf replaced none of that — it is a second, separate engine, and it has its
  own row because it has its own download. Encryption, decryption, permissions
  and repair are the four things pdf-lib cannot do (it cannot so much as parse
  an AES-256 document), so protect-pdf, unlock-pdf, pdf-permissions and
  repair-pdf fetch /qpdf.js and /qpdf.wasm — 63,089 + 2,340,730 bytes, 2.3 MB
  together, the byte counts of the files we copy into public/. Size is the pair,
  because you never get one without the other. It lands the first time one of
  those tools reads a file, not when the page opens: the three that pre-flight
  fetch it on the drop, repair-pdf on the click. Leaving it out would have made
  the "no black box" framing above false on the one row a reader most needs.

  The FFmpeg row was rewritten on 2026-09-05. It used to read "Container swaps
  WITHOUT re-encoding … and MP3 extraction from video", and this table is framed
  as exhaustive, so that sentence was doing two false things at once. The remux
  cluster (2026-09-03) shipped an H.264 re-encode arm — video-remux.ts builds
  "-c:v libx264" and VideoRemuxUI offers it as a toggle when a stream copy would
  produce a file the user's player refuses — so "without re-encoding" described
  the happy path as if it were the whole engine. And the audio matrix
  (2026-09-04) added FLAC encoding and WMA decode, neither of which is "MP3
  extraction from video". The loudness and silence filters are this session's
  addition. The row now names the re-encode explicitly, because a reader
  choosing this site over an uploader is entitled to know which of their pixels
  get rewritten.

  lamejs has its own row for the same reason libheif does: it is no longer
  bundled into the audio worker but fetched from /vendor/ at the first MP3
  encode, so folding it into Web Audio's "0 KB, built in" would hide a real
  254 KB request. Size is the byte count of the file we copy into public/vendor/.

  zxing-wasm and libarchive are the developer hub's first real downloads, added
  2026-09-05 with /qr-code-reader and /extract-archive. Both npm packages expect
  to fetch their .wasm from a CDN — zxing-wasm hardcodes fastly.jsdelivr.net —
  and shipping that unconfigured would have handed a third party the visitor's
  IP on a site whose whole pitch is that nothing leaves the tab. So both are
  staged into the origin root by `npm run copy:wasm` and loaded from there, and
  the sizes below are again the byte counts of the files we copy into public/:
  zxing_reader.wasm is 1,093,289 bytes and libarchive.wasm is 613,235 bytes.

  Those two figures are the WebAssembly only. Each engine also has a JavaScript
  loader, and that loader is bundled rather than served, so by the rule at the
  top of this comment it is not part of the row — it is named under the table
  with the rest of the bundled code, at about 37 KB and 65 KB (38,227 and
  66,712 bytes, bundled and minified with esbuild). Keeping it out is also what
  keeps the row exact: measured a second way libarchive's sum rounds to 665 KB
  instead of 664, and a figure whose last digit turns on which bundler you asked
  cannot be pinned to an artifact. One surface does quote the pair —
  /qr-code-reader's ADVANCED rail renders 1.1 MB from ZXING_FIRST_SCAN_BYTES
  while this row and the developer hub say 1.0 MB — and it is the outlier, not
  the ruler; category-hub-claims.test.tsx now pins this row AND the hub to the
  bytes of zxing_reader.wasm on disk so the anchor is the artifact rather than
  another sentence on the site.

  oxipng joins them on 2026-09-06 with /compress-png, and it is the first image
  engine on this table since the HEIC decoder. The rule at the top settles the row
  without argument: `npm run copy:wasm` stages
  node_modules/@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm into public/,
  the worker fetches it from the origin root as /squoosh_oxipng_bg.wasm on the
  first PNG, so it is a file this origin serves and 164,172 bytes is what the
  Network tab shows — 160.3 KiB on this column's binary one-decimal ruler.
  Its 6,307-byte wasm-bindgen loader is not part of the figure, for the reason
  zxing's and libarchive's loaders are not: it is bundled into
  /workers/image.worker.js rather than served, and by this comment's own rule
  bundled code is disclosed under the table instead of rowed. It is far too
  small to name there beside bwip-js, so it goes in the loaders clause under
  the table with pica and utif2 — which is why that clause no longer counts
  the engines it covers and no longer says every loader is tens of kilobytes.
  It said "the two WebAssembly engines above" until oxipng made it three, and
  6,307 bytes is not tens of kilobytes by any rounding: a sentence that has to
  be edited every time an engine arrives is a sentence that will be wrong
  between arrivals, so it names no count and states the outlier instead.

  Why an image engine needs a row at all, when Canvas 2D sits at 0 KB two rows
  up: re-encoding a PNG through a canvas is not compression. It decodes the
  pixels and writes them again with the browser's own encoder, which is
  routinely LARGER than what came in, and it is the no-op /compress-png exists
  to replace. oxipng re-searches the filters and the deflate stream over the
  same pixels, which is a different operation and needs a different engine.

  What is NOT here is deliberate too. zxing-wasm publishes a writer build as
  well; /barcode-generator does not use it — bwip-js draws those in JavaScript,
  and the reader .wasm we serve contains no zint symbols at all. That is a
  claim about WebAssembly and not about cost: bwip-js is the single largest
  bundled download on the site, and it is named as such below. libarchive is
  the read-only build: sixteen archive_read_support_format_* symbols and zero
  archive_write_set_format_*, so /extract-archive cannot create an archive even
  if someone asked it to.
*/
const ENGINES = [
  { name: "Canvas 2D", handles: "Image conversion, compression and crop — plus the frames gifenc quantises into a GIF", size: "0 KB", when: "BUILT IN" },
  { name: "libheif", handles: "Decoding iPhone HEIC, which Canvas cannot open — the decoder and its WebAssembly binary, fetched as a pair. TIFF is decoded by utif2, which is bundled rather than served and is named under the table", size: "1.4 MB", when: "ON FIRST HEIC" },
  { name: "oxipng", handles: "Real PNG re-compression — the one image job a canvas re-encode cannot do at all", size: "160 KB", when: "ON FIRST PNG" },
  { name: "pdf.js", handles: "All PDF rendering — page thumbnails, and PDF to JPG or PNG", size: "1.6 MB", when: "ON PAGE PREVIEW" },
  { name: "pdf-lib", handles: "PDF page and document work — merge, split, rotate, reorder, page numbers, compression, and images into a PDF", size: "320 KB", when: "ON FIRST PDF" },
  { name: "qpdf", handles: "PDF passwords and permissions — protect, unlock, restrict, and repair a damaged file", size: "2.3 MB", when: "ON FIRST USE" },
  { name: "FFmpeg WASM", handles: "Stream-copy video work — container swaps, muting, rotating, trimming, splitting and joining — plus audio extraction and formats, loudness and silence filters, and the one H.264 re-encode offered when a copy would not play", size: "31 MB", when: "ON FIRST USE" },
  { name: "Tesseract", handles: "Reading printed text out of a photo, screenshot or scan — the OCR engine, its worker and the English language model, which is the only language served", size: "4.9 MB", when: "ON FIRST OCR" },
  { name: "WebCodecs", handles: "Video compression and WebM→MP4, hardware H.264 encoding", size: "0 KB", when: "BUILT IN" },
  { name: "Web Audio", handles: "Decoding, trimming and merging audio", size: "0 KB", when: "BUILT IN" },
  { name: "lamejs", handles: "MP3 encoding — the one codec browsers will decode but not write", size: "253 KB", when: "ON FIRST MP3" },
  { name: "zxing-wasm", handles: "Reading QR codes and barcodes out of a dropped image — the zxing-cpp reader, self-hosted rather than fetched from its default CDN", size: "1.0 MB", when: "ON FIRST SCAN" },
  { name: "libarchive", handles: "Opening TAR, 7z, RAR, CAB, ISO and CPIO, including tar.gz, tar.bz2 and tar.xz — listing what is inside and extracting it. This build cannot write an archive, and cannot open a bare .gz, .bz2 or .xz: a lone .gz is unpacked by the browser’s own DecompressionStream instead", size: "599 KB", when: "ON FIRST ARCHIVE" },
] as const;

/*
  The other half of the disclosure: the libraries that arrive INSIDE a tool's
  own code-split chunk instead of as a file this origin names. By the rule at
  the top of ENGINES they get no row, and until this pass they got no mention
  either — which is how /licenses came to describe /barcode-generator as
  fetching nothing while it fetched 947,409 bytes.

  Sizes are the chunks this site's own static export emits (`npm run build`,
  out/_next/static/chunks), rounded on the same binary ruler the table uses:

    bwip-js        947,409 B  out/…/0_rlp8txzn-b0.js  (BWIPP encoders, nothing else)
    svgo           579,847 B  out/…/03aw_xbxoykjg.js
    mammoth        489,613 B  out/…/0-ttxtgopk56i.js  (mammoth + its jszip + pako)
    sql-formatter  294,798 B  out/…/0fx2vcg6z4pj2.js
    jszip          127,460 B  out/…/05-w2owfel3~q.js  (jszip + pako)

  sql-formatter is the one that shows why this list had to be measured rather
  than guessed at: the comment this replaced filed it with "js-yaml, marked,
  turndown, diff, qrcode" as an obviously-small parsing library, and it is
  bigger than jszip.

  Every one of them says "about", and that word is doing real work rather than
  hedging: the bundler decides how a library is split and who it shares with.
  The four above happen to sit in chunks of their own (mammoth's carries the
  jszip and pako it depends on, and the note says so), which is why they are
  quotable at all — utif2, by contrast, appears in a 60,485-byte chunk on one
  page and inside a 380,757-byte one shared with pdf-lib on another, and has no
  figure that would mean anything. None of this can be pinned to an artifact
  the way a served file can, which is why it is prose under the table rather
  than a number in it — and why it is still here, because "about 925 KB" is
  very much closer to the truth than saying nothing.
*/
const BUNDLED = [
  { name: "bwip-js", size: "925 KB", where: "/barcode-generator" },
  { name: "svgo", size: "566 KB", where: "/svg-optimizer" },
  { name: "mammoth", size: "478 KB", where: "/docx-to-markdown" },
  { name: "sql-formatter", size: "288 KB", where: "/sql-formatter" },
  { name: "jszip", size: "124 KB", where: "/create-zip and /unzip-files" },
] as const;

const BUNDLED_SENTENCE = BUNDLED.map(
  (b) => `about ${b.size} of ${b.name} on ${b.where}`,
).join("; ");

/*
  Counted, not asserted — and counted over the right population, which took two
  goes.

  This tile used to read "∞ — file size ceiling, your RAM is the only limit",
  and by now both halves were wrong: 11 tools enforce a cap (`Tool.maxSizeMB`),
  37 more hold the whole file in memory and say so (`Tool.practicalLimitNote`),
  and the wall behind all of them is the RENDERER's ~2 GB single-buffer limit
  rather than the machine's RAM — the derivation block at the top of
  src/lib/tools/ffmpeg-loader.ts measures it at 2040 MiB ok / 2047 MiB
  `RangeError`.
  ⚠ Two corrections, both made 2026-09-13. (a) Those counts were "nine" and
  "seventeen" and are now 11 and 37 — they are re-counted from the registry
  here, and every number the TILE renders is computed from `FILE_TOOLS` below,
  so what drifted was this explanation and never the page. (b) It said "V8's"
  limit. It is not V8's: the same V8 under Node allocates 4096 MiB with the
  last byte writable. The ceiling belongs to the renderer, which is why it is
  a fact about where this runs rather than about the language.

  The count that replaced it was "neither field", and that was wrong too, in a
  quieter way: 24 of the tools it counted take no file at all. A password
  generator has nothing to say about file sizes — /password-generator's own
  spec panel reads ACCEPTS: NONE, MAX SIZE: NONE — so counting it as a tool
  that takes a file of any size overstated 66 as 90. A count is only better
  than the absolute claim it replaced if the count is right.

  So the denominator is the tools that take a file (`!t.takesNoFile`), and the
  two halves of the sentence partition exactly that set: 104 print "NO SIZE CAP"
  because they have no ceiling anyone has found, 48 name one. (Those were 66
  and 26 when this was written at 92 file-taking tools; there are 152 now. The
  rendered numbers are computed, so only this sentence went stale.)
  `src/__tests__/unit/data/file-input-claims.test.ts` checks `takesNoFile`
  against what each component actually mounts, and
  `src/__tests__/unit/data/size-claims.test.ts` keeps the ceiling half honest.
*/
const FILE_TOOLS = tools.filter((t) => !t.takesNoFile);
const UNCAPPED_TOOL_COUNT = FILE_TOOLS.filter(
  (t) => !t.maxSizeMB && !t.practicalLimitNote,
).length;
const BOUNDED_TOOL_COUNT = FILE_TOOLS.length - UNCAPPED_TOOL_COUNT;

const STATS = [
  { n: "0", label: "bytes of your files sent anywhere, on any tool, ever" },
  { n: String(TOOL_COUNT), label: "tools, from HEIC conversion to cron expressions" },
  {
    n: String(UNCAPPED_TOOL_COUNT),
    // "of the N that take one" is load-bearing, not padding: the tile above
    // this one counts all 116 tools, so a bare "the other 26" would be read
    // against that and would once again be counting generators.
    label: `of the ${FILE_TOOLS.length} tools that take a file, this many take one of any size — the other ${BOUNDED_TOOL_COUNT} name their ceiling`,
  },
  { n: "—", label: "no account, no email, no trial, no watermark" },
] as const;

const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Transmute",
  url: BASE_URL,
  description:
    "Free, private, browser-based file conversion tools. Convert images, PDFs, audio, video, and more — no uploads, no sign-ups.",
  potentialAction: {
    "@type": "SearchAction",
    target: `${BASE_URL}/?q={search_term_string}`,
    "query-input": "required name=search_term_string",
  },
};

const RULE =
  "mx-4 h-px bg-[linear-gradient(to_right,transparent,var(--color-border)_48px,var(--color-border)_calc(100%-48px),transparent)] md:mx-11";

const ENGINE_GRID = "grid grid-cols-[1.1fr_1.6fr_90px_110px] gap-4";

export default function Home() {
  return (
    <main className="flex-1">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
      />

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-4 pt-16 pb-16 md:px-11 md:pt-24 md:pb-19">
        {/* The doc's hero glow is tmGlow 11s (0.3 ↔ 0.75); the shared `animate-tm-glow`
            token is 9s (0.35 ↔ 0.8) and has six other importers, so the duration is
            corrected here against the same keyframe rather than by retuning the token. */}
        <div className="pointer-events-none absolute -top-[140px] left-[180px] h-[420px] w-[620px] animate-tm-glow-home rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--color-accent)_40%,transparent)_0%,transparent_68%)] blur-[150px] motion-reduce:animate-none" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(233,233,237,.05)_1px,transparent_0)] bg-[length:26px_26px] opacity-45" />

        <div className="relative mx-auto grid max-w-[1440px] items-start gap-12 lg:grid-cols-[1fr_420px] lg:gap-18">
          <div className="max-w-[640px]">
            <div className="mb-[30px] inline-flex items-center gap-[9px] rounded-[6px] border border-accent/35 px-[11px] py-1.5 font-mono text-[10.5px] leading-none font-medium tracking-[0.14em] whitespace-nowrap text-accent-300">
              {TOOL_COUNT} TOOLS · 0 SERVERS · 0 ACCOUNTS
            </div>

            <h1 className="m-0 mb-6 font-display text-[clamp(38px,7vw,68px)] leading-[1.03] font-medium tracking-[-0.03em] text-text-primary">
              Change the file.
              <br />
              Not the file&rsquo;s owner.
            </h1>

            <p className="m-0 mb-[38px] max-w-[470px] font-body text-[17px] leading-[1.65] text-neutral-400">
              Every engine runs inside your tab. There is no upload, because there is
              nowhere to upload to.
            </p>

            <HeroSearch />
          </div>

          <LiveEngine />
        </div>
      </section>

      <div className={RULE} />

      {/* ── Five workshops ───────────────────────────────────── */}
      <section className="px-4 pt-14 pb-16 md:px-11">
        <div className="mx-auto max-w-[1440px]">
          <div className="mb-[26px] flex items-baseline justify-between">
            <h2 className="m-0 font-display text-2xl leading-[1.2] font-medium tracking-[-0.02em] text-text-primary">
              Five workshops
            </h2>
            <span className="font-mono text-[11px] leading-none text-text-muted">
              {TOOL_COUNT} TOOLS TOTAL
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-5">
            {categories.map((cat) => {
              const w = WORKSHOPS[cat.slug];
              const count = tools.filter((t) => t.category === cat.slug).length;
              return (
                <Link
                  key={cat.slug}
                  href={`/${cat.slug}`}
                  className="group relative flex min-h-[186px] flex-col gap-3 rounded-[11px] border border-border p-[18px] pt-5 transition-colors duration-[220ms] hover:border-accent/55 hover:bg-accent/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex size-8 items-center justify-center rounded-md border border-accent/30 text-accent">
                      <svg
                        width="17"
                        height="17"
                        viewBox="0 0 256 256"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="14"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        {w.icon}
                      </svg>
                    </span>
                    <span className="font-mono text-[11px] leading-none font-medium text-text-muted">
                      {count}
                    </span>
                  </div>
                  <div className="font-display text-[15px] leading-[1.2] font-medium text-text-primary">
                    {cat.name.replace(" Tools", "")}
                  </div>
                  <div className="font-body text-xs leading-[1.55] text-text-muted">
                    {w.blurb}
                  </div>
                  <div className="mt-auto font-mono text-[10.5px] leading-none tracking-[0.06em] text-text-muted">
                    {cat.engine}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── What turns into what ─────────────────────────────── */}
      <section className="px-4 pt-3 pb-17 md:px-11">
        <div className="mx-auto grid max-w-[1440px] items-center gap-12 lg:grid-cols-[1fr_470px] lg:gap-16">
          <div className="max-w-[520px]">
            <h2 className="m-0 mb-3.5 font-display text-2xl leading-[1.2] font-medium tracking-[-0.02em] text-text-primary">
              What turns into what
            </h2>
            <p className="m-0 mb-5.5 font-body text-sm leading-[1.7] text-neutral-400">
              Read down for what you have, across for what you need. A filled cell is a
              tool that already exists; an outlined one on the diagonal means the format
              stays put and only the file gets smaller.
            </p>
            <div className="flex flex-wrap gap-6.5">
              <span className="flex items-center gap-[9px] font-body text-[11.5px] leading-none text-text-muted">
                <span className="size-[13px] rounded-[3px] bg-accent" />
                Converts
              </span>
              <span className="flex items-center gap-[9px] font-body text-[11.5px] leading-none text-text-muted">
                <span className="size-[13px] rounded-[3px] border-[1.5px] border-accent" />
                Optimises in place
              </span>
              <span className="flex items-center gap-[9px] font-body text-[11.5px] leading-none text-text-muted">
                <span className="size-[13px] rounded-[3px] border border-neutral-800" />
                Not a route
              </span>
            </div>
          </div>
          <ConversionMatrix />
        </div>
      </section>

      {/* ── Stat band — the one saturated ground in the system ─ */}
      <section className="relative overflow-hidden bg-[var(--color-section)] px-4 py-13 md:px-11">
        <div className="pointer-events-none absolute -top-[100px] right-[120px] h-[300px] w-[420px] rounded-full bg-[radial-gradient(circle,var(--color-section-glow)_0%,transparent_70%)] blur-[120px]" />
        <div className="relative mx-auto grid max-w-[1440px] grid-cols-2 gap-10 lg:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className="flex flex-col gap-2">
              <span className="font-mono text-[40px] leading-none font-medium text-neutral-100">
                {s.n}
              </span>
              <span className="font-body text-[12.5px] leading-[1.5] text-neutral-100/68">
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Reached for most ─────────────────────────────────── */}
      <section className="px-4 py-16 md:px-11">
        <div className="mx-auto grid max-w-[1440px] items-start gap-10 lg:grid-cols-[260px_1fr] lg:gap-14">
          {/* 74px is the shared "pin clear of the 58px navbar" offset — the
              hubs, the blog rails and the tool aside all use it. The Home
              Redesign doc draws this one rail at `sticky;top:82px`, but Site
              Pages draws the same rail at 74px in all three of its instances,
              so the docs disagree 3-to-1 and the shared offset wins. */}
          <div className="lg:sticky lg:top-[82px]">
            <h2 className="m-0 mb-3 font-display text-2xl leading-[1.2] font-medium tracking-[-0.02em] text-text-primary">
              Reached for most
            </h2>
            <p className="m-0 font-body text-[13px] leading-[1.6] text-text-muted">
              Hand-picked across every category. Each opens with the file drop already
              focused.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-x-11 md:grid-cols-2">
            {popularTools.map((p, i) => (
              <Link
                key={p.slug}
                href={`/${p.slug}`}
                className="flex items-center gap-4 border-b border-border py-[15px] transition-[padding-left] duration-[220ms] hover:pl-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <span className="w-5 flex-none font-mono text-[10.5px] leading-none text-text-muted">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <span className="font-body text-sm leading-[1.3] font-medium text-text-primary">
                    {p.tool.name}
                  </span>
                  <span className="font-body text-xs leading-[1.45] text-text-muted">
                    {p.desc}
                  </span>
                </span>
                <span className="flex-none font-mono text-[10.5px] leading-none whitespace-nowrap text-accent-300">
                  {getWorkspaceTool(p.slug)?.route}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <div className={RULE} />

      {/* ── What is actually running ─────────────────────────── */}
      <section className="px-4 py-16 md:px-11">
        <div className="mx-auto grid max-w-[1440px] items-start gap-10 lg:grid-cols-[260px_1fr] lg:gap-14">
          <div>
            <h2 className="m-0 mb-3 font-display text-2xl leading-[1.2] font-medium tracking-[-0.02em] text-text-primary">
              What is actually running
            </h2>
            <p className="m-0 font-body text-[13px] leading-[1.6] text-text-muted">
              No black box. Every engine this site serves you as its own file, and what
              that file costs the first time a tool needs it. The parsing libraries that
              ride inside a tool&rsquo;s own bundle are not files, so they are named under
              the table rather than guessed at inside it.
            </p>
          </div>

          <div className="overflow-x-auto rounded-[11px] border border-border">
            <div className="min-w-[560px]">
              <div
                className={`${ENGINE_GRID} border-b border-border bg-text-primary/3 px-[18px] py-[11px] font-mono text-[9.5px] leading-none font-medium tracking-[0.12em] text-text-muted`}
              >
                <span>ENGINE</span>
                <span>HANDLES</span>
                <span className="text-right">DOWNLOAD</span>
                <span className="text-right">LOADED</span>
              </div>
              {ENGINES.map((e) => (
                <div
                  key={e.name}
                  className={`${ENGINE_GRID} items-center border-b border-border px-[18px] py-3.5`}
                >
                  <span className="font-mono text-[12.5px] leading-none font-medium text-text-primary">
                    {e.name}
                  </span>
                  <span className="font-body text-[12.5px] leading-[1.4] text-text-muted">
                    {e.handles}
                  </span>
                  <span className="text-right font-mono text-[11.5px] leading-none text-neutral-400">
                    {e.size}
                  </span>
                  <span
                    className={`text-right font-mono text-[10px] leading-none font-medium tracking-[0.06em] whitespace-nowrap ${
                      e.when === "BUILT IN" ? "text-success" : "text-text-muted"
                    }`}
                  >
                    {e.when}
                  </span>
                </div>
              ))}
            </div>
            <p className="m-0 border-t border-border px-[18px] py-3.5 font-body text-[12px] leading-[1.6] text-text-muted">
              <span className="font-mono text-[9.5px] tracking-[0.12em] text-neutral-400">
                BUNDLED, NOT SERVED
              </span>{" "}
              &mdash; a handful of tools reach for a parsing library that arrives inside
              that tool&rsquo;s own code-split chunk instead of as a file named above. It
              is a real download and this is roughly the size of it:{" "}
              {BUNDLED_SENTENCE}. Smaller ones &mdash; utif2 for TIFF, pica for resizing,
              js-yaml, marked, turndown, diff, qrcode, gifenc, and the JavaScript loaders
              for the WebAssembly engines above &mdash; are at most tens of kilobytes
              each rather than hundreds; oxipng&rsquo;s wasm-bindgen loader, the smallest
              of them, is 6,307 bytes. Every figure here says
              &ldquo;about&rdquo; because the bundler decides how a library is split, and
              the same library measures differently on two pages; the numbers come from
              this site&rsquo;s own static export.
            </p>
          </div>
        </div>
      </section>

      {/* ── Closing ──────────────────────────────────────────── */}
      <section className="px-4 pt-5 pb-22 md:px-11">
        <div className="relative mx-auto flex max-w-[1440px] flex-col items-start justify-between gap-8 overflow-hidden rounded-[14px] border border-border p-8 md:px-12 md:py-13 lg:flex-row lg:items-center lg:gap-12">
          <div className="pointer-events-none absolute -bottom-[160px] -left-[60px] h-[320px] w-[480px] rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--color-accent)_28%,transparent)_0%,transparent_70%)] blur-[130px]" />
          <div className="relative max-w-[600px]">
            <h2 className="m-0 mb-3.5 font-display text-[clamp(24px,4vw,32px)] leading-[1.15] font-medium tracking-[-0.025em] text-text-primary">
              Drop a file. That is the whole onboarding.
            </h2>
            <p className="m-0 font-body text-[14.5px] leading-[1.65] text-neutral-400">
              No sign-up screen, no plan comparison, no &ldquo;we&rsquo;ve emailed you a
              link&rdquo;. Pick a tool, drop the file, take the result.
            </p>
          </div>
          <div className="relative flex w-full flex-wrap gap-[11px] lg:w-auto lg:flex-none lg:flex-nowrap">
            <Link
              href="/image-tools"
              className="flex h-[42px] items-center rounded-[9px] border border-accent px-5.5 font-display text-sm leading-none font-medium whitespace-nowrap text-accent transition-colors duration-200 hover:bg-accent/12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Browse image tools
            </Link>
            <Link
              href="/privacy"
              className="flex h-[42px] items-center rounded-[9px] border border-border px-5.5 font-display text-sm leading-none font-medium whitespace-nowrap text-neutral-300 transition-colors duration-200 hover:bg-text-primary/7 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Read the privacy note
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
