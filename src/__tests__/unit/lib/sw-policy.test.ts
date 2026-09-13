import { describe, it, expect } from "vitest";
import {
  ENGINE_CACHE,
  ENGINE_DIRS,
  ENGINE_FILES,
  OWNED_CACHES,
  SHELL_CACHE,
  isEngineUrl,
  strategyFor,
  type RequestFacts,
  type Strategy,
} from "@/lib/pwa/sw-policy";

/*
  sw-policy.ts is the only testable half of the service worker, and it is the
  half that decides whether a device can be bricked.

  The worker itself cannot be tested here at all — jsdom has no
  ServiceWorkerGlobalScope, no ExtendableEvent and no Cache API — which is
  precisely why every rule was pulled out into a pure module. What is asserted
  below is therefore the whole of the caching policy, not a sample of it.

  THE LOAD-BEARING ASSERTION is `describe("the anti-brick gate")`: a navigation
  and a `.txt` RSC payload must NEVER be answered "cache-first". Both classes
  have un-hashed filenames and bodies that name hashed chunks, the deploy
  replaces the published tree rather than merging into it, and a chunk that is
  gone answers 404 with a 40 KB HTML error page. One cache-first HTML response
  is a device that never recovers.
*/

const ORIGIN = "https://transmute.tools";

function facts(over: Partial<RequestFacts> = {}): RequestFacts {
  return { mode: "no-cors", destination: "", method: "GET", ...over };
}

/** A same-origin GET unless `over` says otherwise. */
function decide(path: string, over: Partial<RequestFacts> = {}): Strategy {
  return strategyFor(new URL(path, ORIGIN), facts(over), ORIGIN);
}

/** What the browser actually sends for a top-level navigation. */
const NAVIGATION: Partial<RequestFacts> = { mode: "navigate", destination: "document" };

/**
 * Real paths from the built export, not invented ones: `out/` holds
 * `merge-pdf.html` + an empty `merge-pdf/` dir while the browser asks for
 * `/merge-pdf`, and the client router asks for `/merge-pdf.txt` beside it.
 */
const REAL_PAGES = ["/", "/merge-pdf", "/compress-image", "/all-tools", "/licenses", "/privacy"];
const REAL_RSC_PAYLOADS = ["/index.txt", "/about.txt", "/merge-pdf.txt", "/_not-found.txt"];

describe("the anti-brick gate", () => {
  it("never answers a navigation from cache first", () => {
    for (const path of REAL_PAGES) {
      expect(decide(path, NAVIGATION)).not.toBe("cache-first");
      expect(decide(path, NAVIGATION)).toBe("network-first");
    }
  });

  it("never answers a .txt RSC payload from cache first", () => {
    for (const path of REAL_RSC_PAYLOADS) {
      // The router fetches these with an ordinary cors request, so `mode` says
      // nothing: the extension is the only signal there is.
      expect(decide(path)).not.toBe("cache-first");
      expect(decide(path)).toBe("network-first");
    }
  });

  it("treats destination:document as a navigation even when mode does not say so", () => {
    // Belt and braces: the gate must not rest on one field being populated.
    expect(decide("/merge-pdf", { mode: "cors", destination: "document" })).toBe("network-first");
  });

  it("keeps a page network-first no matter what query string it carries", () => {
    expect(decide("/merge-pdf?ref=share&tab=advanced", NAVIGATION)).toBe("network-first");
  });

  it("defaults unknown paths to network-first rather than cache-first", () => {
    // A wrong guess must cost a request, never a brick.
    expect(decide("/something-invented-in-2027")).toBe("network-first");
    expect(decide("/workers/pdf.worker.js", { destination: "script" })).toBe("network-first");
    expect(decide("/manifest.webmanifest")).toBe("network-first");
    expect(decide("/favicon.ico?favicon.0rz3~2f6ok0.f.ico")).toBe("network-first");
  });
});

describe("network-only", () => {
  it("never touches a cross-origin request", () => {
    // GA4 is the only one the site makes.
    expect(strategyFor(new URL("https://www.googletagmanager.com/gtag/js"), facts(), ORIGIN)).toBe(
      "network-only",
    );
  });

  it("never touches a non-http(s) URL, whatever its origin claims", () => {
    // MEASURED with the URL parser: `new URL("blob:https://transmute.tools/x")`
    // reports origin "https://transmute.tools" and pathname
    // "https://transmute.tools/x". An origin-only check would call that
    // same-origin and hand it to a caching branch, where `cache.put` rejects.
    const blob = new URL("blob:https://transmute.tools/9c1e-4f");
    expect(blob.origin).toBe(ORIGIN);
    expect(strategyFor(blob, facts(), ORIGIN)).toBe("network-only");
    expect(strategyFor(new URL("data:text/plain,hi"), facts(), ORIGIN)).toBe("network-only");
  });

  it("never touches a non-GET request", () => {
    // The share-target POST. The Cache API stores GET responses only.
    expect(decide("/share-target", { method: "POST", ...NAVIGATION })).toBe("network-only");
    expect(decide("/merge-pdf", { method: "HEAD" })).toBe("network-only");
  });
});

describe("cache-first", () => {
  it("applies to content-hashed assets under /_next/static/", () => {
    // Real names from the built index.html.
    expect(decide("/_next/static/chunks/0w1e1-0y7jo0-.js", { destination: "script" })).toBe(
      "cache-first",
    );
    expect(decide("/_next/static/chunks/11w1cztzw4c8e.css", { destination: "style" })).toBe(
      "cache-first",
    );
    expect(
      decide("/_next/static/media/23b7a97ae3b5c134-s.p.0o14nraug8u5s.woff2", {
        destination: "font",
      }),
    ).toBe("cache-first");
  });

  it("does not apply to /_next paths outside static/", () => {
    // Only `_next/static/**` filenames are hashed; nothing else may be
    // assumed immutable.
    expect(decide("/_next/cuOQDtB1El-FXXC7YDwqh")).toBe("network-first");
  });
});

describe("engines", () => {
  it("classifies every self-hosted engine file", () => {
    for (const path of ENGINE_FILES) {
      expect(decide(path)).toBe("engine");
    }
  });

  it("pins the engine list to the paths the loaders actually request", () => {
    // If one of these moves, its loader moved with it and the offline opt-in
    // is silently caching a file nothing asks for.
    expect([...ENGINE_FILES]).toEqual([
      "/ffmpeg-core.js",
      "/ffmpeg-core.wasm",
      "/qpdf.js",
      "/qpdf.wasm",
      "/zxing_reader.wasm",
      "/libarchive.wasm",
      "/squoosh_oxipng_bg.wasm",
    ]);
    expect([...ENGINE_DIRS]).toEqual(["/vendor/", "/fonts/print/", "/tesseract/"]);
  });

  it("classifies the vendored LGPL libraries and the print fonts", () => {
    expect(decide("/vendor/lamejs.js", { destination: "script" })).toBe("engine");
    // BOTH halves of the HEIC decoder, and the .wasm especially: it is fetched
    // by `fetch()` rather than as a script, so its `destination` is "" — a rule
    // keyed on destination rather than on the directory would miss it and the
    // offline opt-in would store a glue file with no binary.
    expect(decide("/vendor/libheif.js", { destination: "script" })).toBe("engine");
    expect(decide("/vendor/libheif.wasm", { destination: "" })).toBe("engine");
    expect(
      decide("/fonts/print/newsreader-latin-wght-normal.woff2", { destination: "font" }),
    ).toBe("engine");
  });

  it("classifies a ?retry= cache-buster as the same engine", () => {
    // Every loader retries with `?retry=N` because a failed dynamic import is
    // remembered in the module map and a same-URL retry never reaches the
    // network (audio-pcm.ts:52-57). Path-only matching is what makes the
    // worker's `ignoreSearch` lookup find the copy stored as `/qpdf.js`.
    expect(decide("/qpdf.js?retry=1")).toBe("engine");
    expect(decide("/vendor/lamejs.js?retry=2")).toBe("engine");
  });

  it("puts the engine rule ABOVE the caching defaults", () => {
    // This is the ordering that keeps 32,232,419 bytes out of storage without
    // consent: `/ffmpeg-core.js` is an un-hashed origin-root script, so the
    // default rule would make it network-first — which CACHES it.
    expect(decide("/ffmpeg-core.js", { destination: "script" })).toBe("engine");
    expect(decide("/ffmpeg-core.wasm")).toBe("engine");
  });

  it("does not claim a cross-origin file that happens to share the path", () => {
    const elsewhere = new URL("https://cdn.example.com/ffmpeg-core.wasm");
    expect(isEngineUrl(elsewhere, ORIGIN)).toBe(false);
    expect(strategyFor(elsewhere, facts(), ORIGIN)).toBe("network-only");
  });

  it("does not claim a page that merely starts like an engine path", () => {
    expect(isEngineUrl(new URL("/vendors", ORIGIN), ORIGIN)).toBe(false);
    expect(isEngineUrl(new URL("/ffmpeg-core.js.map", ORIGIN), ORIGIN)).toBe(false);
  });
});

describe("owned caches", () => {
  it("names the shell and the engines separately", () => {
    // Separate because the page's opt-in has to be able to size and delete
    // exactly what it added, and because the worker may write one and never
    // the other.
    expect(SHELL_CACHE).not.toBe(ENGINE_CACHE);
    expect([...OWNED_CACHES]).toEqual([SHELL_CACHE, ENGINE_CACHE]);
  });
});
