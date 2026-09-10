import { describe, expect, it } from "vitest";
import {
  algorithmForDigestLength,
  baseName,
  compareChecksum,
  formatSumsFile,
  parseChecksumList,
  parseExpectedChecksum,
  verdictForFile,
  type HashAlgorithm,
} from "@/lib/tools/checksum-compare";

/*
  Every fixture here is a real spelling: the GNU coreutils line with two
  spaces, the shasum binary-mode line with the asterisk, the BSD parenthesised
  form, the OCI `sha256:` prefix, and the truncated paste that must be REFUSED
  rather than partially matched.
*/

const MD5 = "d41d8cd98f00b204e9800998ecf8427e";
const SHA1 = "da39a3ee5e6b4b0d3255bfef95601890afd80709";
const SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const SHA512 =
  "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e";

const hashes: Record<HashAlgorithm, string> = {
  md5: MD5,
  sha1: SHA1,
  sha256: SHA256,
  sha512: SHA512,
};

describe("algorithmForDigestLength", () => {
  it("names the one algorithm each length belongs to", () => {
    expect(algorithmForDigestLength(32)).toBe("md5");
    expect(algorithmForDigestLength(40)).toBe("sha1");
    expect(algorithmForDigestLength(64)).toBe("sha256");
    expect(algorithmForDigestLength(128)).toBe("sha512");
  });

  it("refuses a length no algorithm here produces", () => {
    expect(algorithmForDigestLength(63)).toBeNull();
    expect(algorithmForDigestLength(0)).toBeNull();
    expect(algorithmForDigestLength(56)).toBeNull();
  });
});

describe("parseExpectedChecksum", () => {
  it("reports an empty paste as empty rather than unreadable", () => {
    expect(parseExpectedChecksum("")).toEqual({ kind: "empty" });
    expect(parseExpectedChecksum("   \n  ")).toEqual({ kind: "empty" });
  });

  it("reads a bare digest and names its algorithm", () => {
    expect(parseExpectedChecksum(SHA256)).toEqual({
      kind: "parsed",
      digest: SHA256,
      fileName: null,
      algorithm: "sha256",
    });
  });

  it("lower-cases an upper-case digest", () => {
    const parsed = parseExpectedChecksum(SHA1.toUpperCase());
    expect(parsed).toMatchObject({ kind: "parsed", digest: SHA1, algorithm: "sha1" });
  });

  it("reads the GNU coreutils line and keeps the filename", () => {
    expect(parseExpectedChecksum(`${SHA256}  ubuntu-24.04.iso`)).toEqual({
      kind: "parsed",
      digest: SHA256,
      fileName: "ubuntu-24.04.iso",
      algorithm: "sha256",
    });
  });

  it("reads shasum's binary-mode asterisk", () => {
    expect(parseExpectedChecksum(`${SHA512} *archive.tar.gz`)).toMatchObject({
      kind: "parsed",
      fileName: "archive.tar.gz",
      algorithm: "sha512",
    });
  });

  it("reads the BSD parenthesised form", () => {
    expect(parseExpectedChecksum(`SHA256 (ubuntu.iso) = ${SHA256}`)).toEqual({
      kind: "parsed",
      digest: SHA256,
      fileName: "ubuntu.iso",
      algorithm: "sha256",
    });
  });

  it("reads the OCI `sha256:` digest spelling", () => {
    expect(parseExpectedChecksum(`sha256:${SHA256}`)).toMatchObject({
      kind: "parsed",
      digest: SHA256,
      fileName: null,
    });
  });

  it("survives the surrounding prose of a release page", () => {
    expect(parseExpectedChecksum(`  SHA-256 checksum: ${SHA256} (verify before use)  `)).toMatchObject(
      { kind: "parsed", digest: SHA256, algorithm: "sha256" },
    );
  });

  it("REFUSES a truncated digest instead of matching its prefix", () => {
    // The whole point. A 63-character paste is a paste that lost a character,
    // and quietly comparing its first 40 against SHA-1 would report a
    // mismatch on a good file — or, far worse, a match on a bad one.
    const truncated = SHA256.slice(0, 63);
    expect(parseExpectedChecksum(truncated)).toEqual({
      kind: "unreadable",
      hexRun: truncated,
    });
  });

  it("reports the longest hex run it found, so the UI can say what is wrong", () => {
    expect(parseExpectedChecksum("not a checksum at all")).toEqual({
      kind: "unreadable",
      // "ch-EC-ksum": ordinary English is full of one- and two-character hex
      // runs, and the longest of them is what the UI quotes back.
      hexRun: "ec",
    });
    expect(parseExpectedChecksum("zzz")).toEqual({ kind: "unreadable", hexRun: null });
  });
});

describe("parseChecksumList", () => {
  const sums = [
    `${SHA256}  ubuntu-24.04-desktop-amd64.iso`,
    `${SHA256.replace(/.$/, "0")}  ubuntu-24.04-live-server-amd64.iso`,
  ].join("\n");

  it("reads every line of a SHA256SUMS file", () => {
    const list = parseChecksumList(sums);
    expect(list.entries).toHaveLength(2);
    expect(list.entries[0].fileName).toBe("ubuntu-24.04-desktop-amd64.iso");
    expect(list.unreadableLines).toBe(0);
  });

  it("skips blank lines without counting them as junk", () => {
    expect(parseChecksumList(`\n${SHA256}  a.iso\n\n\n`).unreadableLines).toBe(0);
  });

  it("counts the PGP armour a copied sums file drags along", () => {
    const armoured = [
      "-----BEGIN PGP SIGNED MESSAGE-----",
      "Hash: SHA512",
      "",
      `${SHA256}  ubuntu.iso`,
      "-----BEGIN PGP SIGNATURE-----",
    ].join("\n");
    const list = parseChecksumList(armoured);
    expect(list.entries).toHaveLength(1);
    expect(list.unreadableLines).toBe(3);
  });
});

describe("baseName", () => {
  it("drops POSIX and Windows directories alike", () => {
    expect(baseName("./dists/ubuntu.iso")).toBe("ubuntu.iso");
    expect(baseName("C:\\Downloads\\ubuntu.iso")).toBe("ubuntu.iso");
    expect(baseName("ubuntu.iso")).toBe("ubuntu.iso");
  });
});

describe("compareChecksum", () => {
  it("names the algorithm that matched", () => {
    expect(compareChecksum(SHA256, hashes)).toBe("sha256");
    expect(compareChecksum(MD5, hashes)).toBe("md5");
  });

  it("is case-insensitive in both directions", () => {
    expect(compareChecksum(SHA1.toUpperCase(), hashes)).toBe("sha1");
    expect(
      compareChecksum(SHA1, { ...hashes, sha1: SHA1.toUpperCase() }),
    ).toBe("sha1");
  });

  it("tolerates the whitespace a paste brings with it", () => {
    expect(compareChecksum(`  ${SHA512}\n`, hashes)).toBe("sha512");
  });

  it("returns null when nothing matches", () => {
    expect(compareChecksum(SHA256.replace(/.$/, "0"), hashes)).toBeNull();
    expect(compareChecksum("", hashes)).toBeNull();
  });
});

describe("verdictForFile", () => {
  it("says nothing when nothing was pasted", () => {
    expect(verdictForFile(parseChecksumList(""), "ubuntu.iso", hashes)).toEqual({ kind: "none" });
  });

  it("matches a bare digest against any file, whatever it is called", () => {
    const verdict = verdictForFile(parseChecksumList(SHA256), "renamed.iso", hashes);
    expect(verdict).toMatchObject({ kind: "match", algorithm: "sha256" });
  });

  it("reports a mismatch loudly rather than falling back to `none`", () => {
    const wrong = SHA256.replace(/.$/, "0");
    const verdict = verdictForFile(parseChecksumList(wrong), "ubuntu.iso", hashes);
    expect(verdict.kind).toBe("mismatch");
  });

  it("picks the line that names this file out of a sums list", () => {
    const list = parseChecksumList(
      [`${MD5}  other.iso`, `${SHA256}  ubuntu.iso`].join("\n"),
    );
    expect(verdictForFile(list, "ubuntu.iso", hashes)).toMatchObject({
      kind: "match",
      algorithm: "sha256",
    });
  });

  it("matches a sums line that carries a directory prefix", () => {
    const list = parseChecksumList(
      [`${MD5}  ./other.iso`, `${SHA256}  ./dists/ubuntu.iso`].join("\n"),
    );
    expect(verdictForFile(list, "ubuntu.iso", hashes)).toMatchObject({ kind: "match" });
  });

  it("says a file is unlisted rather than comparing it against the wrong line", () => {
    const list = parseChecksumList(
      [`${MD5}  a.iso`, `${SHA256}  b.iso`].join("\n"),
    );
    expect(verdictForFile(list, "c.iso", hashes)).toEqual({ kind: "unlisted" });
  });

  it("still applies a single NAMED line to a renamed file", () => {
    const list = parseChecksumList(`${SHA256}  ubuntu.iso`);
    expect(verdictForFile(list, "ubuntu-copy.iso", hashes)).toMatchObject({ kind: "match" });
  });
});

describe("formatSumsFile", () => {
  it("writes coreutils' two-space form with a trailing newline", () => {
    expect(formatSumsFile([{ name: "a.iso", digest: SHA256 }])).toBe(`${SHA256}  a.iso\n`);
  });

  it("writes one line per file", () => {
    const text = formatSumsFile([
      { name: "a.iso", digest: SHA256 },
      { name: "b.iso", digest: MD5 },
    ]);
    expect(text.split("\n").filter(Boolean)).toHaveLength(2);
  });

  it("escapes a name containing a backslash or newline, as sha256sum does", () => {
    expect(formatSumsFile([{ name: "we\\ird.iso", digest: MD5 }])).toBe(
      `\\${MD5}  we\\\\ird.iso\n`,
    );
    expect(formatSumsFile([{ name: "two\nlines.iso", digest: MD5 }])).toBe(
      `\\${MD5}  two\\nlines.iso\n`,
    );
  });
});
