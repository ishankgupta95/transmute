/* eslint-disable @typescript-eslint/no-explicit-any -- the worker's globals (self, OffscreenCanvas, postMessage) are stubbed here, untyped on purpose */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

/*
  The image WORKER is the pipeline users actually get; lib/tools/image-*.ts is
  only the fallback, and used to be all the unit tests covered. jsdom has no
  OffscreenCanvas / createImageBitmap, so this drives the worker's real message
  handler against FAKES for those, and asserts the DECISIONS the worker makes:
  which format it writes, what it names it, whether it flattens onto white,
  when it hands back the original, and the response protocol.

  Pica and the oxipng glue are mocked (neither is importable here and neither
  is a decision the worker makes); png-optimise's pure helpers stay real.
*/

const resizeBuffer = vi.fn();
vi.mock("pica", () => ({
  default: class {
    resizeBuffer = resizeBuffer;
  },
}));

const optimisePngBytes = vi.fn();
vi.mock("@/lib/tools/png-optimise", async (orig) => ({
  ...(await orig<typeof import("@/lib/tools/png-optimise")>()),
  optimisePngBytes: (...a: unknown[]) => optimisePngBytes(...a),
}));

// ── fakes ────────────────────────────────────────────────────────

type Encoder = (type: string, quality: number | undefined, canvas: FakeCanvas) => Blob;

class FakeCanvas {
  static instances: FakeCanvas[] = [];
  static encoder: Encoder = (type) => new Blob(["x".repeat(10)], { type });
  /** alpha byte used for every pixel getImageData returns */
  static alpha = 255;
  ops: string[] = [];
  encodes: { type: string; quality?: number }[] = [];
  constructor(
    public width: number,
    public height: number,
  ) {
    FakeCanvas.instances.push(this);
  }
  getContext() {
    const ops = this.ops;
    return {
      set fillStyle(v: string) {
        ops.push(`fillStyle:${v}`);
      },
      canvas: this,
      save: () => {},
      restore: () => {},
      translate: () => {},
      rotate: () => {},
      scale: () => {},
      fillRect: () => ops.push("fillRect"),
      drawImage: () => ops.push("drawImage"),
      putImageData: () => ops.push("putImageData"),
      getImageData: (_x: number, _y: number, w: number, h: number) => {
        const data = new Uint8ClampedArray(w * h * 4).fill(200);
        for (let i = 3; i < data.length; i += 4) data[i] = FakeCanvas.alpha;
        return { data };
      },
    };
  }
  async convertToBlob(opts: { type: string; quality?: number }) {
    this.encodes.push(opts);
    return FakeCanvas.encoder(opts.type, opts.quality, this);
  }
}

const posted: { msg: any; transfer?: ArrayBuffer[] }[] = [];

beforeAll(async () => {
  const g = globalThis as any;
  g.OffscreenCanvas = FakeCanvas;
  g.ImageData = class {
    constructor(
      public data: Uint8ClampedArray,
      public width: number,
      public height: number,
    ) {}
  };
  g.postMessage = (msg: unknown, transfer?: ArrayBuffer[]) => posted.push({ msg, transfer });
  await import("@/lib/workers/image.worker");
});

function makeBitmap(width = 100, height = 80) {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

beforeEach(() => {
  (globalThis as any).createImageBitmap = vi.fn(async () => makeBitmap());
  posted.length = 0;
  FakeCanvas.instances = [];
  FakeCanvas.alpha = 255;
  FakeCanvas.encoder = (type) => new Blob(["x".repeat(10)], { type });
  resizeBuffer.mockReset();
  optimisePngBytes.mockReset();
});

let nextId = 0;
/** Send one job through the real onmessage and wait for its done/error. */
async function run(payload: Record<string, unknown>) {
  const id = ++nextId;
  const before = posted.length;
  await (globalThis as any).onmessage({ data: { id, payload } });
  const finals = posted.slice(before).filter((p) => p.msg.id === id && p.msg.type !== "progress");
  expect(finals).toHaveLength(1);
  return finals[0];
}

const base = { fileName: "photo.jpg", fileType: "image/jpeg", fileSize: 1000, bytes: new ArrayBuffer(8) };
const quality = { mode: "quality", quality: 0.8, targetSizeKb: 0 };

// ── protocol ─────────────────────────────────────────────────────

describe("message protocol", () => {
  it("answers a good job with done, echoing the id, and transfers the output buffer", async () => {
    const { msg, transfer } = await run({
      ...base,
      op: "convert",
      options: { targetFormat: "png" },
    });
    expect(msg.type).toBe("done");
    expect(msg.result.kind).toBe("blob");
    expect(transfer).toEqual([msg.result.bytes]);
  });

  it("turns a throw into {type:'error', message} and keeps non-Error throws generic", async () => {
    (globalThis as any).createImageBitmap = vi.fn().mockRejectedValue(new Error("decode boom"));
    const { msg } = await run({ ...base, op: "convert", options: { targetFormat: "png" } });
    expect(msg).toMatchObject({ type: "error", message: "decode boom" });

    (globalThis as any).createImageBitmap = vi.fn().mockRejectedValue("nope");
    const second = await run({ ...base, op: "convert", options: { targetFormat: "png" } });
    expect(second.msg).toMatchObject({ type: "error", message: "Image processing failed" });
  });

  it("retries a decode without imageOrientation when the option is rejected", async () => {
    const cib = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("bad option"))
      .mockResolvedValueOnce(makeBitmap());
    (globalThis as any).createImageBitmap = cib;
    const { msg } = await run({ ...base, op: "convert", options: { targetFormat: "png" } });
    expect(msg.type).toBe("done");
    expect(cib).toHaveBeenCalledTimes(2);
    expect(cib.mock.calls[0][1]).toEqual({ imageOrientation: "from-image" });
    expect(cib.mock.calls[1]).toHaveLength(1);
  });

  it("uses a pre-decoded bitmap without decoding, and closes it afterwards", async () => {
    const cib = vi.fn();
    (globalThis as any).createImageBitmap = cib;
    const bitmap = makeBitmap();
    await run({ ...base, bytes: undefined, bitmap, op: "convert", options: { targetFormat: "png" } });
    expect(cib).not.toHaveBeenCalled();
    expect(bitmap.close).toHaveBeenCalled();
  });

  it("closes the bitmap even when the op throws", async () => {
    const bitmap = makeBitmap();
    FakeCanvas.encoder = () => {
      throw new Error("encode boom");
    };
    const { msg } = await run({ ...base, bitmap, op: "convert", options: { targetFormat: "png" } });
    expect(msg).toMatchObject({ type: "error", message: "encode boom" });
    expect(bitmap.close).toHaveBeenCalled();
  });
});

// ── convert ──────────────────────────────────────────────────────

describe("convert", () => {
  it("flattens onto white for JPEG, never leaving the default black", async () => {
    await run({ ...base, op: "convert", options: { targetFormat: "jpeg" } });
    const ops = FakeCanvas.instances[0].ops;
    expect(ops).toEqual(["fillStyle:#ffffff", "fillRect", "drawImage"]);
  });

  it("does not fill PNG or WebP (alpha survives)", async () => {
    for (const targetFormat of ["png", "webp"]) {
      FakeCanvas.instances = [];
      await run({ ...base, op: "convert", options: { targetFormat } });
      expect(FakeCanvas.instances[0].ops).toEqual(["drawImage"]);
    }
  });

  it("reports what the encoder WROTE: a PNG substituted for WebP is not saved as .webp", async () => {
    FakeCanvas.encoder = () => new Blob(["x"], { type: "image/png" });
    const { msg } = await run({ ...base, op: "convert", options: { targetFormat: "webp" } });
    expect(msg.result).toMatchObject({ mime: "image/png", ext: "png" });
  });

  it("keeps the request when the encoder reports no type, and maps jpeg to .jpg", async () => {
    FakeCanvas.encoder = () => new Blob(["x"], { type: "" });
    const { msg } = await run({ ...base, op: "convert", options: { targetFormat: "jpeg" } });
    expect(msg.result).toMatchObject({ mime: "image/jpeg", ext: "jpg" });
  });

  it("honours explicit output dimensions", async () => {
    const { msg } = await run({
      ...base,
      op: "convert",
      options: { targetFormat: "png", width: 30, height: 20 },
    });
    expect(msg.result).toMatchObject({ width: 30, height: 20 });
    expect(FakeCanvas.instances[0]).toMatchObject({ width: 30, height: 20 });
  });

  it("refuses a zero-sized source", async () => {
    (globalThis as any).createImageBitmap = vi.fn(async () => makeBitmap(0, 0));
    const { msg } = await run({ ...base, op: "convert", options: { targetFormat: "png" } });
    expect(msg.type).toBe("error");
    expect(msg.message).toMatch(/dimensions/);
  });
});

// ── compress: chooseOutput + bitmapHasTransparency ───────────────

describe("compress output choice", () => {
  const png = { ...base, fileName: "logo.png", fileType: "image/png", fileSize: 10_000 };

  it("a transparent PNG becomes WebP (JPEG would turn it black)", async () => {
    FakeCanvas.alpha = 0;
    const { msg } = await run({ ...png, op: "compress", options: quality });
    expect(msg.result).toMatchObject({ kind: "blob", mime: "image/webp", ext: "webp" });
    // alpha-capable: no opaque fill on the encode canvas
    expect(FakeCanvas.instances.some((c) => c.ops.includes("fillRect"))).toBe(false);
  });

  it("a fully opaque PNG becomes JPEG, flattened onto white", async () => {
    FakeCanvas.alpha = 255;
    const { msg } = await run({ ...png, op: "compress", options: quality });
    expect(msg.result).toMatchObject({ kind: "blob", mime: "image/jpeg", ext: "jpg" });
    const encodeCanvas = FakeCanvas.instances.find((c) => c.encodes.length > 0)!;
    expect(encodeCanvas.ops.slice(0, 2)).toEqual(["fillStyle:#ffffff", "fillRect"]);
  });

  it("a JPEG never gets the transparency probe and stays JPEG even if pixels read transparent", async () => {
    FakeCanvas.alpha = 0;
    const { msg } = await run({ ...base, op: "compress", options: quality });
    expect(msg.result).toMatchObject({ mime: "image/jpeg", ext: "jpg" });
  });

  it("detects alpha from the MIME when the extension is missing", async () => {
    FakeCanvas.alpha = 0;
    const { msg } = await run({ ...png, fileName: "download", op: "compress", options: quality });
    expect(msg.result.mime).toBe("image/webp");
  });

  it("probes transparency on a <=256px raster", async () => {
    (globalThis as any).createImageBitmap = vi.fn(async () => makeBitmap(4000, 2000));
    FakeCanvas.alpha = 0;
    await run({ ...png, op: "compress", options: quality });
    expect(FakeCanvas.instances[0]).toMatchObject({ width: 256, height: 128 });
  });

  it("follows the encoder when it substitutes PNG for the chosen WebP", async () => {
    FakeCanvas.alpha = 0;
    FakeCanvas.encoder = () => new Blob(["x"], { type: "image/png" });
    const { msg } = await run({ ...png, op: "compress", options: quality });
    expect(msg.result).toMatchObject({ kind: "blob", mime: "image/png", ext: "png" });
  });
});

describe("compress never-grow", () => {
  it("returns the original when the re-encode is not smaller", async () => {
    FakeCanvas.encoder = (type) => new Blob(["x".repeat(1000)], { type }); // == fileSize
    const { msg } = await run({ ...base, fileSize: 1000, op: "compress", options: quality });
    expect(msg.result).toEqual({ kind: "original" });
  });

  it("returns the re-encode when it is smaller", async () => {
    FakeCanvas.encoder = (type) => new Blob(["x".repeat(999)], { type });
    const { msg } = await run({ ...base, fileSize: 1000, op: "compress", options: quality });
    expect(msg.result.kind).toBe("blob");
  });

  it("drops the animated-GIF first-frame warning on an untouched original but keeps it on a re-encode", async () => {
    // GIF89a header + two image descriptors (0x2C) separated by extension-free blocks
    const gif = new Uint8Array([
      ...Array.from("GIF89a", (c) => c.charCodeAt(0)),
      1, 0, 1, 0, 0, 0, 0,
      0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 0x01, 0,
      0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 0x01, 0,
      0x3b,
    ]).buffer;
    const job = { ...base, fileName: "a.gif", fileType: "image/gif", bytes: gif, op: "compress", options: quality };
    FakeCanvas.encoder = (type) => new Blob(["x".repeat(5000)], { type });
    const original = await run({ ...job, fileSize: 1000 });
    expect(original.msg.result).toEqual({ kind: "original" });
    FakeCanvas.encoder = (type) => new Blob(["x"], { type });
    const reencoded = await run({ ...job, fileSize: 1000 });
    expect(reencoded.msg.result.kind).toBe("blob");
    expect(reencoded.msg.result.warnings?.length).toBeGreaterThan(0);
  });
});

describe("compress target-size wiring", () => {
  const target = (kb: number) => ({ mode: "target-size", quality: 0.7, targetSizeKb: kb });

  it("starts at quality 1.0 and keeps the dimensions when that already fits", async () => {
    FakeCanvas.encoder = (type) => new Blob(["x".repeat(500)], { type });
    const { msg } = await run({ ...base, fileSize: 100_000, op: "compress", options: target(10) });
    expect(msg.result).toMatchObject({ kind: "blob", width: 100, height: 80 });
    expect(msg.result.warnings).toBeUndefined();
    expect(FakeCanvas.instances[0].encodes[0].quality).toBe(1);
  });

  it("bisects quality: bytes scale with quality, result lands under the target", async () => {
    FakeCanvas.encoder = (type, q) => new Blob(["x".repeat(Math.round(20_000 * (q ?? 1)))], { type });
    const { msg } = await run({ ...base, fileSize: 100_000, op: "compress", options: target(10) });
    expect(msg.result.kind).toBe("blob");
    expect(msg.result.bytes.byteLength).toBeLessThanOrEqual(10 * 1024);
    expect(msg.result).toMatchObject({ width: 100, height: 80 });
  });

  it("steps the dimensions down and says so when quality alone cannot reach the target", async () => {
    // size is proportional to pixel area, independent of quality
    FakeCanvas.encoder = (type, _q, c) => new Blob(["x".repeat(c.width * c.height)], { type });
    (globalThis as any).createImageBitmap = vi.fn(async () => makeBitmap(400, 300)); // 120_000 B
    const { msg } = await run({ ...base, fileSize: 500_000, op: "compress", options: target(20) });
    expect(msg.result.kind).toBe("blob");
    expect(msg.result.width).toBeLessThan(400);
    expect(msg.result.bytes.byteLength).toBeLessThanOrEqual(20 * 1024);
    expect(msg.result.warnings).toHaveLength(1);
  });

  it("encodes once at the requested quality for a degenerate target instead of grinding down", async () => {
    for (const kb of [0, NaN, -5]) {
      FakeCanvas.instances = [];
      const { msg } = await run({ ...base, fileSize: 100_000, op: "compress", options: target(kb) });
      expect(msg.result).toMatchObject({ kind: "blob", width: 100, height: 80 });
      const encodes = FakeCanvas.instances.flatMap((c) => c.encodes);
      expect(encodes).toEqual([{ type: "image/jpeg", quality: 0.7 }]);
    }
  });
});

// ── resize ───────────────────────────────────────────────────────

describe("resize", () => {
  const opts = { mode: "custom", width: 50, height: 40, lockAspect: false, percentage: 50, quality: 0.9 };

  beforeEach(() => {
    resizeBuffer.mockImplementation(async ({ toWidth, toHeight }) => new Uint8Array(toWidth * toHeight * 4));
  });

  it.each([
    ["a.png", "image/png", "png"],
    ["a.gif", "image/png", "png"],
    ["a.svg", "image/png", "png"],
    ["a.webp", "image/webp", "webp"],
    ["a.avif", "image/webp", "webp"],
    ["a.jpg", "image/jpeg", "jpg"],
    ["a.bmp", "image/jpeg", "jpg"],
    ["noext", "image/jpeg", "jpg"],
  ])("%s -> %s", async (fileName, mime, ext) => {
    const { msg } = await run({ ...base, fileName, op: "resize", options: opts });
    expect(msg.result).toMatchObject({ kind: "blob", mime, ext, width: 50, height: 40 });
  });

  it("follows the encoder when WebP is substituted by PNG", async () => {
    FakeCanvas.encoder = () => new Blob(["x"], { type: "image/png" });
    const { msg } = await run({ ...base, fileName: "a.webp", op: "resize", options: opts });
    expect(msg.result).toMatchObject({ mime: "image/png", ext: "png" });
  });

  it("percentage mode scales the source; sizes are clamped to 1..8192", async () => {
    const pct = await run({ ...base, op: "resize", options: { ...opts, mode: "percentage", percentage: 50 } });
    expect(pct.msg.result).toMatchObject({ width: 50, height: 40 });
    const huge = await run({ ...base, op: "resize", options: { ...opts, width: 99999, height: 0 } });
    expect(huge.msg.result).toMatchObject({ width: 8192, height: 1 });
  });

  it("reads the source WITHOUT an opaque fill so a PNG keeps its alpha", async () => {
    await run({ ...base, fileName: "a.png", op: "resize", options: opts });
    expect(FakeCanvas.instances.some((c) => c.ops.includes("fillRect"))).toBe(false);
  });
});

// ── edit ─────────────────────────────────────────────────────────

describe("edit", () => {
  const rotate = { kind: "rotate", degrees: 90 };

  it("fills white for JPEG output, not for PNG", async () => {
    await run({ ...base, op: "edit", options: { edit: rotate, format: "jpeg", quality: 0.9 } });
    expect(FakeCanvas.instances[0].ops.slice(0, 2)).toEqual(["fillStyle:#ffffff", "fillRect"]);
    FakeCanvas.instances = [];
    await run({ ...base, op: "edit", options: { edit: rotate, format: "png", quality: 0.9 } });
    expect(FakeCanvas.instances[0].ops).not.toContain("fillRect");
  });

  it("refuses rather than mislabel when the encoder substitutes another type", async () => {
    FakeCanvas.encoder = () => new Blob(["x"], { type: "image/png" });
    const { msg } = await run({ ...base, op: "edit", options: { edit: rotate, format: "webp", quality: 0.9 } });
    expect(msg).toMatchObject({ type: "error", message: "This browser cannot write WEBP images." });
  });

  it("refuses a circular crop to JPEG", async () => {
    const { msg } = await run({
      ...base,
      op: "edit",
      options: { edit: { kind: "crop-circle", region: null }, format: "jpeg", quality: 0.9 },
    });
    expect(msg.type).toBe("error");
    expect(msg.message).toMatch(/circular crop/i);
  });

  it("a split comes back as blobs and transfers EVERY item buffer", async () => {
    const { msg, transfer } = await run({
      ...base,
      op: "edit",
      options: { edit: { kind: "split", rows: 2, cols: 2 }, format: "png", quality: 1 },
    });
    expect(msg.result.kind).toBe("blobs");
    expect(msg.result.items).toHaveLength(4);
    expect(transfer).toHaveLength(4);
    expect(transfer).toEqual(msg.result.items.map((i: { bytes: ArrayBuffer }) => i.bytes));
  });

  it("names a jpeg edit .jpg", async () => {
    const { msg } = await run({ ...base, op: "edit", options: { edit: rotate, format: "jpeg", quality: 0.9 } });
    expect(msg.result).toMatchObject({ kind: "blob", mime: "image/jpeg", ext: "jpg" });
  });
});

// ── optimise-png ─────────────────────────────────────────────────

describe("optimise-png", () => {
  /** minimal valid PNG signature + IHDR (colour type 6, 8-bit, 4x4) */
  function pngBytes(interlace = 0) {
    const b = new Uint8Array(33);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    b.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
    b[19] = 4;
    b[23] = 4;
    b[24] = 8;
    b[25] = 6;
    b[28] = interlace;
    return b;
  }
  const job = (bytes?: ArrayBuffer, level = 3) => ({
    ...base,
    fileName: "a.png",
    fileType: "image/png",
    bytes,
    op: "optimise-png",
    options: { level, optimiseAlpha: false },
  });

  it("never decodes, and rejects non-PNG bytes with the shared message", async () => {
    const cib = vi.fn();
    (globalThis as any).createImageBitmap = cib;
    const { msg } = await run(job(new Uint8Array([1, 2, 3]).buffer));
    expect(msg.type).toBe("error");
    expect(cib).not.toHaveBeenCalled();
  });

  it("rejects a pre-decoded (bytes-less) job", async () => {
    const { msg } = await run(job(undefined));
    expect(msg.type).toBe("error");
  });

  it("identical output is flagged and carries the 'already optimal' note (sameBytes)", async () => {
    const input = pngBytes();
    optimisePngBytes.mockResolvedValue(input.slice());
    const { msg, transfer } = await run(job(input.slice().buffer));
    expect(msg.result).toMatchObject({ kind: "png", identical: true });
    expect(msg.result.warnings).toHaveLength(1);
    expect(transfer).toEqual([msg.result.bytes]);
  });

  it("same LENGTH but different bytes is not 'identical'", async () => {
    const input = pngBytes();
    const out = input.slice();
    out[30] = 0xff; // inside the IHDR CRC; header fields still parse
    optimisePngBytes.mockResolvedValue(out);
    const { msg } = await run(job(input.slice().buffer));
    expect(msg.result.identical).toBe(false);
    expect(msg.result.warnings).toBeUndefined();
  });

  it("notes a de-interlace and clamps the level to 1..4", async () => {
    const input = pngBytes(1);
    optimisePngBytes.mockResolvedValue(pngBytes(0));
    const { msg } = await run(job(input.slice().buffer, 9));
    expect(msg.result.warnings).toHaveLength(1);
    expect(msg.result.level).toBe(4);
    expect(optimisePngBytes.mock.calls[0][1].level).toBe(4);
  });
});
