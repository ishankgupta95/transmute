/**
 * Reading the checksum a publisher printed, and deciding whether it matches.
 *
 * The digests themselves come from `lib/tools/hash-digest.ts` by way of the
 * hashing worker; nothing here computes a hash. What is here is the part that
 * actually goes wrong in practice: nobody has a bare hex string to hand. They
 * have a line copied off a release page, and that line is in one of four
 * shapes, half of them carrying the filename as well.
 *
 * DOM-free, so the unit tests are the real gate rather than a proxy for one.
 */

export type HashAlgorithm = "md5" | "sha1" | "sha256" | "sha512";

export const HASH_ALGORITHMS: readonly HashAlgorithm[] = ["md5", "sha1", "sha256", "sha512"];

/** Hex characters each digest is written in. All four are distinct, which is
 *  what lets a pasted string name its own algorithm without being told. */
export const HASH_HEX_LENGTH: Record<HashAlgorithm, number> = {
  md5: 32,
  sha1: 40,
  sha256: 64,
  sha512: 128,
};

export const HASH_LABEL: Record<HashAlgorithm, string> = {
  md5: "MD5",
  sha1: "SHA-1",
  sha256: "SHA-256",
  sha512: "SHA-512",
};

/** The conventional name of a coreutils sums file for each algorithm. */
export const SUMS_FILE_NAME: Record<HashAlgorithm, string> = {
  md5: "MD5SUMS",
  sha1: "SHA1SUMS",
  sha256: "SHA256SUMS",
  sha512: "SHA512SUMS",
};

export function algorithmForDigestLength(length: number): HashAlgorithm | null {
  return HASH_ALGORITHMS.find((algo) => HASH_HEX_LENGTH[algo] === length) ?? null;
}

export interface ChecksumEntry {
  /** Lower-cased hex. Comparison is case-insensitive because half the world
   *  publishes upper case and `sha256sum` prints lower. */
  digest: string;
  /** The name the line carried, or null for a bare digest. */
  fileName: string | null;
  algorithm: HashAlgorithm;
}

export type ExpectedChecksum =
  | { kind: "empty" }
  /** Something was pasted and no digest could be found in it. `hexRun` is the
   *  longest hex string that WAS there, so the UI can say "that is 63
   *  characters, which is not any digest length" instead of a shrug. */
  | { kind: "unreadable"; hexRun: string | null }
  | ({ kind: "parsed" } & ChecksumEntry);

/**
 * One line, in any of the shapes a release page actually uses:
 *
 *   `e3b0c442…`                                bare, as copied from a table cell
 *   `e3b0c442…  ubuntu.iso`                    GNU coreutils / shasum, text mode
 *   `e3b0c442… *ubuntu.iso`                    the same, binary mode
 *   `SHA256 (ubuntu.iso) = e3b0c442…`          BSD `sha256 -r`-less default
 *   `sha256:e3b0c442…`                         the OCI / Docker digest spelling
 *
 * Anything else falls through to a scan for the first hex run whose length is
 * one an algorithm here produces — which is deliberately strict: a 63-character
 * run is a truncated paste, and silently matching its first 40 characters
 * against SHA-1 would be the worst possible outcome for a verification tool.
 */
export function parseExpectedChecksum(input: string): ExpectedChecksum {
  const text = input.trim();
  if (text === "") return { kind: "empty" };

  const bsd = text.match(/^[A-Za-z][A-Za-z0-9-]*\s*\(([^)]*)\)\s*=\s*([0-9a-fA-F]+)$/);
  if (bsd) {
    const algorithm = algorithmForDigestLength(bsd[2].length);
    if (algorithm) {
      return { kind: "parsed", digest: bsd[2].toLowerCase(), fileName: bsd[1] || null, algorithm };
    }
  }

  const gnu = text.match(/^([0-9a-fA-F]+)[ \t]+\*?(\S[^\r\n]*)$/);
  if (gnu) {
    const algorithm = algorithmForDigestLength(gnu[1].length);
    if (algorithm) {
      return { kind: "parsed", digest: gnu[1].toLowerCase(), fileName: gnu[2].trim(), algorithm };
    }
  }

  let longest: string | null = null;
  for (const run of text.match(/[0-9a-fA-F]+/g) ?? []) {
    const algorithm = algorithmForDigestLength(run.length);
    if (algorithm) return { kind: "parsed", digest: run.toLowerCase(), fileName: null, algorithm };
    if (longest === null || run.length > longest.length) longest = run;
  }
  return { kind: "unreadable", hexRun: longest };
}

export interface ChecksumList {
  entries: ChecksumEntry[];
  /** Non-blank lines that yielded no digest, counted rather than swallowed. */
  unreadableLines: number;
}

/**
 * A whole `SHA256SUMS` file, or a single line, or one bare digest.
 *
 * The count of unreadable lines is returned rather than dropped: a sums file
 * pasted with its PGP armour still wrapped around it produces entries AND
 * junk, and a verifier that says nothing about the junk is inviting the reader
 * to assume every line was checked.
 */
export function parseChecksumList(input: string): ChecksumList {
  const entries: ChecksumEntry[] = [];
  let unreadableLines = 0;
  for (const line of input.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const parsed = parseExpectedChecksum(line);
    if (parsed.kind === "parsed") {
      const { digest, fileName, algorithm } = parsed;
      entries.push({ digest, fileName, algorithm });
    } else {
      unreadableLines++;
    }
  }
  return { entries, unreadableLines };
}

/** `./dists/ubuntu.iso` → `ubuntu.iso`. Sums files carry paths; a File does not. */
export function baseName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] ?? path;
}

/**
 * Which of the four digests this hex string equals, or null.
 *
 * Every algorithm is compared, not just the one the length implies. The lengths
 * cannot collide today, but comparing all four means the answer on screen is
 * something the code actually checked rather than something it inferred.
 */
export function compareChecksum(
  digest: string,
  hashes: Record<HashAlgorithm, string>,
): HashAlgorithm | null {
  const wanted = digest.trim().toLowerCase();
  if (wanted === "") return null;
  return HASH_ALGORITHMS.find((algo) => hashes[algo].toLowerCase() === wanted) ?? null;
}

export type ChecksumVerdict =
  /** Nothing was pasted, so nothing is being claimed about this file. */
  | { kind: "none" }
  | { kind: "match"; algorithm: HashAlgorithm; expected: ChecksumEntry }
  | { kind: "mismatch"; expected: ChecksumEntry }
  /** A list was pasted and no line in it names this file. */
  | { kind: "unlisted" };

/**
 * The verdict for one file.
 *
 * With a single pasted digest the filename is ignored — people verify a file
 * they have just renamed all the time. With a LIST, the filename is the only
 * thing that says which line applies, so a file no line names is reported as
 * unlisted rather than quietly compared against the first entry.
 */
export function verdictForFile(
  list: ChecksumList,
  fileName: string,
  hashes: Record<HashAlgorithm, string>,
): ChecksumVerdict {
  const { entries } = list;
  if (entries.length === 0) return { kind: "none" };

  if (entries.length === 1 && entries[0].fileName === null) {
    const expected = entries[0];
    const algorithm = compareChecksum(expected.digest, hashes);
    return algorithm ? { kind: "match", algorithm, expected } : { kind: "mismatch", expected };
  }

  const target = baseName(fileName);
  const lower = target.toLowerCase();
  const expected =
    entries.find((e) => e.fileName !== null && baseName(e.fileName) === target) ??
    entries.find((e) => e.fileName !== null && baseName(e.fileName).toLowerCase() === lower) ??
    // A single named line is still about the one file you dropped, whatever it
    // is now called: `sha256sum ubuntu.iso > sum.txt` then a rename is normal.
    (entries.length === 1 ? entries[0] : undefined);
  if (!expected) return { kind: "unlisted" };

  const algorithm = compareChecksum(expected.digest, hashes);
  return algorithm ? { kind: "match", algorithm, expected } : { kind: "mismatch", expected };
}

/**
 * A coreutils-format sums file: `<digest>  <name>`, two spaces, one line each.
 *
 * The backslash escaping is coreutils' own and is not decoration — `sha256sum`
 * prefixes a line with `\` and escapes `\`, newline and carriage return in the
 * name whenever the name contains any of them, precisely so the file stays one
 * record per line. A generator that skips it emits a file `sha256sum -c`
 * cannot read back.
 */
export function formatSumsFile(rows: readonly { name: string; digest: string }[]): string {
  return rows
    .map(({ name, digest }) => {
      if (/[\\\n\r]/.test(name)) {
        const escaped = name.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
        return `\\${digest}  ${escaped}`;
      }
      return `${digest}  ${name}`;
    })
    .join("\n")
    .concat("\n");
}
