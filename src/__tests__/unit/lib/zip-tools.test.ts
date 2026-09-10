import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  baseName,
  classifyEntryPath,
  clampArchiveDate,
  createZip,
  DOS_TIME_MAX,
  DOS_TIME_MIN,
  dosDateToDate,
  dosWallClock,
  extractZipEntries,
  isMethodSupported,
  methodName,
  readZipDirectory,
  resolveZipPath,
  safeEntryName,
  sniffZipContainer,
  uniqueEntryNames,
  ZIP_LEVELS,
  ZipReadError,
  zipArchiveName,
  zipLevel,
} from "@/lib/tools/zip-tools";

/*
  ── A ZIP writer with no opinions ──────────────────────────────────────────

  jszip cannot produce most of what this module exists to detect: it will not
  set the encryption bit, will not write an unsupported compression method, and
  RESOLVES a `../` path away before it reaches the file. Every one of those is
  a real archive somebody will drop on the page, so the traps are built here
  byte by byte instead of hoped for.

  Only what the tests need: no ZIP64, no data descriptors, stored data only —
  the `method` field is written as told, and the payload is left uncompressed,
  which is exactly the shape of a corrupt-method archive anyway.
*/
interface SyntheticEntry {
  /** Ignored when `nameBytes` is given — that is the point of `nameBytes`. */
  name: string;
  /**
   * The raw name bytes, for the archives whose whole subject is a name that is
   * NOT UTF-8: WinRAR and WinZip write a code-page name here and put the real
   * one in a 0x7075 extra field.
   */
  nameBytes?: Uint8Array;
  /** Central-directory extra field bytes, appended verbatim after the name. */
  extra?: number[];
  data?: Uint8Array;
  /** General purpose bit flag. 0x0001 is the encryption bit. */
  flags?: number;
  /** 0 STORE, 8 DEFLATE, 12 BZIP2 … written verbatim. */
  method?: number;
  /** High byte is the host system: 0 = DOS, 3 = UNIX. */
  versionMadeBy?: number;
  externalAttributes?: number;
  modTime?: number;
  modDate?: number;
  dir?: boolean;
  /**
   * Added to the sizes written into the headers WITHOUT adding any bytes, so
   * the index claims more data than the file holds. That is what a resumed or
   * interrupted download leaves behind.
   */
  overstateBy?: number;
}

function buildZip(
  entries: SyntheticEntry[],
  options: {
    prefix?: number;
    /** The EOCD's entry count, when it should DISAGREE with what is written. */
    declaredCount?: number;
    /** The archive comment, as raw bytes — it is allowed to be anything. */
    comment?: number[];
  } = {},
): Uint8Array {
  const enc = new TextEncoder();
  const local: number[] = [];
  const central: number[] = [];
  const prefix = options.prefix ?? 0;

  const u16 = (into: number[], v: number) => into.push(v & 0xff, (v >>> 8) & 0xff);
  const u32 = (into: number[], v: number) =>
    into.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);

  for (const e of entries) {
    const nameBytes = e.nameBytes ?? enc.encode(e.name);
    const extra = e.extra ?? [];
    const data = e.data ?? new Uint8Array(0);
    const offset = prefix + local.length;
    const flags = e.flags ?? 0;
    const method = e.method ?? 0;
    const modTime = e.modTime ?? 0x7527; // 14:41:14
    const modDate = e.modDate ?? 0x5aa7; // 2025-05-07
    const declared = data.length + (e.overstateBy ?? 0);

    u32(local, 0x04034b50);
    u16(local, 20);
    u16(local, flags);
    u16(local, method);
    u16(local, modTime);
    u16(local, modDate);
    u32(local, 0); // crc — not checked by this module
    u32(local, declared);
    u32(local, declared);
    u16(local, nameBytes.length);
    u16(local, 0);
    local.push(...nameBytes, ...data);

    u32(central, 0x02014b50);
    u16(central, e.versionMadeBy ?? 20);
    u16(central, 20);
    u16(central, flags);
    u16(central, method);
    u16(central, modTime);
    u16(central, modDate);
    u32(central, 0);
    u32(central, declared);
    u32(central, declared);
    u16(central, nameBytes.length);
    u16(central, extra.length);
    u16(central, 0);
    u16(central, 0);
    u16(central, 0);
    u32(central, e.externalAttributes ?? (e.dir ? 0x10 : 0));
    u32(central, offset);
    central.push(...nameBytes, ...extra);
  }

  const declaredCount = options.declaredCount ?? entries.length;
  const comment = options.comment ?? [];
  const eocd: number[] = [];
  u32(eocd, 0x06054b50);
  u16(eocd, 0);
  u16(eocd, 0);
  u16(eocd, declaredCount);
  u16(eocd, declaredCount);
  u32(eocd, central.length);
  u32(eocd, prefix + local.length);
  u16(eocd, comment.length);
  eocd.push(...comment);

  return new Uint8Array([...new Array<number>(prefix).fill(0x2e), ...local, ...central, ...eocd]);
}

/**
 * CRC-32, reimplemented in the test rather than imported from the module under
 * test — a Unicode Path field the module CRCs for itself would pass whatever
 * the module computed, which is not a test of anything.
 */
function testCrc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** A 0x7075 Unicode Path extra field: version, name CRC, then UTF-8 bytes. */
function unicodePathField(headerName: Uint8Array, realName: string, crcOverride?: number): number[] {
  const utf8Name = Array.from(new TextEncoder().encode(realName));
  const crc = crcOverride ?? testCrc32(headerName);
  const payload = [1, crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, (crc >>> 24) & 0xff, ...utf8Name];
  return [0x75, 0x70, payload.length & 0xff, (payload.length >>> 8) & 0xff, ...payload];
}

/*
  `Uint8Array.from` rather than the encoder's own array: under vitest's jsdom
  environment `TextEncoder` belongs to a different realm, so what it returns
  fails `x instanceof Uint8Array` in this file's realm — and `jszip`'s type
  sniffing is an `instanceof` chain, so it rejects the bytes with "Can't read
  the data of …". That is a harness artefact and nothing a browser can hit (a
  page's TextEncoder and its Uint8Array share one realm), so it is fixed here
  rather than papered over with a defensive copy in `createZip`, which would
  double the peak memory of every real run to satisfy a test.
*/
const text = (s: string) => Uint8Array.from(new TextEncoder().encode(s));
const readBack = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** A realistic archive from jszip itself, for the round-trip assertions. */
async function jszipArchive(
  files: { name: string; body: string; date?: Date }[],
  compression: "STORE" | "DEFLATE" = "DEFLATE",
): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.body, f.date ? { date: f.date } : undefined);
  return zip.generateAsync({ type: "uint8array", compression, compressionOptions: { level: 6 } });
}

/* ── Paths ────────────────────────────────────────────────────────────────── */

describe("classifyEntryPath — zip slip is refused, not repaired", () => {
  it("passes an ordinary nested path through", () => {
    expect(classifyEntryPath("docs/notes/readme.md")).toEqual({
      normalized: "docs/notes/readme.md",
      unsafe: null,
    });
  });

  it("refuses a .. segment anywhere in the path", () => {
    expect(classifyEntryPath("../../etc/passwd").unsafe).toBe("traversal");
    expect(classifyEntryPath("docs/../../etc/passwd").unsafe).toBe("traversal");
    expect(classifyEntryPath("a/b/..").unsafe).toBe("traversal");
  });

  it("refuses a .. written with backslashes, which a /-only check would miss", () => {
    expect(classifyEntryPath("..\\..\\Windows\\System32\\evil.dll").unsafe).toBe("traversal");
  });

  it("refuses absolute, drive and UNC paths", () => {
    expect(classifyEntryPath("/etc/passwd").unsafe).toBe("absolute");
    expect(classifyEntryPath("C:\\Windows\\evil.dll").unsafe).toBe("drive");
    expect(classifyEntryPath("//server/share/evil.dll").unsafe).toBe("unc");
  });

  it("refuses a name carrying a control character", () => {
    expect(classifyEntryPath("safe.txt\u0000.exe").unsafe).toBe("control");
  });

  it("refuses a path that normalises to nothing", () => {
    expect(classifyEntryPath("./").unsafe).toBe("empty");
    expect(classifyEntryPath(".").unsafe).toBe("empty");
  });

  it("drops . segments but keeps the trailing slash that marks a folder", () => {
    expect(classifyEntryPath("./docs/./sub/").normalized).toBe("docs/sub/");
  });

  it("is stricter than jszip's own resolve, which is the whole point", () => {
    // jszip repairs the path and files the entry under the repaired name; the
    // archive still ASKED to escape and nothing tells the user so.
    expect(resolveZipPath("../../etc/passwd")).toBe("etc/passwd");
    expect(classifyEntryPath("../../etc/passwd").unsafe).toBe("traversal");
    // …and an absolute path survives resolve completely untouched, so
    // comparing the resolved name against the stored one catches nothing.
    expect(resolveZipPath("/etc/passwd")).toBe("/etc/passwd");
    expect(classifyEntryPath("/etc/passwd").unsafe).toBe("absolute");
  });
});

describe("resolveZipPath reproduces jszip's key exactly", () => {
  it.each([
    ["a/./b.txt", "a/b.txt"],
    ["a//b.txt", "a/b.txt"],
    ["../../etc/passwd", "etc/passwd"],
    ["/etc/passwd", "/etc/passwd"],
    ["docs/", "docs/"],
  ])("%s → %s", (input, expected) => {
    expect(resolveZipPath(input)).toBe(expected);
  });

  it("agrees with the key jszip actually files an entry under", async () => {
    const zip = new JSZip();
    zip.file("../../etc/passwd", "pwned");
    const loaded = await JSZip.loadAsync(
      await zip.generateAsync({ type: "uint8array" }),
    );
    expect(Object.keys(loaded.files)).toContain(resolveZipPath("../../etc/passwd"));
  });
});

describe("baseName / safeEntryName / zipArchiveName", () => {
  it("takes the last segment", () => {
    expect(baseName("a/b/c.txt")).toBe("c.txt");
    expect(baseName("c.txt")).toBe("c.txt");
    expect(baseName("a/b/")).toBe("b");
  });

  it("flattens a path a browser filename should never have carried", () => {
    expect(safeEntryName("../../evil.sh")).toBe("evil.sh");
    expect(safeEntryName("C:\\Windows\\evil.dll")).toBe("evil.dll");
    expect(safeEntryName("..")).toBe("unnamed");
    expect(safeEntryName("   ")).toBe("unnamed");
  });

  it("always ends in exactly one .zip", () => {
    expect(zipArchiveName("photos")).toBe("photos.zip");
    expect(zipArchiveName("photos.zip")).toBe("photos.zip");
    expect(zipArchiveName("photos.ZIP")).toBe("photos.zip");
    expect(zipArchiveName("")).toBe("archive.zip");
  });
});

/* ── Container sniffing ───────────────────────────────────────────────────── */

describe("sniffZipContainer names the wrong file rather than guessing", () => {
  it.each([
    ["empty", new Uint8Array(0)],
    ["zip", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])],
    ["zip", new Uint8Array([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0])],
    ["ole2", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
    ["rar", text("Rar!\u001a\u0007\u0000\u0000")],
    ["7z", new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 0])],
    ["gzip", new Uint8Array([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0])],
    ["other", text("%PDF-1.7")],
  ])("reads %s", (expected, bytes) => {
    expect(sniffZipContainer(bytes)).toBe(expected);
  });
});

/* ── Dates ────────────────────────────────────────────────────────────────── */

describe("dosDateToDate", () => {
  it("decodes a DOS timestamp the way jszip does", () => {
    // 2025-05-07 14:41:14 → date 0x5AA7, time 0x7527
    expect(dosDateToDate(0x7527, 0x5aa7)?.toISOString()).toBe("2025-05-07T14:41:14.000Z");
  });

  it("returns null for the impossible dates real writers emit", () => {
    expect(dosDateToDate(0, 0)).toBeNull(); // month 0, day 0
    expect(dosDateToDate(0, (45 << 9) | (13 << 5) | 1)).toBeNull(); // month 13
  });

  it("agrees with jszip on a real archive, to two-second resolution", async () => {
    // 23 seconds is stored as 22: the DOS seconds field counts in twos.
    const when = new Date("2019-03-07T14:35:23.000Z");
    const bytes = await jszipArchive([{ name: "a.txt", body: "hello", date: when }]);
    const mine = readZipDirectory(bytes).entries[0].date;
    const theirs = (await JSZip.loadAsync(bytes)).file("a.txt")!.date;
    expect(mine?.toISOString()).toBe("2019-03-07T14:35:22.000Z");
    expect(mine?.getTime()).toBe(theirs.getTime());
  });
});

describe("clampArchiveDate keeps jszip's 7-bit year from wrapping silently", () => {
  /*
    `direction` is asserted alongside `clamped` because the two counts the UI
    prints are per-direction: a date pulled UP to 1980 is the ordinary case (no
    usable mtime, or a genuinely pre-1980 file), while one pulled DOWN from
    beyond 2107 means something upstream produced a wild timestamp. A boolean
    alone cannot tell those apart, so a regression that collapsed them would
    still satisfy `clamped === true`.
  */
  it("clamps below 1980", () => {
    const r = clampArchiveDate(Date.UTC(1970, 0, 1));
    expect(r.clamped).toBe(true);
    expect(r.direction).toBe("low");
    expect(r.date.getTime()).toBe(DOS_TIME_MIN);
  });

  it("clamps above 2107", () => {
    const r = clampArchiveDate(Date.UTC(2109, 0, 1));
    expect(r.clamped).toBe(true);
    expect(r.direction).toBe("high");
    expect(r.date.getTime()).toBe(DOS_TIME_MAX);
  });

  it("leaves an ordinary date alone", () => {
    const ms = Date.UTC(2024, 5, 1, 12, 0, 0);
    expect(clampArchiveDate(ms)).toEqual({
      date: new Date(ms),
      clamped: false,
      direction: null,
    });
  });

  it("treats a missing timestamp as a clamp rather than inventing one", () => {
    expect(clampArchiveDate(undefined).clamped).toBe(true);
    expect(clampArchiveDate(Number.NaN).clamped).toBe(true);
  });

  it("is guarding against a wrap that jszip really does perform", async () => {
    // The bug being defended against: no clamp, and 1970 comes back as 2098.
    const zip = new JSZip();
    zip.file("a.txt", "x", { date: new Date(Date.UTC(1970, 0, 1)) });
    const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: "uint8array" }));
    expect(loaded.file("a.txt")!.date.getUTCFullYear()).toBe(2098);
  });
});

/* ── Name allocation ──────────────────────────────────────────────────────── */

describe("uniqueEntryNames — because jszip silently replaces a duplicate", () => {
  it("keeps the first and numbers the rest, before the extension", () => {
    expect(uniqueEntryNames(["report.pdf", "report.pdf", "report.pdf"])).toEqual([
      "report.pdf",
      "report (2).pdf",
      "report (3).pdf",
    ]);
  });

  it("folds case, because most filesystems do", () => {
    expect(uniqueEntryNames(["Report.PDF", "report.pdf"])).toEqual([
      "Report.PDF",
      "report (2).pdf",
    ]);
  });

  it("handles a name with no extension and a dotfile", () => {
    expect(uniqueEntryNames(["README", "README"])).toEqual(["README", "README (2)"]);
    expect(uniqueEntryNames([".env", ".env"])).toEqual([".env", ".env (2)"]);
  });

  it("does not renumber into a name already taken", () => {
    expect(uniqueEntryNames(["a.txt", "a (2).txt", "a.txt"])).toEqual([
      "a.txt",
      "a (2).txt",
      "a (3).txt",
    ]);
  });

  it("is guarding against a replacement jszip really performs", async () => {
    const zip = new JSZip();
    zip.file("dup.txt", "FIRST");
    zip.file("dup.txt", "SECOND");
    const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: "uint8array" }));
    expect(Object.keys(loaded.files)).toHaveLength(1);
    expect(await loaded.file("dup.txt")!.async("string")).toBe("SECOND");
  });
});

/* ── Reading a directory ──────────────────────────────────────────────────── */

describe("readZipDirectory refuses a file it cannot read, by name", () => {
  it.each([
    ["empty-file", new Uint8Array(0)],
    ["ole2", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])],
    ["not-a-zip", text("Rar!\u001a\u0007\u0000 rest of a rar file")],
    ["not-a-zip", new Uint8Array([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 0])],
    ["no-eocd", text("%PDF-1.7 this is not an archive at all")],
  ])("throws %s", (code, bytes) => {
    expect(() => readZipDirectory(bytes)).toThrow(ZipReadError);
    try {
      readZipDirectory(bytes);
    } catch (err) {
      expect((err as ZipReadError).code).toBe(code);
      expect((err as ZipReadError).message.length).toBeGreaterThan(40);
    }
  });

  it("names a truncated download rather than saying 'corrupt'", async () => {
    const bytes = await jszipArchive([{ name: "a.txt", body: "hello world" }]);
    const half = bytes.subarray(0, Math.floor(bytes.length / 2));
    expect(() => readZipDirectory(half)).toThrow(/index is missing|half-finished/i);
  });

  it("reads an empty archive as empty rather than as damaged", async () => {
    const bytes = await new JSZip().generateAsync({ type: "uint8array" });
    const dir = readZipDirectory(bytes);
    expect(dir.entries).toEqual([]);
    expect(dir.fileCount).toBe(0);
    expect(dir.loadable).toBe(true);
  });
});

describe("readZipDirectory reads a real archive", () => {
  it("reports both sizes per entry, and they are the real ones", async () => {
    const body = "the quick brown fox ".repeat(200);
    const bytes = await jszipArchive([
      { name: "a.txt", body },
      { name: "b.txt", body: "short" },
    ]);
    const dir = readZipDirectory(bytes);

    expect(dir.entries.map((e) => e.path)).toEqual(["a.txt", "b.txt"]);
    const a = dir.entries[0];
    expect(a.uncompressedSize).toBe(body.length);
    expect(a.compressedSize).toBeLessThan(body.length / 10);
    expect(a.methodLabel).toBe("DEFLATE");
    expect(a.extractable).toBe(true);
    expect(dir.totalUncompressed).toBe(body.length + 5);
    expect(dir.archiveBytes).toBe(bytes.byteLength);
    expect(dir.loadable).toBe(true);
  });

  it("agrees with jszip's own view of the compressed size", async () => {
    const bytes = await jszipArchive([{ name: "a.txt", body: "x".repeat(4000) }]);
    const mine = readZipDirectory(bytes).entries[0];
    const loaded = await JSZip.loadAsync(bytes);
    // `_data` is jszip's internal CompressedObject — read here only to prove
    // the hand-written parser agrees with the library it stands beside.
    const theirs = (loaded.file("a.txt") as unknown as { _data: { compressedSize: number } })._data;
    expect(mine.compressedSize).toBe(theirs.compressedSize);
  });

  it("reports STORE with no saving at all, which is the honest number", async () => {
    const body = "compress me".repeat(100);
    const bytes = await jszipArchive([{ name: "a.txt", body }], "STORE");
    const entry = readZipDirectory(bytes).entries[0];
    expect(entry.methodLabel).toBe("STORE");
    expect(entry.compressedSize).toBe(entry.uncompressedSize);
  });

  it("separates directory entries from files", async () => {
    const zip = new JSZip();
    zip.folder("docs")!.file("x.txt", "hi");
    const dir = readZipDirectory(await zip.generateAsync({ type: "uint8array" }));
    expect(dir.dirCount).toBe(1);
    expect(dir.fileCount).toBe(1);
    expect(dir.entries.find((e) => e.dir)?.path).toBe("docs/");
    expect(dir.entries.find((e) => e.dir)?.extractable).toBe(false);
  });

  it("reads a unicode name back exactly", async () => {
    const bytes = await jszipArchive([{ name: "héllo — ünïcode.txt", body: "hi" }]);
    const entry = readZipDirectory(bytes).entries[0];
    expect(entry.path).toBe("héllo — ünïcode.txt");
    expect(entry.nameEncodingUnknown).toBe(false);
  });

  it("flags a non-ASCII name stored without the UTF-8 flag as a guess", () => {
    // 0x82 is é in CP437 and invalid UTF-8; the flag is not set, so the name
    // on screen is a guess even though the entry's data is fine.
    const name = new TextDecoder().decode(new Uint8Array([0x82, 0x2e, 0x74, 0x78, 0x74]));
    const dir = readZipDirectory(buildZip([{ name, data: text("hi") }]));
    expect(dir.entries[0].nameEncodingUnknown).toBe(true);
  });

  it("reads Unix mode bits when the archive was written on a Unix host", () => {
    const dir = readZipDirectory(
      buildZip([
        // versionMadeBy 0x031e = UNIX; 0o100644 << 16 in the external attributes.
        { name: "a.sh", data: text("#!/bin/sh"), versionMadeBy: 0x031e, externalAttributes: 0o100755 << 16 },
        { name: "b.txt", data: text("x") }, // made on DOS — no mode to read
      ]),
    );
    expect(dir.entries[0].unixMode! & 0o777).toBe(0o755);
    expect(dir.entries[1].unixMode).toBeNull();
  });

  it("survives a prefix, the way a self-extracting archive has one", async () => {
    const dir = readZipDirectory(buildZip([{ name: "a.txt", data: text("hi") }], { prefix: 64 }));
    expect(dir.entries.map((e) => e.path)).toEqual(["a.txt"]);
    expect(dir.entries[0].truncated).toBe(false);
  });
});

describe("readZipDirectory names what jszip would refuse to open", () => {
  it("names the encrypted entries, which jszip cannot", async () => {
    const bytes = buildZip([
      { name: "public.txt", data: text("readable") },
      { name: "secret.txt", data: text("scrambled"), flags: 0x0001 },
    ]);
    const dir = readZipDirectory(bytes);

    expect(dir.encryptedCount).toBe(1);
    expect(dir.entries.find((e) => e.encrypted)?.path).toBe("secret.txt");
    expect(dir.entries.find((e) => e.path === "public.txt")?.extractable).toBe(true);
    // …and the archive as a whole is unopenable, because of that one entry.
    expect(dir.loadable).toBe(false);
    await expect(JSZip.loadAsync(bytes)).rejects.toThrow(/[Ee]ncrypted/);
  });

  it("names an entry in a compression method nothing here can inflate", async () => {
    const bytes = buildZip([
      { name: "a.txt", data: text("plain") },
      { name: "b.txt", data: text("bzipped"), method: 12 },
    ]);
    const dir = readZipDirectory(bytes);

    expect(dir.unsupportedCount).toBe(1);
    expect(dir.entries[1].methodLabel).toBe("BZIP2");
    expect(dir.entries[1].extractable).toBe(false);
    expect(dir.loadable).toBe(false);
    await expect(JSZip.loadAsync(bytes)).rejects.toThrow(/compression/i);
  });

  it("refuses every shape of escaping path while keeping the sane ones", () => {
    const dir = readZipDirectory(
      buildZip([
        { name: "docs/fine.txt", data: text("ok") },
        { name: "../../etc/passwd", data: text("no") },
        { name: "/etc/shadow", data: text("no") },
        { name: "C:\\Windows\\evil.dll", data: text("no") },
      ]),
    );
    expect(dir.unsafeCount).toBe(3);
    expect(dir.entries.filter((e) => e.extractable).map((e) => e.path)).toEqual(["docs/fine.txt"]);
    expect(dir.entries.map((e) => e.unsafe)).toEqual([null, "traversal", "absolute", "drive"]);
    // The archive itself still opens — the refusal is per entry, not global.
    expect(dir.loadable).toBe(true);
  });

  it("counts duplicate paths, which jszip collapses to the last one", async () => {
    const bytes = buildZip([
      { name: "same.txt", data: text("first") },
      { name: "same.txt", data: text("second") },
    ]);
    const dir = readZipDirectory(bytes);
    expect(dir.duplicates).toEqual(["same.txt"]);
    expect(dir.entries).toHaveLength(2);
    expect(Object.keys((await JSZip.loadAsync(bytes)).files)).toHaveLength(1);
  });

  it("refuses the SHADOWED copy of a duplicate rather than handing over the later one's bytes", async () => {
    /*
      Both rows are real records with different sizes, and only the LAST is
      reachable: jszip keys its file table by name and keeps the last of each.
      Offering the first one would deliver the second one's bytes under the
      first one's name, with the first one's size still printed beside it —
      silent loss with a tick in the box. It is marked and refused instead.
    */
    const first = text("first-version-short");
    const second = text("SECOND VERSION, forty-five bytes long here!!!");
    const bytes = buildZip([
      { name: "dup.txt", data: first },
      { name: "dup.txt", data: second },
    ]);
    const dir = readZipDirectory(bytes);

    expect(dir.entries.map((e) => [e.uncompressedSize, e.shadowed, e.extractable])).toEqual([
      [first.length, true, false],
      [second.length, false, true],
    ]);
    // The bytes really do collapse — this is what the refusal is protecting from.
    const both = await extractZipEntries(bytes, ["dup.txt", "dup.txt"]);
    expect(both.files.map((f) => readBack(f.data))).toEqual([
      readBack(second),
      readBack(second),
    ]);
    // …so only the reachable one is offered, and the offered total is honest.
    const offered = dir.entries.filter((e) => e.extractable);
    expect(offered.reduce((n, e) => n + e.uncompressedSize, 0)).toBe(second.length);
  });

  it("keeps a legitimately repeated name in a DIFFERENT folder extractable", () => {
    const dir = readZipDirectory(
      buildZip([
        { name: "a/notes.txt", data: text("one") },
        { name: "b/notes.txt", data: text("two") },
      ]),
    );
    expect(dir.duplicates).toEqual([]);
    expect(dir.entries.map((e) => e.shadowed)).toEqual([false, false]);
    expect(dir.entries.every((e) => e.extractable)).toBe(true);
  });

  it("spots an entry whose data runs past the end of the file", async () => {
    /*
      A valid index over data that is not all there — what an interrupted or
      resumed download leaves behind. jszip's answer to this is a bare
      "Corrupted zip"; the listing names the entry instead.
    */
    const damaged = readZipDirectory(
      buildZip([
        { name: "whole.txt", data: text("all present") },
        { name: "cut-short.txt", data: text("truncated"), overstateBy: 4096 },
      ]),
    );
    expect(damaged.truncatedCount).toBe(1);
    expect(damaged.entries.find((e) => e.truncated)?.path).toBe("cut-short.txt");
    expect(damaged.entries.find((e) => e.truncated)?.extractable).toBe(false);
    expect(damaged.entries[0].truncated).toBe(false);

    // …and a healthy archive is not accused of it.
    const healthy = await jszipArchive([{ name: "a.txt", body: "a".repeat(500) }]);
    expect(readZipDirectory(healthy).truncatedCount).toBe(0);
  });

  it("marks a truncated archive UNLOADABLE, because one short entry takes every whole one with it", async () => {
    /*
      The trap this closes: `truncated` is a per-entry fact, but jszip's
      `readLocalFiles()` reads `compressedSize` bytes for EVERY entry as it
      opens the archive, whatever the caller went on to ask for. So a single
      overstated size throws for the whole file — exactly like an encrypted or
      unsupported entry — and `loadable` has to count it as one, or the page
      offers N ticked, counted, downloadable entries and delivers none of them.
    */
    const bytes = buildZip([
      { name: "good1.txt", data: text("all present and correct") },
      { name: "good2.txt", data: text("also fine") },
      { name: "cut.txt", data: text("cc"), overstateBy: 999_999 },
    ]);
    const dir = readZipDirectory(bytes);

    expect(dir.truncatedCount).toBe(1);
    expect(dir.loadable).toBe(false);
    // The two whole entries still look extractable ON THEIR OWN MERITS…
    expect(dir.entries.filter((e) => e.extractable).map((e) => e.path)).toEqual([
      "good1.txt",
      "good2.txt",
    ]);
    // …and asking for exactly those two still yields nothing, which is why
    // `loadable` is the gate the UI reads rather than `extractable` alone.
    await expect(extractZipEntries(bytes, ["good1.txt", "good2.txt"])).rejects.toThrow(
      /could not be opened/i,
    );
  });
});

/* ── Names stored in a code page, with the real one in an extra field ─────── */

describe("readZipDirectory reads the Unicode Path extra field (0x7075)", () => {
  // "café.txt" as CP437: é is 0x82. Not valid UTF-8, so decoding it as UTF-8
  // yields a replacement character — which is what WinRAR and WinZip leave in
  // the header while putting the true name in a 0x7075 field.
  const CP437_CAFE = Uint8Array.from([0x63, 0x61, 0x66, 0x82, 0x2e, 0x74, 0x78, 0x74]);

  it("lists the entry under the name jszip files it under, not the mojibake one", async () => {
    const bytes = buildZip([
      {
        name: "ignored",
        nameBytes: CP437_CAFE,
        data: text("hi"),
        extra: unicodePathField(CP437_CAFE, "café.txt"),
      },
    ]);
    const dir = readZipDirectory(bytes);

    expect(dir.entries[0].path).toBe("café.txt");
    expect(dir.entries[0].unicodePathField).toBe(true);
    // The archive TOLD us the name, so there is nothing left to warn about.
    expect(dir.entries[0].nameEncodingUnknown).toBe(false);
    // And the name agrees with jszip's own key, which is the whole point.
    expect(Object.keys((await JSZip.loadAsync(bytes)).files)).toEqual(["café.txt"]);
  });

  it("extracts under that name — a row that ticks and does not come out is the bug", async () => {
    const bytes = buildZip([
      {
        name: "ignored",
        nameBytes: CP437_CAFE,
        data: text("contents"),
        extra: unicodePathField(CP437_CAFE, "café.txt"),
      },
    ]);
    const dir = readZipDirectory(bytes);
    const result = await extractZipEntries(
      bytes,
      dir.entries.filter((e) => e.extractable).map((e) => e.path),
    );
    expect(result.failures).toEqual([]);
    expect(result.files.map((f) => f.path)).toEqual(["café.txt"]);
    expect(readBack(result.files[0].data)).toBe("contents");
  });

  it("ignores a field whose name CRC does not match — a stale one left by a rename", () => {
    const header = Uint8Array.from(new TextEncoder().encode("plain.txt"));
    const dir = readZipDirectory(
      buildZip([
        {
          name: "ignored",
          nameBytes: header,
          data: text("hi"),
          extra: unicodePathField(header, "renamed-later.txt", 0xdeadbeef),
        },
      ]),
    );
    // APPNOTE, and jszip: an out-of-date field is not the truth, the header is.
    expect(dir.entries[0].path).toBe("plain.txt");
    expect(dir.entries[0].unicodePathField).toBe(false);
  });

  it("ignores a field with the wrong version byte", () => {
    const field = unicodePathField(CP437_CAFE, "café.txt");
    field[4] = 2; // the version byte, which APPNOTE fixes at 1
    const dir = readZipDirectory(
      buildZip([{ name: "ignored", nameBytes: CP437_CAFE, data: text("hi"), extra: field }]),
    );
    expect(dir.entries[0].unicodePathField).toBe(false);
    expect(dir.entries[0].nameEncodingUnknown).toBe(true);
  });

  it("still flags a code-page name that carries NO such field as a guess", () => {
    const dir = readZipDirectory(
      buildZip([{ name: "ignored", nameBytes: CP437_CAFE, data: text("hi") }]),
    );
    expect(dir.entries[0].unicodePathField).toBe(false);
    expect(dir.entries[0].nameEncodingUnknown).toBe(true);
  });
});

/* ── The index's own count, and the record that carries it ────────────────── */

describe("readZipDirectory carries the count the archive CLAIMS, not just what it read", () => {
  it("reports a declared count that runs ahead of the records found", () => {
    const dir = readZipDirectory(
      buildZip([{ name: "a.txt", data: text("x") }, { name: "b.txt", data: text("y") }], {
        declaredCount: 4,
      }),
    );
    // Two records are all that is there, and the archive says four — the UI
    // needs both numbers to say so instead of short-listing in silence.
    expect(dir.entries).toHaveLength(2);
    expect(dir.declaredEntries).toBe(4);
  });

  it("agrees with the record count on a truthful archive", async () => {
    const bytes = await jszipArchive([
      { name: "a.txt", body: "one" },
      { name: "b.txt", body: "two" },
    ]);
    const dir = readZipDirectory(bytes);
    expect(dir.declaredEntries).toBe(dir.entries.length);
  });
});

describe("findEocd will not take a signature out of the archive comment", () => {
  it("reads the real record when the comment contains a fake EOCD", () => {
    /*
      An archive comment is arbitrary binary. Four bytes of 50 4B 05 06 inside
      one sit at a HIGHER offset than the real record, so a backwards scan for
      the signature alone finds the fake first — and the fake reads as a
      perfectly valid EMPTY archive, which is how a file with contents came to
      be shown as holding nothing. The declared comment length is the
      discriminator: it has to account for every byte after the record.
    */
    const fakeEocd = [0x50, 0x4b, 0x05, 0x06, ...new Array<number>(18).fill(0)];
    const dir = readZipDirectory(
      buildZip([{ name: "a.txt", data: text("hello") }], { comment: fakeEocd }),
    );
    expect(dir.entries.map((e) => e.path)).toEqual(["a.txt"]);
    expect(dir.fileCount).toBe(1);
  });

  it("still reads an ordinary comment", () => {
    const dir = readZipDirectory(
      buildZip([{ name: "a.txt", data: text("hello") }], {
        comment: Array.from(new TextEncoder().encode("built by me")),
      }),
    );
    expect(dir.comment).toBe("built by me");
    expect(dir.entries.map((e) => e.path)).toEqual(["a.txt"]);
  });
});

/* ── Methods ──────────────────────────────────────────────────────────────── */

describe("compression methods", () => {
  it("names the ones people meet", () => {
    expect(methodName(0)).toBe("STORE");
    expect(methodName(8)).toBe("DEFLATE");
    expect(methodName(99)).toBe("AES");
    expect(methodName(42)).toBe("METHOD 42");
  });

  it("claims support for exactly the two jszip registers", () => {
    expect(isMethodSupported(0)).toBe(true);
    expect(isMethodSupported(8)).toBe(true);
    for (const m of [1, 6, 9, 12, 14, 93, 95, 98, 99]) expect(isMethodSupported(m)).toBe(false);
  });
});

/* ── Building ─────────────────────────────────────────────────────────────── */

describe("createZip reports what actually happened, not an estimate", () => {
  const input = (name: string, body: string, lastModified?: number) => ({
    name,
    data: text(body),
    lastModified,
  });

  it("measures the real compressed size out of the finished archive", async () => {
    const body = "repeat me ".repeat(500);
    const result = await createZip([input("a.txt", body)], {
      level: "max",
      keepDates: true,
      stampAt: Date.UTC(2024, 0, 1),
    });

    expect(result.uncompressedTotal).toBe(body.length);
    expect(result.compressedTotal).toBeLessThan(body.length / 20);
    expect(result.entries[0].methodLabel).toBe("DEFLATE");
    // The container costs real bytes, and the page prints them rather than
    // pretending the archive is the sum of its payloads.
    expect(result.overheadBytes).toBeGreaterThan(0);
    expect(result.archiveBytes).toBe(result.compressedTotal + result.overheadBytes);
    expect(result.archiveBytes).toBe(result.bytes.byteLength);
  });

  it("stores rather than deflates when asked, and says so", async () => {
    const body = "repeat me ".repeat(500);
    const result = await createZip([input("a.txt", body)], { level: "store", keepDates: true });
    expect(result.entries[0].methodLabel).toBe("STORE");
    expect(result.compressedTotal).toBe(body.length);
  });

  it("produces an archive jszip and the directory reader both agree on", async () => {
    const result = await createZip([input("a.txt", "hello"), input("b.txt", "world")], {
      level: "normal",
      keepDates: true,
    });
    const loaded = await JSZip.loadAsync(result.bytes);
    expect(await loaded.file("a.txt")!.async("string")).toBe("hello");
    expect(await loaded.file("b.txt")!.async("string")).toBe("world");
    expect(readZipDirectory(result.bytes).fileCount).toBe(2);
  });

  it("renames a duplicate instead of losing it", async () => {
    const result = await createZip(
      [input("report.pdf", "FIRST"), input("report.pdf", "SECOND")],
      { level: "normal", keepDates: true },
    );
    expect(result.renamed).toEqual([{ from: "report.pdf", to: "report (2).pdf" }]);
    const loaded = await JSZip.loadAsync(result.bytes);
    expect(await loaded.file("report.pdf")!.async("string")).toBe("FIRST");
    expect(await loaded.file("report (2).pdf")!.async("string")).toBe("SECOND");
  });

  it("flattens a name that arrived with a path in it", async () => {
    const result = await createZip([input("../../evil.sh", "x")], {
      level: "normal",
      keepDates: true,
    });
    expect(result.entries[0].name).toBe("evil.sh");
    expect(readZipDirectory(result.bytes).entries[0].unsafe).toBeNull();
  });

  /*
    Every date assertion below pins `utcOffsetMinutes`. It has to: the fields a
    ZIP stores are LOCAL WALL CLOCK with no zone in them, so what `createZip`
    writes depends on where it runs, and a test that left the offset to the
    machine would pass in London and fail in Kolkata. `utcOffsetMinutes: 0`
    means "pretend this machine is at UTC", which makes the stored fields equal
    the instant and keeps these assertions about resolution and clamping alone.
  */
  it("keeps each file's own date, to the two seconds a ZIP can hold", async () => {
    const when = Date.UTC(2021, 8, 9, 10, 11, 13);
    const result = await createZip([input("a.txt", "x", when)], {
      level: "normal",
      keepDates: true,
      utcOffsetMinutes: 0,
    });
    const stored = readZipDirectory(result.bytes).entries[0].date!;
    expect(stored.toISOString()).toBe("2021-09-09T10:11:12.000Z");
    expect(result.clampedDates).toBe(0);
  });

  it("stamps one time on everything when asked", async () => {
    const stampAt = Date.UTC(2020, 0, 2, 3, 4, 6);
    const result = await createZip(
      [input("a.txt", "x", Date.UTC(1999, 0, 1)), input("b.txt", "y", Date.UTC(2005, 0, 1))],
      { level: "normal", keepDates: false, stampAt, utcOffsetMinutes: 0 },
    );
    const dates = readZipDirectory(result.bytes)
      .entries.map((e) => e.date!.toISOString());
    expect(dates).toEqual(["2020-01-02T03:04:06.000Z", "2020-01-02T03:04:06.000Z"]);
  });

  it("clamps a pre-1980 date and COUNTS it, instead of wrapping to 2098", async () => {
    const result = await createZip(
      [input("epoch.txt", "x", 0), input("ok.txt", "y", Date.UTC(2024, 0, 1))],
      { level: "normal", keepDates: true, utcOffsetMinutes: 0 },
    );
    expect(result.clampedDates).toBe(1);
    expect(result.entries[0].dateClamped).toBe(true);
    expect(result.entries[1].dateClamped).toBe(false);
    const stored = readZipDirectory(result.bytes).entries[0].date!;
    expect(stored.getUTCFullYear()).toBe(1980);
  });

  /*
    ── The stored timestamp is LOCAL WALL CLOCK ────────────────────────────

    A DOS timestamp has no timezone field, and Finder, Explorer, 7-Zip and
    `unzip` all read one as the clock on the wall. jszip builds the fields from
    `getUTCHours()` and friends, so handing it the raw instant stores UTC and
    every desktop archiver then shows the file shifted by the writer's offset —
    up to fourteen hours, over a page that says the only loss is two seconds.
    `dosWallClock` shifts the instant first so the fields ARE the wall clock.

    `readZipDirectory` decodes with `Date.UTC`, matching jszip, so a date read
    back out here is the stored FIELDS wearing a UTC label — which is exactly
    what a desktop archiver would show, and what these assertions compare.
  */
  it("writes the wall clock the user saw, not UTC, so a desktop unzip agrees", async () => {
    // 14:35:23 on 5 September in a UTC+5:30 zone.
    const when = Date.UTC(2026, 8, 5, 9, 5, 23);
    const result = await createZip([input("report.txt", "x", when)], {
      level: "store",
      keepDates: true,
      utcOffsetMinutes: -330,
    });
    const fields = readZipDirectory(result.bytes).entries[0].date!;
    // 14:35:22 — the two-second rounding, and nothing else.
    expect(fields.toISOString()).toBe("2026-09-05T14:35:22.000Z");
  });

  it("shifts the other way for a zone west of Greenwich", async () => {
    // 09:05:23 on 5 September in UTC-5 (offset +300).
    const when = Date.UTC(2026, 8, 5, 14, 5, 23);
    const result = await createZip([input("report.txt", "x", when)], {
      level: "store",
      keepDates: true,
      utcOffsetMinutes: 300,
    });
    expect(readZipDirectory(result.bytes).entries[0].date!.toISOString()).toBe(
      "2026-09-05T09:05:22.000Z",
    );
  });

  it("stamps the wall clock for 'stamp now' too, not the raw instant", async () => {
    const stampAt = Date.UTC(2026, 0, 2, 3, 4, 6);
    const result = await createZip([input("a.txt", "x"), input("b.txt", "y")], {
      level: "store",
      keepDates: false,
      stampAt,
      utcOffsetMinutes: -330,
    });
    const dates = readZipDirectory(result.bytes).entries.map((e) => e.date!.toISOString());
    expect(dates).toEqual(["2026-01-02T08:34:06.000Z", "2026-01-02T08:34:06.000Z"]);
  });

  it("dosWallClock moves an instant by the offset it is given", () => {
    const ms = Date.UTC(2026, 8, 5, 9, 5, 23);
    expect(new Date(dosWallClock(ms, -330)).toISOString()).toBe("2026-09-05T14:35:23.000Z");
    expect(new Date(dosWallClock(ms, 300)).toISOString()).toBe("2026-09-05T04:05:23.000Z");
    expect(dosWallClock(ms, 0)).toBe(ms);
  });

  it("clamps against the WALL-CLOCK window, so local midnight on 1 Jan 1980 is not a clamp", async () => {
    /*
      The DOS window is a window of wall-clock dates. Clamping the raw instant
      would report every file stamped the first minutes of 1980 — anywhere east
      of Greenwich — as carrying "a modified date a ZIP cannot store", and
      write 1980-01-01 over a date that was already inside the window.
    */
    const localMidnight = Date.UTC(1979, 11, 31, 18, 30, 0); // 1980-01-01 00:00 at UTC+5:30
    const result = await createZip([input("old.txt", "x", localMidnight)], {
      level: "store",
      keepDates: true,
      utcOffsetMinutes: -330,
    });
    expect(result.clampedDates).toBe(0);
    expect(readZipDirectory(result.bytes).entries[0].date!.toISOString()).toBe(
      "1980-01-01T00:00:00.000Z",
    );
  });

  it("counts clamps by DIRECTION, because the two ends are 128 years apart", async () => {
    const result = await createZip(
      [
        input("ancient.txt", "x", Date.UTC(1970, 0, 1)),
        input("future.txt", "y", Date.UTC(2200, 0, 1)),
        input("ok.txt", "z", Date.UTC(2024, 0, 1)),
      ],
      { level: "store", keepDates: true, utcOffsetMinutes: 0 },
    );
    expect(result.clampedLow).toBe(1);
    expect(result.clampedHigh).toBe(1);
    expect(result.clampedDates).toBe(2);
    // …and the archive really does hold the two different dates the counts imply.
    const stored = readZipDirectory(result.bytes).entries.map((e) => e.date!.toISOString());
    expect(stored[0]).toBe("1980-01-01T00:00:00.000Z");
    expect(stored[1]).toBe("2107-12-31T23:59:58.000Z");
  });

  it("counts a high clamp alone as high, with no low clamp to report", async () => {
    const result = await createZip([input("future.txt", "x", Date.UTC(2200, 0, 1))], {
      level: "store",
      keepDates: true,
      utcOffsetMinutes: 0,
    });
    expect(result.clampedLow).toBe(0);
    expect(result.clampedHigh).toBe(1);
  });

  it("counts a missing timestamp as a LOW clamp", async () => {
    const result = await createZip([input("nodate.txt", "x", undefined)], {
      level: "store",
      keepDates: true,
      utcOffsetMinutes: 0,
    });
    expect(result.clampedLow).toBe(1);
    expect(result.clampedHigh).toBe(0);
    expect(readZipDirectory(result.bytes).entries[0].date!.getUTCFullYear()).toBe(1980);
  });

  it("records no POSIX mode, because the browser never had one to give", async () => {
    const result = await createZip([input("a.sh", "#!/bin/sh")], {
      level: "normal",
      keepDates: true,
    });
    expect(readZipDirectory(result.bytes).entries[0].unixMode).toBeNull();
  });

  it("builds an empty archive without throwing", async () => {
    const result = await createZip([], { level: "normal", keepDates: true });
    expect(result.entries).toEqual([]);
    expect(result.uncompressedTotal).toBe(0);
    expect(readZipDirectory(result.bytes).fileCount).toBe(0);
  });
});

describe("ZIP_LEVELS", () => {
  it("maps every id to a level jszip understands", () => {
    expect(ZIP_LEVELS.map((l) => l.level)).toEqual([null, 1, 6, 9]);
    for (const l of ZIP_LEVELS) expect(l.note.length).toBeGreaterThan(60);
  });

  it("falls back to Normal for an unknown id", () => {
    expect(zipLevel("normal").level).toBe(6);
    expect(zipLevel("nope" as never).id).toBe("normal");
  });
});

/* ── Extracting ───────────────────────────────────────────────────────────── */

describe("extractZipEntries", () => {
  it("round-trips content and reports the basename a download can use", async () => {
    const bytes = await jszipArchive([
      { name: "docs/a.txt", body: "alpha" },
      { name: "docs/b.txt", body: "beta" },
    ]);
    const result = await extractZipEntries(bytes, ["docs/a.txt", "docs/b.txt"]);
    expect(result.failures).toEqual([]);
    expect(result.files.map((f) => f.path)).toEqual(["docs/a.txt", "docs/b.txt"]);
    expect(result.files.map((f) => f.baseName)).toEqual(["a.txt", "b.txt"]);
    expect(result.files.map((f) => readBack(f.data))).toEqual(["alpha", "beta"]);
  });

  it("extracts only what was asked for", async () => {
    const bytes = await jszipArchive([
      { name: "a.txt", body: "alpha" },
      { name: "b.txt", body: "beta" },
    ]);
    const result = await extractZipEntries(bytes, ["b.txt"]);
    expect(result.files.map((f) => f.path)).toEqual(["b.txt"]);
  });

  it("names an entry it could not find rather than returning fewer files in silence", async () => {
    const bytes = await jszipArchive([{ name: "a.txt", body: "alpha" }]);
    const result = await extractZipEntries(bytes, ["a.txt", "ghost.txt"]);
    expect(result.files).toHaveLength(1);
    expect(result.failures).toEqual([
      { path: "ghost.txt", reason: "the reader has no entry under this name" },
    ]);
  });

  it("reports progress once per entry", async () => {
    const bytes = await jszipArchive([
      { name: "a.txt", body: "a" },
      { name: "b.txt", body: "b" },
      { name: "c.txt", body: "c" },
    ]);
    const seen: number[] = [];
    await extractZipEntries(bytes, ["a.txt", "b.txt", "c.txt"], (done, total) => {
      expect(total).toBe(3);
      seen.push(done);
    });
    expect(seen).toEqual([1, 2, 3]);
  });

  it("finds an entry stored under an escaping path, by its stored name", async () => {
    // jszip files it under the RESOLVED name; the lookup has to bridge that.
    // The UI refuses these, but the lookup must not be the reason it does.
    const zip = new JSZip();
    zip.file("../../etc/passwd", "pwned");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await extractZipEntries(bytes, ["../../etc/passwd"]);
    expect(result.failures).toEqual([]);
    expect(readBack(result.files[0].data)).toBe("pwned");
  });

  it("turns jszip's encryption refusal into a sentence naming the cause", async () => {
    const bytes = buildZip([
      { name: "public.txt", data: text("readable") },
      { name: "secret.txt", data: text("scrambled"), flags: 0x0001 },
    ]);
    await expect(extractZipEntries(bytes, ["public.txt"])).rejects.toThrow(
      /password-protected/i,
    );
  });
});
