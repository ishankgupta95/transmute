import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

import {
  ENGINE_BUNDLES,
  TOOLS_NEEDING_FFMPEG,
  TOOLS_NEEDING_ONLY_SMALL_ENGINES,
  TOOLS_WHERE_FFMPEG_IS_A_FALLBACK,
  TOOLS_WITHOUT_ENGINES,
  TOOLS_WITH_ENGINES,
  addBundle,
  cachedBundleIds,
  clearAllOffline,
  everyBundleUrlIsAnEngineUrl,
  formatEngineBytes,
  removeBundle,
  storageEstimate,
  supportsOffline,
  totalBundleBytes,
  type EngineBundle,
} from "@/lib/pwa/offline";
import { ENGINE_CACHE, ENGINE_DIRS, ENGINE_FILES, OWNED_CACHES, SHELL_CACHE } from "@/lib/pwa/sw-policy";
import { tools } from "@/data/tools";

/*
  offline.ts is the only code in this repo that writes an engine binary into
  storage, and the two things it must never do are the two things this file
  spends most of its length on:

    1. REMEMBER that a bundle is cached. Storage eviction is per-origin and
       total, and it fires no event, so any answer that is older than the
       question is a guess. `describe("cachedBundleIds derives, it does not
       remember")` runs the same call twice across an eviction and requires the
       second answer to differ from the first — which a memoised
       implementation cannot do.

    2. LEAVE HALF A BUNDLE BEHIND. A 32 MB FFmpeg that is 60% stored reads as
       present to any check that looks for one file, and then fails at the one
       moment there is no network to recover with. `describe("addBundle leaves
       nothing behind")` fails the second of two URLs every way a URL can fail
       — a 404, a thrown fetch, a rejected cache write, an abort — and requires
       the cache to be EMPTY afterwards, not merely inconsistent.

  The byte counts and the URL list are not asserted against typed-in numbers.
  They are derived from `package.json`'s own `copy:wasm` command, which is the
  definition of what this origin serves at its root, and from `statSync` on the
  artifacts that command copies. Bump a dependency and this file goes red until
  someone re-measures — the mechanism engine-disclosure.test.ts uses for the
  homepage's DOWNLOAD column, pointed at a different consumer of the same files.
*/

/* ── The artifacts, derived from the build command ────────────────────────── */

const root = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

/**
 * `copy:wasm` is a chain of `cp <sources…> <dest>` steps joined by `&&`. Each
 * one says "these files become the origin root / an origin subdirectory", so
 * parsing it yields the exact URL set a browser can ask this site for, mapped
 * to the file whose bytes answer.
 *
 * Non-`cp` steps are skipped deliberately: `mkdir -p` creates the directory and
 * `node scripts/build-workers.mjs` emits `public/sw.js` and the worker bundles,
 * which are code this site wrote rather than engines it vendored — they are the
 * shell cache's business, not this module's.
 */
function servedArtifacts(): Map<string, string> {
  const served = new Map<string, string>();
  for (const step of pkg.scripts["copy:wasm"].split("&&").map((s) => s.trim())) {
    if (!step.startsWith("cp ")) continue;
    const parts = step.slice(3).trim().split(/\s+/);
    const dest = parts.pop();
    if (!dest?.startsWith("public/")) throw new Error(`unexpected cp destination: ${dest}`);
    const prefix = `${dest.replace(/^public/, "").replace(/\/$/, "")}/`;
    for (const source of parts) served.set(`${prefix}${basename(source)}`, source);
  }
  return served;
}

const SERVED = servedArtifacts();

/** Sanity: a parser that silently matched nothing would make every check below vacuous. */
it("parses the copy:wasm command it derives everything else from", () => {
  expect(SERVED.size).toBeGreaterThan(10);
  expect(SERVED.get("/ffmpeg-core.wasm")).toBe(
    "node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm",
  );
  expect(SERVED.get("/vendor/lamejs.js")).toBe("node_modules/@breezystack/lamejs/dist/lamejs.js");
  expect(SERVED.get("/fonts/print/syne-latin-wght-normal.woff2")).toContain("@fontsource-variable");
});

describe("the bundles are the files this origin actually serves", () => {
  const declared = ENGINE_BUNDLES.flatMap((b) => b.urls);

  it("names every artifact copy:wasm stages, and invents none", () => {
    expect([...declared].sort()).toEqual([...SERVED.keys()].sort());
  });

  it("puts each URL in exactly one bundle", () => {
    // A URL in two bundles would make `removeBundle` on one of them silently
    // break the other — the partial-bundle failure by another route.
    expect(new Set(declared).size).toBe(declared.length);
  });

  it("declares each bundle's bytes as the sum of the files on disk", () => {
    for (const bundle of ENGINE_BUNDLES) {
      const measured = bundle.urls.reduce((sum, url) => {
        const source = SERVED.get(url);
        if (!source) throw new Error(`${url} is not staged by copy:wasm`);
        return sum + statSync(resolve(root, source)).size;
      }, 0);
      expect(bundle.bytes, `${bundle.id} byte count`).toBe(measured);
    }
  });
});

describe("the page and the worker agree about what an engine is", () => {
  /*
    THE DRIFT THIS EXISTS TO STOP. The worker serves an engine out of
    ENGINE_CACHE only for URLs `isEngineUrl` recognises; everything else it
    routes to the shell cache. So a bundle URL the worker does not classify as
    an engine would be downloaded on request, stored, counted as present — and
    never handed to anyone, because the request for it would be answered from
    a different cache that has never seen it. The bytes would be spent and the
    tool would still fail offline.

    sw-policy.ts is the authority: it is what the worker runs.
  */
  const ORIGIN = "https://transmute.tools";

  it("classifies every bundle URL as an engine URL", () => {
    expect(everyBundleUrlIsAnEngineUrl(ORIGIN)).toBe(true);
  });

  it("covers exactly the origin-root files sw-policy lists", () => {
    const rootUrls = ENGINE_BUNDLES.flatMap((b) => b.urls).filter(
      (url) => url.lastIndexOf("/") === 0,
    );
    expect([...rootUrls].sort()).toEqual([...ENGINE_FILES].sort());
  });

  it("covers every engine directory sw-policy widens the match to", () => {
    const declared = ENGINE_BUNDLES.flatMap((b) => b.urls);
    for (const dir of ENGINE_DIRS) {
      expect(
        declared.some((url) => url.startsWith(dir)),
        `no bundle claims anything under ${dir}, so nothing can ever store it`,
      ).toBe(true);
    }
  });
});

describe("the shape of the choice", () => {
  /*
    The page leads with these four numbers, so they have to add up to the
    registry rather than to each other. A tool added without re-deriving the
    split lands here first.
  */
  it("accounts for every registered tool exactly once", () => {
    expect(TOOLS_WITHOUT_ENGINES + TOOLS_WITH_ENGINES).toBe(tools.length);
    expect(tools.length).toBe(179);
  });

  it("splits the engine-needing tools into FFmpeg and everything else", () => {
    expect(TOOLS_NEEDING_FFMPEG + TOOLS_NEEDING_ONLY_SMALL_ENGINES).toBe(TOOLS_WITH_ENGINES);
    const ffmpeg = ENGINE_BUNDLES.find((b) => b.id === "ffmpeg");
    expect(ffmpeg?.toolCount).toBe(TOOLS_NEEDING_FFMPEG);
  });

  it("keeps the runtime-decided audio tools a subset of the FFmpeg tools", () => {
    // audio-decode.ts:411 reaches FFmpeg only after decodeAudioData rejects,
    // so these twelve are inside the 32, not beside them.
    expect(TOOLS_WHERE_FFMPEG_IS_A_FALLBACK).toBeLessThan(TOOLS_NEEDING_FFMPEG);
    expect(TOOLS_WHERE_FFMPEG_IS_A_FALLBACK).toBeGreaterThan(0);
  });

  it("makes everything-except-FFmpeg a twentieth of the bytes", () => {
    const ffmpeg = ENGINE_BUNDLES.find((b) => b.id === "ffmpeg");
    const rest = ENGINE_BUNDLES.filter((b) => b.id !== "ffmpeg");
    expect(ffmpeg).toBeDefined();
    expect(totalBundleBytes(rest) * 5).toBeLessThan(ffmpeg!.bytes);
    expect(totalBundleBytes()).toBe(ffmpeg!.bytes + totalBundleBytes(rest));
  });
});

describe("formatEngineBytes uses the ruler the homepage already uses", () => {
  /*
    Binary prefixes printed with the decimal spelling — not a taste, a
    constraint. These four figures are already on the homepage's DOWNLOAD
    column beside the same artifacts, and they were arrived at that way
    (heic2any: 1.30 MiB reads "1.3 MB"; decimal would be 1.4). A second ruler
    would put two pages of this site in disagreement about one file.
  */
  const bytesOf = (url: string) => statSync(resolve(root, SERVED.get(url)!)).size;

  it("reproduces the existing homepage figures from the artifacts on disk", () => {
    expect(formatEngineBytes(bytesOf("/vendor/heic2any.js"))).toBe("1.3 MB");
    expect(formatEngineBytes(bytesOf("/libarchive.wasm"))).toBe("599 KB");
    expect(formatEngineBytes(bytesOf("/squoosh_oxipng_bg.wasm"))).toBe("160 KB");
    expect(formatEngineBytes(bytesOf("/zxing_reader.wasm"))).toBe("1.0 MB");
    expect(formatEngineBytes(bytesOf("/qpdf.js") + bytesOf("/qpdf.wasm"))).toBe("2.3 MB");
  });

  it("switches unit at the mebibyte, not the megabyte", () => {
    expect(formatEngineBytes(1024 * 1024 - 1)).toBe("1024 KB");
    expect(formatEngineBytes(1024 * 1024)).toBe("1.0 MB");
  });

  it("agrees with the homepage's lamejs row, which this test is why we fixed", () => {
    /*
      This case was written as a MARKER, not a fix: it found that the homepage
      ENGINES row for lamejs read "254 KB" while the file is 259,508 bytes —
      253.43 KiB, so 253 on the column's own ruler and 260 on a decimal one.
      254 was neither. It asserted the wrong value deliberately, so that it
      would go red on the day someone corrected the row.

      That day was the same day. The row now reads "253 KB", and
      engine-disclosure.test.ts pins BOTH vendored rows to their artifacts —
      lamejs and heic2any were the last two ENGINES rows quoting a number
      nothing checked, which is exactly how this one drifted. So the marker has
      done its job and become an ordinary agreement check: two modules, one
      ruler, one artifact.
    */
    expect(formatEngineBytes(bytesOf("/vendor/lamejs.js"))).toBe("253 KB");
    const homepage = readFileSync(resolve(root, "src/app/page.tsx"), "utf8");
    expect(homepage).toContain('name: "lamejs"');
    expect(homepage).toContain('size: "253 KB"');
  });
});

/* ── A Cache API, in memory ───────────────────────────────────────────────── */

/**
 * jsdom implements no Cache API at all (`typeof caches` is "undefined" here),
 * so there is nothing to spy on — it has to be built. This is the smallest
 * thing that behaves like one for the four operations offline.ts performs, and
 * it records every call so a test can prove a read really happened rather than
 * being answered from somewhere in the module.
 */
interface StubCache {
  store: Map<string, Response>;
  put(url: string, response: Response): Promise<void>;
  match(url: string, options?: { ignoreSearch?: boolean }): Promise<Response | undefined>;
  delete(url: string, options?: { ignoreSearch?: boolean }): Promise<boolean>;
}

interface StubCacheStorage {
  caches: Map<string, StubCache>;
  matchCalls: string[];
  open(name: string): Promise<StubCache>;
  has(name: string): Promise<boolean>;
  delete(name: string): Promise<boolean>;
  match(url: string, options?: { cacheName?: string; ignoreSearch?: boolean }): Promise<Response | undefined>;
}

const stripQuery = (url: string) => url.split("?")[0];

function makeCacheStorage(): StubCacheStorage {
  const store = new Map<string, StubCache>();
  const storage: StubCacheStorage = {
    caches: store,
    matchCalls: [],
    async open(name) {
      let cache = store.get(name);
      if (!cache) {
        const entries = new Map<string, Response>();
        cache = {
          store: entries,
          async put(url, response) {
            entries.set(url, response);
          },
          async match(url, options) {
            if (options?.ignoreSearch) {
              const bare = stripQuery(url);
              for (const [key, value] of entries) if (stripQuery(key) === bare) return value;
              return undefined;
            }
            return entries.get(url);
          },
          async delete(url, options) {
            if (options?.ignoreSearch) {
              const bare = stripQuery(url);
              let hit = false;
              for (const key of [...entries.keys()]) {
                if (stripQuery(key) === bare) hit = entries.delete(key) || hit;
              }
              return hit;
            }
            return entries.delete(url);
          },
        };
        store.set(name, cache);
      }
      return cache;
    },
    async has(name) {
      return store.has(name);
    },
    async delete(name) {
      return store.delete(name);
    },
    async match(url, options) {
      storage.matchCalls.push(url);
      const name = options?.cacheName;
      const targets = name ? [store.get(name)] : [...store.values()];
      for (const cache of targets) {
        if (!cache) continue;
        const hit = await cache.match(url, options);
        if (hit) return hit;
      }
      return undefined;
    },
  };
  return storage;
}

let cacheStorage: StubCacheStorage;

/** Everything currently in ENGINE_CACHE, as plain URLs. */
function engineCacheKeys(): string[] {
  return [...(cacheStorage.caches.get(ENGINE_CACHE)?.store.keys() ?? [])].sort();
}

const FFMPEG = ENGINE_BUNDLES.find((b) => b.id === "ffmpeg") as EngineBundle;
const OXIPNG = ENGINE_BUNDLES.find((b) => b.id === "oxipng") as EngineBundle;

/** Pre-seed a bundle without going through addBundle. */
async function seed(bundle: EngineBundle, urls: readonly string[] = bundle.urls) {
  const cache = await cacheStorage.open(ENGINE_CACHE);
  for (const url of urls) await cache.put(url, new Response(new Uint8Array([1])));
}

beforeEach(() => {
  cacheStorage = makeCacheStorage();
  vi.stubGlobal("caches", cacheStorage);
  // supportsOffline() requires both halves: storage to put an engine in, and a
  // worker to hand it back. jsdom's navigator has no serviceWorker.
  Object.defineProperty(navigator, "serviceWorker", { value: {}, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("supportsOffline", () => {
  it("is true with a Cache API and a service worker", () => {
    expect(supportsOffline()).toBe(true);
  });

  it("is false without the Cache API — an insecure context, or jsdom", () => {
    vi.stubGlobal("caches", undefined);
    expect(supportsOffline()).toBe(false);
  });

  it("is false without a service worker, because storage alone serves nothing", () => {
    Reflect.deleteProperty(navigator, "serviceWorker");
    expect(supportsOffline()).toBe(false);
  });
});

describe("cachedBundleIds derives, it does not remember", () => {
  it("reports nothing when the cache is empty", async () => {
    expect(await cachedBundleIds()).toEqual(new Set());
  });

  it("reports a bundle whose every URL is stored", async () => {
    await seed(OXIPNG);
    expect(await cachedBundleIds()).toEqual(new Set(["oxipng"]));
  });

  it("reports a HALF-stored bundle as absent", async () => {
    // The failure this module exists to prevent, read from the other side: a
    // present ffmpeg-core.js with no ffmpeg-core.wasm beside it must never be
    // reported as an offline FFmpeg.
    await seed(FFMPEG, ["/ffmpeg-core.js"]);
    expect(await cachedBundleIds()).toEqual(new Set());
  });

  it("changes its answer when the cache is evicted between two calls", async () => {
    /*
      THE LOAD-BEARING CASE. Eviction is per-origin and total and fires no
      event, so the only correct implementation re-reads. A memoised one passes
      the first assertion and fails the second — which is exactly what happens
      when a `let cached: Set | null` is added to the module (verified by
      mutation).
    */
    await seed(OXIPNG);
    expect(await cachedBundleIds()).toEqual(new Set(["oxipng"]));

    cacheStorage.caches.delete(ENGINE_CACHE); // the browser reclaims the origin

    expect(await cachedBundleIds()).toEqual(new Set());
  });

  it("reads through caches.match on every call", async () => {
    await seed(OXIPNG);
    await cachedBundleIds();
    const first = cacheStorage.matchCalls.length;
    expect(first).toBeGreaterThan(0);
    await cachedBundleIds();
    expect(cacheStorage.matchCalls.length).toBe(first * 2);
  });

  it("finds a copy stored under a ?retry= URL", async () => {
    // Every engine loader retries with a cache-busting query when a dynamic
    // import has already been condemned in the module map, and the worker
    // looks these up with ignoreSearch. The page must agree with the worker.
    const cache = await cacheStorage.open(ENGINE_CACHE);
    await cache.put("/squoosh_oxipng_bg.wasm?retry=1", new Response(new Uint8Array([1])));
    expect(await cachedBundleIds()).toEqual(new Set(["oxipng"]));
  });

  it("treats a rejecting caches.match as 'not stored' rather than crashing", async () => {
    // Older implementations rejected with NotFoundError when the named cache
    // did not exist. A read that throws where it used to return would take the
    // whole settings page down.
    vi.spyOn(cacheStorage, "match").mockRejectedValue(new DOMException("no", "NotFoundError"));
    await expect(cachedBundleIds()).resolves.toEqual(new Set());
  });

  it("reports nothing at all where offline is unsupported", async () => {
    vi.stubGlobal("caches", undefined);
    expect(await cachedBundleIds()).toEqual(new Set());
  });
});

/* ── addBundle ────────────────────────────────────────────────────────────── */

/** A fetch that answers each URL from `bodies`, or fails it from `failures`. */
function stubFetch(
  bodies: Record<string, ArrayBuffer>,
  failures: Record<string, "404" | "throw"> = {},
) {
  const calls: string[] = [];
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (failures[url] === "throw") throw new TypeError("Failed to fetch");
    if (failures[url] === "404") return new Response("<!doctype html>", { status: 404 });
    return new Response(bodies[url] ?? new ArrayBuffer(7), {
      status: 200,
      headers: { "content-type": "application/wasm" },
    });
  });
  vi.stubGlobal("fetch", impl);
  return { calls, impl };
}

describe("addBundle", () => {
  it("stores every URL, keeping the response's own content-type", async () => {
    stubFetch({});
    await addBundle("ffmpeg");
    expect(engineCacheKeys()).toEqual([...FFMPEG.urls].sort());
    const stored = await (await cacheStorage.open(ENGINE_CACHE)).match("/ffmpeg-core.wasm");
    // instantiateStreaming refuses anything that is not application/wasm, so
    // the header has to survive the round trip through the cache.
    expect(stored?.headers.get("content-type")).toBe("application/wasm");
  });

  it("bypasses the HTTP cache, which GitHub Pages holds for ten minutes", async () => {
    const { impl } = stubFetch({});
    await addBundle("oxipng");
    expect(impl).toHaveBeenCalledWith(
      "/squoosh_oxipng_bg.wasm",
      expect.objectContaining({ cache: "reload" }),
    );
  });

  it("reports progress that rises to exactly 1", async () => {
    stubFetch({
      "/ffmpeg-core.js": new ArrayBuffer(1000),
      "/ffmpeg-core.wasm": new ArrayBuffer(4000),
    });
    const seen: number[] = [];
    await addBundle("ffmpeg", (f) => seen.push(f));
    expect(seen.length).toBeGreaterThan(1);
    expect(seen).toEqual([...seen].sort((a, b) => a - b)); // monotonic
    expect(seen.at(-1)).toBe(1);
    expect(Math.max(...seen)).toBeLessThanOrEqual(1);
  });

  it("does nothing, and fetches nothing, when the bundle is already stored", async () => {
    await seed(OXIPNG);
    const { calls } = stubFetch({});
    await addBundle("oxipng");
    expect(calls).toEqual([]);
  });

  it("refuses where the Cache API is absent instead of pretending", async () => {
    vi.stubGlobal("caches", undefined);
    await expect(addBundle("oxipng")).rejects.toThrow(/Cache API/);
  });

  it("rejects an unknown bundle id", async () => {
    await expect(addBundle("nope" as EngineBundle["id"])).rejects.toThrow(/Unknown engine bundle/);
  });
});

describe("addBundle leaves nothing behind", () => {
  /*
    Four ways the second half of a two-file bundle can fail. In every one of
    them the assertion is the same and it is absolute: the engine cache is
    EMPTY afterwards. Not "inconsistent", not "missing the second file" —
    empty, because the first file is bytes the user did not ask to keep and a
    surviving ffmpeg-core.js is exactly what would make a later
    `cachedBundleIds` have to reason about halves.
  */
  it("cleans up when the second URL answers 404", async () => {
    // Measured on this site's own host: a missing file on GitHub Pages answers
    // 404 with a 40 KB HTML error page, which is a perfectly valid Response.
    stubFetch({}, { "/ffmpeg-core.wasm": "404" });
    await expect(addBundle("ffmpeg")).rejects.toThrow(/404/);
    expect(engineCacheKeys()).toEqual([]);
  });

  it("cleans up when the second fetch throws", async () => {
    stubFetch({}, { "/ffmpeg-core.wasm": "throw" });
    await expect(addBundle("ffmpeg")).rejects.toThrow(/Failed to fetch/);
    expect(engineCacheKeys()).toEqual([]);
  });

  it("cleans up when the cache write itself fails", async () => {
    stubFetch({});
    const cache = await cacheStorage.open(ENGINE_CACHE);
    const realPut = cache.put.bind(cache);
    let n = 0;
    cache.put = async (url, response) => {
      if (++n === 2) throw new DOMException("Quota exceeded", "QuotaExceededError");
      return realPut(url, response);
    };
    await expect(addBundle("ffmpeg")).rejects.toThrow(/Quota exceeded/);
    // `cache.put` is still the throwing stub, but removal is `cache.delete`.
    expect(engineCacheKeys()).toEqual([]);
  });

  it("cleans up when the user cancels mid-download", async () => {
    const controller = new AbortController();
    const bodies = { "/ffmpeg-core.js": new ArrayBuffer(10) };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        // Cancel once the small half is in: the abort now has something to
        // clean up, which is the case that matters.
        if (url === "/ffmpeg-core.js") {
          return new Response(bodies["/ffmpeg-core.js"], { status: 200 });
        }
        controller.abort();
        throw new DOMException("Aborted", "AbortError");
      }),
    );
    await expect(addBundle("ffmpeg", undefined, controller.signal)).rejects.toThrow(/Aborted/);
    expect(engineCacheKeys()).toEqual([]);
  });

  it("refuses before it starts when the signal is already aborted", async () => {
    const { calls } = stubFetch({});
    const controller = new AbortController();
    controller.abort();
    await expect(addBundle("ffmpeg", undefined, controller.signal)).rejects.toThrow(/Aborted/);
    expect(calls).toEqual([]);
    expect(engineCacheKeys()).toEqual([]);
  });

  it("does not disturb a different bundle while cleaning up", async () => {
    await seed(OXIPNG);
    stubFetch({}, { "/ffmpeg-core.wasm": "throw" });
    await expect(addBundle("ffmpeg")).rejects.toThrow();
    expect(engineCacheKeys()).toEqual([...OXIPNG.urls]);
    expect(await cachedBundleIds()).toEqual(new Set(["oxipng"]));
  });
});

describe("removeBundle", () => {
  it("removes every URL of the bundle", async () => {
    await seed(FFMPEG);
    await removeBundle("ffmpeg");
    expect(engineCacheKeys()).toEqual([]);
    expect(await cachedBundleIds()).toEqual(new Set());
  });

  it("removes a ?retry= copy too", async () => {
    const cache = await cacheStorage.open(ENGINE_CACHE);
    await cache.put("/squoosh_oxipng_bg.wasm?retry=2", new Response(new Uint8Array([1])));
    await removeBundle("oxipng");
    expect(engineCacheKeys()).toEqual([]);
  });

  it("leaves the other bundles alone", async () => {
    await seed(FFMPEG);
    await seed(OXIPNG);
    await removeBundle("oxipng");
    expect(engineCacheKeys()).toEqual([...FFMPEG.urls].sort());
  });

  it("does not create a cache when there is nothing to remove", async () => {
    await removeBundle("ffmpeg");
    expect(cacheStorage.caches.has(ENGINE_CACHE)).toBe(false);
  });
});

describe("clearAllOffline", () => {
  it("deletes every cache the worker considers ours", async () => {
    await seed(FFMPEG);
    await cacheStorage.open(SHELL_CACHE);
    await clearAllOffline();
    expect([...cacheStorage.caches.keys()]).toEqual([]);
    // Stated as the property rather than the two names, so a third owned cache
    // cannot be added to sw-policy and quietly survive the escape hatch.
    for (const name of OWNED_CACHES) expect(cacheStorage.caches.has(name)).toBe(false);
  });

  it("is a no-op, not a crash, without a Cache API", async () => {
    vi.stubGlobal("caches", undefined);
    await expect(clearAllOffline()).resolves.toBeUndefined();
  });
});

describe("storageEstimate", () => {
  it("returns the browser's own numbers", async () => {
    Object.defineProperty(navigator, "storage", {
      value: { estimate: async () => ({ usage: 12, quota: 34 }) },
      configurable: true,
    });
    expect(await storageEstimate()).toEqual({ usage: 12, quota: 34 });
    Reflect.deleteProperty(navigator, "storage");
  });

  it("returns null where the API is missing or partial", async () => {
    expect(await storageEstimate()).toBeNull();
    Object.defineProperty(navigator, "storage", {
      value: { estimate: async () => ({ usage: undefined, quota: 34 }) },
      configurable: true,
    });
    expect(await storageEstimate()).toBeNull();
    Reflect.deleteProperty(navigator, "storage");
  });
});
