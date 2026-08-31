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

  it("formats terabytes and petabytes instead of indexing off the unit table", () => {
    expect(formatFileSize(1024 ** 4)).toBe("1.0 TB");
    expect(formatFileSize(1024 ** 5)).toBe("1.0 PB");
  });

  it("clamps beyond the table to the largest unit — never 'undefined'", () => {
    expect(formatFileSize(1024 ** 6)).toBe("1024.0 PB");
  });

  it("renders a dash for garbage input — never 'NaN'", () => {
    expect(formatFileSize(NaN)).toBe("—");
    expect(formatFileSize(-1)).toBe("—");
    expect(formatFileSize(Infinity)).toBe("—");
  });
});
