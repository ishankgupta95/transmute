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
    fillRect: vi.fn(),
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
    // eslint-disable-next-line @typescript-eslint/no-this-alias
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
    // eslint-disable-next-line @typescript-eslint/no-this-alias
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

  /**
   * Regression guard. With `expanded: true`, ExifReader's `gps` group is a
   * *computed* block of plain numbers — not `{ description }` tag objects —
   * and the raw GPS* tags are filed under `exif`. The mocks above use a shape
   * the library never emits, which is why a broken GPS path passed unit tests
   * while the real tool reported "Location: none" for every geotagged photo.
   * These cases mirror actual `ExifReader.load` output.
   */
  describe("real ExifReader expanded output", () => {
    const realShape = {
      exif: {
        Make: { description: "Transmute" },
        GPSLatitude: { description: 37.825361111111114 },
        GPSLatitudeRef: { description: "North latitude" },
        GPSLongitude: { description: 122.47500000000001 },
        GPSLongitudeRef: { description: "West longitude" },
      },
      gps: { Latitude: 37.825361111111114, Longitude: -122.47500000000001, Altitude: 67 },
      iptc: {}, xmp: {}, icc: {},
    } as unknown as ReturnType<typeof ExifReader.load>;

    it("reads the computed numeric gps block", async () => {
      vi.mocked(ExifReader.load).mockReturnValue(realShape);
      const entries = await readExifData(makeFile("geotagged.jpg"));

      expect(entries).toContainEqual({ tag: "Latitude", value: "37.825361", group: "gps" });
      // The computed block is signed, unlike the raw magnitude-plus-ref tags.
      expect(entries).toContainEqual({ tag: "Longitude", value: "-122.475", group: "gps" });
      expect(entries).toContainEqual({ tag: "Altitude", value: "67", group: "gps" });
    });

    it("groups raw GPS* tags under gps so the location warning fires", async () => {
      vi.mocked(ExifReader.load).mockReturnValue(realShape);
      const entries = await readExifData(makeFile("geotagged.jpg"));

      // `hasGps` in ExifViewerUI keys off group === "gps"; without this the
      // "strip before sharing" warning never renders.
      expect(entries.some((e) => e.group === "gps")).toBe(true);
      for (const tag of ["GPSLatitude", "GPSLatitudeRef", "GPSLongitude", "GPSLongitudeRef"]) {
        expect(entries.find((e) => e.tag === tag)?.group).toBe("gps");
      }
      // Non-GPS exif tags stay put.
      expect(entries.find((e) => e.tag === "Make")?.group).toBe("exif");
    });

    it("trims float noise from coordinates", async () => {
      vi.mocked(ExifReader.load).mockReturnValue(realShape);
      const entries = await readExifData(makeFile("geotagged.jpg"));
      expect(entries.find((e) => e.tag === "GPSLatitude")?.value).toBe("37.825361");
    });

    it("reports no gps group for an image without location", async () => {
      vi.mocked(ExifReader.load).mockReturnValue({
        exif: { Make: { description: "Transmute" } },
        gps: {}, iptc: {}, xmp: {}, icc: {},
      } as unknown as ReturnType<typeof ExifReader.load>);
      const entries = await readExifData(makeFile("clean.jpg"));
      expect(entries.some((e) => e.group === "gps")).toBe(false);
    });
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

/*
  The APP1 sweep exists because Safari's canvas encoder writes its OWN Exif
  into fresh JPEGs — re-encoding alone doesn't guarantee a metadata-free file.
*/
import { removeApp1Segments } from "@/lib/tools/exif-viewer";

function seg(marker: number, payload: number[]): number[] {
  const len = payload.length + 2;
  return [0xff, marker, len >> 8, len & 0xff, ...payload];
}

describe("removeApp1Segments", () => {
  it("drops APP1 but keeps APP0, APP2 and the scan data", () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8, // SOI
      ...seg(0xe0, [0x4a, 0x46, 0x49, 0x46]), // APP0 JFIF
      ...seg(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, 1, 2]), // APP1 Exif
      ...seg(0xe2, [0x49, 0x43, 0x43]), // APP2 ICC
      0xff, 0xda, 0x00, 0x04, 0x01, 0x02, // SOS + entropy bytes
      0xff, 0xd9, // EOI
    ]);
    const out = removeApp1Segments(jpeg);
    const hex = Buffer.from(out).toString("hex");
    expect(hex).not.toContain("ffe1");
    expect(hex).toContain("ffe0");
    expect(hex).toContain("ffe2");
    expect(hex).toContain("ffda");
    expect(hex.endsWith("ffd9")).toBe(true);
  });

  it("drops multiple APP1s (Exif + XMP)", () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8,
      ...seg(0xe1, [1, 2, 3]),
      ...seg(0xe1, [4, 5, 6, 7]),
      0xff, 0xda, 0x00, 0x02, 0xaa,
    ]);
    const out = removeApp1Segments(jpeg);
    expect(Buffer.from(out).toString("hex")).not.toContain("ffe1");
    expect(out.length).toBe(jpeg.length - 7 - 8);
  });

  it("returns non-JPEG and APP1-less input unchanged", () => {
    const notJpeg = new Uint8Array([1, 2, 3, 4]);
    expect(removeApp1Segments(notJpeg)).toBe(notJpeg);
    const clean = new Uint8Array([0xff, 0xd8, ...seg(0xe0, [1]), 0xff, 0xda, 0x00, 0x02, 0xbb]);
    expect(Array.from(removeApp1Segments(clean))).toEqual(Array.from(clean));
  });
});
