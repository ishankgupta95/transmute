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
    "Third-party licenses and notices for every engine transmute.tools ships — FFmpeg, qpdf, Tesseract, zxing-cpp, libarchive, oxipng, lamejs, libheif, ExifReader and the permissive libraries beside them.",
  alternates: { canonical: "/licenses" },
};

const LAST_UPDATED = "12 SEP 2026";

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
    ships: "libheif-js 1.23.2 — served unbundled at /vendor/libheif.js and /vendor/libheif.wasm, byte for byte as published, and loaded at runtime the first time you open a HEIC.",
    paras: [
      "libheif-js is an Emscripten build of libheif with libde265 for HEVC decoding, and both of those are LGPL. That makes the same replaceability condition apply to it as to lamejs, so it gets the same treatment: not bundled, served at its own stable URL, loaded by that URL at runtime. Replacing the HEIC decoder is replacing those two files — the loader reads the WebAssembly binary itself and hands it to the module, so a substituted binary at the same path is the one that runs.",
      "The build is decode-only, which is what keeps it LGPL rather than GPL. Verified against the shipped bytes on 2026-09-12: it registers exactly one decoder plugin, libde265 1.0.15, and its only encoder is libheif's own built-in mask format. x265, x264, aom, rav1e, SVT-AV1 and kvazaar appear nowhere in it, so no GPL encoder is conveyed.",
      "The package publishes the FSF's LGPL-3.0 boilerplate and no copyright line of its own, so the authors are named here rather than quoted from it: libheif and libde265 are copyright struktur AG and Dirk Farin; the npm distribution is maintained by Kiril Vatev.",
    ],
    refs: [
      { href: "https://github.com/catdad-experiments/libheif-js", label: "LIBHEIF-JS SOURCE" },
      { href: "https://github.com/strukturag/libheif", label: "LIBHEIF SOURCE" },
      { href: "https://github.com/strukturag/libde265", label: "LIBDE265 SOURCE" },
      { href: licenseText("lgpl-3.0.txt"), label: "LGPL-3.0 TEXT" },
      { href: licenseText("gpl-3.0.txt"), label: "GPL-3.0 TEXT" },
      { href: licenseText("third-party-notices.txt"), label: "FULL NOTICES" },
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
  {
    id: "qpdf",
    name: "qpdf",
    spdx: "APACHE-2.0",
    ships: "qpdf 12.4.1 — served from this origin as /qpdf.js and /qpdf.wasm (2,340,730 bytes of WebAssembly plus 63,089 bytes of loader), fetched the first time you use a PDF security tool.",
    paras: [
      "Compiled here rather than taken prebuilt. Every other engine on this page arrives as somebody else's published build. This one does not: it was compiled from the official qpdf 12.4.1 release tarball, on this machine, by a script checked into the repository at scripts/build-qpdf-wasm.sh. The reason is narrow. qpdf is the code that handles your password — it is the only thing here standing between a document and whoever should not be able to open it — and depending on a third-party binary would have meant taking someone's word for what is inside it. Building it means the static-link set is a decision that was made rather than one that was inherited, and it can be checked against the bytes actually served.",
      "What is linked in, and what cannot be. qpdf can be built against GnuTLS or OpenSSL for its encryption. This build is not: implicit crypto discovery is off and the native provider is required (-DUSE_IMPLICIT_CRYPTO=OFF -DREQUIRE_CRYPTO_NATIVE=ON), so no host library can be picked up during the build even if one is installed. zlib and libjpeg come from Emscripten's own ports rather than from the system. That is the intent; the artifact was then checked against it. In the .wasm this site serves there is not one occurrence of gnutls, openssl, libgcrypt or nettle, and the only crypto provider compiled in is qpdf's own. A unit test re-reads those bytes on every run and fails if that ever stops being true, so the claim cannot rot quietly.",
    ],
    preCaption:
      "Configured and linked exactly like this — the checked-in script is the authority, and this is what it runs. -fwasm-exceptions is not a tuning flag: qpdf reports every error condition by throwing, and Emscripten disables C++ exceptions by default, so without it a wrong password aborts the module with no message instead of saying the password was wrong.",
    pre: "PORT_FLAGS=\"-sUSE_ZLIB=1 -sUSE_LIBJPEG=1 -fwasm-exceptions\"\nSYSROOT=\"$(em-config CACHE)/sysroot\"\n\nemcmake cmake -S qpdf-12.4.1 -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DBUILD_STATIC_LIBS=ON -DUSE_IMPLICIT_CRYPTO=OFF -DREQUIRE_CRYPTO_NATIVE=ON -DBUILD_DOC=OFF -DBUILD_DOC_PDF=OFF -DBUILD_DOC_HTML=OFF -DQTEST_SKIP_TESTS=ON -DCMAKE_C_FLAGS=\"$PORT_FLAGS\" -DCMAKE_CXX_FLAGS=\"$PORT_FLAGS\" -DCMAKE_EXE_LINKER_FLAGS=\"$PORT_FLAGS\" -DZLIB_LIBRARY=\"$SYSROOT/lib/wasm32-emscripten/libz.a\" -DZLIB_INCLUDE_DIR=\"$SYSROOT/include\"\n\nem++ -O3 build/qpdf/CMakeFiles/qpdf.dir/*.o build/libqpdf/libqpdf.a $PORT_FLAGS -o qpdf.js -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createQpdfModule -sENVIRONMENT=web,worker -sINVOKE_RUN=0 -sEXIT_RUNTIME=1 -sALLOW_MEMORY_GROWTH=1 -sFORCE_FILESYSTEM=1 -sEXPORTED_RUNTIME_METHODS=callMain,FS -sSTACK_SIZE=1048576",
    libsCaption:
      "Statically linked into that binary, and nothing else is. All three are permissive, and each carries its own terms:",
    libs: [
      { name: "qpdf native crypto provider", license: "Apache-2.0" },
      { name: "zlib (Emscripten port)", license: "Zlib" },
      { name: "libjpeg (Emscripten port)", license: "IJG" },
    ],
    refs: [
      { href: "https://github.com/qpdf/qpdf/tree/v12.4.1", label: "QPDF SOURCE (v12.4.1)" },
      { href: licenseText("apache-2.0.txt"), label: "APACHE-2.0 TEXT" },
      { href: licenseText("qpdf-notice.txt"), label: "QPDF NOTICE" },
    ],
  },
  {
    id: "tesseract",
    name: "Tesseract (tesseract.js 7.0.0, tesseract.js-core 7.0.0)",
    spdx: "APACHE-2.0",
    ships: "Served from this origin under /tesseract/ as five files totalling 5,088,998 bytes \u2014 tesseract.esm.min.js (63,220), worker.min.js (111,307), tesseract-core-simd-lstm.js (89,271), tesseract-core-simd-lstm.wasm (2,857,601) and eng.traineddata.gz (1,967,599) \u2014 fetched the first time you read text out of an image, and not before.",
    paras: [
      "Taken prebuilt, but not from where it wanted to come from. Unlike qpdf, this is upstream\u2019s own published build, copied out of the npm packages byte for byte. What is changed is where it loads from: tesseract.js ships pointing at public CDNs \u2014 one for its WebAssembly core, another for the language model \u2014 so every path it resolves is overridden here and pointed at this origin instead. Those addresses are never contacted and never even constructed. A test asserts that the shipped source names no CDN, and the end-to-end suite fails a run in which any request left this origin, and equally a run in which the engine was never fetched at all, because a guard that cannot tell those two apart proves nothing.",
      "One variant is served, not six. The core is published in six builds \u2014 SIMD, relaxed-SIMD and plain, each with and without the legacy engine \u2014 and the library picks one at runtime by feature detection unless it is told exactly which file to load. It is told: the fixed-SIMD, LSTM-only build. Fixed SIMD is the one instruction set available in every browser this site is tested against, and the LSTM-only build is 2.86 MB where the full one is 3.45 MB, with the difference being a legacy engine the language model here cannot drive anyway.",
      "The language model is a separate work under the same licence. eng.traineddata comes from the tesseract-ocr/tessdata_fast repository, which publishes the LSTM \u201cfast\u201d English model under Apache-2.0. It is checked into this repository rather than fetched at build time \u2014 fetching it would mean trusting a third party at exactly the moment this site promises not to \u2014 and it is served gzipped. Its hash before and after decompression is pinned by a test, so a model swapped for a different line fails the build rather than shipping quietly.",
    ],
    libsCaption:
      "What is inside the WebAssembly core, checked against the bytes this site serves rather than against a package manifest:",
    libs: [
      { name: "Tesseract OCR", license: "Apache-2.0" },
      { name: "Leptonica (image processing)", license: "BSD-2-Clause" },
      { name: "eng.traineddata (tessdata_fast)", license: "Apache-2.0" },
    ],
    refs: [
      { href: "https://github.com/naptha/tesseract.js", label: "TESSERACT.JS SOURCE" },
      { href: "https://github.com/tesseract-ocr/tesseract", label: "TESSERACT SOURCE" },
      { href: "https://github.com/tesseract-ocr/tessdata_fast", label: "TESSDATA_FAST SOURCE" },
      { href: licenseText("apache-2.0.txt"), label: "APACHE-2.0 TEXT" },
    ],
  },
  {
    id: "zxing-cpp",
    name: "zxing-cpp",
    spdx: "APACHE-2.0",
    ships: "zxing-wasm 3.1.3, reader build — served from this origin as /zxing_reader.wasm (1,093,289 bytes), fetched the first time you scan a code.",
    paras: [
      "What is actually inside it. zxing-wasm is an MIT wrapper; the decoding is zxing-cpp, which is Apache-2.0, pinned by the wrapper as a submodule at commit a17fd9dc65d6aa0dd2f660fdfca7a6a6613d938f. That is not taken on trust — the package exports the hash as ZXING_CPP_COMMIT, and it is the same hash quoted here. Only the reader half reaches you. The package publishes a writer build as well, which links zint; this site does not serve it, and the file it does serve contains no zint symbols at all. The barcode generator draws its own symbols in JavaScript through bwip-js, so no WebAssembly reaches that page at all. That is a claim about WebAssembly and not about cost: the BWIPP encoder set is bundled into the barcode tool’s own code-split chunk rather than served as a file of its own, and in the build this site ships that chunk is 947,409 bytes — about 925 KB — fetched from this origin the first time you generate a symbol. It is the largest bundled download on the site, and the homepage names it under the engine table for that reason.",
      "Why it is served from here rather than from a CDN. The published loader resolves its WebAssembly to a jsDelivr URL unless it is told not to. Left alone, that would have sent every visitor's IP address to a third party on the one page whose whole premise is that the image never leaves the tab. So the .wasm is copied into this origin at build time and the loader is pointed at that local path; the CDN address is never contacted and never even constructed.",
      "On the NOTICE clause. Apache-2.0 asks that a NOTICE file be reproduced wherever the licensed work provides one — the reason qpdf's own notice is carried above. The zxing-wasm distribution this build consumes ships no NOTICE: its published package contains a single MIT LICENSE covering the wrapper, and that text is reproduced verbatim in the generated notices linked at the foot of this page. There is therefore no notice of zxing-cpp's to reproduce here, and the licence itself is linked below.",
    ],
    refs: [
      {
        href: "https://github.com/zxing-cpp/zxing-cpp/tree/a17fd9dc65d6aa0dd2f660fdfca7a6a6613d938f",
        label: "ZXING-CPP SOURCE (PINNED COMMIT)",
      },
      { href: "https://github.com/Sec-ant/zxing-wasm", label: "WRAPPER SOURCE" },
      { href: licenseText("apache-2.0.txt"), label: "APACHE-2.0 TEXT" },
      { href: licenseText("third-party-notices.txt"), label: "FULL NOTICES" },
    ],
  },
  {
    id: "libarchive",
    name: "libarchive 3.7.7",
    spdx: "BSD-2-CLAUSE",
    ships: "libarchive-wasm 1.2.0 — served from this origin as /libarchive.wasm (613,235 bytes), fetched the first time you open an archive.",
    paras: [
      "Read-only because the binary is, not because a policy says so. The archive extractor never offers to create an archive, and the reason is structural: this build exports sixteen archive_read_support_format_* entry points — 7zip, ar, cab, cpio, empty, iso9660, lha, mtree, rar, rar5, tar, warc, xar, zip, the seekable zip reader, and the format_all dispatcher that tries them in turn — and not one archive_write_set_format_* entry point. There is no code in the file that could write a container. That is checkable in the bytes this site serves, which is a stronger guarantee than a promise on a page.",
      "The compression libraries linked alongside it are bzip2 1.0.8 and liblzma (the XZ decoder) 5.6.4, both of which stamp their versions into the binary, plus zlib for deflate. Zstandard and LZ4 are not linked: libarchive's fallback for those is to shell out to a zstd or lz4 executable, and there is no shell inside a WebAssembly module, so an archive using either is reported as unsupported rather than silently mishandled.",
      "About the wrapper and the notice. libarchive-wasm 1.2.0 declares MIT in its manifest and in its README, but it publishes no licence file, so — like the two @ffmpeg helper packages further down — there is no notice of its own to reproduce and it is named here by hand instead. libarchive itself is BSD-2-Clause, whose second clause asks that its copyright notice travel with a binary redistribution; the upstream COPYING at the exact version compiled in is linked below, and quoting some other project's BSD-2-Clause text in its place would misattribute the copyright line that clause exists to carry.",
    ],
    refs: [
      { href: "https://github.com/libarchive/libarchive/tree/v3.7.7", label: "LIBARCHIVE SOURCE (v3.7.7)" },
      {
        href: "https://github.com/libarchive/libarchive/blob/v3.7.7/COPYING",
        label: "LIBARCHIVE COPYING (v3.7.7)",
      },
      { href: "https://github.com/ofk/libarchive-wasm", label: "WRAPPER SOURCE" },
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
    name: "bwip-js 4.11.4",
    license: "MIT",
    note: "Draws every barcode symbology on the barcode generator, at about 925 KB fetched on the first symbol. It carries the BWIPP PostScript source inside it, which its author released under the same terms.",
    text: "third-party-notices.txt",
  },
  {
    name: "svgo 4.1.0",
    license: "MIT",
    note: "Optimises SVGs, at about 566 KB fetched on the first optimisation. It brings the only BlueOak-1.0.0 component on the site — sax 1.6.1, its XML parser — a permissive licence in the MIT family whose full text is reproduced with the others in the generated notices.",
    text: "third-party-notices.txt",
  },
  {
    name: "mammoth 1.12.2",
    license: "BSD-2-Clause",
    note: "Converts .docx to HTML for the Markdown converter, at about 478 KB — jszip and pako included — fetched on the first document. Nothing about a document leaves the tab; it is a parser, not a service.",
    text: "third-party-notices.txt",
  },
  {
    name: "@jsquash/oxipng 2.3.0",
    license: "Apache-2.0",
    note: "The wrapper the PNG compressor loads. Its WebAssembly is served from this origin as /squoosh_oxipng_bg.wasm — 164,172 bytes, fetched on the first PNG you compress — and its own notice is reproduced in the generated file below. The optimiser compiled inside that WebAssembly is a separate work under different terms; it is the entry immediately after this one.",
    text: "third-party-notices.txt",
  },
  {
    name: "oxipng 9.1.1",
    license: "MIT",
    note: "The optimiser itself, compiled into the WebAssembly above — the version is read out of the binary rather than taken from a changelog. It is named here by hand for a reason worth stating, because it is not the reason the packages below are: this one does publish its notice, and the generator cannot see it. That script reads each package's root directory, and this notice sits one level down beside the codec, so it would have gone unshipped while every other check on this page stayed green.",
  },
  {
    name: "boolbase 1.0.0",
    license: "ISC",
    note: "A two-function helper reaching the browser under svgo, through css-select and nth-check. Named here by hand because it ships no license file — its terms are ISC, as declared in its package manifest and its repository, and quoting another project's ISC text in its place would misattribute it.",
  },
  {
    name: "dingbat-to-unicode 1.0.1",
    license: "BSD-2-Clause",
    note: "Maps Wingdings and Symbol characters to real Unicode when mammoth reads a .docx. The second package here that publishes no license file; BSD-2-Clause on the terms its manifest and repository declare.",
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
  {
    name: "omggif 1.0.10",
    license: "MIT",
    note: "A pure-JavaScript GIF reader, used to pull the frames out of an animation in browsers whose own ImageDecoder cannot — which today means Safari. It is bundled rather than served, so it adds no file to this origin. Named here by hand because it publishes no license file; MIT on the terms its manifest and repository declare.",
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
            to read — @ffmpeg/ffmpeg, @ffmpeg/util and @ffmpeg/types, @next/env,
            client-only and omggif (all MIT), and railroad-diagrams (CC0-1.0) — so they are named
            here instead, and nothing is left silently uncovered. One package fails the
            generator in the other direction and is worth naming for it: @jsquash/oxipng
            ships two notices, Apache-2.0 for the wrapper in its root and MIT for the
            oxipng codec a directory below, and the script reads only the root — so the
            file above carries the first and the second is credited by hand under
            permissive libraries. Typefaces are listed separately, each with its own
            copyright line.
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
