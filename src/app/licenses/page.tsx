import type { Metadata } from "next";

/**
 * The notices page. Every tool on this site runs in the visitor's own tab, but
 * the engines doing the running are other people's work, and several of them
 * attach conditions to being shipped at all: a credit line that must appear,
 * a notice that must travel with the binary, an offer of corresponding source.
 * This page is where those obligations are discharged in public.
 *
 * Server Component on purpose — it is text and links, and it must render
 * identically for a crawler, a reader with JavaScript off, and anyone
 * archiving the page as evidence that the offer was actually made.
 *
 * The long license texts are NOT inlined here. They are static files under
 * `public/licenses/` so they are byte-exact and independently linkable; this
 * page only says which one applies to what, and why.
 */

export const metadata: Metadata = {
  // The root layout's template appends " | Transmute".
  title: "Licenses",
  description:
    "Third-party licenses and notices for every engine transmute.tools ships — FFmpeg, lamejs, libheif, ExifReader, and the permissive libraries behind the tools.",
  alternates: { canonical: "/licenses" },
};

const LAST_UPDATED = "31 AUG 2026";

/**
 * The site currently deploys at an apex domain with no basePath, so this
 * resolves to "". It is read rather than hardcoded because these links point
 * at files in `public/`, which move with the base path if one is ever
 * reintroduced — and a rotted link on this page is a compliance failure, not
 * a cosmetic one.
 */
const BASE = process.env.__NEXT_ROUTER_BASEPATH ?? "";
const licenseText = (file: string): string => `${BASE}/licenses/${file}`;

type Ref = { readonly href: string; readonly label: string };

type Engine = {
  readonly id: string;
  /** Heading. Carries the exact package and version wherever one exists. */
  readonly name: string;
  /** SPDX identifier, shown as the eyebrow so the terms are legible at a glance. */
  readonly spdx: string;
  /** How these bytes actually reach the browser. Stated because the answer changes the obligation. */
  readonly ships: string;
  readonly paras: readonly string[];
  /** A verbatim credit line the upstream project requires be displayed. */
  readonly credit?: string;
  /** A build command reproduced exactly, as part of a source offer. */
  readonly pre?: string;
  readonly preCaption?: string;
  readonly libs?: readonly { readonly name: string; readonly license: string }[];
  readonly libsCaption?: string;
  readonly refs: readonly Ref[];
};

const ENGINES: readonly Engine[] = [
  {
    id: "ffmpeg",
    name: "FFmpeg",
    spdx: "GPL-2.0-OR-LATER",
    ships: "@ffmpeg/core 0.12.10 — served from this origin as /ffmpeg-core.js and /ffmpeg-core.wasm (roughly 31 MB), fetched the first time you open a tool that needs it.",
    credit: "This software uses code of FFmpeg licensed under the GPLv2 or later.",
    paras: [
      "Written offer of source. The core shipped here is @ffmpeg/core 0.12.10, taken unmodified from npm. Its complete corresponding source is two things, both linked below: the build configuration in the ffmpegwasm/ffmpeg.wasm repository at tag v0.12.10 — the Dockerfile and the scripts under build/ there are the build — and FFmpeg itself at n5.1.4, which is the revision that Dockerfile pins. If either link has rotted by the time you read this, write to the maintainer at the address at the foot of this page and you will be sent the exact sources for the binary this site serves.",
      "How it reaches you, and why that matters. This site's own code never links FFmpeg. It calls @ffmpeg/ffmpeg, an MIT wrapper that spawns a worker of its own; that worker loads the core and exposes a single command-line-shaped exec() call. Every argument in and every byte out crosses the worker boundary as a postMessage. The core is a separate program that this site starts and talks to at arm's length, and it is conveyed whole, unmodified, and with the source offer above. That is the posture. If you read the boundary differently, the contact address below is the right place to say so.",
    ],
    preCaption:
      "Configured exactly like this. The string is verifiable inside the .wasm this site serves:",
    pre: "--target-os=none --arch=x86_32 --enable-cross-compile --disable-asm --disable-stripping --disable-programs --disable-doc --disable-debug --disable-runtime-cpudetect --disable-autodetect --nm=emnm --ar=emar --ranlib=emranlib --cc=emcc --cxx=em++ --objcc=emcc --dep-cc=emcc --extra-cflags='-I/opt/include -O3 -msimd128' --extra-cxxflags='-I/opt/include -O3 -msimd128' --disable-pthreads --disable-w32threads --disable-os2threads --enable-gpl --enable-libx264 --enable-libx265 --enable-libvpx --enable-libmp3lame --enable-libtheora --enable-libvorbis --enable-libopus --enable-zlib --enable-libwebp --enable-libfreetype --enable-libfribidi --enable-libass --enable-libzimg",
    libsCaption:
      "Statically linked into that core, at the versions the linked Dockerfile pins. Each carries its own terms, which travel with its source:",
    libs: [
      { name: "x264", license: "GPL-2.0-or-later" },
      { name: "x265 3.4", license: "GPL-2.0-or-later" },
      { name: "libvpx 1.13.1", license: "BSD-3-Clause" },
      { name: "LAME (libmp3lame)", license: "LGPL" },
      { name: "libtheora 1.1.1", license: "BSD-3-Clause" },
      { name: "libogg 1.3.4", license: "BSD-3-Clause" },
      { name: "libvorbis 1.3.3", license: "BSD-3-Clause" },
      { name: "libopus 1.3.1", license: "BSD-3-Clause" },
      { name: "libwebp 1.3.2", license: "BSD-3-Clause" },
      { name: "FreeType 2.10.4", license: "FTL or GPL-2.0" },
      { name: "FriBidi 1.0.9", license: "LGPL-2.1-or-later" },
      { name: "HarfBuzz 5.2.0", license: "MIT" },
      { name: "libass 0.15.0", license: "ISC" },
      { name: "zimg 3.0.5", license: "WTFPL" },
      { name: "zlib 1.2.11", license: "Zlib" },
    ],
    refs: [
      { href: "https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.10", label: "BUILD CONFIG (v0.12.10)" },
      { href: "https://github.com/FFmpeg/FFmpeg/tree/n5.1.4", label: "FFMPEG SOURCE (n5.1.4)" },
      { href: licenseText("gpl-2.0.txt"), label: "GPL-2.0 TEXT" },
    ],
  },
  {
    id: "lamejs",
    name: "lamejs",
    spdx: "LGPL-3.0",
    ships: "@breezystack/lamejs 1.2.7 — served unbundled at /vendor/lamejs.js, byte for byte as its authors published it, and imported at runtime the first time you encode an MP3.",
    paras: [
      "The LGPL lets a program use a library while keeping its own terms, but only on the condition that the library stays replaceable: whoever receives the combined work has to be able to substitute their own build of it. So lamejs is compiled into nothing here. It sits on its own at a stable URL and is loaded by that URL at runtime. Swapping in an interface-compatible build of the encoder means replacing that one file — nothing on this site is recompiled, and the replacement is what runs.",
      "LGPL-3.0 is written as a set of additional permissions layered on GPL-3.0 and incorporates that license by reference, so both texts are linked. The third link is the LAME project's own notice about using it in a commercial program.",
    ],
    refs: [
      { href: "https://github.com/shijinyu/lamejs", label: "SOURCE" },
      { href: licenseText("lgpl-3.0.txt"), label: "LGPL-3.0 TEXT" },
      { href: licenseText("gpl-3.0.txt"), label: "GPL-3.0 TEXT" },
      { href: licenseText("lame-notice.txt"), label: "LAME NOTICE" },
    ],
  },
  {
    id: "libheif",
    name: "libheif and libde265",
    spdx: "LGPL-3.0-OR-LATER",
    ships: "Compiled inside heic2any 0.0.4 — served unbundled at /vendor/heic2any.js, byte for byte as published, and imported at runtime the first time you open a HEIC.",
    paras: [
      "The heic2any wrapper is MIT, but the file it publishes has libheif and libde265 compiled into it, and both of those are LGPL. That makes the same replaceability condition apply to it as to lamejs, so it gets the same treatment: not bundled, served at its own stable URL, loaded by that URL at runtime. Replacing the HEIC decoder is replacing that single file.",
    ],
    refs: [
      { href: "https://github.com/alexcorvi/heic2any", label: "WRAPPER SOURCE" },
      { href: "https://github.com/strukturag/libheif", label: "LIBHEIF SOURCE" },
      { href: "https://github.com/strukturag/libde265", label: "LIBDE265 SOURCE" },
      { href: licenseText("lgpl-3.0.txt"), label: "LGPL-3.0 TEXT" },
      { href: licenseText("gpl-3.0.txt"), label: "GPL-3.0 TEXT" },
      { href: licenseText("third-party-notices.txt"), label: "WRAPPER MIT NOTICE" },
    ],
  },
  {
    id: "exifreader",
    name: "ExifReader",
    spdx: "MPL-2.0",
    ships: "exifreader 4.37.0 — bundled, unmodified, into the client chunk for the EXIF data viewer.",
    paras: [
      "The Mozilla Public License is file-level copyleft: a larger work may keep its own terms, but the covered files stay under the MPL and their source has to remain available. Nothing here modifies them, so the upstream repository below is that source.",
    ],
    refs: [
      { href: "https://github.com/mattiasw/ExifReader", label: "SOURCE" },
      { href: licenseText("mpl-2.0.txt"), label: "MPL-2.0 TEXT" },
    ],
  },
];

/**
 * Permissive dependencies that are worth naming individually — either because
 * they do visible work, or because a choice had to be made about them. The
 * `note` field is where that choice is recorded; the generated notices file
 * linked at the foot of the page is the exhaustive list.
 */
const PERMISSIVE: readonly {
  readonly name: string;
  readonly license: string;
  readonly note: string;
  readonly text?: string;
}[] = [
  {
    name: "pdf.js (pdfjs-dist 5.6.205)",
    license: "Apache-2.0",
    note: "Renders PDF pages to canvas.",
    text: "apache-2.0.txt",
  },
  {
    name: "pdf-lib 1.17.1",
    license: "MIT",
    note: "Reads and writes PDF structure — the merge, split, rotate, reorder, page-number and compress tools all run on it.",
    text: "third-party-notices.txt",
  },
  {
    name: "pako 1.0.11",
    license: "MIT AND Zlib",
    note: "Deflate, reaching the browser as a dependency of pdf-lib.",
  },
  {
    name: "jszip 3.10.1",
    license: "MIT OR GPL-3.0-or-later",
    note: "Dual-licensed by its author; this site elects MIT.",
    text: "third-party-notices.txt",
  },
  {
    name: "dompurify 3.4.2",
    license: "MPL-2.0 OR Apache-2.0",
    note: "Dual-licensed; this site elects Apache-2.0.",
    text: "apache-2.0.txt",
  },
  {
    name: "diff 8.0.4",
    license: "BSD-3-Clause",
    note: "The text-diff engine.",
    text: "bsd-3-clause.txt",
  },
  {
    name: "mp4-muxer 5.2.2",
    license: "MIT",
    note: "Muxes the frames WebCodecs encodes.",
    text: "third-party-notices.txt",
  },
  {
    name: "@ffmpeg/ffmpeg 0.12.15",
    license: "MIT",
    note: "The wrapper described above. Named here by hand because it ships no license file of its own — there is no notice of its to reproduce, and quoting another project's MIT text in its place would misattribute it. The terms are MIT, as declared in its package manifest and in the ffmpeg.wasm repository linked above.",
  },
  {
    name: "@ffmpeg/util 0.12.2",
    license: "MIT",
    note: "Its helper package, and the second of the two that ships no license file. MIT on the same terms, from the same repository.",
  },
];

/**
 * Typefaces are shipped bytes like any other dependency. Split into the two
 * routes they take to the browser, because the answer to "where did this font
 * come from" differs and the OFL asks for the reserved names to be honoured.
 */
const FONTS: readonly { readonly name: string; readonly note: string }[] = [
  {
    name: "Newsreader, Outfit, Syne, JetBrains Mono",
    note: "Self-hosted under /fonts/print and embedded by the Markdown to PDF tool.",
  },
  {
    name: "Inter, IBM Plex Mono",
    note: "The interface typefaces, downloaded and self-hosted at build time by next/font.",
  },
];

/*
  Every OFL-1.1 file is the same licence text behind a DIFFERENT copyright line,
  and that line is the part the licence requires be carried. Linking one face's
  file as "the OFL text" for all six would misattribute five of them, so the
  generated font-notices.txt carries each face's own copyright and the shared
  licence text is linked once, as what it is.
*/

const H2 = "m-0 font-display text-[17px] leading-[1.25] font-medium text-text-primary";
const BODY = "m-0 font-body text-[12.5px] leading-[1.65] text-neutral-400";
const RULE =
  "h-px bg-[linear-gradient(to_right,transparent,var(--color-border)_32px,var(--color-border)_calc(100%-32px),transparent)]";
const EYEBROW =
  "font-mono text-[9.5px] leading-none font-medium tracking-[0.1em] text-accent-300";
const REF =
  "rounded-sm font-mono text-[10px] leading-[1.6] tracking-[0.04em] text-accent-300 underline underline-offset-[3px] transition-colors duration-200 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const INLINE_LINK =
  "rounded-sm text-accent underline underline-offset-[3px] transition-colors duration-200 hover:text-accent-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export default function LicensesPage() {
  return (
    <main className="mx-auto w-full max-w-[700px] flex-1 px-4 pt-11 pb-10 md:px-8">
      <div className="flex flex-col gap-6.5">
        <div className="flex flex-wrap items-baseline justify-between gap-5">
          <h1 className="m-0 font-display text-[clamp(28px,5vw,36px)] leading-[1.14] font-medium tracking-[-0.028em] text-text-primary">
            Licenses and notices
          </h1>
          <span className="font-mono text-[10.5px] leading-none whitespace-nowrap text-text-muted">
            UPDATED {LAST_UPDATED}
          </span>
        </div>

        <p className="m-0 font-body text-[15px] leading-[1.75] text-neutral-300">
          Everything here runs in your browser — but the engines doing the running are
          other people’s work, and they came with terms. Some ask for a credit line, some
          for a notice, one for an offer of its source code. This page is where those are
          honoured: what this site ships to your tab, under which license, and how each
          piece gets there.
        </p>

        <div className={RULE} />

        <div className="flex flex-col gap-9">
          {ENGINES.map((e) => (
            <section key={e.id} className="flex flex-col gap-3.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
                <h2 className={H2}>{e.name}</h2>
                <span className={EYEBROW}>{e.spdx}</span>
              </div>

              <p className="m-0 font-mono text-[11px] leading-[1.6] break-words text-text-muted">
                {e.ships}
              </p>

              {e.credit && (
                <div className="flex flex-col gap-[5px] rounded-[11px] border border-border bg-bg-secondary p-[18px]">
                  <span className="font-mono text-[9.5px] leading-none font-medium tracking-[0.1em] text-text-muted">
                    REQUIRED CREDIT
                  </span>
                  <span className="font-display text-[13.5px] leading-[1.4] font-medium text-text-primary">
                    {e.credit}
                  </span>
                </div>
              )}

              {e.paras.map((p) => (
                <p key={p.slice(0, 40)} className={BODY}>
                  {p}
                </p>
              ))}

              {e.pre && (
                <div className="flex flex-col gap-2">
                  {e.preCaption && <p className={BODY}>{e.preCaption}</p>}
                  {/* Long unbroken build command: it scrolls inside its own box
                      rather than pushing the page sideways at 375px. */}
                  <pre className="m-0 overflow-x-auto rounded-[9px] border border-border bg-bg-secondary p-3.5 font-mono text-[11px] leading-[1.65] text-neutral-300">
                    {e.pre}
                  </pre>
                </div>
              )}

              {e.libs && (
                <div className="flex flex-col gap-2.5">
                  {e.libsCaption && <p className={BODY}>{e.libsCaption}</p>}
                  <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[9px] border border-border bg-border sm:grid-cols-2">
                    {e.libs.map((l) => (
                      <div
                        key={l.name}
                        className="flex items-baseline justify-between gap-3 bg-bg-primary px-3.5 py-2.5"
                      >
                        <span className="min-w-0 font-body text-[12px] leading-[1.4] break-words text-neutral-300">
                          {l.name}
                        </span>
                        <span className="flex-none font-mono text-[9.5px] leading-none text-text-muted">
                          {l.license}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {e.refs.map((r) => (
                  <a
                    key={r.href + r.label}
                    href={r.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={REF}
                  >
                    {r.label}
                  </a>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className={RULE} />

        <section className="flex flex-col gap-3.5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
            <h2 className={H2}>Permissive libraries</h2>
            <span className={EYEBROW}>ATTRIBUTION ONLY</span>
          </div>
          <p className={BODY}>
            These ask for nothing but credit and their license text. Two of them are
            dual-licensed, which means a choice had to be made rather than inherited —
            both choices are recorded below so they are not something you have to guess
            at.
          </p>
          <div className="flex flex-col">
            {PERMISSIVE.map((p) => (
              <div
                key={p.name}
                className="flex flex-col gap-1 border-b border-border py-3.5"
              >
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <span className="font-body text-[13px] leading-[1.3] font-medium break-words text-neutral-200">
                    {p.name}
                  </span>
                  <span className="font-mono text-[9.5px] leading-none text-text-muted">
                    {p.license}
                  </span>
                  {p.text && (
                    <a
                      href={licenseText(p.text)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${REF} ml-auto`}
                    >
                      TEXT →
                    </a>
                  )}
                </div>
                <p className="m-0 font-body text-[11.5px] leading-[1.55] text-text-muted">
                  {p.note}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3.5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
            <h2 className={H2}>Fonts</h2>
            <span className={EYEBROW}>SIL OFL 1.1</span>
          </div>
          <p className={BODY}>
            Every typeface this site serves is under the SIL Open Font License 1.1, and
            every one of them is self-hosted — no font is fetched from a third party at
            any point.
          </p>
          <div className="flex flex-col">
            {FONTS.map((f) => (
              <div
                key={f.name}
                className="flex flex-col gap-1 border-b border-border py-3.5"
              >
                <span className="font-body text-[13px] leading-[1.3] font-medium break-words text-neutral-200">
                  {f.name}
                </span>
                <p className="m-0 font-body text-[11.5px] leading-[1.55] text-text-muted">
                  {f.note}
                </p>
              </div>
            ))}
          </div>
          <p className={BODY}>
            The Open Font License asks that each face carry its own copyright line, and
            every OFL file is that line followed by the same shared text — so the per-face
            notices are listed separately rather than pointing all six at one font&rsquo;s
            copy.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <a
              href={licenseText("font-notices.txt")}
              target="_blank"
              rel="noopener noreferrer"
              className={REF}
            >
              TYPEFACE NOTICES &rarr;
            </a>
            <a
              href={licenseText("ofl-1.1.txt")}
              target="_blank"
              rel="noopener noreferrer"
              className={REF}
            >
              OFL 1.1 TEXT
            </a>
          </div>
        </section>

        <section className="flex flex-col gap-3.5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
            <h2 className={H2}>Full dependency notices</h2>
            <span className={EYEBROW}>GENERATED</span>
          </div>
          <p className={BODY}>
            One file reproduces, verbatim, the license text of every package in the
            runtime dependency tree, followed transitively — so a library that reaches
            your browser only because something else depends on it, like pako inside
            pdf-lib, has its notice here too. It is generated from the installed tree
            rather than written by hand, and a test fails the build if the checked-in
            copy no longer matches what is installed, so it cannot quietly drift. A
            handful of packages publish no license file of their own for the generator
            to read — @ffmpeg/ffmpeg, @ffmpeg/util and @ffmpeg/types, @next/env and
            client-only (all MIT), and railroad-diagrams (CC0-1.0) — so they are named
            here instead, and nothing is left silently uncovered. Typefaces are listed
            separately, each with its own copyright line.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <a
              href={licenseText("third-party-notices.txt")}
              target="_blank"
              rel="noopener noreferrer"
              className={REF}
            >
              THIRD-PARTY NOTICES →
            </a>
          </div>
        </section>

        <p className={BODY}>
          Something on this page wrong, missing, or out of date — or you want the
          corresponding source for something served here? Reach the maintainer at{" "}
          <a
            href="https://ishank.dev"
            target="_blank"
            rel="noopener noreferrer"
            className={INLINE_LINK}
          >
            ishank.dev
          </a>
          .
        </p>
      </div>
    </main>
  );
}
