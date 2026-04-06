import { describe, it, expect } from "vitest";
import { formatFileSize, getExtension, getMimeType } from "@/lib/utils/file-helpers";

describe("formatFileSize", () => {
  it("formats 0 bytes", () => {
    expect(formatFileSize(0)).toBe("0 B");
  });

  it("formats bytes", () => {
    expect(formatFileSize(500)).toBe("500 B");
  });

  it("formats kilobytes", () => {
    expect(formatFileSize(1024)).toBe("1.0 KB");
  });

  it("formats megabytes", () => {
    expect(formatFileSize(1048576)).toBe("1.0 MB");
  });

  it("formats fractional megabytes", () => {
    expect(formatFileSize(2621440)).toBe("2.5 MB");
  });
});

describe("getExtension", () => {
  it("returns the file extension", () => {
    expect(getExtension("photo.jpg")).toBe("jpg");
  });

  it("returns lowercase", () => {
    expect(getExtension("photo.PNG")).toBe("png");
  });

  it("handles multiple dots", () => {
    expect(getExtension("archive.tar.gz")).toBe("gz");
  });
});

describe("getMimeType", () => {
  it("returns correct MIME for jpg", () => {
    expect(getMimeType("photo.jpg")).toBe("image/jpeg");
  });

  it("returns correct MIME for png", () => {
    expect(getMimeType("image.png")).toBe("image/png");
  });

  it("returns correct MIME for pdf", () => {
    expect(getMimeType("doc.pdf")).toBe("application/pdf");
  });

  it("returns octet-stream for unknown types", () => {
    expect(getMimeType("file.xyz")).toBe("application/octet-stream");
  });
});
