import { describe, expect, it } from "vitest";
import {
  convertLineEndings,
  countLineEndings,
  dominantEol,
  isMixedEol,
  readUtf8Text,
  sortDedupeLines,
  splitLines,
  utf8ByteLength,
  type SortDedupeOptions,
} from "@/lib/tools/line-tools";

const enc = (s: string) => new TextEncoder().encode(s);

/** Everything off, so each test turns on exactly the one thing it is about. */
const OFF: SortDedupeOptions = {
  sort: "none",
  caseSensitive: true,
  trim: false,
  removeBlank: false,
  dedupe: "off",
  reverse: false,
  stripBom: false,
};

const opts = (over: Partial<SortDedupeOptions>): SortDedupeOptions => ({ ...OFF, ...over });

describe("readUtf8Text", () => {
  it("decodes valid UTF-8 and reports no BOM", () => {
    const result = readUtf8Text(enc("héllo\nwörld"));
    expect("failure" in result).toBe(false);
    if ("failure" in result) return;
    expect(result.text).toBe("héllo\nwörld");
    expect(result.hadBom).toBe(false);
    // 13 characters, two of them two bytes each.
    expect(result.bytes).toBe(13);
  });

  it("keeps a UTF-8 BOM in the string instead of swallowing it", () => {
    const result = readUtf8Text(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]));
    expect("failure" in result).toBe(false);
    if ("failure" in result) return;
    expect(result.hadBom).toBe(true);
    expect(result.text).toBe("\uFEFFa");
    expect(result.text.length).toBe(2);
  });

  it("refuses Windows-1252 bytes rather than returning U+FFFD damage", () => {
    // 0xE9 is é in Windows-1252 and an invalid lead byte on its own in UTF-8.
    const result = readUtf8Text(new Uint8Array([0x63, 0x61, 0x66, 0xe9]));
    expect(result).toEqual({ failure: "not-utf-8" });
  });

  it("refuses a UTF-16 byte-order mark in both endiannesses", () => {
    expect(readUtf8Text(new Uint8Array([0xff, 0xfe, 0x61, 0x00]))).toEqual({
      failure: "utf-16",
    });
    expect(readUtf8Text(new Uint8Array([0xfe, 0xff, 0x00, 0x61]))).toEqual({
      failure: "utf-16",
    });
  });

  it("refuses BOM-less UTF-16, which decodes as valid UTF-8 with NULs in it", () => {
    // "ab" as UTF-16LE. Every byte is legal UTF-8, so only the NUL test catches it.
    const utf16le = new Uint8Array([0x61, 0x00, 0x62, 0x00]);
    expect(new TextDecoder("utf-8", { fatal: true }).decode(utf16le)).toBe("a\u0000b\u0000");
    expect(readUtf8Text(utf16le)).toEqual({ failure: "utf-16" });
  });

  it("calls a stray NUL binary rather than UTF-16", () => {
    const bytes = new Uint8Array(100).fill(0x61);
    bytes[50] = 0;
    expect(readUtf8Text(bytes)).toEqual({ failure: "binary" });
  });
});

describe("utf8ByteLength", () => {
  it("counts bytes, not characters", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("é")).toBe(2);
    expect(utf8ByteLength("😀")).toBe(4);
    expect("😀".length).toBe(2);
  });
});

describe("countLineEndings", () => {
  it("never double-counts a CRLF as a CR plus an LF", () => {
    expect(countLineEndings("a\r\nb")).toEqual({ crlf: 1, lf: 0, cr: 0, total: 1 });
  });

  it("reports a mixed file per kind", () => {
    const counts = countLineEndings("a\r\nb\nc\rd\r\n");
    expect(counts).toEqual({ crlf: 2, lf: 1, cr: 1, total: 4 });
    expect(isMixedEol(counts)).toBe(true);
    expect(dominantEol(counts)).toBe("crlf");
  });

  it("separates a lone CR that is followed by a non-LF character", () => {
    expect(countLineEndings("a\rb\r\n")).toEqual({ crlf: 1, lf: 0, cr: 1, total: 2 });
  });

  it("counts a CR at the very end of the text as a lone CR", () => {
    expect(countLineEndings("a\r")).toEqual({ crlf: 0, lf: 0, cr: 1, total: 1 });
  });

  it("calls a single-kind file unmixed and an empty one endingless", () => {
    expect(isMixedEol(countLineEndings("a\nb\nc"))).toBe(false);
    expect(dominantEol(countLineEndings("no breaks"))).toBeNull();
  });
});

describe("splitLines", () => {
  it("treats a trailing break as terminating the last line", () => {
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\nb")).toEqual(["a", "b"]);
  });

  it("keeps a blank line that a second break really does open", () => {
    expect(splitLines("a\n\nb")).toEqual(["a", "", "b"]);
  });

  it("splits all three kinds and returns nothing for empty text", () => {
    expect(splitLines("a\r\nb\rc\nd")).toEqual(["a", "b", "c", "d"]);
    expect(splitLines("")).toEqual([]);
  });
});

describe("convertLineEndings", () => {
  const base = { ensureTrailingNewline: false, stripBom: false };

  it("rewrites a mixed file to LF and reports what the input had", () => {
    const r = convertLineEndings("a\r\nb\nc\rd", { ...base, target: "lf" });
    expect(r.text).toBe("a\nb\nc\nd");
    expect(r.before).toEqual({ crlf: 1, lf: 1, cr: 1, total: 3 });
    expect(r.after).toEqual({ crlf: 0, lf: 3, cr: 0, total: 3 });
    expect(r.mixed).toBe(true);
    expect(r.alreadyTarget).toBe(1);
    expect(r.converted).toBe(2);
    expect(r.lines).toBe(4);
  });

  it("expands LF to CRLF and reports the exact byte growth", () => {
    const r = convertLineEndings("a\nb\nc", { ...base, target: "crlf" });
    expect(r.text).toBe("a\r\nb\r\nc");
    expect(r.bytesIn).toBe(5);
    expect(r.bytesOut).toBe(7);
    expect(r.bytesOut - r.bytesIn).toBe(r.converted);
  });

  it("writes lone CRs for the classic Mac target", () => {
    const r = convertLineEndings("a\r\nb\n", { ...base, target: "cr" });
    expect(r.text).toBe("a\rb\r");
    expect(r.after).toEqual({ crlf: 0, lf: 0, cr: 2, total: 2 });
  });

  it("strips a BOM only when asked, and says either way", () => {
    const kept = convertLineEndings("\uFEFFa\n", { ...base, target: "lf" });
    expect(kept.hadBom).toBe(true);
    expect(kept.bomStripped).toBe(false);
    expect(kept.text).toBe("\uFEFFa\n");

    const stripped = convertLineEndings("\uFEFFa\n", {
      ...base,
      target: "lf",
      stripBom: true,
    });
    expect(stripped.bomStripped).toBe(true);
    expect(stripped.text).toBe("a\n");
    // The mark is three bytes on the wire even though it is one character.
    expect(stripped.bytesIn - stripped.bytesOut).toBe(3);
  });

  it("reports no BOM to strip when there was none", () => {
    const r = convertLineEndings("a\n", { ...base, target: "lf", stripBom: true });
    expect(r.hadBom).toBe(false);
    expect(r.bomStripped).toBe(false);
  });

  it("adds a final newline only when one is missing", () => {
    const added = convertLineEndings("a\nb", {
      ...base,
      target: "lf",
      ensureTrailingNewline: true,
    });
    expect(added.trailingNewlineAdded).toBe(true);
    expect(added.text).toBe("a\nb\n");

    const already = convertLineEndings("a\nb\n", {
      ...base,
      target: "lf",
      ensureTrailingNewline: true,
    });
    expect(already.trailingNewlineAdded).toBe(false);
    expect(already.text).toBe("a\nb\n");
  });

  it("does not invent a newline for an empty file", () => {
    const r = convertLineEndings("", {
      ...base,
      target: "lf",
      ensureTrailingNewline: true,
    });
    expect(r.text).toBe("");
    expect(r.trailingNewlineAdded).toBe(false);
    expect(r.lines).toBe(0);
  });

  it("leaves everything that is not a line ending byte for byte", () => {
    const source = "héllo, wörld\r\n\ttabbed  spaced \r\n😀";
    const r = convertLineEndings(source, { ...base, target: "lf" });
    expect(r.text.replace(/\n/g, "\r\n")).toBe(source);
  });
});

describe("sortDedupeLines", () => {
  it("sorts naturally so file2 comes before file10", () => {
    const natural = sortDedupeLines("file10\nfile2\nfile1", opts({ sort: "natural" }));
    expect(natural.lines).toEqual(["file1", "file2", "file10"]);

    // The contrast the copy claims: plain collation is not numeric.
    const plain = sortDedupeLines("file10\nfile2\nfile1", opts({ sort: "asc" }));
    expect(plain.lines).toEqual(["file1", "file10", "file2"]);
  });

  it("uses Unicode collation, not code-point order", () => {
    // Raw `<` puts every capital before every lower-case letter.
    const collated = sortDedupeLines("apple\nZebra\nBanana", opts({ sort: "asc" }));
    expect(collated.lines).toEqual(["apple", "Banana", "Zebra"]);
    expect([...["apple", "Zebra", "Banana"]].sort()).toEqual(["Banana", "Zebra", "apple"]);
  });

  it("reverses A→Z into Z→A", () => {
    expect(sortDedupeLines("b\na\nc", opts({ sort: "desc" })).lines).toEqual(["c", "b", "a"]);
  });

  it("sorts by length with a collation tie-break", () => {
    const r = sortDedupeLines("ccc\nb\naa\nbb", opts({ sort: "length" }));
    expect(r.lines).toEqual(["b", "aa", "bb", "ccc"]);
  });

  it("counts duplicates removed and how many groups repeated", () => {
    const r = sortDedupeLines("a\nb\na\nc\nb\na", opts({ dedupe: "first" }));
    expect(r.lines).toEqual(["a", "b", "c"]);
    expect(r.linesIn).toBe(6);
    expect(r.linesOut).toBe(3);
    expect(r.duplicatesRemoved).toBe(3);
    expect(r.duplicateGroups).toBe(2);
  });

  it("keep-last leaves the last occurrence where it already sat", () => {
    const r = sortDedupeLines("a\nb\na\nc", opts({ dedupe: "last" }));
    expect(r.lines).toEqual(["b", "a", "c"]);
    expect(r.duplicatesRemoved).toBe(1);
  });

  it("folds case for the duplicate test only when asked", () => {
    const sensitive = sortDedupeLines("API\napi", opts({ dedupe: "first" }));
    expect(sensitive.lines).toEqual(["API", "api"]);
    expect(sensitive.duplicatesRemoved).toBe(0);

    const folded = sortDedupeLines(
      "API\napi",
      opts({ dedupe: "first", caseSensitive: false }),
    );
    expect(folded.lines).toEqual(["API"]);
    expect(folded.duplicatesRemoved).toBe(1);
  });

  it("trims before de-duplicating, which is what makes padded lines equal", () => {
    const r = sortDedupeLines("  api  \napi\n api", opts({ trim: true, dedupe: "first" }));
    expect(r.lines).toEqual(["api"]);
    expect(r.trimmedLines).toBe(2);
    expect(r.duplicatesRemoved).toBe(2);
  });

  it("counts only the lines trim actually changed", () => {
    const r = sortDedupeLines("a\n b\nc", opts({ trim: true }));
    expect(r.trimmedLines).toBe(1);
  });

  it("removes whitespace-only lines and counts them", () => {
    const r = sortDedupeLines("a\n\n   \nb\n\t", opts({ removeBlank: true }));
    expect(r.lines).toEqual(["a", "b"]);
    expect(r.blanksRemoved).toBe(3);
  });

  it("reverses last, after the sort", () => {
    const r = sortDedupeLines("b\na\nc", opts({ sort: "asc", reverse: true }));
    expect(r.lines).toEqual(["c", "b", "a"]);
  });

  it("rejoins with the input's own line ending and flags a mixed input", () => {
    const crlf = sortDedupeLines("b\r\na\r\nc", opts({ sort: "asc" }));
    expect(crlf.eol).toBe("crlf");
    expect(crlf.text).toBe("a\r\nb\r\nc");
    expect(crlf.mixedEol).toBe(false);

    const mixed = sortDedupeLines("b\r\na\nc\r\n", opts({ sort: "asc" }));
    expect(mixed.mixedEol).toBe(true);
    expect(mixed.eol).toBe("crlf");
    expect(mixed.text).toBe("a\r\nb\r\nc\r\n");
  });

  it("preserves a trailing newline and does not invent one", () => {
    expect(sortDedupeLines("b\na\n", opts({ sort: "asc" })).text).toBe("a\nb\n");
    expect(sortDedupeLines("b\na", opts({ sort: "asc" })).text).toBe("a\nb");
  });

  it("is a no-op with every option off", () => {
    const source = "b\na\n\n  c  \na";
    expect(sortDedupeLines(source, OFF).text).toBe(source);
  });

  it("handles empty input without inventing a line", () => {
    const r = sortDedupeLines("", opts({ sort: "asc", dedupe: "first" }));
    expect(r.lines).toEqual([]);
    expect(r.linesIn).toBe(0);
    expect(r.linesOut).toBe(0);
    expect(r.text).toBe("");
  });
});

/*
  A byte-order mark left attached to line 1 is the worst kind of bug this module
  can have, because nothing on screen shows it: the mark is invisible in a pane,
  and `Intl.Collator` treats U+FEFF as completely ignorable, so a sorted list
  looks right while the mark has moved into the middle of the file and the head
  of the file no longer has one. Excel then reopens the CSV in the system
  codepage. These tests exist to keep it detached.
*/
describe("sortDedupeLines and the byte-order mark", () => {
  it("is invisible to the collator, which is why the sort cannot be trusted with it", () => {
    expect(new Intl.Collator(undefined, { sensitivity: "variant" }).compare("\uFEFFapple", "apple")).toBe(0);
  });

  it("writes the mark back at the head instead of sorting it into the middle", () => {
    const r = sortDedupeLines("\uFEFFzebra\napple\nmango\n", opts({ sort: "asc" }));
    expect(r.lines).toEqual(["apple", "mango", "zebra"]);
    expect(r.text).toBe("\uFEFFapple\nmango\nzebra\n");
    // Exactly one mark, and it opens the file.
    expect(r.text.indexOf("\uFEFF")).toBe(0);
    expect(r.text.lastIndexOf("\uFEFF")).toBe(0);
    expect(r.hadBom).toBe(true);
    expect(r.bomStripped).toBe(false);
  });

  it("counts a marked line as a duplicate of its unmarked twin", () => {
    const r = sortDedupeLines("\uFEFFapi\napi\n", opts({ dedupe: "first" }));
    expect(r.duplicatesRemoved).toBe(1);
    expect(r.duplicateGroups).toBe(1);
    expect(r.linesOut).toBe(1);
    expect(r.text).toBe("\uFEFFapi\n");
  });

  it("drops the mark entirely when asked, and says it did", () => {
    const r = sortDedupeLines("\uFEFFb\na\n", opts({ sort: "asc", stripBom: true }));
    expect(r.text).toBe("a\nb\n");
    expect(r.hadBom).toBe(true);
    expect(r.bomStripped).toBe(true);
  });

  it("reports no mark, and stripping changes nothing, when there is none", () => {
    const r = sortDedupeLines("b\na\n", opts({ sort: "asc", stripBom: true }));
    expect(r.hadBom).toBe(false);
    expect(r.bomStripped).toBe(false);
    expect(r.text).toBe("a\nb\n");
  });

  it("does not let the mark become a line, or its own line's content", () => {
    const r = sortDedupeLines("\uFEFFa\nb\n", opts({}));
    expect(r.linesIn).toBe(2);
    expect(r.lines).toEqual(["a", "b"]);
  });
});
