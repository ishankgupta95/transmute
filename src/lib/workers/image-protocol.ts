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
   * heic2any, TIFF via utif2). Transferred.
   */
  bitmap?: ImageBitmap;
}

export type ImageJob =
  | (ImageJobBase & { op: "convert"; options: ImageConvertOptions })
  | (ImageJobBase & { op: "compress"; options: ImageCompressOptions })
  | (ImageJobBase & { op: "resize"; options: ImageResizeOptions });

export type ImageJobResult =
  | {
      kind: "blob";
      /** Encoded output. Transferred back. */
      bytes: ArrayBuffer;
      mime: string;
      /** Output extension, decided in the worker (compress picks webp vs jpg). */
      ext: string;
      width: number;
      height: number;
    }
  /** The compressor's never-grow guard: the untouched original wins. */
  | { kind: "original" };
