/// <reference lib="webworker" />
import Pica from "pica";
// LEAF imports — image-frames.ts, target-size.ts and image-edit-core.ts have
// zero runtime imports, so they cannot drag a module that names this worker's
// URL into the bundle (which hangs next build). png-optimise.ts imports only
// the oxipng glue from node_modules, which names no worker either.
import { firstFrameWarning } from "@/lib/tools/image-frames";
import {
  canvasCeilingWarning,
  drawEdit,
  editOutputPlan,
  isMultiOutputEdit,
  needsOpaqueFill,
} from "@/lib/tools/image-edit-core";
import {
  alreadyOptimalNote,
  deinterlacedNote,
  describePngColour,
  NOT_A_PNG_MESSAGE,
  optimisePngBytes,
  readPngHeader,
} from "@/lib/tools/png-optimise";
import {
  MAX_DIMENSION_STEPS,
  nextScale,
  scaledToTargetWarning,
  stepDimensions,
} from "@/lib/tools/target-size";
import type { PoolWorkerRequest, PoolWorkerResponse } from "./pool";
import type {
  ImageEditJobOptions,
  ImageJob,
  ImageJobResult,
  PngOptimiseOptions,
} from "./image-protocol";
import type { ImageCompressOptions } from "@/lib/tools/image-compress";
import type { ImageConvertOptions } from "@/lib/tools/image-convert";
import type { ImageResizeOptions } from "@/lib/tools/image-resize";

/**
 * Pool worker for the image pipeline: decode (createImageBitmap), draw
 * (OffscreenCanvas), encode (convertToBlob) — the whole pixel path off the
 * main thread. One file per task; parallelism is the pool's job.
 *
 * The ops mirror lib/tools/image-convert|compress|resize.ts, which remain the
 * main-thread fallback for browsers without OffscreenCanvas and for sources a
 * worker cannot decode (SVG needs the DOM's <img>; HEIC/TIFF are pre-decoded
 * on main and arrive here as an ImageBitmap). Behavioural changes must land
 * in BOTH places — the conversion e2e suite runs against whichever path the
 * browser takes.
 *
 * Two later ops do NOT have that problem, on purpose:
 *  - `edit` (the eight verbs) keeps every pixel decision in the shared leaf
 *    lib/tools/image-edit-core.ts, so its mirror in lib/tools/image-edit.ts is
 *    a canvas wrapper with no arithmetic of its own to drift.
 *  - `optimise-png` has no mirror at all. There is no main-thread PNG
 *    compressor to fall back to — a canvas re-encode is precisely the no-op
 *    that tool exists to replace — so image-client.ts refuses the job instead.
 */

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (event: MessageEvent<PoolWorkerRequest>) => {
  const { id, payload } = event.data;
  const job = payload as ImageJob;
  const progress = (value: number) =>
    self.postMessage({ id, type: "progress", value } satisfies PoolWorkerResponse);

  try {
    const result = await runJob(job, progress);
    // Every output buffer must be named here. A multi-output edit that omits
    // its items would be silently CLONED rather than moved — N copies of N
    // tiles — which is the same branch pdf.worker.ts:60-81 spells out for
    // splitPdfToPages. Each convertToBlob → arrayBuffer() allocates its own
    // buffer, so the list can never name the same ArrayBuffer twice (which
    // postMessage rejects).
    const transfer: ArrayBuffer[] =
      result.kind === "blob" || result.kind === "png"
        ? [result.bytes]
        : result.kind === "blobs"
          ? result.items.map((item) => item.bytes)
          : [];
    self.postMessage(
      { id, type: "done", result } satisfies PoolWorkerResponse,
      transfer,
    );
  } catch (err) {
    self.postMessage({
      id,
      type: "error",
      message: err instanceof Error ? err.message : "Image processing failed",
    } satisfies PoolWorkerResponse);
  }
};

async function runJob(
  job: ImageJob,
  progress: (value: number) => void,
): Promise<ImageJobResult> {
  // optimise-png never decodes. oxipng works on the ENCODED PNG, so turning
  // the file into pixels first would add a full RGBA raster to a job whose
  // whole constraint is wasm memory — and would throw away the very bytes the
  // codec is meant to rewrite.
  if (job.op === "optimise-png") return optimisePng(job, job.options, progress);

  // Sniff the encoded bytes BEFORE decoding: createImageBitmap silently keeps
  // only frame 0 of an animated GIF/WebP, so the honest "first frame was kept"
  // notice can only come from the container. (Pre-decoded TIFF/HEIC arrive as
  // an ImageBitmap; their warnings are attached on the main thread.)
  const warning = job.bytes ? firstFrameWarning(new Uint8Array(job.bytes)) : null;
  const bitmap = await decodeBitmap(job);
  progress(10);
  try {
    let result: ImageJobResult;
    switch (job.op) {
      case "convert":
        result = await convert(bitmap, job.options);
        break;
      case "compress":
        result = await compress(bitmap, job, job.options, progress);
        break;
      case "resize":
        result = await resize(bitmap, job, job.options, progress);
        break;
      case "edit":
        result = await edit(bitmap, job.options, progress);
        break;
    }
    // Merge, don't overwrite — the op itself may have added its own notices
    // (target-size compress appends "Scaled to …" when it downscaled). Loss
    // warnings attach only to re-encoded outputs: never-grow's kind:"original"
    // hands back the untouched file with every frame still in it, so "only
    // its first frame was kept" would be false there. A multi-output edit is
    // re-encoded too, so "blobs" belongs in the same branch as "blob".
    return warning && (result.kind === "blob" || result.kind === "blobs")
      ? { ...result, warnings: [warning, ...(result.warnings ?? [])] }
      : result;
  } finally {
    bitmap.close();
  }
}

/**
 * Decode the source into pixels. Pre-decoded sources (HEIC/TIFF) arrive as a
 * transferred ImageBitmap; everything else is decoded here, honouring EXIF
 * orientation — the same behaviour the main thread's <img> decode has, pinned
 * by the rotated-JPEG e2e. Older engines without the `imageOrientation`
 * option get a plain decode retry.
 */
async function decodeBitmap(job: ImageJob): Promise<ImageBitmap> {
  if (job.bitmap) return job.bitmap;
  const blob = new Blob([job.bytes!], { type: job.fileType });
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    return await createImageBitmap(blob);
  }
}

// ── shared canvas helpers (worker-side ports of canvas-utils.ts) ──

/** Only PNG and WebP carry an alpha channel through canvas encoding. */
function mimeSupportsAlpha(mimeType: string): boolean {
  return mimeType === "image/png" || mimeType === "image/webp";
}

function draw(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  opaqueFill: boolean,
): OffscreenCanvas {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");
  if (opaqueFill) {
    // Alpha-less formats flatten transparency to black without this.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

function toArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
}

/** The file extension each encodable type is saved under. */
const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * What the encoder ACTUALLY wrote, which is not always what it was asked for.
 *
 * Per the HTML spec a canvas asked for a type it cannot encode falls back to
 * PNG rather than failing (the trap image-convert.ts:5-9 records), and the
 * Blob it hands back reports the type it really produced. WebKit is the live
 * case for WebP: `convertToBlob({type:"image/webp"})` there returns
 * `image/png`, so a result labelled from the REQUEST would put PNG bytes under
 * a `.webp` name — which is exactly what shipped before this existed.
 *
 * So every op names its output from this. The two callers then differ, on
 * purpose: convert's format is the user's choice and image-client.ts turns a
 * mismatch into a refusal, while compress and resize CHOSE the format
 * themselves (alpha-safe defaults) and simply follow the encoder — the same
 * split video-frames.ts:381-397 already makes for frame export.
 *
 * An empty `blob.type` (no encoder opinion) leaves the request standing.
 */
function writtenFormat(blob: Blob, requested: string): { mime: string; ext: string } {
  if (!blob.type || blob.type === requested) {
    return { mime: requested, ext: EXT_BY_MIME[requested] ?? requested.replace("image/", "") };
  }
  return {
    mime: blob.type,
    ext: EXT_BY_MIME[blob.type] ?? blob.type.replace("image/", ""),
  };
}

/** Port of imageHasTransparency: probe a ≤256px raster for any alpha < 255. */
function bitmapHasTransparency(bitmap: ImageBitmap): boolean {
  const { width: w, height: h } = bitmap;
  if (!w || !h) return false;
  const scale = Math.min(1, 256 / Math.max(w, h));
  const pw = Math.max(1, Math.round(w * scale));
  const ph = Math.max(1, Math.round(h * scale));
  const canvas = new OffscreenCanvas(pw, ph);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(bitmap, 0, 0, pw, ph);
  try {
    const { data } = ctx.getImageData(0, 0, pw, ph);
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true;
    }
  } catch {
    return false;
  }
  return false;
}

// ── convert (mirrors lib/tools/image-convert.ts) ─────────────────

async function convert(
  bitmap: ImageBitmap,
  options: ImageConvertOptions,
): Promise<ImageJobResult> {
  const mime = `image/${options.targetFormat}`;
  const outWidth = options.width ?? bitmap.width;
  const outHeight = options.height ?? bitmap.height;
  if (outWidth === 0 || outHeight === 0) {
    throw new Error("Could not determine the image's dimensions");
  }

  const canvas = draw(bitmap, outWidth, outHeight, !mimeSupportsAlpha(mime));
  const blob = await canvas.convertToBlob({ type: mime, quality: options.quality });
  // Reported, not assumed: the encoder may have substituted PNG. convertImage
  // in image-client.ts compares this against what was asked for and refuses,
  // because on this op the format is the user's choice — encodeBitmap's caller
  // (pdf-engine.ts) sniffs the bytes itself and needs the blob, not a throw.
  const written = writtenFormat(blob, mime);
  return {
    kind: "blob",
    bytes: await toArrayBuffer(blob),
    mime: written.mime,
    ext: written.ext,
    width: outWidth,
    height: outHeight,
  };
}

// ── compress (mirrors lib/tools/image-compress.ts) ───────────────

/** Choose an output format that compresses well *and* preserves transparency. */
function chooseOutput(job: ImageJob, bitmap: ImageBitmap): { mime: string; ext: string } {
  const ext = job.fileName.split(".").pop()?.toLowerCase() ?? "";
  const mightHaveAlpha =
    ["png", "webp", "gif", "avif"].includes(ext) || /(png|webp|gif|avif)/.test(job.fileType);
  if (mightHaveAlpha && bitmapHasTransparency(bitmap)) {
    return { mime: "image/webp", ext: "webp" };
  }
  return { mime: "image/jpeg", ext: "jpg" };
}

/**
 * The quality half of the target-size engine: binary-search encode quality
 * for the largest result at or under `targetBytes`. Returns that under-target
 * blob (null when quality alone cannot get there) plus the smallest blob
 * seen, which drives the dimension step and is the honest fallback when
 * nothing fits. Mirrored in lib/tools/image-compress.ts.
 */
async function searchQuality(
  encode: (quality: number) => Promise<Blob>,
  targetBytes: number,
  tick: () => void,
): Promise<{ under: Blob | null; smallest: Blob }> {
  let lo = 0.01;
  let hi = 1.0;
  let smallest = await encode(hi);
  tick();
  if (smallest.size <= targetBytes) return { under: smallest, smallest };

  let under: Blob | null = null;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    const candidate = await encode(mid);
    tick();
    if (candidate.size < smallest.size) smallest = candidate;
    if (candidate.size <= targetBytes) {
      under = candidate;
      lo = mid;
      // Close enough (within 5% of target) — stop refining.
      if (candidate.size > targetBytes * 0.95) break;
    } else {
      hi = mid;
    }
  }
  return { under, smallest };
}

async function compress(
  bitmap: ImageBitmap,
  job: ImageJob,
  options: ImageCompressOptions,
  progress: (value: number) => void,
): Promise<ImageJobResult> {
  // Only the mime is taken from the choice: the extension comes from what the
  // encoder wrote, in `finish` below.
  const { mime } = chooseOutput(job, bitmap);
  // The pixels never change between encode passes — draw once, encode many.
  const canvas = draw(bitmap, bitmap.width, bitmap.height, !mimeSupportsAlpha(mime));
  const encode = (quality: number) => canvas.convertToBlob({ type: mime, quality });

  const finish = async (
    blob: Blob,
    width: number,
    height: number,
    scaled: boolean,
  ): Promise<ImageJobResult> => {
    // The never-grow guard: a "compressor" must never hand back a bigger
    // file. The client still holds the original — just say "use it". The
    // untouched original was never scaled, so no scaled note either.
    if (blob.size >= job.fileSize) return { kind: "original" };
    // chooseOutput picked this format, not the user, so a browser that cannot
    // write it is followed rather than refused — but the name has to be what
    // the encoder produced, never a `.webp` over PNG bytes.
    const written = writtenFormat(blob, mime);
    return {
      kind: "blob",
      bytes: await toArrayBuffer(blob),
      mime: written.mime,
      ext: written.ext,
      width,
      height,
      // A downscale changes the picture, not just its bytes — say so, in the
      // one exact wording the shared policy module owns.
      ...(scaled ? { warnings: [scaledToTargetWarning(width, height)] } : {}),
    };
  };

  if (options.mode === "quality") {
    const blob = await encode(options.quality);
    progress(90);
    return finish(blob, bitmap.width, bitmap.height, false);
  }

  // Target-size mode: binary-search quality at the source dimensions first.
  // Stepping (below) only engages when that search bottoms out above the
  // target — a target reachable by quality alone must leave the dims alone.
  const targetBytes = options.targetSizeKb * 1024;
  // Degenerate target (cleared field, 0, NaN): stepping toward it would grind
  // the image to the 64-px floor and present that as success. Encode at the
  // requested quality instead — mirrored in lib/tools/image-compress.ts.
  if (!Number.isFinite(targetBytes) || targetBytes <= 0) {
    const blob = await encode(options.quality);
    progress(90);
    return finish(blob, bitmap.width, bitmap.height, false);
  }
  // One saturating tick per encode pass: the pass count varies with stepping,
  // so progress climbs monotonically and parks at 90 instead of overshooting.
  let passes = 0;
  const tick = () => progress(Math.min(90, 15 + ++passes * 7));

  const first = await searchQuality(encode, targetBytes, tick);
  if (first.under) return finish(first.under, bitmap.width, bitmap.height, false);

  // Quality alone cannot reach the target at these dimensions: step the dims
  // down (shared policy in lib/tools/target-size.ts) and search again. The
  // sqrt heuristic converges in 1–3 steps; the cap bounds total encode work.
  let smallest = first.smallest;
  let smallestDims = { width: bitmap.width, height: bitmap.height, scaled: false };
  let width = bitmap.width;
  let height = bitmap.height;
  for (let step = 0; step < MAX_DIMENSION_STEPS; step++) {
    const next = stepDimensions(width, height, nextScale(smallest.size, targetBytes));
    if (!next) break; // at the 64-px floor — nothing smaller is worth making
    ({ width, height } = next);
    const stepped = draw(bitmap, width, height, !mimeSupportsAlpha(mime));
    const result = await searchQuality(
      (quality) => stepped.convertToBlob({ type: mime, quality }),
      targetBytes,
      tick,
    );
    if (result.under) return finish(result.under, width, height, true);
    if (result.smallest.size < smallest.size) {
      smallest = result.smallest;
      smallestDims = { width, height, scaled: true };
    }
  }

  // Unreachable even at the floor: the smallest achieved is the honest,
  // closest-possible answer — today's behaviour, now across dimensions too.
  return finish(smallest, smallestDims.width, smallestDims.height, smallestDims.scaled);
}

// ── resize (mirrors lib/tools/image-resize.ts) ───────────────────

/** Map the source extension to an alpha-safe output format. */
function resizeOutputFormat(fileName: string): { mime: string; ext: string } {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "png":
    case "gif": // may carry transparency (first frame) — keep alpha-capable PNG
    case "svg":
      return { mime: "image/png", ext: "png" };
    case "webp":
    case "avif":
      return { mime: "image/webp", ext: "webp" };
    // bmp/jpg/jpeg carry no alpha → JPEG (a resized BMP as lossless PNG would bloat).
    default:
      return { mime: "image/jpeg", ext: "jpg" };
  }
}

async function resize(
  bitmap: ImageBitmap,
  job: ImageJob,
  options: ImageResizeOptions,
  progress: (value: number) => void,
): Promise<ImageJobResult> {
  const srcW = bitmap.width;
  const srcH = bitmap.height;

  let outW: number;
  let outH: number;
  if (options.mode === "percentage") {
    const scale = options.percentage / 100;
    outW = Math.round(srcW * scale);
    outH = Math.round(srcH * scale);
  } else {
    outW = options.width;
    outH = options.height;
  }
  outW = Math.max(1, Math.min(outW, 8192));
  outH = Math.max(1, Math.min(outH, 8192));

  const srcCanvas = draw(bitmap, srcW, srcH, false);
  const srcCtx = srcCanvas.getContext("2d");
  if (!srcCtx) throw new Error("Canvas 2D context not available");
  const srcData = srcCtx.getImageData(0, 0, srcW, srcH);
  progress(35);

  // Same Lanczos3 math the main-thread path uses — pica maps quality 3 to the
  // lanczos3 filter in both resize() and resizeBuffer(). The buffer API works
  // on raw RGBA, which is what a worker has; features:["js"] keeps pica from
  // spawning its own nested workers inside ours.
  const pica = new Pica({ features: ["js"] });
  const resized = (await pica.resizeBuffer({
    // Same bytes, uint8 view — pica's typings don't accept Uint8ClampedArray.
    src: new Uint8Array(srcData.data.buffer, srcData.data.byteOffset, srcData.data.length),
    width: srcW,
    height: srcH,
    toWidth: outW,
    toHeight: outH,
    quality: 3,
  })) as Uint8Array;
  progress(75);

  const destCanvas = new OffscreenCanvas(outW, outH);
  const destCtx = destCanvas.getContext("2d");
  if (!destCtx) throw new Error("Canvas 2D context not available");
  destCtx.putImageData(new ImageData(new Uint8ClampedArray(resized), outW, outH), 0, 0);

  const { mime } = resizeOutputFormat(job.fileName);
  const blob = await destCanvas.convertToBlob({ type: mime, quality: options.quality });
  // Derived from the source extension rather than asked for, so — as in
  // compress — the encoder's substitution is followed and named honestly.
  const written = writtenFormat(blob, mime);
  return {
    kind: "blob",
    bytes: await toArrayBuffer(blob),
    mime: written.mime,
    ext: written.ext,
    width: outW,
    height: outH,
  };
}

// ── edit verbs (geometry in lib/tools/image-edit-core.ts) ────────

/**
 * Rotate, flip, watermark, pixelate, circle-crop, border, split, presets.
 *
 * The verb geometry is NOT here — it is in image-edit-core.ts, which the
 * main-thread mirror (lib/tools/image-edit.ts) calls too. This function owns
 * only what a canvas pipeline owns: allocating the surface, the opaque fill an
 * alpha-less format needs, the encode, and the transfer-friendly shape of the
 * result. Single-output verbs come back as kind:"blob" so every existing
 * consumer keeps working; split and presets come back as kind:"blobs".
 */
async function edit(
  bitmap: ImageBitmap,
  options: ImageEditJobOptions,
  progress: (value: number) => void,
): Promise<ImageJobResult> {
  const { edit: verb, format, quality } = options;
  const mime = `image/${format}`;
  const ext = format === "jpeg" ? "jpg" : format;

  // A circular crop is cut with globalCompositeOperation "destination-in",
  // which erases the opaque background an alpha-less format needs — the result
  // would be a black square with a picture in the middle of it. Refuse rather
  // than ship that; the tool's own format picker omits JPEG for this reason.
  if (verb.kind === "crop-circle" && needsOpaqueFill(format)) {
    throw new Error(
      "A circular crop needs a format that can carry transparency. Choose PNG or WebP.",
    );
  }

  const plan = editOutputPlan(bitmap.width, bitmap.height, verb);
  if (plan.length === 0) throw new Error("Nothing to produce — no output sizes were selected");

  const items: Extract<ImageJobResult, { kind: "blobs" }>["items"] = [];
  for (let index = 0; index < plan.length; index++) {
    const { width, height, label } = plan[index];
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context not available");
    if (needsOpaqueFill(format)) {
      // Alpha-less formats flatten transparency to black without this.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
    }
    drawEdit(ctx, bitmap, verb, index);

    const blob = await canvas.convertToBlob({ type: mime, quality });
    // A canvas encoder that cannot write the requested type does NOT fail — it
    // silently serialises PNG instead (the trap image-convert.ts:5-9 records
    // for toBlob). The Blob's own type is the encoder telling us which format
    // it actually produced, so a mislabelled file never leaves this function.
    if (blob.type && blob.type !== mime) {
      throw new Error(`This browser cannot write ${format.toUpperCase()} images.`);
    }
    items.push({ bytes: await toArrayBuffer(blob), mime, ext, width, height, label });
    // One tick per output — the pass count is known up front here, unlike the
    // compressor's search, so this is a real fraction and not a guess.
    progress(Math.min(95, 10 + Math.round(((index + 1) / plan.length) * 85)));
  }

  // Derived, not asserted: the plan says whether the canvas ceiling forced any
  // output smaller than the geometry asked for. Reported once, naming the size
  // actually produced — a silently smaller picture is still a change nobody
  // asked for, and the alternative this replaced was a silently SQUASHED one.
  const shrunk = plan.find((entry) => entry.scaled);
  const warnings = shrunk ? [canvasCeilingWarning(shrunk.width, shrunk.height)] : undefined;

  if (isMultiOutputEdit(verb)) return { kind: "blobs", items, ...(warnings ? { warnings } : {}) };
  const only = items[0];
  return {
    kind: "blob",
    bytes: only.bytes,
    mime: only.mime,
    ext: only.ext,
    width: only.width,
    height: only.height,
    ...(warnings ? { warnings } : {}),
  };
}

// ── compress-png (oxipng; loader in lib/tools/png-optimise.ts) ───

/**
 * Lossless PNG re-compression.
 *
 * Progress is deliberately coarse: oxipng is ONE synchronous call with no
 * progress callback in its API, so the only honest ticks are "checked the
 * file", "engine ready" and "done". Interpolating a bar across the burn would
 * be inventing information — and the burn is real, roughly 570 ms per
 * megapixel, which is why the UI has to say so instead of animating.
 */
async function optimisePng(
  job: Extract<ImageJob, { op: "optimise-png" }>,
  options: PngOptimiseOptions,
  progress: (value: number) => void,
): Promise<ImageJobResult> {
  if (!job.bytes) {
    // Reachable only if a caller pre-decoded the source. optimise-png is the
    // one op that cannot work from pixels.
    throw new Error(NOT_A_PNG_MESSAGE);
  }
  const input = new Uint8Array(job.bytes);
  const before = readPngHeader(input);
  if (!before) throw new Error(NOT_A_PNG_MESSAGE);
  progress(5);

  const level = Math.min(4, Math.max(1, Math.round(options.level))) as PngOptimiseOptions["level"];
  const output = await optimisePngBytes(input, { ...options, level });
  progress(95);

  // Byte-identical output is oxipng's documented "nothing left to win" answer,
  // not a failure — measured on two already-optimised repo icons. Compare the
  // bytes rather than trusting a size match: two different PNGs can be the
  // same length.
  const identical = sameBytes(input, output);
  const after = readPngHeader(output) ?? before;
  // Two notices, both derived from the run rather than from the settings. The
  // de-interlace is invisible to every other report on the page: colourBefore
  // and colourAfter come from colour type and bit depth, which Adam7 does not
  // touch, so without this the file silently stops loading progressively.
  const warnings = [
    ...(identical ? [alreadyOptimalNote(level)] : []),
    ...(before.interlace === 1 && after.interlace !== 1 ? [deinterlacedNote()] : []),
  ];
  return {
    kind: "png",
    // A fresh buffer either way: `input` is the transferred job payload and
    // oxipng's return is a view onto wasm memory, which the next call reuses.
    bytes: output.slice().buffer,
    width: after.width,
    height: after.height,
    identical,
    level,
    colourBefore: describePngColour(before),
    colourAfter: describePngColour(after),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
