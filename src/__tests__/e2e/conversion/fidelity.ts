import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { Buffer } from "node:buffer";

/**
 * CONTENT checks — "is this the right picture / sound / page", not "is this a
 * valid file".
 *
 * `validators.ts` and the probes in `support.ts` answer whether bytes are a
 * well-formed file of some type. Every one of them passes a JPEG that is the
 * wrong way up, an MP4 whose frames are green, an MP3 at the wrong pitch or
 * with its channels swapped, and a "page 2" extract that holds page 1. That
 * is the class of bug users actually report, so these helpers compare the
 * OUTPUT against the SOURCE it came from.
 *
 * Each helper reduces both files to the same small grid / window before
 * comparing, so a legitimate change (re-encoding, downscaling, a codec's own
 * loss) costs a few levels while a real content bug (rotation, colour shift,
 * wrong frame, wrong page, silence) costs tens. The thresholds below were
 * measured, and `fidelity.spec.ts` proves every helper FAILS on a deliberately
 * broken output — a content check that cannot fail is not a check.
 */

// ────────────────────────────────────────────────────────────────────────────
// Images
// ────────────────────────────────────────────────────────────────────────────

export interface EncodedImage {
  bytes: Buffer;
  mime: string;
}

/** What to do to the SOURCE before comparing, to model what the tool promised. */
export type ImageTransform = "none" | "rot90" | "rot180" | "rot270" | "flipH" | "flipV";

export interface ImageDiff {
  /** Decoded size of the output, so a caller can assert dimensions alongside. */
  output: { width: number; height: number };
  /** Grid the two were compared on. */
  grid: { width: number; height: number };
  /** Mean absolute error over R, G and B, 0–255. */
  mae: number;
  /** Mean signed error per channel (output − source): a colour cast shows here. */
  bias: { r: number; g: number; b: number };
  /** Mean absolute error of alpha, 0–255. */
  alphaMae: number;
  /**
   * Pearson correlation of the two luma grids, −1–1. Colour error and
   * STRUCTURE error are different faults: a mostly-flat picture turned upside
   * down moves few levels on average (low MAE) but its layout no longer lines
   * up (low correlation). 0 when either side is a flat fill.
   */
  correlation: number;
  /** Pixels compared. Zero means the comparison compared nothing. */
  compared: number;
}

/**
 * Decode `source` and `output` in the browser, map the source through
 * `transform` / `crop`, draw both onto the same small grid over the same
 * background, and measure how far apart they are.
 *
 * `crop` is in SOURCE pixels (before `transform`). `background` is what both
 * are composited over — pass the colour the tool fills transparency with when
 * the output format has no alpha.
 */
export async function compareImages(
  page: Page,
  source: EncodedImage,
  output: EncodedImage,
  opts: {
    transform?: ImageTransform;
    crop?: { x: number; y: number; width: number; height: number };
    background?: string;
    /** Longest side of the comparison grid. */
    gridMax?: number;
  } = {},
): Promise<ImageDiff> {
  return page.evaluate(
    async ({ src, out, transform, crop, background, gridMax }) => {
      const decode = async (b64: string, type: string) => {
        const bin = atob(b64);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        return createImageBitmap(new Blob([buf], { type }));
      };
      const s = await decode(src.b64, src.mime);
      const o = await decode(out.b64, out.mime);
      const outSize = { width: o.width, height: o.height };

      const scale = Math.min(1, gridMax / Math.max(o.width, o.height));
      const gw = Math.max(1, Math.round(o.width * scale));
      const gh = Math.max(1, Math.round(o.height * scale));

      const raster = (draw: (ctx: CanvasRenderingContext2D) => void) => {
        const c = document.createElement("canvas");
        c.width = gw;
        c.height = gh;
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        if (background) {
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, gw, gh);
        }
        draw(ctx);
        return ctx.getImageData(0, 0, gw, gh).data;
      };

      const sx = crop?.x ?? 0;
      const sy = crop?.y ?? 0;
      const sw = crop?.width ?? s.width;
      const sh = crop?.height ?? s.height;
      const A = raster((ctx) => {
        ctx.translate(gw / 2, gh / 2);
        const quarter = transform === "rot90" || transform === "rot270";
        if (transform === "rot90") ctx.rotate(Math.PI / 2);
        if (transform === "rot180") ctx.rotate(Math.PI);
        if (transform === "rot270") ctx.rotate(-Math.PI / 2);
        if (transform === "flipH") ctx.scale(-1, 1);
        if (transform === "flipV") ctx.scale(1, -1);
        const dw = quarter ? gh : gw;
        const dh = quarter ? gw : gh;
        ctx.drawImage(s, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
      });
      const B = raster((ctx) => ctx.drawImage(o, 0, 0, gw, gh));
      s.close();
      o.close();

      let abs = 0;
      let alpha = 0;
      const bias = [0, 0, 0];
      const n = gw * gh;
      const la: number[] = [];
      const lb: number[] = [];
      for (let i = 0; i < A.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const d = B[i + c] - A[i + c];
          abs += Math.abs(d);
          bias[c] += d;
        }
        alpha += Math.abs(B[i + 3] - A[i + 3]);
        la.push(0.299 * A[i] + 0.587 * A[i + 1] + 0.114 * A[i + 2]);
        lb.push(0.299 * B[i] + 0.587 * B[i + 1] + 0.114 * B[i + 2]);
      }
      const mean = (v: number[]) => v.reduce((x, y) => x + y, 0) / v.length;
      const ma = mean(la);
      const mb = mean(lb);
      let cov = 0;
      let va = 0;
      let vb = 0;
      for (let i = 0; i < la.length; i++) {
        cov += (la[i] - ma) * (lb[i] - mb);
        va += (la[i] - ma) ** 2;
        vb += (lb[i] - mb) ** 2;
      }
      const correlation = va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0;
      return {
        output: outSize,
        grid: { width: gw, height: gh },
        mae: abs / (n * 3),
        bias: { r: bias[0] / n, g: bias[1] / n, b: bias[2] / n },
        alphaMae: alpha / n,
        correlation,
        compared: n,
      };
    },
    {
      src: { b64: source.bytes.toString("base64"), mime: source.mime },
      out: { b64: output.bytes.toString("base64"), mime: output.mime },
      transform: opts.transform ?? "none",
      crop: opts.crop ?? null,
      background: opts.background ?? null,
      gridMax: opts.gridMax ?? 96,
    },
  );
}

/**
 * Ceilings, from `fidelity.spec.ts` on the 800×600 photo fixture at a 96 px
 * grid (2026-11-11, Chromium and WebKit agree within 0.3):
 *
 *   faithful                 mae     correlation    broken            mae    correlation
 *   lossless PNG copy        0       1.000          flipped           61     −0.22
 *   400 px resize            0.8     0.9997         red/blue swapped  50      0.94
 *   q0.3 JPEG                1.1–1.5 0.9997         black             116     0
 *                                                   40/30 px shift    36–38   0.56
 *                                                   +18 R / −18 B     12      1.00  ← caught by bias (±18)
 *
 * A colour cast does not move MAE or correlation much — that is what the
 * per-channel `bias` limit is for. A planted horizontal flip in the shipped
 * image worker read mae 61 / correlation −0.22 on compress and resize.
 */
export const IMAGE_MAE = { lossless: 1.5, lossy: 8, heavy: 14 } as const;
export const IMAGE_MIN_CORRELATION = 0.9;

export function expectSameImage(
  diff: ImageDiff,
  opts: {
    maxMae?: number;
    maxBias?: number;
    maxAlphaMae?: number;
    minCorrelation?: number;
    label?: string;
  } = {},
): void {
  const {
    maxMae = IMAGE_MAE.lossy,
    maxBias = 6,
    maxAlphaMae = 8,
    minCorrelation = IMAGE_MIN_CORRELATION,
    label = "output",
  } = opts;
  const at = `${label}: ${JSON.stringify({ mae: +diff.mae.toFixed(2), bias: round(diff.bias), alphaMae: +diff.alphaMae.toFixed(2), correlation: +diff.correlation.toFixed(3), grid: diff.grid })}`;
  expect(diff.compared, `${label}: the comparison compared no pixels`).toBeGreaterThan(0);
  expect(diff.mae, `${at} — the picture differs from the source`).toBeLessThanOrEqual(maxMae);
  expect(diff.correlation, `${at} — the layout does not line up with the source (turned, flipped, shifted or a different picture?)`).toBeGreaterThanOrEqual(minCorrelation);
  for (const [ch, v] of Object.entries(diff.bias)) {
    expect(Math.abs(v), `${at} — a colour cast on ${ch}`).toBeLessThanOrEqual(maxBias);
  }
  expect(diff.alphaMae, `${at} — transparency changed`).toBeLessThanOrEqual(maxAlphaMae);
}

// ────────────────────────────────────────────────────────────────────────────
// Video
// ────────────────────────────────────────────────────────────────────────────

export interface VideoFrames {
  width: number;
  height: number;
  duration: number;
  /** One RGB grid per requested time, row-major, 3 bytes per cell. */
  frames: { t: number; rgb: number[] }[];
  grid: { width: number; height: number };
}

/**
 * Seek a real `<video>` to each time and read the decoded frame back.
 *
 * `probeVideoInPage` loads METADATA only — it never decodes a frame, so a file
 * whose every frame is green or black passes it. This draws actual pictures.
 * `rotate: true` applies the display matrix the way a player does (browsers
 * already apply it to `videoWidth`/`videoHeight` and to drawImage).
 */
export async function videoFramesInPage(
  page: Page,
  bytes: Buffer,
  mime: string,
  times: number[],
  grid = { width: 64, height: 48 },
): Promise<VideoFrames> {
  return page.evaluate(
    async ({ b64, type, times, grid }) => {
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([buf], { type }));
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      const once = (ev: string, ms = 20_000) =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`video ${ev} timeout`)), ms);
          video.addEventListener(ev, () => { clearTimeout(timer); resolve(); }, { once: true });
          video.addEventListener("error", () => {
            clearTimeout(timer);
            reject(new Error(`video decode error: ${video.error?.message ?? "unknown"}`));
          }, { once: true });
        });
      try {
        const loaded = once("loadeddata");
        video.src = url;
        await loaded;
        const w = video.videoWidth;
        const h = video.videoHeight;
        // Keep the grid's aspect matching the video, so a rotated file cannot
        // be squashed back into the source's shape by the comparison itself.
        const gw = w >= h ? grid.width : grid.height;
        const gh = w >= h ? grid.height : grid.width;
        const canvas = document.createElement("canvas");
        canvas.width = gw;
        canvas.height = gh;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        const frames: { t: number; rgb: number[] }[] = [];
        for (const t of times) {
          const target = Math.max(0, Math.min(t, video.duration - 0.02));
          if (Math.abs(video.currentTime - target) > 1e-3) {
            const seeked = once("seeked");
            video.currentTime = target;
            await seeked;
          }
          ctx.drawImage(video, 0, 0, gw, gh);
          const d = ctx.getImageData(0, 0, gw, gh).data;
          const rgb: number[] = [];
          for (let i = 0; i < d.length; i += 4) rgb.push(d[i], d[i + 1], d[i + 2]);
          frames.push({ t, rgb });
        }
        return { width: w, height: h, duration: video.duration, frames, grid: { width: gw, height: gh } };
      } finally {
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(url);
      }
    },
    { b64: bytes.toString("base64"), type: mime, times, grid },
  );
}

function rgbMae(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return Infinity;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

function lumaCorrelation(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  const la: number[] = [];
  const lb: number[] = [];
  for (let i = 0; i < a.length; i += 3) {
    la.push(0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]);
    lb.push(0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2]);
  }
  const ma = la.reduce((x, y) => x + y, 0) / la.length;
  const mb = lb.reduce((x, y) => x + y, 0) / lb.length;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < la.length; i++) {
    cov += (la[i] - ma) * (lb[i] - mb);
    va += (la[i] - ma) ** 2;
    vb += (lb[i] - mb) ** 2;
  }
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0;
}

function rgbBias(a: number[], b: number[]): { r: number; g: number; b: number } {
  const out = [0, 0, 0];
  for (let i = 0; i < a.length; i++) out[i % 3] += b[i] - a[i];
  const n = a.length / 3;
  return { r: out[0] / n, g: out[1] / n, b: out[2] / n };
}

/** Source fixture: 24 fps, a hue that sweeps 360° over 2 s and a moving block. */
export const SOURCE_FPS = 24;

export interface VideoMatch {
  outT: number;
  srcT: number;
  /** Best MAE over the source frames near `srcT` (absorbs seek imprecision). */
  mae: number;
  bias: { r: number; g: number; b: number };
  /** Luma correlation of that best frame — structure, independent of colour. */
  correlation: number;
  /**
   * Only on a mismatch: the source time this output frame ACTUALLY looks
   * like, found by scanning every source frame. Turns "frame does not match"
   * into "this is the frame from 0.00 s" — a keyframe snap, an offset, a
   * frozen or a black frame each read differently.
   */
  closest?: { srcT: number; mae: number; correlation: number };
}

/**
 * For each output time, find the source frame that `map(outT)` says it should
 * be, and measure the difference. Seeks land on a neighbouring frame often
 * enough that a frame-exact comparison would be noise, so each output frame is
 * matched against the source frames within ±`slackFrames` and the best one
 * counts. That absorbs timing jitter and nothing else: the fixture's hue moves
 * 7.5° per frame, so a frame half a second off is still far away.
 */
export async function compareVideoToSource(
  page: Page,
  source: { bytes: Buffer; mime: string },
  output: { bytes: Buffer; mime: string },
  opts: {
    outTimes: number[];
    map?: (outT: number) => number;
    slackFrames?: number;
    fps?: number;
    /** Rotate the source grid to model a rotation the output should show. */
    transform?: "none" | "rot90" | "rot180" | "rot270";
  },
): Promise<{ matches: VideoMatch[]; output: VideoFrames }> {
  const { outTimes, ...rest } = opts;
  const out = await videoFramesInPage(page, output.bytes, output.mime, outTimes);
  const matches = await matchFramesToSource(page, source, out.frames, out.grid, rest);
  return { matches, output: out };
}

/**
 * The matcher behind `compareVideoToSource`, taking output frames that were
 * decoded some OTHER way (a GIF read in Node, say) as RGB grids, each tagged
 * with the time `map` turns into a source time.
 */
export async function matchFramesToSource(
  page: Page,
  source: { bytes: Buffer; mime: string },
  outFrames: { t: number; rgb: number[] }[],
  outGrid: { width: number; height: number },
  opts: {
    map?: (outT: number) => number;
    slackFrames?: number;
    fps?: number;
    transform?: "none" | "rot90" | "rot180" | "rot270";
  } = {},
): Promise<VideoMatch[]> {
  const { map = (t) => t, slackFrames = 2, fps = SOURCE_FPS, transform = "none" } = opts;
  const outTimes = outFrames.map((f) => f.t);
  const srcTimes: number[] = [];
  for (const t of outTimes) {
    for (let k = -slackFrames; k <= slackFrames; k++) srcTimes.push(Math.max(0, map(t) + k / fps));
  }
  // Source frames are drawn on the OUTPUT's grid orientation, then rotated
  // into place in Node so the two grids line up cell for cell.
  const quarter = transform === "rot90" || transform === "rot270";
  const srcGrid = quarter
    ? { width: outGrid.height, height: outGrid.width }
    : { width: outGrid.width, height: outGrid.height };
  const src = await videoFramesInPage(page, source.bytes, source.mime, srcTimes, {
    width: Math.max(srcGrid.width, srcGrid.height),
    height: Math.min(srcGrid.width, srcGrid.height),
  });
  const per = 2 * slackFrames + 1;
  const matches = outTimes.map((outT, i) => {
    let best = Infinity;
    let bestBias = { r: 0, g: 0, b: 0 };
    let bestCorr = 0;
    for (let k = 0; k < per; k++) {
      const s = rotateGrid(src.frames[i * per + k].rgb, src.grid.width, src.grid.height, transform);
      const m = rgbMae(s, outFrames[i].rgb);
      if (m < best) {
        best = m;
        bestBias = rgbBias(s, outFrames[i].rgb);
        bestCorr = lumaCorrelation(s, outFrames[i].rgb);
      }
    }
    return { outT, srcT: map(outT), mae: best, bias: bestBias, correlation: bestCorr } as VideoMatch;
  });
  if (matches.some((m) => m.mae > VIDEO_MAE.reencode || m.correlation < VIDEO_MIN_CORRELATION)) {
    const dur = (await videoFramesInPage(page, source.bytes, source.mime, [0])).duration;
    const all: number[] = [];
    for (let t = 0; t < dur; t += 1 / fps) all.push(t);
    const scan = await videoFramesInPage(page, source.bytes, source.mime, all, {
      width: Math.max(srcGrid.width, srcGrid.height),
      height: Math.min(srcGrid.width, srcGrid.height),
    });
    matches.forEach((m, i) => {
      let c = { srcT: -1, mae: Infinity, correlation: 0 };
      for (const f of scan.frames) {
        const g = rotateGrid(f.rgb, scan.grid.width, scan.grid.height, transform);
        const e = rgbMae(g, outFrames[i].rgb);
        if (e < c.mae) c = { srcT: f.t, mae: e, correlation: lumaCorrelation(g, outFrames[i].rgb) };
      }
      m.closest = c;
    });
  }
  return matches;
}

function rotateGrid(
  rgb: number[],
  w: number,
  h: number,
  transform: "none" | "rot90" | "rot180" | "rot270",
): number[] {
  if (transform === "none") return rgb;
  const out: number[] = new Array(rgb.length);
  const ow = transform === "rot180" ? w : h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx: number;
      let ny: number;
      if (transform === "rot90") { nx = h - 1 - y; ny = x; }
      else if (transform === "rot270") { nx = y; ny = w - 1 - x; }
      else { nx = w - 1 - x; ny = h - 1 - y; }
      for (let c = 0; c < 3; c++) out[(ny * ow + nx) * 3 + c] = rgb[(y * w + x) * 3 + c];
    }
  }
  return out;
}

/**
 * From `fidelity.spec.ts` on the 320×240 fixture, 64×48 grid (2026-11-11):
 * the source against itself is 0 / correlation 1; the VP8 WebM capture of
 * the same frames 3–8 / ≥0.93. Broken: frames 0.6 s off 70–83 / ~0, one
 * frame repeated 58–101 / ~0, upside down 17–25 / ~0. MAE alone does NOT
 * separate a 180° turn from a lossy re-encode on this mostly-flat fixture —
 * correlation does, which is why both are asserted. compress-video and
 * webm-to-mp4 pass under these ceilings.
 */
export const VIDEO_MAE = { copy: 1, reencode: 12 } as const;
export const VIDEO_MIN_CORRELATION = 0.85;

export function expectVideoMatches(
  matches: VideoMatch[],
  opts: { maxMae?: number; maxBias?: number; minCorrelation?: number; label?: string } = {},
): void {
  const {
    maxMae = VIDEO_MAE.reencode,
    maxBias = 14,
    minCorrelation = VIDEO_MIN_CORRELATION,
    label = "output",
  } = opts;
  expect(matches.length, `${label}: no frames were compared`).toBeGreaterThan(0);
  for (const m of matches) {
    const closest = m.closest
      ? `; closest source frame is ${m.closest.srcT.toFixed(2)}s (mae ${m.closest.mae.toFixed(2)}, correlation ${m.closest.correlation.toFixed(3)})`
      : "";
    const at = `${label} @${m.outT.toFixed(2)}s (source ${m.srcT.toFixed(2)}s): mae ${m.mae.toFixed(2)}, correlation ${m.correlation.toFixed(3)}, bias ${JSON.stringify(round(m.bias))}${closest}`;
    expect(m.mae, `${at} — the frame does not match the source`).toBeLessThanOrEqual(maxMae);
    expect(m.correlation, `${at} — the frame's layout does not line up (turned, flipped or the wrong frame?)`).toBeGreaterThanOrEqual(minCorrelation);
    for (const [ch, v] of Object.entries(m.bias)) {
      expect(Math.abs(v), `${at} — a colour cast on ${ch}`).toBeLessThanOrEqual(maxBias);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// GIF
// ────────────────────────────────────────────────────────────────────────────

export interface DecodedGifFrame {
  index: number;
  /** When this frame comes on screen: the sum of every earlier frame's delay. */
  startMs: number;
  delayMs: number;
  /** The fully COMPOSITED canvas while this frame shows, RGBA, width×height. */
  rgba: Uint8Array;
}

export interface DecodedGifFile {
  width: number;
  height: number;
  frames: DecodedGifFrame[];
}

/**
 * Decode every frame of a GIF in NODE, with omggif — not in the page.
 *
 * Browser-independent on purpose: WebKit has no `ImageDecoder`, and
 * `createImageBitmap` on an animated GIF yields frame 0 only, so an in-page
 * decode would either not run in WebKit or not see the frames under test.
 * This is also a SECOND implementation next to the app's own
 * `lib/tools/gif-decode.ts`, which matters: it applies disposal methods 2 and
 * 3 (the app's omggif path reuses one buffer and ignores them), so it cannot
 * share a compositing bug with the code it checks.
 */
export async function decodeGif(bytes: Buffer): Promise<DecodedGifFile> {
  const { GifReader } = await import("omggif");
  const reader = new GifReader(new Uint8Array(bytes));
  const { width, height } = reader;
  const canvas = new Uint8Array(width * height * 4);
  const frames: DecodedGifFrame[] = [];
  let startMs = 0;
  for (let i = 0; i < reader.numFrames(); i++) {
    const info = reader.frameInfo(i);
    const previous = info.disposal === 3 ? canvas.slice() : null;
    reader.decodeAndBlitFrameRGBA(i, canvas);
    frames.push({ index: i, startMs, delayMs: info.delay * 10, rgba: canvas.slice() });
    startMs += info.delay * 10;
    if (info.disposal === 2) {
      for (let y = info.y; y < Math.min(height, info.y + info.height); y++) {
        canvas.fill(0, (y * width + info.x) * 4, (y * width + Math.min(width, info.x + info.width)) * 4);
      }
    } else if (previous) {
      canvas.set(previous);
    }
  }
  return { width, height, frames };
}

/** Area weights of a 1-D box resample from `n` cells down (or up) to `m`. */
function boxWeights(n: number, m: number): { i: number; w: number }[][] {
  const out: { i: number; w: number }[][] = [];
  const step = n / m;
  for (let o = 0; o < m; o++) {
    const a = o * step;
    const b = a + step;
    const cell: { i: number; w: number }[] = [];
    for (let i = Math.floor(a); i < Math.min(n, Math.ceil(b)); i++) {
      const w = Math.min(b, i + 1) - Math.max(a, i);
      if (w > 0) cell.push({ i, w: w / step });
    }
    out.push(cell);
  }
  return out;
}

/**
 * Box-average an RGBA raster onto an RGB grid (3 numbers per cell, row-major —
 * the layout `videoFramesInPage` returns), compositing over `background`.
 */
export function rgbaToGrid(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  grid: { width: number; height: number },
  background: [number, number, number] = [0, 0, 0],
): number[] {
  const wx = boxWeights(width, grid.width);
  const wy = boxWeights(height, grid.height);
  const out: number[] = [];
  for (let gy = 0; gy < grid.height; gy++) {
    for (let gx = 0; gx < grid.width; gx++) {
      const acc = [0, 0, 0];
      for (const { i: y, w: fy } of wy[gy]) {
        for (const { i: x, w: fx } of wx[gx]) {
          const p = (y * width + x) * 4;
          const a = rgba[p + 3] / 255;
          for (let c = 0; c < 3; c++) acc[c] += fx * fy * (rgba[p + c] * a + background[c] * (1 - a));
        }
      }
      out.push(acc[0], acc[1], acc[2]);
    }
  }
  return out;
}

/** The grid `videoFramesInPage` would use for a picture of this shape. */
function gridFor(width: number, height: number, grid = { width: 64, height: 48 }) {
  return width >= height ? grid : { width: grid.height, height: grid.width };
}

/**
 * Judged by `expectVideoMatches`' ceilings. From `fidelity.spec.ts`
 * (2026-11-11), a gifenc rgb444 animation of the source's own frames reads
 * mae 2.1–3.6 / correlation ≥0.98 in Chromium and 3.9–5.4 / ≥0.948 in WebKit
 * (whose drawImage downscale of the SOURCE side differs); the shipped
 * video-to-gif reads 3.6–4.0 / ≥0.98. Broken: frames in reverse order
 * 44–123 (bar the middle frame, which reverses onto itself), red/blue swapped
 * 38–93, delays half the real gap 22–95 from the second sample on.
 *
 * Compare chosen frames of a GIF made FROM A VIDEO against the source video
 * at the frames' own timestamps (the running sum of the GIF's delays, so a
 * GIF whose delays drift from the frames it holds fails too). `frames`
 * defaults to four spread across the animation. `map` turns a GIF time into
 * a source time — `t => t + clipStart` for a clip that did not start at 0.
 */
export async function compareGifToVideo(
  page: Page,
  source: { bytes: Buffer; mime: string },
  gifBytes: Buffer,
  opts: { frames?: number[]; map?: (t: number) => number; slackFrames?: number } = {},
): Promise<{ gif: DecodedGifFile; matches: VideoMatch[] }> {
  const gif = await decodeGif(gifBytes);
  const n = gif.frames.length;
  const picks = opts.frames ?? [...new Set([0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4)])];
  const grid = gridFor(gif.width, gif.height);
  const outFrames = picks.map((i) => {
    const f = gif.frames[i];
    if (!f) throw new Error(`GIF has ${n} frames; frame ${i} does not exist`);
    return { t: f.startMs / 1000, rgb: rgbaToGrid(f.rgba, gif.width, gif.height, grid) };
  });
  const matches = await matchFramesToSource(page, source, outFrames, grid, {
    map: opts.map,
    slackFrames: opts.slackFrames,
  });
  return { gif, matches };
}

/**
 * Decode any still the browser can (PNG, JPEG, WebP…) and reduce it onto an
 * RGB grid over `background`. The browser only DECODES, at full size; the
 * reduction is `rgbaToGrid` in Node, the same resampler a GIF frame goes
 * through. Measured why: WebKit's "high quality" drawImage downscale of the
 * 256 px noise frame to 32 px read correlation 0.67 against the Node box
 * average (Chromium 0.999) — it samples rather than averages, so an
 * in-browser reduction made the comparison engine-dependent.
 */
export async function imageGridInPage(
  page: Page,
  image: EncodedImage,
  grid: { width: number; height: number },
  background: [number, number, number] = [0, 0, 0],
): Promise<{ rgb: number[]; width: number; height: number }> {
  const raw = await page.evaluate(
    async ({ b64, type }) => {
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([buf], { type }));
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let s = "";
      for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000));
      return { b64: btoa(s), width: c.width, height: c.height };
    },
    { b64: image.bytes.toString("base64"), type: image.mime },
  );
  const rgba = new Uint8Array(Buffer.from(raw.b64, "base64"));
  return { rgb: rgbaToGrid(rgba, raw.width, raw.height, grid, background), width: raw.width, height: raw.height };
}

/**
 * Two RGB grids as an `ImageDiff`, so `expectSameImage` judges them.
 *
 * Measured (fidelity.spec, 2026-11-11, both engines): the 256 px noise frame
 * re-encoded as PNG reads mae 0 / correlation 1 against its Node decode, as
 * a q0.92 JPEG 0.85–1.19 / ≥0.9998; the OTHER noise frame in its place reads
 * ~10 / 0.01, and the red fixture frame in the blue one's place 136.7.
 *
 * One difference from `compareImages`: when BOTH grids are flat fills (the
 * solid-colour animation fixtures) the correlation is reported as 1 — two
 * flat fills have the same layout, and only their colour (MAE, bias) can
 * differ. A flat grid against a structured one still reads 0.
 */
export function diffGrids(
  source: number[],
  output: number[],
  grid: { width: number; height: number },
  outputSize: { width: number; height: number } = grid,
): ImageDiff {
  const n = grid.width * grid.height;
  if (source.length !== n * 3 || output.length !== n * 3) {
    throw new Error(`grid sizes differ: ${source.length / 3} vs ${output.length / 3} cells, expected ${n}`);
  }
  const lumaVar = (g: number[]) => {
    const l: number[] = [];
    for (let i = 0; i < g.length; i += 3) l.push(0.299 * g[i] + 0.587 * g[i + 1] + 0.114 * g[i + 2]);
    const m = l.reduce((a, b) => a + b, 0) / l.length;
    return l.reduce((a, b) => a + (b - m) ** 2, 0) / l.length;
  };
  // Below 1 level² of luma variance a grid is a flat fill plus rounding.
  const flatA = lumaVar(source) < 1;
  const flatB = lumaVar(output) < 1;
  return {
    output: outputSize,
    grid,
    mae: rgbMae(source, output),
    bias: rgbBias(source, output),
    alphaMae: 0,
    correlation: flatA && flatB ? 1 : flatA || flatB ? 0 : lumaCorrelation(source, output),
    compared: n,
  };
}

/** One GIF frame on a grid of its own aspect. */
export function gifFrameGrid(gif: DecodedGifFile, index: number, grid = gridFor(gif.width, gif.height)): number[] {
  const f = gif.frames[index];
  if (!f) throw new Error(`GIF has ${gif.frames.length} frames; frame ${index} does not exist`);
  return rgbaToGrid(f.rgba, gif.width, gif.height, grid);
}

// ────────────────────────────────────────────────────────────────────────────
// Audio
// ────────────────────────────────────────────────────────────────────────────

/** The audio fixtures: left 440 Hz, right 554.37 Hz (an A–C# dyad). */
export const DYAD = { left: 440, right: 554.37 } as const;

export interface ToneReport {
  duration: number;
  sampleRate: number;
  window: { from: number; to: number };
  channels: {
    rms: number;
    /** Fraction of the channel's energy at each probed frequency, 0–1. */
    purity: Record<string, number>;
  }[];
}

/**
 * Decode audio in the browser and measure, per channel, how much of the energy
 * in [from, to) sits at each of `freqs` (a Hann-windowed Goertzel, normalised
 * so a pure tone reads 1.0 and a two-tone mix reads ~0.5 each).
 *
 * This is what catches the bugs a peak/duration check cannot: a resample
 * applied twice or not at all (the tone moves off its frequency), a downmix
 * (both tones in both channels), swapped channels, or noise/distortion (energy
 * spread everywhere).
 */
export async function audioTonesInPage(
  page: Page,
  bytes: Buffer,
  freqs: number[],
  window: { from?: number; to?: number } = {},
): Promise<ToneReport> {
  return page.evaluate(
    async ({ b64, freqs, from, to }) => {
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const ac = new AudioContext();
      try {
        const audio = await ac.decodeAudioData(buf.buffer);
        const rate = audio.sampleRate;
        // Stay clear of the fixtures' fade-in/out and any codec priming.
        const f0 = from ?? 0.3;
        const f1 = Math.min(to ?? audio.duration - 0.3, audio.duration);
        const start = Math.floor(f0 * rate);
        const end = Math.floor(f1 * rate);
        const N = end - start;
        const channels: { rms: number; purity: Record<string, number> }[] = [];
        for (let c = 0; c < audio.numberOfChannels; c++) {
          const x = audio.getChannelData(c);
          let energy = 0;
          let raw = 0;
          for (let n = 0; n < N; n++) {
            const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (N - 1));
            const v = x[start + n] * w;
            energy += v * v;
            raw += x[start + n] * x[start + n];
          }
          const purity: Record<string, number> = {};
          for (const f of freqs) {
            const k = (2 * Math.PI * f) / rate;
            const coeff = 2 * Math.cos(k);
            let s1 = 0;
            let s2 = 0;
            for (let n = 0; n < N; n++) {
              const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (N - 1));
              const s0 = x[start + n] * w + coeff * s1 - s2;
              s2 = s1;
              s1 = s0;
            }
            const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
            // Hann: |X|² ≈ A²N²/16 and Σ(wx)² ≈ 3A²N/16, so 3|X|²/(N·Σ) → 1.
            purity[String(f)] = energy > 0 ? (3 * power) / (N * energy) : 0;
          }
          channels.push({ rms: N > 0 ? Math.sqrt(raw / N) : 0, purity });
        }
        return { duration: audio.duration, sampleRate: rate, window: { from: f0, to: f1 }, channels };
      } finally {
        await ac.close();
      }
    },
    { b64: bytes.toString("base64"), freqs, from: window.from ?? null, to: window.to ?? null },
  );
}

/**
 * Assert each channel carries its expected tone and none of the others.
 *
 * `expected[c]` is the frequency channel `c` should hold. Every frequency in
 * `expected` is probed on every channel, so a swap or a downmix fails here.
 * From `fidelity.spec.ts` (2026-11-11): the WAV, MP3, M4A and FLAC fixtures
 * read 0.9999+ on their own tone and <1e-6 on the other. Broken: a downmix
 * reads 0.50 / 0.50, a 44.1 kHz file labelled 48 kHz <1e-11, hard clipping
 * 0.81, peaks clipped at 60 % of their height 0.967 (which the old 0.85 floor
 * PASSED), silence fails the RMS floor,
 * and swapped channels fail on both tones.
 *
 * The 0.98 floor (raised from 0.85, where hard clipping was 0.04 under it)
 * is set off every REAL tool output that calls this with the default,
 * measured 2026-11-11 in Chromium and WebKit across audio.spec,
 * audio-formats.spec, audio-effects.spec and video.spec — 45 calls, 90 channel
 * readings, lowest 0.99966 (opus-to-mp3 and video-to-wav, whose source is
 * the WebM's single Opus tone), every other ≥0.9998. Callers that pass their
 * own `minPurity` are not covered by that measurement.
 */
export function expectTones(
  report: ToneReport,
  expected: number[],
  opts: { minPurity?: number; maxLeak?: number; minRms?: number; label?: string } = {},
): void {
  const { minPurity = 0.98, maxLeak = 0.1, minRms = 0.02, label = "output" } = opts;
  const summary = `${label} [${report.window.from.toFixed(2)}–${report.window.to.toFixed(2)}s] ${JSON.stringify(
    report.channels.map((c) => ({ rms: +c.rms.toFixed(3), ...Object.fromEntries(Object.entries(c.purity).map(([k, v]) => [k, +v.toFixed(3)])) })),
  )}`;
  expect(report.channels.length, `${summary} — channel count`).toBe(expected.length);
  const probed = [...new Set(expected)];
  expected.forEach((freq, c) => {
    const ch = report.channels[c];
    expect(ch.rms, `${summary} — channel ${c} is (near) silent`).toBeGreaterThan(minRms);
    expect(ch.purity[String(freq)], `${summary} — channel ${c} should carry ${freq} Hz`).toBeGreaterThanOrEqual(minPurity);
    for (const other of probed) {
      if (other === freq) continue;
      expect(ch.purity[String(other)], `${summary} — channel ${c} leaks ${other} Hz (swap or downmix?)`).toBeLessThanOrEqual(maxLeak);
    }
  });
}

/**
 * The stereo WAV fixture with its channels swapped (left 554 Hz, right 440 Hz).
 * Joining it after the original makes the ORDER of a merge observable — two
 * copies of one file are indistinguishable whichever way round they land.
 */
export function swapWavChannels(wav: Buffer): Buffer {
  const out = Buffer.from(wav);
  if (out.readUInt16LE(22) !== 2 || out.readUInt16LE(34) !== 16) {
    throw new Error("swapWavChannels expects 16-bit stereo PCM with a 44-byte header");
  }
  for (let at = 44; at + 4 <= out.length; at += 4) {
    const l = out.readInt16LE(at);
    out.writeInt16LE(out.readInt16LE(at + 2), at);
    out.writeInt16LE(l, at + 2);
  }
  return out;
}

/** Convenience: measure + assert the stereo dyad in one call. */
export async function expectDyad(
  page: Page,
  bytes: Buffer,
  opts: { from?: number; to?: number; label?: string; minPurity?: number } = {},
): Promise<ToneReport> {
  const report = await audioTonesInPage(page, bytes, [DYAD.left, DYAD.right], opts);
  expectTones(report, [DYAD.left, DYAD.right], opts);
  return report;
}

export interface LevelReport {
  duration: number;
  channels: number;
  /** `rms[w][c]`: RMS of channel `c` over `windows[w]`, linear full scale. */
  rms: number[][];
  windows: { from: number; to: number }[];
}

/**
 * RMS per channel over each time window — the amplitude ENVELOPE, which is
 * what a gain change, a reversal, a normalise or a silence cut actually
 * moves. A tone check over one window cannot see any of those: a reversed
 * file and its source hold the same tones, only in a different order.
 */
export async function audioLevelsInPage(
  page: Page,
  bytes: Buffer,
  windows: { from: number; to: number }[],
): Promise<LevelReport> {
  return page.evaluate(
    async ({ b64, windows }) => {
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const ac = new AudioContext();
      try {
        const audio = await ac.decodeAudioData(buf.buffer);
        const rate = audio.sampleRate;
        const rms = windows.map(({ from, to }) => {
          const a = Math.max(0, Math.floor(from * rate));
          const b = Math.min(audio.length, Math.floor(to * rate));
          const row: number[] = [];
          for (let c = 0; c < audio.numberOfChannels; c++) {
            const x = audio.getChannelData(c);
            let e = 0;
            for (let n = a; n < b; n++) e += x[n] * x[n];
            row.push(b > a ? Math.sqrt(e / (b - a)) : 0);
          }
          return row;
        });
        return { duration: audio.duration, channels: audio.numberOfChannels, rms, windows };
      } finally {
        await ac.close();
      }
    },
    { b64: bytes.toString("base64"), windows },
  );
}

export const dB = (ratio: number): number => 20 * Math.log10(ratio);

/**
 * Assert the envelope: every channel's RMS in window `w` is within `tolDb` of
 * `expected[w]`, where an expected 0 means "silent" (RMS under `silence`).
 * From `fidelity.spec.ts` on `sample-audio-gaps.wav` (2026-11-11): the
 * source reads its two tones at 0.2590 / 0.0863 (−11.7 / −21.3 dBFS) and the
 * gaps at exactly 0; reversed in time it misses by 9.5 dB in both tone
 * windows; at half gain by 6.0 dB; a slipped 0.25 s offset puts sound in a
 * silent window.
 */
export function expectLevels(
  report: LevelReport,
  expected: number[],
  opts: { tolDb?: number; silence?: number; label?: string } = {},
): void {
  const { tolDb = 1.5, silence = 0.003, label = "output" } = opts;
  const at = `${label} levels ${JSON.stringify(report.windows.map((w, i) => ({ ...w, rms: report.rms[i].map((v) => +v.toFixed(4)) })))}`;
  expect(report.rms.length, `${at} — window count`).toBe(expected.length);
  expected.forEach((want, w) => {
    report.rms[w].forEach((got, c) => {
      const where = `${at} — window ${w} (${report.windows[w].from}–${report.windows[w].to}s) channel ${c}`;
      if (want === 0) {
        expect(got, `${where} should be silent`).toBeLessThan(silence);
      } else {
        expect(got, `${where} is silent where ${want.toFixed(4)} was expected`).toBeGreaterThan(silence);
        expect(Math.abs(dB(got / want)), `${where}: ${got.toFixed(4)} vs ${want.toFixed(4)} expected`).toBeLessThanOrEqual(tolDb);
      }
    });
  });
}

// ────────────────────────────────────────────────────────────────────────────
// PDF
// ────────────────────────────────────────────────────────────────────────────

/**
 * The text each page actually renders, via pdfjs (the decoder a reader uses),
 * in page order. `assertPdf`'s `text` is the raw file bytes, which shows
 * nothing of a compressed content stream; this is the real text layer.
 */
export async function pdfPageTexts(buf: Buffer): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;
  try {
    const out: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      const content = await p.getTextContent();
      out.push(
        content.items
          .map((it) => ("str" in it ? it.str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
      );
    }
    return out;
  } finally {
    await doc.destroy();
  }
}

/**
 * Which source page each output page is, read from the "Page N" heading every
 * PDF fixture draws at the top of each page. null where a page has none.
 */
export async function pdfPageNumbers(buf: Buffer): Promise<(number | null)[]> {
  return (await pdfPageTexts(buf)).map((t) => {
    const m = t.match(/\bPage (\d+)\b/);
    return m ? Number(m[1]) : null;
  });
}

/** Assert the output's pages are exactly these source pages, in this order. */
export async function expectPdfPages(buf: Buffer, expected: number[], label = "output"): Promise<void> {
  expect(await pdfPageNumbers(buf), `${label}: which source page each output page holds`).toEqual(expected);
}

// ────────────────────────────────────────────────────────────────────────────
// PDF rasters
// ────────────────────────────────────────────────────────────────────────────

/**
 * `sample-doc.pdf` (buildPdf in scripts/generate-test-fixtures.mjs) draws a
 * filled bar on every A4 page at x=60 y=80 w=475 h=40 (PDF points, origin
 * bottom-left) in rgb(0.2+i·0.15, 0.35, 0.75−i·0.12) for page i (0-based).
 * Its colour is the page's identity in a raster, the way "Page N" is in the
 * text layer.
 */
export function fixtureBarColour(pageNumber: number): { r: number; g: number; b: number } {
  const i = pageNumber - 1;
  return { r: (0.2 + i * 0.15) * 255, g: 0.35 * 255, b: (0.75 - i * 0.12) * 255 };
}

/** The bar's interior as fractions of the page, 20 pt / 8 pt in from each edge. */
const FIXTURE_BAR = { x0: 80 / 595, x1: 515 / 595, y0: (842 - 112) / 842, y1: (842 - 88) / 842 };

/** Mean RGB over a rectangle given as fractions of the image's size. */
export async function regionMeanInPage(
  page: Page,
  image: EncodedImage,
  rect: { x0: number; x1: number; y0: number; y1: number },
): Promise<{ r: number; g: number; b: number; width: number; height: number }> {
  return page.evaluate(
    async ({ b64, type, rect }) => {
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([buf], { type }));
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bmp, 0, 0);
      const x = Math.round(rect.x0 * c.width);
      const y = Math.round(rect.y0 * c.height);
      const w = Math.max(1, Math.round((rect.x1 - rect.x0) * c.width));
      const h = Math.max(1, Math.round((rect.y1 - rect.y0) * c.height));
      const d = ctx.getImageData(x, y, w, h).data;
      const s = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) s[k] += d[i + k];
      const n = d.length / 4;
      const size = { width: bmp.width, height: bmp.height };
      bmp.close();
      return { r: s[0] / n, g: s[1] / n, b: s[2] / n, ...size };
    },
    { b64: image.bytes.toString("base64"), type: image.mime, rect },
  );
}

/**
 * Assert raster `k` is a render of fixture page `expected[k]`: its bar is that
 * page's colour within `tol` per channel, and nearer to it than to any other
 * page's. A blank, duplicated, reordered or upside-down page fails, and the
 * message says which page the image actually looks like.
 * From `fidelity.spec.ts` (2026-11-11): synthetic q0.92 JPEG renders read
 * ≤1.25 levels off their own page, and the real pdf-to-jpg / -png / -webp
 * renders ≤1.3 (Chromium and WebKit). Two fixture pages are never closer
 * than 38.25 levels on their worst channel; a blank page reads 255,255,255
 * (165.8 off the nearest page). The 12-level `tol` sits between the two.
 */
export async function expectFixturePageRasters(
  page: Page,
  images: EncodedImage[],
  expected: number[],
  opts: { tol?: number; label?: string } = {},
): Promise<{ r: number; g: number; b: number }[]> {
  const { tol = 12, label = "raster" } = opts;
  expect(images.length, `${label}: image count`).toBe(expected.length);
  const seen: { r: number; g: number; b: number }[] = [];
  for (let k = 0; k < images.length; k++) {
    const m = await regionMeanInPage(page, images[k], FIXTURE_BAR);
    const got = { r: m.r, g: m.g, b: m.b };
    seen.push(got);
    const dist = (p: number) => {
      const want = fixtureBarColour(p);
      return Math.max(Math.abs(got.r - want.r), Math.abs(got.g - want.g), Math.abs(got.b - want.b));
    };
    let looksLike = 1;
    for (let p = 2; p <= 5; p++) if (dist(p) < dist(looksLike)) looksLike = p;
    const at = `${label} ${k + 1}: bar reads ${JSON.stringify(round(got))}, page ${expected[k]} is ${JSON.stringify(round(fixtureBarColour(expected[k])))}; nearest is page ${looksLike} (${dist(looksLike).toFixed(1)} off)`;
    expect(dist(expected[k]), `${at} — not page ${expected[k]}'s render (blank, wrong page, or moved?)`).toBeLessThanOrEqual(tol);
    expect(looksLike, `${at} — closer to another page`).toBe(expected[k]);
  }
  return seen;
}

function round(o: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +v.toFixed(2)]));
}
