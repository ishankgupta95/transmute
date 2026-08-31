import { describe, it, expect } from "vitest";
import { audioMeta, imageMeta, videoMeta } from "@/lib/utils/canvas-meta";

/*
  The canvas header's meta line is a technical readout, and its whole value is
  that every segment in it was measured. These guard the two rules that make
  that true: a fact the tool does not have is omitted rather than filled with a
  placeholder, and the doc's unmeasurable segments (codec, colour space) are
  never emitted at all.
*/

describe("imageMeta", () => {
  it("leads with the dimensions, then the size", () => {
    expect(imageMeta({ w: 4032, h: 3024 }, "4.28 MB")).toBe("4032 × 3024 · 4.28 MB");
  });

  it("falls back to the size alone before the decode lands", () => {
    expect(imageMeta(null, "4.28 MB")).toBe("4.28 MB");
  });
});

describe("videoMeta", () => {
  it("reads dimensions · duration · size", () => {
    expect(videoMeta({ w: 1920, h: 1080 }, "0:47.2", "28.6 MB")).toBe(
      "1920 × 1080 · 0:47.2 · 28.6 MB",
    );
  });

  it("drops the duration for a container that declares none", () => {
    // MediaRecorder's WebM reports Infinity; printing it would be a lie.
    expect(videoMeta({ w: 1280, h: 720 }, null, "3.1 MB")).toBe("1280 × 720 · 3.1 MB");
  });

  it("never emits a codec — nothing in the app reads one", () => {
    expect(videoMeta({ w: 1920, h: 1080 }, "0:47.2", "28.6 MB")).not.toMatch(/H\.?264|VP9|AV1/i);
  });
});

describe("audioMeta", () => {
  it("reads rate · channel layout · duration · size", () => {
    expect(audioMeta({ sampleRate: 48000, channels: 2 }, "11:30", "126 MB")).toBe(
      "48 kHz · STEREO · 11:30 · 126 MB",
    );
  });

  it("keeps one decimal on rates that need it and none on rates that do not", () => {
    expect(audioMeta({ sampleRate: 44100, channels: 1 }, null, "3 MB")).toBe(
      "44.1 kHz · MONO · 3 MB",
    );
  });

  it("names a surround layout by its channel count rather than guessing", () => {
    expect(audioMeta({ sampleRate: 48000, channels: 6 }, null, "9 MB")).toBe(
      "48 kHz · 6 CH · 9 MB",
    );
  });

  it("degrades to duration and size when the decode failed", () => {
    expect(audioMeta(null, "2:05", "3 MB")).toBe("2:05 · 3 MB");
  });
});
