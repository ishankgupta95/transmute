import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import { SAMPLES, sample } from "./support";
import { animatedGif } from "../fixtures";
import {
  IMAGE_MAE,
  VIDEO_MAE,
  DYAD,
  audioLevelsInPage,
  audioTonesInPage,
  compareGifToVideo,
  compareImages,
  compareVideoToSource,
  dB,
  decodeGif,
  diffGrids,
  expectFixturePageRasters,
  expectLevels,
  expectPdfPages,
  expectSameImage,
  expectTones,
  expectVideoMatches,
  fixtureBarColour,
  gifFrameGrid,
  imageGridInPage,
  pdfPageNumbers,
  videoFramesInPage,
} from "./fidelity";

/**
 * Self-test for `fidelity.ts`: every content check must PASS on a faithful
 * output and FAIL on a deliberately broken one.
 *
 * This file is the reason the thresholds in `fidelity.ts` can be trusted. A
 * check that passes everything is worse than no check — it reports green over
 * the exact bug it was written for. So each helper is run against:
 *
 *   - positive controls: the source itself, and legitimate re-encodes, which
 *     must stay UNDER the threshold (the check is not too tight to use), and
 *   - negative controls: the broken outputs users actually get — flipped,
 *     rotated, colour-swapped, black, wrong frame, wrong pitch, downmixed,
 *     swapped channels, wrong page — which must land OVER it.
 *
 * Measured values are attached to each test as annotations, so a threshold
 * change can be justified from the run report rather than from memory.
 */

async function mustFail(what: string, fn: () => unknown | Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    return (err as Error).message.split("\n")[0];
  }
  throw new Error(`content check PASSED a broken output: ${what}`);
}

function note(name: string, value: unknown): void {
  test.info().annotations.push({ type: name, description: JSON.stringify(value) });
}

/** Re-draw an encoded image through a canvas transform; returns new bytes. */
async function variant(
  page: Page,
  bytes: Buffer,
  mime: string,
  op: "flipH" | "rot90" | "swapRB" | "black" | "shiftHue" | "resize400" | "jpeg30" | "png" | "offset",
): Promise<{ bytes: Buffer; mime: string }> {
  const out = await page.evaluate(
    async ({ b64, type, op }) => {
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([buf], { type }));
      const rot = op === "rot90";
      const w = op === "resize400" ? 400 : rot ? bmp.height : bmp.width;
      const h = op === "resize400" ? Math.round((400 * bmp.height) / bmp.width) : rot ? bmp.width : bmp.height;
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      if (op === "flipH") { ctx.translate(w, 0); ctx.scale(-1, 1); }
      if (rot) { ctx.translate(w, 0); ctx.rotate(Math.PI / 2); }
      if (op === "black") { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h); }
      else if (op === "offset") ctx.drawImage(bmp, 40, 30);
      else ctx.drawImage(bmp, 0, 0, rot ? h : w, rot ? w : h);
      if (op === "swapRB" || op === "shiftHue") {
        const d = ctx.getImageData(0, 0, w, h);
        for (let i = 0; i < d.data.length; i += 4) {
          if (op === "swapRB") {
            const r = d.data[i];
            d.data[i] = d.data[i + 2];
            d.data[i + 2] = r;
          } else {
            // A mild cast, the size of a wrong colour matrix (BT.601 vs 709).
            d.data[i] = Math.min(255, d.data[i] + 18);
            d.data[i + 2] = Math.max(0, d.data[i + 2] - 18);
          }
        }
        ctx.putImageData(d, 0, 0);
      }
      const outType = op === "png" ? "image/png" : "image/jpeg";
      const q = op === "jpeg30" ? 0.3 : 0.92;
      const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), outType, q));
      const ab = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < ab.length; i += 0x8000) s += String.fromCharCode(...ab.subarray(i, i + 0x8000));
      return { b64: btoa(s), mime: outType };
    },
    { b64: bytes.toString("base64"), type: mime, op },
  );
  return { bytes: Buffer.from(out.b64, "base64"), mime: out.mime };
}

/** A copy of a 16-bit PCM WAV with its samples rewritten frame by frame. */
function rewriteWav(
  wav: Buffer,
  edit: (frame: number[]) => number[],
  header: { sampleRate?: number } = {},
): Buffer {
  const out = Buffer.from(wav);
  const channels = out.readUInt16LE(22);
  const dataStart = 44;
  const frames = (out.length - dataStart) / (2 * channels);
  for (let i = 0; i < frames; i++) {
    const at = dataStart + i * channels * 2;
    const frame = Array.from({ length: channels }, (_, c) => out.readInt16LE(at + c * 2));
    edit(frame).forEach((v, c) => out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v))), at + c * 2));
  }
  if (header.sampleRate) {
    out.writeUInt32LE(header.sampleRate, 24);
    out.writeUInt32LE(header.sampleRate * channels * 2, 28);
  }
  return out;
}

/**
 * Encode RGB grids as an animated GIF in Node with gifenc — the encoder and
 * the rgb444 quantiser the app's own video-to-gif uses, so a positive control
 * carries the same palette loss a real output does.
 */
function encodeGif(
  frames: { rgb: number[]; delayMs: number }[],
  width: number,
  height: number,
  edit: (rgba: Uint8Array) => void = () => {},
): Buffer {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GIFEncoder, quantize, applyPalette } = require("gifenc") as typeof import("gifenc");
  const gif = GIFEncoder();
  frames.forEach((f, i) => {
    const rgba = new Uint8Array(width * height * 4);
    for (let p = 0; p < width * height; p++) {
      rgba[p * 4] = f.rgb[p * 3];
      rgba[p * 4 + 1] = f.rgb[p * 3 + 1];
      rgba[p * 4 + 2] = f.rgb[p * 3 + 2];
      rgba[p * 4 + 3] = 255;
    }
    edit(rgba);
    const palette = quantize(rgba, 256, { format: "rgb444" });
    gif.writeFrame(applyPalette(rgba, palette, "rgb444"), width, height, {
      palette,
      delay: f.delayMs,
      dispose: 2,
      ...(i === 0 ? { first: true, repeat: 0 } : {}),
    });
  });
  gif.finish();
  return Buffer.from(gif.bytes());
}

/** A 16-bit PCM WAV with its frames re-ordered: `pick(i, n)` is the source frame for output frame i. */
function reorderWav(wav: Buffer, pick: (i: number, n: number) => number): Buffer {
  const out = Buffer.from(wav);
  const block = wav.readUInt16LE(22) * 2;
  const n = (wav.length - 44) / block;
  for (let i = 0; i < n; i++) wav.copy(out, 44 + i * block, 44 + pick(i, n) * block, 44 + (pick(i, n) + 1) * block);
  return out;
}

/** A synthetic render of fixture page `p` — white A4 with its bar — or a broken one. */
async function fakePageRaster(
  page: Page,
  p: number,
  how: "faithful" | "blank" | "upsideDown" = "faithful",
): Promise<{ bytes: Buffer; mime: string }> {
  const c = fixtureBarColour(p);
  const b64 = await page.evaluate(
    async ({ c, how }) => {
      const k = 1.5; // pdf-to-jpg renders above 72 dpi; any scale must work
      const cv = document.createElement("canvas");
      cv.width = Math.round(595 * k);
      cv.height = Math.round(842 * k);
      const ctx = cv.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, cv.width, cv.height);
      if (how !== "blank") {
        ctx.fillStyle = `rgb(${c.r}, ${c.g}, ${c.b})`;
        // PDF y=80 from the bottom is 722 from the top; upside down it is 80.
        ctx.fillRect(60 * k, (how === "upsideDown" ? 80 : 722) * k, 475 * k, 40 * k);
      }
      const blob = await new Promise<Blob>((r) => cv.toBlob((b) => r(b!), "image/jpeg", 0.92));
      const ab = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < ab.length; i += 0x8000) s += String.fromCharCode(...ab.subarray(i, i + 0x8000));
      return btoa(s);
    },
    { c, how },
  );
  return { bytes: Buffer.from(b64, "base64"), mime: "image/jpeg" };
}

test.describe("content checks catch broken output", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("image comparison passes faithful re-encodes and fails broken pictures", async ({ page }) => {
    const jpg = await SAMPLES.jpg();
    const src = { bytes: jpg.buffer, mime: jpg.mimeType };

    const self = await compareImages(page, src, src);
    const png = await compareImages(page, src, await variant(page, jpg.buffer, jpg.mimeType, "png"));
    const resized = await compareImages(page, src, await variant(page, jpg.buffer, jpg.mimeType, "resize400"));
    const heavy = await compareImages(page, src, await variant(page, jpg.buffer, jpg.mimeType, "jpeg30"));
    note("positive mae/corr", {
      self: [self.mae, self.correlation],
      png: [png.mae, png.correlation],
      resized: [resized.mae, resized.correlation],
      heavy: [heavy.mae, heavy.correlation],
    });
    expectSameImage(self, { maxMae: IMAGE_MAE.lossless, label: "source vs itself" });
    expectSameImage(png, { maxMae: IMAGE_MAE.lossless, label: "lossless PNG copy" });
    expectSameImage(resized, { label: "400 px resize" });
    expectSameImage(heavy, { maxMae: IMAGE_MAE.heavy, label: "q0.3 JPEG" });
    expect(resized.output).toEqual({ width: 400, height: 300 });

    const broken: Record<string, string> = {};
    for (const op of ["flipH", "swapRB", "black", "shiftHue", "offset"] as const) {
      const diff = await compareImages(page, src, await variant(page, jpg.buffer, jpg.mimeType, op));
      broken[op] = await mustFail(op, () => expectSameImage(diff, { maxMae: IMAGE_MAE.heavy, label: op }));
      note(`negative ${op}`, { mae: diff.mae, corr: diff.correlation, bias: diff.bias });
    }
    // A 90° turn is only a fault when it was not asked for. Asked for, it
    // must pass — that is what the rotate tools' tests lean on.
    const rotated = await variant(page, jpg.buffer, jpg.mimeType, "rot90");
    const unasked = await compareImages(page, src, rotated);
    broken.rot90 = await mustFail("rot90", () => expectSameImage(unasked, { maxMae: IMAGE_MAE.heavy }));
    expectSameImage(await compareImages(page, src, rotated, { transform: "rot90" }), {
      label: "rotation that was asked for",
    });
    note("negative messages", broken);
  });

  test("video comparison passes the source and fails the wrong frame or orientation", async ({ page }) => {
    const mp4 = await SAMPLES.mp4();
    const webm = await SAMPLES.webm();
    const src = { bytes: mp4.buffer, mime: mp4.mimeType };
    const times = [0.25, 0.75, 1.25, 1.7];

    const self = await compareVideoToSource(page, src, src, { outTimes: times });
    note("self mae/corr", self.matches.map((m) => [m.mae, m.correlation]));
    expectVideoMatches(self.matches, { maxMae: VIDEO_MAE.copy, label: "source vs itself" });
    // Decoded frames must be real pictures, not a uniform fill: the fixture's
    // moving block and stripes spread the grid's values widely.
    for (const f of self.output.frames) {
      const lo = Math.min(...f.rgb);
      const hi = Math.max(...f.rgb);
      expect(hi - lo, `frame @${f.t}s decoded to a flat fill`).toBeGreaterThan(100);
    }

    // VP8 via MediaRecorder, drawn from the same frames: a different codec and
    // a realtime capture, so a fair stand-in for a lossy re-encode.
    const crossCodec = await compareVideoToSource(page, src, { bytes: webm.buffer, mime: webm.mimeType }, {
      outTimes: times,
      slackFrames: 4,
    });
    note("cross-codec mae/corr/bias", crossCodec.matches.map((m) => [m.mae, m.correlation, m.bias]));
    expectVideoMatches(crossCodec.matches, { label: "VP8 capture of the same frames" });

    const shifted = await compareVideoToSource(page, src, src, { outTimes: times, map: (t) => (t + 0.6) % 2 });
    note("0.6 s off mae/corr", shifted.matches.map((m) => [m.mae, m.correlation]));
    const frozen = await compareVideoToSource(page, src, src, { outTimes: times.slice(1), map: () => 0.1 });
    note("frozen-frame mae/corr", frozen.matches.map((m) => [m.mae, m.correlation]));
    const turned = await compareVideoToSource(page, src, src, { outTimes: times, transform: "rot180" });
    note("rot180 mae/corr", turned.matches.map((m) => [m.mae, m.correlation]));
    note("negative messages", {
      shifted: await mustFail("frames 0.6 s off", () => expectVideoMatches(shifted.matches)),
      frozen: await mustFail("one frame repeated", () => expectVideoMatches(frozen.matches)),
      turned: await mustFail("upside down", () => expectVideoMatches(turned.matches)),
    });
  });

  test("tone check passes faithful audio and fails pitch, downmix, swap and silence", async ({ page }) => {
    const wav = await SAMPLES.wav();
    const freqs = [DYAD.left, DYAD.right];
    const positives: Record<string, unknown> = {};
    // NOT sample-audio.opus: it is a stream copy of the WebM's track, which
    // MediaRecorder captured from a single 440 Hz oscillator — 440 Hz in both
    // channels, measured. It cannot carry the dyad.
    for (const f of [wav, await SAMPLES.mp3(), await SAMPLES.m4a(), await sample("sample-audio.flac", "audio/flac")]) {
      const r = await audioTonesInPage(page, f.buffer, freqs);
      positives[f.name] = r.channels.map((c) => c.purity);
      expectTones(r, freqs, { label: f.name });
    }
    note("positive purity", positives);

    // Six channels, six tones: every channel must be told apart.
    const six = [220, 277, 330, 110, 440, 554];
    expectTones(await audioTonesInPage(page, (await SAMPLES.wav6ch()).buffer, six), six, { label: "6ch" });

    const report = async (buf: Buffer) => audioTonesInPage(page, buf, freqs);
    const swapped = await report(rewriteWav(wav.buffer, ([l, r]) => [r, l]));
    const downmixed = await report(rewriteWav(wav.buffer, ([l, r]) => [(l + r) / 2, (l + r) / 2]));
    const silent = await report(rewriteWav(wav.buffer, () => [0, 0]));
    // The resample bug: 44.1 kHz samples played as 48 kHz — 8.8 % sharp.
    const sharp = await report(rewriteWav(wav.buffer, (f) => f, { sampleRate: 48000 }));
    const clipped = await report(rewriteWav(wav.buffer, (f) => f.map((v) => Math.sign(v) * 32767)));
    // A milder fault the old 0.85 floor let through: peaks shaved at 60 % read 0.967. (At 80 % they read 0.992 — too mild to separate from a real lossy encode.)
    let peak = 0;
    rewriteWav(wav.buffer, (f) => { for (const v of f) peak = Math.max(peak, Math.abs(v)); return f; });
    const mildClip = await report(rewriteWav(wav.buffer, (f) => f.map((v) => Math.max(-0.6 * peak, Math.min(0.6 * peak, v)))));
    note("negative purity", {
      swapped: swapped.channels.map((c) => c.purity),
      downmixed: downmixed.channels.map((c) => c.purity),
      sharp: sharp.channels.map((c) => c.purity),
      clipped: clipped.channels.map((c) => c.purity),
      mildClip: mildClip.channels.map((c) => c.purity),
    });
    note("negative messages", {
      swapped: await mustFail("swapped channels", () => expectTones(swapped, freqs)),
      downmixed: await mustFail("downmix", () => expectTones(downmixed, freqs)),
      silent: await mustFail("silence", () => expectTones(silent, freqs)),
      sharp: await mustFail("wrong sample rate", () => expectTones(sharp, freqs)),
      clipped: await mustFail("hard clipping", () => expectTones(clipped, freqs)),
      mildClip: await mustFail("peaks clipped at 60 %", () => expectTones(mildClip, freqs)),
    });
  });

  test("animation frames: decoded in Node, matched to the source clip, and fail a wrong frame or colours", async ({ page }) => {
    // The two-frame fixture: solid (220,40,40) then (40,90,220), 200 ms each.
    const two = await decodeGif(animatedGif().buffer);
    expect(two.frames.map((f) => [f.startMs, f.delayMs])).toEqual([[0, 200], [200, 200]]);
    const flat = (rgb: [number, number, number], cells = 16 * 16) =>
      Array.from({ length: cells }, () => rgb).flat();
    const red = diffGrids(flat([220, 40, 40]), gifFrameGrid(two, 0, { width: 16, height: 16 }), { width: 16, height: 16 });
    const blue = diffGrids(flat([40, 90, 220]), gifFrameGrid(two, 1, { width: 16, height: 16 }), { width: 16, height: 16 });
    note("two-frame fixture mae", { red: red.mae, blue: blue.mae });
    expectSameImage(red, { maxMae: IMAGE_MAE.lossless * 2, label: "frame 0 is red" });
    expectSameImage(blue, { maxMae: IMAGE_MAE.lossless * 2, label: "frame 1 is blue" });
    const swapped = diffGrids(flat([220, 40, 40]), gifFrameGrid(two, 1, { width: 16, height: 16 }), { width: 16, height: 16 });

    // Noise frames: structure, so correlation means something. Frame 0 drawn
    // through the BROWSER (PNG, and a q0.92 JPEG) must match frame 0 decoded
    // in Node — the two resamplers are different code — and not frame 1.
    const noisy = await decodeGif(animatedGif(256, 256, { noise: true }).buffer);
    const g32 = { width: 32, height: 32 };
    const asImage = async (rgba: Uint8Array, type: string) => {
      const b64 = await page.evaluate(
        async ({ px, type }) => {
          const cv = document.createElement("canvas");
          cv.width = 256;
          cv.height = 256;
          const ctx = cv.getContext("2d")!;
          ctx.putImageData(new ImageData(new Uint8ClampedArray(px), 256, 256), 0, 0);
          const blob = await new Promise<Blob>((r) => cv.toBlob((b) => r(b!), type, 0.92));
          const ab = new Uint8Array(await blob.arrayBuffer());
          let s = "";
          for (let i = 0; i < ab.length; i += 0x8000) s += String.fromCharCode(...ab.subarray(i, i + 0x8000));
          return btoa(s);
        },
        { px: Array.from(rgba), type },
      );
      return { bytes: Buffer.from(b64, "base64"), mime: type };
    };
    const png0 = await imageGridInPage(page, await asImage(noisy.frames[0].rgba, "image/png"), g32);
    const jpg0 = await imageGridInPage(page, await asImage(noisy.frames[0].rgba, "image/jpeg"), g32);
    const node0 = gifFrameGrid(noisy, 0, g32);
    const node1 = gifFrameGrid(noisy, 1, g32);
    const pngVs0 = diffGrids(node0, png0.rgb, g32);
    const jpgVs0 = diffGrids(node0, jpg0.rgb, g32);
    const jpgVs1 = diffGrids(node1, jpg0.rgb, g32);
    note("noise frame 0 browser-vs-node mae/corr", {
      png: [pngVs0.mae, pngVs0.correlation],
      jpeg: [jpgVs0.mae, jpgVs0.correlation],
      jpegVsFrame1: [jpgVs1.mae, jpgVs1.correlation],
    });
    expectSameImage(pngVs0, { maxMae: IMAGE_MAE.lossy, label: "PNG of frame 0" });
    expectSameImage(jpgVs0, { maxMae: IMAGE_MAE.lossy, label: "JPEG of frame 0" });

    // A 10 fps animation built from the source clip's own frames.
    const mp4 = await SAMPLES.mp4();
    const src = { bytes: mp4.buffer, mime: mp4.mimeType };
    const times = Array.from({ length: 19 }, (_, i) => i * 0.1);
    const W = 160;
    const H = 120;
    const shot = await videoFramesInPage(page, mp4.buffer, mp4.mimeType, times, { width: W, height: H });
    const frames = shot.frames.map((f) => ({ rgb: f.rgb, delayMs: 100 }));
    const faithful = await compareGifToVideo(page, src, encodeGif(frames, W, H));
    note("faithful mae/corr", faithful.matches.map((m) => [m.outT, m.mae, m.correlation]));
    expectVideoMatches(faithful.matches, { label: "animation of the source frames" });

    const reversed = await compareGifToVideo(page, src, encodeGif([...frames].reverse(), W, H));
    const rbSwap = await compareGifToVideo(page, src, encodeGif(frames, W, H, (px) => {
      for (let i = 0; i < px.length; i += 4) [px[i], px[i + 2]] = [px[i + 2], px[i]];
    }));
    // Right pictures, wrong timing: delays that say 50 ms over frames 100 ms
    // apart put every later frame at half its real time.
    const fast = await compareGifToVideo(page, src, encodeGif(frames.map((f) => ({ ...f, delayMs: 50 })), W, H));
    note("negative mae/corr", {
      reversed: reversed.matches.map((m) => [m.mae, m.correlation, m.closest?.srcT]),
      rbSwap: rbSwap.matches.map((m) => [m.mae, m.correlation, m.bias]),
      fast: fast.matches.map((m) => [m.mae, m.correlation, m.closest?.srcT]),
    });
    note("negative messages", {
      swappedFrame: await mustFail("frame 1 where frame 0 should be", () => expectSameImage(swapped, { maxMae: IMAGE_MAE.lossy })),
      noiseFrame1: await mustFail("noise frame 1 for frame 0", () => expectSameImage(jpgVs1, { maxMae: IMAGE_MAE.lossy })),
      reversed: await mustFail("frames reversed", () => expectVideoMatches(reversed.matches)),
      rbSwap: await mustFail("red/blue swapped", () => expectVideoMatches(rbSwap.matches)),
      fast: await mustFail("delays half the real gap", () => expectVideoMatches(fast.matches)),
    });
  });

  test("level check reads the envelope and fails a reversal, a gain error and a shift", async ({ page }) => {
    const gaps = (await sample("sample-audio-gaps.wav", "audio/wav")).buffer;
    // Inside each span of 1 s silence / 1 s loud / 1.5 s silence / 1 s quiet / 1 s silence.
    const windows = [
      { from: 0.1, to: 0.9 },
      { from: 1.1, to: 1.9 },
      { from: 2.6, to: 3.4 },
      { from: 3.6, to: 4.4 },
      { from: 4.6, to: 5.4 },
    ];
    const LOUD = 12000 / 32768 / Math.SQRT2;
    const QUIET = 4000 / 32768 / Math.SQRT2;
    const want = [0, LOUD, 0, QUIET, 0];
    const self = await audioLevelsInPage(page, gaps, windows);
    note("source rms", self.rms);
    expectLevels(self, want, { label: "source" });
    // And the same file reversed must pass the REVERSED expectation.
    const reversed = await audioLevelsInPage(page, reorderWav(gaps, (i, n) => n - 1 - i), windows);
    expectLevels(reversed, [0, QUIET, 0, LOUD, 0], { label: "reversed vs reversed expectation" });

    const half = await audioLevelsInPage(page, rewriteWav(gaps, (f) => f.map((v) => v / 2)), windows);
    const shifted = await audioLevelsInPage(page, reorderWav(gaps, (i, n) => (i + Math.round(0.25 * 44100)) % n), windows);
    note("negative rms", { reversed: reversed.rms, half: half.rms, shifted: shifted.rms });
    note("negative dB off", {
      reversedLoudWindow: dB(reversed.rms[1][0] / LOUD),
      reversedQuietWindow: dB(reversed.rms[3][0] / QUIET),
      half: dB(half.rms[1][0] / LOUD),
    });
    note("negative messages", {
      reversed: await mustFail("reversed in time", () => expectLevels(reversed, want)),
      half: await mustFail("−6 dB gain error", () => expectLevels(half, want)),
      shifted: await mustFail("0.25 s offset", () => expectLevels(shifted, want)),
    });
  });

  test("raster page check reads each page's bar and fails a blank, repeated, reordered or upside-down page", async ({ page }) => {
    const pages = [1, 2, 3, 4, 5];
    const good: { bytes: Buffer; mime: string }[] = [];
    for (const p of pages) good.push(await fakePageRaster(page, p));
    const seen = await expectFixturePageRasters(page, good, pages, { label: "synthetic render" });
    note("faithful bar colours", seen.map((c, i) => {
      const w = fixtureBarColour(i + 1);
      return Math.max(Math.abs(c.r - w.r), Math.abs(c.g - w.g), Math.abs(c.b - w.b));
    }));
    let nearestWrong = Infinity;
    for (const a of pages) for (const b of pages) if (a !== b) {
      const x = fixtureBarColour(a);
      const y = fixtureBarColour(b);
      nearestWrong = Math.min(nearestWrong, Math.max(Math.abs(x.r - y.r), Math.abs(x.g - y.g), Math.abs(x.b - y.b)));
    }
    note("closest wrong page (levels)", nearestWrong);
    const blank = [...good];
    blank[2] = await fakePageRaster(page, 3, "blank");
    const flipped = [...good];
    flipped[1] = await fakePageRaster(page, 2, "upsideDown");
    note("negative messages", {
      reordered: await mustFail("pages 1 and 2 swapped", () => expectFixturePageRasters(page, [good[1], good[0], ...good.slice(2)], pages)),
      repeated: await mustFail("page 1 twice", () => expectFixturePageRasters(page, [good[0], good[0], ...good.slice(2)], pages)),
      blank: await mustFail("page 3 blank", () => expectFixturePageRasters(page, blank, pages)),
      flipped: await mustFail("page 2 upside down", () => expectFixturePageRasters(page, flipped, pages)),
      missing: await mustFail("only four pages", () => expectFixturePageRasters(page, good.slice(0, 4), pages)),
    });
  });

  test("page identity check reads every page and fails a wrong or reordered page", async () => {
    const pdf = await SAMPLES.pdf();
    await expectPdfPages(pdf.buffer, [1, 2, 3, 4, 5], "5-page fixture");
    expect(await pdfPageNumbers((await SAMPLES.pdf60()).buffer)).toEqual(
      Array.from({ length: 60 }, (_, i) => i + 1),
    );

    const { PDFDocument } = await import("pdf-lib");
    const srcDoc = await PDFDocument.load(pdf.buffer);
    const reordered = await PDFDocument.create();
    for (const p of await reordered.copyPages(srcDoc, [1, 0, 2, 3, 4])) reordered.addPage(p);
    const swapped = Buffer.from(await reordered.save());
    await expectPdfPages(swapped, [2, 1, 3, 4, 5], "reordered copy");
    note("negative messages", {
      reordered: await mustFail("reordered pages", () => expectPdfPages(swapped, [1, 2, 3, 4, 5])),
    });
  });
});
