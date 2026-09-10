import { describe, it, expect, afterEach, vi } from "vitest";
import { takeSharedFiles } from "@/lib/pwa/shared-intake";
import { SHARED_NAME_HEADER, encodeSharedName, sharedFileKey } from "@/lib/pwa/share-target";
import { SHELL_CACHE } from "@/lib/pwa/sw-policy";

/*
  The page half of the hand-off, against a stubbed Cache API.

  What is being proved here is not "the files come back" — that is the easy
  half. It is that NOTHING IS LEFT BEHIND. /privacy tells every visitor that
  the only things this site keeps in browser storage are one localStorage key
  and a copy of the site's own code; a shared file that outlived its
  navigation would make that false for as long as it sat there, with no event
  to tell anyone. So the reader is a TAKE, and the sweep covers stashes from
  shares that were never opened at all.
*/

const ID = "9f2a1c30-4b6e-4c1a-8d55-0e7c2b3a91f4";
const OTHER_ID = "11111111-2222-4333-8444-555555555555";
const ORIGIN = "https://transmute.tools";

interface Stub {
  entries: Map<string, Response>;
  opened: string[];
}

function stubCaches(seed: [string, Response][] = []): Stub {
  const entries = new Map(seed);
  const opened: string[] = [];
  const cache = {
    keys: async () => [...entries.keys()].map((url) => new Request(url)),
    match: async (request: Request) => entries.get(request.url),
    delete: async (request: Request) => entries.delete(request.url),
  };
  vi.stubGlobal("caches", {
    open: async (name: string) => {
      opened.push(name);
      return cache as unknown as Cache;
    },
  });
  return { entries, opened };
}

/**
 * What the service worker writes: the body, the type, the encoded name.
 *
 * Hand-built rather than a real `new Response(blob)`, for a reason that is
 * purely an artifact of this harness: under vitest's jsdom environment `File`
 * and `Blob` come from jsdom while `Response.blob()` returns Node's undici
 * Blob, and jsdom's `File` constructor does not recognise a foreign Blob — it
 * stringifies it, and the body arrives as the literal text "[object Blob]".
 * A browser has one realm and one Blob, so the code under test is unchanged;
 * what this stub removes is a false red (and, if it had been asserted the
 * other way round, a false green).
 */
function stashed(name: string, body: string, type = "application/pdf"): Response {
  return {
    headers: new Headers({
      "content-type": type,
      [SHARED_NAME_HEADER]: encodeSharedName(name),
    }),
    blob: async () => new Blob([body], { type }),
  } as unknown as Response;
}

function key(id: string, index: number): string {
  return `${ORIGIN}${sharedFileKey(id, index)}`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("takeSharedFiles", () => {
  it("reads the stash the worker wrote, out of the shell cache", async () => {
    const stub = stubCaches([[key(ID, 0), stashed("invoice.pdf", "%PDF-1.7")]]);

    const files = await takeSharedFiles(ID);

    expect(stub.opened).toEqual([SHELL_CACHE]);
    expect(files).toHaveLength(1);
    expect(files[0]).toBeInstanceOf(File);
    expect(files[0].name).toBe("invoice.pdf");
    expect(files[0].type).toBe("application/pdf");
    expect(await files[0].text()).toBe("%PDF-1.7");
  });

  it("returns multi-file shares in the order they were shared", async () => {
    // Seeded out of order on purpose: `cache.keys()` ordering is not
    // something the merge tools should have to depend on.
    stubCaches([
      [key(ID, 2), stashed("c.pdf", "C")],
      [key(ID, 0), stashed("a.pdf", "A")],
      [key(ID, 1), stashed("b.pdf", "B")],
    ]);

    const files = await takeSharedFiles(ID);

    expect(files.map((f) => f.name)).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
  });

  it("leaves nothing behind — not its own stash, not anyone else's", async () => {
    const stub = stubCaches([
      [key(ID, 0), stashed("mine.pdf", "MINE")],
      // A share the user started and never opened. Nothing else will ever
      // come back for this, so this call is its only chance to be removed.
      [key(OTHER_ID, 0), stashed("abandoned.mp4", "ORPHAN")],
      // The shell cache's real contents must survive untouched.
      [`${ORIGIN}/`, stashed("/", "<!doctype html>", "text/html")],
      [`${ORIGIN}/offline.html`, stashed("/offline.html", "<!doctype html>", "text/html")],
      [
        `${ORIGIN}/_next/static/chunks/0w1e1-0y7jo0-.js`,
        stashed("chunk", "//", "text/javascript"),
      ],
    ]);

    const files = await takeSharedFiles(ID);

    expect(files.map((f) => f.name)).toEqual(["mine.pdf"]);
    expect([...stub.entries.keys()].sort()).toEqual([
      `${ORIGIN}/`,
      `${ORIGIN}/_next/static/chunks/0w1e1-0y7jo0-.js`,
      `${ORIGIN}/offline.html`,
    ]);
  });

  it("sweeps an abandoned stash even when it is asked for nothing", async () => {
    // A plain visit to /open — no `?shared=` at all — still cleans up.
    const stub = stubCaches([
      [key(OTHER_ID, 0), stashed("abandoned.mp4", "ORPHAN")],
      [`${ORIGIN}/`, stashed("/", "<!doctype html>", "text/html")],
    ]);

    expect(await takeSharedFiles(null)).toEqual([]);
    expect([...stub.entries.keys()]).toEqual([`${ORIGIN}/`]);
  });

  it("refuses a crafted ?shared= and treats its keys as stale", async () => {
    const stub = stubCaches([[key(ID, 0), stashed("mine.pdf", "MINE")]]);

    // `/open?shared=../..` — the id never reaches a lookup.
    expect(await takeSharedFiles("../..")).toEqual([]);
    expect(stub.entries.size).toBe(0);
  });

  it("does not throw where there is no Cache API at all", async () => {
    // A browser without it, or any non-secure context. The caller's fallback
    // is a perfectly good file picker.
    vi.stubGlobal("caches", undefined);
    expect(await takeSharedFiles(ID)).toEqual([]);
  });

  it("does not throw when the cache itself refuses to open", async () => {
    vi.stubGlobal("caches", {
      open: async () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    });
    expect(await takeSharedFiles(ID)).toEqual([]);
  });

  it("loses one unreadable body rather than the whole share", async () => {
    const broken = {
      headers: new Headers({ [SHARED_NAME_HEADER]: encodeSharedName("broken.pdf") }),
      blob: async () => {
        throw new TypeError("body already read");
      },
    } as unknown as Response;
    const stub = stubCaches([
      [key(ID, 0), broken],
      [key(ID, 1), stashed("good.pdf", "GOOD")],
    ]);

    const files = await takeSharedFiles(ID);

    expect(files.map((f) => f.name)).toEqual(["good.pdf"]);
    // And the unreadable one is gone too: a courier that keeps a copy when the
    // hand-off fails is a courier that stored your file.
    expect(stub.entries.size).toBe(0);
  });

  it("falls back to a readable name when the header is missing", async () => {
    const nameless = {
      headers: new Headers(),
      blob: async () => new Blob(["x"]),
    } as unknown as Response;
    stubCaches([[key(ID, 0), nameless]]);
    const files = await takeSharedFiles(ID);
    expect(files[0].name).toBe("shared-file");
  });
});
