import { describe, it, expect, vi, beforeEach } from "vitest";

import { compressImage, type ImageCompressOptions } from "@/lib/tools/image-compress";

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
  mockCtx = { drawImage: vi.fn() };
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
  const data = size ? new Uint8Array(size) : new Uint8Array([1, 2, 3, 4, 5]);
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
      // Every call returns 2048 bytes regardless of quality
      // Target is 1 KB = 1024 bytes — unreachable
      setupCanvasMock({ fixedSize: 2048 });
      const file = makeFile("photo.jpg");
      const opts: ImageCompressOptions = { mode: "target-size", quality: 0, targetSizeKb: 1 };
      const result = await compressImage(file, opts);

      // Must return 2048 (the only size available), NOT a larger blob
      expect(result.blob.size).toBe(2048);
      // 1 initial + 10 search iterations
      expect(toBlobMock).toHaveBeenCalledTimes(11);
    });

    it("when target is unreachable, returns smallest of varying sizes", async () => {
      // Simulate: sizes decrease with lower quality but never reach target
      let call = 0;
      const sizes = [5000, 4000, 3500, 3000, 2800, 2600, 2500, 2400, 2300, 2200, 2100];
      toBlobMock.mockImplementation((cb: (b: Blob | null) => void, type: string) => {
        const size = sizes[Math.min(call, sizes.length - 1)];
        call++;
        cb(new Blob([new Uint8Array(size)], { type }));
      });

      const file = makeFile("photo.jpg");
      // Target 1 KB, but smallest achievable is ~2100 bytes
      const opts: ImageCompressOptions = { mode: "target-size", quality: 0, targetSizeKb: 1 };
      const result = await compressImage(file, opts);

      // Must NOT return the initial 5000-byte blob
      expect(result.blob.size).toBeLessThan(5000);
      // Should return the smallest blob encountered
      expect(result.blob.size).toBeLessThanOrEqual(2100);
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

    it("runs at most 10 binary search iterations", async () => {
      // Always over target, but decreasing
      let call = 0;
      toBlobMock.mockImplementation((cb: (b: Blob | null) => void, type: string) => {
        call++;
        // Starts large, shrinks each call but never under 1024
        const size = 5000 - call * 200;
        cb(new Blob([new Uint8Array(Math.max(size, 1500))], { type }));
      });

      const file = makeFile("photo.jpg");
      const opts: ImageCompressOptions = { mode: "target-size", quality: 0, targetSizeKb: 1 };
      await compressImage(file, opts);

      expect(call).toBe(11); // 1 initial + 10 iterations
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
