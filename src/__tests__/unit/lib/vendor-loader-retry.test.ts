import { describe, it, expect, vi, type Mock } from "vitest";

/*
 * Regression cover for the ONE failure mode that vendoring introduced.
 *
 * lamejs and the HEIC decoder used to be bundled, so "loading the library"
 * could not fail — it was already in the chunk that was running. They are
 * LGPL, and an LGPL library only stays under its own terms while it remains
 * replaceable, so both are now copied verbatim to `public/vendor/` and fetched
 * at first use. That buys compliance and costs a network request, and a
 * network request can fail: a dropped connection, a cold cache on a flaky
 * phone, a deploy racing a page that is already open.
 *
 * The two loaders do NOT share a mechanism, and that is the point of testing
 * both. lamejs is reached with `import()`, so its enemy is the realm's MODULE
 * MAP. libheif's UMD is unreachable through `import()` — an empty namespace
 * and no global — so it is loaded with a classic <script> tag, whose enemy is
 * the HTTP CACHE. Same cure, two different caches, and the query-string retry
 * is what defeats each.
 *
 * Recovering from that takes TWO things, and each is useless without the other:
 *
 *   1. Drop our own memo. The obvious spelling, `cache ??= import(url)`, caches
 *      the REJECTED promise, so every later attempt in the tab replays the same
 *      rejection for the whole session.
 *   2. Retry against a URL the browser has not already condemned. A module that
 *      fails to fetch is recorded as failed in the realm's module map, and a
 *      later `import()` of that same specifier rejects straight from the map
 *      without touching the network — measured in Chromium and WebKit, where a
 *      same-URL retry after a 503 made no second request at all and a
 *      query-string-distinguished URL fetched and succeeded. Hence the attempt
 *      counter in `vendorUrl`.
 *
 * These two tests pin both halves: under `??=` the second call never re-imports,
 * and without the counter the retry would ask for the dead specifier.
 *
 * Each loader is exercised in its own file-level mock because both memos are
 * module-private state; `vi.hoisted` carries the mutable flag into the hoisted
 * factory legally.
 */

const lame = vi.hoisted(() => ({ failNext: true, imports: 0 }));

function lamejsModule() {
  lame.imports++;
  if (lame.failNext) throw new Error("simulated network failure");
  return {
    Mp3Encoder: class {
      encodeBuffer() {
        return new Uint8Array([0xff, 0xfb]);
      }
      flush() {
        return new Uint8Array([0x00]);
      }
    },
  };
}

// BOTH specifiers are mocked on purpose. The retry deliberately asks for a
// DIFFERENT url — see vendorUrl in lib/tools/audio-pcm.ts — because a browser
// records a failed module fetch against the specifier and will not re-request
// it. Mocking only the bare path would make this test pass for the wrong
// reason on the first attempt and fail on the retry.
vi.mock("/vendor/lamejs.js", () => lamejsModule());
vi.mock("/vendor/lamejs.js?retry=1", () => lamejsModule());

/*
 * The HEIC half is driven through the DOM rather than through vi.mock, because
 * the loader does not import anything: it appends a <script> and then fetches
 * the .wasm. `requested` records every URL it asks for, which is what proves
 * the retry went to a DIFFERENT one.
 */
const heic = vi.hoisted(() => ({ failNext: true, requested: [] as string[] }));

function installHeicScriptLoader(): void {
  const createElement = document.createElement.bind(document);
  // jsdom has no 2D context, and unlike the decoder it replaced this loader's
  // success path draws the decoded pixels to a canvas before handing back a
  // PNG. Stub just enough of one for the happy path to reach the blob.
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
    }),
    toBlob: (cb: (b: Blob | null) => void, type: string) => cb(new Blob(["png"], { type })),
  };
  vi.spyOn(document, "createElement").mockImplementation((tag: string) =>
    tag === "canvas" ? (canvas as unknown as HTMLCanvasElement) : createElement(tag),
  );
  vi.spyOn(document.head, "appendChild").mockImplementation((node: Node) => {
    const el = node as HTMLScriptElement;
    // jsdom resolves `script.src` against the document base, so record the
    // path the loader actually asked for rather than the absolute URL.
    heic.requested.push(el.src.replace(/^https?:\/\/[^/]+/, ""));
    queueMicrotask(() => {
      if (heic.failNext) {
        el.onerror?.call(el, new Event("error"));
        return;
      }
      // A real classic script assigns the sloppy-mode global as it evaluates.
      (globalThis as { libheif?: Mock }).libheif = vi.fn().mockResolvedValue({
        // The context pointer and its free are part of the real binding, and
        // decodeHeic frees it on every decode — see the leak note there.
        heif_context_free: vi.fn(),
        HeifDecoder: class {
          decoder: number | null = null;
          decode() {
            this.decoder = 0xc0ffee;
            return [
              {
                get_width: () => 2,
                get_height: () => 2,
                is_primary: () => true,
                display: (into: ImageData, done: (out: ImageData | null) => void) =>
                  done({ data: new Uint8ClampedArray(16).fill(255), width: 2, height: 2 } as ImageData),
                free: vi.fn(),
              },
            ];
          }
        },
      });
      el.onload?.call(el, new Event("load"));
    });
    return node;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (url: string) => {
      heic.requested.push(String(url));
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    }),
  );
}

describe("vendored library loaders recover from a failed fetch", () => {
  it("lamejs: a second encode after a failed load actually re-imports and succeeds", async () => {
    const { encodePcmToMp3 } = await import("@/lib/tools/audio-pcm");
    const pcm = [new Float32Array(4096)];

    await expect(encodePcmToMp3(pcm, 44100, 128)).rejects.toThrow();
    expect(lame.imports).toBe(1);

    lame.failNext = false;
    const blob = await encodePcmToMp3(pcm, 44100, 128);

    // Re-imported rather than replaying the cached rejection.
    expect(lame.imports).toBe(2);
    expect(blob.type).toBe("audio/mpeg");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("libheif: a second conversion after a failed load actually re-fetches and succeeds", async () => {
    delete (globalThis as { libheif?: Mock }).libheif;
    installHeicScriptLoader();
    const { toDecodableSource } = await import("@/lib/tools/image-convert");
    const file = new File([new Uint8Array([0, 1, 2])], "photo.heic", { type: "image/heic" });

    await expect(toDecodableSource(file)).rejects.toThrow("Could not load the HEIC decoder");
    expect(heic.requested).toEqual(["/vendor/libheif.js"]);

    heic.failNext = false;
    const { blob } = await toDecodableSource(file);

    expect(blob.type).toBe("image/png");
    // Re-requested rather than replaying the memoised rejection, AND against a
    // URL the HTTP cache has not already condemned — both halves, as above.
    expect(heic.requested).toEqual([
      "/vendor/libheif.js",
      "/vendor/libheif.js?retry=1",
      "/vendor/libheif.wasm?retry=1",
    ]);
  });
});
