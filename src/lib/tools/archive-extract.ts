/**
 * Read-only archive extraction, on top of libarchive compiled to WebAssembly.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS PAGE CANNOT CREATE ARCHIVES
 * ─────────────────────────────────────────────────────────────────────────
 * Not a policy — a property of the binary. `libarchive-wasm@1.2.0` ships a
 * 613,235-byte `libarchive.wasm` built from libarchive 3.7.7 (the engine
 * reports `libarchive 3.7.7 zlib/1.3.1 liblzma/5.6.4 bz2lib/1.0.8`). Counted
 * in the shipped binary: SIXTEEN `archive_read_support_format_*` symbols
 * (7zip, all, ar, cab, cpio, empty, iso9660, lha, mtree, rar, rar5, tar,
 * warc, xar, zip, zip_seekable) and ZERO `archive_write_set_format_*`. There
 * is no writer to call. Every claim on the page is written against that fact,
 * and `create-zip` is the page that makes archives, on JSZip.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THE LIBRARY ACTUALLY DOES — measured, not assumed
 * ─────────────────────────────────────────────────────────────────────────
 * Every line below was driven against real archives built with the system
 * `zip`/`tar`/`xz`/`bzip2` and with Python's `zipfile`, through the shipped
 * `dist/` build, on 2026-09-05:
 *
 *  1. A file no format reader recognises does NOT come back as an error. The
 *     `ArchiveReader` constructor throws a raw `WebAssembly.RuntimeError:
 *     memory access out of bounds`. That is the library's own bug, not ours:
 *     `wrapLibarchiveWasm.js` wraps `archive_read_new_memory` in a check that,
 *     on failure, calls `error_string(args[0])` — and `args[0]` is the malloc'd
 *     DATA pointer, not an archive handle, so libarchive dereferences garbage.
 *     `describeArchiveFailure` is what turns that trap into a sentence.
 *  2. The trap does NOT poison the module. Measured: a bad file trapped, and
 *     the SAME instance then listed a good ZIP correctly. But the constructor
 *     mallocs the archive bytes BEFORE it throws and never frees them, so a
 *     failed open leaks the whole file inside the engine heap. That is why
 *     every operation here gets a FRESH module instance, which measured at
 *     1.6–5.0 ms once the wasm bytes are cached — cheap enough that there is
 *     nothing to save by reusing one.
 *  3. A bare `.gz`, `.xz` or `.bz2` — a single compressed file rather than a
 *     compressed tar — is NOT readable by libarchive here.
 *     `archive_read_support_format_raw` is not among the sixteen, and the
 *     wrapper only exposes `..._format_all`, which does not include it. So
 *     `hello.txt.gz` traps exactly like a JPEG would. `.gz` is an advertised
 *     format on this page, so the bare-gzip case is handled by the browser's
 *     own `DecompressionStream("gzip")` instead (see `readGzipMember`), and
 *     it is decided BEFORE the engine is fetched — see `gzipPayloadPrefix`.
 *     There is no browser-native xz or bzip2 decoder, so those two say so.
 *  3b. zstd and LZ4 are a third case, and the wording has to be different.
 *     libarchive's filter layer DOES recognise both — the binary carries
 *     "Using external zstd program for zstd decompression", "zstd -d -qq"
 *     and "lz4 -d -q" — but that support shells out, and there is no shell
 *     in WebAssembly. So a `.tar.zst` is a format the engine knows and
 *     cannot open, which is not the same sentence as "these bytes are not
 *     an archive". Measured: the `ArchiveReader` constructor throws
 *     `RuntimeError: memory access out of bounds` on a real
 *     `tar --zstd -cf` file, indistinguishable from a JPEG, so the sniff is
 *     again the only thing that knows what happened.
 *  4. A walk can end EARLY AND SILENTLY. `read_next_entry` returns 0 both at
 *     the end of the archive and on a fatal header error. Measured: four
 *     bytes of ZIP magic followed by 500 bytes of noise listed ZERO entries,
 *     threw nothing, and left `archive_error_string` reading "Truncated ZIP
 *     file header". So every walk here reads that string afterwards and
 *     reports it as `incompleteReason` rather than presenting a short list as
 *     a complete one.
 *  5. Per-entry failures are clean JS errors and do NOT end the walk:
 *     "Passphrase required for this entry", "Incorrect passphrase",
 *     "ZIP decompression failed (-3)" on a corrupted member,
 *     "Truncated input file (needed 4390 bytes, only 2581 available)".
 *  6. `ArchiveReaderEntry.readData()` may be called at most once per entry and
 *     returns `undefined` when the declared size is 0 — including for a file
 *     the container declares no size for, which therefore comes out empty.
 *     It returns however many bytes `archive_read_data` managed, which is
 *     fewer than the declared size when the file ends early, so a short read
 *     is a fact this module can check even though a checksum is not.
 *  7. NOTHING HERE VERIFIES A MEMBER'S CHECKSUM. Measured: a stored-method
 *     ZIP with 50 bytes overwritten inside one member read back the full
 *     500 declared bytes, threw nothing, and left `archive_error_string`
 *     empty, while `unzip -t` on the same file reported "bad CRC" and exited
 *     2. libarchive-wasm's wrapper exposes no way to ask for the check and
 *     this build does not enforce it, so corruption that preserves the
 *     length is invisible here. The page says so rather than implying the
 *     bytes were verified; `extractFromArchive` catches the case it CAN
 *     catch, a read shorter than the declared size.
 *
 * The module is DOM-free apart from `Blob`/`DecompressionStream` in the two
 * async entry points, and every decision that can be made without the engine
 * (path safety, container sniffing, failure wording, download naming) is a
 * pure exported function so the unit suite can reach it.
 */

/**
 * The DropZone `accept` string. Mirrors the registry's `acceptFormats` for
 * `extract-archive`; the workspace ACCEPTS label is derived from the same
 * registry string, and a unit test fails if the two disagree.
 */
export const ARCHIVE_ACCEPT = ".zip,.tar,.gz,.tgz,.bz2,.xz,.7z,.rar";

/**
 * Every kind the sniff can return, as a VALUE so a test can walk it.
 *
 * This was a bare union, and the suite's "has a sentence for every container
 * kind" test RETYPED that union as an array of its own. So when `zstd` and
 * `lz4` were added the test went on passing over the eight kinds it already
 * knew and never asked whether the two new ones had wording — a test that
 * cannot fail. A list the type is DERIVED from cannot drift that way: adding
 * a kind here is what makes the exhaustive tests cover it.
 */
export const CONTAINER_KINDS = [
  "zip",
  "7z",
  "rar",
  "tar",
  "gzip",
  "xz",
  "bzip2",
  "zstd",
  "lz4",
  "unknown",
] as const;

/** What the first bytes of the dropped file say it is. */
export type ContainerKind = (typeof CONTAINER_KINDS)[number];

export type ArchiveEntryKind = "file" | "directory" | "symlink" | "other";

/** Why a stored path is refused. */
export type UnsafePathReason = "absolute" | "drive" | "traversal" | "empty";

export interface ArchiveEntry {
  /** Position in the walk, 0-based. The handle the extract pass re-finds. */
  index: number;
  /** The path exactly as the archive stores it, shown verbatim. */
  path: string;
  /**
   * The path this file may be written to, or `null` when the stored path
   * would escape the folder it is extracted into. A refused entry is listed
   * and named; it is never silently rewritten into something safe.
   */
  safePath: string | null;
  unsafeReason: UnsafePathReason | null;
  kind: ArchiveEntryKind;
  /**
   * Uncompressed size the archive DECLARES, in bytes. 0 for directories, and
   * 0 for a member whose container records no size — such a member extracts
   * to an empty file, which is why `zeroSizeFiles` is counted separately.
   */
  size: number;
  encrypted: boolean;
  /** Modification time in epoch ms, or `null` when the archive stores none. */
  modifiedAt: number | null;
  /** Target of a symlink or hard link, or `null`. */
  linkTarget: string | null;
  /** True when this member's own name looks like another archive. */
  nested: boolean;
}

export interface ArchiveListing {
  entries: ArchiveEntry[];
  /** Sniffed from the first bytes, not reported by the engine. */
  container: ContainerKind;
  /** `archive_version_string()`, e.g. "libarchive 3.7.7". */
  engine: string;
  /**
   * libarchive's own error text if the walk stopped before the end of the
   * file, else `null`. A non-null value means the list above is PARTIAL.
   */
  incompleteReason: string | null;
  /**
   * True when the file was a single gzip-compressed file rather than an
   * archive, and the listing was synthesised from the gzip header and trailer
   * instead of being read by libarchive.
   */
  viaGzipStream: boolean;
  /**
   * Where `entry.size` came from. The gzip trailer records the uncompressed
   * size modulo 2^32, so it is a claim by the file rather than a measurement.
   */
  sizeSource: "archive" | "gzip-trailer";
}

export interface ArchiveSummary {
  entries: number;
  files: number;
  directories: number;
  links: number;
  /** Files whose declared size is 0 — they extract to empty files. */
  zeroSizeFiles: number;
  encrypted: number;
  refused: number;
  nested: number;
  /** Sum of the declared sizes of file entries. */
  declaredBytes: number;
  /** Entries that can actually be selected and written out. */
  extractable: number;
}

export interface ExtractedFile {
  index: number;
  /** The safe path, used as the name inside the ZIP or as the file name. */
  name: string;
  /** The path as stored, for reporting. */
  path: string;
  blob: Blob;
  bytes: number;
}

export interface ExtractFailure {
  index: number;
  path: string;
  /** A sentence, already user-facing. */
  reason: string;
}

export interface ExtractResult {
  files: ExtractedFile[];
  failures: ExtractFailure[];
  /** Total bytes actually produced, measured rather than declared. */
  bytes: number;
}

export interface ArchiveOptions {
  /** Passphrase for encrypted members. Empty string means "none supplied". */
  passphrase?: string;
  signal?: AbortSignal;
}

/* ────────────────────────────────────────────────────────────────────────
   Pure helpers — no engine, no DOM, all directly unit-tested
   ──────────────────────────────────────────────────────────────────────── */

const startsWith = (bytes: Uint8Array, magic: number[], at = 0): boolean => {
  if (bytes.length < at + magic.length) return false;
  for (let i = 0; i < magic.length; i++) if (bytes[at + i] !== magic[i]) return false;
  return true;
};

/**
 * What the first bytes claim the file is.
 *
 * Used for two things only, both about wording: choosing the gzip fallback,
 * and telling someone who dropped a bare `.xz` why nothing opened. It is never
 * used to decide whether to TRY — libarchive gets the bytes regardless, and a
 * tar with an unusual header is recognised by the engine and not by this.
 */
export function sniffContainer(bytes: Uint8Array): ContainerKind {
  // "PK" then a local file header, a central directory end, or a spanned marker.
  if (
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])
  ) {
    return "zip";
  }
  if (startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return "7z";
  if (startsWith(bytes, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) return "rar";
  if (startsWith(bytes, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return "xz";
  if (startsWith(bytes, [0x1f, 0x8b])) return "gzip";
  if (startsWith(bytes, [0x42, 0x5a, 0x68])) return "bzip2";
  /*
    zstd and LZ4 are here so the FAILURE can be worded honestly, not because
    anything opens them: libarchive knows both formats and decompresses them
    by running the `zstd`/`lz4` program, which cannot exist in WebAssembly.
    Without these two lines a `.tar.zst` is told its bytes match no format
    the engine reads, which is false — see fact 3b at the top of this file.
  */
  if (startsWith(bytes, [0x28, 0xb5, 0x2f, 0xfd])) return "zstd";
  if (startsWith(bytes, [0x04, 0x22, 0x4d, 0x18])) return "lz4";
  // A tar has no leading magic: "ustar" sits at offset 257 of the first header.
  if (startsWith(bytes, [0x75, 0x73, 0x74, 0x61, 0x72], 257)) return "tar";
  return "unknown";
}

const CONTAINER_LABEL: Record<ContainerKind, string> = {
  zip: "ZIP",
  "7z": "7-Zip",
  rar: "RAR",
  tar: "TAR",
  gzip: "GZIP",
  xz: "XZ",
  bzip2: "BZIP2",
  zstd: "ZSTD",
  lz4: "LZ4",
  unknown: "UNKNOWN",
};

/** Short label for the canvas header. */
export function containerLabel(kind: ContainerKind): string {
  return CONTAINER_LABEL[kind];
}

const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

/**
 * Does this 512-byte block parse as a tar header?
 *
 * `sniffContainer` looks for "ustar" at offset 257, which POSIX and GNU tars
 * both write — and a V7 tar, the original format, writes NO magic at all.
 * libarchive reads V7 happily, so a detector that only knows "ustar" would
 * call a `v7.tar.gz` a single compressed file and hand back one .tar instead
 * of its members. The checksum is the format's own self-test and is present
 * in every variant: eight octal digits at offset 148 over the whole header
 * with that field itself read as spaces. Historical tars summed the bytes as
 * SIGNED chars, so both totals are accepted, exactly as libarchive does.
 */
export function looksLikeTarHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 512) return false;
  let declared = 0;
  let digits = 0;
  for (let i = 148; i < 156; i++) {
    const c = bytes[i];
    // Leading padding before the digits, and the NUL/space that ends them.
    if (c === 0x20 || c === 0x00) {
      if (digits > 0) break;
      continue;
    }
    if (c < 0x30 || c > 0x37) return false;
    declared = declared * 8 + (c - 0x30);
    digits++;
  }
  // An all-zero block is the tar END marker, not a header.
  if (digits === 0) return false;
  let unsigned = 0;
  let signed = 0;
  for (let i = 0; i < 512; i++) {
    const b = i >= 148 && i < 156 ? 0x20 : bytes[i];
    unsigned += b;
    signed += b > 127 ? b - 256 : b;
  }
  return declared === unsigned || declared === signed;
}

/**
 * Magics for the readers `sniffContainer` does not name, checked against a
 * DECOMPRESSED gzip payload. `sniffContainer` exists to word failures and
 * only knows the containers this page advertises; this list exists to answer
 * one narrower question — "would libarchive have anything to say about these
 * bytes?" — so it has to cover the other readers in the binary.
 */
const PAYLOAD_MAGICS: readonly { at: number; magic: number[] }[] = [
  { at: 0, magic: ascii("070707") }, // cpio, old ASCII
  { at: 0, magic: ascii("070701") }, // cpio, new ASCII
  { at: 0, magic: ascii("070702") }, // cpio, new ASCII with CRC
  { at: 0, magic: [0xc7, 0x71] }, // cpio, old binary — either byte order
  { at: 0, magic: [0x71, 0xc7] },
  { at: 0, magic: ascii("!<arch>\n") }, // ar, and therefore .deb
  { at: 0, magic: ascii("MSCF") }, // cab
  { at: 0, magic: ascii("xar!") }, // xar
  { at: 0, magic: ascii("WARC/") }, // warc
  { at: 0, magic: ascii("#mtree") }, // mtree
  { at: 2, magic: ascii("-lh") }, // lha
  { at: 2, magic: ascii("-lz") }, // lzh
  { at: 32769, magic: ascii("CD001") }, // iso9660, in the first volume descriptor
];

/**
 * Whether the bytes inside a gzip are something libarchive would read.
 *
 * This is the gate that keeps a bare `.gz` from fetching 599 KB of engine it
 * will not use. It has to be CONSERVATIVE in one direction only: saying "yes"
 * costs nothing but the download that would have happened anyway, while a
 * wrong "no" would list a `.tar.gz` as a single .tar file. So every reader in
 * the binary gets a bid, the tar test is the checksum rather than the magic,
 * and anything unrecognised — which is what a gzipped log or CSV looks like —
 * is the only case that skips the engine.
 */
export function payloadLooksLikeArchive(payload: Uint8Array): boolean {
  if (sniffContainer(payload) !== "unknown") return true;
  if (looksLikeTarHeader(payload)) return true;
  return PAYLOAD_MAGICS.some(({ at, magic }) => startsWith(payload, magic, at));
}

/**
 * Decide whether a stored path may be written, and refuse it if not.
 *
 * This is the zip-slip gate, and it REFUSES rather than sanitises. An archive
 * that stores `../../etc/evil.txt` is telling you something about itself, and
 * quietly rewriting it to `etc/evil.txt` throws that away — the file lands
 * looking ordinary and nothing on screen ever said the archive tried. Nothing
 * here can overwrite a system file (a browser download cannot write outside
 * the download folder), but the same archive unpacked by `tar` or `unzip -o`
 * on a shell CAN, so the entry is named on screen instead.
 *
 * Backslashes are treated as separators for the purpose of the check, because
 * ZIPs written by Windows tools store `..\..\x` and a POSIX-only reading of
 * that string sees one harmless filename.
 */
export function classifyEntryPath(raw: string): {
  safePath: string | null;
  reason: UnsafePathReason | null;
} {
  const path = raw.replace(/\\/g, "/");
  if (path.trim() === "") return { safePath: null, reason: "empty" };
  // `C:/x` and `\\server\share` — absolute on Windows even without a slash.
  if (/^[A-Za-z]:/.test(path)) return { safePath: null, reason: "drive" };
  if (path.startsWith("//")) return { safePath: null, reason: "drive" };
  if (path.startsWith("/")) return { safePath: null, reason: "absolute" };

  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") return { safePath: null, reason: "traversal" };
    segments.push(segment);
  }
  if (segments.length === 0) return { safePath: null, reason: "empty" };
  return { safePath: segments.join("/"), reason: null };
}

const UNSAFE_WORDING: Record<UnsafePathReason, string> = {
  absolute: "an absolute path",
  drive: "a drive-letter or network path",
  traversal: "a path that climbs out with ..",
  empty: "no usable name",
};

export function unsafeWording(reason: UnsafePathReason): string {
  return UNSAFE_WORDING[reason];
}

/** Extensions this page would itself accept — i.e. members it will not open. */
const NESTED_EXTENSIONS = [
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".bz2",
  ".tbz2",
  ".xz",
  ".txz",
  ".7z",
  ".rar",
];

/**
 * True when a member's own name says it is another archive.
 *
 * Nothing recurses. A `.tar.gz` inside a `.zip` comes out as a `.tar.gz` file,
 * and the page says so instead of quietly unpacking two levels — which is how
 * a "extract all" ends up with a folder nobody expected and 40,000 files.
 */
export function looksNested(path: string): boolean {
  const lower = path.toLowerCase();
  return NESTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Names for the download, one per file, with collisions resolved.
 *
 * Members keep their full stored path so a ZIP of the selection rebuilds the
 * original folders. Two members can still collide once refused entries are
 * dropped, and JSZip's `file()` silently REPLACES an existing name, so a
 * collision would cost a file with nothing said. Duplicates get ` (2)` before
 * the extension, the way a browser names a second download.
 */
export function uniqueNames(paths: string[]): string[] {
  const used = new Set<string>();
  return paths.map((path) => {
    if (!used.has(path)) {
      used.add(path);
      return path;
    }
    const dot = path.lastIndexOf(".");
    const slash = path.lastIndexOf("/");
    const cut = dot > slash + 1 ? dot : path.length;
    const stem = path.slice(0, cut);
    const ext = path.slice(cut);
    for (let n = 2; ; n++) {
      const candidate = `${stem} (${n})${ext}`;
      if (!used.has(candidate)) {
        used.add(candidate);
        return candidate;
      }
    }
  });
}

/** Everything the canvas counts, derived once so the stats cannot disagree. */
export function summariseListing(listing: ArchiveListing): ArchiveSummary {
  const s: ArchiveSummary = {
    entries: listing.entries.length,
    files: 0,
    directories: 0,
    links: 0,
    zeroSizeFiles: 0,
    encrypted: 0,
    refused: 0,
    nested: 0,
    declaredBytes: 0,
    extractable: 0,
  };
  for (const e of listing.entries) {
    if (e.kind === "file") {
      s.files++;
      s.declaredBytes += e.size;
      if (e.size === 0) s.zeroSizeFiles++;
    } else if (e.kind === "directory") s.directories++;
    else if (e.kind === "symlink") s.links++;
    if (e.encrypted) s.encrypted++;
    if (e.safePath === null) s.refused++;
    if (e.nested) s.nested++;
    if (isExtractable(e)) s.extractable++;
  }
  return s;
}

/**
 * Whether an entry can be written out at all.
 *
 * Files only: a directory has no bytes, and a symlink's "content" is a path
 * on a machine that is not yours — writing it out as a text file containing
 * `../hello.txt` would be a file nobody asked for. Refused paths are excluded
 * here rather than at the checkbox, so the count and the control agree.
 */
export function isExtractable(
  entry: ArchiveEntry,
): entry is ArchiveEntry & { safePath: string } {
  return entry.kind === "file" && entry.safePath !== null;
}

/**
 * The gzip member's stored original filename, or `null`.
 *
 * RFC 1952: byte 3 is FLG; bit 2 (FEXTRA) prefixes an extra field with its
 * own 2-byte length, and bit 3 (FNAME) is a NUL-terminated original name.
 * `gzip -k hello.txt` sets FNAME, so this recovers the real name instead of
 * guessing one by chopping ".gz" off the download.
 */
export function gzipStoredName(bytes: Uint8Array): string | null {
  if (bytes.length < 10 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return null;
  const flags = bytes[3];
  if ((flags & 0x08) === 0) return null;
  let at = 10;
  if (flags & 0x04) {
    if (at + 2 > bytes.length) return null;
    at += 2 + (bytes[at] | (bytes[at + 1] << 8));
  }
  const start = at;
  while (at < bytes.length && bytes[at] !== 0) at++;
  if (at >= bytes.length || at === start) return null;
  // The name is ISO-8859-1 by the RFC, and browsers write UTF-8 anyway; the
  // latin1 decoder never throws, which is what matters for a header field.
  const name = new TextDecoder("iso-8859-1").decode(bytes.subarray(start, at));
  // A stored name may not carry a directory — that is the same escape the
  // entry-path gate refuses, arriving through a different door.
  return classifyEntryPath(name).safePath === name ? name : null;
}

/**
 * The uncompressed size a gzip file claims, from its 4-byte ISIZE trailer.
 *
 * MODULO 2^32 by the format's own definition, and for a multi-member gzip it
 * describes only the LAST member. It is reported as a claim by the file, not
 * as a measurement — the byte count shown after extraction is measured.
 */
export function gzipDeclaredSize(bytes: Uint8Array): number {
  if (bytes.length < 4) return 0;
  const n = bytes.length;
  return (
    (bytes[n - 4] | (bytes[n - 3] << 8) | (bytes[n - 2] << 16) | (bytes[n - 1] << 24)) >>> 0
  );
}

/** Drop one archive extension from a file name, for the gzip fallback. */
export function gzipFallbackName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".tgz")) return `${fileName.slice(0, -4)}.tar`;
  if (lower.endsWith(".gz")) return fileName.slice(0, -3);
  return `${fileName}.out`;
}

/**
 * Why the file could not be opened at all, from the container sniff alone.
 *
 * THE THROWN MESSAGE IS DELIBERATELY IGNORED, and that is the point. When
 * `archive_read_new_memory` fails, `wrapLibarchiveWasm.js` calls
 * `error_string(args[0])` on the malloc'd DATA pointer instead of an archive
 * handle, so libarchive formats whatever bytes happen to sit there. Measured
 * on three files: "memory access out of bounds" (a wasm trap), and — from a
 * 21-byte gzip — an `Error` whose entire message was the phrase
 * "or this entry", scavenged out of the heap. Showing the reader either of
 * those would be showing them noise and calling it a diagnosis. The sniff is
 * the only thing here that knows something true.
 */
export function describeOpenFailure(container: ContainerKind): string {
  if (container === "xz" || container === "bzip2") {
    const name = container === "xz" ? "xz" : "bzip2";
    return `This is a single file compressed with ${name}, not an archive. The engine reads ${name}-compressed tar archives — the kind that unpack into folders — but it has no reader for a bare ${name} stream holding one file, and no browser can decompress ${name} on its own. Decompressing it needs ${name} on your own machine.`;
  }
  if (container === "zstd" || container === "lz4") {
    const name = container === "zstd" ? "zstd" : "LZ4";
    const command = container === "zstd" ? "zstd -d" : "lz4 -d";
    return `This is compressed with ${name}. The engine recognises the format — it is one it normally handles by running the ${name} program — and there is no program to run inside WebAssembly, so it cannot be decompressed here. Run ${command} on the file on your own machine and drop the result back in: if what comes out is a .tar, this page opens it.`;
  }
  if (container === "gzip") {
    return "This looks like a gzip file, but neither the archive engine nor the browser's own gzip decoder could read it. It may be truncated or corrupted.";
  }
  if (container === "unknown") {
    return "These bytes are not an archive in any format this engine reads. Its readers cover ZIP, TAR, 7-Zip, RAR, CPIO, AR, CAB, LHA, ISO9660, XAR, WARC and mtree, plus gzip, xz and bzip2 wrappers around a tar — the first bytes of this file match none of them.";
  }
  return `The file looks like ${CONTAINER_LABEL[container]} from its first bytes, but the engine could not open it. That usually means the header is damaged or the file is only partly downloaded.`;
}

/**
 * Turn a message libarchive produced DURING a walk into a sentence.
 *
 * Unlike an open failure, these strings are real: they come from
 * `archive_error_string` on a live archive handle, so the message is the
 * input and the container sniff is not needed — measured examples are in
 * fact 5 at the top of this file.
 */
export function describeArchiveFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/passphrase required/i.test(message)) {
    return "This entry is encrypted. Type the archive's password in the rail and try again.";
  }
  if (/incorrect passphrase|too many incorrect/i.test(message)) {
    return "That password did not open this entry.";
  }
  if (/truncated/i.test(message)) {
    return `The archive ends before the engine expected it to — it is incomplete or was only partly downloaded. The engine said: ${message}`;
  }
  if (/encrypt/i.test(message)) {
    return `This entry is encrypted in a way this build cannot open. The engine said: ${message}`;
  }
  return message || "The archive could not be read.";
}

/* ────────────────────────────────────────────────────────────────────────
   The engine
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Same-origin URL of the self-hosted engine, prefixed the way every other
 * one in this app is. `libarchive.wasm` is copied to the origin ROOT by
 * `npm run copy:wasm`, beside `ffmpeg-core.wasm` and `qpdf.wasm`.
 *
 * NOT A CDN, EVER. `libarchive-wasm`'s own glue would locate the binary
 * relative to the script that loaded it; the whole promise of this site is
 * that dropping a file makes no request carrying anything about it, and a
 * third-party engine fetch is a request that says which tool you opened and
 * where you are. `ffmpeg-loader.ts` states the same rule at length.
 */
function engineUrl(name: string): string {
  return `${process.env.__NEXT_ROUTER_BASEPATH ?? ""}/${name}`;
}

/** The fetched wasm bytes, memoised; one request per tab, not per archive. */
let wasmBytes: Promise<ArrayBuffer> | null = null;

function loadWasmBytes(): Promise<ArrayBuffer> {
  if (!wasmBytes) {
    wasmBytes = (async () => {
      const response = await fetch(engineUrl("libarchive.wasm"));
      if (!response.ok) {
        throw new Error(
          `The archive engine could not be loaded (HTTP ${response.status}). It is served from this site, so a failure here is a network or hosting problem rather than anything about your file.`,
        );
      }
      return response.arrayBuffer();
    })().catch((err: unknown) => {
      // A rejected promise left in the memo would replay the same failure
      // forever; a plain `fetch` failure is not remembered by the browser the
      // way a failed module import is, so dropping the memo is enough.
      wasmBytes = null;
      throw err;
    });
  }
  return wasmBytes;
}

type Libarchive = Awaited<ReturnType<typeof import("libarchive-wasm").libarchiveWasm>>;

/**
 * A FRESH module instance for every operation. See fact 2 in the header: a
 * failed open leaks the whole archive inside the engine heap, the heap never
 * shrinks once grown, and a new instance measured at 1.6–5.0 ms with the wasm
 * bytes already in hand. Reuse would buy milliseconds and cost a leak per bad
 * file — the same "one instance per call" discipline `qpdf.worker.ts` keeps,
 * for a different reason.
 *
 * `wasmBinary` is honoured by this glue — verified by handing it the real
 * bytes together with a `locateFile` pointing at a path that does not exist,
 * and watching it instantiate anyway. So no URL the glue builds is ever
 * fetched; the only request is `loadWasmBytes`'s own, to this origin.
 */
async function newEngine(): Promise<{
  archive: Libarchive;
  ArchiveReader: typeof import("libarchive-wasm").ArchiveReader;
}> {
  if (typeof WebAssembly === "undefined") {
    throw new Error("Reading archives needs a browser with WebAssembly.");
  }
  const [{ libarchiveWasm, ArchiveReader }, binary] = await Promise.all([
    import("libarchive-wasm"),
    loadWasmBytes(),
  ]);
  /*
    The same ArrayBuffer is handed to every instance. The glue copies it
    (`new Uint8Array(wasmBinary)`) rather than taking it, and nothing detaches
    it — measured by building five instances in a row from one buffer, all of
    which read a ZIP correctly afterwards. So there is no need to re-fetch or
    re-copy 613 KB per archive.
  */
  const archive = await libarchiveWasm({
    wasmBinary: binary,
    locateFile: (path: string) => engineUrl(path),
  });
  return { archive, ArchiveReader };
}

const FILETYPE: Record<string, ArchiveEntryKind> = {
  File: "file",
  Directory: "directory",
  SymbolicLink: "symlink",
};

function toUint8(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

/** libarchive reads Int8Array; the bytes are identical, the view is not. */
function toInt8(bytes: Uint8Array): Int8Array {
  return new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Enough decompressed bytes to tell a `.tar.gz` from an `access.log.gz`.
 *
 * 33 KB rather than 1 KB for one reader only: ISO9660 puts its "CD001" magic
 * in the volume descriptor at offset 32769, and everything else bids inside
 * the first 512 bytes.
 */
const GZIP_SNIFF_BYTES = 33 * 1024;

/**
 * The first bytes INSIDE a gzip, without loading the engine and without
 * decompressing the whole file.
 *
 * Returns `null` when nothing could be read at all — no `DecompressionStream`
 * in this browser, or a stream that failed before its first chunk — and the
 * caller then falls back to letting libarchive try, which is what this module
 * did unconditionally before. A stream that yields some bytes and THEN fails
 * (a truncated or corrupted gzip) still returns what it gave: those bytes are
 * enough to answer "is there a tar in here", and a damaged bare gzip should
 * not have to pay for an engine either.
 */
async function gzipPayloadPrefix(
  bytes: Uint8Array,
  limit = GZIP_SNIFF_BYTES,
): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === "undefined") return null;
  // `new Response(bytes).body` rather than `Blob.stream()`, for the reason
  // spelled out in `readGzipMember`: jsdom's Blob has no stream().
  const source = new Response(bytes as BodyInit).body;
  if (!source) return null;
  const reader = source.pipeThrough(new DecompressionStream("gzip")).getReader();
  const chunks: Uint8Array[] = [];
  let taken = 0;
  try {
    while (taken < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      taken += value.byteLength;
    }
  } catch {
    // Damaged partway through. Whatever arrived first is still true.
  }
  try {
    await reader.cancel();
  } catch {
    // Already errored or already closed; there is nothing to release.
  }
  if (taken === 0) return null;
  const out = new Uint8Array(taken);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/**
 * List what is inside, without extracting anything.
 *
 * Sizes come from the archive's own headers, so a listing is fast even on a
 * solid 7z: nothing is decompressed. Selecting and extracting is the pass that
 * costs — see `extractFromArchive`.
 */
export async function readArchive(
  data: ArrayBuffer | Uint8Array,
  fileName: string,
  options: ArchiveOptions = {},
): Promise<ArchiveListing> {
  const bytes = toUint8(data);
  const container = sniffContainer(bytes);
  const passphrase = options.passphrase?.trim() ? options.passphrase : undefined;

  /*
    BEFORE THE ENGINE, NOT AFTER. A bare gzip is read by the browser's own
    decoder and needs nothing from libarchive — but deciding that from the
    ArchiveReader constructor's failure means fetching and instantiating
    599 KB of WebAssembly first, and then discarding it. That is a download
    on a metered connection for a file that never needed one, and it makes
    `access.log.gz` fail outright whenever `/libarchive.wasm` is unreachable.
    So the gzip is opened far enough to see what is inside it: a tar (or any
    other format in the binary) goes to the engine as before, and anything
    else — a log, a CSV, a JSON dump — is the browser's job alone. The two
    fallbacks further down stay, for a gzip whose payload could not be read
    here at all.
  */
  if (container === "gzip") {
    const payload = await gzipPayloadPrefix(bytes);
    if (payload && !payloadLooksLikeArchive(payload)) return gzipListing(bytes, fileName);
  }

  const { archive, ArchiveReader } = await newEngine();

  let reader: InstanceType<typeof ArchiveReader>;
  try {
    reader = new ArchiveReader(archive, toInt8(bytes), passphrase);
  } catch {
    // The one advertised format libarchive cannot open on its own. The
    // browser can, so the page is not made to lie about accepting `.gz`.
    if (container === "gzip") return gzipListing(bytes, fileName);
    throw new Error(describeOpenFailure(container));
  }

  const entries: ArchiveEntry[] = [];
  let incompleteReason: string | null = null;
  try {
    let index = 0;
    for (const entry of reader.entries()) {
      const path = entry.getPathname();
      const { safePath, reason } = classifyEntryPath(path);
      const symlink = entry.getSymlinkTarget();
      const hardlink = entry.getHardlinkTarget();
      const mtime = entry.getModificationTime();
      entries.push({
        index,
        path,
        safePath,
        unsafeReason: reason,
        kind: FILETYPE[entry.getFiletype()] ?? "other",
        size: entry.getSize(),
        encrypted: entry.isEncrypted(),
        // libarchive reports 0 for "no time recorded"; showing 1 Jan 1970 as
        // a fact about someone's archive is worse than showing nothing.
        modifiedAt: mtime > 0 ? mtime : null,
        linkTarget: symlink || hardlink || null,
        nested: looksNested(path),
      });
      index++;
      if (options.signal?.aborted) break;
    }
  } catch (err) {
    // A fatal mid-walk: everything read so far is real, and the rest is not
    // coming. Keep the partial list and say why it stopped.
    incompleteReason = describeArchiveFailure(err);
  }

  // Fact 4: the walk can also end without throwing at all. The engine's own
  // error string is the only thing that distinguishes "that was the end" from
  // "the header after that one was garbage".
  if (!incompleteReason) {
    const engineError = archive.error_string(reader.archive);
    if (engineError) incompleteReason = describeArchiveFailure(new Error(engineError));
  }

  const engine = archive.version_string();
  try {
    reader.free();
  } catch {
    // `read_free` throws on a reader left mid-entry by a fatal error. The
    // instance is being dropped whole either way, so there is nothing to
    // recover and nothing to tell the user.
  }

  /*
    A bare gzip does not always TRAP. Measured: a 34-byte gzip was accepted by
    libarchive's MTREE reader — mtree is a plain-text format with a permissive
    sniff — and then produced zero entries and the error "Missing type keyword
    in mtree specification". So the gzip fallback cannot key on the throw
    alone; an empty walk over gzip bytes means the same thing.
  */
  if (container === "gzip" && entries.length === 0) return gzipListing(bytes, fileName);

  /*
    Zero entries AND an engine error is not an empty archive — it is a file
    that could not be read, and an empty table with a footnote reads as
    "this archive is empty". An archive that really is empty (an empty ZIP
    lists zero entries and reports NO error, measured) falls through and is
    shown as what it is.
  */
  if (entries.length === 0 && incompleteReason !== null) {
    throw new Error(incompleteReason);
  }

  return {
    entries,
    container,
    engine,
    incompleteReason,
    viaGzipStream: false,
    sizeSource: "archive",
  };
}

/**
 * The single-gzip-file listing: one entry, described from the header and the
 * trailer without decompressing a byte.
 */
function gzipListing(bytes: Uint8Array, fileName: string): ArchiveListing {
  const stored = gzipStoredName(bytes);
  const path = stored ?? gzipFallbackName(fileName);
  const { safePath, reason } = classifyEntryPath(path);
  return {
    entries: [
      {
        index: 0,
        path,
        safePath,
        unsafeReason: reason,
        kind: "file",
        size: gzipDeclaredSize(bytes),
        encrypted: false,
        modifiedAt: null,
        linkTarget: null,
        nested: looksNested(path),
      },
    ],
    container: "gzip",
    engine: "DecompressionStream",
    incompleteReason: null,
    viaGzipStream: true,
    sizeSource: "gzip-trailer",
  };
}

/**
 * Decompress a bare gzip file with the browser's own decoder.
 *
 * `DecompressionStream("gzip")` handles concatenated members (measured: two
 * members of the same file came back as both payloads, in order), which is
 * what `gzip -c a b > both.gz` produces.
 */
async function readGzipMember(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error(
      "This browser has no built-in gzip decoder, so a single gzip-compressed file cannot be opened here. A .tar.gz still works — the archive engine reads those.",
    );
  }
  /*
    `new Response(bytes).body` rather than `new Blob(bytes).stream()`: both
    are correct in a browser, but jsdom's `Blob` has no `stream()` at all, and
    a decompression path the unit suite cannot reach is a path nobody checks.
  */
  const source = new Response(bytes as BodyInit).body;
  if (!source) {
    throw new Error("This browser could not open the compressed data as a stream.");
  }
  try {
    const stream = source.pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    // The stream rejects with a bare TypeError carrying nothing readable.
    throw new Error(
      "The browser's gzip decoder refused this file partway through, which means the compressed data is damaged or the file is incomplete.",
    );
  }
}

/**
 * Give the event loop a REAL turn.
 *
 * `await Promise.resolve()` looks like a yield and is not one: it queues a
 * microtask, and the microtask queue is drained to exhaustion inside the same
 * task, so a loop built on it runs start to finish without the browser ever
 * getting to paint. Measured under this suite: a `setTimeout` scheduled from
 * inside the extract loop did not run until the whole loop had finished — the
 * frozen tab and the 0-to-100 progress bar the loop is supposed to avoid.
 *
 * `scheduler.yield()` is the right instrument and exists in current Chrome.
 * `MessageChannel` is the fallback React's own scheduler uses, because a
 * message is a macrotask that browsers do NOT clamp the way they clamp a
 * chain of `setTimeout(…, 0)` to 4 ms once it is five deep. `setTimeout` is
 * the last resort for anything with neither.
 */
function yieldToEventLoop(): Promise<void> {
  const host = globalThis as typeof globalThis & {
    scheduler?: { yield?: () => Promise<void> };
  };
  if (typeof host.scheduler?.yield === "function") return host.scheduler.yield();
  if (typeof MessageChannel === "function") {
    return new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        channel.port2.close();
        resolve();
      };
      channel.port2.postMessage(undefined);
    });
  }
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Pull the chosen members out.
 *
 * A SECOND walk over the same bytes, in a second engine instance. libarchive
 * is a streaming reader: it cannot seek back to an entry it has passed, so
 * listing and extracting cannot share one pass. The walk stops as soon as the
 * last wanted index is behind it, which is what keeps "one file out of a
 * 500-entry tar.xz" from decompressing the whole tail.
 *
 * Entry failures are collected, not thrown: one corrupt member in a hundred
 * should cost that member, not the run.
 */
export async function extractFromArchive(
  data: ArrayBuffer | Uint8Array,
  listing: ArchiveListing,
  indexes: readonly number[],
  options: ArchiveOptions & { onProgress?: (done: number, total: number) => void } = {},
): Promise<ExtractResult> {
  const wanted = new Set(indexes);
  /*
    `chosen` is the ONE zip-slip gate on this path, and `nameFor` is built
    from it — so the loop below asks `nameFor.has(index)` rather than
    re-deriving safety from the entry. That is deliberate: an earlier shape
    had the filter here AND a `if (!name) continue` in the loop, and the
    second check only worked because a refused entry's `safePath` is null and
    a null name is falsy. Two guards where one is load-bearing is a gate
    nobody can test, and a mutation that deleted the real one went green.
  */
  const chosen = listing.entries.filter((e) => wanted.has(e.index)).filter(isExtractable);
  const names = uniqueNames(chosen.map((e) => e.safePath));
  const nameFor = new Map(chosen.map((e, i) => [e.index, names[i]]));

  const files: ExtractedFile[] = [];
  const failures: ExtractFailure[] = [];
  const bytes = toUint8(data);
  const total = chosen.length;
  options.onProgress?.(0, total);

  if (listing.viaGzipStream) {
    const entry = chosen[0];
    if (!entry) return { files, failures, bytes: 0 };
    const out = await readGzipMember(bytes);
    options.onProgress?.(1, total);
    return {
      files: [
        {
          index: entry.index,
          name: nameFor.get(entry.index) as string,
          path: entry.path,
          blob: new Blob([out as BlobPart]),
          bytes: out.byteLength,
        },
      ],
      failures,
      bytes: out.byteLength,
    };
  }

  const passphrase = options.passphrase?.trim() ? options.passphrase : undefined;
  const { archive, ArchiveReader } = await newEngine();
  let reader: InstanceType<typeof ArchiveReader>;
  try {
    reader = new ArchiveReader(archive, toInt8(bytes), passphrase);
  } catch {
    throw new Error(describeOpenFailure(listing.container));
  }

  const lastWanted = chosen.length ? chosen[chosen.length - 1].index : -1;
  let produced = 0;
  try {
    let index = -1;
    for (const entry of reader.entries()) {
      index++;
      if (index > lastWanted) break;
      if (!wanted.has(index)) continue;
      if (!nameFor.has(index)) continue;
      const planned = listing.entries[index];
      const name = nameFor.get(index) as string;
      if (!planned) continue;

      const path = entry.getPathname();
      if (path !== planned.path) {
        /*
          The two walks are over identical bytes and must land on identical
          entries. If they ever did not, the download would carry the right
          NAME over the wrong CONTENT, which is the worst failure this page
          could have. Refuse that member rather than guess.
        */
        failures.push({
          index,
          path: planned.path,
          reason: `The engine reported a different entry at this position on the second pass (${path}), so this file was not written out.`,
        });
        continue;
      }

      try {
        const raw = entry.readData();
        const out = raw
          ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
          : new Uint8Array(0);
        if (planned.size > 0 && out.byteLength < planned.size) {
          /*
            The one integrity check available here. Nothing verifies a
            member's checksum — fact 7 at the top of this file, and the page
            says as much rather than implying otherwise — but a read that
            stops short of the size the archive itself declared is a fact,
            and writing that out under the full name would hand someone a
            silently truncated file. libarchive usually raises truncation
            itself ("Truncated ZIP file data", measured), so this is the
            case where it does not.
          */
          failures.push({
            index,
            path: planned.path,
            reason: `The engine returned ${out.byteLength} bytes for an entry the archive declares as ${planned.size}, so it was left out rather than written out short.`,
          });
        } else {
          files.push({
            index,
            name,
            path: planned.path,
            blob: new Blob([out as BlobPart]),
            bytes: out.byteLength,
          });
        }
      } catch (err) {
        failures.push({
          index,
          path: planned.path,
          reason: describeArchiveFailure(err),
        });
      }
      produced++;
      options.onProgress?.(produced, total);
      if (options.signal?.aborted) break;
      /*
        One turn of the event loop between members. `readData` is a
        synchronous wasm call, so a 40-member archive without this yields a
        frozen tab and a progress bar that jumps from 0 to 100 at the end.
        It has to be a MACROTASK to be worth anything — see
        `yieldToEventLoop`, which is where that was got wrong once already.
      */
      await yieldToEventLoop();
    }
  } finally {
    try {
      reader.free();
    } catch {
      // See readArchive: nothing to recover, the instance is dropped whole.
    }
  }

  return {
    files,
    failures,
    bytes: files.reduce((sum, f) => sum + f.bytes, 0),
  };
}

/** Name for the ZIP a multi-file selection downloads as. */
export function selectionZipName(fileName: string): string {
  const stem = fileName.replace(/\.(tar\.(gz|bz2|xz)|tgz|tbz2|txz|zip|tar|gz|bz2|xz|7z|rar)$/i, "");
  return `${stem || "archive"}-extracted.zip`;
}
