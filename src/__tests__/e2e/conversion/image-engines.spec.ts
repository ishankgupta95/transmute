import { test, expect, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import { crc32 as zlibCrc32, deflateSync } from "node:zlib";
import {
  SAMPLES,
  captureDownload,
  downloadAffordance,
  primaryAction,
  probeImageInPage,
  toolError,
  uploadFixture,
  watchEngineRequests,
} from "./support";
import { assertJpeg, assertPng } from "./validators";

/**
 * The four image tools whose engine is NOT a canvas.
 *
 * `compress-png` runs oxipng compiled to WebAssembly, `ico-to-png` runs a
 * hand-written container parser, `base64-to-image` runs `atob`, and
 * `change-image-dpi` rewrites header bytes in place. Every one of them makes a
 * claim about BYTES — smaller, identical, byte-for-byte, never re-encoded —
 * and none of those claims is reachable from the unit suite: jsdom has no
 * canvas and no WebAssembly, so before this file oxipng had never been
 * executed by any gate in this repository.
 *
 * Everything here is therefore asserted on the DOWNLOADED bytes, and the
 * fixtures are built from the spec in Node rather than checked in, so a
 * failure names the field that moved rather than "a fixture changed".
 *
 * TITLES AND FILE NAME: the `conversion-webkit` project sets
 * `grepInvert: /gif|FFmpeg|MP4/i` and matches it against the project name, the
 * FILE PATH and every describe/test title joined together. A banned substring
 * anywhere in that chain silently drops the whole file from WebKit. None of
 * these four tools has anything Chromium-only about it — WebAssembly, `atob`
 * and byte arithmetic all run in Safari — so all of it must run in both
 * projects, and nothing here may be named after a video container.
 */

// ────────────────────────────────────────────────────────────────────────────
// Reading the page
// ────────────────────────────────────────────────────────────────────────────

const surfaceOf = (page: Page) => page.locator("[data-tool-surface]");

/**
 * The value beside a `StatStrip` or `ToolOutput` label, read out of the
 * label's own cell. Both components render `<span>label</span>` and
 * `<span>value</span>` as siblings, so the parent's text minus the label is
 * the value.
 *
 * Scoped to `[data-tool-surface]`: the FAQ and reference prose under every
 * tool repeat these words, and a page-wide locator would find them first.
 */
async function readout(page: Page, label: string): Promise<string> {
  const cell = surfaceOf(page).getByText(label, { exact: true }).locator("xpath=..").first();
  return (await cell.innerText()).replace(label, "").trim();
}

/** Non-empty alerts only — Next's route announcer is an empty `role="alert"`. */
const alertsOf = (page: Page) =>
  surfaceOf(page).locator('[role="alert"]').filter({ hasText: /\S/ });

// ────────────────────────────────────────────────────────────────────────────
// Building real PNGs, from the spec
// ────────────────────────────────────────────────────────────────────────────

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** IHDR's colour-type table: 0 grey, 2 RGB, 3 palette, 4 grey+alpha, 6 RGBA. */
const SAMPLES_PER_PIXEL: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function pngChunk(type: string, payload: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "latin1"), payload]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(payload.length, 0);
  body.copy(out, 4);
  // The CRC covers the type and the payload, never the length field.
  out.writeUInt32BE(zlibCrc32(body) >>> 0, out.length - 4);
  return out;
}

/**
 * A genuinely decodable PNG at any size, colour type and bit depth.
 *
 * `fill` writes 8-bit samples per pixel; omitting it leaves the raster zeroed,
 * which is what the two over-the-ceiling fixtures want — they exist to be
 * REFUSED on their header, and a 12-megapixel raster full of real detail would
 * cost seconds of deflate for a file the engine never opens.
 */
function buildPng(opts: {
  width: number;
  height: number;
  colourType?: number;
  bitDepth?: number;
  fill?: (x: number, y: number) => number[];
  /** Ancillary chunks placed between IHDR and IDAT, in order. */
  extraChunks?: { type: string; payload: Buffer }[];
  deflateLevel?: number;
}): Buffer {
  const { width, height, colourType = 6, bitDepth = 8, fill, extraChunks = [] } = opts;
  const samples = SAMPLES_PER_PIXEL[colourType];
  const stride = (width * samples * bitDepth) / 8;
  // One filter byte per row, filter type 0 (None) — nothing here is testing
  // the filter, and an unfiltered raster is what a reader reconstructs exactly.
  const raw = Buffer.alloc(height * (stride + 1));
  if (fill) {
    for (let y = 0; y < height; y++) {
      const rowAt = y * (stride + 1) + 1;
      for (let x = 0; x < width; x++) {
        const px = fill(x, y);
        for (let s = 0; s < samples; s++) raw[rowAt + x * samples + s] = px[s] & 0xff;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colourType;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    ...extraChunks.map((c) => pngChunk(c.type, c.payload)),
    pngChunk("IDAT", deflateSync(raw, { level: opts.deflateLevel ?? 6 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A deterministic, varied 8-bit RGBA pixel — never noise, so runs compare. */
const patterned = (x: number, y: number): number[] => [
  (x * 37 + y * 11) & 0xff,
  (x * 5 + y * 61) & 0xff,
  (x * 97 + y * 3) & 0xff,
  255,
];

/** `pHYs`: two u32 pixels-per-unit, then the unit byte (1 = metre). */
function physPayload(dpi: number, unit = 1): Buffer {
  const ppm = Math.round(dpi / 0.0254);
  const out = Buffer.alloc(9);
  out.writeUInt32BE(ppm, 0);
  out.writeUInt32BE(ppm, 4);
  out[8] = unit;
  return out;
}

/**
 * A bare little-endian TIFF stream carrying XResolution, YResolution and
 * ResolutionUnit — the payload of a PNG `eXIf` chunk, which unlike a JPEG's
 * Exif APP1 has no `Exif\0\0` prefix in front of it.
 *
 * An Orientation SHORT sits first so the reader has to skip an entry it does
 * not want, and both RATIONALs are stored out of line (8 bytes cannot fit in
 * an entry's 4-byte value field) — which is the whole reason the writer has to
 * follow an offset rather than edit the entry.
 */
function bareTiffResolution(dpi: number): Buffer {
  const entries: Buffer[] = [];
  const entry = (tag: number, type: number, count: number, value: Buffer) => {
    const b = Buffer.alloc(12);
    b.writeUInt16LE(tag, 0);
    b.writeUInt16LE(type, 2);
    b.writeUInt32LE(count, 4);
    value.copy(b, 8);
    entries.push(b);
  };
  const short = (v: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt16LE(v, 0);
    return b;
  };
  const long = (v: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v, 0);
    return b;
  };
  const ifdSize = 2 + 4 * 12 + 4;
  const valuesAt = 8 + ifdSize;
  entry(0x0112, 3, 1, short(1)); // Orientation, inline
  entry(0x011a, 5, 1, long(valuesAt)); // XResolution
  entry(0x011b, 5, 1, long(valuesAt + 8)); // YResolution
  entry(0x0128, 3, 1, short(2)); // ResolutionUnit = inches
  const header = Buffer.alloc(8);
  header.write("II", 0, "latin1");
  header.writeUInt16LE(42, 2);
  header.writeUInt32LE(8, 4);
  const ifd = Buffer.alloc(2 + 4);
  ifd.writeUInt16LE(4, 0); // entry count; the trailing u32 stays 0 = no IFD1
  const values = Buffer.alloc(16);
  values.writeUInt32LE(dpi, 0);
  values.writeUInt32LE(1, 4);
  values.writeUInt32LE(dpi, 8);
  values.writeUInt32LE(1, 12);
  return Buffer.concat([
    header,
    ifd.subarray(0, 2),
    ...entries,
    ifd.subarray(2),
    values,
  ]);
}

// ────────────────────────────────────────────────────────────────────────────
// Reading real PNGs and JPEGs back
// ────────────────────────────────────────────────────────────────────────────

interface ReadChunk {
  type: string;
  payload: Buffer;
}

function pngChunksOf(buf: Buffer): ReadChunk[] {
  const chunks: ReadChunk[] = [];
  let at = 8;
  while (at + 12 <= buf.length) {
    const length = buf.readUInt32BE(at);
    const end = at + 12 + length;
    if (end > buf.length) break;
    const type = buf.toString("latin1", at + 4, at + 8);
    chunks.push({ type, payload: buf.subarray(at + 8, at + 8 + length) });
    if (type === "IEND") break;
    at = end;
  }
  return chunks;
}

/** The declared physical resolution of a PNG, in DPI, or null when it has none. */
function physOf(buf: Buffer): { dpiX: number; dpiY: number; unit: number } | null {
  const chunk = pngChunksOf(buf).find((c) => c.type === "pHYs" && c.payload.length === 9);
  if (!chunk) return null;
  return {
    // Pixels per metre back to DPI, the way `image-dpi.ts` does it: 300 DPI
    // stores as 11811 ppm and reads back as 299.9994, so the round trip is
    // only exact after rounding.
    dpiX: Math.round(chunk.payload.readUInt32BE(0) * 0.0254),
    dpiY: Math.round(chunk.payload.readUInt32BE(4) * 0.0254),
    unit: chunk.payload[8],
  };
}

/** Every IDAT payload concatenated — the bytes a header rewrite must not touch. */
function idatHex(buf: Buffer): string {
  return Buffer.concat(
    pngChunksOf(buf)
      .filter((c) => c.type === "IDAT")
      .map((c) => c.payload),
  ).toString("hex");
}

/** XResolution / YResolution / ResolutionUnit out of a TIFF stream at `start`. */
function tiffResolution(
  buf: Buffer,
  start: number,
): { dpiX: number; dpiY: number; unit: number } | null {
  if (start + 8 > buf.length) return null;
  const order = buf.toString("latin1", start, start + 2);
  if (order !== "II" && order !== "MM") return null;
  const le = order === "II";
  const u16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  if (u16(start + 2) !== 42) return null;
  const ifd0 = start + u32(start + 4);
  if (ifd0 + 2 > buf.length) return null;
  const count = u16(ifd0);
  let dpiX: number | null = null;
  let dpiY: number | null = null;
  let unit = 2;
  for (let i = 0; i < count; i++) {
    const e = ifd0 + 2 + i * 12;
    if (e + 12 > buf.length) break;
    const tag = u16(e);
    if (tag === 0x0128) {
      unit = u16(e + 8);
      continue;
    }
    if (tag !== 0x011a && tag !== 0x011b) continue;
    const at = start + u32(e + 8);
    if (at + 8 > buf.length) continue;
    const value = u32(at) / u32(at + 4);
    if (tag === 0x011a) dpiX = value;
    else dpiY = value;
  }
  return dpiX === null || dpiY === null ? null : { dpiX, dpiY, unit };
}

/** The `eXIf` chunk's resolution, or null when the PNG carries none. */
function pngExifResolution(buf: Buffer): { dpiX: number; dpiY: number; unit: number } | null {
  let at = 8;
  while (at + 12 <= buf.length) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString("latin1", at + 4, at + 8);
    if (type === "eXIf") return tiffResolution(buf, at + 8);
    if (type === "IEND") break;
    at += 12 + length;
  }
  return null;
}

interface JpegSegment {
  marker: number;
  at: number;
  dataAt: number;
  end: number;
  length: number;
}

/** JPEG segment headers up to the start of scan. */
function jpegSegmentsOf(buf: Buffer): JpegSegment[] {
  const segments: JpegSegment[] = [];
  let at = 2;
  while (at + 4 <= buf.length) {
    if (buf[at] !== 0xff) break;
    const marker = buf.readUInt16BE(at);
    if (marker === 0xffda || marker === 0xffd9) break;
    const length = buf.readUInt16BE(at + 2);
    if (length < 2) break;
    segments.push({ marker, at, length, dataAt: at + 4, end: at + 2 + length });
    at += 2 + length;
  }
  return segments;
}

/** The JFIF APP0 density, skipping a `JFXX` extension APP0. */
function jfifDensityOf(buf: Buffer): { units: number; x: number; y: number } | null {
  for (const s of jpegSegmentsOf(buf)) {
    if (s.marker !== 0xffe0) continue;
    if (buf.toString("latin1", s.dataAt, s.dataAt + 5) !== "JFIF\0") continue;
    if (s.length < 16) return null;
    return {
      units: buf[s.dataAt + 7],
      x: buf.readUInt16BE(s.dataAt + 8),
      y: buf.readUInt16BE(s.dataAt + 10),
    };
  }
  return null;
}

/** The Exif APP1's resolution, skipping the XMP APP1 that often sits beside it. */
function jpegExifResolution(buf: Buffer): { dpiX: number; dpiY: number; unit: number } | null {
  for (const s of jpegSegmentsOf(buf)) {
    if (s.marker !== 0xffe1) continue;
    if (buf.toString("latin1", s.dataAt, s.dataAt + 6) !== "Exif\0\0") continue;
    return tiffResolution(buf, s.dataAt + 6);
  }
  return null;
}

/**
 * Everything from the start-of-scan marker to the end of the file: the
 * entropy-coded image data plus the frame headers that describe it. A DPI
 * write must leave every byte of it alone, and any re-encode moves it.
 */
function scanBytes(buf: Buffer): Buffer {
  for (let at = 2; at + 4 <= buf.length; ) {
    if (buf[at] !== 0xff) break;
    const marker = buf.readUInt16BE(at);
    if (marker === 0xffda) return buf.subarray(at);
    const length = buf.readUInt16BE(at + 2);
    if (length < 2) break;
    at += 2 + length;
  }
  return Buffer.alloc(0);
}

// ────────────────────────────────────────────────────────────────────────────
// Building a real .ico, from the spec
// ────────────────────────────────────────────────────────────────────────────

interface IcoPart {
  size: number;
  /** The bit depth the directory declares — what tells two same-size entries apart. */
  bpp: number;
  payload: Buffer;
}

/** An ICONDIR plus `n` ICONDIRENTRYs, then every payload back to back. */
function buildIco(parts: IcoPart[]): Buffer {
  const header = Buffer.alloc(6 + 16 * parts.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(parts.length, 4);
  let offset = header.length;
  parts.forEach((part, i) => {
    const at = 6 + i * 16;
    // Width and height are single bytes where 0 stands for 256.
    header[at] = part.size >= 256 ? 0 : part.size;
    header[at + 1] = part.size >= 256 ? 0 : part.size;
    header[at + 2] = 0; // palette colours
    header[at + 3] = 0; // reserved
    header.writeUInt16LE(1, at + 4); // colour planes
    header.writeUInt16LE(part.bpp, at + 6);
    header.writeUInt32LE(part.payload.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += part.payload.length;
  });
  return Buffer.concat([header, ...parts.map((p) => p.payload)]);
}

// ────────────────────────────────────────────────────────────────────────────
// Deciding whether two files hold the same picture
// ────────────────────────────────────────────────────────────────────────────

interface RasterComparison {
  /** Bytes of RGBA actually compared. Zero means the test proved nothing. */
  compared: number;
  differing: number;
  dimsA: string;
  dimsB: string;
}

/**
 * Decode two PNGs in the browser and compare every RGBA byte.
 *
 * "Lossless" is the whole product claim of `compress-png`, and the only way to
 * earn it is to decode both files and look. `compared` comes back so the test
 * can assert the comparison compared something — two zero-length rasters are
 * equal, and a comparison that cannot fail is not a gate.
 *
 * Both sides go through the identical decode-and-draw path, so any colour
 * management the browser applies applies to both and cancels out; the fixture
 * is fully opaque, which keeps canvas 2D's premultiplied alpha out of it.
 */
async function compareRasters(page: Page, a: Buffer, b: Buffer): Promise<RasterComparison> {
  return page.evaluate(
    async ({ ab, bb }: { ab: string; bb: string }) => {
      const toBytes = (b64: string) => {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
      };
      const raster = async (bytes: Uint8Array) => {
        const bitmap = await createImageBitmap(
          new Blob([bytes as BlobPart], { type: "image/png" }),
        );
        const w = bitmap.width;
        const h = bitmap.height;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(bitmap, 0, 0);
        const data = ctx.getImageData(0, 0, w, h).data;
        bitmap.close();
        return { w, h, data };
      };
      const A = await raster(toBytes(ab));
      const B = await raster(toBytes(bb));
      const dims = { dimsA: `${A.w}×${A.h}`, dimsB: `${B.w}×${B.h}` };
      if (A.w !== B.w || A.h !== B.h) return { compared: 0, differing: -1, ...dims };
      let differing = 0;
      for (let i = 0; i < A.data.length; i++) if (A.data[i] !== B.data[i]) differing++;
      return { compared: A.data.length, differing, ...dims };
    },
    { ab: a.toString("base64"), bb: b.toString("base64") },
  );
}

/**
 * A PNG written by the browser's own canvas encoder, returned as bytes.
 *
 * This is not a convenience: the tool's "20–35% off" claim is grounded in
 * exports from a browser, a screenshot tool or a design app, and the browser's
 * encoder is the one member of that class a test can actually produce. A
 * checked-in fixture optimised by some other tool would be measuring the wrong
 * encoder. Flat blocks from a small palette are the shape those exports have —
 * and are what oxipng's palette reduction wins on.
 */
async function canvasPng(page: Page, width: number, height: number): Promise<Buffer> {
  const b64 = await page.evaluate(
    async ({ w, h }: { w: number; h: number }) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      const palette = [
        "#0b0d14", "#f2aa4c", "#2a9d8f", "#e76f51",
        "#264653", "#e9c46a", "#ffffff", "#8d99ae",
      ];
      const block = 40;
      for (let y = 0; y < h; y += block) {
        for (let x = 0; x < w; x += block) {
          ctx.fillStyle = palette[(x / block + (y / block) * 3) % palette.length];
          ctx.fillRect(x, y, block, block);
        }
      }
      ctx.fillStyle = "#0b0d14";
      for (let i = 0; i < 8; i++) ctx.fillRect(0, (i * 57) % h, w, 3);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      const bytes = new Uint8Array(await blob!.arrayBuffer());
      let bin = "";
      for (const byte of bytes) bin += String.fromCharCode(byte);
      return btoa(bin);
    },
    { w: width, h: height },
  );
  return Buffer.from(b64, "base64");
}

/** The oxipng watcher. One matcher for ours and for anyone else's. */
const watchOxipng = (page: Page) =>
  watchEngineRequests(page, {
    label: "oxipng",
    isEngine: (url) => /squoosh_oxipng_bg\.wasm/.test(url),
  });

// ────────────────────────────────────────────────────────────────────────────
// compress-png
// ────────────────────────────────────────────────────────────────────────────

test.describe("compress-png — oxipng, executed for the first time by any gate here", () => {
  test("takes bytes off a canvas-written PNG without moving a single pixel", async ({ page }) => {
    /*
      The watcher goes on before the navigation, because the engine is fetched
      from inside the worker the moment the first job runs and a watcher
      installed later could miss a preload. Its assertion is two-sided by
      construction: a foreign origin fails, and so does "the engine never
      loaded, so this test proved nothing about it" — which is exactly the
      state this spec would be in if the worker silently fell back to
      something else.
    */
    const watch = watchOxipng(page);
    await page.goto("/compress-png");

    const source = await canvasPng(page, 600, 400);
    const before = assertPng(source);
    expect(before, "the fixture must be the size it was drawn at").toEqual({
      width: 600,
      height: 400,
    });

    await uploadFixture(page, {
      name: "screenshot.png",
      mimeType: "image/png",
      buffer: source,
    });
    await primaryAction(page, /^Optimize PNG$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `optimise failed: ${await toolError(page)}`).toBeVisible({ timeout: 120_000 });
    const { name, bytes } = await captureDownload(page, dl);

    expect(name).toBe("screenshot-optimised.png");
    const after = assertPng(bytes);
    expect(after).toEqual(before);

    /*
      The claim on the page is "20–35% off PNGs exported from a browser".
      Asserting merely `<=` would pass on a tool that handed the file straight
      back, which is the exact no-op this tool exists to replace, so this is a
      strict `<`.
    */
    expect(
      bytes.length,
      `oxipng must take bytes off a browser-written PNG: ${source.length} B in, ` +
        `${bytes.length} B out`,
    ).toBeLessThan(source.length);

    /*
      And "lossless" means lossless. Decode BOTH and compare every RGBA byte —
      the only assertion that earns the word. `compared` guards the guard: a
      comparison of two empty rasters is equal, and would be a green test that
      looked at nothing.
    */
    const raster = await compareRasters(page, source, bytes);
    expect(raster.compared, "the raster comparison must have compared something")
      .toBe(600 * 400 * 4);
    expect(
      raster.differing,
      `oxipng is lossless: ${raster.differing} of ${raster.compared} RGBA bytes changed ` +
        `(${raster.dimsA} in, ${raster.dimsB} out)`,
    ).toBe(0);

    // The page says so too, and the wording is the one the pixels just earned.
    await expect(
      surfaceOf(page).getByText(
        "LOSSLESS — EVERY PIXEL COMES OUT IDENTICAL. ONLY THE ENCODING CHANGES",
      ),
    ).toBeVisible();
    await expect(alertsOf(page)).toHaveCount(0);

    watch.assertSelfHostedAndUsed();
  });

  test("reports an unimprovable PNG as a success and hands the same bytes back", async ({
    page,
  }) => {
    /*
      "A PNG that cannot be improved" is not a file you can write by hand — it
      is whatever the codec has already finished with. So the fixture is this
      tool's own output: oxipng only replaces its input when the candidate is
      SMALLER, and on its own output at the same level the candidate is the
      same size, so the second pass must return the input byte for byte.

      That is the empty state a meaningful share of real uploads land in, and
      the tool has to render it as the successful run it is. A "0% saved" error
      would fail here, and so would a page that quietly showed nothing.
    */
    await page.goto("/compress-png");
    const source = await canvasPng(page, 320, 240);
    await uploadFixture(page, { name: "first.png", mimeType: "image/png", buffer: source });
    await primaryAction(page, /^Optimize PNG$/).click();
    const firstDl = downloadAffordance(page);
    await expect(firstDl, `optimise failed: ${await toolError(page)}`).toBeVisible({
      timeout: 120_000,
    });
    const optimised = (await captureDownload(page, firstDl)).bytes;
    expect(
      optimised.length,
      "the second pass only proves something if the first one actually won bytes",
    ).toBeLessThan(source.length);

    // Second pass, on a file oxipng has already finished with.
    await page.goto("/compress-png");
    await uploadFixture(page, {
      name: "already-optimal.png",
      mimeType: "image/png",
      buffer: optimised,
    });
    await primaryAction(page, /^Optimize PNG$/).click();
    const dl = downloadAffordance(page);
    await expect(dl, `second pass failed: ${await toolError(page)}`).toBeVisible({
      timeout: 120_000,
    });
    const again = await captureDownload(page, dl);

    expect(
      again.bytes.equals(optimised),
      "an already-optimal PNG must come back byte for byte, not re-encoded",
    ).toBe(true);

    // Said honestly, and said as a NOTICE rather than as a failure.
    await expect(alertsOf(page), "an already-optimal PNG is not an error").toHaveCount(0);
    await expect(
      surfaceOf(page).getByText(/Already optimal at level 2 — oxipng returned this PNG/),
    ).toBeVisible();
    // "NONE", not "0.0%": the number is not a rounding artefact, it is the
    // whole outcome, and the strip has to say which.
    expect(await readout(page, "SAVED")).toBe("NONE");
  });

  test("refuses a 12-megapixel PNG before the codec is ever fetched", async ({ page }) => {
    /*
      The pixel ceiling is a MEMORY guard, not a politeness: oxipng's wasm heap
      tracks the decoded image at roughly eight times its size and wasm32
      cannot hand linear memory back, so a refusal that arrived after the
      allocation would be no refusal at all.

      `assertNeverFetched` is what turns "the button was disabled" into "the
      engine was never even loaded" — the other half of the same watcher the
      first test uses, and the only way to assert an ordering from outside.
    */
    const watch = watchOxipng(page);
    await page.goto("/compress-png");

    // 4000 × 3200 = 12.8 MP, just over the ceiling. Zero-filled: this file
    // exists to be refused on its IHDR, and nothing here decodes it but the
    // browser's own preview.
    const oversize = buildPng({
      width: 4000,
      height: 3200,
      colourType: 2,
      deflateLevel: 1,
    });
    await uploadFixture(page, {
      name: "huge.png",
      mimeType: "image/png",
      buffer: oversize,
    });

    const refusal = alertsOf(page).first();
    await expect(refusal).toContainText(/12\.8 megapixels and the optimizer stops at 12/, {
      timeout: 60_000,
    });
    // The message has to name the REASON, not just the number.
    await expect(refusal).toContainText(/memory/);
    await expect(refusal).toContainText(/48 MB decoded/);
    await expect(primaryAction(page, /^Optimize PNG$/)).toBeDisabled();

    watch.assertNeverFetched(
      "the pixel ceiling is read out of the IHDR before any codec is loaded",
    );
  });

  test("refuses a deep-colour raster over the decoded-size ceiling, naming why", async ({
    page,
  }) => {
    /*
      The second ceiling, and the reason there are two. 3000 × 2050 is 6.15
      megapixels — comfortably inside the pixel cap, and a page that only
      counted pixels would run this — but at 16 bits per channel with alpha it
      decodes to 49 MB, over the 48 MB the engine accepts.

      The page cannot see this one: it measures the source by decoding it,
      which yields width and height and nothing about bit depth. So the primary
      is ENABLED, the click goes through, and the refusal has to come from the
      engine — before oxipng is fetched, which is what `assertNeverFetched`
      pins here.
    */
    const watch = watchOxipng(page);
    await page.goto("/compress-png");

    const deep = buildPng({
      width: 3000,
      height: 2050,
      colourType: 6,
      bitDepth: 16,
      deflateLevel: 1,
    });
    await uploadFixture(page, { name: "deep.png", mimeType: "image/png", buffer: deep });

    const run = primaryAction(page, /^Optimize PNG$/);
    await expect(run, "the pixel count is inside the cap, so the page cannot refuse this")
      .toBeEnabled({ timeout: 60_000 });
    await run.click();

    const refusal = alertsOf(page).first();
    await expect(refusal).toContainText(/decodes to 49 MB — over the 48 MB this tool accepts/, {
      timeout: 60_000,
    });
    // Named by the pixel format it actually read, not by a guess from the size.
    await expect(refusal).toContainText(/3000×2050 in RGBA\/16/);
    await expect(downloadAffordance(page), "a refused file must offer nothing to download")
      .toHaveCount(0);

    watch.assertNeverFetched(
      "the decoded-raster ceiling is read out of the IHDR before the codec is fetched",
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ico-to-png
// ────────────────────────────────────────────────────────────────────────────

test.describe("ico-to-png — every image in the container, and a byte slice where it can", () => {
  test("lists all three sizes and copies each stored PNG out byte for byte", async ({ page }) => {
    /*
      A browser left to itself decodes an .ico to exactly ONE image and never
      says which. The directory parser is what lets every size be offered — so
      the first assertion is that all three are there, and the second is the
      claim only a byte compare can earn: an entry stored as a PNG is copied
      straight out of the container, with no decode and no re-encode anywhere
      in the path.
    */
    const parts: IcoPart[] = [16, 32, 48].map((size) => ({
      size,
      bpp: 32,
      payload: buildPng({ width: size, height: size, fill: patterned }),
    }));
    const ico = buildIco(parts);

    await page.goto("/ico-to-png");
    await uploadFixture(page, { name: "favicon.ico", mimeType: "image/x-icon", buffer: ico });

    const surface = surfaceOf(page);
    for (const part of parts) {
      await expect(
        surface.getByRole("button", {
          name: new RegExp(`^${part.size} × ${part.size}, 32-bit, PNG · BYTE SLICE$`),
        }),
        `the ${part.size}px entry must be listed as its own image`,
      ).toBeVisible({ timeout: 30_000 });
    }
    expect(await readout(page, "IN THE FILE")).toBe("3");

    await primaryAction(page, /^Extract 3 PNGs$/).click();

    for (const part of parts) {
      const fileName = `favicon-${part.size}x${part.size}.png`;
      const { name, bytes } = await captureDownload(
        page,
        page.getByRole("button", { name: `Download ${fileName}` }),
      );
      expect(name).toBe(fileName);
      expect(
        bytes.equals(part.payload),
        `the ${part.size}px entry must be the stored bytes unchanged — ` +
          `${part.payload.length} B in the container, ${bytes.length} B out`,
      ).toBe(true);
      // And a byte slice of the right entry, not of some other one: decode it.
      expect(await probeImageInPage(page, bytes, "image/png")).toEqual({
        width: part.size,
        height: part.size,
      });
    }

    await expect(
      surface.getByText(
        "EVERY ICON CAME OUT AS THE PNG ALREADY INSIDE THE FILE — NO DECODE, NO RE-ENCODE",
      ),
    ).toBeVisible();
    await expect(alertsOf(page)).toHaveCount(0);
  });

  test("gives two same-size entries names that cannot overwrite each other", async ({ page }) => {
    /*
      A real favicon.ico routinely carries the SAME pixel size twice at
      different colour depths. Naming both `icon-32x32.png` hands the user two
      buttons with identical labels, the second of which overwrites the first
      on disk — silent data loss in a tool whose entire selling point is that
      it gives you every image in the container.

      The two payloads differ on purpose, so this asserts more than two
      strings: each button has to hand over ITS OWN entry.
    */
    const deep: IcoPart = {
      size: 32,
      bpp: 32,
      payload: buildPng({ width: 32, height: 32, fill: patterned }),
    };
    const shallow: IcoPart = {
      size: 32,
      bpp: 8,
      payload: buildPng({ width: 32, height: 32, fill: (x, y) => [255 - x * 8, y * 8, 64, 255] }),
    };
    expect(deep.payload.equals(shallow.payload), "the two entries must differ").toBe(false);

    await page.goto("/ico-to-png");
    await uploadFixture(page, {
      name: "icon.ico",
      mimeType: "image/x-icon",
      buffer: buildIco([deep, shallow]),
    });
    await primaryAction(page, /^Extract 2 PNGs$/).click({ timeout: 30_000 });

    const deepDl = await captureDownload(
      page,
      page.getByRole("button", { name: "Download icon-32x32-32bit.png" }),
    );
    const shallowDl = await captureDownload(
      page,
      page.getByRole("button", { name: "Download icon-32x32-8bit.png" }),
    );

    expect(deepDl.name).not.toBe(shallowDl.name);
    expect(deepDl.bytes.equals(deep.payload), "the 32-bit button must hand over the 32-bit entry")
      .toBe(true);
    expect(
      shallowDl.bytes.equals(shallow.payload),
      "the 8-bit button must hand over the 8-bit entry",
    ).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// base64-to-image
// ────────────────────────────────────────────────────────────────────────────

/** Paste a string into the tool's one textarea and run the decode. */
async function pasteAndDecode(page: Page, text: string): Promise<void> {
  /*
    ROLE-SCOPED ON PURPOSE. `getByLabel("Base64")` is a SUBSTRING match against
    the accessible name, and since the tool surface became a named region — an
    `sr-only` <h2> holding the tool's name, added so a screen-reader user can
    find the workspace at all — the <section> is also called "Base64 to Image"
    and matches. Playwright then resolves to the section and `fill` fails with
    "Element is not an <input>, <textarea>, <select> or [contenteditable]".
    Naming the ROLE keeps the region out of it without weakening the assertion.
  */
  const pane = page.getByRole("textbox", { name: "Base64", exact: true });
  await pane.fill(text);
  await primaryAction(page, /^Decode to image$/).click();
}

test.describe("base64-to-image — a string in, the same bytes out", () => {
  test("decodes a data: URI and a bare paste to the identical file", async ({ page }) => {
    const png = buildPng({ width: 24, height: 18, fill: patterned });
    const b64 = png.toString("base64");

    await page.goto("/base64-to-image");

    // Form 1: the whole data: URI, prefix and all.
    await pasteAndDecode(page, `data:image/png;base64,${b64}`);
    let dl = await captureDownload(page, downloadAffordance(page));
    expect(dl.name).toBe("image.png");
    expect(
      dl.bytes.equals(png),
      "a Base64 round trip is lossless — the file out must be the file in",
    ).toBe(true);
    assertPng(dl.bytes);
    // Polled: the pixel readout waits on the browser's own decode of the blob,
    // which is the one thing on this page that is not synchronous.
    await expect.poll(() => readout(page, "PIXELS"), { timeout: 30_000 }).toBe("24×18");
    expect(await readout(page, "FORMAT")).toBe("PNG");
    // Nothing was repaired, and the readouts must not claim otherwise.
    expect(await readout(page, "Alphabet")).toBe("Standard");

    // Form 2: the bare payload, no prefix. Same bytes, same file.
    await pasteAndDecode(page, b64);
    dl = await captureDownload(page, downloadAffordance(page));
    expect(dl.bytes.equals(png)).toBe(true);
    await expect(alertsOf(page)).toHaveCount(0);
  });

  test("translates the URL-safe alphabet and puts the padding back", async ({ page }) => {
    const png = buildPng({ width: 24, height: 18, fill: (x, y) => [x * 9, y * 13, 200 - x, 255] });
    const standard = png.toString("base64");
    /*
      Two-sided: a payload whose standard form happens to contain neither `+`
      nor `/` would exercise no translation at all and pass vacuously, so the
      fixture has to prove it is the case it claims to be.
    */
    expect(
      /[+/]/.test(standard),
      "this fixture only tests the URL-safe alphabet if its standard form uses + or /",
    ).toBe(true);

    // URL-safe, and stripped of its padding — both repairs in one paste.
    const core = standard.replace(/=+$/, "");
    const urlSafe = core.replace(/\+/g, "-").replace(/\//g, "_");
    const expectedPad = (4 - (core.length % 4)) % 4;
    expect(expectedPad, "strip the padding and there must be some to put back").toBeGreaterThan(0);

    await page.goto("/base64-to-image");
    await pasteAndDecode(page, urlSafe);

    const dl = await captureDownload(page, downloadAffordance(page));
    expect(dl.bytes.equals(png), "the translated payload must decode to the original bytes")
      .toBe(true);
    // Reported because it happened, not because the input looked like it might.
    expect(await readout(page, "Alphabet")).toBe("URL-safe → standard");
    expect(await readout(page, "Padding")).toBe(`${expectedPad} added`);
  });

  test("refuses three different kinds of junk, each with its own reason", async ({ page }) => {
    /*
      `atob` throws the identical `InvalidCharacterError` for all of these, so
      "Invalid Base64 string" is what a tool says when it has not looked. Each
      of these three needs opposite advice, and the page has to give it —
      otherwise someone whose clipboard truncated goes hunting for a percent
      sign.
    */
    await page.goto("/base64-to-image");
    const alerts = alertsOf(page);

    // 1. Not Base64 at all — characters outside the alphabet survive all three
    //    repairs.
    await pasteAndDecode(page, "this is not base64 at all!!");
    await expect(alerts.first()).toContainText(/This is not Base64/);
    await expect(downloadAffordance(page)).toHaveCount(0);

    // 2. A data: URI whose payload is percent-encoded rather than Base64.
    await pasteAndDecode(page, "data:image/png,%89PNG%0D%0A%1A%0A");
    await expect(alerts.first()).toContainText(/percent-encoded, not Base64/);
    await expect(downloadAffordance(page)).toHaveCount(0);

    // 3. Perfectly good Base64 that decodes to something that is not a
    //    picture. The message has to say it decoded — that is what tells the
    //    user their paste was fine and their BYTES are wrong.
    await pasteAndDecode(page, Buffer.from("not a picture, just text").toString("base64"));
    await expect(alerts.first()).toContainText(/decoded cleanly into/);
    await expect(alerts.first()).toContainText(/match no image format this tool can name/);
    await expect(downloadAffordance(page)).toHaveCount(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// change-image-dpi
// ────────────────────────────────────────────────────────────────────────────

test.describe("change-image-dpi — a header rewrite that never re-encodes", () => {
  test("inserts a pHYs chunk and leaves the image data byte for byte", async ({ page }) => {
    const source = buildPng({ width: 120, height: 90, fill: patterned });
    expect(physOf(source), "the fixture must start with no declared density").toBeNull();

    await page.goto("/change-image-dpi");
    await uploadFixture(page, { name: "poster.png", mimeType: "image/png", buffer: source });

    // The honest empty state: a file with no pHYs declares nothing, and the
    // page must not print the 72 a reader would have invented for it.
    await expect(
      surfaceOf(page).getByText(/This file declares no density at all/),
    ).toBeVisible({ timeout: 30_000 });

    await primaryAction(page, /^Set DPI$/).click();
    const dl = downloadAffordance(page);
    await expect(dl, `DPI write failed: ${await toolError(page)}`).toBeVisible({ timeout: 60_000 });
    const { name, bytes } = await captureDownload(page, dl);

    expect(name).toBe("poster-300dpi.png");
    assertPng(bytes);
    /*
      pHYs counts pixels per METRE in whole numbers, so 300 DPI is stored as
      11811 ppm and rounds back to 300 — the round trip is exact only after
      that rounding, and asserting the DPI rather than the raw integer is what
      pins the conversion in the direction a user cares about.
    */
    expect(physOf(bytes)).toEqual({ dpiX: 300, dpiY: 300, unit: 1 });

    // The whole point of the tool: the picture did not move.
    const idat = idatHex(source);
    expect(idat.length, "the IDAT comparison must have compared something").toBeGreaterThan(0);
    expect(
      idatHex(bytes),
      "a DPI change must never re-encode — the compressed image data must be identical",
    ).toBe(idat);
    // A pHYs chunk on the wire is 21 bytes: 4 length + 4 type + 9 payload + 4 CRC.
    expect(bytes.length - source.length, "nothing but the chunk may be added").toBe(21);
    expect(await probeImageInPage(page, bytes, "image/png")).toEqual({ width: 120, height: 90 });
  });

  test("writes both the JFIF density and the Exif resolution into a photograph", async ({
    page,
  }) => {
    /*
      This is the trap the tool exists to sidestep. `sample-photo.jpg` carries
      an Exif APP1 declaring 72 DPI AND a JFIF APP0 whose units byte is 0 — an
      aspect ratio, not a resolution. Where both are present a reader believes
      the EXIF, so writing the JFIF alone is a silent no-op: the file would
      still report 72 everywhere it mattered while the page claimed 300.

      Both fields are asserted here, out of the downloaded bytes.
    */
    const jpg = await SAMPLES.jpg();
    expect(jfifDensityOf(jpg.buffer), "the fixture must carry a JFIF APP0").toMatchObject({
      units: 0,
    });
    expect(jpegExifResolution(jpg.buffer), "and an Exif resolution to be overridden").toEqual({
      dpiX: 72,
      dpiY: 72,
      unit: 2,
    });

    await page.goto("/change-image-dpi");
    await uploadFixture(page, jpg);
    await primaryAction(page, /^Set DPI$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `DPI write failed: ${await toolError(page)}`).toBeVisible({ timeout: 60_000 });
    const { name, bytes } = await captureDownload(page, dl);

    expect(name).toBe("sample-photo-300dpi.jpg");
    assertJpeg(bytes);
    // Units 1 is dots per inch; leaving it at 0 would store 300 as an aspect
    // ratio, which no reader can print from.
    expect(jfifDensityOf(bytes)).toEqual({ units: 1, x: 300, y: 300 });
    expect(jpegExifResolution(bytes)).toEqual({ dpiX: 300, dpiY: 300, unit: 2 });

    // Nothing but two header fields moved.
    expect(bytes.length, "both fields already existed, so nothing may be inserted")
      .toBe(jpg.buffer.length);
    const scan = scanBytes(jpg.buffer);
    expect(scan.length, "the scan comparison must have compared something").toBeGreaterThan(1024);
    expect(
      scanBytes(bytes).equals(scan),
      "the entropy-coded scan must be untouched — any re-encode moves it",
    ).toBe(true);

    // And the page says which fields it wrote, derived from the run.
    await expect(
      surfaceOf(page).getByText(
        /Both the Exif resolution and the JFIF density were written, so no reader can find them disagreeing\./,
      ),
    ).toBeVisible();
  });

  test("updates a PNG's eXIf resolution alongside its pHYs chunk", async ({ page }) => {
    /*
      Measured this session: on a PNG carrying both, a reader believes the
      eXIf. Writing pHYs alone leaves the old density in force — the same
      silent no-op as writing a JPEG's JFIF and leaving its Exif alone — so the
      two have to move together, and the only place that can be checked is the
      downloaded bytes.

      The fixture disagrees with itself on purpose (96 in pHYs, 72 in eXIf), so
      a run that touched one field and not the other cannot look correct.
    */
    const source = buildPng({
      width: 64,
      height: 48,
      fill: patterned,
      extraChunks: [
        { type: "pHYs", payload: physPayload(96) },
        { type: "eXIf", payload: bareTiffResolution(72) },
      ],
    });
    expect(physOf(source)).toEqual({ dpiX: 96, dpiY: 96, unit: 1 });
    expect(pngExifResolution(source)).toEqual({ dpiX: 72, dpiY: 72, unit: 2 });

    await page.goto("/change-image-dpi");
    await uploadFixture(page, { name: "scan.png", mimeType: "image/png", buffer: source });

    // 72, not 96: the page has to report the field a reader will believe.
    await expect
      .poll(() => readout(page, "DPI NOW"), { timeout: 30_000 })
      .toBe("72");

    await primaryAction(page, /^Set DPI$/).click();
    const dl = downloadAffordance(page);
    await expect(dl, `DPI write failed: ${await toolError(page)}`).toBeVisible({ timeout: 60_000 });
    const { bytes } = await captureDownload(page, dl);

    expect(physOf(bytes), "the pHYs chunk must be updated").toEqual({
      dpiX: 300,
      dpiY: 300,
      unit: 1,
    });
    expect(
      pngExifResolution(bytes),
      "and so must the eXIf resolution, which is the one a reader believes",
    ).toEqual({ dpiX: 300, dpiY: 300, unit: 2 });

    // Both fields existed already, so both were rewritten in place.
    expect(bytes.length).toBe(source.length);
    expect(idatHex(bytes)).toBe(idatHex(source));
    await expect(
      surfaceOf(page).getByText(
        /Both the eXIf resolution and the pHYs chunk were written, so no reader can find them disagreeing\./,
      ),
    ).toBeVisible();
  });
});
