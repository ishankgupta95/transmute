import { openTiff, toDecodableSource } from "./image-convert";
import { canvasToBlob } from "./canvas-utils";

/**
 * Per-file preparation for the images→PDF family (images-to-pdf and its
 * format children: jpg/png/heic/webp/tiff-to-pdf).
 *
 * The engine (`imagesToPdf` in pdf-engine-core, pdf-lib) embeds exactly two
 * byte formats — JPEG via `embedJpg` and PNG via `embedPng` — so anything
 * else must be decoded and re-encoded before it reaches the worker. This
 * module runs at ADD time on the main thread: page counts and frame warnings
 * land on the assembly strip before Create PDF is pressed, and a corrupt file
 * is refused at the door instead of failing the whole assembly later.
 *
 * What is deliberately NOT re-encoded: JPEG and PNG bytes pass through
 * untouched — the tool's "JPG data is embedded byte-for-byte" claim rests on
 * this function never opening them. Magic bytes decide, not filenames: a PNG
 * wearing a .jpg name still passes through as a PNG.
 *
 * Re-encode policy for everything else (TIFF pages, WebP, HEIC, and any
 * other decodable source): pages carrying any transparent pixel become PNG
 * (PDF viewers composite the transparency over the white page); fully opaque
 * pages become JPEG at quality 0.92 — a 12 MP photo repacked as PNG would
 * balloon the PDF for no visual gain.
 *
 * Main-thread only. This module reaches heic2any and utif2 through
 * image-convert.ts; it must never be pulled into a worker bundle.
 */

/** The only two byte formats pdf-lib can embed. */
export type PreparedPageType = "image/jpeg" | "image/png";

export interface PreparedPage {
  bytes: Uint8Array;
  type: PreparedPageType;
}

export interface PreparedImage {
  /** One entry per output PDF page — a 3-page TIFF prepares 3 pages. */
  pages: PreparedPage[];
  /** User-facing notices (animated WebP/GIF flattened to frame 0). */
  warnings: string[];
}

/** Encoder quality for opaque re-encoded pages. Stated in the page copy. */
export const PDF_JPEG_QUALITY = 0.92;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Byte sniff for the three formats this module routes on. Exported for unit
 * tests — names and MIME types lie, magic numbers don't.
 */
export function sniffImageKind(bytes: Uint8Array): "jpeg" | "png" | "tiff" | "other" {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  if (bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return "png";
  if (bytes.length >= 4) {
    const littleEndian =
      bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00;
    const bigEndian =
      bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a;
    if (littleEndian || bigEndian) return "tiff";
  }
  return "other";
}

/**
 * Bit depth from a PNG's IHDR (always the first chunk: 8-byte signature,
 * 8-byte chunk header, then width/height/depth at data offsets 0/4/8).
 * Exported for unit tests.
 */
export function pngBitDepth(bytes: Uint8Array): number | null {
  return bytes.length > 24 ? bytes[24] : null;
}

/** True when any pixel of an RGBA buffer is not fully opaque. */
export function rgbaHasTransparency(rgba: Uint8Array | Uint8ClampedArray): boolean {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] < 255) return true;
  }
  return false;
}

/**
 * Prepare one file for `imagesToPdf`: passthrough for JPEG/PNG, one prepared
 * page per TIFF page, decode-and-re-encode for everything else. Throws a
 * per-file error naming the file when the bytes cannot be decoded.
 */
export async function prepareForPdf(file: File): Promise<PreparedImage> {
  const bytes = new Uint8Array(await file.arrayBuffer());

  switch (sniffImageKind(bytes)) {
    case "jpeg":
      return { pages: [{ bytes, type: "image/jpeg" }], warnings: [] };
    case "png":
      return {
        pages: [{ bytes, type: "image/png" }],
        // PDF stores 8 bits per channel; pdf-lib's PNG decoder truncates
        // 16-bit samples to their high byte. Rare, but never silent.
        warnings:
          pngBitDepth(bytes) === 16
            ? ["This PNG uses 16-bit color — PDF stores 8 bits per channel, so it was reduced to 8-bit."]
            : [],
      };
    case "tiff":
      return prepareTiff(file, bytes);
    default:
      return prepareViaDecode(file);
  }
}

function undecodableError(file: File): Error {
  return new Error(
    `Could not read ${file.name} — the file appears to be corrupt or is not a supported image.`,
  );
}

/**
 * Every TIFF page becomes one prepared page. Pages decode lazily, one at a
 * time, and each canvas is released before the next page decodes — scan/fax
 * TIFFs run to hundreds of pages, and holding all their RGBA at once would
 * OOM a mobile tab.
 */
async function prepareTiff(file: File, bytes: Uint8Array): Promise<PreparedImage> {
  let doc;
  try {
    doc = await openTiff(bytes.buffer as ArrayBuffer);
  } catch {
    throw undecodableError(file);
  }

  const pages: PreparedPage[] = [];
  for (let i = 0; i < doc.pageCount; i++) {
    let rgba: Uint8Array;
    let width: number;
    let height: number;
    try {
      ({ rgba, width, height } = doc.page(i));
    } catch {
      throw undecodableError(file);
    }
    // utif2 parses leniently: a corrupt file can hand back an IFD with zero
    // or absurd dimensions rather than throwing. Refuse it here, not as a
    // canvas error three steps later.
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      rgba.length < width * height * 4
    ) {
      throw undecodableError(file);
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context not available");
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(rgba);
    ctx.putImageData(imageData, 0, 0);

    pages.push(await encodeCanvas(canvas, rgbaHasTransparency(rgba)));
  }
  return { pages, warnings: [] };
}

/**
 * WebP, HEIC, and anything else the platform can decode. HEIC arrives as a
 * heic2any-produced PNG blob; animated GIF/WebP sources carry the frame-0
 * warning that `toDecodableSource` sniffed — the decode below keeps only
 * frame 0, and the notice is what keeps that honest.
 */
async function prepareViaDecode(file: File): Promise<PreparedImage> {
  let source;
  try {
    source = await toDecodableSource(file);
  } catch {
    throw undecodableError(file);
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source.blob);
  } catch {
    throw undecodableError(file);
  }

  try {
    if (bitmap.width === 0 || bitmap.height === 0) throw undecodableError(file);

    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context not available");
    ctx.drawImage(bitmap, 0, 0);

    // Full-resolution alpha scan: a wrong "opaque" verdict would flatten real
    // transparency onto a JPEG's black background, so no downsampled probe.
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const page = await encodeCanvas(canvas, rgbaHasTransparency(data));
    return { pages: [page], warnings: source.warnings };
  } finally {
    bitmap.close();
  }
}

/** The transparent→PNG / opaque→JPEG(0.92) policy, applied to one canvas. */
async function encodeCanvas(
  canvas: HTMLCanvasElement,
  transparent: boolean,
): Promise<PreparedPage> {
  const type: PreparedPageType = transparent ? "image/png" : "image/jpeg";
  const blob = await canvasToBlob(
    canvas,
    type,
    type === "image/jpeg" ? PDF_JPEG_QUALITY : undefined,
  );
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type };
}
