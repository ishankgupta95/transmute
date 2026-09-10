import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import {
  ARCHIVE_ACCEPT,
  CONTAINER_KINDS,
  classifyEntryPath,
  containerLabel,
  describeArchiveFailure,
  describeOpenFailure,
  extractFromArchive,
  gzipDeclaredSize,
  gzipFallbackName,
  gzipStoredName,
  isExtractable,
  looksNested,
  readArchive,
  selectionZipName,
  sniffContainer,
  summariseListing,
  uniqueNames,
  unsafeWording,
  type ArchiveEntry,
  type ArchiveListing,
} from "@/lib/tools/archive-extract";

/*
  ── THIS SUITE RUNS THE REAL ENGINE ─────────────────────────────────────

  The repo's documented blind spot is a green unit suite over an engine that
  never ran (see `project_test_blindspot` in the working notes). libarchive is
  WebAssembly and WebAssembly runs perfectly well under vitest, so the only
  thing standing between these tests and the real thing is where the module
  fetches its binary from: `archive-extract.ts` asks the ORIGIN for
  `/libarchive.wasm`, which `npm run copy:wasm` stages beside
  `ffmpeg-core.wasm`.

  So `fetch` is stubbed to serve that exact artifact out of node_modules —
  the same bytes the copy step stages. Everything below therefore exercises
  libarchive 3.7.7 itself: the ZIPs are built with the JSZip the sibling
  `unzip-files` page uses, the tar is written by hand to the POSIX ustar
  layout, and the encrypted ZIP is a real ZipCrypto archive produced by
  `zip -P`, embedded as base64 because a binary fixture cannot live in a
  test file.

  The one thing this cannot prove is that `/libarchive.wasm` is actually
  staged and served in a browser; that is the e2e guard noted in the handoff.
*/

const WASM_PATH = join(
  dirname(new URL(import.meta.url).pathname),
  "../../../../node_modules/libarchive-wasm/dist/libarchive.wasm",
);

let realFetch: typeof fetch;

/*
  Every URL the module asked for, in order.

  This exists because the stub above is otherwise INVISIBLE: it serves the
  engine to anything that asks, so a `.gz` listing that fetched 599 KB it did
  not need passed exactly like one that fetched nothing. "The engine was not
  loaded" is a real, user-visible property of the gzip path — it is what makes
  `access.log.gz` work on a metered connection and while `/libarchive.wasm` is
  404ing — and nothing can assert it without counting.
*/
const engineFetches: string[] = [];

beforeAll(() => {
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

afterAll(() => {
  vi.unstubAllGlobals();
});

/* ── Fixture builders ──────────────────────────────────────────────── */

async function buildZip(files: Record<string, string>): Promise<Uint8Array> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const [name, body] of Object.entries(files)) zip.file(name, body);
  return zip.generateAsync({ type: "uint8array" });
}

/** A POSIX ustar tar, written by hand — 512-byte header, 512-byte blocks. */
function buildTar(files: { name: string; body: string }[]): Uint8Array {
  const enc = new TextEncoder();
  const blocks: Uint8Array[] = [];
  for (const { name, body } of files) {
    const data = enc.encode(body);
    const header = new Uint8Array(512);
    const put = (offset: number, text: string) => header.set(enc.encode(text), offset);
    put(0, name);
    put(100, "0000644\0");
    put(108, "0000000\0");
    put(116, "0000000\0");
    put(124, data.length.toString(8).padStart(11, "0") + "\0");
    put(136, "00000000000\0");
    put(156, "0");
    put(257, "ustar\0" + "00");
    // Checksum is computed with the checksum field itself read as spaces.
    header.fill(0x20, 148, 156);
    let sum = 0;
    for (const b of header) sum += b;
    put(148, sum.toString(8).padStart(6, "0") + "\0 ");
    blocks.push(header);
    const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
    padded.set(data);
    blocks.push(padded);
  }
  // Two zero blocks end the archive.
  blocks.push(new Uint8Array(1024));
  const total = blocks.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const b of blocks) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}

/**
 * `zip -P hunter2 enc.zip src/hello.txt` — a real ZipCrypto archive whose one
 * member is the 12 bytes "hello world\n".
 */
const ENCRYPTED_ZIP_BASE64 =
  "UEsDBAoACQAAAAeqJV0tOwivGAAAAAwAAAANABwAc3JjL2hlbGxvLnR4dFVUCQADRjmcakY5nGp1" +
  "eAsAAQT1AQAABAAAAAAzB6vRyxvWphPLxEMEofKsfQVwkKJoKC5QSwcILTsIrxgAAAAMAAAAUEsB" +
  "Ah4DCgAJAAAAB6olXS07CK8YAAAADAAAAA0AGAAAAAAAAQAAAKSBAAAAAHNyYy9oZWxsby50eHRV" +
  "VAUAA0Y5nGp1eAsAAQT1AQAABAAAAABQSwUGAAAAAAEAAQBTAAAAbwAAAAAA";

function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

const text = async (blob: Blob) => new TextDecoder().decode(await blob.arrayBuffer());

/** Where a run of bytes sits inside a container, or -1. Finds a stored ZIP member. */
function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

const entry = (over: Partial<ArchiveEntry> = {}): ArchiveEntry => ({
  index: 0,
  path: "a.txt",
  safePath: "a.txt",
  unsafeReason: null,
  kind: "file",
  size: 10,
  encrypted: false,
  modifiedAt: null,
  linkTarget: null,
  nested: false,
  ...over,
});

const listing = (entries: ArchiveEntry[]): ArchiveListing => ({
  entries,
  container: "zip",
  engine: "libarchive 3.7.7",
  incompleteReason: null,
  viaGzipStream: false,
  sizeSource: "archive",
});

/* ── Pure helpers ──────────────────────────────────────────────────── */

describe("sniffContainer", () => {
  const magic = (bytes: number[], length = 40) => {
    const out = new Uint8Array(length);
    out.set(bytes);
    return out;
  };

  it("recognises every container the page advertises", () => {
    expect(sniffContainer(magic([0x50, 0x4b, 0x03, 0x04]))).toBe("zip");
    expect(sniffContainer(magic([0x50, 0x4b, 0x05, 0x06]))).toBe("zip");
    expect(sniffContainer(magic([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))).toBe("7z");
    expect(sniffContainer(magic([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]))).toBe("rar");
    expect(sniffContainer(magic([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]))).toBe("xz");
    expect(sniffContainer(magic([0x1f, 0x8b, 0x08]))).toBe("gzip");
    expect(sniffContainer(magic([0x42, 0x5a, 0x68, 0x39]))).toBe("bzip2");
  });

  /*
    Neither is in `ARCHIVE_ACCEPT`, and both are sniffed anyway — the sniff's
    only job is WORDING, and without these two a `.tar.zst` is told its bytes
    match no format the engine reads, which is false. libarchive knows both;
    it decompresses them by running the `zstd`/`lz4` program, and there is no
    program to run inside WebAssembly. A drop still reaches this code even
    though the picker filters .zst out, because `DropZone.matchesAccept`
    passes any file the OS gave no MIME type for.
  */
  it("recognises zstd and lz4, which are not advertised but must still be named", () => {
    expect(sniffContainer(magic([0x28, 0xb5, 0x2f, 0xfd]))).toBe("zstd");
    expect(sniffContainer(magic([0x04, 0x22, 0x4d, 0x18]))).toBe("lz4");
  });

  it("finds a tar by its ustar marker at offset 257, not by a prefix", () => {
    const tar = buildTar([{ name: "a.txt", body: "hi" }]);
    expect(sniffContainer(tar)).toBe("tar");
    // The same marker at the front is NOT a tar.
    expect(sniffContainer(new TextEncoder().encode("ustar just some prose"))).toBe("unknown");
  });

  it("says unknown rather than guessing, and never reads past the end", () => {
    expect(sniffContainer(new Uint8Array(0))).toBe("unknown");
    expect(sniffContainer(new Uint8Array([0x50]))).toBe("unknown");
    expect(sniffContainer(new TextEncoder().encode("plain text"))).toBe("unknown");
  });

  it("labels every kind for the canvas header", () => {
    expect(containerLabel("7z")).toBe("7-Zip");
    expect(containerLabel("unknown")).toBe("UNKNOWN");
  });
});

describe("classifyEntryPath — the zip-slip gate", () => {
  it("refuses a path that climbs out, wherever the .. sits", () => {
    expect(classifyEntryPath("../../etc/evil.txt")).toEqual({
      safePath: null,
      reason: "traversal",
    });
    expect(classifyEntryPath("a/../../up.txt")).toEqual({ safePath: null, reason: "traversal" });
    expect(classifyEntryPath("deep/nested/..")).toEqual({ safePath: null, reason: "traversal" });
  });

  it("refuses backslash traversal, which a POSIX-only reading calls a filename", () => {
    expect(classifyEntryPath("..\\..\\windows\\system32\\evil.dll")).toEqual({
      safePath: null,
      reason: "traversal",
    });
  });

  it("refuses absolute, drive-letter and UNC paths", () => {
    expect(classifyEntryPath("/abs/evil2.txt")).toEqual({ safePath: null, reason: "absolute" });
    expect(classifyEntryPath("C:\\Windows\\evil.dll")).toEqual({ safePath: null, reason: "drive" });
    expect(classifyEntryPath("//server/share/evil")).toEqual({ safePath: null, reason: "drive" });
  });

  it("refuses a name that is empty once normalised", () => {
    expect(classifyEntryPath("")).toEqual({ safePath: null, reason: "empty" });
    expect(classifyEntryPath("   ")).toEqual({ safePath: null, reason: "empty" });
    expect(classifyEntryPath("./")).toEqual({ safePath: null, reason: "empty" });
  });

  it("keeps ordinary paths, including folders, and drops only ./ noise", () => {
    expect(classifyEntryPath("src/docs/notes.md").safePath).toBe("src/docs/notes.md");
    expect(classifyEntryPath("./good.txt").safePath).toBe("good.txt");
    expect(classifyEntryPath("sub/").safePath).toBe("sub");
    expect(classifyEntryPath("a//b.txt").safePath).toBe("a/b.txt");
    // ".." only as a whole segment — "..hidden" is a legal file name.
    expect(classifyEntryPath("..hidden").safePath).toBe("..hidden");
  });

  it("has wording for every refusal reason", () => {
    for (const reason of ["absolute", "drive", "traversal", "empty"] as const) {
      expect(unsafeWording(reason)).toMatch(/\w/);
    }
  });
});

describe("looksNested", () => {
  it("spots an archive inside an archive by name", () => {
    expect(looksNested("payloads/inner.tar.gz")).toBe(true);
    expect(looksNested("INNER.ZIP")).toBe(true);
    expect(looksNested("backup.7z")).toBe(true);
    expect(looksNested("notes.md")).toBe(false);
    expect(looksNested("zipper.txt")).toBe(false);
  });
});

describe("uniqueNames", () => {
  it("leaves distinct names alone", () => {
    expect(uniqueNames(["a.txt", "b/c.txt"])).toEqual(["a.txt", "b/c.txt"]);
  });

  it("numbers duplicates before the extension, so JSZip cannot silently replace one", () => {
    expect(uniqueNames(["a.txt", "a.txt", "a.txt"])).toEqual(["a.txt", "a (2).txt", "a (3).txt"]);
  });

  it("appends when there is no extension, and does not mistake a dotted folder for one", () => {
    expect(uniqueNames(["README", "README"])).toEqual(["README", "README (2)"]);
    expect(uniqueNames(["v1.2/notes", "v1.2/notes"])).toEqual(["v1.2/notes", "v1.2/notes (2)"]);
  });
});

describe("gzip header and trailer readers", () => {
  it("recovers the stored original filename", () => {
    const gz = gzipSync(Buffer.from("hello world\n"), {});
    // node's zlib does not write FNAME, so build the flag by hand from a real
    // header shape: FLG bit 3 plus a NUL-terminated name.
    const named = new Uint8Array(gz.length + 10);
    named.set(gz.subarray(0, 10));
    named[3] |= 0x08;
    named.set(new TextEncoder().encode("hello.txt\0"), 10);
    named.set(gz.subarray(10), 20);
    expect(gzipStoredName(named)).toBe("hello.txt");
  });

  it("returns null when no name is stored, and never trusts one that escapes", () => {
    expect(gzipStoredName(gzipSync(Buffer.from("x")))).toBeNull();
    expect(gzipStoredName(new Uint8Array([1, 2, 3]))).toBeNull();

    const gz = gzipSync(Buffer.from("x"));
    const evil = new Uint8Array(gz.length + 16);
    evil.set(gz.subarray(0, 10));
    evil[3] |= 0x08;
    evil.set(new TextEncoder().encode("../../evil\0"), 10);
    evil.set(gz.subarray(10), 21);
    expect(gzipStoredName(evil)).toBeNull();
  });

  it("reads the declared size out of the ISIZE trailer", () => {
    const body = "x".repeat(1234);
    expect(gzipDeclaredSize(gzipSync(Buffer.from(body)))).toBe(1234);
    expect(gzipDeclaredSize(new Uint8Array(2))).toBe(0);
  });

  it("falls back to the download's own name", () => {
    expect(gzipFallbackName("access.log.gz")).toBe("access.log");
    expect(gzipFallbackName("backup.tgz")).toBe("backup.tar");
    expect(gzipFallbackName("mystery")).toBe("mystery.out");
  });
});

describe("describeOpenFailure", () => {
  /*
    An open failure carries no usable message — the library reads the error
    string off the wrong pointer, so it is a wasm trap or a phrase scavenged
    out of the heap ("or this entry", measured on a 21-byte gzip). Nothing
    here takes an error argument, which is the guarantee.
  */
  it("names xz and bzip2 as single compressed files rather than archives", () => {
    expect(describeOpenFailure("xz")).toMatch(/single file compressed with xz/);
    expect(describeOpenFailure("bzip2")).toMatch(/single file compressed with bzip2/);
  });

  it("says what the engine can read when nothing matched", () => {
    const message = describeOpenFailure("unknown");
    expect(message).toMatch(/not an archive in any format/);
    expect(message).toMatch(/ZIP, TAR, 7-Zip, RAR/);
  });

  it("points at a damaged header when the magic matched but the open failed", () => {
    const message = describeOpenFailure("zip");
    expect(message).toMatch(/looks like ZIP/);
    expect(message).toMatch(/damaged|partly downloaded/);
  });

  /*
    zstd and LZ4 need their OWN sentence, not the "unknown" one. The engine
    recognises both formats and fails for a reason that has nothing to do with
    the bytes — the decompressor is an external program, and WebAssembly has
    no shell to run it in. Telling someone their tar.zst matches no format the
    engine reads is the false half; naming `zstd -d` is the actionable half.
  */
  it("tells a zstd or lz4 file that the format is known and the decompressor is not", () => {
    const zstd = describeOpenFailure("zstd");
    expect(zstd).toMatch(/recognises the format/);
    expect(zstd).toMatch(/zstd -d/);
    expect(zstd).not.toMatch(/not an archive in any format/);

    const lz4 = describeOpenFailure("lz4");
    expect(lz4).toMatch(/recognises the format/);
    expect(lz4).toMatch(/lz4 -d/);
    expect(lz4).not.toMatch(/not an archive in any format/);
  });

  /*
    Walks CONTAINER_KINDS rather than a list retyped here. The retyped version
    of this test is how zstd and lz4 reached the page with the wrong sentence:
    it enumerated the eight kinds it knew, passed, and never noticed that two
    more had been added. Deriving the loop from the module's own list is what
    makes "every kind" mean it.
  */
  it("has a sentence for every container kind the module can return", () => {
    for (const container of CONTAINER_KINDS) {
      expect(describeOpenFailure(container).length).toBeGreaterThan(40);
    }
    expect(CONTAINER_KINDS).toContain("zstd");
    expect(CONTAINER_KINDS).toContain("lz4");
  });
});

describe("describeArchiveFailure", () => {
  it("turns libarchive's own messages into instructions", () => {
    expect(describeArchiveFailure(new Error("Passphrase required for this entry"))).toMatch(
      /encrypted.*password/i,
    );
    expect(describeArchiveFailure(new Error("Incorrect passphrase"))).toMatch(/did not open/i);
    expect(
      describeArchiveFailure(new Error("Truncated input file (needed 4390 bytes)")),
    ).toMatch(/incomplete|partly downloaded/);
  });

  it("passes anything unrecognised through rather than inventing a reason", () => {
    expect(describeArchiveFailure(new Error("ZIP bad CRC: 0x1"))).toBe("ZIP bad CRC: 0x1");
  });
});

describe("summariseListing and isExtractable", () => {
  it("counts each kind once and only sums file sizes", () => {
    const s = summariseListing(
      listing([
        entry({ index: 0, path: "d/", kind: "directory", size: 0, safePath: "d" }),
        entry({ index: 1, path: "d/a.txt", size: 100, safePath: "d/a.txt" }),
        entry({ index: 2, path: "d/b.bin", size: 0, safePath: "d/b.bin" }),
        entry({ index: 3, path: "link", kind: "symlink", size: 0, safePath: "link" }),
        entry({ index: 4, path: "../evil", safePath: null, unsafeReason: "traversal", size: 9 }),
        entry({ index: 5, path: "secret.txt", encrypted: true, size: 12 }),
        entry({ index: 6, path: "inner.zip", nested: true, size: 40 }),
      ]),
    );
    expect(s).toEqual({
      entries: 7,
      files: 5,
      directories: 1,
      links: 1,
      zeroSizeFiles: 1,
      encrypted: 1,
      refused: 1,
      nested: 1,
      declaredBytes: 161,
      extractable: 4,
    });
  });

  it("refuses directories, links and unsafe paths as extraction targets", () => {
    expect(isExtractable(entry())).toBe(true);
    expect(isExtractable(entry({ kind: "directory" }))).toBe(false);
    expect(isExtractable(entry({ kind: "symlink" }))).toBe(false);
    expect(isExtractable(entry({ safePath: null, unsafeReason: "absolute" }))).toBe(false);
  });
});

describe("selectionZipName", () => {
  it("strips one compound archive extension, not just the last dot", () => {
    expect(selectionZipName("project.tar.gz")).toBe("project-extracted.zip");
    expect(selectionZipName("photos.zip")).toBe("photos-extracted.zip");
    expect(selectionZipName("v1.2.3.7z")).toBe("v1.2.3-extracted.zip");
  });
});

describe("the accept string matches what the loader advertises", () => {
  it("lists every format the page claims", () => {
    expect(ARCHIVE_ACCEPT).toBe(".zip,.tar,.gz,.tgz,.bz2,.xz,.7z,.rar");
  });
});

/* ── The real engine ───────────────────────────────────────────────── */

describe("readArchive against libarchive itself", () => {
  it("lists a ZIP with real paths, kinds and sizes", async () => {
    const zip = await buildZip({
      "src/hello.txt": "hello world\n",
      "src/docs/notes.md": "# Notes",
    });
    const result = await readArchive(zip, "bundle.zip");

    expect(result.engine).toMatch(/^libarchive 3\./);
    expect(result.container).toBe("zip");
    expect(result.incompleteReason).toBeNull();
    expect(result.viaGzipStream).toBe(false);

    const files = result.entries.filter((e) => e.kind === "file");
    expect(files.map((e) => e.path).sort()).toEqual(["src/docs/notes.md", "src/hello.txt"]);
    expect(files.find((e) => e.path === "src/hello.txt")?.size).toBe(12);
    expect(files.every((e) => e.safePath === e.path)).toBe(true);
  });

  it("lists a hand-written tar", async () => {
    const tar = buildTar([
      { name: "a.txt", body: "alpha" },
      { name: "dir/b.txt", body: "bravo!" },
    ]);
    const result = await readArchive(tar, "bundle.tar");
    expect(result.container).toBe("tar");
    expect(result.entries.map((e) => [e.path, e.size])).toEqual([
      ["a.txt", 5],
      ["dir/b.txt", 6],
    ]);
  });

  it("lists a zip-slip archive, refuses the escaping paths, and names the reason", async () => {
    const zip = await buildZip({
      "../../etc/evil.txt": "pwned",
      "/abs/evil2.txt": "pwned2",
      "good.txt": "fine",
      "a/../../up.txt": "sneaky",
    });
    const result = await readArchive(zip, "slip.zip");
    /*
      Files only: JSZip also materialises the intermediate directory entries
      ("../", "../../", "/abs/" …), which are refused for the same reason and
      would make an assertion over every entry a count of JSZip's habits
      rather than of the gate.
    */
    const refused = result.entries.filter((e) => e.safePath === null && e.kind === "file");

    expect(refused.map((e) => e.path).sort()).toEqual([
      "../../etc/evil.txt",
      "/abs/evil2.txt",
      "a/../../up.txt",
    ]);
    expect(refused.map((e) => e.unsafeReason).sort()).toEqual([
      "absolute",
      "traversal",
      "traversal",
    ]);
    // Exactly one member of this archive may be written out.
    expect(summariseListing(result).extractable).toBe(1);
    expect(summariseListing(result).refused).toBeGreaterThanOrEqual(3);
  });

  it("reports an encrypted member without a password, and opens it with one", async () => {
    const enc = fromBase64(ENCRYPTED_ZIP_BASE64);
    const locked = await readArchive(enc, "enc.zip");
    expect(locked.entries).toHaveLength(1);
    expect(locked.entries[0].encrypted).toBe(true);
    expect(locked.entries[0].path).toBe("src/hello.txt");

    // Without the password the member fails on its own, and the run survives.
    const denied = await extractFromArchive(enc, locked, [0]);
    expect(denied.files).toHaveLength(0);
    expect(denied.failures).toHaveLength(1);
    expect(denied.failures[0].reason).toMatch(/encrypted.*password/i);

    const opened = await extractFromArchive(enc, locked, [0], { passphrase: "hunter2" });
    expect(opened.failures).toEqual([]);
    expect(await text(opened.files[0].blob)).toBe("hello world\n");

    const wrong = await extractFromArchive(enc, locked, [0], { passphrase: "nope" });
    expect(wrong.failures[0].reason).toMatch(/did not open/i);
  });

  it("flags a nested archive instead of recursing into it", async () => {
    const inner = await buildZip({ "deep.txt": "deep" });
    const JSZip = (await import("jszip")).default;
    const outer = new JSZip();
    outer.file("inner.zip", inner);
    outer.file("readme.txt", "outer");
    const bytes = await outer.generateAsync({ type: "uint8array" });

    const result = await readArchive(bytes, "nested.zip");
    expect(result.entries.find((e) => e.path === "inner.zip")?.nested).toBe(true);
    expect(result.entries.find((e) => e.path === "readme.txt")?.nested).toBe(false);
    // Two entries, not three: nothing walked into the inner archive.
    expect(result.entries.filter((e) => e.kind === "file")).toHaveLength(2);

    const out = await extractFromArchive(bytes, result, [
      result.entries.findIndex((e) => e.path === "inner.zip"),
    ]);
    expect(out.files[0].name).toBe("inner.zip");
    expect(out.files[0].bytes).toBe(inner.byteLength);
  });

  it("reports a partial listing rather than passing it off as complete", async () => {
    /*
      A half-downloaded ZIP. The walk does NOT throw — `read_next_entry`
      returns 0 for a damaged header exactly as it does at the end of the
      archive — so the only thing that distinguishes "that was everything"
      from "the next header was garbage" is the engine's own error string,
      which is what `incompleteReason` carries.
    */
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    for (let i = 0; i < 6; i++) zip.file(`f${i}.txt`, `block-${i}-${"-".repeat(300)}`);
    const whole = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    const cut = whole.slice(0, Math.floor(whole.length * 0.35));

    const result = await readArchive(cut, "half.zip");
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries.length).toBeLessThan(6);
    expect(result.incompleteReason).not.toBeNull();
    expect(result.incompleteReason).toMatch(/incomplete|partly downloaded/i);
  });

  it("refuses a file that could not be opened at all rather than showing an empty table", async () => {
    // ZIP magic then noise: zero entries plus an engine error is a file that
    // could not be read, not an archive with nothing in it.
    const junk = new Uint8Array(504);
    junk.set([0x50, 0x4b, 0x03, 0x04]);
    for (let i = 4; i < junk.length; i++) junk[i] = i % 251;
    await expect(readArchive(junk, "broken.zip")).rejects.toThrow(/incomplete|partly downloaded/i);
  });

  it("refuses a file that is not an archive with a sentence, not a wasm trap", async () => {
    const notAnArchive = new TextEncoder().encode("this is definitely not an archive".repeat(10));
    await expect(readArchive(notAnArchive, "notes.txt")).rejects.toThrow(
      /not an archive in any format/,
    );
    await expect(readArchive(notAnArchive, "notes.txt")).rejects.not.toThrow(/out of bounds/);
  });

  it("refuses a bare xz file by explaining what it is", async () => {
    const xz = new Uint8Array(200);
    xz.set([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]);
    for (let i = 6; i < xz.length; i++) xz[i] = (i * 7) % 251;
    await expect(readArchive(xz, "notes.md.xz")).rejects.toThrow(/single file compressed with xz/);
  });
});

describe("bare gzip, which libarchive cannot read at all", () => {
  it("lists one entry from the header and trailer, without decompressing", async () => {
    const body = "hello world\n".repeat(100);
    const gz = new Uint8Array(gzipSync(Buffer.from(body)));

    const result = await readArchive(gz, "access.log.gz");
    expect(result.viaGzipStream).toBe(true);
    expect(result.container).toBe("gzip");
    expect(result.sizeSource).toBe("gzip-trailer");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].path).toBe("access.log");
    expect(result.entries[0].size).toBe(body.length);
  });

  it("decompresses it on extraction, byte for byte", async () => {
    const body = "one\ntwo\nthree\n";
    const gz = new Uint8Array(gzipSync(Buffer.from(body)));
    const result = await readArchive(gz, "notes.txt.gz");
    const out = await extractFromArchive(gz, result, [0]);
    expect(out.files).toHaveLength(1);
    expect(out.files[0].name).toBe("notes.txt");
    expect(await text(out.files[0].blob)).toBe(body);
    expect(out.bytes).toBe(body.length);
  });

  it("says the gzip data is damaged rather than throwing a bare TypeError", async () => {
    const gz = new Uint8Array(gzipSync(Buffer.from("hello world hello world")));
    gz[gz.length - 8] ^= 0xff;
    const result = await readArchive(gz, "x.txt.gz");
    await expect(extractFromArchive(gz, result, [0])).rejects.toThrow(/damaged|incomplete/);
  });
});

/*
  ── THE ENGINE IS FETCHED ONLY WHEN SOMETHING NEEDS IT ───────────────────

  `readArchive` used to call `newEngine()` unconditionally and discover the
  bare-gzip case from the ArchiveReader constructor's FAILURE — which meant
  `access.log.gz` paid 599 KB of WebAssembly for an answer the browser's own
  decoder gave, and failed outright whenever `/libarchive.wasm` was
  unreachable. The order is now: sniff, peek inside the gzip, and only reach
  for the engine if what is in there is something libarchive could read.

  Each case needs a FRESH module: `wasmBytes` is memoised for the life of the
  tab (deliberately — one request per tab, not per archive), so a count taken
  against the module the rest of this file imported would only ever see the
  first archive's fetch. `vi.resetModules()` plus a dynamic import is what
  gives the counter something to count.
*/
describe("engine fetch accounting", () => {
  async function freshModule() {
    vi.resetModules();
    engineFetches.length = 0;
    return import("@/lib/tools/archive-extract");
  }

  it("lists a bare .gz without fetching the engine at all", async () => {
    const mod = await freshModule();
    const gz = new Uint8Array(gzipSync(Buffer.from("GET / 200\n".repeat(400))));

    const listing = await mod.readArchive(gz, "access.log.gz");

    expect(listing.viaGzipStream).toBe(true);
    expect(listing.entries.map((e) => e.path)).toEqual(["access.log"]);
    expect(engineFetches).toEqual([]);
  });

  it("does fetch the engine for a .tar.gz, whose payload libarchive must read", async () => {
    const mod = await freshModule();
    const tgz = new Uint8Array(
      gzipSync(
        Buffer.from(
          buildTar([
            { name: "a.txt", body: "alpha" },
            { name: "b.txt", body: "bravo" },
          ]),
        ),
      ),
    );

    const listing = await mod.readArchive(tgz, "bundle.tar.gz");

    // The gzip peek has to be conservative in exactly one direction: a wrong
    // "no" here would list a whole tar as a single .tar file.
    expect(listing.viaGzipStream).toBe(false);
    expect(listing.entries.map((e) => e.path)).toEqual(["a.txt", "b.txt"]);
    expect(engineFetches).toHaveLength(1);
  });

  it("still lists a bare .gz when /libarchive.wasm is unreachable", async () => {
    /*
      The user-visible half of the same fix. Before it, a 404 on the engine
      took down a file that needed nothing from the engine — and the message
      was about hosting, over a gzip the browser could read perfectly well.
    */
    const withEngine = globalThis.fetch;
    vi.stubGlobal("fetch", async () => new Response("not found", { status: 404 }));
    try {
      const mod = await freshModule();
      const gz = new Uint8Array(gzipSync(Buffer.from("plain text payload\n")));

      const listing = await mod.readArchive(gz, "note.txt.gz");

      expect(listing.viaGzipStream).toBe(true);
      expect(listing.entries.map((e) => e.path)).toEqual(["note.txt"]);
    } finally {
      vi.stubGlobal("fetch", withEngine);
    }
  });
});

describe("extractFromArchive", () => {
  it("returns the real bytes of the members that were asked for, and only those", async () => {
    const zip = await buildZip({
      "a.txt": "alpha",
      "b.txt": "bravo",
      "c.txt": "charlie",
    });
    const result = await readArchive(zip, "letters.zip");
    const indexes = result.entries.filter((e) => e.path !== "b.txt").map((e) => e.index);

    const seen: [number, number][] = [];
    const out = await extractFromArchive(zip, result, indexes, {
      onProgress: (done, total) => seen.push([done, total]),
    });

    expect(out.files.map((f) => f.name).sort()).toEqual(["a.txt", "c.txt"]);
    expect(await text(out.files.find((f) => f.name === "a.txt")!.blob)).toBe("alpha");
    expect(out.bytes).toBe("alpha".length + "charlie".length);
    expect(out.failures).toEqual([]);
    expect(seen[0]).toEqual([0, 2]);
    expect(seen[seen.length - 1]).toEqual([2, 2]);
  });

  it("will not write a refused path even when its index is passed in", async () => {
    const zip = await buildZip({ "../../etc/evil.txt": "pwned", "good.txt": "fine" });
    const result = await readArchive(zip, "slip.zip");
    const all = result.entries.map((e) => e.index);

    const out = await extractFromArchive(zip, result, all);
    expect(out.files.map((f) => f.name)).toEqual(["good.txt"]);
    expect(out.files.every((f) => !f.name.includes(".."))).toBe(true);
  });

  it("keeps one corrupt member from costing the whole run", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("ok.txt", "fine");
    // Deliberately incompressible: "x".repeat(4000) deflates to 21 bytes, and
    // corrupting a 21-byte window runs straight past the member and into the
    // central directory, which breaks the whole archive instead of one file.
    let noise = "";
    for (let i = 0; i < 4000; i++) noise += String.fromCharCode(33 + ((i * 37 + (i % 7) * 91) % 90));
    zip.file("bad.bin", noise);
    const bytes = await zip.generateAsync({
      type: "uint8array",
      // STORE would leave nothing to fail: a damaged stored member is just
      // different bytes. DEFLATE gives the reader something to choke on.
      compression: "DEFLATE",
    });

    const result = await readArchive(bytes, "mixed.zip");
    const bad = result.entries.find((e) => e.path === "bad.bin")!;
    const ok = result.entries.find((e) => e.path === "ok.txt")!;

    // Corrupt the deflate stream of the second member, found by its own local
    // file header rather than by a guessed offset: 30 bytes of fixed header,
    // then the name and the extra field, then `csize` bytes of data.
    const damaged = new Uint8Array(bytes);
    let at = -1;
    for (let i = 1; i < damaged.length - 4; i++) {
      const isHeader =
        damaged[i] === 0x50 &&
        damaged[i + 1] === 0x4b &&
        damaged[i + 2] === 0x03 &&
        damaged[i + 3] === 0x04;
      if (isHeader) {
        at = i;
        break;
      }
    }
    expect(at).toBeGreaterThan(0);
    const nameLength = damaged[at + 26] | (damaged[at + 27] << 8);
    const extraLength = damaged[at + 28] | (damaged[at + 29] << 8);
    const compressed =
      damaged[at + 18] |
      (damaged[at + 19] << 8) |
      (damaged[at + 20] << 16) |
      (damaged[at + 21] << 24);
    const dataStart = at + 30 + nameLength + extraLength;
    expect(compressed).toBeGreaterThan(200);
    for (let i = dataStart + 8; i < dataStart + compressed - 8; i++) damaged[i] ^= 0xff;

    const out = await extractFromArchive(damaged, result, [ok.index, bad.index]);
    // The good member still comes out; the bad one is reported by name.
    expect(out.files.map((f) => f.name)).toEqual(["ok.txt"]);
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0].path).toBe("bad.bin");
    expect(out.failures[0].reason).toMatch(/\S/);
  });

  it("numbers a collision instead of letting one file replace another", async () => {
    const zip = await buildZip({ "a/report.txt": "one", "b/report.txt": "two" });
    const result = await readArchive(zip, "reports.zip");
    const out = await extractFromArchive(zip, result, result.entries.map((e) => e.index));
    // Distinct folders, so no collision — the names are the stored paths.
    expect(out.files.map((f) => f.name).sort()).toEqual(["a/report.txt", "b/report.txt"]);
    // And the helper that guards the collision case is exercised directly.
    expect(uniqueNames(out.files.map(() => "report.txt"))).toEqual([
      "report.txt",
      "report (2).txt",
    ]);
  });

  it("refuses to write a file whose name and content could disagree", async () => {
    /*
      Listing and extracting are two separate walks over the same bytes, so
      index N must be the same member both times. If it ever were not, the
      download would carry the right NAME over the wrong CONTENT — the worst
      failure this page could have. Handing it a listing that disagrees with
      the archive is the only way to reach that branch, and it must refuse
      rather than guess.
    */
    const zip = await buildZip({ "real.txt": "real contents" });
    const result = await readArchive(zip, "one.zip");
    const lying = {
      ...result,
      entries: result.entries.map((e) => ({ ...e, path: "invoice.pdf", safePath: "invoice.pdf" })),
    };

    const out = await extractFromArchive(zip, lying, [0]);
    expect(out.files).toEqual([]);
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0].reason).toMatch(/different entry at this position/);
  });

  it("does nothing at all when nothing extractable was selected", async () => {
    const zip = await buildZip({ "a.txt": "alpha" });
    const result = await readArchive(zip, "one.zip");
    const out = await extractFromArchive(zip, result, []);
    expect(out).toEqual({ files: [], failures: [], bytes: 0 });
  });

  /*
    `readData` is a SYNCHRONOUS wasm call, so the only thing keeping a 40-member
    run from freezing the tab is the yield between members — and the yield has
    to be a macrotask to be one. `await Promise.resolve()` queues a microtask,
    and the microtask queue is drained to exhaustion inside the same task, so a
    loop built on it runs start to finish without the browser painting once:
    the frozen tab and the 0-to-100 progress bar the yield exists to prevent.
    That is precisely the bug this file's loop shipped with.

    ── WHY THE TEST DRIVES `scheduler.yield` ────────────────────────────────

    `yieldToEventLoop` prefers `scheduler.yield()`, falls back to
    `MessageChannel`, and uses `setTimeout` last. Under jsdom the middle
    branch is the one taken, and jsdom's `MessageChannel` STARVES TIMERS:
    measured here, ten MessageChannel round-trips in a row with a
    `setTimeout(…, 0)` already pending left that timer unfired, and it only
    ran once the loop stopped. So a `setTimeout` observer cannot see that
    branch yield, and a test built on one reports a blocking loop and a
    yielding loop identically — which is how the first draft of this test
    passed against `await Promise.resolve()`.

    So the test installs the branch a current browser actually takes, tier
    one, and backs it with a real macrotask. That gives two independent
    readings: the loop ASKED the host to yield once per member gap, and a
    timer armed after the first member RAN while members were still
    outstanding. A microtask-only "yield" fails both.
  */
  it("returns to the event loop between members rather than blocking the task", async () => {
    const members = ["alpha", "bravo", "gamma", "delta", "epsilon", "zeta", "eta", "theta"];
    const tar = buildTar(members.map((body, i) => ({ name: `f${i}.txt`, body })));
    const listing = await readArchive(tar, "many.tar");
    expect(listing.entries).toHaveLength(members.length);

    let yields = 0;
    const host = globalThis as typeof globalThis & { scheduler?: unknown };
    const hadScheduler = "scheduler" in host;
    const previousScheduler = host.scheduler;
    host.scheduler = {
      yield: () => {
        yields++;
        return new Promise<void>((resolve) => setTimeout(resolve, 0));
      },
    };

    let doneWhenMacrotaskRan: number | null = null;
    let latestDone = 0;
    let armed = false;

    try {
      const out = await extractFromArchive(
        tar,
        listing,
        members.map((_, i) => i),
        {
          onProgress: (done) => {
            latestDone = done;
            /*
              Armed from INSIDE the loop, not before the call. `newEngine()`
              instantiates WebAssembly and reaches the event loop all by
              itself, so a timer armed before `extractFromArchive` fires
              during engine setup and proves nothing about the loop.
            */
            if (done >= 1 && !armed) {
              armed = true;
              setTimeout(() => {
                doneWhenMacrotaskRan = latestDone;
              }, 0);
            }
          },
        },
      );
      expect(out.files).toHaveLength(members.length);
    } finally {
      if (hadScheduler) host.scheduler = previousScheduler;
      else delete host.scheduler;
    }

    expect(latestDone).toBe(members.length);
    // One yield per member read — the loop asked, rather than running through.
    expect(yields).toBeGreaterThanOrEqual(members.length - 1);
    // And the yield was real: a pending macrotask ran mid-run, not after it.
    expect(doneWhenMacrotaskRan).not.toBeNull();
    expect(doneWhenMacrotaskRan as unknown as number).toBeGreaterThanOrEqual(1);
    expect(doneWhenMacrotaskRan as unknown as number).toBeLessThan(members.length);
  });

  /*
    The one integrity check this engine makes possible. Nothing verifies a
    member's checksum (see the bad-CRC test below), but `readData` returning
    fewer bytes than the archive's own header declared is a fact, and writing
    that out under the full name hands someone a silently truncated file.

    The listing is doctored rather than the archive, for the same reason the
    "name and content could disagree" test above doctors it: this is the
    branch that fires when the two walks disagree about a member, and the
    cheapest way to make them disagree is to say so.
  */
  it("leaves out a member that reads back shorter than its declared size", async () => {
    const zip = await buildZip({ "report.csv": "id,name\n1,alpha\n" });
    const listing = await readArchive(zip, "one.zip");
    const realSize = listing.entries[0].size;

    const overstated: ArchiveListing = {
      ...listing,
      entries: listing.entries.map((e) => ({ ...e, size: realSize + 4096 })),
    };

    const out = await extractFromArchive(zip, overstated, [0]);

    expect(out.files).toEqual([]);
    expect(out.bytes).toBe(0);
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0].path).toBe("report.csv");
    expect(out.failures[0].reason).toMatch(
      new RegExp(`returned ${realSize} bytes .* declares as ${realSize + 4096}`),
    );
    expect(out.failures[0].reason).toMatch(/left out rather than written out short/);
  });

  /*
    ── A LIMITATION, PINNED ─────────────────────────────────────────────────

    This test asserts that corruption goes UNDETECTED, which is not a thing to
    be pleased about — it is here because the page makes a claim about it. The
    ABOUT THIS ENGINE drawer tells the reader that member checksums are not
    verified and that `unzip -t` is the check, and a claim like that has to be
    measured or it is guesswork. Fact 7 in the module header is this run.

    If a future engine build starts enforcing CRC, this test goes red — and
    that is the signal to go and delete the disclosure, not to loosen the
    assertion.
  */
  it("does not notice a member whose CRC is wrong, which is why the page says so", async () => {
    // A stored (uncompressed) ZIP, so the member's bytes are findable and a
    // flipped byte stays the same LENGTH — the case a short read cannot catch.
    const filler = "B".repeat(500);
    const zip = await buildZip({ "a.txt": "AAAAA", "bad.txt": filler, "c.txt": "CCCCC" });
    const at = indexOfBytes(zip, new TextEncoder().encode(filler));
    expect(at).toBeGreaterThan(0);
    const corrupted = new Uint8Array(zip);
    for (let i = at + 100; i < at + 150; i++) corrupted[i] = 0x58; // "X"

    const listing = await readArchive(corrupted, "crc.zip");
    expect(listing.incompleteReason).toBeNull();
    const out = await extractFromArchive(corrupted, listing, [0, 1, 2]);

    // Three clean files, no failure, full declared length — and 50 wrong bytes.
    expect(out.failures).toEqual([]);
    expect(out.files.map((f) => f.name)).toEqual(["a.txt", "bad.txt", "c.txt"]);
    expect(out.files[1].bytes).toBe(500);
    expect(await text(out.files[1].blob)).toContain("X".repeat(50));
  });
});

