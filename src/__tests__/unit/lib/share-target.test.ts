import { describe, it, expect } from "vitest";
import {
  SHARED_PREFIX,
  SHARE_TARGET_ACTION,
  SHARE_TARGET_FILE_FIELD,
  SHARE_TARGET_PARAM,
  decodeSharedName,
  encodeSharedName,
  isShareId,
  parseSharedKey,
  shareRedirectPath,
  sharedFileKey,
} from "@/lib/pwa/share-target";

/*
  The key grammar of the share hand-off. Both ends of it are code that cannot
  be tested where it runs — the writer is a service worker (no
  ServiceWorkerGlobalScope in jsdom) and the reader runs after a POST no test
  harness here can issue — so the grammar between them is pulled out and
  pinned instead, exactly as sw-policy.ts is pulled out of the worker.
*/

const ID = "9f2a1c30-4b6e-4c1a-8d55-0e7c2b3a91f4"; // crypto.randomUUID() shape

describe("the hand-off constants", () => {
  it("names one route for both OS entry points", () => {
    // The manifest declares this as BOTH `share_target.action` and
    // `file_handlers[].action`; manifest.test.ts asserts it from that side.
    expect(SHARE_TARGET_ACTION).toBe("/open");
    expect(SHARE_TARGET_FILE_FIELD).toBe("files");
    expect(SHARE_TARGET_PARAM).toBe("shared");
  });

  it("keys the stash outside every route the export emits", () => {
    // `/_shared/` can never collide with a tool slug: slugs carry no leading
    // underscore and no slash.
    expect(SHARED_PREFIX).toBe("/_shared/");
    expect(sharedFileKey(ID, 0)).toBe(`/_shared/${ID}/0`);
    expect(sharedFileKey(ID, 12)).toBe(`/_shared/${ID}/12`);
  });

  it("redirects to the landing route carrying the id", () => {
    expect(shareRedirectPath(ID)).toBe(`/open?shared=${ID}`);
  });
});

describe("the share id is not trusted", () => {
  it("accepts what crypto.randomUUID emits", () => {
    expect(isShareId(ID)).toBe(true);
    expect(isShareId(crypto.randomUUID())).toBe(true);
  });

  it("refuses anything else, traversal included", () => {
    // `/open?shared=…` is a URL anyone can hand anyone. Nothing downstream
    // builds a path out of it, and it is never allowed to start.
    for (const hostile of [
      "../..",
      "../../_next/static",
      "",
      "  ",
      null,
      undefined,
      "9f2a1c30-4b6e-4c1a-8d55-0e7c2b3a91f", // one hex short
      "9F2A1C30-4B6E-4C1A-8D55-0E7C2B3A91F4", // uppercase: not what randomUUID emits
      `${ID}/0`,
    ]) {
      expect(isShareId(hostile), `must refuse ${JSON.stringify(hostile)}`).toBe(false);
    }
  });
});

describe("parseSharedKey", () => {
  it("round-trips every key the writer can produce", () => {
    for (const index of [0, 1, 7, 42]) {
      expect(parseSharedKey(sharedFileKey(ID, index))).toEqual({ id: ID, index });
    }
  });

  it("claims nothing that is not ours", () => {
    // The reader DELETES what this returns, so a lax parse would sweep keys
    // the shell cache put there — the site's own pages and chunks.
    for (const foreign of [
      "/",
      "/merge-pdf",
      "/_next/static/chunks/0w1e1-0y7jo0-.js",
      "/offline.html",
      "/_shared/",
      `/_shared/${ID}`, // no index
      `/_shared/${ID}/`, // empty index
      `/_shared/${ID}/0abc`, // parseInt would have read this as 0
      `/_shared/${ID}/0/1`, // a deeper path is not one of ours
      "/_shared/not-a-uuid/0",
    ]) {
      expect(parseSharedKey(foreign), `must not claim ${foreign}`).toBeNull();
    }
  });
});

describe("the filename crosses in a header", () => {
  it("survives a name a latin-1 header could not carry", () => {
    // Unencoded, this throws inside `new Response(…, { headers })` and takes
    // the whole share down with it.
    const name = "Ünterlagen — Q4 (2026).pdf";
    expect(decodeSharedName(encodeSharedName(name))).toBe(name);
    expect(encodeSharedName(name)).toMatch(/^[\x00-\x7F]+$/);
  });

  it("survives an emoji filename, which phones produce", () => {
    const name = "🌅 sunrise.heic";
    expect(decodeSharedName(encodeSharedName(name))).toBe(name);
  });

  it("never throws and never returns an empty heading", () => {
    // A malformed percent-escape is a real possibility: the value came from a
    // file the user named.
    expect(decodeSharedName("%E0%A4%A")).toBe("shared-file");
    expect(decodeSharedName(null)).toBe("shared-file");
    expect(decodeSharedName("")).toBe("shared-file");
    expect(decodeSharedName("%20%20")).toBe("shared-file");
  });
});
