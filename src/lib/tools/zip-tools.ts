/**
 * ZIP: building one, and reading one back.
 *
 * Two tools share this module — `create-zip` writes an archive from files the
 * user picked, `unzip-files` lists and extracts one. Both run on `jszip`,
 * which is already a dependency (the multi-file download path in
 * `src/lib/utils/download.ts` uses it), so neither tool adds a byte to the
 * bundle beyond its own chunk.
 *
 * ── Why there is a hand-written central-directory reader here ───────────────
 *
 * `JSZip.loadAsync` is ALL OR NOTHING, and that turned out to be the whole
 * design constraint. Measured against jszip 3.10.1:
 *
 *   • ONE encrypted entry throws for the WHOLE archive. `zipEntry.js:121`
 *     throws "Encrypted zip are not supported" while reading the central
 *     directory, before a single byte is extracted — so a mixed archive with
 *     nine readable files and one password-protected one yields nothing, and
 *     jszip cannot tell you which entry did it. Verified on a two-entry
 *     archive built with `zip -P`.
 *   • ONE entry in an unsupported compression method does the same, from
 *     `zipEntry.js:92` ("Corrupted zip : compression 0x… unknown"). bzip2,
 *     LZMA, zstd and WinZip AES entries all land there.
 *   • A `../` path is silently RESOLVED away rather than refused
 *     (`utils.resolve`), so `../../etc/passwd` arrives keyed as `etc/passwd`
 *     with the original tucked into `unsafeOriginalName`. An ABSOLUTE path
 *     (`/etc/passwd`) survives `resolve` completely unchanged, so comparing
 *     the two names does not catch it.
 *
 * A zip's central directory carries every fact needed to say all of that
 * BEFORE deciding to open anything: name, both sizes, method, the encryption
 * bit, the DOS timestamp, the host system and its mode bits. It is a fixed
 * 46-byte record per entry and reading it is cheap. So `readZipDirectory`
 * parses it directly, and jszip is used only to inflate the entries that were
 * already judged safe.
 *
 * ── What jszip round-trips, and what it does not ────────────────────────────
 *
 * MODIFIED DATES: yes, to two-second resolution — a ZIP stores an MS-DOS
 * timestamp, whose seconds field counts in twos. Measured: 14:35:23 written,
 * 14:35:22 read back.
 *
 * A DOS timestamp carries NO TIMEZONE: it is local wall-clock, and that is how
 * Finder, Explorer, 7-Zip and `unzip` all read one. jszip writes it from the
 * date's UTC fields (`generate/ZipFileWorker.js:146-156` uses `getUTCHours()`
 * and friends) and reads it back with `Date.UTC`, which is self-consistent and
 * WRONG everywhere else: measured in Asia/Kolkata, a file modified at 14:35:23
 * was stored as 09:05:22, five and a half hours early, and every desktop
 * archiver showed it that way. `dosWallClock` below shifts the instant handed
 * to jszip by the local UTC offset so the fields written are the wall clock the
 * user saw — which is why `create-zip` can say dates are kept to two seconds
 * and mean it. `readZipDirectory` still DECODES with `Date.UTC`, matching
 * jszip, so a date read out of an archive is wall-clock numbers wearing a UTC
 * label; nothing in either UI prints one.
 *
 * DATES BEFORE 1980 SILENTLY WRAP. The DOS date packs the year into seven bits
 * as an offset from 1980, and jszip masks rather than checks: measured,
 * 1970-01-01 comes back as 2098-01-01 and 2109-01-01 comes back as 1981-01-01.
 * `clampArchiveDate` below is why `create-zip` never ships that; the UI counts
 * the clamps and says so.
 *
 * POSIX PERMISSIONS: not on the way IN, because the browser's File object has
 * no mode bits to give — a `File` carries a name, a size, a MIME type and a
 * `lastModified`, and nothing else. On the way OUT they are readable: an
 * archive written by a Unix `zip` records mode 0644 in the external attributes
 * and `readZipDirectory` reports it, which is worth showing precisely because
 * a browser download cannot apply it.
 */

// Type-only: erased at compile time, so it does not pull jszip out of the
// dynamic import below and into the shared bundle.
import type { JSZipObject } from "jszip";

/* ── Errors ───────────────────────────────────────────────────────────────── */

export type ZipReadCode =
  | "empty-file"
  | "not-a-zip"
  | "ole2"
  | "no-eocd"
  | "multi-disk"
  | "bad-central-directory"
  | "too-large";

/** A refusal with a sentence already written for the user. */
export class ZipReadError extends Error {
  readonly code: ZipReadCode;
  constructor(code: ZipReadCode, message: string) {
    super(message);
    this.name = "ZipReadError";
    this.code = code;
  }
}

/* ── Container sniffing ───────────────────────────────────────────────────── */

/*
  `src/lib/tools/xlsx.ts` has a near-twin of this, and it is deliberately not
  imported: that module is a 700-line OOXML parser and a static import would
  drag the whole of it into both zip chunks to reuse eight lines.
*/
const ZIP_SIGNATURES = [
  [0x50, 0x4b, 0x03, 0x04], // local file header — an ordinary archive
  [0x50, 0x4b, 0x05, 0x06], // end of central directory — an EMPTY archive
  [0x50, 0x4b, 0x07, 0x08], // spanned/split archive marker
];
/** The OLE2 / Compound File header — an encrypted OOXML package, or a .doc. */
const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
/** RAR 4.x and RAR 5.x. Named because "Rar!" renamed to .zip is a real habit. */
const RAR_SIGNATURE = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07];
/** 7-Zip: "7z\xBC\xAF\x27\x1C". */
const SEVENZIP_SIGNATURE = [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c];
/** gzip, which is a single stream and not an archive of entries at all. */
const GZIP_SIGNATURE = [0x1f, 0x8b];

export type ZipContainer = "zip" | "ole2" | "rar" | "7z" | "gzip" | "empty" | "other";

const startsWith = (bytes: Uint8Array, sig: number[]): boolean =>
  bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b);

/**
 * What kind of container these bytes are, from the first eight of them.
 *
 * Worth the twenty lines because the wrong-file cases are common and jszip's
 * answer to every one of them is the same unhelpful "Can't find end of central
 * directory", which tells the user nothing they can act on.
 */
export function sniffZipContainer(bytes: Uint8Array): ZipContainer {
  if (bytes.length === 0) return "empty";
  if (ZIP_SIGNATURES.some((sig) => startsWith(bytes, sig))) return "zip";
  if (startsWith(bytes, OLE2_SIGNATURE)) return "ole2";
  if (startsWith(bytes, RAR_SIGNATURE)) return "rar";
  if (startsWith(bytes, SEVENZIP_SIGNATURE)) return "7z";
  if (startsWith(bytes, GZIP_SIGNATURE)) return "gzip";
  return "other";
}

/* ── Paths: the zip-slip check ────────────────────────────────────────────── */

export type UnsafePathReason = "absolute" | "traversal" | "drive" | "unc" | "control" | "empty";

export interface PathVerdict {
  /** `.` and empty segments dropped, backslashes normalised. */
  normalized: string;
  /** Non-null when this path must never be written to disk. */
  unsafe: UnsafePathReason | null;
}

/**
 * Judge one archive entry's path.
 *
 * The rule is REFUSE, not repair. jszip's own `utils.resolve` repairs — it
 * pops a `..` off the accumulated path and carries on, so `../../etc/passwd`
 * becomes `etc/passwd` and lands somewhere plausible-looking under whatever
 * the user meant to extract into. That is the zip-slip vulnerability with the
 * sharp edge filed off rather than the sharp edge removed: the archive still
 * asked to escape, and the user is never told it asked.
 *
 * Backslashes are folded to `/` first because plenty of Windows zip writers
 * emit them despite APPNOTE 4.4.17.1 requiring forward slashes — and a
 * `..\..\` that is not folded first would sail through a `/`-only check.
 */
export function classifyEntryPath(raw: string): PathVerdict {
  const folded = raw.replace(/\\/g, "/");

  // A NUL or other C0 control in a name is either a corrupt archive or an
  // attempt to make a display name and a written name disagree.
  if (/[\u0000-\u001f\u007f]/.test(folded)) return { normalized: folded, unsafe: "control" };

  if (/^[A-Za-z]:[/]/.test(folded)) return { normalized: folded, unsafe: "drive" };
  if (folded.startsWith("//")) return { normalized: folded, unsafe: "unc" };
  if (folded.startsWith("/")) return { normalized: folded, unsafe: "absolute" };

  const parts = folded.split("/");
  if (parts.includes("..")) return { normalized: folded, unsafe: "traversal" };

  const kept = parts.filter((p) => p !== "" && p !== ".");
  const normalized = kept.join("/") + (folded.endsWith("/") && kept.length > 0 ? "/" : "");
  if (kept.length === 0) return { normalized: folded, unsafe: "empty" };
  return { normalized, unsafe: null };
}

/** One line of English per refusal, for the warning the UI prints. */
export const UNSAFE_PATH_REASONS: Record<UnsafePathReason, string> = {
  absolute: "an absolute path, which asks to be written to a fixed place on the disk",
  traversal: "a .. path, which asks to be written outside the folder you are extracting into",
  drive: "a Windows drive path, which asks to be written to a fixed place on the disk",
  unc: "a UNC network path, which asks to be written to another machine",
  control: "a control character in its name, which makes the name shown and the name written disagree",
  empty: "no usable name at all",
};

/**
 * jszip's own `utils.resolve`, reimplemented, purely so an entry can be looked
 * up by the key jszip will file it under. Never used to decide what is safe —
 * `classifyEntryPath` does that, and refuses what this repairs.
 */
export function resolveZipPath(path: string): string {
  const parts = path.split("/");
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === "." || (part === "" && i !== 0 && i !== parts.length - 1)) continue;
    else if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

/* ── Compression methods ──────────────────────────────────────────────────── */

/** APPNOTE 4.4.5. Only 0 and 8 are anything jszip can inflate. */
export const COMPRESSION_METHODS: Record<number, string> = {
  0: "STORE",
  1: "SHRUNK",
  6: "IMPLODE",
  8: "DEFLATE",
  9: "DEFLATE64",
  12: "BZIP2",
  14: "LZMA",
  93: "ZSTD",
  95: "XZ",
  96: "JPEG",
  97: "WAVPACK",
  98: "PPMD",
  99: "AES",
};

export const methodName = (method: number): string =>
  COMPRESSION_METHODS[method] ?? `METHOD ${method}`;

/** jszip registers exactly two: STORE and DEFLATE (`lib/compressions.js`). */
export const isMethodSupported = (method: number): boolean => method === 0 || method === 8;

/* ── Reading the central directory ────────────────────────────────────────── */

export interface ZipEntry {
  /**
   * The path this entry will be listed and looked up under: the name the
   * archive stores decoded as UTF-8, or the name out of the Unicode Path extra
   * field (0x7075) when the archive carries one and its CRC checks out. That
   * is the name jszip files the entry under, and the two have to agree or the
   * entry cannot be fetched back.
   */
  path: string;
  /** The key jszip will file this entry under once loaded. */
  key: string;
  /** Non-null when the path must be refused rather than written. */
  unsafe: UnsafePathReason | null;
  dir: boolean;
  encrypted: boolean;
  /** Bit 6 — the Strong Encryption Feature, a different beast from bit 0. */
  strongEncryption: boolean;
  method: number;
  methodLabel: string;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  /**
   * The stored timestamp, read the way jszip reads it (`Date.UTC` over the DOS
   * fields), or null when the archive stores an impossible date.
   */
  date: Date | null;
  /** Unix mode bits when the archive was made on a Unix host, else null. */
  unixMode: number | null;
  /**
   * True when the name was stored WITHOUT the UTF-8 flag and is not plain
   * ASCII. APPNOTE says such a name is CP437; this reads UTF-8, as jszip does,
   * so the name on screen may be wrong even though the bytes are not. False
   * when a Unicode Path extra field supplied the name — then the archive told
   * us what it is and there is nothing to guess at.
   */
  nameEncodingUnknown: boolean;
  /** True when the name came from a verified Unicode Path field (0x7075). */
  unicodePathField: boolean;
  /** True when this entry's data runs past the end of the file. */
  truncated: boolean;
  /**
   * True when a LATER entry claims the same key. A ZIP addresses an entry by
   * name and the reader keeps only the last of each, so this one cannot be
   * fetched back at all — asking for it hands over the later entry's bytes.
   */
  shadowed: boolean;
  /** True when a ZIP64 extra field supplied one of this entry's numbers. */
  zip64: boolean;
  /** Nothing blocks this one: readable method, not encrypted, path is sane. */
  extractable: boolean;
}

export interface ZipDirectory {
  entries: ZipEntry[];
  /**
   * How many entries the archive's own index CLAIMS to hold. Different from
   * `entries.length` when the count and the records disagree — a damaged index,
   * or more than 65535 entries written without a ZIP64 record, where the
   * 16-bit field cannot count them. The UI says so rather than short-listing
   * in silence.
   */
  declaredEntries: number;
  archiveBytes: number;
  fileCount: number;
  dirCount: number;
  encryptedCount: number;
  unsafeCount: number;
  unsupportedCount: number;
  truncatedCount: number;
  /** Paths that appear more than once. jszip keeps only the last of each. */
  duplicates: string[];
  totalCompressed: number;
  totalUncompressed: number;
  comment: string;
  zip64: boolean;
  /**
   * Whether jszip can open this archive AT ALL. False when any entry is
   * encrypted or uses a method jszip has no decompressor for — both throw
   * while jszip walks the directory, so they take every other entry with them.
   */
  loadable: boolean;
}

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/** ZIP64 sentinel: a 32-bit field set to all ones means "read the extra field". */
const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;

const utf8 = new TextDecoder("utf-8");

/*
  CRC-32, the ordinary reflected one, needed to VERIFY a Unicode Path extra
  field rather than trust it. `pdf-extract-images.ts` has the same eight lines
  for PNG chunks and they are deliberately not shared: that module is a PDF
  image extractor and importing it here would drag all of it into both zip
  chunks to reuse a lookup table.
*/
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A u64 the rest of this file can do arithmetic on, or a refusal. */
function readU64(view: DataView, offset: number): number {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ZipReadError(
      "too-large",
      "This archive declares a size no browser can address. It is either corrupt or far beyond what a tab can hold.",
    );
  }
  return Number(value);
}

/**
 * The DOS timestamp, read exactly the way jszip reads it so the two never
 * disagree on screen. Returns null for a date the fields cannot express —
 * month 0 and day 0 both occur in the wild, written by tools that store no
 * date at all.
 */
export function dosDateToDate(time: number, date: number): Date | null {
  const day = date & 0x1f;
  const month = (date >> 5) & 0x0f;
  const year = ((date >> 9) & 0x7f) + 1980;
  if (day === 0 || month === 0 || month > 12) return null;
  const seconds = (time & 0x1f) * 2;
  const minutes = (time >> 5) & 0x3f;
  const hours = (time >> 11) & 0x1f;
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
}

/**
 * The name out of a Unicode Path extra field (0x7075), or null.
 *
 * APPNOTE's conditions, which are jszip's conditions (`zipEntry.js` →
 * `findExtraFieldUnicodePath`): the version byte must be 1, and the field's
 * CRC-32 of the header name must match the header name it is paired with — a
 * field left behind by a rename is out of date, and the header name is then
 * the truthful one. Only then are the remaining bytes the name.
 *
 * Agreeing with jszip exactly is the whole point: a name this reader and jszip
 * disagree about is a row the user can tick and cannot extract.
 */
function readUnicodePath(field: Uint8Array | null, headerName: Uint8Array): string | null {
  if (!field || field.length < 5) return null;
  if (field[0] !== 1) return null;
  const declared = new DataView(field.buffer, field.byteOffset, field.byteLength).getUint32(1, true);
  if (declared !== crc32(headerName)) return null;
  return utf8.decode(field.subarray(5));
}

/**
 * Find the End Of Central Directory record, scanning back over its comment.
 *
 * The four signature bytes alone are not enough: an archive comment is
 * arbitrary binary, so a comment carrying `50 4B 05 06` puts a second, fake
 * candidate at a HIGHER offset than the real record — and the fake reads as a
 * valid EMPTY archive, which is how a populated file came to be listed as
 * holding nothing at all.
 *
 * The discriminator is the record's own comment length, which must account for
 * every byte after it (`commentLength === length - i - 22`). That check makes
 * the answer the LOWEST consistent candidate rather than the highest, and the
 * reason is a proof rather than a preference: if the record at `i` is
 * consistent then everything after `i + 22` is its comment, so any candidate
 * further on is comment bytes by definition.
 *
 * When nothing is consistent — a file with bytes appended after the EOCD, which
 * real tools do produce — this falls back to the old answer, the last signature
 * in the file, rather than refusing an archive it used to read.
 */
function findEocd(view: DataView, length: number): number {
  const earliest = Math.max(0, length - 22 - U16_MAX);
  let consistent = -1;
  let lastSignature = -1;
  for (let i = length - 22; i >= earliest; i--) {
    if (view.getUint32(i, true) !== SIG_EOCD) continue;
    if (lastSignature < 0) lastSignature = i;
    if (view.getUint16(i + 20, true) === length - i - 22) consistent = i;
  }
  return consistent >= 0 ? consistent : lastSignature;
}

/**
 * Read an archive's central directory: every entry, every flag, no inflation.
 *
 * Pure and DOM-free on purpose — every trap in the header comment is a unit
 * test in `src/__tests__/unit/lib/zip-tools.test.ts`.
 */
export function readZipDirectory(bytes: Uint8Array): ZipDirectory {
  const container = sniffZipContainer(bytes);
  if (container === "empty") {
    throw new ZipReadError("empty-file", "This file is empty — there are no bytes in it to read.");
  }
  if (container === "ole2") {
    throw new ZipReadError(
      "ole2",
      "This is an OLE2 compound file, not a ZIP. An old .doc or .xls looks like this, and so does a password-protected Office document, where the whole package is encrypted and wrapped.",
    );
  }
  if (container === "rar" || container === "7z") {
    throw new ZipReadError(
      "not-a-zip",
      `This is ${container === "rar" ? "a RAR" : "a 7-Zip"} archive, not a ZIP — the extension says otherwise but the bytes do not. Nothing on this page can open it.`,
    );
  }
  if (container === "gzip") {
    throw new ZipReadError(
      "not-a-zip",
      "This is a gzip stream, not a ZIP. gzip compresses one file and holds no directory of entries, so there is nothing here to list.",
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view, bytes.byteLength);
  if (eocd < 0) {
    throw new ZipReadError(
      "no-eocd",
      container === "zip"
        ? "This file starts like a ZIP but its index is missing, which is what a half-finished download looks like. Fetch or export it again."
        : "This file is not a ZIP — it carries neither the ZIP signature at the front nor a central directory at the end.",
    );
  }

  let totalEntries = view.getUint16(eocd + 10, true);
  let cdSize = view.getUint32(eocd + 12, true);
  let cdOffset = view.getUint32(eocd + 16, true);
  const commentLength = view.getUint16(eocd + 20, true);
  const comment = utf8.decode(bytes.subarray(eocd + 22, eocd + 22 + commentLength));
  const diskNumber = view.getUint16(eocd + 4, true);
  const cdStartDisk = view.getUint16(eocd + 6, true);
  let zip64 = false;

  /*
    ZIP64. The locator sits immediately before the EOCD, and the record it
    points at repeats every number in 64 bits. Any of the 32-bit fields being
    all-ones is the signal that the small record is a placeholder.
  */
  if (eocd >= 20 && view.getUint32(eocd - 20, true) === SIG_EOCD64_LOCATOR) {
    const recordOffset = readU64(view, eocd - 20 + 8);
    if (recordOffset >= 0 && recordOffset + 56 <= bytes.byteLength) {
      if (view.getUint32(recordOffset, true) === SIG_EOCD64) {
        zip64 = true;
        totalEntries = readU64(view, recordOffset + 32);
        cdSize = readU64(view, recordOffset + 40);
        cdOffset = readU64(view, recordOffset + 48);
      }
    }
  }

  if ((diskNumber !== 0 && diskNumber !== U16_MAX) || (cdStartDisk !== 0 && cdStartDisk !== U16_MAX)) {
    throw new ZipReadError(
      "multi-disk",
      "This is one volume of a split archive (a .z01/.zip set). Every volume has to be present and joined before anything can be read out of it, and that has to happen before the file reaches this page.",
    );
  }

  /*
    Self-extracting archives and APKs carry a prefix, so every offset in the
    directory is short by exactly the prefix length. The directory's real
    position can be recovered from the EOCD, and the difference then corrects
    the local-header offsets too.
  */
  let base = cdOffset;
  let prefix = 0;
  if (base + 4 > bytes.byteLength || view.getUint32(base, true) !== SIG_CENTRAL) {
    const corrected = eocd - cdSize;
    if (corrected >= 0 && corrected + 4 <= bytes.byteLength && view.getUint32(corrected, true) === SIG_CENTRAL) {
      prefix = corrected - cdOffset;
      base = corrected;
    } else if (totalEntries !== 0) {
      throw new ZipReadError(
        "bad-central-directory",
        "This archive's index does not point at anything that looks like an index. The file is damaged, or something has been appended to it since it was written.",
      );
    }
  }

  const entries: ZipEntry[] = [];
  const seen = new Map<string, number>();
  const declaredEntries = totalEntries;
  let cursor = base;

  /*
    Every central header that is REALLY there, rather than exactly as many as
    the EOCD claims. The two disagree in both directions — a damaged index
    counts more than it holds, and an archive of more than 65535 entries
    written without a ZIP64 record cannot count them at all in sixteen bits —
    and `declaredEntries` is carried out of here so the UI can say which
    happened rather than short-listing in silence. The signature guard is what
    stops the scan: the central directory is followed by the EOCD (or a ZIP64
    record), and neither of those begins 50 4B 01 02.
  */
  while (cursor + 46 <= bytes.byteLength && view.getUint32(cursor, true) === SIG_CENTRAL) {
    const versionMadeBy = view.getUint16(cursor + 4, true);
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const modTime = view.getUint16(cursor + 12, true);
    const modDate = view.getUint16(cursor + 14, true);
    const entryCrc = view.getUint32(cursor + 16, true);
    let compressedSize = view.getUint32(cursor + 20, true);
    let uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const entryCommentLength = view.getUint16(cursor + 32, true);
    const externalAttributes = view.getUint32(cursor + 38, true);
    let localOffset = view.getUint32(cursor + 42, true);

    const nameStart = cursor + 46;
    const nameBytes = bytes.subarray(nameStart, nameStart + nameLength);

    /*
      The extra fields, in one pass. Two of them matter here:

      0x0001, ZIP64 — the 64-bit values, present only for the fields whose
      32-bit slot was the all-ones sentinel, in a fixed order.

      0x7075, Unicode Path — the real UTF-8 name. WinRAR and WinZip write the
      header name in a code page, leave the UTF-8 flag clear, and put the true
      name here. jszip files such an entry under the name from this field, so
      ignoring it lists the entry under one name and makes it fetchable only
      under another, which is the shape of a row that is ticked, counted, and
      then does not come out. Kept as a slice and applied below, because
      verifying it needs the LOCAL header's name bytes and the local header's
      position can itself come out of the ZIP64 field.
    */
    let entryZip64 = false;
    let unicodeField: Uint8Array | null = null;
    let extraCursor = nameStart + nameLength;
    const extraEnd = Math.min(extraCursor + extraLength, bytes.byteLength);
    while (extraCursor + 4 <= extraEnd) {
      const id = view.getUint16(extraCursor, true);
      const size = view.getUint16(extraCursor + 2, true);
      const limit = Math.min(extraCursor + 4 + size, extraEnd);
      if (id === 0x0001) {
        entryZip64 = true;
        let p = extraCursor + 4;
        if (uncompressedSize === U32_MAX && p + 8 <= limit) {
          uncompressedSize = readU64(view, p);
          p += 8;
        }
        if (compressedSize === U32_MAX && p + 8 <= limit) {
          compressedSize = readU64(view, p);
          p += 8;
        }
        if (localOffset === U32_MAX && p + 8 <= limit) {
          localOffset = readU64(view, p);
        }
      } else if (id === 0x7075) {
        unicodeField = bytes.subarray(extraCursor + 4, limit);
      }
      extraCursor += 4 + size;
    }

    /*
      Where this entry's data starts, and whether it is there at all. The local
      header's extra field may be a different length from the central one —
      that is legal and common — so the data start has to be read from the
      local header rather than computed from this record. The local name bytes
      come back with it: jszip checks the Unicode Path field's CRC against
      THOSE, because `readLocalPart` overwrites the name it read from the
      central record, and the whole point of reading the field is to file the
      entry under the name jszip will file it under.
    */
    const localAt = localOffset + prefix;
    const localOk =
      localAt >= 0 && localAt + 30 <= bytes.byteLength && view.getUint32(localAt, true) === SIG_LOCAL;
    let dataEnd = -1;
    let localNameBytes: Uint8Array | null = null;
    if (localOk) {
      const localNameLength = view.getUint16(localAt + 26, true);
      const localExtraLength = view.getUint16(localAt + 28, true);
      localNameBytes = bytes.subarray(localAt + 30, localAt + 30 + localNameLength);
      dataEnd = localAt + 30 + localNameLength + localExtraLength + compressedSize;
    }

    const unicodeName = readUnicodePath(unicodeField, localNameBytes ?? nameBytes);
    const path = unicodeName ?? utf8.decode(nameBytes);

    const verdict = classifyEntryPath(path);
    const encrypted = (flags & 0x0001) === 0x0001;
    const strongEncryption = (flags & 0x0040) === 0x0040;
    const utf8Flag = (flags & 0x0800) === 0x0800;
    const asciiOnly = !/[^\u0020-\u007e]/.test(path);
    const hostSystem = versionMadeBy >> 8;
    const unixMode = hostSystem === 3 ? (externalAttributes >>> 16) & 0xffff : null;
    const dosDirBit = (externalAttributes & 0x0010) !== 0;
    const dir = dosDirBit || path.endsWith("/");
    const truncated = !dir && (!localOk || dataEnd > bytes.byteLength);

    seen.set(path, (seen.get(path) ?? 0) + 1);

    entries.push({
      path,
      key: resolveZipPath(path),
      unsafe: verdict.unsafe,
      dir,
      encrypted,
      strongEncryption,
      method,
      methodLabel: methodName(method),
      compressedSize,
      uncompressedSize,
      crc32: entryCrc,
      date: dosDateToDate(modTime, modDate),
      unixMode,
      nameEncodingUnknown: !utf8Flag && !asciiOnly && unicodeName === null,
      unicodePathField: unicodeName !== null,
      truncated,
      shadowed: false,
      zip64: entryZip64,
      extractable:
        !dir && !encrypted && !strongEncryption && verdict.unsafe === null && isMethodSupported(method) && !truncated,
    });

    cursor = nameStart + nameLength + extraLength + entryCommentLength;
    if (entryZip64) zip64 = true;
  }

  /*
    Which of these can actually be fetched back. jszip keys its file table by
    the RESOLVED name, so when two entries share a key it keeps the LAST and
    the earlier ones are unreachable: asking for one by name hands over the
    later entry's bytes under the earlier one's name, which is silent loss with
    a size still printed beside it. They are marked here instead, so the row
    carries a reason and is neither ticked nor counted.
  */
  const lastByKey = new Map<string, number>();
  entries.forEach((entry, i) => {
    if (!entry.dir) lastByKey.set(entry.key, i);
  });
  for (const [i, entry] of entries.entries()) {
    if (!entry.dir && lastByKey.get(entry.key) !== i) {
      entry.shadowed = true;
      entry.extractable = false;
    }
  }

  const files = entries.filter((e) => !e.dir);
  const encryptedCount = entries.filter((e) => e.encrypted || e.strongEncryption).length;
  const unsupportedCount = entries.filter(
    (e) => !e.dir && !e.encrypted && !isMethodSupported(e.method),
  ).length;

  const truncatedCount = entries.filter((e) => e.truncated).length;

  return {
    entries,
    declaredEntries,
    archiveBytes: bytes.byteLength,
    fileCount: files.length,
    dirCount: entries.length - files.length,
    encryptedCount,
    unsafeCount: entries.filter((e) => e.unsafe !== null).length,
    unsupportedCount,
    truncatedCount,
    duplicates: [...seen.entries()].filter(([, n]) => n > 1).map(([name]) => name),
    totalCompressed: files.reduce((n, e) => n + e.compressedSize, 0),
    totalUncompressed: files.reduce((n, e) => n + e.uncompressedSize, 0),
    comment,
    zip64,
    /*
      All three of these throw inside jszip's own walk, so any one of them
      takes every other entry down with it. Encryption and an unknown method
      throw out of `zipEntry.js` while the directory is read; a truncated entry
      throws out of `zipEntries.js` → `readLocalFiles`, which reads
      `compressedSize` bytes for EVERY entry at load time whatever the caller
      asked for, and gets "End of data reached" instead. Measured on jszip
      3.10.1 — a three-entry archive with one overstated size extracted
      nothing at all.
    */
    loadable: encryptedCount === 0 && unsupportedCount === 0 && truncatedCount === 0,
  };
}

/* ── Extracting ───────────────────────────────────────────────────────────── */

export interface ExtractedFile {
  /** The archive path, as stored. */
  path: string;
  /** The last segment, which is what a browser download can actually name. */
  baseName: string;
  data: Uint8Array;
}

export interface ExtractResult {
  files: ExtractedFile[];
  /** One line per entry that was asked for and did not come out. */
  failures: { path: string; reason: string }[];
}

/** `a/b/c.txt` → `c.txt`. Falls back to the whole path if it ends in a slash. */
export function baseName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

/**
 * Inflate the named entries. `paths` are archive paths as `readZipDirectory`
 * reported them — the caller is expected to have filtered to `extractable`
 * ones already, and anything else is reported as a failure rather than
 * silently dropped.
 */
export async function extractZipEntries(
  bytes: Uint8Array,
  paths: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<ExtractResult> {
  // Same specifier form the multi-file download path uses, and for the same
  // reason: it keeps jszip in this tool's own chunk rather than the shared
  // bundle every page loads.
  const JSZip = (await import("jszip")).default;

  const zip = await JSZip.loadAsync(bytes).catch((err: unknown): never => {
    const message = err instanceof Error ? err.message : "";
    if (/[Ee]ncrypted/.test(message)) {
      throw new ZipReadError(
        "not-a-zip",
        "This archive has at least one password-protected entry, and the reader refuses the whole archive when it meets one. The entry list above names which.",
      );
    }
    throw new ZipReadError(
      "bad-central-directory",
      `This archive could not be opened: ${message || "the reader gave no reason"}.`,
    );
  });

  /*
    jszip files an entry under the RESOLVED name and stashes the stored name in
    `unsafeOriginalName`, so a lookup keyed on what the archive actually says
    has to try the stored name first. Directory placeholders carry no
    `unsafeOriginalName`, which is fine — nothing here asks for one.
  */
  const byStoredName = new Map<string, JSZipObject>();
  zip.forEach((relativePath, entry) => {
    if (entry.dir) return;
    byStoredName.set(entry.unsafeOriginalName ?? relativePath, entry);
  });

  const files: ExtractedFile[] = [];
  const failures: { path: string; reason: string }[] = [];
  let done = 0;

  for (const path of paths) {
    const entry = byStoredName.get(path) ?? zip.file(resolveZipPath(path));
    if (!entry) {
      failures.push({ path, reason: "the reader has no entry under this name" });
    } else {
      try {
        files.push({ path, baseName: baseName(path), data: await entry.async("uint8array") });
      } catch (err) {
        failures.push({
          path,
          reason: err instanceof Error ? err.message.toLowerCase() : "the data could not be inflated",
        });
      }
    }
    done++;
    onProgress?.(done, paths.length);
  }

  return { files, failures };
}

/* ── Building an archive ──────────────────────────────────────────────────── */

export interface ZipLevel {
  id: "store" | "fast" | "normal" | "max";
  label: string;
  /** DEFLATE level 1–9, or null for STORE. */
  level: number | null;
  note: string;
}

export const ZIP_LEVELS: readonly ZipLevel[] = [
  {
    id: "store",
    label: "Store",
    level: null,
    note: "No compression at all — the files are copied into the container as they are. Several times faster than any DEFLATE level, and the honest choice for photos, video and audio, which are already compressed and only get marginally larger inside a deflated archive.",
  },
  {
    id: "fast",
    label: "Fast",
    level: 1,
    note: "DEFLATE at level 1. Measured over 5.8 MB of source code it ran in about half the time Normal took and came out about a quarter larger — worth it when you are packing hundreds of megabytes and want the tab back.",
  },
  {
    id: "normal",
    label: "Normal",
    level: 6,
    note: "DEFLATE at level 6, which is what the zip command and every desktop archiver use by default. Measured over 5.8 MB of source code it got the data down to 26% of its original size.",
  },
  {
    id: "max",
    label: "Maximum",
    level: 9,
    note: "DEFLATE at level 9. Measured over 5.8 MB of source code it beat level 6 by six tenths of one percent while taking about two and a half times as long, and on anything already compressed it buys nothing at all.",
  },
];

export const zipLevel = (id: ZipLevel["id"]): ZipLevel =>
  ZIP_LEVELS.find((l) => l.id === id) ?? ZIP_LEVELS[2];

/**
 * The window an MS-DOS timestamp can express: the year is seven bits counted
 * from 1980, so 1980-01-01 through 2107-12-31 and nothing else.
 *
 * jszip masks the year rather than checking it, which wraps SILENTLY —
 * measured, 1970-01-01 is written and read back as 2098-01-01. Anything
 * outside this window is clamped and counted instead.
 */
export const DOS_TIME_MIN = Date.UTC(1980, 0, 1, 0, 0, 0);
export const DOS_TIME_MAX = Date.UTC(2107, 11, 31, 23, 59, 58);

export interface ClampedDate {
  date: Date;
  /** True when the input fell outside what a ZIP timestamp can hold. */
  clamped: boolean;
  /**
   * Which end it was clamped to, or null. The two are 128 years apart, so a
   * warning that names one of them has to know which happened.
   */
  direction: "low" | "high" | null;
}

export function clampArchiveDate(ms: number | undefined): ClampedDate {
  if (ms === undefined || !Number.isFinite(ms)) {
    return { date: new Date(DOS_TIME_MIN), clamped: true, direction: "low" };
  }
  if (ms < DOS_TIME_MIN) return { date: new Date(DOS_TIME_MIN), clamped: true, direction: "low" };
  if (ms > DOS_TIME_MAX) return { date: new Date(DOS_TIME_MAX), clamped: true, direction: "high" };
  return { date: new Date(ms), clamped: false, direction: null };
}

/**
 * The instant to hand jszip so the timestamp it writes reads correctly
 * everywhere else.
 *
 * A DOS timestamp has no timezone in it: it is local wall clock, and Finder,
 * Explorer, 7-Zip and `unzip` all read one that way. jszip builds the fields
 * from `getUTCHours()` and friends, so handing it the true instant stores UTC
 * and every desktop archiver then shows the file shifted by the writer's UTC
 * offset — measured in Asia/Kolkata, 14:35:23 was stored and displayed as
 * 09:05:22. Shifting the instant by the local offset first makes the stored
 * fields the wall clock the user saw, which is what every other ZIP writer
 * does.
 *
 * The offset is taken AT that date, so a summer file keeps summer time. It is
 * injectable only so a test can pin a zone.
 */
export function dosWallClock(ms: number, offsetMinutes?: number): number {
  const offset = offsetMinutes ?? new Date(ms).getTimezoneOffset();
  return ms - offset * 60_000;
}

/**
 * Make every name in the set distinct, keeping the first occurrence as-is.
 *
 * Required, not cosmetic: `zip.file()` with a name already in the archive
 * REPLACES it, so two files called `report.pdf` picked out of two different
 * folders produce a one-entry archive with no warning at all. Verified on
 * jszip 3.10.1.
 *
 * Case is folded for the comparison because the filesystems this archive will
 * be opened on mostly do not distinguish `Report.pdf` from `report.pdf`, and
 * an archive that unpacks to fewer files than it lists is the same silent loss
 * one step further downstream.
 */
export function uniqueEntryNames(names: string[]): string[] {
  const taken = new Set<string>();
  return names.map((name) => {
    if (!taken.has(name.toLowerCase())) {
      taken.add(name.toLowerCase());
      return name;
    }
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    for (let n = 2; ; n++) {
      const candidate = `${stem} (${n})${ext}`;
      if (!taken.has(candidate.toLowerCase())) {
        taken.add(candidate.toLowerCase());
        return candidate;
      }
    }
  });
}

/** Strip anything a browser filename should never have carried in. */
export function safeEntryName(name: string): string {
  const cleaned = baseName(name.replace(/\\/g, "/"))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  return cleaned === "" || cleaned === "." || cleaned === ".." ? "unnamed" : cleaned;
}

/** `archive` → `archive.zip`; an empty or dotted name falls back. */
export function zipArchiveName(raw: string): string {
  const cleaned = safeEntryName(raw).replace(/\.zip$/i, "");
  return `${cleaned === "unnamed" ? "archive" : cleaned}.zip`;
}

export interface CreateZipInput {
  name: string;
  data: Uint8Array;
  /** `File.lastModified`. Undefined stamps the DOS epoch and counts a clamp. */
  lastModified?: number;
}

export interface CreateZipEntry {
  name: string;
  uncompressedSize: number;
  /** Read back OUT of the finished archive — not estimated, not predicted. */
  compressedSize: number;
  methodLabel: string;
  dateClamped: boolean;
}

export interface CreateZipResult {
  bytes: Uint8Array;
  entries: CreateZipEntry[];
  uncompressedTotal: number;
  /** The sum of the entry payloads inside the archive. */
  compressedTotal: number;
  /** The whole file, payloads plus headers and the directory. */
  archiveBytes: number;
  /** `archiveBytes - compressedTotal`: what the container itself costs. */
  overheadBytes: number;
  renamed: { from: string; to: string }[];
  /** `clampedLow + clampedHigh`, for anything that only needs the total. */
  clampedDates: number;
  /** Dates before 1980, written as 1 January 1980. */
  clampedLow: number;
  /** Dates after 2107, written as 31 December 2107. */
  clampedHigh: number;
}

export interface CreateZipOptions {
  level: ZipLevel["id"];
  /** False stamps every entry with one time instead of its own. */
  keepDates: boolean;
  /** Used only when `keepDates` is false. Defaults to now. */
  stampAt?: number;
  /**
   * `Date.prototype.getTimezoneOffset()`'s answer, overridable so a test can
   * pin a zone. Defaults to this machine's offset at each file's own date.
   */
  utcOffsetMinutes?: number;
  onProgress?: (percent: number) => void;
}

/**
 * Build an archive and then MEASURE it.
 *
 * The per-entry compressed sizes come from parsing the finished bytes with
 * `readZipDirectory`, not from anything predicted before the run. That is the
 * difference between "ZIP usually saves about 60% on text" and this page
 * printing the number that actually happened to these files.
 */
export async function createZip(
  inputs: CreateZipInput[],
  options: CreateZipOptions,
): Promise<CreateZipResult> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  const requested = inputs.map((f) => safeEntryName(f.name));
  const names = uniqueEntryNames(requested);
  const renamed = requested
    .map((from, i) => ({ from, to: names[i] }))
    .filter((r) => r.from !== r.to);

  const level = zipLevel(options.level);
  const compression = level.level === null ? "STORE" : "DEFLATE";
  const compressionOptions = level.level === null ? undefined : { level: level.level };
  const stampAt = options.stampAt ?? Date.now();

  /*
    Counted by DIRECTION, not just totalled. A date clamped UP to 1980 and one
    clamped DOWN to 2107 are different things to tell someone about — the first
    is the ordinary case (a file with no usable mtime, or one predating the
    format), the second means a timestamp far in the future that something else
    got wrong. `clampArchiveDate` already reports which way it moved, so the
    two are free to separate here and the UI can say which happened.

    The shift to wall clock happens BEFORE the clamp, and the order is
    load-bearing in both directions: the DOS window is a window of wall-clock
    dates, so a file stamped midnight on 1 January 1980 local is inside it,
    and clamping the raw instant first would report that file — anywhere east
    of Greenwich — as carrying "a modified date a ZIP cannot store".
  */
  let clampedLow = 0;
  let clampedHigh = 0;
  const clampedByName = new Map<string, boolean>();
  inputs.forEach((input, i) => {
    const source = options.keepDates ? input.lastModified : stampAt;
    const wallClock =
      source === undefined || !Number.isFinite(source)
        ? source
        : dosWallClock(source, options.utcOffsetMinutes);
    const stamp = clampArchiveDate(wallClock);
    if (stamp.direction === "low") clampedLow++;
    else if (stamp.direction === "high") clampedHigh++;
    clampedByName.set(names[i], stamp.clamped);
    zip.file(names[i], input.data, {
      date: stamp.date,
      compression,
      compressionOptions,
    });
  });

  const bytes = await zip.generateAsync(
    { type: "uint8array", compression, compressionOptions },
    (meta) => options.onProgress?.(Math.round(meta.percent)),
  );

  /*
    Read the archive we just wrote. jszip does expose a private
    `_data.compressedSize` on a LOADED entry, but nothing on one it has only
    been handed, and the container overhead — 30 bytes of local header plus 46
    of directory record plus two copies of the name per entry — is invisible
    from the inside either way. Parsing the real bytes answers both.
  */
  const directory = readZipDirectory(bytes);
  const measured = new Map(directory.entries.filter((e) => !e.dir).map((e) => [e.path, e]));

  const entries: CreateZipEntry[] = names.map((name, i) => {
    const found = measured.get(name);
    return {
      name,
      uncompressedSize: found?.uncompressedSize ?? inputs[i].data.byteLength,
      compressedSize: found?.compressedSize ?? inputs[i].data.byteLength,
      methodLabel: found?.methodLabel ?? (level.level === null ? "STORE" : "DEFLATE"),
      dateClamped: clampedByName.get(name) ?? false,
    };
  });

  const uncompressedTotal = entries.reduce((n, e) => n + e.uncompressedSize, 0);
  const compressedTotal = entries.reduce((n, e) => n + e.compressedSize, 0);

  return {
    bytes,
    entries,
    uncompressedTotal,
    compressedTotal,
    archiveBytes: bytes.byteLength,
    overheadBytes: bytes.byteLength - compressedTotal,
    renamed,
    clampedDates: clampedLow + clampedHigh,
    clampedLow,
    clampedHigh,
  };
}
