import { describe, it, expect } from "vitest";
import { formatFileSize } from "@/lib/utils/file-helpers";

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
