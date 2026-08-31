import { describe, it, expect, vi, afterEach } from "vitest";

import { isWebCodecsEncodeSupported } from "@/lib/utils/webcodecs-support";

/*
  jsdom ships none of the four probes, which makes it a faithful stand-in for
  a browser without WebCodecs — each case adds back exactly the pieces it
  wants present.
*/

function stubEncoders() {
  vi.stubGlobal("VideoEncoder", function VideoEncoder() {});
  vi.stubGlobal("AudioEncoder", function AudioEncoder() {});
  vi.stubGlobal("VideoFrame", function VideoFrame() {});
}

function stubRvfc() {
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

describe("isWebCodecsEncodeSupported", () => {
  it("returns false in bare jsdom (no WebCodecs at all)", () => {
    expect(isWebCodecsEncodeSupported()).toBe(false);
  });

  it("returns true when all four probes pass", () => {
    stubEncoders();
    stubRvfc();
    expect(isWebCodecsEncodeSupported()).toBe(true);
  });

  it("returns false without requestVideoFrameCallback even with the encoder globals", () => {
    stubEncoders();
    expect(isWebCodecsEncodeSupported()).toBe(false);
  });

  it("returns false when only requestVideoFrameCallback exists (the decode-only browser)", () => {
    stubRvfc();
    expect(isWebCodecsEncodeSupported()).toBe(false);
  });

  it("returns false when AudioEncoder alone is missing", () => {
    vi.stubGlobal("VideoEncoder", function VideoEncoder() {});
    vi.stubGlobal("VideoFrame", function VideoFrame() {});
    stubRvfc();
    expect(isWebCodecsEncodeSupported()).toBe(false);
  });
});
