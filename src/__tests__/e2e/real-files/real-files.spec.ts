import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  captureDownload,
  decodeAudioInPage,
  downloadAffordance,
  forbidCdnCore,
  primaryAction,
  probeImageInPage,
  probeVideoInPage,
  toolError,
  uploadFixture,
} from "../conversion/support";
import {
  IMAGE_MAE,
  compareImages,
  compareVideoToSource,
  expectSameImage,
  expectVideoMatches,
  pdfPageTexts,
  videoFramesInPage,
} from "../conversion/fidelity";

/**
 * REAL-FILE RUN — opt-in, `TRANSMUTE_REAL_FILES=<dir> npm run test:e2e:real`.
 * See README.md next to this file. One test per (file x tool), so the report
 * names the failing pair.
 *
 * Content checks reuse `conversion/fidelity.ts`; the one thing that module
 * cannot do — real audio is not a pure tone — is the LOCAL `analyseAudio`
 * below (RMS-envelope correlation plus long-term band levels).
 */

interface FixtureFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

const DIR = process.env.TRANSMUTE_REAL_FILES ? path.resolve(process.env.TRANSMUTE_REAL_FILES) : "";
/** Files above this are listed as skipped rather than base64'd through the page. */
const MAX_MB = Number(process.env.TRANSMUTE_REAL_MAX_MB ?? 400);

// ────────────────────────────────────────────────────────────────────────────
// Discovery
// ────────────────────────────────────────────────────────────────────────────

type Kind = "image" | "video" | "audio" | "pdf";

const KIND_BY_EXT: Record<string, { kind: Kind; mime: string }> = {
  ".jpg": { kind: "image", mime: "image/jpeg" },
  ".jpeg": { kind: "image", mime: "image/jpeg" },
  ".png": { kind: "image", mime: "image/png" },
  ".heic": { kind: "image", mime: "image/heic" },
  ".heif": { kind: "image", mime: "image/heif" },
  ".webp": { kind: "image", mime: "image/webp" },
  ".avif": { kind: "image", mime: "image/avif" },
  ".tif": { kind: "image", mime: "image/tiff" },
  ".tiff": { kind: "image", mime: "image/tiff" },
  ".mp4": { kind: "video", mime: "video/mp4" },
  ".mov": { kind: "video", mime: "video/quicktime" },
  ".webm": { kind: "video", mime: "video/webm" },
  ".mp3": { kind: "audio", mime: "audio/mpeg" },
  ".wav": { kind: "audio", mime: "audio/wav" },
  ".m4a": { kind: "audio", mime: "audio/mp4" },
  ".flac": { kind: "audio", mime: "audio/flac" },
  ".ogg": { kind: "audio", mime: "audio/ogg" },
  ".opus": { kind: "audio", mime: "audio/ogg" },
  ".aac": { kind: "audio", mime: "audio/aac" },
  ".wma": { kind: "audio", mime: "audio/x-ms-wma" },
  ".pdf": { kind: "pdf", mime: "application/pdf" },
};

/** Tools to run per extension. Each is also gated at run time by the page's own `accept`. */
const TOOLS: Record<string, string[]> = {
  ".jpg": ["jpg-to-png", "jpg-to-webp", "compress-image", "resize-image"],
  ".jpeg": ["jpg-to-png", "jpg-to-webp", "compress-image", "resize-image"],
  ".png": ["png-to-jpg", "compress-image", "resize-image"],
  ".webp": ["webp-to-jpg", "webp-to-png"],
  ".avif": ["avif-to-jpg", "avif-to-png"],
  ".tif": ["tiff-to-jpg", "tiff-to-png"],
  ".tiff": ["tiff-to-jpg", "tiff-to-png"],
  ".heic": ["heic-to-jpg", "heic-to-webp"],
  ".heif": ["heic-to-jpg", "heic-to-webp"],
  ".mp4": ["compress-video", "video-trimmer"],
  ".mov": ["compress-video", "video-trimmer", "mov-to-mp4"],
  ".webm": ["compress-video", "video-trimmer"],
  ".mp3": ["mp3-to-wav", "mp3-converter"],
  ".wav": ["wav-to-mp3", "wav-to-flac", "mp3-converter"],
  ".m4a": ["m4a-to-mp3", "m4a-to-wav", "mp3-converter"],
  ".aac": ["m4a-to-mp3", "mp3-converter"],
  ".flac": ["flac-to-mp3", "mp3-converter"],
  ".ogg": ["ogg-to-mp3", "mp3-converter"],
  ".opus": ["mp3-converter"],
  ".wma": ["mp3-converter"],
  ".pdf": ["compress-pdf", "split-pdf", "rotate-pdf"],
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function load(file: string): FixtureFile {
  const ext = path.extname(file).toLowerCase();
  return { name: path.basename(file), mimeType: KIND_BY_EXT[ext].mime, buffer: readFileSync(file) };
}

function note(type: string, value: unknown): void {
  test.info().annotations.push({ type, description: typeof value === "string" ? value : JSON.stringify(value) });
}

// ────────────────────────────────────────────────────────────────────────────
// Driving a tool
// ────────────────────────────────────────────────────────────────────────────

/** Open the tool, skip cleanly if its drop zone does not take this file, upload. */
async function openAndUpload(page: Page, slug: string, input: FixtureFile): Promise<void> {
  forbidCdnCore(page);
  await page.goto(`/${slug}`);
  const ext = path.extname(input.name).toLowerCase();
  const field = page.locator('input[type="file"]').first();
  await field.waitFor({ state: "attached" });
  const accept = ((await field.getAttribute("accept")) ?? "").toLowerCase();
  const accepted = accept.split(",").map((s) => s.trim()).filter(Boolean);
  test.skip(
    accepted.length > 0 && !accepted.includes(ext) && !accepted.includes(input.mimeType),
    `/${slug} does not accept ${ext} (accept="${accept}")`,
  );
  await uploadFixture(page, input);
}

/**
 * Wait for the download — or for the tool to say it failed. Waiting only for
 * the download would sit out the whole timeout on a tool that errored at once
 * (and `toolError` evaluated before the wait reads nothing).
 */
async function finish(page: Page, what: string, opts: { unsupportedSkipsWhen?: boolean; skipOn?: RegExp } = {}): Promise<{ name: string; bytes: Buffer }> {
  const dl = downloadAffordance(page);
  const alert = page.locator('[role="alert"]').filter({ hasText: /\S/ }).first();
  await expect(dl.or(alert), `${what}: neither a download nor an error appeared`).toBeVisible();
  if (!(await dl.isVisible())) {
    const msg = (await toolError(page)) ?? "(alert with no text)";
    // A WebCodecs tool cannot decode what the browser has no decoder for (HEVC in Chromium): the
    // page refusing with a codec message is correct behaviour, so it is a skip, not a failure.
    test.skip(!!opts.skipOn && opts.skipOn.test(msg), `this browser cannot do it, and the page says so: ${msg}`);
    test.skip(!!opts.unsupportedSkipsWhen && /codec|container|not supported/i.test(msg), `browser cannot decode this source; the page said: ${msg}`);
    throw new Error(`${what} failed: ${msg}`);
  }
  return captureDownload(page, dl, 600_000);
}

const mimeOf = (name: string): string => {
  const ext = path.extname(name).toLowerCase();
  return (
    { ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".flac": "audio/flac" } as Record<string, string>
  )[ext] ?? "application/octet-stream";
};

// ────────────────────────────────────────────────────────────────────────────
// Images
// ────────────────────────────────────────────────────────────────────────────

async function canDecodeImage(page: Page, f: FixtureFile): Promise<{ width: number; height: number } | null> {
  try {
    return await probeImageInPage(page, f.buffer, f.mimeType);
  } catch {
    return null;
  }
}

/** Coarse picture statistics, so an undecodable-source run can still reject black / flat output. */
async function pictureStats(page: Page, bytes: Buffer, mime: string) {
  return page.evaluate(
    async ({ b64, type }) => {
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([buf], { type }));
      const w = 64;
      const h = Math.max(1, Math.round((64 * bmp.height) / bmp.width));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(bmp, 0, 0, w, h);
      const d = ctx.getImageData(0, 0, w, h).data;
      let sum = 0;
      let sq = 0;
      const n = w * h;
      for (let i = 0; i < d.length; i += 4) {
        const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        sum += y;
        sq += y * y;
      }
      const mean = sum / n;
      return { mean, std: Math.sqrt(Math.max(0, sq / n - mean * mean)), width: bmp.width, height: bmp.height };
    },
    { b64: bytes.toString("base64"), type: mime },
  );
}

/**
 * Sizes a HEIC's output may legitimately have, read from the container: every
 * `ispe` (a burst's primary is not its largest picture, and which one is
 * primary lives in `pitm`/`ipma`, which this does not parse), with the axes
 * swapped when any `irot` is a quarter turn. A sideways phone portrait that
 * comes back unrotated is landscape where every candidate is portrait, so the
 * check still catches the orientation bug it exists for.
 */
function heicExpectedSizes(buf: Buffer): { width: number; height: number }[] {
  const sizes: { width: number; height: number }[] = [];
  let odd = false;
  for (let i = 4; i + 16 <= buf.length; i++) {
    const tag = buf.toString("latin1", i, i + 4);
    if (tag === "ispe") {
      const width = buf.readUInt32BE(i + 8);
      const height = buf.readUInt32BE(i + 12);
      if (width > 0 && height > 0 && !sizes.some((z) => z.width === width && z.height === height)) sizes.push({ width, height });
    } else if (tag === "irot" && (buf[i + 4] & 3) % 2 === 1) {
      odd = true;
    }
  }
  return odd ? sizes.map((z) => ({ width: z.height, height: z.width })) : sizes;
}

async function runImage(page: Page, slug: string, input: FixtureFile) {
  await openAndUpload(page, slug, input);
  const ext = path.extname(input.name).toLowerCase();
  const isHeic = ext === ".heic" || ext === ".heif";
  const srcDims = await canDecodeImage(page, input);
  note("source-decodable-by-browser", !!srcDims);

  if (slug === "resize-image") {
    test.skip(!srcDims, "resize-image needs the source dimensions, and this browser cannot decode the source");
    const width = page.locator('input[type="number"]').first();
    await expect(width).toBeVisible();
    await width.fill(String(Math.max(16, Math.round(srcDims!.width / 2))));
    await width.blur();
    await primaryAction(page, /^Resize$/).click();
  } else if (slug === "compress-image") {
    await primaryAction(page, /^Compress$/).click();
  } else {
    await primaryAction(page, /^Convert$/).click();
  }

  const { name, bytes } = await finish(page, slug, { skipOn: /cannot write/i });
  const outMime = mimeOf(name);
  const outDims = await probeImageInPage(page, bytes, outMime);
  note("output", { name, bytes: bytes.length, ...outDims, sourceBytes: input.buffer.length });

  if (slug === "compress-image") {
    expect(bytes.length, "compression must never grow the file").toBeLessThanOrEqual(input.buffer.length);
  }

  if (srcDims) {
    const aspect = (d: { width: number; height: number }) => d.width / d.height;
    if (slug === "resize-image") {
      expect(Math.abs(aspect(outDims) / aspect(srcDims) - 1), `resize changed the aspect ratio ${JSON.stringify({ srcDims, outDims })}`).toBeLessThan(0.01);
    } else {
      expect(outDims, "dimensions (orientation-applied) differ from the browser's own decode of the source").toEqual(srcDims);
    }
    // The browser decode applies EXIF orientation and the embedded ICC profile
    // (to sRGB); an output that is turned, flipped, or colour-shifted by a
    // profile the tool dropped shows here as MAE / correlation / bias.
    const lossless = outMime === "image/png" && slug !== "resize-image";
    // JPEG has no alpha: the tool flattens transparency onto white, so compare over white.
    const diff = await compareImages(page, { bytes: input.buffer, mime: input.mimeType }, { bytes, mime: outMime }, outMime === "image/jpeg" ? { background: "#ffffff" } : {});
    expectSameImage(diff, {
      label: `${slug} <- ${input.name}`,
      maxMae: lossless ? IMAGE_MAE.lossless * 2 : IMAGE_MAE.lossy,
      ...(lossless ? {} : { maxBias: 8 }),
      // Layout correlation is meaningless on a (near-)flat picture, where it reads noise; MAE <= 3 already says "the same picture".
      ...(diff.mae <= 3 ? { minCorrelation: -1 } : {}),
    });
    return;
  }

  // The browser cannot decode the source (HEIC in Chromium, TIFF, ...): comparing
  // against the app's own decode would be circular, so check what is independent.
  const stats = await pictureStats(page, bytes, outMime);
  note("picture-stats", stats);
  expect(stats.mean, "output is black").toBeGreaterThan(6);
  // A tiny synthetic HEIC (the repo's own fixtures) really is one colour; a real photo is never a few KB of flat fill.
  if (input.buffer.length > 20_000) expect(stats.std, "output is a flat fill").toBeGreaterThan(1);
  if (isHeic) {
    const want = heicExpectedSizes(input.buffer);
    note("heic-container-sizes", want);
    if (want.length > 0) {
      expect(
        want.some((z) => z.width === outDims.width && z.height === outDims.height),
        `output ${outDims.width}x${outDims.height} is none of the HEIC's picture sizes with irot applied: ${JSON.stringify(want)}`,
      ).toBe(true);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Video
// ────────────────────────────────────────────────────────────────────────────

const REAL_FPS = 30;

async function framesLookDecoded(page: Page, f: FixtureFile, duration: number): Promise<boolean> {
  const { frames } = await videoFramesInPage(page, f.buffer, f.mimeType, [Math.min(duration / 2, Math.max(0, duration - 0.2))]);
  const rgb = frames[0]?.rgb ?? [];
  const mean = rgb.reduce((a, b) => a + b, 0) / Math.max(1, rgb.length);
  return mean > 4;
}

async function runVideo(page: Page, slug: string, input: FixtureFile) {
  await openAndUpload(page, slug, input);
  const src = { bytes: input.buffer, mime: input.mimeType };
  let srcProbe: { duration: number; width: number; height: number } | null = null;
  try {
    srcProbe = await probeVideoInPage(page, input.buffer, input.mimeType);
    // Metadata alone loads for HEVC in Chromium (0x0 or a black picture): only a frame that decodes counts.
    if (srcProbe.width === 0 || srcProbe.height === 0) srcProbe = null;
    else if (!(await framesLookDecoded(page, input, srcProbe.duration))) srcProbe = null;
  } catch {
    srcProbe = null;
  }
  note("source-decodable-by-browser", srcProbe ?? false);

  let start = 0;
  let clip = 0;
  let reencoded = true;
  if (slug === "video-trimmer") {
    const startField = page.getByLabel("Clip start");
    const endField = page.getByLabel("Clip end");
    await expect(startField).toBeEnabled();
    // The slider's own max is the duration the page believes; it exists even when the browser cannot decode the source.
    const total = srcProbe?.duration ?? Number((await endField.getAttribute("max")) ?? 0);
    start = Math.max(0.5, Math.round(total * 0.25 * 10) / 10);
    clip = Math.min(2, Math.max(0.5, Math.round(total * 0.2 * 10) / 10));
    test.skip(total < start + clip + 0.2, `source too short to trim (${total.toFixed(2)} s)`);
    await startField.fill(String(start));
    await endField.fill(String(start + clip));
    await page.getByRole("group", { name: "Cut accuracy" }).getByRole("button", { name: "Exact frame", exact: true }).click();
    await primaryAction(page, /^Trim$/).click();
  } else if (slug === "compress-video") {
    await primaryAction(page, /^Compress$/).click();
  } else {
    // mov-to-mp4. An iPhone HEVC clip is refused a silent rewrap and offers an explicit re-encode.
    const hevc = page.locator("[data-tool-surface]").getByText(/This recording is H\.265/);
    if (await hevc.waitFor({ timeout: 20_000 }).then(() => true, () => false)) {
      note("hevc", "tool asked for an explicit H.264 re-encode; taking it");
      await page.getByRole("button", { name: "Re-encode to H.264" }).click();
    } else {
      reencoded = false;
    }
    await expect(primaryAction(page, /^Convert$/)).toBeEnabled({ timeout: 60_000 });
    await primaryAction(page, /^Convert$/).click();
  }

  const { name, bytes } = await finish(page, slug, { unsupportedSkipsWhen: !srcProbe });
  const out = { bytes, mime: "video/mp4" };
  const probe = await probeVideoInPage(page, bytes, "video/mp4");
  note("output", { name, bytes: bytes.length, ...probe, sourceBytes: input.buffer.length });
  expect(probe.duration, "output has no duration").toBeGreaterThan(0);

  if (slug === "video-trimmer") {
    expect(Math.abs(probe.duration - clip), `exact trim of ${clip}s lasted ${probe.duration}s`).toBeLessThan(0.25);
  } else if (srcProbe) {
    expect(Math.abs(probe.duration - srcProbe.duration), `duration ${srcProbe.duration} -> ${probe.duration}`).toBeLessThan(Math.max(0.5, srcProbe.duration * 0.02));
  }
  if (srcProbe) {
    if (slug === "compress-video") {
      // Compression may scale; it must not change the shape.
      expect(Math.abs(probe.width / probe.height / (srcProbe.width / srcProbe.height) - 1), "aspect ratio changed (rotation lost?)").toBeLessThan(0.02);
    } else {
      expect({ w: probe.width, h: probe.height }, "display size changed").toEqual({ w: srcProbe.width, h: srcProbe.height });
    }
  }

  const span = slug === "video-trimmer" ? probe.duration : Math.min(probe.duration, srcProbe?.duration ?? probe.duration);
  const outTimes = [0.05, 0.4, 0.8].map((f) => Math.max(0.05, Math.min(span - 0.15, span * f)));
  if (srcProbe) {
    const { matches } = await compareVideoToSource(page, src, out, {
      outTimes,
      map: (t) => t + start,
      fps: REAL_FPS,
      slackFrames: 3,
    });
    expectVideoMatches(matches, {
      label: `${slug} <- ${input.name}`,
      // Real footage re-encoded by WebCodecs at default bitrates is softer than the synthetic fixtures.
      maxMae: reencoded ? 18 : 3,
      minCorrelation: 0.8,
    });
    return;
  }
  // Browser cannot decode the source (HEVC in Chromium): frames can only be checked on their own.
  const frames = await videoFramesInPage(page, bytes, "video/mp4", outTimes);
  for (const f of frames.frames) {
    const luma: number[] = [];
    for (let i = 0; i < f.rgb.length; i += 3) luma.push(0.299 * f.rgb[i] + 0.587 * f.rgb[i + 1] + 0.114 * f.rgb[i + 2]);
    const mean = luma.reduce((a, b) => a + b, 0) / luma.length;
    const std = Math.sqrt(luma.reduce((a, b) => a + (b - mean) ** 2, 0) / luma.length);
    expect(mean, `frame at ${f.t.toFixed(2)}s is black`).toBeGreaterThan(6);
    expect(std, `frame at ${f.t.toFixed(2)}s is a flat fill`).toBeGreaterThan(3);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Audio
// ────────────────────────────────────────────────────────────────────────────

interface AudioProfile {
  duration: number;
  channels: number;
  sampleRate: number;
  /** RMS per 50 ms window of the mono mix. */
  env: number[];
  /** Long-term level at log-spaced frequencies, dB re full scale. */
  bandsDb: number[];
  /** Mean-square level of the whole mono mix, dB re full scale. */
  totalDb: number;
  freqs: number[];
}

/** Decode in the browser and reduce to what two different encodings of one recording share. */
async function analyseAudio(page: Page, bytes: Buffer): Promise<AudioProfile> {
  return page.evaluate(async (b64: string) => {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const ac = new AudioContext();
    try {
      const audio = await ac.decodeAudioData(buf.buffer);
      const sr = audio.sampleRate;
      const n = audio.length;
      const mono = new Float32Array(n);
      for (let c = 0; c < audio.numberOfChannels; c++) {
        const d = audio.getChannelData(c);
        for (let i = 0; i < n; i++) mono[i] += d[i] / audio.numberOfChannels;
      }
      const win = Math.round(sr * 0.05);
      const env: number[] = [];
      for (let s = 0; s + win <= n; s += win) {
        let acc = 0;
        for (let i = s; i < s + win; i++) acc += mono[i] * mono[i];
        env.push(Math.sqrt(acc / win));
      }
      const freqs = [100, 200, 400, 800, 1600, 3200, 6400];
      const N = 4096;
      const hann = new Float32Array(N);
      let hsum = 0;
      for (let i = 0; i < N; i++) { hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)); hsum += hann[i]; }
      const windows = Math.min(48, Math.max(1, Math.floor(n / N)));
      const power = freqs.map(() => 0);
      for (let w = 0; w < windows; w++) {
        const off = windows === 1 ? 0 : Math.floor((w * (n - N)) / (windows - 1));
        freqs.forEach((f, k) => {
          // A band is +-1/3 octave around its centre (nine probes a semitone apart), not one bin:
          // programme material spreads its energy, a single bin sees almost none of it.
          for (let j = -4; j <= 4; j++) {
            const fj = f * Math.pow(2, j / 12);
            const coeff = 2 * Math.cos((2 * Math.PI * fj) / sr);
            let s1 = 0;
            let s2 = 0;
            for (let i = 0; i < N; i++) {
              const s0 = (mono[off + i] ?? 0) * hann[i] + coeff * s1 - s2;
              s2 = s1;
              s1 = s0;
            }
            const p = s1 * s1 + s2 * s2 - coeff * s1 * s2;
            power[k] += (2 * p) / (hsum * hsum) / windows;
          }
        });
      }
      let total = 0;
      for (let i = 0; i < n; i++) total += mono[i] * mono[i];
      return {
        duration: audio.duration,
        channels: audio.numberOfChannels,
        sampleRate: sr,
        env,
        freqs,
        bandsDb: power.map((p) => 10 * Math.log10(Math.max(p, 1e-12))),
        totalDb: 10 * Math.log10(Math.max(total / Math.max(1, n), 1e-12)),
      };
    } finally {
      await ac.close();
    }
  }, bytes.toString("base64"));
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return NaN;
  const ma = a.slice(0, n).reduce((x, y) => x + y, 0) / n;
  const mb = b.slice(0, n).reduce((x, y) => x + y, 0) / n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) { ab += (a[i] - ma) * (b[i] - mb); aa += (a[i] - ma) ** 2; bb += (b[i] - mb) ** 2; }
  return aa === 0 || bb === 0 ? NaN : ab / Math.sqrt(aa * bb);
}

/** Best envelope correlation over small lags: encoders add 25-50 ms of delay and padding. */
function envelopeMatch(src: number[], out: number[]): { corr: number; lag: number; flat: boolean } {
  const m = (v: number[]) => v.reduce((x, y) => x + y, 0) / Math.max(1, v.length);
  const cv = (v: number[]) => {
    const mu = m(v);
    return mu === 0 ? 0 : Math.sqrt(m(v.map((x) => (x - mu) ** 2))) / mu;
  };
  // Coarsen 50 ms -> 200 ms (power mean): codecs smear transients over tens of ms, which on a sharp
  // dip reads as a different contour at fine resolution and as the same one at this.
  const coarse = (v: number[]) => {
    const r: number[] = [];
    for (let i = 0; i + 4 <= v.length; i += 4) r.push(Math.sqrt((v[i] ** 2 + v[i + 1] ** 2 + v[i + 2] ** 2 + v[i + 3] ** 2) / 4));
    return r;
  };
  // The first and last windows hold encoder priming / padding, not the recording.
  const trim = (v: number[]) => {
    const c = coarse(v);
    return c.length > 6 ? c.slice(1, -1) : c;
  };
  const s = trim(src);
  const o = trim(out);
  if (cv(s) < 0.1 && cv(o) < 0.1) {
    // A steady tone has no contour to correlate (what is left is encoder jitter): compare levels instead.
    const ms = m(s);
    const mo = m(o);
    const ratio = ms === 0 || mo === 0 ? (ms === mo ? 1 : 0) : Math.min(ms, mo) / Math.max(ms, mo);
    return { corr: ratio > 0.84 ? 1 : 0, lag: 0, flat: true };
  }
  let best = { corr: -1, lag: 0 };
  for (let lag = -2; lag <= 2; lag++) {
    const c = pearson(lag >= 0 ? s.slice(lag) : s, lag >= 0 ? o : o.slice(-lag));
    if (!Number.isNaN(c) && c > best.corr) best = { corr: c, lag };
  }
  return { ...best, flat: false };
}

/**
 * Bytes as this TEST can measure them. Chromium's Web Audio refuses 6-channel
 * audio declared as 5.1 with back surrounds — measured 2026-11-11 — and FFmpeg
 * writes exactly that into a 5.1 FLAC as `WAVEFORMATEXTENSIBLE_CHANNEL_MASK=0x3f`.
 * The FILE is correct (it is the standard tag, and Chrome's <audio> plays it);
 * only `decodeAudioData`, which this harness uses to read samples, cannot open
 * it. So the tag's key is renamed, same length, before measuring: an unknown
 * comment is ignored and every byte of audio is unchanged. The app's own decode
 * path handles the real file (audio-decode.ts, surround-audio.spec.ts).
 */
function measurable(bytes: Buffer): Buffer {
  const key = Buffer.from("WAVEFORMATEXTENSIBLE_CHANNEL_MASK=", "latin1");
  if (bytes.subarray(0, 4).toString("latin1") !== "fLaC") return bytes;
  const at = bytes.indexOf(key);
  if (at < 0) return bytes;
  const copy = Buffer.from(bytes);
  copy[at] = "X".charCodeAt(0);
  return copy;
}

async function runAudio(page: Page, slug: string, input: FixtureFile) {
  await openAndUpload(page, slug, input);
  await primaryAction(page, /^Convert$/).click();
  const { name, bytes } = await finish(page, slug);

  const decoded = await decodeAudioInPage(page, measurable(bytes));
  note("output", { name, bytes: bytes.length, ...decoded });
  expect(decoded.peak, "output decoded to digital silence").toBeGreaterThan(0.01);

  let src: AudioProfile | null = null;
  try {
    src = await analyseAudio(page, input.buffer);
  } catch (err) {
    note("source-decodable-by-browser", `false (${(err as Error).message})`);
  }
  if (!src) return; // WMA/Opus in some engines: only the tool's output can be judged.

  const out = await analyseAudio(page, measurable(bytes));
  if (src.channels <= 2) expect(out.channels, "channel count changed").toBe(src.channels);
  else {
    // A surround source is legitimately downmixed by the encoder; level and contour of "the mono mix" then differ by construction.
    note("surround", `${src.channels} ch source: duration and playability only`);
    const slack = Math.max(0.35, src.duration * 0.005);
    expect(Math.abs(out.duration - src.duration), `duration ${src.duration.toFixed(2)} -> ${out.duration.toFixed(2)} s`).toBeLessThan(slack);
    return;
  }

  expectSameRecording(src, out);
}

/**
 * The content verdict for two encodings of one recording: same length, same
 * loudness contour, same long-term spectrum. Split out of `runAudio` so the
 * self-test below can prove it FAILS on broken output, not only that it
 * passes on good output.
 */
function expectSameRecording(src: AudioProfile, out: AudioProfile, label = "output"): void {
  const slack = Math.max(0.35, src.duration * 0.005);
  expect(
    Math.abs(out.duration - src.duration),
    `${label}: duration ${src.duration.toFixed(2)} -> ${out.duration.toFixed(2)} s`,
  ).toBeLessThan(slack);

  const env = envelopeMatch(src.env, out.env);
  note("envelope", { ...env, windows: Math.min(src.env.length, out.env.length), srcHead: src.env.slice(0, 24).map((v) => +v.toFixed(4)), outHead: out.env.slice(0, 24).map((v) => +v.toFixed(4)) });
  expect(env.corr, `${label}: the loudness contour no longer follows the source (best lag ${env.lag} windows)`).toBeGreaterThan(0.97);

  // Long-term levels: wrong sample rate, a resample applied twice, or a filter shows as a shifted spectrum.
  const worst = { diff: 0, freq: 0 };
  src.freqs.forEach((f, k) => {
    // A band holding < 0.01 % of the programme's power is noise floor or a tone's skirt: codec noise
    // differs there by many dB without anything being wrong. Real material has energy in its bands.
    if (src.bandsDb[k] < src.totalDb - 40 && out.bandsDb[k] < src.totalDb - 40) return;
    const diff = Math.abs(src.bandsDb[k] - out.bandsDb[k]);
    if (diff > worst.diff) { worst.diff = diff; worst.freq = f; }
  });
  note("band-levels-db", { src: src.bandsDb.map((v) => +v.toFixed(1)), out: out.bandsDb.map((v) => +v.toFixed(1)), worst });
  expect(worst.diff, `${label}: spectrum differs by ${worst.diff.toFixed(1)} dB at ${worst.freq} Hz`).toBeLessThan(4);
}

// ────────────────────────────────────────────────────────────────────────────
// PDF
// ────────────────────────────────────────────────────────────────────────────

const squash = (t: string) => t.replace(/\s+/g, "");

async function pageAngles(buf: Buffer): Promise<number[]> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.load(new Uint8Array(buf), { ignoreEncryption: true });
  return doc.getPages().map((p) => p.getRotation().angle);
}

function expectTexts(out: string[], want: string[], label: string): void {
  expect(out.length, `${label}: page count`).toBe(want.length);
  const hasText = want.some((t) => squash(t).length > 0);
  note("text-layer", hasText ? "present" : "none (scanned?) — page count only");
  out.forEach((t, i) => {
    expect(squash(t), `${label}: the text of output page ${i + 1} differs from the source page it should be`).toBe(squash(want[i]));
  });
}

async function runPdf(page: Page, slug: string, input: FixtureFile) {
  await openAndUpload(page, slug, input);
  const srcTexts = await pdfPageTexts(input.buffer);
  const srcAngles = await pageAngles(input.buffer);
  const n = srcTexts.length;
  note("source", { pages: n, bytes: input.buffer.length });

  let want: string[] = srcTexts;
  let wantAngles: number[] = srcAngles;

  if (slug === "compress-pdf") {
    // compression starts on drop
  } else if (slug === "split-pdf") {
    await expect(page.getByRole("button", { name: "Select all", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Deselect all" }).click();
    const picks = n === 1 ? [1] : [1, n];
    for (const p of picks) await page.getByRole("button", { name: new RegExp(`^Page ${p}(,|$)`) }).first().click();
    const action = primaryAction(page, new RegExp(`Extract ${picks.length} pages?`));
    await expect(action).toBeEnabled();
    await action.click();
    want = picks.map((p) => srcTexts[p - 1]);
    wantAngles = picks.map((p) => srcAngles[p - 1]);
  } else {
    const rotate = primaryAction(page, /^Rotate \d+ pages?$/);
    await expect(rotate).toBeVisible();
    await rotate.click();
    wantAngles = srcAngles.map((a) => (a + 90) % 360);
  }

  const { name, bytes } = await finish(page, slug);
  note("output", { name, bytes: bytes.length, sourceBytes: input.buffer.length });
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  expectTexts(await pdfPageTexts(bytes), want, slug);
  if (slug !== "compress-pdf") {
    expect(await pageAngles(bytes), `${slug}: page rotations`).toEqual(wantAngles);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// One test per (file x tool)
// ────────────────────────────────────────────────────────────────────────────

if (!DIR) {
  test("real files: TRANSMUTE_REAL_FILES is not set", () => {
    test.skip(true, "set TRANSMUTE_REAL_FILES=<dir> (npm run test:e2e:real)");
  });
} else {
  const files = walk(DIR);
  const handled = files.filter((f) => KIND_BY_EXT[path.extname(f).toLowerCase()]);
  if (handled.length === 0) {
    test(`real files: nothing to test in ${DIR}`, () => {
      throw new Error(`no supported files found under ${DIR}; supported: ${Object.keys(KIND_BY_EXT).join(" ")}`);
    });
  }
  for (const file of handled) {
    const ext = path.extname(file).toLowerCase();
    const { kind } = KIND_BY_EXT[ext];
    const rel = path.relative(DIR, file);
    test.describe(rel, () => {
      for (const slug of TOOLS[ext] ?? []) {
        test(`${rel} x ${slug}`, async ({ page }) => {
          test.skip(statSync(file).size > MAX_MB * 1024 * 1024, `larger than TRANSMUTE_REAL_MAX_MB=${MAX_MB}`);
          const input = load(file);
          if (kind === "image") await runImage(page, slug, input);
          else if (kind === "video") await runVideo(page, slug, input);
          else if (kind === "audio") await runAudio(page, slug, input);
          else await runPdf(page, slug, input);
        });
      }
    });
  }
}

/*
 * SELF-TEST for `expectSameRecording` — runs whenever this project does, with
 * or without a real-files directory. A content check that cannot fail is not
 * a check (see fidelity.spec.ts for the same discipline on the other helpers).
 *
 * Source: `sample-audio-gaps.wav` (16-bit 44.1 kHz; a LOUD 440 Hz tone 1–2 s, a
 * QUIET one 3.5–4.5 s, silence between) — it has a contour to follow. Variants
 * are made by rewriting its PCM in Node, so each differs in exactly one way.
 */
test.describe("real-file audio verdict — self-test", () => {
  const SRC = path.join(process.cwd(), "src/__tests__/fixtures/samples/sample-audio-gaps.wav");

  const CHANNELS = readFileSync(SRC).readUInt16LE(22);

  /** Reverse whole frames (all channels of one instant together). */
  const reverseFrames = (p: Int16Array): Int16Array => {
    const out = new Int16Array(p.length);
    const frames = p.length / CHANNELS;
    for (let f = 0; f < frames; f++) {
      for (let c = 0; c < CHANNELS; c++) out[(frames - 1 - f) * CHANNELS + c] = p[f * CHANNELS + c];
    }
    return out;
  };

  /** Rewrite a 16-bit PCM WAV's samples (and optionally its declared rate). */
  function variant(edit: (pcm: Int16Array) => Int16Array, rate?: number): Buffer {
    const wav = Buffer.from(readFileSync(SRC));
    const pcm = new Int16Array(wav.buffer.slice(wav.byteOffset + 44, wav.byteOffset + wav.length));
    const outPcm = edit(pcm);
    const out = Buffer.alloc(44 + outPcm.length * 2);
    wav.copy(out, 0, 0, 44);
    Buffer.from(outPcm.buffer).copy(out, 44);
    out.writeUInt32LE(36 + outPcm.length * 2, 4);
    out.writeUInt32LE(outPcm.length * 2, 40);
    if (rate) {
      out.writeUInt32LE(rate, 24);
      out.writeUInt32LE(rate * 2 * CHANNELS, 28);
    }
    return out;
  }

  test("passes a faithful copy and fails reversed, re-pitched, quieter and truncated audio", async ({ page }) => {
    await page.goto("/");
    const wav = readFileSync(SRC);
    expect(wav.readUInt16LE(34), "fixture must be 16-bit PCM").toBe(16);
    const src = await analyseAudio(page, wav);

    // Faithful: the same recording with codec-sized noise added (≈ −60 dBFS).
    let seed = 7;
    const noisy = variant((p) => p.map((v) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return Math.max(-32768, Math.min(32767, v + ((seed % 65) - 32)));
    }));
    expectSameRecording(src, await analyseAudio(page, noisy), "noisy copy");

    const broken: Record<string, Buffer> = {
      reversed: variant(reverseFrames),
      // 44.1 kHz samples declared as 48 kHz: 8.8 % sharp and shorter.
      "wrong sample rate": variant((p) => p, 48_000),
      // −12 dB: a gain applied by mistake. Contour intact, every band 12 dB down.
      "12 dB quieter": variant((p) => p.map((v) => Math.round(v / 4))),
      "last second missing": variant((p) => p.slice(0, p.length - 44_100 * CHANNELS)),
    };
    for (const [what, bytes] of Object.entries(broken)) {
      const out = await analyseAudio(page, bytes);
      let failed = false;
      try {
        expectSameRecording(src, out, what);
      } catch {
        failed = true;
      }
      expect(failed, `the audio verdict PASSED a broken output: ${what}`).toBe(true);
    }
  });
});
