import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { trackEvent } from "@/lib/utils/analytics";

describe("trackEvent", () => {
  beforeEach(() => {
    // Clean up any existing gtag
    delete (window as unknown as Record<string, unknown>).gtag;
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).gtag;
  });

  it("calls window.gtag with correct event parameters when gtag is defined", () => {
    const mockGtag = vi.fn();
    (window as unknown as Record<string, unknown>).gtag = mockGtag;

    trackEvent({
      action: "file_processed",
      category: "conversion",
      label: "png",
      value: 512,
    });

    expect(mockGtag).toHaveBeenCalledTimes(1);
    expect(mockGtag).toHaveBeenCalledWith("event", "file_processed", {
      event_category: "conversion",
      event_label: "png",
      value: 512,
    });
  });

  it("does nothing when window.gtag is not defined", () => {
    // gtag is not set on window -- should not throw
    expect(() =>
      trackEvent({
        action: "file_processed",
        category: "conversion",
        label: "png",
        value: 100,
      }),
    ).not.toThrow();
  });

  it("does nothing when window.gtag is not a function", () => {
    (window as unknown as Record<string, unknown>).gtag = "not a function";

    expect(() =>
      trackEvent({
        action: "test_action",
      }),
    ).not.toThrow();
  });

  it("passes undefined for optional parameters when not provided", () => {
    const mockGtag = vi.fn();
    (window as unknown as Record<string, unknown>).gtag = mockGtag;

    trackEvent({ action: "test_action" });

    expect(mockGtag).toHaveBeenCalledWith("event", "test_action", {
      event_category: undefined,
      event_label: undefined,
      value: undefined,
    });
  });

  it("handles zero as a valid value", () => {
    const mockGtag = vi.fn();
    (window as unknown as Record<string, unknown>).gtag = mockGtag;

    trackEvent({
      action: "file_downloaded",
      category: "conversion",
      label: "txt",
      value: 0,
    });

    expect(mockGtag).toHaveBeenCalledWith("event", "file_downloaded", {
      event_category: "conversion",
      event_label: "txt",
      value: 0,
    });
  });
});
