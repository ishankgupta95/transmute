import { describe, it, expect, vi } from "vitest";

/**
 * These assert the actual bytes rather than "did we call the library". The
 * previous suite mocked `audiobuffer-to-wav` and so was blind to the reason
 * that library is gone: above two channels it wrote channel 0's samples alone
 * beneath a header still declaring the source channel count.
 */

vi.mock("@/lib/tools/audio-decode", () => ({
  decodeAudioFile: vi.fn(),
}));

import { encodeToWav } from "@/lib/tools/audio-encode-wav";

/** Distinct per-channel ramps, so mis-interleaving is visible in the output. */
function createAudioBuffer(
  channels: number,
  length: number,
  sampleRate: number,
  fill: (channel: number, index: number) => number = () => 0,
): AudioBuffer {
  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < channels; ch++) {
    const data = new Float32Array(length);
    for (let i = 0; i < length; i++) data[i] = fill(ch, i);
    channelData.push(data);
  }
  return {
    numberOfChannels: channels,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: (ch: number) => channelData[ch],
  } as unknown as AudioBuffer;
}

const ascii = (view: DataView, offset: number, len: number) =>
  String.fromCharCode(
    ...Array.from({ length: len }, (_, i) => view.getUint8(offset + i)),
  );

async function readWav(blob: Blob) {
  const view = new DataView(await blob.arrayBuffer());
  return {
    view,
    riff: ascii(view, 0, 4),
    wave: ascii(view, 8, 4),
    fmt: ascii(view, 12, 4),
    audioFormat: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bitsPerSample: view.getUint16(34, true),
    dataTag: ascii(view, 36, 4),
    dataBytes: view.getUint32(40, true),
    riffSize: view.getUint32(4, true),
  };
}

describe("encodeToWav", () => {
  it("returns a Blob with audio/wav type", () => {
    const result = encodeToWav(createAudioBuffer(1, 100, 44100));

    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe("audio/wav");
  });

  it("writes a well-formed 16-bit PCM header", async () => {
    const wav = await readWav(encodeToWav(createAudioBuffer(2, 100, 48000)));

    expect(wav.riff).toBe("RIFF");
    expect(wav.wave).toBe("WAVE");
    expect(wav.fmt).toBe("fmt ");
    expect(wav.dataTag).toBe("data");
    expect(wav.audioFormat).toBe(1); // uncompressed PCM
    expect(wav.bitsPerSample).toBe(16);
    expect(wav.sampleRate).toBe(48000);
    expect(wav.blockAlign).toBe(4); // 2 channels × 2 bytes
    expect(wav.byteRate).toBe(48000 * 4);
  });

  it("sizes the blob as header + interleaved PCM", () => {
    const result = encodeToWav(createAudioBuffer(2, 44100, 44100));

    expect(result.size).toBe(44 + 44100 * 2 * 2);
  });

  for (const channels of [1, 2, 6]) {
    it(`keeps the header and payload consistent for ${channels} channel(s)`, async () => {
      const length = 128;
      const wav = await readWav(
        encodeToWav(createAudioBuffer(channels, length, 44100)),
      );

      // The corruption this replaced: a 6-channel header over 1 channel of
      // samples, which players read at a sixth of the true duration.
      expect(wav.channels).toBe(channels);
      expect(wav.dataBytes).toBe(length * channels * 2);
      expect(wav.riffSize).toBe(36 + length * channels * 2);
      expect(wav.view.byteLength).toBe(44 + length * channels * 2);
    });
  }

  it("interleaves every channel frame by frame", async () => {
    // Channel n holds the constant n/10, so each frame should read 0.0, 0.1,
    // 0.2 … in channel order.
    const { view } = await readWav(
      encodeToWav(createAudioBuffer(3, 4, 44100, (ch) => ch / 10)),
    );

    for (let frame = 0; frame < 4; frame++) {
      for (let ch = 0; ch < 3; ch++) {
        const sample = view.getInt16(44 + (frame * 3 + ch) * 2, true);
        expect(sample / 0x7fff).toBeCloseTo(ch / 10, 3);
      }
    }
  });

  it("clamps samples outside [-1, 1] instead of wrapping", async () => {
    const { view } = await readWav(
      encodeToWav(createAudioBuffer(1, 2, 44100, (_ch, i) => (i === 0 ? 4 : -4))),
    );

    // Wrapping would turn a hot sample into the opposite polarity — an audible
    // click rather than clean clipping.
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });
});
