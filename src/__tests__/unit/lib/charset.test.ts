import { describe, expect, it } from "vitest";
import {
  CHARSET_ENCODINGS,
  FALLBACK_ENCODING,
  countReplacements,
  decodeBytes,
  detectBom,
  encodeUtf8,
  encodingName,
  isSupportedEncoding,
  sniffUtf16,
  utf8FileName,
} from "@/lib/tools/charset";

/** Bytes from a hex string, for readability at the call site. */
const hex = (s: string): Uint8Array =>
  new Uint8Array((s.match(/[0-9a-f]{2}/gi) ?? []).map((b) => parseInt(b, 16)));

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/** UTF-16LE code units, little end first. Optionally BOM-prefixed. */
function utf16le(s: string, bom = false): Uint8Array {
  const units = [...s].flatMap((ch) => {
    const code = ch.charCodeAt(0);
    return [code & 0xff, code >> 8];
  });
  return new Uint8Array(bom ? [0xff, 0xfe, ...units] : units);
}

function utf16be(s: string, bom = false): Uint8Array {
  const units = [...s].flatMap((ch) => {
    const code = ch.charCodeAt(0);
    return [code >> 8, code & 0xff];
  });
  return new Uint8Array(bom ? [0xfe, 0xff, ...units] : units);
}

describe("the offered encoding list", () => {
  it("has no duplicate labels", () => {
    const labels = CHARSET_ENCODINGS.map((e) => e.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("offers only labels this engine's TextDecoder actually knows", () => {
    // A picker entry the decoder rejects would silently fall through to the
    // guesser and read the file as something else entirely.
    const unsupported = CHARSET_ENCODINGS.filter((e) => !isSupportedEncoding(e.label));
    expect(unsupported.map((e) => e.label)).toEqual([]);
  });

  it("does not offer iso-8859-1, which is windows-1252 in the same tables", () => {
    expect(CHARSET_ENCODINGS.map((e) => e.label)).not.toContain("iso-8859-1");
  });

  it("names an unknown label rather than throwing", () => {
    expect(encodingName("windows-1251")).toBe("Windows-1251 · Cyrillic");
    expect(encodingName("ebcdic")).toBe("EBCDIC");
  });
});

describe("isSupportedEncoding", () => {
  it("is false for a label no decoder implements", () => {
    expect(isSupportedEncoding("not-a-real-encoding")).toBe(false);
  });
});

describe("detectBom", () => {
  it("reads the three Unicode marks", () => {
    expect(detectBom(hex("efbbbf 41"))).toBe("utf-8");
    expect(detectBom(hex("fffe 4100"))).toBe("utf-16le");
    expect(detectBom(hex("feff 0041"))).toBe("utf-16be");
  });

  it("returns null with no mark", () => {
    expect(detectBom(utf8("hello"))).toBeNull();
  });

  it("does not claim a UTF-32LE mark as UTF-16LE", () => {
    // FF FE 00 00 opens a UTF-32LE file. Reading it as UTF-16 produces text
    // with a NUL between every letter, which looks like a successful decode.
    expect(detectBom(hex("fffe0000 41000000"))).toBeNull();
  });
});

describe("sniffUtf16", () => {
  it("spots BOM-less UTF-16LE by its NUL parity", () => {
    expect(sniffUtf16(utf16le("abcdefghijklmnop"))).toBe("utf-16le");
  });

  it("spots BOM-less UTF-16BE", () => {
    expect(sniffUtf16(utf16be("abcdefghijklmnop"))).toBe("utf-16be");
  });

  it("refuses to guess from fewer than 16 bytes", () => {
    expect(sniffUtf16(utf16le("abc"))).toBeNull();
  });

  it("does not mistake plain ASCII for UTF-16", () => {
    expect(sniffUtf16(utf8("the quick brown fox jumps"))).toBeNull();
  });
});

describe("decodeBytes — detection order", () => {
  it("reads clean UTF-8 as UTF-8 and calls it strict", () => {
    const report = decodeBytes(utf8("café naïve"));
    expect(report.text).toBe("café naïve");
    expect(report.encoding).toBe("utf-8");
    expect(report.basis).toBe("utf-8");
    expect(report.strict).toBe(true);
    expect(report.replacements).toBe(0);
    expect(report.ascii).toBe(false);
  });

  it("flags pure ASCII, where every candidate encoding agrees", () => {
    expect(decodeBytes(utf8("plain")).ascii).toBe(true);
  });

  it("believes a UTF-8 BOM and strips the mark from the text", () => {
    const report = decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("hi")]));
    expect(report.basis).toBe("bom");
    expect(report.bom).toBe("utf-8");
    expect(report.text).toBe("hi");
  });

  it("believes a UTF-16LE BOM", () => {
    const report = decodeBytes(utf16le("Привет", true));
    expect(report.basis).toBe("bom");
    expect(report.bom).toBe("utf-16le");
    expect(report.text).toBe("Привет");
  });

  it("believes a UTF-16BE BOM", () => {
    const report = decodeBytes(utf16be("Привет", true));
    expect(report.encoding).toBe("utf-16be");
    expect(report.text).toBe("Привет");
  });

  it("sniffs BOM-less UTF-16LE before the UTF-8 test, and marks it a guess", () => {
    // NUL is a valid UTF-8 byte, so a strict UTF-8 decode ACCEPTS these bytes
    // and returns text with a NUL between every letter. The sniff has to win.
    const report = decodeBytes(utf16le("hello there world"));
    expect(report.encoding).toBe("utf-16le");
    expect(report.basis).toBe("guess");
    expect(report.text).toBe("hello there world");
  });

  it("falls back to Windows-1252 and says it guessed", () => {
    // "При" in Windows-1251. Not valid UTF-8, so the strict test fails.
    const report = decodeBytes(hex("cff0e8"));
    expect(report.encoding).toBe(FALLBACK_ENCODING);
    expect(report.basis).toBe("guess");
    expect(report.text).toBe("Ïðè");
  });

  it("honours a forced label over everything else", () => {
    const report = decodeBytes(hex("cff0e8"), "windows-1251");
    expect(report.basis).toBe("forced");
    expect(report.encoding).toBe("windows-1251");
    expect(report.text).toBe("При");
  });

  it("honours a forced label even when it is wrong — that is how a user sees it is wrong", () => {
    const report = decodeBytes(utf8("café"), "windows-1252");
    expect(report.basis).toBe("forced");
    expect(report.text).toBe("cafÃ©");
  });

  it("ignores an unsupported forced label rather than throwing", () => {
    const report = decodeBytes(utf8("hello"), "not-a-real-encoding");
    expect(report.basis).toBe("utf-8");
    expect(report.text).toBe("hello");
  });

  it("reports the byte count it was given", () => {
    expect(decodeBytes(utf8("abcd")).bytesIn).toBe(4);
  });
});

describe("decodeBytes — the U+FFFD signal", () => {
  it("counts replacement characters when a multi-byte label is wrong", () => {
    // Shift_JIS bytes for 日本, read as UTF-8: every byte is invalid.
    const report = decodeBytes(hex("93 fa 96 7b"), "utf-8");
    expect(report.strict).toBe(false);
    expect(report.replacements).toBeGreaterThan(0);
  });

  it("reports zero replacements and a strict decode when the label is right", () => {
    const report = decodeBytes(hex("93 fa 96 7b"), "shift_jis");
    expect(report.text).toBe("日本");
    expect(report.strict).toBe(true);
    expect(report.replacements).toBe(0);
  });

  it("calls a single-byte codepage strict even when the letters are wrong", () => {
    // Windows-1252 maps all 256 byte values, so no byte can be invalid in it.
    // The mojibake is real and the strict flag is still true — which is
    // exactly why the UI cannot rely on `strict` alone to spot a bad guess.
    const report = decodeBytes(hex("cff0e8"), "windows-1252");
    expect(report.strict).toBe(true);
    expect(report.replacements).toBe(0);
    expect(report.text).not.toBe("При");
  });

  it("counts a replacement character that was genuinely in the source", () => {
    const report = decodeBytes(utf8("a�b"));
    expect(report.strict).toBe(true);
    expect(report.replacements).toBe(1);
  });
});

describe("countReplacements", () => {
  it("counts every U+FFFD", () => {
    expect(countReplacements("")).toBe(0);
    expect(countReplacements("clean")).toBe(0);
    expect(countReplacements("a�b�")).toBe(2);
  });
});

describe("encodeUtf8", () => {
  it("writes UTF-8 with no mark by default", () => {
    const out = encodeUtf8("café");
    expect(out.bomAdded).toBe(false);
    expect(out.bytesOut).toBe(5);
    expect([...out.bytes.slice(0, 3)]).toEqual([0x63, 0x61, 0x66]);
  });

  it("prefixes the three-byte mark when asked, and counts it", () => {
    const out = encodeUtf8("café", true);
    expect(out.bomAdded).toBe(true);
    expect([...out.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(out.bytesOut).toBe(8);
  });

  it("round-trips a legacy file into readable UTF-8", () => {
    const legacy = hex("cff0e8e2e5f2"); // "Привет" in Windows-1251
    const decoded = decodeBytes(legacy, "windows-1251");
    const encoded = encodeUtf8(decoded.text);
    expect(new TextDecoder("utf-8", { fatal: true }).decode(encoded.bytes)).toBe("Привет");
    expect(encoded.bytesOut).toBeGreaterThan(legacy.length);
  });
});

describe("utf8FileName", () => {
  it("keeps the extension and marks the stem", () => {
    expect(utf8FileName("notes.txt")).toBe("notes.utf8.txt");
    expect(utf8FileName("subs.eng.srt")).toBe("subs.eng.utf8.srt");
  });

  it("handles a name with no extension", () => {
    expect(utf8FileName("README")).toBe("README.utf8");
  });

  it("falls back for an empty name", () => {
    expect(utf8FileName("   ")).toBe("converted.utf8.txt");
  });
});
