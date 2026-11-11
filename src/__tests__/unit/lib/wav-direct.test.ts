import { afterEach, describe, expect, it, vi } from "vitest";
import { pcm16WavToAudioBuffer } from "@/lib/tools/audio-decode";

/*
 * The FFmpeg decode fallback builds its AudioBuffer from the s16le WAV itself
 * instead of handing it back to decodeAudioData, because Chromium's Web Audio
 * rejects 6-channel audio declared as 5.1 with back surrounds (mask 0x3F) —
 * measured 2026-11-11 — and FFmpeg writes exactly that for a 5.1 source.
 * jsdom has no AudioBuffer, so a minimal stand-in records what is built.
 */

class FakeAudioBuffer {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  data: Float32Array[];
  constructor(o: { numberOfChannels: number; length: number; sampleRate: number }) {
    this.numberOfChannels = o.numberOfChannels;
    this.length = o.length;
    this.sampleRate = o.sampleRate;
    this.data = Array.from({ length: o.numberOfChannels }, () => new Float32Array(o.length));
  }
  copyToChannel(src: Float32Array, ch: number) {
    this.data[ch].set(src);
  }
}

afterEach(() => vi.unstubAllGlobals());

/** A WAV with interleaved s16 frames; `extensible` writes the 0xFFFE form with a mask. */
function wav(frames: number[][], rate: number, opts: { extensible?: number; bits?: number } = {}): Uint8Array {
  const channels = frames[0].length;
  const data = frames.length * channels * 2;
  const fmtSize = opts.extensible !== undefined ? 40 : 16;
  const out = new Uint8Array(12 + 8 + fmtSize + 8 + data);
  const v = new DataView(out.buffer);
  const put = (o: number, s: string) => [...s].forEach((c, i) => (out[o + i] = c.charCodeAt(0)));
  put(0, "RIFF");
  v.setUint32(4, out.length - 8, true);
  put(8, "WAVE");
  put(12, "fmt ");
  v.setUint32(16, fmtSize, true);
  v.setUint16(20, opts.extensible !== undefined ? 0xfffe : 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, opts.bits ?? 16, true);
  if (opts.extensible !== undefined) {
    v.setUint16(36, 22, true);
    v.setUint16(38, 16, true);
    v.setUint32(40, opts.extensible, true);
    v.setUint16(44, 1, true); // sub-format GUID starts with PCM = 1
  }
  const dataAt = 20 + fmtSize;
  put(dataAt, "data");
  v.setUint32(dataAt + 4, data, true);
  frames.forEach((f, i) => f.forEach((s, c) => v.setInt16(dataAt + 8 + (i * channels + c) * 2, s, true)));
  return out;
}

describe("pcm16WavToAudioBuffer", () => {
  it("builds a 5.1 buffer from the extensible WAV Chromium refuses (mask 0x3F)", () => {
    vi.stubGlobal("AudioBuffer", FakeAudioBuffer);
    const frames = [
      [16384, -16384, 8192, 0, 4096, -4096],
      [0, 32767, -32768, 1, 2, 3],
    ];
    const buf = pcm16WavToAudioBuffer(wav(frames, 48000, { extensible: 0x3f })) as unknown as FakeAudioBuffer;
    expect(buf).not.toBeNull();
    expect([buf.numberOfChannels, buf.length, buf.sampleRate]).toEqual([6, 2, 48000]);
    // De-interleaved, channel by channel, s16 / 32768.
    expect(Array.from(buf.data[0])).toEqual([0.5, 0]);
    expect(Array.from(buf.data[1])).toEqual([-0.5, 32767 / 32768]);
    expect(Array.from(buf.data[2])).toEqual([0.25, -1]);
    expect(Array.from(buf.data[5])).toEqual([-0.125, 3 / 32768]);
  });

  it("reads a plain PCM WAV at its own rate", () => {
    vi.stubGlobal("AudioBuffer", FakeAudioBuffer);
    const buf = pcm16WavToAudioBuffer(wav([[100, -100]], 96000)) as unknown as FakeAudioBuffer;
    expect([buf.numberOfChannels, buf.sampleRate]).toEqual([2, 96000]);
  });

  it("returns null for anything it should not guess at, so the browser decode still runs", () => {
    vi.stubGlobal("AudioBuffer", FakeAudioBuffer);
    expect(pcm16WavToAudioBuffer(wav([[1, 2]], 44100, { bits: 24 }))).toBeNull(); // not 16-bit
    expect(pcm16WavToAudioBuffer(new TextEncoder().encode("ID3 not a wav at all, padded out to length.."))).toBeNull();
    expect(pcm16WavToAudioBuffer(new Uint8Array(10))).toBeNull();
  });

  it("returns null where AudioBuffer does not exist rather than throwing", () => {
    expect(pcm16WavToAudioBuffer(wav([[1, 2]], 44100))).toBeNull();
  });
});
