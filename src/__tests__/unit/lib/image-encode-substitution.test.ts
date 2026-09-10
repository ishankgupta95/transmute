import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/*
  What the image CLIENT promises about a pool job: the format that comes back
  is the format that was asked for (below), and the memory a job declares is
  something the client can actually stand behind (the last describe).

  THE ENCODER-SUBSTITUTION GATE for the convert path — both of them.

  Per the HTML spec a canvas asked for a type it cannot encode falls back to
  PNG rather than failing, and the Blob it returns reports the type it really
  wrote. WebKit is the live case for WebP: MEASURED in Playwright's WebKit,
  `convertImage` on an SVG with targetFormat "webp" downloaded `logo.webp`
  carrying 42,399 bytes whose first four are `\x89PNG` — 2.8x the 15,216-byte
  WebP Chromium produced for the same drawing, under a name and a page that
  both said WEBP.

  This session added the `blob.type` check to image-crop.ts, image-edit.ts and
  the worker's `edit` op and left the convert op — the path /svg-to-webp,
  /avif-to-webp and /heic-to-webp all take — without one. These two cases pin
  it in both implementations, because a browser lands on one or the other:
  image-convert.ts is the main thread (and the only path for SVG), and
  image-client.ts is the worker path everything else takes.

  Not asserted here: the worker file itself. `image.worker.ts` assigns
  `self.onmessage` at module scope and imports Pica and the oxipng glue, so it
  is not importable under jsdom — the client's refusal is what the worker's
  honest `mime` is FOR, and it is asserted below against a job result shaped
  exactly as the worker posts one.
*/

// ── the main-thread path (lib/tools/image-convert.ts) ────────────

/** A canvas whose encoder writes `writes` no matter what it is asked for. */
function installCanvasWriting(writes: string) {
  const ctx = {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn().mockReturnValue(ctx),
    toBlob: vi.fn().mockImplementation((cb: (b: Blob | null) => void) => {
      cb(new Blob(["encoded"], { type: writes }));
    }),
  };
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "canvas") return canvas as unknown as HTMLCanvasElement;
    return document.createElement(tag);
  });
}

/** An <img> that always decodes, at a real size. */
function installDecodableImage() {
  global.URL.createObjectURL = vi.fn().mockReturnValue("blob:mock");
  global.URL.revokeObjectURL = vi.fn();
  vi.spyOn(global, "Image").mockImplementation(function (this: Record<string, unknown>) {
    this.naturalWidth = 320;
    this.naturalHeight = 240;
    this.onload = null;
    Object.defineProperty(this, "src", {
      set: () => {
        setTimeout(() => (this.onload as (() => void) | null)?.(), 0);
      },
    });
    return this as unknown as HTMLImageElement;
  } as unknown as () => HTMLImageElement);
}

describe("convertImage (main thread) — a substituted encoder is refused, not renamed", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installDecodableImage();
  });

  it("refuses when the browser writes PNG for a WebP request", async () => {
    installCanvasWriting("image/png");
    const { convertImage } = await import("@/lib/tools/image-convert");

    await expect(
      convertImage(new File(["<svg/>"], "logo.png", { type: "image/png" }), {
        targetFormat: "webp",
        quality: 0.9,
      }),
    ).rejects.toThrow("This browser cannot write WEBP images.");
  });

  it("hands back the file when the encoder wrote what was asked for", async () => {
    installCanvasWriting("image/webp");
    const { convertImage } = await import("@/lib/tools/image-convert");

    const result = await convertImage(
      new File(["png"], "logo.png", { type: "image/png" }),
      { targetFormat: "webp", quality: 0.9 },
    );

    expect(result.fileName).toBe("logo.webp");
    expect(result.blob.type).toBe("image/webp");
  });

  it("says nothing when the encoder reports no type at all", async () => {
    // A Blob with an empty type is the encoder declining to say, not a
    // substitution — refusing there would break browsers that work.
    installCanvasWriting("");
    const { convertImage } = await import("@/lib/tools/image-convert");

    const result = await convertImage(
      new File(["png"], "logo.png", { type: "image/png" }),
      { targetFormat: "webp", quality: 0.9 },
    );

    expect(result.fileName).toBe("logo.webp");
  });
});

// ── the worker path (lib/workers/image-client.ts) ────────────────

/**
 * The pool, replaced by one that answers with a crafted job result. The real
 * worker names `mime` from the Blob the encoder returned, so "the browser
 * substituted PNG" is exactly a result whose mime is image/png.
 */
const runJob = vi.fn();
vi.mock("@/lib/workers/pool", () => ({
  WorkerPool: class {
    run(...args: unknown[]) {
      return runJob(...args);
    }
  },
}));

function stubWorkerPipeline() {
  vi.stubGlobal("Worker", function Worker() {});
  vi.stubGlobal("OffscreenCanvas", function OffscreenCanvas() {});
  vi.stubGlobal("createImageBitmap", () => Promise.resolve());
}

function pngFile(): File {
  return new File([new Uint8Array(64)], "logo.png", { type: "image/png" });
}

describe("convertImage (worker) — the requested format is verified, not assumed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubWorkerPipeline();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses a result the encoder wrote as PNG under a WebP request", async () => {
    runJob.mockResolvedValue({
      kind: "blob",
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer,
      mime: "image/png",
      ext: "png",
      width: 320,
      height: 240,
    });
    const { convertImage } = await import("@/lib/workers/image-client");

    await expect(
      convertImage(pngFile(), { targetFormat: "webp", quality: 0.9 }),
    ).rejects.toThrow("This browser cannot write WEBP images.");
  });

  it("passes a result the encoder really wrote as WebP", async () => {
    runJob.mockResolvedValue({
      kind: "blob",
      bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46]).buffer,
      mime: "image/webp",
      ext: "webp",
      width: 320,
      height: 240,
    });
    const { convertImage } = await import("@/lib/workers/image-client");

    const result = await convertImage(pngFile(), { targetFormat: "webp", quality: 0.9 });

    expect(result.fileName).toBe("logo.webp");
    expect(result.blob.type).toBe("image/webp");
  });
});

// ── the admission-control declaration ────────────────────────────

describe("optimisePng — the memory it declares does not pretend to know the pixels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubWorkerPipeline();
    runJob.mockResolvedValue({
      kind: "png",
      bytes: new Uint8Array(8).buffer,
      width: 1200,
      height: 630,
      identical: false,
      level: 2,
      colourBefore: "RGB/8",
      colourAfter: "RGB/8",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Same name and type, two very different pixel counts behind them. */
  function pngOfSize(bytes: number): File {
    const file = new File([new Uint8Array(8)], "shot.png", { type: "image/png" });
    Object.defineProperty(file, "size", { value: bytes });
    return file;
  }

  async function declaredBytesFor(size: number): Promise<number> {
    const { optimisePng } = await import("@/lib/workers/image-client");
    await optimisePng(pngOfSize(size), { level: 2, optimiseAlpha: false });
    return (runJob.mock.calls.at(-1)?.[1] as { memoryBytes: number }).memoryBytes;
  }

  it("charges the same for a 3 KB icon and a 5 MB export", async () => {
    /*
      Bytes cannot tell you pixels. Every real PNG in this repo runs
      0.017–0.227 bytes per pixel, and a flat-colour export is lower still —
      so the estimate this replaced (file.size × 16, from an assumed "1.5
      bytes per pixel") under-counted a 3840×2160 screenshot by 4.2×: 40 MB
      declared against 168 MB MEASURED. A number that moves with the file
      size is the thing being ruled out here, not its exact value.
    */
    const small = await declaredBytesFor(3 * 1024);
    const large = await declaredBytesFor(5 * 1024 * 1024);

    expect(small).toBe(large);
  });

  it("declares the ceiling the engine enforces, at the measured ratio", async () => {
    // 48 MB of decoded raster is what png-optimise.ts admits; ≈8× is the
    // MEASURED heap-to-raster ratio (298 MB on a 34.3 MB raster).
    expect(await declaredBytesFor(171_221)).toBe(48_000_000 * 8);
  });
});

/*
  THE OTHER HALF OF THE SPLIT — compress and resize FOLLOW the encoder.

  convert refuses a substitution because the format there is the user's
  explicit choice. The compressor and the resizer never asked the user: they
  pick an alpha-safe default themselves (WebP for a transparent source, PNG for
  a resized PNG), so refusing would fail a request nobody made. The honest
  answer is to name the file for what is really in it.

  Both of these are the MAIN-THREAD mirrors, which run when the browser has no
  OffscreenCanvas — and a browser old enough to lack it is exactly a browser
  old enough to lack WebP encoding, so this is the reachable pairing, not a
  contrived one.
*/
describe("compress and resize name the file from what the encoder wrote", () => {
  it("renames a compressed file when the browser substitutes PNG for WebP", async () => {
    const { writtenFormat } = await import("@/lib/tools/image-convert");
    // A transparent source makes the compressor choose WebP; the browser
    // writes PNG instead and says so on the Blob.
    const substituted = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], {
      type: "image/png",
    });
    expect(writtenFormat(substituted, "image/webp", "webp")).toEqual({
      mime: "image/png",
      ext: "png",
    });
  });

  it("leaves the request standing when the encoder honoured it", async () => {
    const { writtenFormat } = await import("@/lib/tools/image-convert");
    const real = new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46])], { type: "image/webp" });
    expect(writtenFormat(real, "image/webp", "webp")).toEqual({
      mime: "image/webp",
      ext: "webp",
    });
  });

  it("leaves the request standing when the encoder has no opinion", async () => {
    const { writtenFormat } = await import("@/lib/tools/image-convert");
    // jsdom's toBlob returns an empty type; so does a Blob built by hand.
    const opinionless = new Blob([new Uint8Array([1, 2, 3])]);
    expect(writtenFormat(opinionless, "image/webp", "webp")).toEqual({
      mime: "image/webp",
      ext: "webp",
    });
  });

  it("spells a substituted JPEG `jpg`, the way every other output here is spelled", async () => {
    const { writtenFormat } = await import("@/lib/tools/image-convert");
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8])], { type: "image/jpeg" });
    expect(writtenFormat(jpeg, "image/webp", "webp").ext).toBe("jpg");
  });
});
