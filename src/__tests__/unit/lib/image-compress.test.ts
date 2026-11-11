import { describe, it, expect, vi, beforeEach } from "vitest";

import { compressImage, type ImageCompressOptions } from "@/lib/tools/image-compress";
import { ANIMATED_GIF_WARNING, ANIMATED_WEBP_WARNING } from "@/lib/tools/image-frames";
import { MAX_DIMENSION_STEPS } from "@/lib/tools/target-size";
import { animatedWebpBytes, gifBytes } from "./image-byte-fixtures";

/** Encode passes per quality search: the q=1.0 probe + up to 10 iterations. */
/**
 * Encodes one quality search can cost: the q=1.0 fast-path probe, the quality
 * FLOOR probe, then up to `MAX_QUALITY_PASSES` bisections.
 */
const MAX_PASSES_PER_SEARCH = 12;

/**
 * What an UNREACHABLE target costs now: the ceiling and the floor, and then
 * `searchQuality` returns rather than bisecting toward an answer the floor
 * already ruled out. It was 11 before the floor probe landed, paid once per
 * dimension step — see the derivation in lib/tools/target-size.ts.
 */
const PASSES_PER_INFEASIBLE_SEARCH = 2;

let mockCtx: Record<string, ReturnType<typeof vi.fn>>;
let mockCanvas: Record<string, unknown>;
let toBlobMock: ReturnType<typeof vi.fn>;
let toBlobQualities: number[];

/**
 * Realistic canvas mock: lower quality → smaller blob.
 * This simulates actual JPEG encoding behaviour so we can test
 * that the binary-search logic converges toward the target size.
 */
function setupCanvasMock(opts?: {
  /** Blob size at quality 1.0 — sizes scale linearly down to ~20% at quality 0 */
  maxSize?: number;
  /** Fixed size for every call (overrides scaling) */
  fixedSize?: number;
}) {
  toBlobQualities = [];
  mockCtx = {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    getImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(0) }),
  };
  toBlobMock = vi.fn().mockImplementation(
    (cb: (b: Blob | null) => void, type: string, quality?: number) => {
      const q = quality ?? 1;
      toBlobQualities.push(q);

      let size: number;
      if (opts?.fixedSize !== undefined) {
        size = opts.fixedSize;
      } else {
        const max = opts?.maxSize ?? 4;
        // Simulate: size scales roughly linearly with quality (floor 20 % of max)
        size = Math.max(1, Math.round(max * (0.2 + 0.8 * q)));
      }
      cb(new Blob([new Uint8Array(size)], { type }));
    },
  );
  mockCanvas = {
    width: 0,
    height: 0,
    getContext: vi.fn().mockReturnValue(mockCtx),
    toBlob: toBlobMock,
  };
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "canvas") return mockCanvas as unknown as HTMLCanvasElement;
    return document.createElement(tag);
  });
}

function setupImageMock(naturalWidth = 200, naturalHeight = 150) {
  global.URL.createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
  global.URL.revokeObjectURL = vi.fn();

  vi.spyOn(global, "Image").mockImplementation(function (this: Record<string, unknown>) {
    this.naturalWidth = naturalWidth;
    this.naturalHeight = naturalHeight;
    this.onload = null;
    this.onerror = null;
    this._src = "";
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    Object.defineProperty(this, "src", {
      get() { return self._src; },
      set(val: string) {
        self._src = val;
        setTimeout(() => {
          if (self.onload) (self.onload as () => void)();
        }, 0);
      },
    });
    return this as unknown as HTMLImageElement;
  } as unknown as () => HTMLImageElement);
}

function setupImageErrorMock() {
  vi.spyOn(global, "Image").mockImplementation(function (this: Record<string, unknown>) {
    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.onload = null;
    this.onerror = null;
    this._src = "";
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    Object.defineProperty(this, "src", {
      get() { return self._src; },
      set(val: string) {
        self._src = val;
        setTimeout(() => {
          if (self.onerror) (self.onerror as () => void)();
        }, 0);
      },
    });
    return this as unknown as HTMLImageElement;
  } as unknown as () => HTMLImageElement);
}

function makeFile(name: string, size?: number): File {
  // Default well above any mocked encode: compressImage never returns a
  // result bigger than its input, so a tiny input would (correctly) make
  // every test get the original file back instead of the encode under test.
  const data = new Uint8Array(size ?? 10 * 1024 * 1024);
  return new File([data], name, { type: "image/jpeg" });
}

describe("compressImage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setupCanvasMock();
    setupImageMock();
  });

  // ── quality mode ──────────────────────────────────────────────

  describe("quality mode", () => {
    it("returns a compressed blob with -compressed.jpg filename", async () => {
      const file = makeFile("photo.png");
      const opts: ImageCompressOptions = { mode: "quality", quality: 0.7, targetSizeKb: 0 };
      const result = await compressImage(file, opts);

      expect(result.fileName).toBe("photo-compressed.jpg");
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.blob.type).toBe("image/jpeg");
    });

    it("passes the given quality to canvas.toBlob", async () => {
      const file = makeFile("test.jpg");
      const opts: ImageCompressOptions = { mode: "quality", quality: 0.5, targetSizeKb: 0 };
      await compressImage(file, opts);

      expect(toBlobMock).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.5);
    });

    it("reports correct originalSize and newSize", async () => {
      const file = makeFile("test.jpg", 10_000);
      const opts: ImageCompressOptions = { mode: "quality", quality: 0.8, targetSizeKb: 0 };
      const result = await compressImage(file, opts);

      expect(result.originalSize).toBe(file.size);
      expect(result.newSize).toBe(result.blob.size);
    });

    it("draws image at natural dimensions", async () => {
      setupImageMock(640, 480);
      const file = makeFile("test.jpg");
      const opts: ImageCompressOptions = { mode: "quality", quality: 0.8, targetSizeKb: 0 };
      await compressImage(file, opts);

      expect(mockCanvas.width).toBe(640);
      expect(mockCanvas.height).toBe(480);
    });

    it("strips extension from multi-dot filenames", async () => {
      const file = makeFile("my.vacation.photo.png");
      const opts: ImageCompressOptions = { mode: "quality", quality: 0.8, targetSizeKb: 0 };
      const result = await compressImage(file, opts);

      expect(result.fileName).toBe("my.vacation.photo-compressed.jpg");
    });
  });

  // ── target-size mode ──────────────────────────────────────────

  describe("target-size mode", () => {
    it("returns immediately when max quality blob is already under target", async () => {
      // 4-byte blob at q=1.0 is well under 1 KB
      setupCanvasMock({ maxSize: 4 });
      const file = makeFile("photo.jpg");
      const opts: ImageCompressOptions = { mode: "target-size", quality: 0, targetSizeKb: 1 };
      const result = await compressImage(file, opts);

      expect(result.fileName).toBe("photo-compressed.jpg");
      // Only the initial q=1.0 probe, no binary search
      expect(toBlobMock).toHaveBeenCalledTimes(1);
    });

    it("binary-searches and returns a blob at or under the target", async () => {
      // 500 KB at q=1.0, scaling down to ~100 KB at q=0.0
      // Target: 200 KB → binary search should find a quality that works
      setupCanvasMock({ maxSize: 500 * 1024 });
      const file = makeFile("photo.jpg");
      const targetKb = 200;
      const opts: ImageCompressOptions = { mode: "target-size", quality: 0, targetSizeKb: targetKb };
      const result = await compressImage(file, opts);

      expect(result.blob.size).toBeLessThanOrEqual(targetKb * 1024);
      expect(toBlobMock.mock.calls.length).toBeGreaterThan(1);
    });

    it("converges toward the target (does not overshoot)", async () => {
      // maxSize 400 KB → floor at q≈0 is ~80 KB, so 100 KB target is reachable
      setupCanvasMock({ maxSize: 400 * 1024 });
      const file = makeFile("photo.jpg");
      const targetKb = 100;
      const opts: ImageCompressOptions = { mode: "target-size", quality: 0, targetSizeKb: targetKb };
      const result = await compressImage(file, opts);

      expect(result.blob.size).toBeLessThanOrEqual(targetKb * 1024);
    });

    it("works for typical small targets (50 KB)", async () => {
      // Image is 800 KB at q=1.0 → floor ~160 KB at q≈0
      // 50 KB is below the floor, so it should return the smallest possible
      setupCanvasMock({ maxSize: 800 * 1024 });
      const file = makeFile("photo.jpg", 900 * 1024);
      const opts: ImageCompressOptions = { mode: "target-size", quality: 0, targetSizeKb: 50 };
      const result = await compressImage(file, opts);

      // Should return something smaller than the original, NOT the q=1.0 blob
      expect(result.blob.size).toBeLessThan(800 * 1024);
    });

    it("when target is unreachable, returns the smallest blob found (not the largest)", async () => {
      // Every call returns 2048 bytes regardless of quality OR dimensions
      // Target is 1 KB = 1024 bytes — unreachable even by downscaling
      setupCanvasMock({ fixedSize: 2048 });
      const file = makeFile("photo.jpg");
      const opts: ImageCompressOptions = { mode: "target-size", quality: 0, targetSizeKb: 1 };
      const result = await compressImage(file, opts);

      // Must return 2048 (the only size available), NOT a larger blob
      expect(result.blob.size).toBe(2048);
      // The quality search at source dims fails, so dimension stepping runs
      // its searches too — bounded by the shared step cap. Each of those
      // searches costs only the two bracket probes, because the floor probe
      // rules the target out before any bisection happens: that is the whole
      // saving, and asserting the bound here is what keeps it.
      expect(toBlobMock.mock.calls.length).toBeGreaterThan(PASSES_PER_INFEASIBLE_SEARCH);
      expect(toBlobMock.mock.calls.length).toBeLessThanOrEqual(
        PASSES_PER_INFEASIBLE_SEARCH * (1 + MAX_DIMENSION_STEPS),
      );
      // Downscaling never made the blob smaller here, so the full-size encode
      // is what comes back — and it must NOT claim a scale-down happened.
      expect(result.warnings ?? []).toEqual([]);
    });

    it("when target is unreachable, returns smallest of varying sizes", async () => {
      /*
        Size falls with quality but bottoms out at 2100 bytes, well above the
        1 KB target — so no quality and no dimension reaches it, and the
        compressor's job is to hand back the smallest thing it actually made.

        The mock is a function of QUALITY, deliberately. It used to be a fixed
        array indexed by call order, which made the assertion a statement about
        how many times the search encodes rather than about which blob it
        picks: improving the search's efficiency moved the answer without
        changing the behaviour under test. Keying on quality pins the
        semantics instead, and 2100 is now an exact expectation.
      */
      const FLOOR_BYTES = 2100;
      toBlobMock.mockImplementation(
        (cb: (b: Blob | null) => void, type: string, quality?: number) => {
          const q = quality ?? 1;
          const size = Math.max(FLOOR_BYTES, Math.round(5000 * (0.2 + 0.8 * q)));
          cb(new Blob([new Uint8Array(size)], { type }));
        },
      );

      const file = makeFile("photo.jpg");
      // Target 1 KB, but the smallest achievable is FLOOR_BYTES.
      const opts: ImageCompressOptions = { mode: "target-size", quality: 0, targetSizeKb: 1 };
      const result = await compressImage(file, opts);

      // Must NOT return the 5000-byte q=1.0 blob...
      expect(result.blob.size).toBeLessThan(5000);
      // ...it must be the smallest the encoder can produce.
      expect(result.blob.size).toBe(FLOOR_BYTES);
    });

    it("stops early when within 5% of target", async () => {
      const targetKb = 100;
      const targetBytes = targetKb * 1024;
      let call = 0;
      toBlobMock.mockImplementation((cb: (b: Blob | null) => void, type: string) => {
        call++;
        // First call (q=1.0): way over target
        // Second call: lands at 97% of target → within 5%, should stop
        const size = call === 1 ? targetBytes * 2 : Math.round(targetBytes * 0.97);
        cb(new Blob([new Uint8Array(size)], { type }));
      });

      const file = makeFile("photo.jpg");
      const opts: ImageCompressOptions = { mode: "target-size", quality: 0, targetSizeKb: targetKb };
      const result = await compressImage(file, opts);

      expect(result.blob.size).toBeLessThanOrEqual(targetBytes);
      expect(result.blob.size).toBeGreaterThan(targetBytes * 0.95);
      // Only 2 calls: initial probe + 1 iteration that hit the sweet spot
      expect(call).toBe(2);
    });

    it("runs at most 10 binary search iterations per quality search", async () => {
      // First call (q=1.0) is over target; every later call is under it but
      // below the 95% early-exit band, so the search must run its full
      // 10 iterations and then stop — and, having got under target, must
      // NOT go on to dimension stepping.
      let call = 0;
      toBlobMock.mockImplementation((cb: (b: Blob | null) => void, type: string) => {
        call++;
        const size = call === 1 ? 5000 : 500;
        cb(new Blob([new Uint8Array(size)], { type }));
      });

      const file = makeFile("photo.jpg");
      const opts: ImageCompressOptions = { mode: "target-size", quality: 0, targetSizeKb: 1 };
      const result = await compressImage(file, opts);

      // Ceiling probe + floor probe + the 10 bisections. The cap on bisections
      // is unchanged; the floor probe is the one extra encode it now sits
      // behind, and it is what proves the target reachable before any of them.
      expect(call).toBe(MAX_PASSES_PER_SEARCH);
      expect(result.blob.size).toBe(500);
    });

    it("binary search lowers quality on each over-target iteration", async () => {
      setupCanvasMock({ maxSize: 200 * 1024 });
      const file = makeFile("photo.jpg");
      const opts: ImageCompressOptions = { mode: "target-size", quality: 0, targetSizeKb: 50 };
      await compressImage(file, opts);

      // First quality probe is always 1.0
      expect(toBlobQualities[0]).toBe(1);
      // Subsequent probes should be lower than 1.0
      for (let i = 1; i < toBlobQualities.length; i++) {
        expect(toBlobQualities[i]).toBeLessThan(1);
      }
    });
  });

  // ── dimension stepping (target-size mode) ─────────────────────

  describe("dimension stepping", () => {
    /**
     * Area-aware mock: blob size scales with the CANVAS dimensions as well as
     * quality, like a real encoder — so a target below the quality floor at
     * source dims becomes reachable once the engine steps the dims down.
     * (`document.createElement` hands back the one shared mockCanvas, so its
     * width/height always reflect the most recent encode.)
     */
    function setupAreaAwareMock() {
      toBlobMock.mockImplementation(
        (cb: (b: Blob | null) => void, type: string, quality?: number) => {
          const q = quality ?? 1;
          const area = (mockCanvas.width as number) * (mockCanvas.height as number);
          // ~0.25 bytes/px at the q≈0 floor, ~1.25 at q=1.
          const size = Math.max(64, Math.round(area * (0.2 + 0.8 * q) * 1.25));
          cb(new Blob([new Uint8Array(size)], { type }));
        },
      );
    }

    it("steps the dimensions down and says so when quality alone cannot reach the target", async () => {
      setupAreaAwareMock();
      // 200×150 source: the q≈0 floor is ~7.5 KB — a 4 KB target needs a
      // genuine downscale, not just a lower quality.
      const file = makeFile("photo.jpg");
      const targetKb = 4;
      const opts: ImageCompressOptions = { mode: "target-size", quality: 0, targetSizeKb: targetKb };
      const result = await compressImage(file, opts);

      expect(result.blob.size).toBeLessThanOrEqual(targetKb * 1024);
      // The exact wording is owned by target-size.ts and asserted by e2e too.
      expect(
        result.warnings?.some((w) => /^Scaled to \d+×\d+ to reach the target size\.$/.test(w)),
        `warnings: ${JSON.stringify(result.warnings)}`,
      ).toBe(true);
      // The final encode really happened at reduced dimensions.
      expect(mockCanvas.width as number).toBeLessThan(200);
      expect(mockCanvas.height as number).toBeLessThan(150);
    });

    it("does not step or warn when quality alone reaches the target", async () => {
      setupAreaAwareMock();
      // Floor ~7.5 KB, q=1.0 ~37.5 KB: 20 KB sits inside the quality range.
      const file = makeFile("photo.jpg");
      const opts: ImageCompressOptions = { mode: "target-size", quality: 0, targetSizeKb: 20 };
      const result = await compressImage(file, opts);

      expect(result.blob.size).toBeLessThanOrEqual(20 * 1024);
      expect(result.warnings ?? []).toEqual([]);
      // Every encode stayed at the source dimensions.
      expect(mockCanvas.width).toBe(200);
      expect(mockCanvas.height).toBe(150);
    });

    it("never-grow still wins over a scaled result, and carries no warnings at all", async () => {
      // Area-dependent encodes: 4096 bytes at the 200×150 source dims, 2048
      // once the dims step down — so the stepping loop genuinely engages,
      // "improves" on a scaled encode, and produces the "Scaled to …" note.
      // The file itself is only 100 bytes: never-grow must hand it back
      // untouched, and the untouched original was never scaled — the note
      // (and every other loss warning) must be dropped with the encode.
      toBlobMock.mockImplementation((cb: (b: Blob | null) => void, type: string) => {
        const atSourceDims = (mockCanvas.width as number) >= 200;
        cb(new Blob([new Uint8Array(atSourceDims ? 4096 : 2048)], { type }));
      });
      const file = makeFile("optimised.jpg", 100);
      const opts: ImageCompressOptions = { mode: "target-size", quality: 0, targetSizeKb: 1 };
      const result = await compressImage(file, opts);

      expect(result.blob).toBe(file);
      expect(result.newSize).toBe(file.size);
      expect(result.warnings ?? []).toEqual([]);
      // Prove the scenario is the one described: dimension stepping really ran.
      expect(mockCanvas.width as number).toBeLessThan(200);
    });
  });

  // ── degenerate targets (target-size mode) ─────────────────────

  describe("degenerate targets", () => {
    it.each([0, -5, NaN, Infinity])(
      "target %s never enters the stepping loop — quality-only encode instead",
      async (badTarget) => {
        // A cleared/zeroed KB field used to grind the photo down to the 64-px
        // floor and present it as success. The engine must fall back to a
        // single encode at the requested quality.
        setupCanvasMock({ maxSize: 4096 });
        const file = makeFile("photo.jpg");
        const opts: ImageCompressOptions = {
          mode: "target-size",
          quality: 0.7,
          targetSizeKb: badTarget,
        };
        const result = await compressImage(file, opts);

        expect(toBlobMock).toHaveBeenCalledTimes(1);
        expect(toBlobQualities).toEqual([0.7]); // the knob, not the q=1.0 probe
        expect(result.blob.size).toBeGreaterThan(0);
        // Dimensions untouched — no stepping happened.
        expect(mockCanvas.width).toBe(200);
        expect(mockCanvas.height).toBe(150);
      },
    );
  });

  // ── error cases ───────────────────────────────────────────────

  it("rejects when image fails to load", async () => {
    setupImageErrorMock();
    const file = makeFile("bad.jpg");
    const opts: ImageCompressOptions = { mode: "quality", quality: 0.8, targetSizeKb: 0 };
    await expect(compressImage(file, opts)).rejects.toThrow("Failed to load image");
  });

  it("rejects when canvas context is null", async () => {
    mockCanvas.getContext = vi.fn().mockReturnValue(null);
    const file = makeFile("photo.jpg");
    const opts: ImageCompressOptions = { mode: "quality", quality: 0.8, targetSizeKb: 0 };
    await expect(compressImage(file, opts)).rejects.toThrow("Canvas 2D context not available");
  });

  it("rejects when toBlob returns null", async () => {
    toBlobMock.mockImplementation((cb: (b: Blob | null) => void) => { cb(null); });
    const file = makeFile("photo.jpg");
    const opts: ImageCompressOptions = { mode: "quality", quality: 0.8, targetSizeKb: 0 };
    await expect(compressImage(file, opts)).rejects.toThrow("Canvas export failed");
  });
});

describe("never-grow guard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setupCanvasMock();
    setupImageMock();
  });

  it("returns the original file, untouched, when the encode is bigger", async () => {
    // Safari's canvas encoder can inflate an already-optimised JPEG; a
    // "compressor" must hand back the original in that case.
    setupCanvasMock({ fixedSize: 50 });
    const file = makeFile("optimised.jpg", 10); // smaller than every encode
    const result = await compressImage(file, { mode: "quality", quality: 0.8, targetSizeKb: 0 });

    expect(result.blob).toBe(file);
    expect(result.fileName).toBe("optimised.jpg");
    expect(result.newSize).toBe(file.size);
  });

  it("drops the frame warning too when the animated original wins", async () => {
    // The untouched original still has ALL its frames — "only its first
    // frame was kept" would be false, so no warning may ride kind-original.
    setupCanvasMock({ fixedSize: 5000 }); // every encode dwarfs the tiny GIF
    const file = new File([gifBytes(2)], "anim.gif", { type: "image/gif" });
    const result = await compressImage(file, { mode: "quality", quality: 0.8, targetSizeKb: 0 });

    expect(result.blob).toBe(file);
    expect(result.warnings ?? []).toEqual([]);
  });
});

describe("frame warnings through the fallback wiring", () => {
  // Real animated byte vectors through the REAL sniffer — only the canvas
  // decode/encode is mocked. These pin that compressImage actually feeds its
  // File's bytes to fileFirstFrameWarning and surfaces the exact constants.
  beforeEach(() => {
    vi.restoreAllMocks();
    setupCanvasMock();
    setupImageMock();
  });

  const QUALITY: ImageCompressOptions = { mode: "quality", quality: 0.8, targetSizeKb: 200 };

  it("surfaces the exact animated-GIF warning on a re-encoded output", async () => {
    const file = new File([gifBytes(2)], "anim.gif", { type: "image/gif" });
    const result = await compressImage(file, QUALITY);

    expect(result.blob).not.toBe(file);
    expect(result.warnings).toEqual([ANIMATED_GIF_WARNING]);
  });

  it("surfaces the exact animated-WebP warning", async () => {
    const file = new File([animatedWebpBytes()], "anim.webp", { type: "image/webp" });
    const result = await compressImage(file, QUALITY);

    expect(result.warnings).toEqual([ANIMATED_WEBP_WARNING]);
  });

  it("warns for animated GIF bytes renamed photo.png — bytes decide, not names", async () => {
    const file = new File([gifBytes(2)], "photo.png", { type: "image/png" });
    const result = await compressImage(file, QUALITY);

    expect(result.warnings).toEqual([ANIMATED_GIF_WARNING]);
  });

  it("stays quiet for a still, single-frame GIF", async () => {
    const file = new File([gifBytes(1)], "still.gif", { type: "image/gif" });
    const result = await compressImage(file, QUALITY);

    expect(result.warnings).toBeUndefined();
  });
});
