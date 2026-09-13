import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

/*
 * libheif stub — deliberately shaped like the real vendored load, which looks
 * wrong at first glance.
 *
 * libheif and libde265 are LGPL, so the decoder is not bundled:
 * `npm run copy:wasm` copies upstream's `libheif.js` and `libheif.wasm` into
 * `public/vendor/`, and lib/tools/image-convert.ts loads the first with a
 * CLASSIC SCRIPT TAG and hands the second to the factory itself.
 *
 * Why a script tag and not `import()` — the thing this harness pins: the UMD
 * tail is `module.exports` / AMD `define` over a top-level `var libheif`. As
 * an ES module that binding is module-scoped, so `import()` yields an empty
 * namespace AND leaves `globalThis.libheif` undefined; the library is simply
 * unreachable. Sloppy-mode classic script evaluation is what makes it a global.
 * So the stub below appends nothing and `installLibheif` puts the factory on
 * `globalThis` the way the real script would.
 *
 * `jsdom` never fetches the script, so `document.head.appendChild` has to be
 * taught to fire `onload`; the same shim is what lets a test simulate a failed
 * fetch by firing `onerror` instead.
 */

/** The ImageData libheif hands back — one opaque pixel is enough for jsdom. */
function decodedImage(width = 4, height = 4): ImageData {
  return {
    data: new Uint8ClampedArray(width * height * 4).fill(255),
    width,
    height,
    colorSpace: "srgb",
  };
}

/** A single decoded picture, with the handle API image-convert.ts drives. */
function heifImage(primary: boolean, width = 4, height = 4) {
  return {
    get_width: () => width,
    get_height: () => height,
    is_primary: () => primary,
    display: (into: ImageData, done: (out: ImageData | null) => void) =>
      done(decodedImage(into.width, into.height)),
    free: vi.fn(),
  };
}

/**
 * Put a fresh decoder factory where the vendored classic script would leave
 * one, and make script-tag insertion resolve. Returns the decode spy so a test
 * can assert what libheif was actually asked to decode.
 */
function installLibheif(images = [heifImage(true)]): Mock {
  const decode = vi.fn().mockReturnValue(images);
  // Shaped like the real binding: a context pointer the caller must free, set
  // by decode() and readable afterwards. See the leak note in decodeHeic.
  contextFree = vi.fn();
  (globalThis as { libheif?: Mock }).libheif = vi.fn().mockResolvedValue({
    HeifDecoder: class {
      decoder: number | null = null;
      decode(bytes: Uint8Array) {
        this.decoder = 0xc0ffee;
        return decode(bytes);
      }
    },
    heif_context_free: contextFree,
  });
  installScriptLoader("load");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  return decode;
}

/** The `heif_context_free` spy for the current test. */
let contextFree: Mock;

/**
 * jsdom does not fetch `script.src`, so nothing ever settles the promise in
 * loadLibheif. Fire the requested event on the next tick instead.
 */
const realAppendChild = document.head.appendChild.bind(document.head);

function installScriptLoader(outcome: "load" | "error"): void {
  // Bind the REAL appendChild once at module scope, never
  // `document.head.appendChild` at call time: a second install in the same test
  // would otherwise capture the first install's spy and recurse forever. Same
  // trap as setupCanvasMock's createElement, one level up.
  vi.spyOn(document.head, "appendChild").mockImplementation((node: Node) => {
    const el = node as HTMLScriptElement;
    if (el.tagName === "SCRIPT") {
      queueMicrotask(() => (outcome === "load" ? el.onload : el.onerror)?.call(el, new Event(outcome)));
      return node;
    }
    return realAppendChild(node as never);
  });
}


// Mock utif2
/*
 * utif2 is mocked to the shape the REAL library emits, verified against
 * `UTIF.encodeImage` output in Node: `decode()` returns IFD objects carrying
 * only numeric TIFF tags (t256 = ImageWidth, t257 = ImageLength) — `.width`
 * and `.height` do not exist until `decodeImage()` has populated them.
 *
 * The earlier mock put `width`/`height` straight on `decode()`'s return, which
 * no real TIFF ever does. That made the decode order untestable: reading the
 * dimensions before `decodeImage()` ran would have kept passing here while
 * producing a NaN-sized canvas in the browser. Populating them in
 * `decodeImage` instead pins the ordering the production path depends on.
 */
vi.mock("utif2", () => ({
  // A fresh IFD per call — real decode() never hands back a shared object,
  // and reusing one would leak decodeImage's mutations between tests.
  decode: vi.fn(() => [{ t256: [100], t257: [80] } as Record<string, unknown>]),
  decodeImage: vi.fn((_buf: ArrayBuffer, ifd: Record<string, unknown>) => {
    ifd.width = (ifd.t256 as number[])[0];
    ifd.height = (ifd.t257 as number[])[0];
  }),
  toRGBA8: vi.fn().mockReturnValue(new Uint8Array(100 * 80 * 4)),
}));

import { convertImage, type ImageConvertOptions } from "@/lib/tools/image-convert";
import { ANIMATED_GIF_WARNING, ANIMATED_WEBP_WARNING } from "@/lib/tools/image-frames";
import * as UTIF from "utif2";
import { animatedWebpBytes, gifBytes } from "./image-byte-fixtures";

// -- Canvas & Image mocking --

let mockCtx: Record<string, ReturnType<typeof vi.fn>>;
let mockCanvas: Record<string, unknown>;

function setupCanvasMock() {
  mockCtx = {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    getImageData: vi.fn().mockReturnValue({ data: new Uint8Array(0) }),
    createImageData: vi.fn().mockImplementation((w: number, h: number) => ({
      data: new Uint8Array(w * h * 4),
    })),
    putImageData: vi.fn(),
  };
  mockCanvas = {
    width: 0,
    height: 0,
    getContext: vi.fn().mockReturnValue(mockCtx),
    toBlob: vi.fn().mockImplementation((cb: (b: Blob | null) => void, type: string) => {
      cb(new Blob(["canvas-data"], { type }));
    }),
  };
  // Bind the real factory FIRST. Calling `document.createElement` from inside
  // the mock would re-enter the spy — harmless while canvases were the only
  // element made here, infinite recursion the moment the HEIC loader asks for
  // a <script>.
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "canvas") return mockCanvas as unknown as HTMLCanvasElement;
    return createElement(tag);
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

function makeFile(name: string, type = "image/png"): File {
  return new File(["file-data"], name, { type });
}

describe("convertImage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // After restoreAllMocks so the global spy is never torn down under a test.
    installLibheif();
    setupCanvasMock();
    setupImageMock();
  });

  it("converts PNG to JPEG with correct filename extension (.jpg)", async () => {
    const file = makeFile("photo.png", "image/png");
    const opts: ImageConvertOptions = { targetFormat: "jpeg", quality: 0.8 };
    const result = await convertImage(file, opts);

    expect(result.fileName).toBe("photo.jpg");
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.type).toBe("image/jpeg");
    expect(result.originalSize).toBe(file.size);
    expect(result.newSize).toBe(result.blob.size);
  });

  it("converts WebP to PNG with correct filename", async () => {
    const file = makeFile("image.webp", "image/webp");
    const opts: ImageConvertOptions = { targetFormat: "png", quality: 1 };
    const result = await convertImage(file, opts);

    expect(result.fileName).toBe("image.png");
    expect(result.blob.type).toBe("image/png");
  });

  it("converts to WebP format", async () => {
    const file = makeFile("test.jpg", "image/jpeg");
    const opts: ImageConvertOptions = { targetFormat: "webp", quality: 0.9 };
    const result = await convertImage(file, opts);

    expect(result.fileName).toBe("test.webp");
    expect(result.blob.type).toBe("image/webp");
  });

  // There was a "converts to BMP format" case here. It only passed because
  // `canvasToBlob` is mocked to echo back whatever MIME it is handed — no real
  // browser encodes BMP, so `canvas.toBlob` fell back to PNG and the tool
  // produced PNG bytes named `.bmp`. BMP is source-only now, and the type no
  // longer admits it as a target.

  it("uses natural dimensions when width/height not specified", async () => {
    setupImageMock(800, 600);
    const file = makeFile("photo.png");
    const opts: ImageConvertOptions = { targetFormat: "jpeg", quality: 0.8 };
    await convertImage(file, opts);

    expect(mockCanvas.width).toBe(800);
    expect(mockCanvas.height).toBe(600);
    expect(mockCtx.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      800,
      600,
    );
  });

  it("uses custom dimensions when provided", async () => {
    setupImageMock(800, 600);
    const file = makeFile("photo.png");
    const opts: ImageConvertOptions = { targetFormat: "png", quality: 1, width: 400, height: 300 };
    await convertImage(file, opts);

    expect(mockCanvas.width).toBe(400);
    expect(mockCanvas.height).toBe(300);
    expect(mockCtx.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      400,
      300,
    );
  });


  it("handles TIFF files by decoding via utif2", async () => {
    const file = makeFile("scan.tiff", "image/tiff");
    const opts: ImageConvertOptions = { targetFormat: "png", quality: 1 };
    await convertImage(file, opts);

    expect(UTIF.decode).toHaveBeenCalled();
    expect(UTIF.decodeImage).toHaveBeenCalled();
    expect(UTIF.toRGBA8).toHaveBeenCalled();
  });

  it("reads TIFF dimensions only after decodeImage has populated them", async () => {
    // Real utif2 leaves width/height undefined until decodeImage runs, so a
    // regression that reads them straight off decode()'s IFD would size the
    // canvas NaN x NaN. A decodeImage that populates nothing must break the run.
    vi.mocked(UTIF.decodeImage).mockImplementationOnce(() => {});

    const file = makeFile("scan.tiff", "image/tiff");
    const opts: ImageConvertOptions = { targetFormat: "png", quality: 1 };
    // With no dimensions on the IFD the canvas is sized undefined x undefined
    // and the RGBA copy overruns a zero-length buffer — the browser-side
    // symptom of reading the tags too early, surfaced here as a rejection.
    await expect(convertImage(file, opts)).rejects.toThrow();
    expect(mockCtx.createImageData).toHaveBeenCalledWith(undefined, undefined);
  });

  it("sets RGBA data into imageData when converting TIFF", async () => {
    const rgbaData = new Uint8Array(100 * 80 * 4);
    rgbaData[0] = 255; // mark first pixel red channel
    vi.mocked(UTIF.toRGBA8).mockReturnValueOnce(rgbaData);

    const file = makeFile("scan.tiff", "image/tiff");
    const opts: ImageConvertOptions = { targetFormat: "png", quality: 1 };
    await convertImage(file, opts);

    // createImageData should have been called with TIFF dimensions
    expect(mockCtx.createImageData).toHaveBeenCalledWith(100, 80);
    // putImageData should have been called with imageData containing the RGBA bytes
    expect(mockCtx.putImageData).toHaveBeenCalled();
    const imageDataArg = mockCtx.putImageData.mock.calls[0][0] as { data: Uint8Array };
    expect(imageDataArg.data[0]).toBe(255);
  });

  it("handles .tif extension as TIFF", async () => {
    const file = makeFile("scan.tif", "image/tiff");
    const opts: ImageConvertOptions = { targetFormat: "jpeg", quality: 0.8 };
    await convertImage(file, opts);

    expect(UTIF.decode).toHaveBeenCalled();
  });

  it("warns when a TIFF has more pages than the one it keeps", async () => {
    vi.mocked(UTIF.decode).mockReturnValueOnce([
      { t256: [100], t257: [80] },
      { t256: [50], t257: [40] },
      { t256: [25], t257: [20] },
    ] as unknown as ReturnType<typeof UTIF.decode>);

    // vi.restoreAllMocks leaves factory-made vi.fn history alone, so count
    // this test's decodeImage calls as a delta from here.
    vi.mocked(UTIF.decodeImage).mockClear();

    const file = makeFile("scan.tiff", "image/tiff");
    const opts: ImageConvertOptions = { targetFormat: "png", quality: 1 };
    const result = await convertImage(file, opts);

    expect(result.warnings).toEqual([
      "This TIFF has 3 pages — only the first page was kept.",
    ]);
    // Only page 0 is decoded — eager decode of every page would OOM real scans.
    expect(UTIF.decodeImage).toHaveBeenCalledTimes(1);
  });

  it("attaches no warnings for a single-page TIFF", async () => {
    const file = makeFile("scan.tiff", "image/tiff");
    const opts: ImageConvertOptions = { targetFormat: "png", quality: 1 };
    const result = await convertImage(file, opts);

    expect(result.warnings).toBeUndefined();
  });

  it("surfaces the exact animated-GIF and animated-WebP warnings — real bytes, real sniffer", async () => {
    const opts: ImageConvertOptions = { targetFormat: "jpeg", quality: 0.8 };

    const gif = new File([gifBytes(2)], "anim.gif", { type: "image/gif" });
    expect((await convertImage(gif, opts)).warnings).toEqual([ANIMATED_GIF_WARNING]);

    const webp = new File([animatedWebpBytes()], "anim.webp", { type: "image/webp" });
    expect((await convertImage(webp, opts)).warnings).toEqual([ANIMATED_WEBP_WARNING]);

    // A still, single-frame GIF converts without any notice.
    const still = new File([gifBytes(1)], "still.gif", { type: "image/gif" });
    expect((await convertImage(still, opts)).warnings).toBeUndefined();
  });

  it("throws when TIFF has no IFDs", async () => {
    vi.mocked(UTIF.decode).mockReturnValueOnce([]);

    const file = makeFile("bad.tiff", "image/tiff");
    const opts: ImageConvertOptions = { targetFormat: "png", quality: 1 };

    await expect(convertImage(file, opts)).rejects.toThrow("Could not decode TIFF file");
  });

  it("handles SVG files by wrapping with correct MIME type", async () => {
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    const file = new File([svgContent], "icon.svg", { type: "image/svg+xml" });
    const opts: ImageConvertOptions = { targetFormat: "png", quality: 1 };
    const result = await convertImage(file, opts);

    expect(result.fileName).toBe("icon.png");
  });

  it("strips old extension from multi-dot filenames", async () => {
    const file = makeFile("my.photo.backup.png");
    const opts: ImageConvertOptions = { targetFormat: "webp", quality: 0.9 };
    const result = await convertImage(file, opts);

    expect(result.fileName).toBe("my.photo.backup.webp");
  });

  it("passes quality to canvas.toBlob", async () => {
    const file = makeFile("photo.png");
    const opts: ImageConvertOptions = { targetFormat: "jpeg", quality: 0.5 };
    await convertImage(file, opts);

    // The toBlob mock is on the main output canvas (second call for TIFF skipped here)
    expect(mockCanvas.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      "image/jpeg",
      0.5,
    );
  });

  it("revokes object URL after image loads", async () => {
    const file = makeFile("photo.png");
    const opts: ImageConvertOptions = { targetFormat: "png", quality: 1 };
    await convertImage(file, opts);

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("rejects when canvas.toBlob returns null", async () => {
    mockCanvas.toBlob = vi.fn().mockImplementation((cb: (b: Blob | null) => void) => {
      cb(null);
    });

    const file = makeFile("photo.png");
    const opts: ImageConvertOptions = { targetFormat: "jpeg", quality: 0.8 };
    await expect(convertImage(file, opts)).rejects.toThrow("Canvas export failed");
  });

  it("rejects when image fails to load", async () => {
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
          setTimeout(() => { if (self.onerror) (self.onerror as () => void)(); }, 0);
        },
      });
      return this as unknown as HTMLImageElement;
    } as unknown as () => HTMLImageElement);

    const file = makeFile("bad.png");
    const opts: ImageConvertOptions = { targetFormat: "jpeg", quality: 0.8 };
    await expect(convertImage(file, opts)).rejects.toThrow("Failed to load image");
  });

  it("rejects when canvas context is null", async () => {
    mockCanvas.getContext = vi.fn().mockReturnValue(null);

    const file = makeFile("photo.png");
    const opts: ImageConvertOptions = { targetFormat: "png", quality: 1 };
    await expect(convertImage(file, opts)).rejects.toThrow("Canvas 2D context not available");
  });
});

/*
  Dimensionless SVGs (viewBox only) report naturalWidth 0 and used to produce
  a 0×0 PNG. The raster fallback is pure string parsing — tested directly.
*/
import { svgFallbackSize } from "@/lib/tools/image-convert";

describe("svgFallbackSize", () => {
  it("scales a viewBox to a 1024px longest edge, marked non-explicit", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120"></svg>`;
    expect(svgFallbackSize(svg)).toEqual({ width: 1024, height: 512, explicit: false });
  });

  it("returns explicit width/height attributes unscaled", () => {
    const svg = `<svg width="240" height="120" viewBox="0 0 20 10"></svg>`;
    // An author-chosen 240px must never be inflated to 1024.
    expect(svgFallbackSize(svg)).toEqual({ width: 240, height: 120, explicit: true });
  });

  it("never scales DOWN an already-large viewBox", () => {
    const svg = `<svg viewBox="0 0 4096 2048"></svg>`;
    expect(svgFallbackSize(svg)).toEqual({ width: 4096, height: 2048, explicit: false });
  });

  it("handles negative viewBox origins", () => {
    const svg = `<svg viewBox="-10 -5 200 100"></svg>`;
    expect(svgFallbackSize(svg)).toEqual({ width: 1024, height: 512, explicit: false });
  });

  it("returns null for percentage-only or missing dimensions", () => {
    expect(svgFallbackSize(`<svg width="100%" height="100%"></svg>`)).toBeNull();
    expect(svgFallbackSize(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`)).toBeNull();
    expect(svgFallbackSize(`not svg at all`)).toBeNull();
  });
});

describe("convertImage — HEIC", () => {
  /*
   * The decoder module is memoised at module scope (one fetch per tab), so a
   * second test in the same module graph would silently reuse the FIRST test's
   * decoder and assert nothing. Resetting the graph per test is what makes
   * each of these independent — and it is also the only way to exercise the
   * load failures, which are states of that memo.
   */
  async function freshConvertImage() {
    return (await import("@/lib/tools/image-convert")).convertImage;
  }

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    installLibheif();
    setupCanvasMock();
    setupImageMock();
  });

  it("handles HEIC files by decoding with libheif", async () => {
      const decode = installLibheif();
      const file = makeFile("photo.heic", "image/heic");
      const opts: ImageConvertOptions = { targetFormat: "jpeg", quality: 0.9 };
      await (await freshConvertImage())(file, opts);
  
      // The decoder is handed the file's BYTES, not the Blob: libheif's binding
      // takes a Uint8Array, and passing it a Blob decodes nothing while throwing
      // nothing either.
      expect(decode).toHaveBeenCalledOnce();
      expect(decode.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
    });
  
    it("handles HEIF files by decoding with libheif", async () => {
      const decode = installLibheif();
      const file = makeFile("photo.heif", "image/heif");
      const opts: ImageConvertOptions = { targetFormat: "png", quality: 1 };
      await (await freshConvertImage())(file, opts);
  
      expect(decode).toHaveBeenCalledOnce();
    });
  
    /*
     * THIS TEST REPLACES ITS OWN OPPOSITE. Until 2026-09-12 it was called
     * "handles heic2any returning an array" and it asserted that the second
     * image was silently discarded and that no warning was produced — it PINNED
     * the silent-loss bug that Wave 0 purged everywhere else (animated GIF/WebP
     * frame 0, multi-page TIFF page 1). A HEIC holding a burst now says so.
     */
    it("keeps the primary image of a multi-image HEIC and warns about the rest", async () => {
      installLibheif([heifImage(false, 8, 8), heifImage(true, 4, 4), heifImage(false, 8, 8)]);
  
      const file = makeFile("burst.heic", "image/heic");
      const result = await (await freshConvertImage())(file, { targetFormat: "jpeg", quality: 0.8 });
  
      expect(result.fileName).toBe("burst.jpg");
      expect(result.warnings).toEqual(["This HEIC holds 3 images — only the main one was kept."]);
    });
  
    it("takes the image the file marks primary, not index 0", async () => {
      // The decoder we used until 2026-09-12 always took [0]. Nothing requires
      // the primary picture to be first, which is why the shipped copy's promise
      // of "the main image" was not reliably true before this.
      const notPrimary = heifImage(false, 8, 8);
      const primary = heifImage(true, 4, 4);
      installLibheif([notPrimary, primary]);
  
      await (await freshConvertImage())(makeFile("burst.heic", "image/heic"), { targetFormat: "png", quality: 1 });
  
      // The decode canvas is sized from the PRIMARY handle (4x4), not from the
      // 8x8 sitting at index 0. Asserted on createImageData because the mock
      // canvas is shared with the later output draw, which resizes it.
      expect(mockCtx.createImageData).toHaveBeenCalledWith(4, 4);
      expect(mockCtx.createImageData).not.toHaveBeenCalledWith(8, 8);
      expect(notPrimary.free).toHaveBeenCalled();
      expect(primary.free).toHaveBeenCalled();
    });
  
    it("frees the wasm context, which the library will not do for us", async () => {
    /*
      `HeifDecoder.decode()` frees the previous context only when called AGAIN
      on the SAME instance, and decodeHeic makes a fresh one per file (it must —
      the handles outlive an await, so a shared instance would let a concurrent
      decode free them). So without an explicit free the whole file stays in the
      wasm heap: measured at 400 decodes of an 82,878-byte photo, 16.3 MB ->
      48.6 MB leaked, versus flat with the free.
    */
    installLibheif();

    await (await freshConvertImage())(makeFile("photo.heic", "image/heic"), {
      targetFormat: "png",
      quality: 1,
    });

    expect(contextFree).toHaveBeenCalledWith(0xc0ffee);
  });

  it("frees the wasm context even when the decode throws", async () => {
    // The leak is worst exactly where errors are: a user re-dropping a file
    // that fails is the retry loop that fills the heap fastest.
    installLibheif([]);

    await expect(
      (await freshConvertImage())(makeFile("empty.heic", "image/heic"), {
        targetFormat: "png",
        quality: 1,
      }),
    ).rejects.toThrow("This file has no image inside it");

    expect(contextFree).toHaveBeenCalled();
  });

  it("frees every decoded handle, including the ones it discards", async () => {
      // wasm heap allocations: a batch of bursts would otherwise grow the heap
      // until it aborted. Same lesson as the TIFF per-page retention fixed in
      // Wave 1.
      const images = [heifImage(true), heifImage(false), heifImage(false)];
      installLibheif(images);
  
      await (await freshConvertImage())(makeFile("burst.heic", "image/heic"), { targetFormat: "png", quality: 1 });
  
      for (const image of images) expect(image.free).toHaveBeenCalledOnce();
    });
  
    it("reports a clear failure when the vendored decoder registers no global", async () => {
      // The way HEIC fails now that the decoder is fetched rather than bundled:
      // the script loads (or is cached) but leaves nothing on globalThis —
      // exactly what `import()` of this UMD file would produce. Without this
      // guard the next line would be `undefined is not a function`, which tells
      // a user nothing.
      installLibheif();
      delete (globalThis as { libheif?: Mock }).libheif;
  
      const file = makeFile("photo.heic", "image/heic");
      const opts: ImageConvertOptions = { targetFormat: "jpeg", quality: 0.9 };
      await expect((await freshConvertImage())(file, opts)).rejects.toThrow(
        "Could not load the HEIC decoder",
      );
    });
  
    it("reports a clear failure when the decoder script itself will not load", async () => {
      /*
        ⚠ THE GLOBAL IS LEFT IN PLACE ON PURPOSE. Deleting it, as this test
        first did, makes the conversion fail through the missing-global branch
        instead — same message, different code path — so the script's `onerror`
        handler could be deleted entirely and the test would still pass. With a
        working global present, ONLY the onerror rejection can fail this.
      */
      installLibheif();
      installScriptLoader("error");

      await expect(
        (await freshConvertImage())(makeFile("photo.heic", "image/heic"), { targetFormat: "jpeg", quality: 0.9 }),
      ).rejects.toThrow("Could not load the HEIC decoder");
    });

    it("reports a clear failure when the binary will not load", async () => {
      // The third way the two-file load can fail, and the one a stub that
      // always resolves would never reach: the glue arrives, the .wasm 404s.
      installLibheif();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

      await expect(
        (await freshConvertImage())(makeFile("photo.heic", "image/heic"), { targetFormat: "jpeg", quality: 0.9 }),
      ).rejects.toThrow("Could not load the HEIC decoder");
    });

    it("reports a clear failure when the decoder cannot render the image", async () => {
      // display() hands back null rather than throwing, so an unguarded
      // pipeline would putImageData(null) and surface a DOM TypeError instead.
      const broken = heifImage(true);
      broken.display = (_into, done) => done(null);
      installLibheif([broken]);

      await expect(
        (await freshConvertImage())(makeFile("photo.heic", "image/heic"), { targetFormat: "jpeg", quality: 0.9 }),
      ).rejects.toThrow("Could not decode this HEIC image");
    });
});
