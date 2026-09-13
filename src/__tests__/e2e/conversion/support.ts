import { expect, type Page, type Locator } from "@playwright/test";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FixtureFile } from "../helpers";

/**
 * Shared plumbing for the real-conversion suite.
 *
 * Unlike the rest of the E2E specs, these tests feed tools genuinely-encoded
 * media (see `scripts/generate-test-fixtures.mjs`) and assert the *bytes that
 * come back* are a valid file of the expected type — parsing containers, and
 * where it matters decoding the output in the browser. A tool that renders a
 * Download button over a 0-byte or malformed blob fails here.
 */

const SAMPLES_DIR = path.resolve(process.cwd(), "src/__tests__/fixtures/samples");

/** Load a checked-in real-media fixture. */
export async function sample(name: string, mimeType: string): Promise<FixtureFile> {
  return { name, mimeType, buffer: await readFile(path.join(SAMPLES_DIR, name)) };
}

export const SAMPLES = {
  mp4: () => sample("sample-video.mp4", "video/mp4"),
  webm: () => sample("sample-video.webm", "video/webm"),
  /*
    Container siblings of `sample-video.mp4`, carrying the identical H.264 and
    AAC elementary streams — `scripts/generate-test-fixtures.mjs --containers`
    stream-copies them out of it. That shared provenance is the point: a tool
    that rewraps any of these back into MPEG-4 must reproduce the MP4's own
    `avcC` and `stsz` table exactly (see `expectVideoStreamCopied` below).
  */
  mov: () => sample("sample-video.mov", "video/quicktime"),
  mkv: () => sample("sample-video.mkv", "video/x-matroska"),
  avi: () => sample("sample-video.avi", "video/x-msvideo"),
  /*
    The same clip re-encoded to H.265 by macOS VideoToolbox — an iPhone-shaped
    recording. Its video track is `hvc1`, so a plain stream copy into MPEG-4
    produces a file that is structurally valid and still will not play where the
    user needs it. That is the silent failure the container tools must refuse.
  */
  hevcMov: () => sample("sample-video-hevc.mov", "video/quicktime"),
  mp3: () => sample("sample-audio.mp3", "audio/mpeg"),
  m4a: () => sample("sample-audio.m4a", "audio/mp4"),
  wav: () => sample("sample-audio.wav", "audio/wav"),
  wav96kMono: () => sample("sample-audio-96k-mono.wav", "audio/wav"),
  wav6ch: () => sample("sample-audio-6ch.wav", "audio/wav"),
  vbrMp3: () => sample("sample-audio-vbr.mp3", "audio/mpeg"),
  jpgPortrait: () => sample("sample-photo-portrait.jpg", "image/jpeg"),
  jpg: () => sample("sample-photo.jpg", "image/jpeg"),
  pdf: () => sample("sample-doc.pdf", "application/pdf"),
  pdf60: () => sample("sample-doc-60p.pdf", "application/pdf"),
  svg: () => sample("sample-vector.svg", "image/svg+xml"),
  /*
    Inputs for the two WebAssembly engines that are neither FFmpeg nor qpdf.
    `scripts/generate-test-fixtures.mjs --engine-inputs` writes all three, and
    the ZIP and the TAR carry the identical three members on purpose — see
    `ARCHIVE_FIXTURE_MEMBERS` there.
  */
  qrPng: () => sample("sample-qr.png", "image/png"),
  zip: () => sample("sample-archive.zip", "application/zip"),
  tar: () => sample("sample-archive.tar", "application/x-tar"),
};

/** The exact string encoded into `sample-qr.png`. */
export const QR_FIXTURE_PAYLOAD = "TRANSMUTE-QR-FIXTURE-8F2C1D";

/** What both archive fixtures hold, in the order the archives store them. */
export const ARCHIVE_FIXTURE_MEMBERS = [
  { path: "readme.txt", size: 27, body: "Transmute archive fixture.\n" },
  { path: "notes.md", size: 51, body: "# notes\n\nThe second member of the fixture archive.\n" },
  { path: "values.csv", size: 18, body: "a,b,c\n1,2,3\n4,5,6\n" },
] as const;

/** Deliberately undecodable bytes wearing a given filename. */
export function corruptFixture(name: string, mimeType: string): FixtureFile {
  const buffer = Buffer.alloc(4096);
  for (let i = 0; i < buffer.length; i++) buffer[i] = (i * 197 + 13) & 0xff;
  return { name, mimeType, buffer };
}

// ────────────────────────────────────────────────────────────────────────────
// Driving a tool
// ────────────────────────────────────────────────────────────────────────────

/**
 * Assert the FFmpeg core was served from our own origin, not a CDN.
 *
 * This used to be a route-intercepting cache, because the loader pulled ~31 MB
 * from unpkg and Playwright gives every test a cold HTTP cache. The core is now
 * self-hosted out of `public/`, so the tests exercise the real production load
 * path — and this guard fails if anyone points it back at a CDN.
 *
 * ⚠ It used to test the HOST against `/unpkg\.com|cdn\.jsdelivr\.net/`, which
 * is a guard that rots the moment a dependency picks a different CDN. It did:
 * `zxing-wasm` (Wave 4) defaults to **fastly**.jsdelivr.net, which that pattern
 * misses entirely — so a two-host allowlist was quietly not covering the very
 * hazard it was named for. The question is not "is this one of the CDNs we
 * happened to think of", it is "did this come from anywhere other than us", so
 * the test is now the ORIGIN and there is no list left to fall out of date.
 *
 * Its other two weaknesses stand, and are why `watchEngineRequests` below
 * exists rather than this being extended to the newer engines: it throws from
 * inside a listener (so a violation is an unhandled rejection, not a failed
 * assertion at a line of a test), and it passes just as happily when the core
 * was never fetched at all. Prefer `watchEngineRequests` for anything new.
 */
export function forbidCdnCore(page: Page): void {
  page.on("request", (request) => {
    const url = request.url();
    if (!/ffmpeg-core/.test(url)) return;
    // `page.url()` is `about:blank` until the spec navigates; a request for the
    // core cannot happen before then, but read defensively rather than throwing
    // a URL parse error out of a listener.
    const here = page.url();
    const sameOrigin =
      /^https?:/.test(here) && new URL(url).origin === new URL(here).origin;
    if (!sameOrigin) {
      throw new Error(`FFmpeg core must be self-hosted, but was fetched from ${url}`);
    }
  });
}

/** What an engine watcher hands back to the test that installed it. */
export interface EngineWatch {
  /** Every engine URL the browser asked for, deduped, in first-seen order. */
  readonly urls: string[];
  /**
   * Fail unless the engine was fetched AND every fetch of it came from the
   * page's own origin. Call this from the test body, after the tool has run.
   */
  assertSelfHostedAndUsed(): void;
  /**
   * The opposite guard: fail if the engine was fetched AT ALL.
   *
   * `assertSelfHostedAndUsed` cannot express this — it fails when `urls` is
   * empty, on purpose, because "the engine never loaded" is how a broken
   * self-hosting guard usually looks. But some paths promise the engine is
   * never needed, and that promise is worth a test of its own: `/extract-archive`
   * lists a bare `.gz` without libarchive, and both the page and the tool's
   * docs say so. Without this, the only way to express "no engine here" is to
   * write no test, which is what the comment on `watchLibarchiveRequests`
   * below used to recommend.
   *
   * `because` is the promise being kept, and it is printed on failure, so
   * write it as a claim: "a bare .gz is read by DecompressionStream".
   */
  assertNeverFetched(because: string): void;
}

/**
 * Record fetches of one self-hosted WebAssembly engine, so a spec can assert
 * it came from this origin — and that it came at all.
 *
 * This is the shape `watchQpdfRequests` below was written in, generalised so
 * the engines added since get the same guard rather than a weaker one. Two
 * properties are the whole point of it, and both are reactions to
 * `forbidCdnCore` above:
 *
 *   1. It only RECORDS. `forbidCdnCore` throws from inside a
 *      `page.on("request")` listener, so a violation surfaces as an unhandled
 *      rejection rather than as a failed assertion pointing at a line of a
 *      test. Here the caller asserts, synchronously, in the test body.
 *   2. The assertion is TWO-SIDED. A foreign origin fails, and so does "the
 *      engine was never fetched, so this test proved nothing about it" —
 *      which is the state a quietly-broken spec is usually in, and the state
 *      `forbidCdnCore` is perfectly happy with.
 *
 * Both `page` and its context are listened to. Some engines are fetched from
 * inside a worker rather than from the document (qpdf is), and a worker
 * created from a same-origin script URL reports its subresources to both
 * listeners — measured in Chromium and WebKit. A worker created from a
 * `blob:` URL reports them to NEITHER, so if one of these ever stops
 * recording anything, look first at how the worker was constructed. Listening
 * twice for a main-thread engine is harmless: the dedupe below absorbs it.
 *
 * `label` names the engine in both failure messages, so keep it a bare engine
 * name — "qpdf", "zxing", "libarchive" — and not a noun phrase.
 */
export function watchEngineRequests(
  page: Page,
  opts: { label: string; isEngine: (url: string) => boolean },
): EngineWatch {
  const { label, isEngine } = opts;
  const urls: string[] = [];
  const record = (url: string) => {
    if (isEngine(url) && !urls.includes(url)) urls.push(url);
  };
  page.on("request", (request) => record(request.url()));
  page.context().on("request", (request) => record(request.url()));

  return {
    urls,
    assertSelfHostedAndUsed() {
      const here = page.url();
      expect(here, "the page must have navigated before the guard can know its origin")
        .toMatch(/^https?:/);
      expect(
        urls.length,
        `the ${label} engine was never fetched — this test proved nothing about where it came from`,
      ).toBeGreaterThan(0);
      const origin = new URL(here).origin;
      const foreign = urls.filter((url) => new URL(url).origin !== origin);
      expect(
        foreign,
        `${label} must be self-hosted out of public/, but was fetched from ${foreign.join(", ")}`,
      ).toEqual([]);
    },
    assertNeverFetched(because: string) {
      expect(
        urls,
        `${because}, so the ${label} engine should never have been fetched — it was, from ${urls.join(", ")}`,
      ).toEqual([]);
    },
  };
}

/**
 * The barcode engine behind `/qr-code-reader`.
 *
 * This one has a live CDN default sitting in the shipped bundle, which is why
 * it is guarded rather than trusted: `zxing-wasm@3.1.3`'s own `locateFile`
 * resolves to `https://fastly.jsdelivr.net/npm/zxing-wasm@3.1.3/dist/reader/
 * zxing_reader.wasm`, and that literal string is present in the built chunks
 * today (`grep -rl jsdelivr out/_next`). `qr-decode.ts` overrides it twice
 * over — `wasmBinary` AND `locateFile` — so nothing is fetched from jsDelivr
 * at runtime. If a refactor drops either override, the page whose entire claim
 * is that the image never leaves the tab would start handing a third party the
 * reader's IP and referrer, silently. This is what notices.
 *
 * The fetch is the loader's own `fetch(ZXING_WASM_URL)` on the main thread, so
 * `page.on("request")` is the listener that fires; the context listener is
 * belt-and-braces against the loader moving into a worker later.
 */
export function watchZxingRequests(page: Page): EngineWatch {
  return watchEngineRequests(page, {
    label: "zxing",
    // Matches ours (`/zxing_reader.wasm`) and jsDelivr's (`…/dist/reader/
    // zxing_reader.wasm`) alike — the origin is what the assertion judges, so
    // the matcher must not be written in a way that only recognises ours.
    isEngine: (url) => /\/zxing_reader\.wasm(\?|#|$)/.test(url),
  });
}

/**
 * The OCR engine behind `/image-to-text`.
 *
 * The engine with the WORST default on the site, and therefore the one most
 * worth guarding. tesseract.js resolves FOUR paths, and left alone two of them
 * go to public CDNs — jsDelivr for the WebAssembly core, tessdata.projectnaptha
 * .com for the language model. Dropping any override does not break the tool:
 * it keeps working and quietly hands a third party the visitor's IP and the
 * fact that they opened the OCR page, on a page whose entire claim is that the
 * picture never leaves the tab. Nothing would surface that but this.
 *
 * The matcher deliberately recognises the FILENAMES rather than our directory,
 * because the origin is what the assertion judges: a matcher written as
 * `/^\/tesseract\//` would see none of jsDelivr's URLs and would therefore
 * report a clean run precisely when the engine had gone to a CDN.
 *
 * `worker.min.js` is excluded from the pattern by requiring the tesseract
 * prefix on it — several unrelated worker bundles in this app end in
 * `.worker.js`, and a matcher loose enough to catch those would make the
 * "was it fetched" arm pass on the wrong file.
 *
 * Both listeners matter and neither is redundant: the library and its worker
 * script are fetched by the PAGE, while the core, its binary and the model are
 * fetched from INSIDE the worker. A blob: worker would report to neither,
 * which is one of the reasons `ocr.ts` sets `workerBlobURL: false`.
 */
export function watchTesseractRequests(page: Page): EngineWatch {
  return watchEngineRequests(page, {
    label: "tesseract",
    isEngine: (url) =>
      /\/(tesseract\.esm\.min\.js|tesseract-core[\w-]*\.(js|wasm)|worker\.min\.js)(\?|#|$)/.test(
        url,
      ) || /\.traineddata(\.gz)?(\?|#|$)/.test(url),
  });
}

/**
 * The archive engine behind `/extract-archive`.
 *
 * `libarchive-wasm`'s glue locates `libarchive.wasm` relative to the script
 * that loaded it, which under a bundler is wherever the chunk landed;
 * `archive-extract.ts` fetches the binary from this origin itself and hands it
 * over as `wasmBinary`, with `locateFile` overridden as well.
 *
 * This only fires for containers libarchive actually reads. A bare `.gz` is
 * decompressed by the browser's own `DecompressionStream` (`listing.
 * viaGzipStream`) and the engine is never fetched — but read the next
 * paragraph before concluding that makes a `.gz` spec pointless, because that
 * is what this comment used to say and it had the inference backwards.
 *
 * "No engine for a bare `.gz`" is not a property of gzip; it is a property of
 * ONE ORDERING inside `readArchive`, and it did not hold until recently. The
 * function used to `await newEngine()` first and discover the gzip from the
 * `ArchiveReader` constructor's failure, so `access.log.gz` paid for 613 KB of
 * WebAssembly it then threw away, and failed outright whenever
 * `/libarchive.wasm` was unreachable. It now sniffs the container, peeks at the
 * decompressed prefix (`payloadLooksLikeArchive`) and returns before any engine
 * work. Move those few lines back below `newEngine()` and everything stays
 * green: the page still lists the file, the unit suite still passes, and the
 * only visible difference is the download.
 *
 * So a `.gz` case is worth writing — as the NEGATIVE guard, `watch
 * .assertNeverFetched(...)` rather than `assertSelfHostedAndUsed()`. Two
 * caveats for whoever writes it: a `.tar.gz` DOES load the engine (the prefix
 * peek recognises the tar and hands it over), and so does a `.gz` whose payload
 * cannot be decompressed at all, which falls through to the engine on purpose.
 * Use a gzipped log or CSV. `src/__tests__/unit/lib/archive-engine-load.test.ts`
 * guards the same promise at unit level today, by counting `fetch` calls; this
 * would be the browser half of it.
 */
export function watchLibarchiveRequests(page: Page): EngineWatch {
  return watchEngineRequests(page, {
    label: "libarchive",
    isEngine: (url) => /\/libarchive\.wasm(\?|#|$)/.test(url),
  });
}

/** What a `watchQpdfRequests` watcher hands back to the test that installed it. */
export interface QpdfEngineWatch {
  /** Every qpdf engine URL the browser asked for, deduped, in first-seen order. */
  readonly urls: string[];
  /**
   * Fail unless the qpdf engine was fetched AND every fetch of it came from the
   * page's own origin. Call this from the test body, after the tool has run.
   */
  assertSelfHostedAndUsed(): void;
}

/**
 * Record fetches of the qpdf engine so a spec can assert it was self-hosted.
 *
 * This is the qpdf counterpart of `forbidCdnCore` above, written to avoid that
 * guard's two weaknesses rather than to copy them. `forbidCdnCore` throws from
 * inside a `page.on("request")` listener, so a violation surfaces as an
 * unhandled rejection instead of a failed assertion; and it is equally happy
 * when the core was never fetched at all, which is the state a broken test is
 * usually in. This one only RECORDS. The caller asserts, synchronously, in the
 * test body — and the assertion is two-sided: a foreign origin fails, and so
 * does "the engine never loaded, so this test proved nothing about it".
 *
 * `qpdf.js` / `qpdf.wasm` are fetched from inside the worker rather than the
 * document, so both the page and its context are listened to and the dedupe
 * below makes hearing the same request twice harmless. Measured against the
 * shipped `/workers/qpdf.worker.js` in Chromium AND WebKit: a worker created
 * from a same-origin script URL reports its subresources to both listeners. A
 * worker created from a `blob:` URL reports them to NEITHER — so if this ever
 * stops recording anything, look first at how the worker was constructed.
 */
export function watchQpdfRequests(page: Page): QpdfEngineWatch {
  // Delegated to `watchEngineRequests` above, which is this function
  // generalised. A no-op refactor, deliberately: same listeners, same dedupe,
  // same two-sided assertion, and `label: "qpdf"` reproduces both failure
  // messages this used to build verbatim.
  return watchEngineRequests(page, {
    label: "qpdf",
    // `qpdf.` must be followed by the extension itself: our own worker bundle is
    // `qpdf.worker.js`, and it is not the engine.
    isEngine: (url) => /\/qpdf\.(js|wasm)(\?|#|$)/.test(url),
  });
}

export async function uploadFixture(
  page: Page,
  fixtures: FixtureFile | FixtureFile[],
): Promise<void> {
  const input = page.locator('input[type="file"]').first();
  await input.waitFor({ state: "attached" });
  await input.setInputFiles(Array.isArray(fixtures) ? fixtures : [fixtures]);
}

/** The tool's primary action in the controls rail (`ToolActions`). */
export function primaryAction(page: Page, label: RegExp): Locator {
  return page.getByRole("button", { name: label }).first();
}

/** Every tool's download affordance is labelled `Download <filename>`. */
export function downloadAffordance(page: Page): Locator {
  return page.getByRole("button", { name: /^Download / }).first();
}

/**
 * Click something that triggers `triggerDownload` and return the bytes.
 * `triggerDownload` defers its `revokeObjectURL` by 1s, so the blob is still
 * live when Playwright reads it.
 */
export async function captureDownload(
  page: Page,
  trigger: Locator,
  timeout = 120_000,
): Promise<{ name: string; bytes: Buffer }> {
  const waiter = page.waitForEvent("download", { timeout });
  await trigger.click();
  const download = await waiter;
  const file = await download.path();
  if (!file) throw new Error("download produced no file");
  return { name: download.suggestedFilename(), bytes: await readFile(file) };
}

/**
 * Full happy path: upload, run the primary action, wait for the result, and
 * capture the downloaded bytes.
 */
export async function convert(
  page: Page,
  opts: {
    slug: string;
    input: FixtureFile | FixtureFile[];
    action?: RegExp;
    /** Tweak controls after upload, before the primary action fires. */
    setup?: (page: Page) => Promise<void>;
    timeout?: number;
  },
): Promise<{ name: string; bytes: Buffer }> {
  const { slug, input, action, setup, timeout = 150_000 } = opts;
  forbidCdnCore(page);
  await page.goto(`/${slug}`);
  await uploadFixture(page, input);
  if (setup) await setup(page);
  if (action) {
    const button = primaryAction(page, action);
    await expect(button).toBeEnabled({ timeout: 30_000 });
    await button.click();
  }
  const dl = downloadAffordance(page);
  await expect(dl).toBeVisible({ timeout });
  return captureDownload(page, dl);
}

/** Surface the tool's inline error text, so failures report the real cause. */
export async function toolError(page: Page): Promise<string | null> {
  const alert = page.locator('[role="alert"]').filter({ hasText: /\S/ }).first();
  if (await alert.count() === 0) return null;
  return (await alert.textContent())?.trim() ?? null;
}

// ────────────────────────────────────────────────────────────────────────────
// In-browser decode probes — the strongest validity signal available
// ────────────────────────────────────────────────────────────────────────────

/**
 * Decode audio bytes with the browser's own decoder. If this resolves, the
 * output is genuinely playable audio rather than merely well-shaped bytes.
 */
export async function decodeAudioInPage(
  page: Page,
  bytes: Buffer,
): Promise<{ duration: number; channels: number; sampleRate: number; peak: number }> {
  return page.evaluate(async (b64: string) => {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const ac = new AudioContext();
    const decoded = await ac.decodeAudioData(buf.buffer);
    let peak = 0;
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const data = decoded.getChannelData(c);
      // Sparse scan: enough to distinguish signal from digital silence.
      for (let i = 0; i < data.length; i += 32) peak = Math.max(peak, Math.abs(data[i]));
    }
    const out = {
      duration: decoded.duration,
      channels: decoded.numberOfChannels,
      sampleRate: decoded.sampleRate,
      peak,
    };
    await ac.close();
    return out;
  }, bytes.toString("base64"));
}

/**
 * Load video bytes into a real `<video>` and read back what the demuxer found.
 * Proves the container is seekable and carries a decodable track.
 */
export async function probeVideoInPage(
  page: Page,
  bytes: Buffer,
  mime: string,
): Promise<{ duration: number; width: number; height: number }> {
  return page.evaluate(
    async ({ b64, type }: { b64: string; type: string }) => {
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([buf], { type }));
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("metadata timeout")), 20_000);
          video.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
          video.onerror = () => {
            clearTimeout(timer);
            reject(new Error(`video decode error: ${video.error?.message ?? "unknown"}`));
          };
          video.src = url;
        });
        return {
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
        };
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    { b64: bytes.toString("base64"), type: mime },
  );
}

/** Decode image bytes via `createImageBitmap` and return real dimensions. */
export async function probeImageInPage(
  page: Page,
  bytes: Buffer,
  mime: string,
): Promise<{ width: number; height: number }> {
  return page.evaluate(
    async ({ b64, type }: { b64: string; type: string }) => {
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const bitmap = await createImageBitmap(new Blob([buf], { type }));
      const out = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return out;
    },
    { b64: bytes.toString("base64"), type: mime },
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Byte-level container structure — what proves a remux was really a remux
// ────────────────────────────────────────────────────────────────────────────

/**
 * These live here rather than in `validators.ts` on purpose. `validators.ts`
 * answers "are these bytes a valid file of type X"; these answer "are these
 * bytes carrying the SAME elementary stream as those other bytes", which is a
 * comparison between two files rather than a verdict on one. The container
 * tools' entire claim ("nothing was re-encoded") is that comparison.
 *
 * Why the comparison has to go this deep, measured on the shipped FFmpeg core
 * against `sample-video.mp4`:
 *
 *   operation                     video avcC          stsz table         mdat
 *   ---------------------------   -----------------   ----------------   ------
 *   source                        32 B, 0142c00dff…   48 / sum 150200    160591
 *   -c copy  → .mov → back        identical           identical          160591
 *   -c copy  → .mkv → back        identical           identical          160591
 *   -c copy  → .avi → back        identical           identical          160591
 *   -c:v libx264 (a re-encode)    41 B, different     48 / sum 275976    309764
 *
 * Note the sample COUNT is 48 in both columns. `assertMp4` exposes only that
 * count, so an assertion built on it passes just as happily on a re-encode —
 * which is why `expectVideoStreamCopied` compares the whole size table and the
 * decoder configuration record instead.
 */

/** One `trak` of an ISO-BMFF file (MP4 / M4A / MOV), as far as the bytes say. */
export interface IsoTrack {
  /** `hdlr` handler type — "vide", "soun", … */
  handler: string | null;
  /** The `stsd` sample entry fourcc — "avc1", "hvc1", "mp4a", … */
  sampleEntry: string | null;
  /**
   * The decoder configuration record (`avcC` / `hvcC` / `esds` / `vpcC` /
   * `av1C` / `dOps`) as hex. For H.264 this is the SPS+PPS the decoder is set
   * up from; two encodes of the same frames never produce the same one.
   *
   * Null is possible for audio in a QuickTime file, where the `esds` can sit
   * inside a version-1 sample entry's `wave` atom rather than at the fixed
   * offset walked below. Video sample entries have no such variant, and the
   * video track is what every assertion here is about.
   */
  codecConfigHex: string | null;
  /** Every entry of the `stsz` sample-size table, in file order. */
  sampleSizes: number[];
  /** The `tkhd` 3x3 display matrix, nine fixed-point ints, or null. */
  matrix: number[] | null;
  /** `tkhd` width/height in pixels (the 16.16 fields, divided out). */
  width: number;
  height: number;
}

export interface IsoBmffInfo {
  boxes: Set<string>;
  tracks: IsoTrack[];
  /** Total payload bytes across every `mdat` — the media data itself. */
  mdatBytes: number;
}

/** Sample entry fourccs whose children carry the decoder config. */
const VISUAL_SAMPLE_ENTRIES = ["avc1", "avc3", "hvc1", "hev1", "vp09", "av01", "mp4v"];
const AUDIO_SAMPLE_ENTRIES = ["mp4a", "Opus", "ac-3", "alac"];
const CODEC_CONFIG_BOXES = ["avcC", "hvcC", "esds", "vpcC", "av1C", "dOps", "alac"];

/**
 * Walk the box tree and report per-track structure.
 *
 * Deliberately tolerant of trailing junk (it stops on the first impossible box
 * size rather than throwing) so a genuinely broken output still yields whatever
 * it did manage to write, and the test reports on that rather than on a parser
 * crash.
 */
export function parseIsoBmff(buf: Buffer): IsoBmffInfo {
  const boxes = new Set<string>();
  const tracks: IsoTrack[] = [];
  let mdatBytes = 0;
  let current: IsoTrack | null = null;
  const CONTAINERS = ["moov", "trak", "mdia", "minf", "stbl", "dinf", "udta", "edts", "moof", "traf"];

  const walk = (start: number, end: number, depth: number) => {
    if (depth > 12) return;
    let o = start;
    while (o + 8 <= end) {
      let size = buf.readUInt32BE(o);
      const type = buf.toString("latin1", o + 4, o + 8);
      let header = 8;
      if (size === 1) {
        if (o + 16 > end) break;
        size = Number(buf.readBigUInt64BE(o + 8));
        header = 16;
      }
      if (size === 0) size = end - o;
      if (size < header || o + size > end) break;
      const body = o + header;
      const bodyEnd = o + size;
      boxes.add(type);

      if (type === "mdat") mdatBytes += size - header;
      if (type === "trak") {
        current = {
          handler: null, sampleEntry: null, codecConfigHex: null,
          sampleSizes: [], matrix: null, width: 0, height: 0,
        };
        tracks.push(current);
      }
      if (type === "tkhd" && current && body + 84 <= bodyEnd) {
        // v0 packs creation/modification/duration as 32-bit, v1 as 64-bit, so
        // the matrix starts 12 bytes later in v1.
        const matrixAt = body + (buf[body] === 1 ? 52 : 40);
        if (matrixAt + 44 <= bodyEnd) {
          current.matrix = Array.from({ length: 9 }, (_, i) => buf.readInt32BE(matrixAt + i * 4));
          current.width = buf.readUInt32BE(matrixAt + 36) / 65536;
          current.height = buf.readUInt32BE(matrixAt + 40) / 65536;
        }
      }
      // The first `hdlr` under a `trak` is the media handler; a later one in
      // `udta`/`meta` describes metadata and must not overwrite it.
      if (type === "hdlr" && current && !current.handler && body + 12 <= bodyEnd) {
        current.handler = buf.toString("latin1", body + 8, body + 12);
      }
      if (type === "stsz" && current && body + 12 <= bodyEnd) {
        const uniform = buf.readUInt32BE(body + 4);
        const count = buf.readUInt32BE(body + 8);
        if (uniform > 0) {
          current.sampleSizes = new Array<number>(count).fill(uniform);
        } else {
          for (let i = 0; i < count && body + 12 + i * 4 + 4 <= bodyEnd; i++) {
            current.sampleSizes.push(buf.readUInt32BE(body + 12 + i * 4));
          }
        }
      }
      if (current && !current.sampleEntry
        && (VISUAL_SAMPLE_ENTRIES.includes(type) || AUDIO_SAMPLE_ENTRIES.includes(type))) {
        current.sampleEntry = type;
      }
      if (current && !current.codecConfigHex && CODEC_CONFIG_BOXES.includes(type)) {
        current.codecConfigHex = buf.toString("hex", body, bodyEnd);
      }

      if (CONTAINERS.includes(type)) walk(body, bodyEnd, depth + 1);
      // `stsd` is a full box: 4 bytes version/flags + 4 bytes entry count.
      if (type === "stsd") walk(body + 8, bodyEnd, depth + 1);
      // Sample entries carry a fixed header before their child config boxes.
      if (VISUAL_SAMPLE_ENTRIES.includes(type)) walk(body + 78, bodyEnd, depth + 1);
      if (AUDIO_SAMPLE_ENTRIES.includes(type)) walk(body + 28, bodyEnd, depth + 1);
      o += size;
    }
  };
  walk(0, buf.length, 0);
  return { boxes, tracks, mdatBytes };
}

/** The one `vide` track, or a failed expectation naming what was found instead. */
export function videoTrack(info: IsoBmffInfo, label = "file"): IsoTrack {
  const found = info.tracks.filter((t) => t.handler === "vide");
  expect(
    found.length,
    `${label} should carry exactly one video track, but its tracks are ` +
      `[${info.tracks.map((t) => `${t.handler}/${t.sampleEntry}`).join(", ")}]`,
  ).toBe(1);
  return found[0];
}

/** Every `soun` track. Empty is the correct answer for a muted file. */
export function audioTracks(info: IsoBmffInfo): IsoTrack[] {
  return info.tracks.filter((t) => t.handler === "soun");
}

/**
 * Read a `tkhd` display matrix the way FFmpeg reads it.
 *
 * This is `av_display_rotation_get` — `-atan2(m[1], m[0])` — so the number here
 * is the number `ffprobe` prints as "displaymatrix: rotation of N degrees",
 * normalised into [0, 360). Verified against this core: `-metadata:s:v:0
 * rotate=90` writes [0, -65536, 0, 65536, 0, 0, 0, 0, 1073741824], which reads
 * back here as 90.
 *
 * It is COUNTER-clockwise, which is not what anyone means by "rotate 90". Use
 * `displayRotationClockwise` for assertions about what a user asked for.
 */
export function displayRotationDegrees(matrix: number[]): number {
  const degrees = (-Math.atan2(matrix[1] / 65536, matrix[0] / 65536) * 180) / Math.PI;
  return Math.round(((degrees % 360) + 360) % 360);
}

/**
 * The same matrix as degrees CLOCKWISE — the direction a person means when they
 * pick "90°", and the direction `rotate-video`'s control is labelled in.
 *
 * The flip is not cosmetic. FFmpeg's `rotate` tag counts counter-clockwise:
 * rendered through FFmpeg's own autorotate and through Chromium's `<video>`,
 * a clip tagged `rotate=90` turns a quarter turn ANTI-clockwise and `rotate=270`
 * turns it clockwise. A tool that wrote the user's number straight into the tag
 * would turn every video the wrong way and still look correct to an assertion
 * written in FFmpeg's convention — so the assertions here are written in the
 * user's, and that mistake goes red.
 */
export function displayRotationClockwise(matrix: number[]): number {
  return (360 - displayRotationDegrees(matrix)) % 360;
}

/**
 * Fail unless `output`'s video track is bit-for-bit the same elementary stream
 * as `source`'s — the claim every container tool makes.
 *
 * Two-sided on purpose. It first checks the SOURCE is something this can prove
 * anything about (a real decoder config, more than one sample), because a
 * comparison of two empty arrays is a gate that cannot fail.
 *
 * What it does NOT compare, and why: the `mdat` payload itself. Measured — the
 * source's `mdat` md5 differs from every FFmpeg remux of it, because mp4-muxer
 * and FFmpeg interleave the video and audio samples differently. The bytes are
 * all present and unaltered, just ordered differently, so the sample-size table
 * is the honest invariant and the payload md5 is not.
 */
export function expectVideoStreamCopied(source: Buffer, output: Buffer, label = "output"): void {
  const src = videoTrack(parseIsoBmff(source), "the source");
  const out = videoTrack(parseIsoBmff(output), label);

  expect(src.codecConfigHex, "the source fixture must carry a decoder config to compare against")
    .toBeTruthy();
  expect(src.sampleSizes.length, "the source fixture must carry more than one sample")
    .toBeGreaterThan(1);

  expect(
    out.codecConfigHex,
    `${label} re-encoded the video: its decoder configuration record differs from the ` +
      `source's (${src.codecConfigHex!.length / 2} bytes in, ` +
      `${(out.codecConfigHex?.length ?? 0) / 2} bytes out)`,
  ).toBe(src.codecConfigHex);

  expect(
    out.sampleSizes,
    `${label} re-encoded the video: ${out.sampleSizes.length} samples totalling ` +
      `${out.sampleSizes.reduce((a, b) => a + b, 0)} bytes, against the source's ` +
      `${src.sampleSizes.length} totalling ${src.sampleSizes.reduce((a, b) => a + b, 0)}`,
  ).toEqual(src.sampleSizes);
}

// ── Matroska ────────────────────────────────────────────────────────────────

export interface MatroskaTrack {
  /** `TrackType`: 1 = video, 2 = audio. */
  trackType: number | null;
  /** `CodecID`, e.g. "V_MPEG4/ISO/AVC", "A_AAC". */
  codecId: string | null;
  /**
   * `CodecPrivate` as hex. For H.264 in Matroska this is the AVCC record
   * verbatim — measured: remuxing `sample-video.mp4` to `.mkv` stores its exact
   * 32-byte `avcC` here, so it can be compared against the MP4's directly.
   */
  codecPrivateHex: string | null;
  width: number;
  height: number;
}

/** Element IDs, stored with their length marker (the form they appear in). */
const EBML = {
  header: 0x1a45dfa3,
  segment: 0x18538067,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  video: 0xe0,
  audio: 0xe1,
  trackType: 0x83,
  codecId: 0x86,
  codecPrivate: 0x63a2,
  pixelWidth: 0xb0,
  pixelHeight: 0xba,
} as const;

/**
 * A minimal EBML walk — enough to answer "what codec, and is its configuration
 * the source's?" without an external parser.
 *
 * It exists because the browser cannot answer that question: measured, WebKit
 * cannot decode Matroska at all, so `probeVideoInPage` is unavailable for a
 * `.mkv` output in half the conversion suite. The bytes are the only check that
 * runs in both projects.
 */
export function parseMatroska(buf: Buffer): { magic: string; tracks: MatroskaTrack[] } {
  const tracks: MatroskaTrack[] = [];
  let current: MatroskaTrack | null = null;
  const MASTERS = new Set<number>([EBML.header, EBML.segment, EBML.tracks, EBML.trackEntry, EBML.video, EBML.audio]);

  /** Read a variable-length integer; `keepMarker` returns the ID form. */
  const vint = (o: number, keepMarker: boolean): { value: number; len: number } | null => {
    if (o >= buf.length) return null;
    const first = buf[o];
    if (first === 0) return null;
    let len = 1;
    for (let mask = 0x80; mask && !(first & mask); mask >>= 1) len++;
    if (len > 8 || o + len > buf.length) return null;
    let value = keepMarker ? first : first & (0xff >> len);
    for (let i = 1; i < len; i++) value = value * 256 + buf[o + i];
    return { value, len };
  };
  const uint = (start: number, end: number): number => {
    let value = 0;
    for (let i = start; i < end; i++) value = value * 256 + buf[i];
    return value;
  };

  const walk = (start: number, end: number, depth: number) => {
    if (depth > 8) return;
    let o = start;
    while (o < end) {
      const id = vint(o, true);
      if (!id) return;
      const size = vint(o + id.len, false);
      if (!size) return;
      const body = o + id.len + size.len;
      const bodyEnd = Math.min(body + size.value, end);
      if (bodyEnd < body) return;

      if (id.value === EBML.trackEntry) {
        current = { trackType: null, codecId: null, codecPrivateHex: null, width: 0, height: 0 };
        tracks.push(current);
      }
      if (current) {
        // CodecID is a zero-padded ASCII string.
        if (id.value === EBML.codecId) current.codecId = buf.toString("latin1", body, bodyEnd).replace(/\0+$/, "");
        if (id.value === EBML.codecPrivate) current.codecPrivateHex = buf.toString("hex", body, bodyEnd);
        if (id.value === EBML.trackType) current.trackType = uint(body, bodyEnd);
        if (id.value === EBML.pixelWidth) current.width = uint(body, bodyEnd);
        if (id.value === EBML.pixelHeight) current.height = uint(body, bodyEnd);
      }
      if (MASTERS.has(id.value)) walk(body, bodyEnd, depth + 1);
      o = bodyEnd > o ? bodyEnd : body + 1;
    }
  };
  walk(0, buf.length, 0);
  return { magic: buf.toString("hex", 0, 4), tracks };
}
