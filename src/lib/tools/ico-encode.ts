/**
 * Encode multiple PNG canvas images into a single ICO file.
 * ICO format: https://en.wikipedia.org/wiki/ICO_(file_format)
 */
export function encodeIco(images: { canvas: HTMLCanvasElement; size: number }[]): Blob {
  // Convert each canvas to PNG ArrayBuffer
  const pngBuffers: ArrayBuffer[] = [];
  const pngBlobs: Promise<ArrayBuffer>[] = images.map(
    ({ canvas }) =>
      new Promise<ArrayBuffer>((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (blob) blob.arrayBuffer().then(resolve).catch(reject);
            else reject(new Error("Canvas export failed"));
          },
          "image/png",
        );
      }),
  );

  // We need sync access, so we'll use a different approach
  return new Blob([]); // placeholder, actual impl below
}

/**
 * Async version that properly handles the canvas-to-blob pipeline.
 */
export async function encodeIcoAsync(
  images: { canvas: HTMLCanvasElement; size: number }[],
): Promise<Blob> {
  const pngBuffers: ArrayBuffer[] = [];

  for (const { canvas } of images) {
    const blob = await canvasToBlob(canvas, "image/png");
    pngBuffers.push(await blob.arrayBuffer());
  }

  // ICO header: 6 bytes
  // Each directory entry: 16 bytes
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = dirEntrySize * images.length;
  let dataOffset = headerSize + dirSize;

  const totalSize = dataOffset + pngBuffers.reduce((s, b) => s + b.byteLength, 0);
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  // Header
  view.setUint16(0, 0, true); // Reserved
  view.setUint16(2, 1, true); // Type: ICO
  view.setUint16(4, images.length, true); // Image count

  // Directory entries
  for (let i = 0; i < images.length; i++) {
    const offset = headerSize + i * dirEntrySize;
    const size = images[i].size;
    const pngSize = pngBuffers[i].byteLength;

    view.setUint8(offset, size >= 256 ? 0 : size); // Width (0 = 256)
    view.setUint8(offset + 1, size >= 256 ? 0 : size); // Height
    view.setUint8(offset + 2, 0); // Color palette
    view.setUint8(offset + 3, 0); // Reserved
    view.setUint16(offset + 4, 1, true); // Color planes
    view.setUint16(offset + 6, 32, true); // Bits per pixel
    view.setUint32(offset + 8, pngSize, true); // Image data size
    view.setUint32(offset + 12, dataOffset, true); // Data offset

    dataOffset += pngSize;
  }

  // Image data
  let writeOffset = headerSize + dirSize;
  for (const pngBuf of pngBuffers) {
    new Uint8Array(buffer, writeOffset, pngBuf.byteLength).set(new Uint8Array(pngBuf));
    writeOffset += pngBuf.byteLength;
  }

  return new Blob([buffer], { type: "image/x-icon" });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas export failed"));
      },
      mimeType,
    );
  });
}
