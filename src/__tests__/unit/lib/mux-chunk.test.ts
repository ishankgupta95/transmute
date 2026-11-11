import { describe, expect, it, vi } from "vitest";
import { audioChunkAdder, videoChunkAdder } from "@/lib/tools/mux-chunk";
import type { ArrayBufferTarget, Muxer } from "mp4-muxer";

/*
 * WebKit's encoders hand back chunks with `duration === null`, and mp4-muxer's
 * `addVideoChunk` rejects that on the first chunk (measured 2026-11-11 — the
 * page then showed "null is not an object (evaluating
 * 'track.info.decoderConfig.colorSpace')"). These pin the stand-in durations.
 */

function fakeMuxer() {
  return {
    addVideoChunk: vi.fn(),
    addVideoChunkRaw: vi.fn(),
    addAudioChunk: vi.fn(),
    addAudioChunkRaw: vi.fn(),
  };
}

function chunk(timestamp: number, duration: number | null, type: "key" | "delta" = "delta") {
  const bytes = new Uint8Array([timestamp % 251, 1, 2]);
  return {
    timestamp,
    duration,
    type,
    byteLength: bytes.length,
    copyTo: (dst: Uint8Array) => dst.set(bytes),
  } as unknown as EncodedVideoChunk & EncodedAudioChunk;
}

const asMuxer = (m: ReturnType<typeof fakeMuxer>) => m as unknown as Muxer<ArrayBufferTarget>;

describe("videoChunkAdder", () => {
  it("passes a chunk with a real duration straight through", () => {
    const m = fakeMuxer();
    const meta = { decoderConfig: { codec: "avc1.42E01E" } } as EncodedVideoChunkMetadata;
    videoChunkAdder(asMuxer(m))(chunk(0, 41_667, "key"), meta);
    expect(m.addVideoChunk).toHaveBeenCalledTimes(1);
    expect(m.addVideoChunkRaw).not.toHaveBeenCalled();
  });

  it("supplies the previous frame gap when the browser leaves duration null", () => {
    const m = fakeMuxer();
    const add = videoChunkAdder(asMuxer(m));
    const meta = { decoderConfig: { codec: "avc1.42E01E" } } as EncodedVideoChunkMetadata;
    add(chunk(0, null, "key"), meta);
    add(chunk(41_667, null), undefined);
    add(chunk(83_333, null), undefined);

    const durations = m.addVideoChunkRaw.mock.calls.map((c) => c[3]);
    // First frame: a guess (no gap known yet). Mux timing comes from the
    // timestamps; only the LAST sample's length uses this number.
    expect(durations[0]).toBeCloseTo(1_000_000 / 30);
    expect(durations[1]).toBe(41_667);
    expect(durations[2]).toBe(41_666);
    // Bytes, type, timestamp and the codec description all carried across.
    expect(Array.from(m.addVideoChunkRaw.mock.calls[0][0] as Uint8Array)).toEqual([0, 1, 2]);
    expect(m.addVideoChunkRaw.mock.calls[0][1]).toBe("key");
    expect(m.addVideoChunkRaw.mock.calls[2][2]).toBe(83_333);
    expect(m.addVideoChunkRaw.mock.calls[0][4]).toBe(meta);
  });
});

describe("audioChunkAdder", () => {
  it("uses one AAC frame (1024 samples) when duration is null", () => {
    const m = fakeMuxer();
    audioChunkAdder(asMuxer(m), 48_000)(chunk(0, null, "key"), undefined);
    expect(m.addAudioChunkRaw).toHaveBeenCalledTimes(1);
    expect(m.addAudioChunkRaw.mock.calls[0][3]).toBeCloseTo((1024 / 48_000) * 1e6);
  });

  it("passes a chunk with a real duration straight through", () => {
    const m = fakeMuxer();
    audioChunkAdder(asMuxer(m), 44_100)(chunk(0, 23_220, "key"), undefined);
    expect(m.addAudioChunk).toHaveBeenCalledTimes(1);
    expect(m.addAudioChunkRaw).not.toHaveBeenCalled();
  });
});
