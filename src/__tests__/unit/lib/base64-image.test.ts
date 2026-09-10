import { describe, it, expect } from "vitest";

import {
  decodeBase64Image,
  decodeBase64ToBytes,
  sniffImageFormat,
} from "@/lib/tools/base64-image";

/**
 * The eight paste shapes this tool has to accept and the four it has to
 * refuse, each one with a different message.
 *
 * `atob` throws the identical `InvalidCharacterError` for the URL-safe
 * alphabet, a length of `% 4 === 1`, a whole `data:` URI and outright junk
 * (measured — `scratchpad/base64-webp.mjs`), so every distinction the UI makes
 * has to be made here. That is what most of this file pins.
 *
 * The load-bearing detail is an ORDERING: whitespace is stripped BEFORE the
 * `% 4` padding arithmetic. A line-wrapped payload whose newlines make its raw
 * length ≡ 1 (mod 4) is the case that catches a reversal, and it has its own
 * test below.
 */

/** The 8 bytes every PNG starts with, plus enough IHDR to be recognisable. */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08,
]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const le16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];

/**
 * A BMP file header and the first field of its DIB header, which is the DIB
 * header's own length. `sips` on macOS writes 40 here for a 4x3 PNG
 * (`424d 5a00 0000 0000 0000 3600 0000 2800 0000`), and this mirrors that
 * layout byte for byte with the DIB length left as a parameter.
 */
function bmpHeader(dibSize: number, fileSize = 90): number[] {
  return [0x42, 0x4d, ...le32(fileSize), 0, 0, 0, 0, ...le32(54), ...le32(dibSize)];
}

/** An ICONDIR plus `count` whole 16-byte directory entries. */
function icoHeader(count: number, type = 1): number[] {
  const entries: number[] = [];
  for (let i = 0; i < count; i++) {
    entries.push(16, 16, 0, 0, ...le16(1), ...le16(32), ...le32(64), ...le32(22 + i * 64));
  }
  return [0, 0, type, 0, ...le16(count), ...entries];
}

const latin1 = (text: string) => new Uint8Array(Buffer.from(text, "latin1"));

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const PNG_B64 = toBase64(PNG_BYTES);
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

function expectImage(input: string) {
  const result = decodeBase64Image(input);
  if (!result.ok) throw new Error(`expected a decode, got refusal "${result.reason}"`);
  return result.image;
}

function expectRefusal(input: string) {
  const result = decodeBase64Image(input);
  if (result.ok) throw new Error("expected a refusal, got a decoded image");
  return result;
}

// ── the eight accepted shapes ────────────────────────────────────

describe("decodeBase64Image — the paste shapes people actually use", () => {
  it("1. raw standard Base64", () => {
    const image = expectImage(PNG_B64);
    expect(hex(image.bytes)).toBe(hex(PNG_BYTES));
    expect(image.source).toBe("raw");
    expect(image.declaredMime).toBeNull();
    expect(image.format).toBe("png");
  });

  it("2. a data URI with a mediatype", () => {
    const image = expectImage(`data:image/png;base64,${PNG_B64}`);
    expect(hex(image.bytes)).toBe(hex(PNG_BYTES));
    expect(image.source).toBe("data-uri");
    expect(image.declaredMime).toBe("image/png");
  });

  it("3. a data URI carrying extra parameters", () => {
    // The split is on the FIRST comma, not on a `;base64,` match — otherwise
    // `charset=utf-8` stays glued to the front of the payload.
    const image = expectImage(`data:image/png;charset=utf-8;base64,${PNG_B64}`);
    expect(hex(image.bytes)).toBe(hex(PNG_BYTES));
    expect(image.declaredMime).toBe("image/png");
  });

  it("4. line-wrapped Base64, the way base64(1) and PEM emit it", () => {
    const wrapped = (PNG_B64.match(/.{1,8}/g) ?? []).join("\n");
    expect(wrapped).toContain("\n");
    expect(hex(expectImage(wrapped).bytes)).toBe(hex(PNG_BYTES));
  });

  it("5. leading and trailing whitespace from a terminal paste", () => {
    expect(hex(expectImage(`\n\t  ${PNG_B64}  \r\n`).bytes)).toBe(hex(PNG_BYTES));
  });

  it("6. the URL-safe alphabet, and it says so", () => {
    /*
      Craft bytes whose standard encoding uses BOTH + and /, so the URL-safe
      form genuinely differs and a missing translation cannot pass by luck.
      The nine-byte PNG prefix keeps the special group aligned to a 4-character
      boundary, and 0xFB 0xFF 0xBF is the 3-byte group that encodes to "+/+/".
    */
    const bytes = new Uint8Array([...PNG_BYTES.subarray(0, 9), 0xfb, 0xff, 0xbf]);
    const standard = toBase64(bytes);
    expect(standard).toMatch(/[+/]/);
    const urlSafe = standard.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const image = expectImage(urlSafe);
    expect(hex(image.bytes)).toBe(hex(bytes));
    expect(image.urlSafe).toBe(true);
  });

  it("7. unpadded Base64, and it reports how much padding it added", () => {
    const unpadded = PNG_B64.replace(/=+$/, "");
    const added = PNG_B64.length - unpadded.length;
    expect(added).toBeGreaterThan(0);

    const image = expectImage(unpadded);
    expect(hex(image.bytes)).toBe(hex(PNG_BYTES));
    expect(image.paddingAdded).toBe(added);
    // The padded original needed nothing added — the counter is real, not a
    // constant dressed up as one.
    expect(expectImage(PNG_B64).paddingAdded).toBe(0);
  });

  it("8. a whole <img> tag copied out of a page", () => {
    const image = expectImage(`<img alt="logo" src="data:image/png;base64,${PNG_B64}" width="16">`);
    expect(hex(image.bytes)).toBe(hex(PNG_BYTES));
    expect(image.source).toBe("img-tag");
    expect(image.declaredMime).toBe("image/png");
  });

  it("takes the src out of an <img> however it was quoted", () => {
    for (const src of [`"${PNG_B64}"`, `'${PNG_B64}'`, PNG_B64]) {
      expect(expectImage(`<img src=${src}>`).source).toBe("img-tag");
    }
  });
});

// ── the four refusals ────────────────────────────────────────────

describe("decodeBase64Image — the refusals, each one distinct", () => {
  it("1. a data URI that is percent-encoded rather than Base64", () => {
    // No `;base64` marker: those characters are literal text, not bytes.
    expect(expectRefusal("data:image/svg+xml,%3Csvg%20/%3E").reason).toBe("percent-encoded");
    expect(expectRefusal("data:text/plain,hello").reason).toBe("percent-encoded");
    // A `data:` URI with no comma has no payload at all.
    expect(expectRefusal("data:image/png;base64").reason).toBe("percent-encoded");
  });

  it("2. characters that are not Base64 at all", () => {
    expect(expectRefusal("this is not base64!!").reason).toBe("not-base64");
    expect(expectRefusal("****").reason).toBe("not-base64");
  });

  it("3. a paste cut short — a length no whole Base64 string can have", () => {
    // Four characters carry three bytes; a trailing group of two or three
    // carries one or two. A group of exactly one cannot come from anything.
    expect(expectRefusal(PNG_B64.replace(/=+$/, "").slice(0, 9)).reason).toBe("truncated");
    expect(expectRefusal("QUJDRQ").reason).not.toBe("truncated"); // 6 chars: legal
  });

  it("4. valid Base64 whose bytes are not an image", () => {
    const refusal = expectRefusal(Buffer.from("just some text, honestly").toString("base64"));
    expect(refusal.reason).toBe("not-an-image");
    // The byte count is what tells the user their paste decoded and their
    // BYTES are the problem — a bare failure would not.
    expect(refusal.byteLength).toBe(24);
  });

  it("and an empty paste is its own case, not an error", () => {
    expect(expectRefusal("").reason).toBe("empty");
    expect(expectRefusal("   \n  ").reason).toBe("empty");
  });
});

// ── the ordering the original bug report is about ────────────────

describe("decodeBase64ToBytes", () => {
  it("strips whitespace BEFORE working out the padding", () => {
    /*
      The regression this ordering fixes. "SGVsbG8=" is 8 characters; wrapped
      as "SGVs\nbG8=" it is 9, and 9 % 4 === 1. Pad first and the string gets
      three extra "=" on the end of an already-complete payload; strip first
      and there is nothing to add. `atob` itself tolerates the newlines — it
      was the arithmetic that did not.
    */
    const wrapped = "SGVs\nbG8=";
    expect(wrapped.length % 4).toBe(1);
    expect(Buffer.from(decodeBase64ToBytes(wrapped)!).toString()).toBe("Hello");
  });

  it("accepts everything atob does, plus the two things it does not", () => {
    const decode = (s: string) => {
      const bytes = decodeBase64ToBytes(s);
      return bytes === null ? null : Buffer.from(bytes).toString();
    };
    expect(decode("SGVsbG8=")).toBe("Hello"); // plain
    expect(decode("SGVsbG8")).toBe("Hello"); // no padding
    expect(decode("  SGVsbG8=  ")).toBe("Hello"); // surrounding space
    expect(decode("SGVs\r\nbG8=")).toBe("Hello"); // CRLF
    expect(decode("SGVs\tbG8=")).toBe("Hello"); // tabs
    expect(decode("")).toBe(""); // empty is valid Base64
    expect(decode("PDw_Pz8-Pg")).toBe("<<???>>"); // URL-safe: atob throws on this
  });

  it("returns null rather than letting a DOMException reach a caller", () => {
    // `Base64EncodeDecodeUI` shows its own message; a raw
    // "InvalidCharacterError" must never be what a user reads.
    expect(decodeBase64ToBytes("not base64 !!!")).toBeNull();
    expect(() => decodeBase64ToBytes(" ")).not.toThrow();
  });
});

// ── the bytes decide, not the label ──────────────────────────────

describe("sniffImageFormat", () => {
  const cases: [string, number[], string, string][] = [
    ["PNG", [...PNG_BYTES], "png", "png"],
    ["JPEG", [...JPEG_BYTES], "jpeg", "jpg"],
    ["GIF", [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0], "gif", "gif"],
    ["BMP", [...bmpHeader(40)], "bmp", "bmp"],
    [
      "WebP",
      [0x52, 0x49, 0x46, 0x46, 0x1a, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20],
      "webp",
      "webp",
    ],
    ["ICO", [...icoHeader(1)], "ico", "ico"],
    [
      "AVIF",
      [0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0, 0, 0, 0],
      "avif",
      "avif",
    ],
    ["SVG", [...Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>', "latin1")], "svg", "svg"],
  ];

  for (const [label, bytes, id, ext] of cases) {
    it(`names ${label} from its magic bytes`, () => {
      expect(sniffImageFormat(new Uint8Array(bytes))).toMatchObject({ id, ext });
    });
  }

  it("finds an SVG root behind an XML declaration", () => {
    const withProlog = Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?>\n<!-- made earlier -->\n<svg viewBox="0 0 1 1"/>',
      "latin1",
    );
    expect(sniffImageFormat(new Uint8Array(withProlog))).toMatchObject({ id: "svg", markup: true });
  });

  it("marks SVG as markup and every raster as not", () => {
    // SVG is safe only when handed to an <img>; a caller with no <img> path
    // has to be able to tell, and `markup` is how.
    for (const [, bytes, id] of cases) {
      const format = sniffImageFormat(new Uint8Array(bytes))!;
      expect(format.markup, id).toBe(id === "svg");
    }
  });

  it("deliberately does not name HEIC or TIFF", () => {
    /*
      Both are images; neither can be drawn by an <img>, which is the only
      thing this tool does with the bytes. Naming them would promise a preview
      that never arrives — they are why `heic2any` and `utif2` exist in this
      app at all. Refusing them as "not a format this tool can name" is the
      honest answer, and it is what the UI's copy says.
    */
    const heic = [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0];
    const tiffLE = [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00];
    expect(sniffImageFormat(new Uint8Array(heic))).toBeNull();
    expect(sniffImageFormat(new Uint8Array(tiffLE))).toBeNull();
  });

  it("returns null rather than guessing", () => {
    expect(sniffImageFormat(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(sniffImageFormat(new Uint8Array(0))).toBeNull();
    expect(sniffImageFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBeNull(); // a zip
  });

  it("believes the bytes over the mediatype somebody typed", () => {
    // `data:image/png;base64,` in front of JPEG bytes is one of the commonest
    // pastes there is. The bytes win, and the disagreement is reported.
    const image = expectImage(`data:image/png;base64,${toBase64(JPEG_BYTES)}`);
    expect(image.format).toBe("jpeg");
    expect(image.ext).toBe("jpg");
    expect(image.mime).toBe("image/jpeg");
    expect(image.declaredMime).toBe("image/png");
  });
});

// ── the sniff is a signature test, not a prefix match ────────────

/*
  THE DEFECT THIS SECTION EXISTS FOR.

  `Base64ToImageUI` has exactly two failure sentences and picks between them on
  what `sniffImageFormat` returns:

    null      -> "That decoded cleanly into N of data, but the first bytes
                  match no image format this tool can name…"
    a format  -> the <img> is rendered, and if it fires onError the page says
                 "These bytes start with a valid image signature, but this
                  browser could not draw them. A paste that was cut short does
                  exactly that…"

  So a sniff that is not a signature test does not merely mislabel a download —
  it makes the page assert a signature nobody checked and blame a clipboard
  that was working fine. Three of these tests were prefix matches, and each one
  had a whole class of ordinary text behind it. Every case below is text a
  person could plausibly paste, and every one of them used to come back as an
  image.
*/
describe("sniffImageFormat — text that used to be called an image", () => {
  const notAnImage: [string, string][] = [
    ["a line starting BM", "BMW parts list, 2026 edition — every part number, sorted."],
    [
      "an HTML page with an inline icon",
      '<!doctype html><html><head><title>Invoice</title></head><body>' +
        '<svg width="16" height="16"><path d="M0 0h16v16H0z"/></svg>' +
        "<p>Total: 12.00</p></body></html>",
    ],
    ["a JS module with an icon in a string", `export const icon = '<svg viewBox="0 0 16 16"/>';`],
    ["a README that mentions the tag", "# Icons\n\nUse `<svg>` rather than a font.\n"],
    ["a sentence starting GIF8", "GIF8 was never a version — GIF87a and GIF89a are."],
    ["an HTML page with no doctype", "<html><body><svg/></body></html>"],
  ];

  for (const [label, text] of notAnImage) {
    it(`refuses ${label}`, () => {
      expect(sniffImageFormat(latin1(text))).toBeNull();
    });
  }

  it("and the UI therefore gets the honest message, not the signature one", () => {
    /*
      The end-to-end statement, because the refusal above is only worth
      anything if it reaches the user as the OTHER sentence. `not-an-image`
      carries the byte count, which is what `failureCopy` prints; the
      alternative was a page telling someone their invoice was a truncated SVG.
    */
    const html = notAnImage[1][1];
    const refusal = expectRefusal(Buffer.from(html, "latin1").toString("base64"));
    expect(refusal.reason).toBe("not-an-image");
    expect(refusal.byteLength).toBe(html.length);
  });
});

describe("sniffImageFormat — BMP is BM plus a DIB header that says its own length", () => {
  it("takes every DIB header size the format defines", () => {
    // BITMAPCOREHEADER 12, OS/2 16 and 64, BITMAPINFOHEADER 40, V2 52, V3 56,
    // V4 108, V5 124. A file from `sips` on this machine is a 40.
    for (const dib of [12, 16, 40, 52, 56, 64, 108, 124]) {
      expect(sniffImageFormat(new Uint8Array(bmpHeader(dib))), `DIB ${dib}`).toMatchObject({
        id: "bmp",
      });
    }
  });

  it("refuses BM followed by a length no DIB header has", () => {
    expect(sniffImageFormat(new Uint8Array(bmpHeader(41)))).toBeNull();
    expect(sniffImageFormat(new Uint8Array(bmpHeader(0)))).toBeNull();
  });

  it("refuses BM with nothing behind it — a real BMP is 26 bytes at minimum", () => {
    expect(sniffImageFormat(new Uint8Array([0x42, 0x4d, 0x36, 0, 0, 0, 0, 0]))).toBeNull();
  });

  it("does not care what the file-size field says, because encoders write zero there", () => {
    // Offset 2 is the only other fixed number in the header and it is not
    // trustworthy; the DIB length is. Both of these are bitmaps.
    expect(sniffImageFormat(new Uint8Array(bmpHeader(40, 0)))).toMatchObject({ id: "bmp" });
    expect(sniffImageFormat(new Uint8Array(bmpHeader(40, 999999)))).toMatchObject({ id: "bmp" });
  });
});

describe("sniffImageFormat — GIF is six bytes", () => {
  it("takes both versions the spec defines", () => {
    for (const version of ["GIF87a", "GIF89a"]) {
      expect(sniffImageFormat(latin1(`${version}\u0001\u0000`)), version).toMatchObject({
        id: "gif",
      });
    }
  });

  it("refuses a fourth-byte match with the wrong version", () => {
    // "GIF8" is what the sniff used to check. These are the strings that got
    // through it.
    expect(sniffImageFormat(latin1("GIF88a\u0001\u0000"))).toBeNull();
    expect(sniffImageFormat(latin1("GIF89b\u0001\u0000"))).toBeNull();
  });
});

describe("sniffImageFormat — an ICONDIR has to have its directory", () => {
  it("takes a real one, single or multi-entry, icon or cursor", () => {
    expect(sniffImageFormat(new Uint8Array(icoHeader(1)))).toMatchObject({ id: "ico" });
    expect(sniffImageFormat(new Uint8Array(icoHeader(6)))).toMatchObject({ id: "ico" });
    expect(sniffImageFormat(new Uint8Array(icoHeader(1, 2)))).toMatchObject({ id: "ico" }); // .cur
  });

  it("refuses four near-zero bytes with no directory behind them", () => {
    // The old test was those four bytes alone, which is a pattern arbitrary
    // binary hits. A directory of N entries is 16N bytes and has to be there.
    expect(sniffImageFormat(new Uint8Array([0, 0, 1, 0]))).toBeNull();
    expect(sniffImageFormat(new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16]))).toBeNull();
    expect(sniffImageFormat(new Uint8Array([0, 0, 1, 0, 0, 0]))).toBeNull(); // count 0
  });

  it("does not take an ISO-BMFF file whose first box happens to be 256 bytes", () => {
    /*
      `00 00 01 00` is an ICONDIR header AND a big-endian box length of 256, so
      the two tests genuinely collide and the ORDER decides. The container test
      runs first; without that, this HEIC would be offered for download as
      `image.ico`. The buffer is sized so the count check alone would not save
      it: bytes 4-5 read as an entry count of 0x7466, which needs 476,774 bytes
      of directory, and this file has them.
    */
    const heic = new Uint8Array(6 + 0x7466 * 16);
    heic.set([0, 0, 1, 0, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
    expect(sniffImageFormat(heic)).toBeNull();
  });
});

describe("sniffImageFormat — the SVG root element, not the substring", () => {
  const svgCases: [string, string][] = [
    ["a bare root", '<svg viewBox="0 0 1 1"/>'],
    ["leading whitespace", '\n\n   <svg xmlns="http://www.w3.org/2000/svg"/>'],
    ["an XML declaration", '<?xml version="1.0" encoding="UTF-8"?><svg/>'],
    [
      "a stylesheet PI and a comment",
      '<?xml version="1.0"?><?xml-stylesheet href="a.css"?><!-- drawn by hand --><svg/>',
    ],
    [
      "the SVG 1.1 DOCTYPE",
      '<?xml version="1.0"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" ' +
        '"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg version="1.1"/>',
    ],
    [
      "a DOCTYPE with an internal subset, whose > is not the end of it",
      '<!DOCTYPE svg [<!ENTITY ns "http://www.w3.org/2000/svg">]>\n<svg/>',
    ],
    ["a UTF-8 BOM", "\u00ef\u00bb\u00bf<svg/>"],
  ];

  for (const [label, text] of svgCases) {
    it(`finds the root behind ${label}`, () => {
      expect(sniffImageFormat(latin1(text))).toMatchObject({ id: "svg", markup: true });
    });
  }

  it("reads a kilobyte in, because a real export's prolog is longer than 256 bytes", () => {
    /*
      An Illustrator file opens with an XML declaration, the 110-character SVG
      1.1 DOCTYPE and a generator comment, and its root element can sit past
      byte 256. The old 256-byte window was a limit the substring search could
      not safely have raised; an anchored walk can, because everything it steps
      over has to be XML prolog rather than arbitrary text.
    */
    const prolog =
      '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" ' +
      '"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n' +
      "<!-- Generator: Adobe Illustrator 24.0.1, SVG Export Plug-In . " +
      "SVG Version: 6.00 Build 0)  Exported for the web, do not edit by hand -->\n";
    expect(prolog.length).toBeGreaterThan(256);
    expect(sniffImageFormat(latin1(`${prolog}<svg version="1.1"/>`))).toMatchObject({ id: "svg" });
  });

  it("stops at the first element that is not svg", () => {
    // The walk skips prolog, not markup: once a real element opens, the answer
    // is settled by that element's name.
    expect(sniffImageFormat(latin1('<!doctype html>\n<html><svg/></html>'))).toBeNull();
    expect(sniffImageFormat(latin1('<?xml version="1.0"?><rss><item>&lt;svg&gt;</item></rss>'))).toBeNull();
  });

  it("will not take an element that merely starts with those three letters", () => {
    expect(sniffImageFormat(latin1("<svgx/>"))).toBeNull();
    expect(sniffImageFormat(latin1("<svg/>"))).toMatchObject({ id: "svg" });
    expect(sniffImageFormat(latin1("<SVG >"))).toMatchObject({ id: "svg" });
  });

  it("refuses a prolog that never closes, rather than scanning past it", () => {
    // An unterminated comment or PI means the head is not XML at all. It is
    // also how a search would have been fooled: the `<svg` here is inside it.
    expect(sniffImageFormat(latin1("<!-- todo: <svg/> "))).toBeNull();
    expect(sniffImageFormat(latin1('<?php echo "<svg/>"; '))).toBeNull();
  });
});
