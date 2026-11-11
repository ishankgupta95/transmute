import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * `pickH264Config` must not trust `VideoEncoder.isConfigSupported`.
 *
 * The fake below reproduces what was measured in Playwright's WebKit on
 * 2026-11-11: every profile is reported SUPPORTED, but High (avc1.640034) and
 * Main (avc1.4D4028) encoders hand back chunks for the first four frames and
 * then deadlock — from the fifth frame on they emit nothing and `flush()`
 * never settles. Baseline (avc1.42E01E) works. The old picker took High and
 * compress-video, webm-to-mp4 and the trimmer's Exact frame hung forever.
 *
 * Kept apart from video-utils.test.ts, whose `assertWebCodecsSupported` test
 * needs a jsdom with NO VideoEncoder at all.
 */

type Behaviour = "works" | "stalls-after-4" | "never-outputs" | "throws-on-configure";
const behaviour = new Map<string, Behaviour>();
const configured: string[] = [];

class FakeVideoEncoder {
  static isConfigSupported = vi.fn(async (config: VideoEncoderConfig) => ({ supported: true, config }));
  state = "unconfigured";
  private codec = "";
  private frames = 0;
  private output: (chunk: unknown) => void;
  constructor(init: { output: (chunk: unknown) => void; error: (e: unknown) => void }) {
    this.output = init.output;
  }
  configure(config: VideoEncoderConfig) {
    this.codec = config.codec;
    configured.push(`${config.codec}/${config.hardwareAcceleration}`);
    if (behaviour.get(config.codec) === "throws-on-configure") throw new Error("NotSupportedError");
    this.state = "configured";
  }
  encode() {
    this.frames++;
    const b = behaviour.get(this.codec) ?? "works";
    if (b === "works" || (b === "stalls-after-4" && this.frames <= 4)) {
      queueMicrotask(() => this.output({}));
    }
  }
  flush(): Promise<void> {
    const b = behaviour.get(this.codec) ?? "works";
    if (b === "never-outputs" || (b === "stalls-after-4" && this.frames > 4)) {
      return new Promise(() => {}); // the measured WebKit behaviour: never settles
    }
    return Promise.resolve();
  }
  close() {
    this.state = "closed";
  }
}

class FakeVideoFrame {
  close() {}
}

vi.stubGlobal("VideoEncoder", FakeVideoEncoder);
vi.stubGlobal("VideoFrame", FakeVideoFrame);

import {
  ENCODE_PROBE_TIMEOUT_MS,
  encodesAFrame,
  pickH264Config,
  resetEncodeProbeCache,
} from "@/lib/tools/video-utils";

const BASE = { width: 320, height: 240, bitrate: 600_000, framerate: 30 };

/** Run a probe-driven call to completion, advancing past every probe timeout. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(ENCODE_PROBE_TIMEOUT_MS);
  return promise;
}

describe("pickH264Config proves the encoder works before choosing it", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    behaviour.clear();
    configured.length = 0;
    resetEncodeProbeCache();
    FakeVideoEncoder.isConfigSupported.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("takes High when High really encodes", async () => {
    const config = await settle(pickH264Config(BASE));
    expect(config.codec).toBe("avc1.640034");
    expect(config.hardwareAcceleration).toBe("prefer-hardware");
  });

  it("skips High and Main that stall after four frames — the measured WebKit case", async () => {
    behaviour.set("avc1.640034", "stalls-after-4");
    behaviour.set("avc1.4D4028", "stalls-after-4");
    const config = await settle(pickH264Config(BASE));
    expect(config.codec).toBe("avc1.42E01E");
    // Every candidate the browser vouched for was actually tried, in order.
    expect(configured.slice(0, 3)).toEqual([
      "avc1.640034/prefer-hardware",
      "avc1.4D4028/prefer-hardware",
      "avc1.42E01E/prefer-hardware",
    ]);
  });

  it("rejects an encoder that never answers at all", async () => {
    behaviour.set("avc1.640034", "never-outputs");
    expect((await settle(pickH264Config(BASE))).codec).toBe("avc1.4D4028");
  });

  it("treats a configure() throw as unsupported, not as a crash", async () => {
    behaviour.set("avc1.640034", "throws-on-configure");
    expect((await settle(pickH264Config(BASE))).codec).toBe("avc1.4D4028");
  });

  it("says plainly when nothing works", async () => {
    for (const c of ["avc1.640034", "avc1.4D4028", "avc1.42E01E"]) behaviour.set(c, "stalls-after-4");
    const run = pickH264Config(BASE);
    const caught = run.catch((e: Error) => e);
    const err = await settle(caught);
    expect(String(err)).toMatch(/can't encode H\.264/);
  });

  it("probes each config once per page, not once per job", async () => {
    const config = { codec: "avc1.42E01E", ...BASE, hardwareAcceleration: "prefer-hardware" as const };
    expect(await settle(encodesAFrame(config))).toBe(true);
    expect(await settle(encodesAFrame(config))).toBe(true);
    expect(configured.filter((c) => c.startsWith("avc1.42E01E"))).toHaveLength(1);
  });
});
