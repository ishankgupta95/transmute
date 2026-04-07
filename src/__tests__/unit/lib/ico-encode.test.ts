import { describe, it, expect, vi, beforeEach } from "vitest";

import { encodeIcoAsync, encodeIco } from "@/lib/tools/ico-encode";

function makeMockCanvas(size: number) {
  const pngData = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...Array(20).fill(0)]); // fake PNG
  return {
    width: size,
    height: size,
    getContext: vi.fn(),
    toBlob: vi.fn().mockImplementation((cb: (b: Blob | null) => void, type: string) => {
      cb(new Blob([pngData], { type }));
    }),
  } as unknown as HTMLCanvasElement;
}

describe("encodeIcoAsync", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a Blob with type image/x-icon", async () => {
    const images = [{ canvas: makeMockCanvas(32), size: 32 }];
    const blob = await encodeIcoAsync(images);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/x-icon");
  });

  it("writes correct ICO header (reserved=0, type=1, count)", async () => {
    const images = [
      { canvas: makeMockCanvas(16), size: 16 },
      { canvas: makeMockCanvas(32), size: 32 },
    ];
    const blob = await encodeIcoAsync(images);
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);

    // Reserved: 0
    expect(view.getUint16(0, true)).toBe(0);
    // Type: 1 (ICO)
    expect(view.getUint16(2, true)).toBe(1);
    // Image count
    expect(view.getUint16(4, true)).toBe(2);
  });

  it("writes correct directory entry for a single 32px icon", async () => {
    const images = [{ canvas: makeMockCanvas(32), size: 32 }];
    const blob = await encodeIcoAsync(images);
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);

    const dirOffset = 6; // after 6-byte header
    // Width
    expect(view.getUint8(dirOffset)).toBe(32);
    // Height
    expect(view.getUint8(dirOffset + 1)).toBe(32);
    // Color palette
    expect(view.getUint8(dirOffset + 2)).toBe(0);
    // Reserved
    expect(view.getUint8(dirOffset + 3)).toBe(0);
    // Color planes
    expect(view.getUint16(dirOffset + 4, true)).toBe(1);
    // Bits per pixel
    expect(view.getUint16(dirOffset + 6, true)).toBe(32);
    // Data offset (header 6 + 1 dir entry 16 = 22)
    expect(view.getUint32(dirOffset + 12, true)).toBe(22);
  });

  it("encodes 256px size as 0 in directory entry", async () => {
    const images = [{ canvas: makeMockCanvas(256), size: 256 }];
    const blob = await encodeIcoAsync(images);
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);

    const dirOffset = 6;
    // Width: 0 means 256
    expect(view.getUint8(dirOffset)).toBe(0);
    // Height: 0 means 256
    expect(view.getUint8(dirOffset + 1)).toBe(0);
  });

  it("writes correct data offsets for multiple images", async () => {
    const images = [
      { canvas: makeMockCanvas(16), size: 16 },
      { canvas: makeMockCanvas(32), size: 32 },
      { canvas: makeMockCanvas(48), size: 48 },
    ];
    const blob = await encodeIcoAsync(images);
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);

    const headerSize = 6;
    const dirSize = 16 * 3;
    let expectedOffset = headerSize + dirSize;

    for (let i = 0; i < 3; i++) {
      const dirOffset = headerSize + i * 16;
      const dataOffset = view.getUint32(dirOffset + 12, true);
      expect(dataOffset).toBe(expectedOffset);

      const imageSize = view.getUint32(dirOffset + 8, true);
      expectedOffset += imageSize;
    }
  });

  it("stores PNG image data after directory entries", async () => {
    const images = [{ canvas: makeMockCanvas(32), size: 32 }];
    const blob = await encodeIcoAsync(images);
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);

    const dirOffset = 6;
    const dataOffset = view.getUint32(dirOffset + 12, true);
    const dataSize = view.getUint32(dirOffset + 8, true);

    // Verify the data area has expected size
    expect(dataSize).toBeGreaterThan(0);
    // Total file = header + dir + data
    expect(buffer.byteLength).toBe(6 + 16 + dataSize);

    // First byte of PNG data should be 0x89 (PNG signature)
    expect(view.getUint8(dataOffset)).toBe(0x89);
  });

  it("handles a single 16px icon", async () => {
    const images = [{ canvas: makeMockCanvas(16), size: 16 }];
    const blob = await encodeIcoAsync(images);
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);

    expect(view.getUint16(4, true)).toBe(1); // count
    expect(view.getUint8(6)).toBe(16); // width
  });

  it("handles standard favicon sizes (16, 32, 48)", async () => {
    const images = [
      { canvas: makeMockCanvas(16), size: 16 },
      { canvas: makeMockCanvas(32), size: 32 },
      { canvas: makeMockCanvas(48), size: 48 },
    ];
    const blob = await encodeIcoAsync(images);
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);

    expect(view.getUint16(4, true)).toBe(3); // 3 images
    expect(view.getUint8(6)).toBe(16);
    expect(view.getUint8(6 + 16)).toBe(32);
    expect(view.getUint8(6 + 32)).toBe(48);
  });

  it("rejects when canvas.toBlob returns null", async () => {
    const badCanvas = {
      width: 32,
      height: 32,
      getContext: vi.fn(),
      toBlob: vi.fn().mockImplementation((cb: (b: Blob | null) => void) => { cb(null); }),
    } as unknown as HTMLCanvasElement;

    const images = [{ canvas: badCanvas, size: 32 }];
    await expect(encodeIcoAsync(images)).rejects.toThrow("Canvas export failed");
  });

  it("directory entry image data size matches actual PNG buffer size", async () => {
    const images = [{ canvas: makeMockCanvas(64), size: 64 }];
    const blob = await encodeIcoAsync(images);
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);

    const dirOffset = 6;
    const recordedSize = view.getUint32(dirOffset + 8, true);
    const dataOffset = view.getUint32(dirOffset + 12, true);

    // The actual data should span from dataOffset to end of buffer
    expect(buffer.byteLength - dataOffset).toBe(recordedSize);
  });
});

describe("encodeIco (sync placeholder)", () => {
  it("returns an empty Blob", () => {
    const images = [{ canvas: makeMockCanvas(32), size: 32 }];
    const blob = encodeIco(images);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBe(0);
  });
});
