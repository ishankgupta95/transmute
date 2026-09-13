/**
 * omggif 1.0.10 (MIT) ships no types. Only the reader half is declared,
 * because only the reader is used: GIFs are WRITTEN here with `gifenc`, which
 * quantises better and is already bundled for `video-to-gif`.
 *
 * Field names are snake_case because they are omggif's own, read off a real
 * decode rather than copied from the README.
 */
declare module "omggif" {
  export interface GifFrameInfo {
    x: number;
    y: number;
    width: number;
    height: number;
    has_local_palette: boolean;
    palette_offset: number;
    palette_size: number;
    data_offset: number;
    data_length: number;
    transparent_index: number | null;
    interlaced: boolean;
    /**
     * HUNDREDTHS of a second, as the GIF format stores it — not milliseconds.
     * Verified against a file written with known 100/200/300 ms delays, which
     * read back as 10/20/30.
     */
    delay: number;
    disposal: number;
  }

  export class GifReader {
    constructor(buffer: Uint8Array);
    readonly width: number;
    readonly height: number;
    numFrames(): number;
    frameInfo(index: number): GifFrameInfo;
    /**
     * COMPOSITES frame `index` onto whatever `pixels` already holds — that is
     * how GIF disposal methods and partial frames work. Reusing one buffer
     * across frames is required, not an optimisation.
     */
    decodeAndBlitFrameRGBA(index: number, pixels: Uint8Array | Uint8ClampedArray): void;
  }

  export class GifWriter {
    constructor(buffer: Uint8Array, width: number, height: number, options?: object);
  }
}
