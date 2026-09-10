import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as bwip from "bwip-js/generic";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import {
  barcodeFileName,
  bwipOptions,
  checkBarcodeColors,
  checkBarcodeInput,
  cleanEngineError,
  code39CheckChar,
  ean13Equivalent,
  expandUpceBody,
  getSymbology,
  gs1CheckDigit,
  hasBlockingIssue,
  normaliseInput,
  readViewBox,
  relativeLuminance,
  renderBarcodeSvg,
  scannedValue,
  svgDataUrl,
  svgWithPixelSize,
  SYMBOLOGIES,
  type BarcodeRequest,
  type SymbologyId,
} from "@/lib/tools/barcode";

/*
  ────────────────────────────────────────────────────────────────────────
  Why this file decodes its own output.

  Every other assertion available here is a proxy. "The SVG is 615 bytes" and
  "there are 30 <path> elements" both pass for a barcode that scans to the
  wrong number, and a barcode that scans to the wrong number is the only defect
  this tool can ship that matters. So the core of this file rasterises what the
  page will actually draw and reads it back with zxing-cpp — a completely
  independent implementation, compiled from C++, which knows nothing about
  BWIPP — and asserts that the string that comes out is the string that went
  in, or, where the symbology transforms it, the string `scannedValue`
  predicted.

  The rasteriser below is not an approximation. It replicates the integer
  geometry of bwip-js's own `drawing-builtin.js` line by line, including the
  detail that costs the most to get wrong: every polygon between two `fill()`
  calls is one even-odd region, which is what puts the white ring inside a QR
  finder pattern. Filling each polygon separately produces solid black finder
  squares and a code nothing can read — the first version of this file did
  exactly that, and zxing rejecting it is how the bug was found.
  ────────────────────────────────────────────────────────────────────────
*/

interface Grid {
  width: number;
  height: number;
  pixels: Uint8Array;
}

function rasterModules(options: Record<string, unknown>): Grid {
  let width = 0;
  let height = 0;
  let pixels = new Uint8Array(0);
  let pending: [number, number][][] = [];

  const set = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < width && y < height) pixels[y * width + x] = 1;
  };

  const flush = () => {
    if (pending.length === 0) return;
    let top = Infinity;
    let bottom = -Infinity;
    for (const polygon of pending) {
      for (const [, y] of polygon) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    for (let y = top; y < bottom; y++) {
      const centre = y + 0.5;
      const crossings: number[] = [];
      for (const polygon of pending) {
        for (let i = 0; i < polygon.length; i++) {
          const [ax, ay] = polygon[i];
          const [bx, by] = polygon[(i + 1) % polygon.length];
          if ((ay <= centre && by > centre) || (by <= centre && ay > centre)) {
            crossings.push(ax + ((centre - ay) / (by - ay)) * (bx - ax));
          }
        }
      }
      crossings.sort((a, b) => a - b);
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        for (let x = Math.round(crossings[i]); x < Math.round(crossings[i + 1]); x++) set(x, y);
      }
    }
    pending = [];
  };

  const drawing = {
    scale: () => null,
    measure: () => ({ width: 0, ascent: 0, descent: 0 }),
    init(w: number, h: number) {
      width = w;
      height = h;
      pixels = new Uint8Array(w * h);
    },
    // drawing-builtin.js: a vertical bar of width `lw` centred on x takes the
    // "big half" to the left and the "small half" to the right.
    line(x0: number, y0: number, x1: number, y1: number, lw: number) {
      let ax = x0 | 0;
      let ay = y0 | 0;
      let bx = x1 | 0;
      let by = y1 | 0;
      const w = Math.round(lw) || 1;
      if (by < ay) [ay, by] = [by, ay];
      if (bx < ax) [ax, bx] = [bx, ax];
      const half = (w / 2) | 0;
      if (ax === bx) {
        ax = ax - w + half;
        bx = bx + half - 1;
      } else {
        ay = ay - half;
        by = by + w - half - 1;
      }
      for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) set(x, y);
    },
    polygon(points: [number, number][]) {
      pending.push(points);
    },
    hexagon(points: [number, number][]) {
      pending.push(points);
    },
    ellipse() {},
    fill() {
      flush();
    },
    text() {},
    end() {
      flush();
      return { width, height, pixels };
    },
  };

  return bwip.render({ ...options, scale: 1 } as never, drawing as never) as unknown as Grid;
}

const channels = (hex: string): [number, number, number] =>
  [1, 3, 5].map((_, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)) as [number, number, number];

/**
 * An ImageData-shaped RGBA buffer with a quiet zone no scanner can complain
 * about.
 *
 * The two colours default to the black-on-white the rest of this file uses.
 * They are real parameters rather than a constant because `checkBarcodeColors`
 * makes claims about what a reader does with a pale or an inverted symbol, and
 * a claim about a decode has to be settled by a decode. The quiet zone takes
 * the BACKGROUND colour, which is what the page draws: the SVG carries a
 * full-bleed background rect.
 */
function toImageData(grid: Grid, foreground = "#000000", background = "#ffffff", scale = 6, quietModules = 12) {
  const [fr, fg, fb] = channels(foreground);
  const [br, bg, bb] = channels(background);
  const quiet = quietModules * scale;
  const width = grid.width * scale + quiet * 2;
  const height = grid.height * scale + quiet * 2;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = br;
    data[i * 4 + 1] = bg;
    data[i * 4 + 2] = bb;
    data[i * 4 + 3] = 255;
  }
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (!grid.pixels[y * grid.width + x]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const offset = ((quiet + y * scale + dy) * width + (quiet + x * scale + dx)) * 4;
          data[offset] = fr;
          data[offset + 1] = fg;
          data[offset + 2] = fb;
        }
      }
    }
  }
  return { data, width, height };
}

/** Everything zxing-cpp finds in the drawn symbol, as [format, text] pairs. */
async function decode(
  options: Record<string, unknown>,
  colors?: { foreground: string; background: string },
): Promise<[string, string][]> {
  // A plain {data,width,height} is what zxing-wasm reads off an ImageData;
  // jsdom has no canvas to produce a real one, and the wasm never looks at the
  // prototype.
  const image = toImageData(
    rasterModules(options),
    colors?.foreground,
    colors?.background,
  ) as unknown as ImageData;
  // `tryInvert` is on explicitly: the inverted-colour error message claims
  // this reader found nothing "even with its invert pass on", and a default
  // that quietly flipped would make that claim untestable.
  const results = await readBarcodes(image, { tryHarder: true, tryInvert: true });
  return results.map((result) => [result.format, result.text]);
}

const request = (over: Partial<BarcodeRequest> = {}): BarcodeRequest => ({
  symbology: "code128",
  text: "ABC-123",
  scale: 3,
  barHeight: 12,
  includeText: false,
  includeCheckDigit: false,
  foreground: "#000000",
  background: "#ffffff",
  ...over,
});

beforeAll(async () => {
  /*
    The reader wasm is handed over as bytes. zxing-wasm's default is to build a
    jsDelivr URL and fetch it, which is exactly the arrangement this site
    exists to avoid; passing `wasmBinary` means no URL is ever constructed, and
    the test therefore also proves that override works.
  */
  const wasmPath = resolve(
    process.cwd(),
    "node_modules/zxing-wasm/dist/reader/zxing_reader.wasm",
  );
  const bytes = readFileSync(wasmPath);
  await prepareZXingModule({
    overrides: {
      wasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    },
    fireImmediately: true,
  });
}, 60_000);

describe("gs1CheckDigit", () => {
  it("weights from the RIGHT, so odd- and even-length bodies both come out right", () => {
    // Weighting from the left agrees with this only for even-length bodies —
    // ean8 and upca below are the odd-length cases that catch it.
    expect(gs1CheckDigit("590123412345")).toBe(7); // EAN-13, 12 digits
    expect(gs1CheckDigit("9520000")).toBe(2); // EAN-8, 7 digits
    expect(gs1CheckDigit("01234500005")).toBe(8); // UPC-A, 11 digits
    expect(gs1CheckDigit("0952123454321")).toBe(3); // ITF-14, 13 digits
  });

  it("returns 0 rather than 10 when the sum lands on a multiple of ten", () => {
    expect(gs1CheckDigit("000000000000")).toBe(0);
  });
});

describe("code39CheckChar", () => {
  it("is the modulo-43 sum over Code 39's own alphabet", () => {
    // A=10 B=11 C=12 1=1 2=2 3=3 → 39 → "$"
    expect(code39CheckChar("ABC123")).toBe("$");
    expect(code39CheckChar("A")).toBe("A");
  });

  it("refuses a string with a character Code 39 does not have", () => {
    expect(code39CheckChar("abc")).toBeNull();
  });
});

describe("expandUpceBody", () => {
  it("covers all five substitution rules", () => {
    expect(expandUpceBody("0123430")).toBe("01200000343"); // last digit 0
    expect(expandUpceBody("0425261")).toBe("04210000526"); // last digit 1
    expect(expandUpceBody("0123432")).toBe("01220000343"); // last digit 2
    expect(expandUpceBody("0123433")).toBe("01230000043"); // last digit 3
    expect(expandUpceBody("0123434")).toBe("01234000003"); // last digit 4
    expect(expandUpceBody("0123456")).toBe("01234500006"); // last digit 5-9
  });

  it("always produces eleven digits", () => {
    for (let last = 0; last <= 9; last++) {
      expect(expandUpceBody(`012345${last}`)).toHaveLength(11);
    }
  });

  it("refuses a number system other than 0 or 1", () => {
    expect(expandUpceBody("2123456")).toBeNull();
    expect(expandUpceBody("9123456")).toBeNull();
    expect(expandUpceBody("112345")).toBeNull();
  });
});

describe("scannedValue", () => {
  it("appends the computed check digit to a short retail number", () => {
    expect(scannedValue("ean13", "590123412345")).toBe("5901234123457");
    expect(scannedValue("ean8", "9520000")).toBe("95200002");
    expect(scannedValue("upca", "01234500005")).toBe("012345000058");
    expect(scannedValue("itf14", "0952123454321")).toBe("09521234543213");
  });

  it("keeps a correct check digit that was supplied", () => {
    expect(scannedValue("ean13", "5901234123457")).toBe("5901234123457");
  });

  it("reports the UPC-A a UPC-E expands to, not the seven digits typed", () => {
    expect(scannedValue("upce", "0123456")).toBe("012345000065");
    expect(scannedValue("upce", "01234565")).toBe("012345000065");
  });

  it("ignores the spaces in an ITF-14, because the encoder does", () => {
    expect(scannedValue("itf14", "0 952 1234 54321")).toBe("09521234543213");
  });

  it("adds Code 39's check character only when it is switched on", () => {
    expect(scannedValue("code39", "ABC123", false)).toBe("ABC123");
    expect(scannedValue("code39", "ABC123", true)).toBe("ABC123$");
  });

  it("is null when it cannot say", () => {
    expect(scannedValue("ean13", "59012")).toBeNull();
    expect(scannedValue("ean13", "59012341234X")).toBeNull();
    expect(scannedValue("qrcode", "")).toBeNull();
  });
});

describe("ean13Equivalent", () => {
  /*
    The second form the page prints. `scannedValue` returns the twelve digits
    printed under a UPC-A's bars; a software reader hands back the same article
    number as a thirteen-digit EAN-13. Showing one and calling the block "what
    a scanner reads back" is wrong for whichever reader the user is holding, so
    both are shown and both are asserted here — the thirteen-digit one against
    a real decode further down.
  */
  it("prepends the zero UPC-A never prints", () => {
    expect(ean13Equivalent("upca", "01234500005")).toBe("0012345000058");
    expect(ean13Equivalent("upca", "012345000058")).toBe("0012345000058");
  });

  it("gives a UPC-E the same thirteen digits, via its UPC-A expansion", () => {
    expect(ean13Equivalent("upce", "0123456")).toBe("0012345000065");
    expect(ean13Equivalent("upce", "01234565")).toBe("0012345000065");
  });

  it("is always exactly one digit longer than the printed number", () => {
    for (const typed of ["01234500005", "012345000058"]) {
      expect(ean13Equivalent("upca", typed)).toHaveLength(13);
      expect(ean13Equivalent("upca", typed)).toBe(`0${scannedValue("upca", typed)}`);
    }
  });

  it("has nothing to add for a symbology that is not a UPC", () => {
    // EAN-13 already IS thirteen digits, and a second line saying so would be
    // noise on every retail code the page draws.
    for (const symbology of SYMBOLOGIES) {
      if (symbology.id === "upca" || symbology.id === "upce") continue;
      expect(ean13Equivalent(symbology.id, symbology.placeholder)).toBeNull();
    }
  });

  it("is null wherever scannedValue is, rather than printing a bare zero", () => {
    expect(ean13Equivalent("upca", "12345")).toBeNull();
    expect(ean13Equivalent("upca", "")).toBeNull();
    expect(ean13Equivalent("upce", "2123456")).toBeNull();
  });
});

describe("checkBarcodeInput", () => {
  const errorIds = (id: SymbologyId, text: string, check = false) =>
    checkBarcodeInput(id, text, check)
      .filter((issue) => issue.level === "error")
      .map((issue) => issue.id);

  it("blocks an empty input for every symbology", () => {
    for (const symbology of SYMBOLOGIES) {
      expect(errorIds(symbology.id, "")).toEqual(["empty"]);
    }
  });

  it("states the length rule each numeric symbology actually has", () => {
    expect(errorIds("ean13", "12345")).toEqual(["length"]);
    expect(errorIds("ean8", "952000")).toEqual(["length"]);
    expect(errorIds("upca", "12345")).toEqual(["length"]);
    expect(errorIds("upce", "012345")).toEqual(["length"]);
    expect(errorIds("itf14", "1234")).toEqual(["length"]);
    expect(checkBarcodeInput("ean13", "12345")[0].message).toContain("12 or 13 digits");
    expect(checkBarcodeInput("upca", "12345")[0].message).toContain("11 or 12 digits");
    expect(checkBarcodeInput("itf14", "1234")[0].message).toContain("13 or 14 digits");
  });

  it("rejects a wrong check digit instead of drawing a code for a different product", () => {
    expect(errorIds("ean13", "5901234123450")).toEqual(["check-digit"]);
    expect(errorIds("ean8", "95200001")).toEqual(["check-digit"]);
    expect(errorIds("upca", "012345000051")).toEqual(["check-digit"]);
    expect(errorIds("itf14", "09521234543210")).toEqual(["check-digit"]);
    expect(errorIds("upce", "01234567")).toEqual(["check-digit"]);
    // The message has to name the right digit, or it is just an accusation.
    expect(checkBarcodeInput("ean13", "5901234123450")[0].message).toContain("checks to 7");
  });

  it("names the UPC-E number-system rule rather than reporting a length problem", () => {
    expect(errorIds("upce", "2123456")).toEqual(["upce-system"]);
  });

  it("refuses non-digits in a numeric symbology and points somewhere useful", () => {
    expect(errorIds("ean13", "59012341234X")).toEqual(["digits"]);
    expect(checkBarcodeInput("ean13", "59012341234X")[0].message).toContain("Code 128");
  });

  it("refuses lower case in Code 39 with the fix in the message", () => {
    const issue = checkBarcodeInput("code39", "part-1024")[0];
    expect(issue.level).toBe("error");
    expect(issue.message).toContain("PART-1024");
  });

  it("refuses non-ASCII in a linear symbology — it would scan back as mojibake", () => {
    expect(errorIds("code128", "café")).toEqual(["non-ascii"]);
    // Code 39 rejects it one step earlier: its 43-character alphabet has no
    // room for an accent at all, so the charset message is the useful one.
    expect(errorIds("code39", "CAFÉ")).toEqual(["code39-charset"]);
    // The matrix symbologies declare their encoding and are fine.
    expect(errorIds("qrcode", "Ünïcodé ✓ 日本")).toEqual([]);
    expect(errorIds("datamatrix", "Ünïcodé ✓ 日本")).toEqual([]);
  });

  it("warns without blocking where the code will be encoded faithfully", () => {
    const control = checkBarcodeInput("code128", "A\nB");
    expect(hasBlockingIssue(control)).toBe(false);
    expect(control.map((i) => i.id)).toEqual(["control-chars"]);
    expect(control[0].message).toContain("newline");

    const spaced = checkBarcodeInput("code128", " AB ");
    expect(hasBlockingIssue(spaced)).toBe(false);
    expect(spaced.map((i) => i.id)).toEqual(["surrounding-space"]);

    const grouped = checkBarcodeInput("itf14", "0 952 1234 54321");
    expect(hasBlockingIssue(grouped)).toBe(false);
    expect(grouped.map((i) => i.id)).toEqual(["itf14-spaces"]);

    const checked = checkBarcodeInput("code39", "ABC123", true);
    expect(hasBlockingIssue(checked)).toBe(false);
    expect(checked[0].message).toContain("ABC123$");
  });

  it("accepts every symbology's own documented example", () => {
    for (const symbology of SYMBOLOGIES) {
      expect(hasBlockingIssue(checkBarcodeInput(symbology.id, symbology.placeholder))).toBe(false);
    }
  });
});

describe("checkBarcodeInput agrees with BWIPP", () => {
  /*
    The pre-flight is a convenience; BWIPP is the authority. If the two ever
    disagree the page either blocks something that would have worked or lets
    through something that fails with an engine error the user cannot act on.
    This walks a table of inputs past both.

    The one deliberate divergence is listed rather than hidden: BWIPP encodes
    non-ASCII in Code 128 and Code 39 without complaint, and the result scans
    back as mojibake (proved further down), so the pre-flight is stricter there
    on purpose.
  */
  const CASES: [SymbologyId, string][] = [
    ["code128", "ABC-123"],
    ["code128", ""],
    ["code39", "PART-1024"],
    ["code39", "part-1024"],
    ["code39", "A@B"],
    ["code39", "CAFÉ"],
    ["ean13", "590123412345"],
    ["ean13", "5901234123457"],
    ["ean13", "5901234123450"],
    ["ean13", "12345"],
    ["ean13", "59012341234X"],
    ["ean8", "9520000"],
    ["ean8", "95200002"],
    ["ean8", "95200001"],
    ["ean8", "952000"],
    ["upca", "01234500005"],
    ["upca", "012345000058"],
    ["upca", "012345000051"],
    ["upce", "0123456"],
    ["upce", "01234565"],
    ["upce", "01234567"],
    ["upce", "2123456"],
    ["upce", "012345"],
    ["itf14", "0952123454321"],
    ["itf14", "09521234543213"],
    ["itf14", "09521234543210"],
    ["itf14", "0 952 1234 54321 3"],
    ["qrcode", "https://example.com"],
    ["datamatrix", "LOT-88421"],
    ["pdf417", "PDF417 payload"],
    ["azteccode", "Aztec payload"],
  ];

  const DELIBERATELY_STRICTER: [SymbologyId, string][] = [
    ["code128", "café"],
    ["code128", "🎉"],
  ];

  it.each(CASES)("%s / %j", async (id, text) => {
    const blocked = hasBlockingIssue(checkBarcodeInput(id, text));
    let engineAccepted = true;
    try {
      await renderBarcodeSvg(request({ symbology: id, text }));
    } catch {
      engineAccepted = false;
    }
    expect(blocked).toBe(!engineAccepted);
  });

  it.each(DELIBERATELY_STRICTER)("is stricter than BWIPP for %s / %j", async (id, text) => {
    expect(hasBlockingIssue(checkBarcodeInput(id, text))).toBe(true);
    await expect(renderBarcodeSvg(request({ symbology: id, text }))).resolves.toBeTruthy();
  });
});

describe("bwipOptions", () => {
  it("never sends a bar height to a matrix symbology", () => {
    // `height` stretches a QR code into a rectangle, and a stretched QR code
    // does not decode. Every matrix symbology has to be exempt, not just QR.
    for (const symbology of SYMBOLOGIES.filter((s) => s.kind === "matrix")) {
      expect(bwipOptions(request({ symbology: symbology.id }))).not.toHaveProperty("height");
    }
    for (const symbology of SYMBOLOGIES.filter((s) => s.kind === "linear")) {
      expect(bwipOptions(request({ symbology: symbology.id, barHeight: 17 }))).toMatchObject({
        height: 17,
      });
    }
  });

  it("only sends an option the symbology implements", () => {
    expect(bwipOptions(request({ symbology: "qrcode", includeText: true }))).not.toHaveProperty(
      "includetext",
    );
    expect(bwipOptions(request({ symbology: "code128", includeText: true }))).toMatchObject({
      includetext: true,
    });
    expect(
      bwipOptions(request({ symbology: "ean13", text: "590123412345", includeCheckDigit: true })),
    ).not.toHaveProperty("includecheck");
    expect(bwipOptions(request({ symbology: "code39", includeCheckDigit: true }))).toMatchObject({
      includecheck: true,
    });
  });

  it("prints the check character whenever it prints the text at all", () => {
    // Encoded but not printed means the line under the bars and the scanned
    // string differ by one character with nothing to explain it.
    expect(
      bwipOptions(request({ symbology: "code39", includeCheckDigit: true, includeText: true })),
    ).toMatchObject({ includecheck: true, includecheckintext: true });
  });

  it("gives every code a quiet zone", () => {
    expect(bwipOptions(request({ symbology: "qrcode" }))).toMatchObject({
      paddingwidth: 8,
      paddingheight: 8,
    });
    expect(bwipOptions(request({ symbology: "ean13", text: "590123412345" }))).toMatchObject({
      paddingwidth: 10,
    });
  });

  it("strips the # from colours and passes the text colour with the bars", () => {
    expect(bwipOptions(request({ foreground: "#1a1a1a", background: "#fafafa" }))).toMatchObject({
      barcolor: "1A1A1A",
      textcolor: "1A1A1A",
      backgroundcolor: "FAFAFA",
    });
  });
});

describe("renderBarcodeSvg", () => {
  it("returns a self-contained SVG — no font, no image, no external anything", async () => {
    // The human-readable line is glyph OUTLINES pulled from a font compiled
    // into the library, not a <text> element, so the file renders the same
    // wherever it is opened and needs nothing fetched.
    const { svg } = await renderBarcodeSvg(
      request({ symbology: "ean13", text: "590123412345", includeText: true }),
    );
    expect(svg).not.toMatch(/<text|font-family|<image|xlink:href|url\(/);
    expect([...new Set(svg.match(/<[a-z]+/g) ?? [])].sort()).toEqual(["<path", "<rect", "<svg"]);
  });

  it("reports the pixel size it drew, and writes it into the markup", async () => {
    const result = await renderBarcodeSvg(request({ symbology: "qrcode", text: "HELLO", scale: 4 }));
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBe(result.width); // a QR code is square
    expect(result.svg.startsWith(`<svg width="${result.width}" height="${result.height}" `)).toBe(
      true,
    );
  });

  it("scales linearly, so the size shown on the page is the size saved", async () => {
    const small = await renderBarcodeSvg(request({ symbology: "qrcode", text: "HELLO", scale: 2 }));
    const large = await renderBarcodeSvg(request({ symbology: "qrcode", text: "HELLO", scale: 6 }));
    expect(large.width).toBe(small.width * 3);
  });

  it("throws BWIPP's own sentence, without its internal tag", async () => {
    await expect(
      renderBarcodeSvg(request({ symbology: "ean13", text: "12345" })),
    ).rejects.toThrow("EAN-13 must be 12 or 13 digits");
    await expect(
      renderBarcodeSvg(request({ symbology: "ean13", text: "12345" })),
    ).rejects.not.toThrow(/bwipp\./);
  });

  it("paints the background as a rect, so the PNG is not transparent", async () => {
    const { svg } = await renderBarcodeSvg(request({ background: "#ffffff" }));
    expect(svg).toContain('<rect width="100%" height="100%" fill="#FFFFFF" />');
  });
});

describe("cleanEngineError", () => {
  it("drops the internal identifier and keeps BWIPP's sentence verbatim", () => {
    expect(cleanEngineError("bwipp.ean13badLength#6878: EAN-13 must be 12 or 13 digits")).toBe(
      "EAN-13 must be 12 or 13 digits.",
    );
  });

  it("turns the engine's empty-input crash into an instruction", () => {
    expect(cleanEngineError("bwip-js: bar code text not specified.")).toBe(
      "Enter the text or number to encode.",
    );
  });

  it("leaves an already-punctuated message alone", () => {
    expect(cleanEngineError("Something went wrong!")).toBe("Something went wrong!");
  });
});

describe("SVG helpers", () => {
  it("reads the viewBox bwip-js writes", () => {
    expect(readViewBox('<svg viewBox="0 0 402 109" xmlns="x">')).toEqual({
      width: 402,
      height: 109,
    });
    expect(readViewBox("<svg>")).toBeNull();
  });

  it("adds intrinsic dimensions without disturbing the rest of the tag", () => {
    expect(svgWithPixelSize('<svg viewBox="0 0 4 2" xmlns="x"></svg>', 4, 2)).toBe(
      '<svg width="4" height="2" viewBox="0 0 4 2" xmlns="x"></svg>',
    );
  });

  it("percent-encodes the characters that would break a data URL", () => {
    const url = svgDataUrl('<svg viewBox="0 0 1 1"><path d="M0 1L1 1"/></svg>');
    expect(url.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(url).not.toContain("#");
    expect(decodeURIComponent(url.split(",")[1])).toContain("<svg");
  });
});

describe("barcodeFileName", () => {
  it("names the symbology and the payload", () => {
    expect(barcodeFileName("ean13", "590123412345", "svg")).toBe("ean-13-590123412345.svg");
    expect(barcodeFileName("qrcode", "https://example.com", "png")).toBe(
      "qr-code-https-example.com.png",
    );
  });

  it("falls back to the symbology alone when the payload leaves nothing usable", () => {
    expect(barcodeFileName("qrcode", "→←", "svg")).toBe("qr-code.svg");
  });

  it("does not put a 500-character QR payload into a file name", () => {
    expect(barcodeFileName("qrcode", "x".repeat(500), "png").length).toBeLessThan(60);
  });
});

describe("normaliseInput", () => {
  it("strips spaces for ITF-14 only, matching the encoder", () => {
    expect(normaliseInput("itf14", "0 952 1234 54321")).toBe("0952123454321");
    expect(normaliseInput("code128", "A B")).toBe("A B");
  });
});

describe("SYMBOLOGIES", () => {
  it("declares the human-readable-text option exactly where BWIPP has one", () => {
    // Read off each symbology's own option block in bwipp.js, not guessed:
    // a checkbox on a symbology that ignores it is a control that does nothing.
    const withText = SYMBOLOGIES.filter((s) => s.supportsText).map((s) => s.id);
    expect(withText).toEqual(["code128", "code39", "ean13", "ean8", "upca", "upce", "itf14"]);
    const withCheck = SYMBOLOGIES.filter((s) => s.supportsCheckDigit).map((s) => s.id);
    expect(withCheck).toEqual(["code39"]);
  });

  it("has a unique, resolvable id for each entry", () => {
    const ids = SYMBOLOGIES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(getSymbology(id).id).toBe(id);
  });
});

/*
  ── The round trip ───────────────────────────────────────────────────
  Draw it, then read it back with an independent decoder.
*/
describe("round trip through zxing-cpp", () => {
  const CASES: [SymbologyId, string, string, string][] = [
    ["code128", "ABC-123", "Code128", "ABC-123"],
    ["code39", "CODE39TEST", "Code39", "CODE39TEST"],
    ["ean13", "5901234123457", "EAN13", "5901234123457"],
    // 12 digits in: the check digit is computed, and this is the assertion
    // that it is computed CORRECTLY rather than merely computed.
    ["ean13", "590123412345", "EAN13", "5901234123457"],
    ["ean8", "9520000", "EAN8", "95200002"],
    ["itf14", "0952123454321", "ITF", "09521234543213"],
    ["qrcode", "HELLO ROUND TRIP", "QRCode", "HELLO ROUND TRIP"],
    ["datamatrix", "DM-TEST-42", "DataMatrix", "DM-TEST-42"],
    ["pdf417", "PDF417 TEST", "PDF417", "PDF417 TEST"],
    ["azteccode", "AZ-TEST", "Aztec", "AZ-TEST"],
  ];

  it.each(CASES)("%s / %s decodes as %s", async (id, text, format, expected) => {
    expect(await decode(bwipOptions(request({ symbology: id, text })))).toEqual([
      [format, expected],
    ]);
  });

  it("agrees with scannedValue on every case above", () => {
    for (const [id, text, , expected] of CASES) {
      const predicted = scannedValue(id, text);
      // UPC-A and UPC-E are checked separately below, because a scanner adds
      // an EAN-13 leading zero that `scannedValue` deliberately does not.
      expect(predicted).toBe(expected);
    }
  });

  it("reports a UPC-A as the EAN-13 it also is, which is the SECOND line the page prints", async () => {
    /*
      Not a bug and not a surprise to anyone in retail: UPC-A is the subset of
      EAN-13 whose first digit is 0. The page therefore prints two values, and
      this is the assertion that binds the one on the second line to what a
      real reader actually returns. `scannedValue` alone would leave the page
      showing twelve digits under a heading that says "what a scanner reads
      back" while this decoder returns thirteen.
    */
    const decoded = await decode(bwipOptions(request({ symbology: "upca", text: "01234500005" })));
    expect(decoded).toEqual([["EAN13", "0012345000058"]]);
    expect(decoded[0][1]).toBe(ean13Equivalent("upca", "01234500005"));
    expect(decoded[0][1]).not.toBe(scannedValue("upca", "01234500005"));
  });

  it("expands a UPC-E exactly as scannedValue predicts, and its EAN-13 form as ean13Equivalent does", async () => {
    // One payload per substitution rule, so no branch of the table is
    // asserted only against my own arithmetic.
    for (const typed of ["0123430", "0425261", "0123432", "0123433", "0123434", "1234567"]) {
      const decoded = await decode(bwipOptions(request({ symbology: "upce", text: typed })));
      expect(decoded[0][0]).toBe("UPCE");
      expect(decoded[0][1]).toBe(`0${scannedValue("upce", typed)}`);
      expect(decoded[0][1]).toBe(ean13Equivalent("upce", typed));
    }
  });

  it("carries Code 39's optional check character into the scanned string", async () => {
    expect(
      await decode(
        bwipOptions(request({ symbology: "code39", text: "ABC123", includeCheckDigit: true })),
      ),
    ).toEqual([["Code39", "ABC123$"]]);
    expect(scannedValue("code39", "ABC123", true)).toBe("ABC123$");
  });

  it("round-trips Japanese and emoji through every matrix symbology", async () => {
    const payload = "Ünïcodé ✓ 日本";
    for (const id of ["qrcode", "datamatrix", "azteccode", "pdf417"] as const) {
      const decoded = await decode(bwipOptions(request({ symbology: id, text: payload })));
      expect(decoded[0][1]).toBe(payload);
    }
  });

  it("PROVES why non-ASCII is refused on a linear symbology", async () => {
    /*
      This is the finding the `non-ascii` error exists for. BWIPP accepts the
      input and draws a code; bwip-js writes the string's UTF-8 bytes; Code 128
      is defined over Latin-1, so a compliant reader hands back mojibake. The
      barcode is not corrupt — it is a perfectly good barcode for the wrong
      string, which is the worst thing this page could produce.
    */
    expect(await decode({ bcid: "code128", text: "héllo", height: 12 })).toEqual([
      ["Code128", "hÃ©llo"],
    ]);
    // 🎉 is the four UTF-8 bytes F0 9F 8E 89, read straight back as Latin-1.
    expect(await decode({ bcid: "code128", text: "🎉", height: 12 })).toEqual([
      ["Code128", "\u00f0\u009f\u008e\u0089"],
    ]);
    expect(hasBlockingIssue(checkBarcodeInput("code128", "héllo"))).toBe(true);
  });
});


/*
  ── The numbers in the notes ─────────────────────────────────────────
  The module docstring says every figure quoted in a `note` was measured
  against the shipped engine. This is where that is true or not: each one is
  driven at the boundary, so a bwip-js upgrade that moves a ceiling fails here
  instead of turning the line under the picker into a polite lie.
*/
describe("the capacity every note quotes", () => {
  const accepts = (id: SymbologyId, text: string) =>
    renderBarcodeSvg(request({ symbology: id, text })).then(
      () => true,
      () => false,
    );

  it("holds Code 128 and Code 39 to exactly the 500 characters their notes claim", async () => {
    for (const id of ["code128", "code39"] as const) {
      expect(getSymbology(id).note).toContain("up to 500 characters");
      expect(await accepts(id, "A".repeat(500))).toBe(true);
      expect(await accepts(id, "A".repeat(501))).toBe(false);
    }
  });

  it("refuses the 501st character in the pre-flight, not in an engine crash", async () => {
    // Before this, the only thing that knew about the cap was BWIPP, so the
    // refusal arrived after Generate as "The input data is too long." with no
    // number in it. The message has to name the cap AND the user's own count.
    expect(hasBlockingIssue(checkBarcodeInput("code128", "A".repeat(500)))).toBe(false);
    const issues = checkBarcodeInput("code128", "A".repeat(620));
    expect(issues.map((i) => i.id)).toEqual(["too-long"]);
    expect(issues[0].level).toBe("error");
    expect(issues[0].message).toContain("500");
    expect(issues[0].message).toContain("620");
  });

  it("keeps the pre-flight and the engine agreeing at the boundary", async () => {
    for (const id of ["code128", "code39"] as const) {
      for (const length of [499, 500, 501, 900]) {
        const text = "A".repeat(length);
        expect(hasBlockingIssue(checkBarcodeInput(id, text))).toBe(!(await accepts(id, text)));
      }
    }
  });

  it("quotes QR capacities the engine actually delivers, at the level it actually uses", async () => {
    /*
      The note used to say "roughly 2 900 digits or 1 800 Latin characters",
      which are the version-40 figures for correction level H. `bwipOptions`
      sends no `eclevel`, so BWIPP's default M applies, and M's version-40
      capacities are 5,596 numeric / 3,391 alphanumeric / 2,331 byte — all
      three measured here, which is what identifies the level. Quoting H's
      numbers talked users out of payloads the tool encodes without complaint.
    */
    expect(getSymbology("qrcode").note).toContain("5 500 digits");
    expect(getSymbology("qrcode").note).toContain("2 300 Latin characters");
    expect(await accepts("qrcode", "1".repeat(5500))).toBe(true);
    expect(await accepts("qrcode", "a".repeat(2300))).toBe(true);
    // The ceilings themselves, so the "roughly" stays on the right side of the
    // truth and the correction level stays identified.
    expect(await accepts("qrcode", "1".repeat(5596))).toBe(true);
    expect(await accepts("qrcode", "1".repeat(5597))).toBe(false);
    expect(await accepts("qrcode", "a".repeat(2331))).toBe(true);
    expect(await accepts("qrcode", "a".repeat(2332))).toBe(false);
    expect(await accepts("qrcode", "A".repeat(3391))).toBe(true);
  });

  it("quotes no capacity in a note the engine does not back", () => {
    // Every other note is free of numbers on purpose: Data Matrix, PDF417 and
    // Aztec all cap in a different place (3,116 / 2,713 / 3,832 digits here),
    // so one borrowed figure would be wrong for two of them.
    for (const id of ["datamatrix", "pdf417", "azteccode"] as const) {
      expect(getSymbology(id).note).not.toMatch(/\d[\d  ]{2,}/);
    }
  });
});

/*
  ── The two colours ──────────────────────────────────────────────────
  Colour was the one input on the page with no derived check: the header said
  READY over a symbol that decodes to nothing. Every threshold below is
  asserted twice — once for the issue the pre-flight raises, once against a
  real decode of the symbol drawn in those colours.
*/
describe("relativeLuminance", () => {
  it("is 0 for black and 1 for white, sRGB-linearised", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBe(1);
    // Mid grey is nowhere near 0.5: that is the whole point of linearising.
    expect(relativeLuminance("#808080")).toBeCloseTo(0.2159, 4);
  });

  it("weights green far above red and red far above blue", () => {
    expect(relativeLuminance("#00ff00")).toBeCloseTo(0.7152, 4);
    expect(relativeLuminance("#ff0000")).toBeCloseTo(0.2126, 4);
    expect(relativeLuminance("#0000ff")).toBeCloseTo(0.0722, 4);
  });

  it("is null for anything that is not a six-digit hex colour", () => {
    expect(relativeLuminance("rebeccapurple")).toBeNull();
    expect(relativeLuminance("#fff")).toBeNull();
    expect(relativeLuminance("")).toBeNull();
  });
});

describe("checkBarcodeColors", () => {
  const ids = (fg: string, bg: string, kind: "linear" | "matrix" = "linear") =>
    checkBarcodeColors(fg, bg, kind).map((issue) => `${issue.level}:${issue.id}`);

  it("says nothing about the default black on white", () => {
    expect(ids("#000000", "#ffffff")).toEqual([]);
    expect(ids("#000000", "#ffffff", "matrix")).toEqual([]);
    expect(ids("#888888", "#ffffff")).toEqual([]);
  });

  it("blocks a pair under 20% symbol contrast, and names the grade and the number", () => {
    expect(ids("#eeeeee", "#ffffff")).toEqual(["error:contrast"]);
    const message = checkBarcodeColors("#eeeeee", "#ffffff", "linear")[0].message;
    expect(message).toContain("15%");
    expect(message).toContain("F");
  });

  it("calls a pair the same colour only when it is, and blocks it either way", () => {
    expect(ids("#ffffff", "#ffffff")).toEqual(["error:contrast"]);
    expect(checkBarcodeColors("#ffffff", "#ffffff", "linear")[0].message).toContain(
      "the same colour (#ffffff)",
    );
    expect(checkBarcodeColors("#eeeeee", "#ffffff", "linear")[0].message).not.toContain(
      "the same colour",
    );
  });

  it("blocks an inverted linear code and only warns about an inverted matrix one", () => {
    expect(ids("#ffffff", "#000000")).toEqual(["error:inverted"]);
    expect(ids("#ffffff", "#000000", "matrix")).toEqual(["warning:inverted"]);
  });

  it("warns without blocking in the grade-D band, and names the grade correctly", () => {
    expect(ids("#ffcc00", "#ffffff")).toEqual(["warning:low-contrast", "warning:red-light"]);
    expect(hasBlockingIssue(checkBarcodeColors("#ffcc00", "#ffffff", "linear"))).toBe(false);
    // ISO 15416 symbol contrast: A >= 70, B >= 55, C >= 40, D >= 20, F below.
    // This branch is 20-40%, which is D alone — grade C starts where the
    // warning stops.
    const message = checkBarcodeColors("#ffcc00", "#ffffff", "linear")[0].message;
    expect(message).toContain("grade D");
    expect(message).not.toContain("grade C");
    expect(message).toContain("36%");
  });

  it("warns about red bars on white, which a laser scanner cannot see at all", () => {
    expect(ids("#ff0000", "#ffffff")).toEqual(["warning:red-light"]);
    expect(hasBlockingIssue(checkBarcodeColors("#ff0000", "#ffffff", "linear"))).toBe(false);
  });

  it("says nothing at all about a colour it cannot parse", () => {
    // An unparsable value comes from a browser that gave the input something
    // other than #rrggbb; guessing at it would be worse than staying quiet.
    expect(ids("red", "#ffffff")).toEqual([]);
    expect(ids("#000000", "")).toEqual([]);
  });
});

describe("the colour rules against a real decode", () => {
  const EAN = () => bwipOptions(request({ symbology: "ean13", text: "590123412345", barHeight: 14, includeText: true }));
  const QR = () => bwipOptions(request({ symbology: "qrcode", text: "HELLO" }));

  it("finds no code at all in the pale pair it blocks", async () => {
    expect(await decode(EAN(), { foreground: "#eeeeee", background: "#ffffff" })).toEqual([]);
    expect(await decode(EAN(), { foreground: "#ffffff", background: "#ffffff" })).toEqual([]);
  });

  it("finds no code in an inverted linear symbol, even with the invert pass on", async () => {
    // This is the measurement the `inverted` error message cites. Three pairs,
    // because "white on black" alone would leave the rule looking like a
    // special case rather than the shape of the failure.
    for (const foreground of ["#ffffff", "#cccccc", "#eeeeee"]) {
      const background = foreground === "#cccccc" ? "#333333" : "#111111";
      expect(await decode(EAN(), { foreground, background })).toEqual([]);
    }
  });

  it("does read an inverted matrix symbol, which is why that one is a warning", async () => {
    expect(await decode(QR(), { foreground: "#ffffff", background: "#000000" })).toEqual([
      ["QRCode", "HELLO"],
    ]);
  });

  it("still reads what it warns about, so the warnings stay warnings", async () => {
    // #dddddd is 28% — the middle of the grade-D band the low-contrast warning
    // describes as reading on a screen and getting marginal in print. If the
    // blocking threshold ever crept up over it, that sentence would be a lie
    // about a symbol the page had already refused to draw.
    for (const foreground of ["#ff0000", "#ffcc00", "#888888", "#dddddd"]) {
      expect(await decode(EAN(), { foreground, background: "#ffffff" })).toEqual([
        ["EAN13", "5901234123457"],
      ]);
    }
  });

  it("never claims nothing could read a symbol a camera reads perfectly well", async () => {
    /*
      Yellow on white is 7% luminance contrast, so the grade-F rule blocks it —
      correctly, because a laser scanner sees red light and there is no red
      difference at all. But this reader DID decode it, so the blocking message
      must not say no reader found a code in it. That sentence was there, and
      this is the assertion that keeps it out.
    */
    expect(await decode(EAN(), { foreground: "#ffff00", background: "#ffffff" })).toEqual([
      ["EAN13", "5901234123457"],
    ]);
    const message = checkBarcodeColors("#ffff00", "#ffffff", "linear")[0].message;
    expect(message).not.toMatch(/no reader found|nothing (?:could|can) read/i);
    expect(message).toContain("RED");
  });
});

/*
  ── The engine loader ────────────────────────────────────────────────
*/
describe("loadEngine's memo", () => {
  afterEach(() => {
    vi.doUnmock("bwip-js/generic");
    vi.resetModules();
  });

  it("does not cache a rejected import, so a second Generate can actually retry", async () => {
    /*
      The promise is memoised so two quick clicks share one load. Memoising a
      REJECTED promise bricks the button for the life of the tab: one chunk
      fetch lost to a tunnel, or to a redeploy that rehashed the file, and
      every later press fails instantly with the same message until the page
      is reloaded.
    */
    const actual = await vi.importActual<typeof bwip>("bwip-js/generic");
    let attempts = 0;
    vi.resetModules();
    vi.doMock("bwip-js/generic", () => {
      attempts += 1;
      if (attempts === 1) throw new Error("Failed to fetch dynamically imported module");
      return { ...actual, default: actual };
    });

    const loaded = await import("@/lib/tools/barcode");
    const options = { symbology: "code128", text: "RETRY-ME", scale: 3, barHeight: 12, includeText: false, includeCheckDigit: false, foreground: "#000000", background: "#ffffff" } as const;

    await expect(loaded.renderBarcodeSvg(options)).rejects.toThrow(/could not be loaded/);
    const second = await loaded.renderBarcodeSvg(options);
    expect(second.svg).toContain("<svg");
    expect(attempts).toBe(2);
  });

  it("shows a sentence rather than the bundler's message when the load fails", async () => {
    vi.resetModules();
    vi.doMock("bwip-js/generic", () => {
      throw new Error("Failed to fetch dynamically imported module: /_next/static/chunks/abc.js");
    });
    const loaded = await import("@/lib/tools/barcode");
    await expect(
      loaded.renderBarcodeSvg({ symbology: "code128", text: "X", scale: 3, barHeight: 12, includeText: false, includeCheckDigit: false, foreground: "#000000", background: "#ffffff" }),
    ).rejects.toThrow(/press Generate again/);
    await expect(
      loaded.renderBarcodeSvg({ symbology: "code128", text: "X", scale: 3, barHeight: 12, includeText: false, includeCheckDigit: false, foreground: "#000000", background: "#ffffff" }),
    ).rejects.not.toThrow(/_next\/static/);
  });
});
