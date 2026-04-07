import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock analytics before importing download
vi.mock("@/lib/utils/analytics", () => ({
  trackEvent: vi.fn(),
}));

import { triggerDownload } from "@/lib/utils/download";
import { trackEvent } from "@/lib/utils/analytics";

const mockTrackEvent = vi.mocked(trackEvent);

describe("triggerDownload", () => {
  let mockClick: ReturnType<typeof vi.fn>;
  let mockCreateObjectURL: ReturnType<typeof vi.fn>;
  let mockRevokeObjectURL: ReturnType<typeof vi.fn>;
  let appendChildSpy: ReturnType<typeof vi.spyOn>;
  let removeChildSpy: ReturnType<typeof vi.spyOn>;
  let createdAnchor: HTMLAnchorElement;

  beforeEach(() => {
    mockClick = vi.fn();
    mockCreateObjectURL = vi.fn().mockReturnValue("blob:http://localhost/fake-url");
    mockRevokeObjectURL = vi.fn();
    mockTrackEvent.mockClear();

    URL.createObjectURL = mockCreateObjectURL;
    URL.revokeObjectURL = mockRevokeObjectURL;

    // Spy on document.createElement to capture the anchor element
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string, options?: ElementCreationOptions) => {
      const el = origCreateElement(tag, options);
      if (tag === "a") {
        createdAnchor = el as HTMLAnchorElement;
        createdAnchor.click = mockClick;
      }
      return el;
    });

    appendChildSpy = vi.spyOn(document.body, "appendChild");
    removeChildSpy = vi.spyOn(document.body, "removeChild");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates an object URL from the blob", () => {
    const blob = new Blob(["test"], { type: "text/plain" });
    triggerDownload(blob, "test.txt");

    expect(mockCreateObjectURL).toHaveBeenCalledWith(blob);
  });

  it("sets the href and download attributes on the anchor", () => {
    const blob = new Blob(["test"], { type: "text/plain" });
    triggerDownload(blob, "output.png");

    expect(createdAnchor.href).toContain("blob:");
    expect(createdAnchor.download).toBe("output.png");
  });

  it("appends the anchor to document.body and then removes it", () => {
    const blob = new Blob(["test"], { type: "text/plain" });
    triggerDownload(blob, "test.txt");

    expect(appendChildSpy).toHaveBeenCalledWith(createdAnchor);
    expect(removeChildSpy).toHaveBeenCalledWith(createdAnchor);
  });

  it("triggers a click on the anchor element", () => {
    const blob = new Blob(["test"], { type: "text/plain" });
    triggerDownload(blob, "test.txt");

    expect(mockClick).toHaveBeenCalledTimes(1);
  });

  it("revokes the object URL after download", () => {
    const blob = new Blob(["test"], { type: "text/plain" });
    triggerDownload(blob, "test.txt");

    expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:http://localhost/fake-url");
  });

  it("sends analytics event with file extension and size", () => {
    const content = "x".repeat(2048);
    const blob = new Blob([content], { type: "text/plain" });
    triggerDownload(blob, "report.pdf");

    expect(mockTrackEvent).toHaveBeenCalledWith({
      action: "file_downloaded",
      category: "conversion",
      label: "pdf",
      value: Math.round(blob.size / 1024),
    });
  });

  it("handles filename with no extension", () => {
    const blob = new Blob(["test"], { type: "text/plain" });
    triggerDownload(blob, "noext");

    expect(mockTrackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "noext",
      }),
    );
  });

  it("extracts lowercase extension from filename", () => {
    const blob = new Blob(["test"], { type: "text/plain" });
    triggerDownload(blob, "Photo.JPG");

    expect(mockTrackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "jpg",
      }),
    );
  });
});
