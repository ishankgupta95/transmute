import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock ExifReader
vi.mock("exifreader", () => ({
  default: {
    load: vi.fn(),
  },
}));

import { readExifData, stripExifData } from "@/lib/tools/exif-viewer";
import ExifReader from "exifreader";

let mockCtx: Record<string, ReturnType<typeof vi.fn>>;
let mockCanvas: Record<string, unknown>;

function setupCanvasMock() {
  mockCtx = {
    drawImage: vi.fn(),
  };
  mockCanvas = {
    width: 0,
    height: 0,
    getContext: vi.fn().mockReturnValue(mockCtx),
    toBlob: vi.fn().mockImplementation((cb: (b: Blob | null) => void, type: string) => {
      cb(new Blob(["stripped"], { type }));
    }),
  };
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "canvas") return mockCanvas as unknown as HTMLCanvasElement;
    return document.createElement(tag);
  });
}

function setupImageMock(naturalWidth = 640, naturalHeight = 480) {
  global.URL.createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
  global.URL.revokeObjectURL = vi.fn();

  vi.spyOn(global, "Image").mockImplementation(function (this: Record<string, unknown>) {
    this.naturalWidth = naturalWidth;
    this.naturalHeight = naturalHeight;
    this.onload = null;
    this.onerror = null;
    this._src = "";
    const self = this;
    Object.defineProperty(this, "src", {
      get() { return self._src; },
      set(val: string) {
        self._src = val;
        setTimeout(() => { if (self.onload) (self.onload as () => void)(); }, 0);
      },
    });
    return this as unknown as HTMLImageElement;
  } as unknown as () => HTMLImageElement);
}

function setupImageErrorMock() {
  vi.spyOn(global, "Image").mockImplementation(function (this: Record<string, unknown>) {
    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.onload = null;
    this.onerror = null;
    this._src = "";
    const self = this;
    Object.defineProperty(this, "src", {
      get() { return self._src; },
      set(val: string) {
        self._src = val;
        setTimeout(() => { if (self.onerror) (self.onerror as () => void)(); }, 0);
      },
    });
    return this as unknown as HTMLImageElement;
  } as unknown as () => HTMLImageElement);
}

function makeFile(name: string): File {
  return new File(["image-data"], name, { type: "image/jpeg" });
}

describe("readExifData", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reads EXIF entries from multiple groups", async () => {
    vi.mocked(ExifReader.load).mockReturnValue({
      exif: {
        Make: { description: "Canon" },
        Model: { description: "EOS R5" },
      },
      gps: {
        GPSLatitude: { description: "37.7749" },
      },
      iptc: {},
      xmp: {
        Creator: { description: "John Doe" },
      },
      icc: {},
    } as unknown as ReturnType<typeof ExifReader.load>);

    const file = makeFile("photo.jpg");
    const entries = await readExifData(file);

    expect(entries).toHaveLength(4);
    expect(entries).toContainEqual({ tag: "Make", value: "Canon", group: "exif" });
    expect(entries).toContainEqual({ tag: "Model", value: "EOS R5", group: "exif" });
    expect(entries).toContainEqual({ tag: "GPSLatitude", value: "37.7749", group: "gps" });
    expect(entries).toContainEqual({ tag: "Creator", value: "John Doe", group: "xmp" });
  });

  it("filters entries with undefined description", async () => {
    vi.mocked(ExifReader.load).mockReturnValue({
      exif: {
        Make: { description: "Canon" },
        BadTag: { description: "undefined" },
      },
      gps: {}, iptc: {}, xmp: {}, icc: {},
    } as unknown as ReturnType<typeof ExifReader.load>);

    const file = makeFile("photo.jpg");
    const entries = await readExifData(file);

    expect(entries).toHaveLength(1);
    expect(entries[0].tag).toBe("Make");
  });

  it("filters entries with [object Object] description", async () => {
    vi.mocked(ExifReader.load).mockReturnValue({
      exif: {
        Weird: { description: "[object Object]" },
        Good: { description: "Valid" },
      },
      gps: {}, iptc: {}, xmp: {}, icc: {},
    } as unknown as ReturnType<typeof ExifReader.load>);

    const file = makeFile("photo.jpg");
    const entries = await readExifData(file);

    expect(entries).toHaveLength(1);
    expect(entries[0].value).toBe("Valid");
  });

  it("filters entries with empty description", async () => {
    vi.mocked(ExifReader.load).mockReturnValue({
      exif: {
        Empty: { description: "" },
        OK: { description: "Something" },
      },
      gps: {}, iptc: {}, xmp: {}, icc: {},
    } as unknown as ReturnType<typeof ExifReader.load>);

    const file = makeFile("photo.jpg");
    const entries = await readExifData(file);

    expect(entries).toHaveLength(1);
    expect(entries[0].tag).toBe("OK");
  });

  it("filters entries without description property", async () => {
    vi.mocked(ExifReader.load).mockReturnValue({
      exif: {
        NoDesc: { value: 42 },
        WithDesc: { description: "Hello" },
      },
      gps: {}, iptc: {}, xmp: {}, icc: {},
    } as unknown as ReturnType<typeof ExifReader.load>);

    const file = makeFile("photo.jpg");
    const entries = await readExifData(file);

    expect(entries).toHaveLength(1);
    expect(entries[0].tag).toBe("WithDesc");
  });

  it("returns empty array when no metadata present", async () => {
    vi.mocked(ExifReader.load).mockReturnValue({
      exif: {}, gps: {}, iptc: {}, xmp: {}, icc: {},
    } as unknown as ReturnType<typeof ExifReader.load>);

    const file = makeFile("clean.jpg");
    const entries = await readExifData(file);
    expect(entries).toEqual([]);
  });

  it("handles missing groups gracefully (undefined groups)", async () => {
    vi.mocked(ExifReader.load).mockReturnValue(
      {} as unknown as ReturnType<typeof ExifReader.load>,
    );

    const file = makeFile("minimal.jpg");
    const entries = await readExifData(file);
    expect(entries).toEqual([]);
  });

  it("passes expanded: true to ExifReader.load", async () => {
    vi.mocked(ExifReader.load).mockReturnValue({
      exif: {}, gps: {}, iptc: {}, xmp: {}, icc: {},
    } as unknown as ReturnType<typeof ExifReader.load>);

    const file = makeFile("photo.jpg");
    await readExifData(file);

    expect(ExifReader.load).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      { expanded: true },
    );
  });

  it("converts non-string description to string", async () => {
    vi.mocked(ExifReader.load).mockReturnValue({
      exif: { NumericTag: { description: 12345 } },
      gps: {}, iptc: {}, xmp: {}, icc: {},
    } as unknown as ReturnType<typeof ExifReader.load>);

    const file = makeFile("photo.jpg");
    const entries = await readExifData(file);

    expect(entries).toHaveLength(1);
    expect(entries[0].value).toBe("12345");
  });
});

describe("stripExifData", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setupCanvasMock();
    setupImageMock();
  });

  it("re-encodes as JPEG to strip metadata", async () => {
    const file = makeFile("photo.jpg");
    const result = await stripExifData(file);

    expect(result.blob.type).toBe("image/jpeg");
    expect(result.fileName).toBe("photo-clean.jpg");
  });

  it("uses default quality 0.92", async () => {
    const file = makeFile("photo.jpg");
    await stripExifData(file);

    expect((mockCanvas.toBlob as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      expect.any(Function), "image/jpeg", 0.92,
    );
  });

  it("accepts custom quality parameter", async () => {
    const file = makeFile("photo.jpg");
    await stripExifData(file, 0.75);

    expect((mockCanvas.toBlob as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      expect.any(Function), "image/jpeg", 0.75,
    );
  });

  it("sets canvas to image natural dimensions", async () => {
    setupImageMock(1920, 1080);
    const file = makeFile("photo.jpg");
    await stripExifData(file);

    expect(mockCanvas.width).toBe(1920);
    expect(mockCanvas.height).toBe(1080);
  });

  it("reports correct originalSize and newSize", async () => {
    const file = makeFile("photo.jpg");
    const result = await stripExifData(file);

    expect(result.originalSize).toBe(file.size);
    expect(result.newSize).toBe(result.blob.size);
  });

  it("strips extension from multi-dot filenames", async () => {
    const file = makeFile("my.photo.jpeg");
    const result = await stripExifData(file);
    expect(result.fileName).toBe("my.photo-clean.jpg");
  });

  it("rejects when image fails to load", async () => {
    setupImageErrorMock();
    const file = makeFile("bad.jpg");
    await expect(stripExifData(file)).rejects.toThrow("Failed to load image");
  });

  it("rejects when canvas context is null", async () => {
    mockCanvas.getContext = vi.fn().mockReturnValue(null);
    const file = makeFile("photo.jpg");
    await expect(stripExifData(file)).rejects.toThrow("Canvas 2D context not available");
  });

  it("rejects when toBlob returns null", async () => {
    (mockCanvas.toBlob as ReturnType<typeof vi.fn>).mockImplementation(
      (cb: (b: Blob | null) => void) => { cb(null); },
    );
    const file = makeFile("photo.jpg");
    await expect(stripExifData(file)).rejects.toThrow("Canvas export failed");
  });
});
