declare module "gifenc" {
  type RGB = [number, number, number];

  interface GIFEncoderInstance {
    writeHeader(): void;
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: {
        transparent?: boolean;
        transparentIndex?: number;
        delay?: number;
        palette?: RGB[];
        repeat?: number;
        colorDepth?: number;
        dispose?: number;
        first?: boolean;
      },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
  }

  export function GIFEncoder(options?: {
    initialCapacity?: number;
    auto?: boolean;
  }): GIFEncoderInstance;

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: string },
  ): RGB[];

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: RGB[],
    format?: string,
  ): Uint8Array;
}
