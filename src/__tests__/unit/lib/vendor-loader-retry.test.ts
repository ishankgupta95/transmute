import { describe, it, expect, vi, type Mock } from "vitest";

/*
 * Regression cover for the ONE failure mode that vendoring introduced.
 *
 * lamejs and heic2any used to be bundled, so "loading the library" could not
 * fail — it was already in the chunk that was running. They are LGPL, and an
 * LGPL library only stays under its own terms while it remains replaceable, so
 * both are now copied verbatim to `public/vendor/` and fetched at first use.
 * That buys compliance and costs a network request, and a network request can
 * fail: a dropped connection, a cold cache on a flaky phone, a deploy racing a
 * page that is already open.
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

const heic = vi.hoisted(() => ({ failNext: true, imports: 0 }));

function heic2anyModule() {
  heic.imports++;
  if (heic.failNext) throw new Error("simulated network failure");
  // The real UMD dist resolves to an EMPTY namespace and assigns itself to the
  // global instead — see the long note in image-convert.test.ts.
  (globalThis as { heic2any?: Mock }).heic2any = vi
    .fn()
    .mockResolvedValue(new Blob(["png-data"], { type: "image/png" }));
  return {};
}

vi.mock("/vendor/heic2any.js", () => heic2anyModule());
vi.mock("/vendor/heic2any.js?retry=1", () => heic2anyModule());

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

  it("heic2any: a second conversion after a failed load actually re-imports and succeeds", async () => {
    delete (globalThis as { heic2any?: Mock }).heic2any;
    const { toDecodableSource } = await import("@/lib/tools/image-convert");
    const file = new File([new Uint8Array([0, 1, 2])], "photo.heic", { type: "image/heic" });

    await expect(toDecodableSource(file)).rejects.toThrow();
    expect(heic.imports).toBe(1);

    heic.failNext = false;
    const { blob } = await toDecodableSource(file);

    expect(heic.imports).toBe(2);
    expect(blob.type).toBe("image/png");
  });
});
