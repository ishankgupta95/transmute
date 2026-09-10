import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";

/*
  ── WHAT THIS FILE GUARDS, AND WHY IT IS NOT IN archive-extract.test.ts ──

  Three separate places promise the reader that dropping a bare `.gz` on
  /extract-archive costs no engine download:

    · src/components/tools/ExtractArchiveUI.tsx  — "libarchive has no reader
      for a bare gzip stream … so the browser's own gzip decoder is doing this
      instead", which a reader takes as "nothing was downloaded for this".
    · src/__tests__/e2e/conversion/support.ts    — the note on
      `watchLibarchiveRequests`, which tells the next author how to spec it.
    · src/__tests__/e2e/conversion/archives.spec.ts — the reason it carries no
      third case.

  That promise is not a property of gzip. It is a property of ONE ORDERING in
  `readArchive`: the container sniff and the `payloadLooksLikeArchive` peek run
  BEFORE `newEngine()`. Until recently they ran after, and `access.log.gz`
  fetched 613 KB of WebAssembly, instantiated it, and threw it away — and failed
  outright whenever `/libarchive.wasm` was unreachable. Move those lines back
  below `newEngine()` and every other test in the repo stays green, because the
  LISTING is identical either way. Only the fetch count differs, so only a test
  that counts fetches can see it.

  It lives in its own file rather than in `archive-extract.test.ts` because that
  suite stubs `fetch` once in `beforeAll` and shares one module instance across
  every case; `archive-extract.ts` memoises the engine bytes in a module-level
  `wasmBytes`, so the first case to touch libarchive hides the count from all
  the others. Here each case gets `vi.resetModules()` and a fresh import, which
  is the only way "this call fetched nothing" can mean anything.
*/

const WASM_PATH = join(
  dirname(new URL(import.meta.url).pathname),
  "../../../../node_modules/libarchive-wasm/dist/libarchive.wasm",
);

let engineFetches: string[] = [];
let realFetch: typeof fetch;

/** A fresh module instance, with the engine memo empty and the counter at 0. */
async function freshReader() {
  vi.resetModules();
  engineFetches = [];
  return import("@/lib/tools/archive-extract");
}

beforeEach(() => {
  realFetch = globalThis.fetch;
  const wasm = readFileSync(WASM_PATH);
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/libarchive.wasm")) {
      engineFetches.push(url);
      return new Response(new Uint8Array(wasm), {
        status: 200,
        headers: { "content-type": "application/wasm" },
      });
    }
    return realFetch(input as RequestInfo);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A gzipped server log — the shape of file the promise is actually about. */
const gzippedLog = () =>
  gzipSync(
    Buffer.from(
      '127.0.0.1 - - [05/Sep/2026:11:02:41 +0000] "GET /pdf-tools HTTP/1.1" 200 4213\n'.repeat(40),
      "utf8",
    ),
  );

/**
 * A gzip whose payload libarchive WOULD have something to say about. The inner
 * bytes only have to carry a container magic `payloadLooksLikeArchive` bids on
 * — the point here is which branch `readArchive` takes, not what libarchive
 * makes of the contents once it is holding them.
 */
const gzippedZipLike = () =>
  gzipSync(Buffer.concat([Buffer.from("PK", "latin1"), Buffer.alloc(220, 0x41)]));

describe("readArchive — the engine is fetched only when it is needed", () => {
  it("lists a bare .gz without fetching libarchive at all", async () => {
    const { readArchive } = await freshReader();

    const listing = await readArchive(gzippedLog(), "access.log.gz");

    expect(listing.viaGzipStream, "a bare gzip must be read by DecompressionStream").toBe(true);
    expect(listing.entries.map((entry) => entry.path)).toEqual(["access.log"]);
    expect(
      engineFetches,
      "a bare .gz needs nothing from libarchive, and three surfaces tell the reader so — /extract-archive's own panel, the note on watchLibarchiveRequests, and archives.spec.ts's reason for carrying no .gz case",
    ).toEqual([]);
  });

  it("still fetches libarchive when the gzip has an archive inside it", async () => {
    /*
      The other side of the guard. Without this, deleting the engine load
      outright would satisfy the case above, and "no fetch" would stop meaning
      "the cheap path was taken".
    */
    const { readArchive } = await freshReader();

    await readArchive(gzippedZipLike(), "bundle.zip.gz");

    expect(
      engineFetches,
      "a gzip whose payload carries a container magic must still reach the engine",
    ).toEqual(["/libarchive.wasm"]);
  });

  it("lists a bare .gz even when the engine is unreachable", async () => {
    /*
      The user-visible half: before the sniff moved ahead of `newEngine()`, a
      404 on /libarchive.wasm failed `access.log.gz` outright, for a path that
      never needed the file.
    */
    const { readArchive } = await freshReader();
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/libarchive.wasm")) {
        engineFetches.push(url);
        return new Response("not here", { status: 404 });
      }
      return realFetch(input as RequestInfo);
    });

    const listing = await readArchive(gzippedLog(), "access.log.gz");

    expect(listing.viaGzipStream).toBe(true);
    expect(listing.engine).toBe("DecompressionStream");
    expect(engineFetches).toEqual([]);
  });
});
