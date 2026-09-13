import type { ImageCompressOptions } from "@/lib/tools/image-compress";
import type { ImageConvertOptions } from "@/lib/tools/image-convert";
import type { ImageResizeOptions } from "@/lib/tools/image-resize";

/**
 * Message shapes shared by image-client.ts (main thread) and image.worker.ts.
 * Types only — this module must stay import-safe in both contexts.
 */

interface ImageJobBase {
  fileName: string;
  fileType: string;
  fileSize: number;
  /** Encoded source bytes, for formats the worker decodes itself. Transferred. */
  bytes?: ArrayBuffer;
  /**
   * Pre-decoded pixels for formats that need main-thread help (HEIC via
   * libheif, TIFF via utif2). Transferred.
   */
  bitmap?: ImageBitmap;
}

/** Output formats every edit verb can write. */
export type EditOutputFormat = "png" | "jpeg" | "webp";

export interface EditRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One tile / preset produced by a multi-output edit. */
export interface EditOutputSpec {
  label: string;
  width: number;
  height: number;
}

/**
 * The eight edit verbs, as data. The geometry every one of them implies lives
 * in lib/tools/image-edit-core.ts and is shared by both pipelines — nothing
 * here decides pixels, it only says what the user asked for.
 */
export type ImageEditOptions =
  | { kind: "rotate"; degrees: 90 | 180 | 270 }
  | { kind: "flip"; axis: "horizontal" | "vertical" }
  | {
      kind: "watermark";
      text: string;
      /** 0-1 of the SHORTER edge; the drawn font size is derived from it. */
      scale: number;
      opacity: number; // 0-1
      colour: string; // "#rrggbb"
      position: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center" | "tile";
      rotationDeg: number; // -90..90
    }
  | { kind: "pixelate"; region: EditRect | null; blockSize: number }
  | { kind: "crop-circle"; /** null = the largest inscribed circle */ region: EditRect | null }
  | { kind: "border"; top: number; right: number; bottom: number; left: number; colour: string }
  | { kind: "split"; rows: number; cols: number }
  | { kind: "presets"; outputs: EditOutputSpec[]; fit: "cover" | "contain"; padColour: string };

export interface ImageEditJobOptions {
  edit: ImageEditOptions;
  format: EditOutputFormat;
  /** 0-1. Ignored for png. */
  quality: number;
}

export interface PngOptimiseOptions {
  /** oxipng level. 1-4 ONLY — 5 and 6 return byte-identical output at 2x the time. */
  level: 1 | 2 | 3 | 4;
  /** Rewrites fully-transparent pixels only. Off by default. */
  optimiseAlpha: boolean;
}

export type ImageJob =
  | (ImageJobBase & { op: "convert"; options: ImageConvertOptions })
  | (ImageJobBase & { op: "compress"; options: ImageCompressOptions })
  | (ImageJobBase & { op: "resize"; options: ImageResizeOptions })
  | (ImageJobBase & { op: "edit"; options: ImageEditJobOptions })
  | (ImageJobBase & { op: "optimise-png"; options: PngOptimiseOptions });

interface ImageJobResultBase {
  /**
   * User-facing notices about what processing kept (e.g. an animated source
   * flattened to frame 0). Plain strings — they clone across the boundary.
   * Loss warnings attach only to re-encoded (kind:"blob") outputs: never-grow
   * handing back the untouched original delivers every frame and page, so the
   * client drops any warnings that reach a kind:"original" result.
   */
  warnings?: string[];
}

export type ImageJobResult =
  | (ImageJobResultBase & {
      kind: "blob";
      /** Encoded output. Transferred back. */
      bytes: ArrayBuffer;
      mime: string;
      /** Output extension, decided in the worker (compress picks webp vs jpg). */
      ext: string;
      width: number;
      height: number;
    })
  /** The compressor's never-grow guard: the untouched original wins. */
  | (ImageJobResultBase & { kind: "original" })
  /**
   * Multi-output edits (split, presets). `items` are transferred individually:
   * every items[i].bytes must appear in the worker's postMessage transfer list
   * or each one is silently CLONED instead of moved — the same branch
   * pdf.worker.ts:60-81 documents for splitPdfToPages.
   */
  | (ImageJobResultBase & {
      kind: "blobs";
      items: {
        bytes: ArrayBuffer;
        mime: string;
        ext: string;
        width: number;
        height: number;
        /** Filename stem suffix, e.g. "r1c2" or "instagram-square". */
        label: string;
      }[];
    })
  /** compress-png. `identical` is TRUE when oxipng returned the input byte-for-byte. */
  | (ImageJobResultBase & {
      kind: "png";
      bytes: ArrayBuffer;
      width: number;
      height: number;
      identical: boolean;
      /** oxipng level actually used. */
      level: number;
      /** PNG colour type + bit depth BEFORE and AFTER, read out of IHDR. */
      colourBefore: string;
      colourAfter: string;
    });
