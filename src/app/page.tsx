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

/** What each workshop covers, and what actually runs it. */
const WORKSHOPS: Record<string, { blurb: string; engine: string; icon: React.ReactNode }> = {
  "image-tools": {
    blurb: "HEIC, WebP, AVIF, compression to an exact KB, crop, resize, favicons, EXIF.",
    engine: "CANVAS 2D",
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
    engine: "PDF-LIB · PDFJS",
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
    engine: "WEB AUDIO",
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
    engine: "FFMPEG · WEBCODECS",
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
    engine: "NATIVE JS",
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
  Every claim here is checked against the actual engine per tool — the design
  doc's seeded table credited FFmpeg with GIF encoding (it's gifenc) and
  undersold its own download. Sizes are the files we actually serve.

  Canvas 2D used to be credited with "every image conversion, compression,
  resize and crop": resizing is pica's Lanczos3 in both the main-thread
  (lib/tools/image-resize.ts) and worker (lib/workers/image.worker.ts) paths,
  and HEIC and TIFF are decoded by heic2any and utif2 before Canvas ever sees a
  bitmap — so those three have their own rows now. pdf.js did every page
  thumbnail and every PDF→image render with no row at all; pdf-lib's row used
  to say only "building a PDF out of images", which stopped being true when it
  absorbed all seven page and document operations.

  There is no PDF engine row with a download attached any more. This table used
  to carry a 10 MB MuPDF WASM row that loaded on the first PDF; that engine is
  gone from the app entirely, so merging, splitting, rotating, reordering,
  numbering and compressing now cost nothing beyond the JavaScript already in
  the page.

  lamejs has its own row for the same reason heic2any does: it is no longer
  bundled into the audio worker but fetched from /vendor/ at the first MP3
  encode, so folding it into Web Audio's "0 KB, built in" would hide a real
  254 KB request. Size is the byte count of the file we copy into public/vendor/.
*/
const ENGINES = [
  { name: "Canvas 2D", handles: "Image conversion, compression and crop — plus the frames gifenc quantises into a GIF", size: "0 KB", when: "BUILT IN" },
  { name: "pica", handles: "Image resizing, Lanczos3 — on the main thread and in the worker", size: "36 KB", when: "ON FIRST RESIZE" },
  { name: "heic2any", handles: "Decoding iPhone HEIC, which Canvas cannot open", size: "1.3 MB", when: "ON FIRST HEIC" },
  { name: "utif2", handles: "Decoding TIFF, likewise", size: "96 KB", when: "ON FIRST TIFF" },
  { name: "pdf.js", handles: "All PDF rendering — page thumbnails, and PDF to JPG or PNG", size: "1.6 MB", when: "ON PAGE PREVIEW" },
  { name: "pdf-lib", handles: "Every PDF page and document operation — merge, split, rotate, reorder, page numbers, compression, and images into a PDF", size: "320 KB", when: "ON FIRST PDF" },
  { name: "FFmpeg WASM", handles: "Lossless video trimming, MP3 extraction from video", size: "31 MB", when: "ON FIRST USE" },
  { name: "WebCodecs", handles: "Video compression and WebM→MP4, hardware H.264 encoding", size: "0 KB", when: "BUILT IN" },
  { name: "Web Audio", handles: "Decoding, trimming and merging audio", size: "0 KB", when: "BUILT IN" },
  { name: "lamejs", handles: "MP3 encoding — the one codec browsers will decode but not write", size: "254 KB", when: "ON FIRST MP3" },
] as const;

const STATS = [
  { n: "0", label: "bytes of your files sent anywhere, on any tool, ever" },
  { n: String(TOOL_COUNT), label: "tools, from HEIC conversion to cron expressions" },
  { n: "∞", label: "file size ceiling — your RAM is the only limit" },
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
                    {w.engine}
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
              No black box. These are the engines compiled into the page, and what each
              one costs you on first use.
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
