import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

import { WebmToMp4UI } from "@/components/tools/WebmToMp4UI";

/*
  Bare jsdom has no VideoEncoder / AudioEncoder / VideoFrame / rVFC — the same
  shape as a browser without WebCodecs, which is exactly what the pre-flight
  banner exists for. The supported case stubs all four probes back in.
*/

function stubWebCodecs() {
  vi.stubGlobal("VideoEncoder", function VideoEncoder() {});
  vi.stubGlobal("AudioEncoder", function AudioEncoder() {});
  vi.stubGlobal("VideoFrame", function VideoFrame() {});
  Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", {
    value() {},
    configurable: true,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (HTMLVideoElement.prototype as { requestVideoFrameCallback?: unknown })
    .requestVideoFrameCallback;
});

describe("WebmToMp4UI — WebCodecs pre-flight", () => {
  it("warns before any upload when the browser can't encode video", () => {
    render(<WebmToMp4UI />);

    expect(screen.getByRole("alert")).toHaveTextContent(/WebCodecs/);
  });

  it("keeps the drop zone so the page holds its shape on an unsupported browser", () => {
    const { container } = render(<WebmToMp4UI />);

    expect(container.querySelector('input[type="file"]')).not.toBeNull();
  });

  it("renders no banner when the encode APIs are all present", () => {
    stubWebCodecs();
    render(<WebmToMp4UI />);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.querySelector('input[type="file"]')).not.toBeNull();
  });
});
