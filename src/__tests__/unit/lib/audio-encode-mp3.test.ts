import { describe, it, expect, vi, beforeEach } from "vitest";

/*
 * The mock target is a URL, not a package name, and that is the point.
 *
 * LAME is LGPL, so it is not bundled: `npm run copy:wasm` stages our own wasm
 * build into `public/vendor/libmp3lame.{js,wasm}` and lib/tools/audio-pcm.ts
 * fetches it at first encode through a deliberately non-analyzable specifier
 * (see the `vendorUrl` comment there). Vitest resolves that computed specifier
 * at runtime, so mocking "/vendor/libmp3lame.js" intercepts exactly the request
 * the browser would make. It also means these tests fail loudly if anyone
 * reinstates a static import of the encoder — the spies below would simply
 * never be called.
 *
 * The fake stands in for a wasm module, so it has to behave like one: a real
 * linear-memory heap with the bridge's three buffers laid out in it, pointers
 * returned as BYTE offsets, and output delivered by writing into the heap and
 * returning a byte count rather than by returning an array. That shape is what
 * lets these tests check the thing that actually matters now — which samples
 * reach `HEAPF32`, and in what units.
 */
const lame = vi.hoisted(() => {
  /** The real bridge batches 32 MP3 frames; shrinkable per test. */
  const CAPACITY = 1152 * 32;
  const heap = new ArrayBuffer(1 << 20);
  const LEFT_AT = 0;
  const RIGHT_AT = CAPACITY * 4;
  const OUT_AT = CAPACITY * 8;

  const spies = {
    open: vi.fn(),
    encode: vi.fn(),
    flush: vi.fn(),
    close: vi.fn(),
    capacity: vi.fn(),
  };

  const mod = {
    _mp3_in_left: () => LEFT_AT,
    _mp3_in_right: () => RIGHT_AT,
    _mp3_out: () => OUT_AT,
    _mp3_frame_capacity: spies.capacity,
    _mp3_open: spies.open,
    _mp3_encode: spies.encode,
    _mp3_flush: spies.flush,
    _mp3_close: spies.close,
    HEAPF32: new Float32Array(heap),
    HEAPU8: new Uint8Array(heap),
  };

  return { mod, spies, CAPACITY, LEFT_AT, RIGHT_AT, OUT_AT };
});

vi.mock("/vendor/libmp3lame.js", () => ({ default: () => Promise.resolve(lame.mod) }));

// Mock audio-decode
vi.mock("@/lib/tools/audio-decode", () => ({
  decodeAudioFile: vi.fn(),
}));

import { encodeToMp3 } from "@/lib/tools/audio-encode-mp3";

const { mod, spies, CAPACITY, LEFT_AT, RIGHT_AT, OUT_AT } = lame;

/** A healthy encoder: two MP3 bytes per batch, one on flush. */
function healthyEncoder(capacity = CAPACITY): void {
  spies.capacity.mockReturnValue(capacity);
  spies.open.mockReturnValue(0);
  spies.encode.mockImplementation(() => {
    mod.HEAPU8[OUT_AT] = 0xff;
    mod.HEAPU8[OUT_AT + 1] = 0xfb;
    return 2;
  });
  spies.flush.mockImplementation(() => {
    mod.HEAPU8[OUT_AT] = 0x00;
    return 1;
  });
  spies.close.mockImplementation(() => {});
}

function createMockAudioBuffer(
  channels: number,
  length: number,
  sampleRate: number,
): AudioBuffer {
  const channelData: Float32Array[] = [];
  for (let i = 0; i < channels; i++) {
    const data = new Float32Array(length);
    for (let j = 0; j < length; j++) {
      data[j] = Math.sin((2 * Math.PI * 440 * j) / sampleRate);
    }
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

describe("encodeToMp3", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mod.HEAPF32.fill(0);
    healthyEncoder();
  });

  it("opens the encoder with the channel count, sample rate and bitrate", async () => {
    const buffer = createMockAudioBuffer(2, 4410, 44100);
    await encodeToMp3(buffer, 192);

    expect(spies.open).toHaveBeenCalledWith(2, 44100, 192);
  });

  it("returns a Blob with audio/mpeg type", async () => {
    const buffer = createMockAudioBuffer(1, 4410, 44100);
    const result = await encodeToMp3(buffer, 128);

    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe("audio/mpeg");
  });

  it("opens one channel for a mono source", async () => {
    const buffer = createMockAudioBuffer(1, 2304, 44100);
    await encodeToMp3(buffer, 192);

    // MP3 holds at most two, and the count must match what is actually fed —
    // a source channel count passed through unclamped once configured the
    // encoder for six channels while only two were ever written.
    expect(spies.open).toHaveBeenCalledWith(1, 44100, 192);
  });

  it("writes both input buffers for a stereo source", async () => {
    const left = new Float32Array([0.25, 0.5]);
    const right = new Float32Array([-0.25, -0.5]);
    const buffer = {
      numberOfChannels: 2,
      length: 2,
      sampleRate: 44100,
      duration: 2 / 44100,
      getChannelData: (ch: number) => (ch === 0 ? left : right),
    } as unknown as AudioBuffer;

    await encodeToMp3(buffer, 256);

    expect(spies.open).toHaveBeenCalledWith(2, 44100, 256);
    expect(Array.from(mod.HEAPF32.subarray(LEFT_AT / 4, LEFT_AT / 4 + 2))).toEqual([0.25, 0.5]);
    expect(Array.from(mod.HEAPF32.subarray(RIGHT_AT / 4, RIGHT_AT / 4 + 2))).toEqual([-0.25, -0.5]);
  });

  it("flushes once after the last batch, and closes the encoder", async () => {
    const buffer = createMockAudioBuffer(1, 1152, 44100);
    await encodeToMp3(buffer, 128);

    expect(spies.flush).toHaveBeenCalledTimes(1);
    // The instance outlives the call, so a half-open encoder would carry this
    // run's state into the next one.
    expect(spies.close).toHaveBeenCalledTimes(1);
  });

  it("hands LAME the float samples unconverted, not scaled to int16", async () => {
    /*
      THE POINT OF THE WHOLE ENGINE SWAP, as far as this file can see it.
      lamejs took Int16, so every export paid a Float32 -> Int16 pass over the
      entire signal — an O(samples) loop and a second whole-signal allocation
      before the encoder saw anything. `lame_encode_buffer_ieee_float` takes the
      [-1,1] floats WebAudio already hands us, so that pass is gone. This test
      replaces one that asserted 1.0 became 32767; if anyone reintroduces a
      conversion, these exact values stop arriving.
    */
    const channelData = new Float32Array([0, 1, -1, 0.5, -0.5]);
    const buffer = {
      numberOfChannels: 1,
      length: 5,
      sampleRate: 44100,
      duration: 5 / 44100,
      getChannelData: () => channelData,
    } as unknown as AudioBuffer;

    await encodeToMp3(buffer, 192);

    expect(Array.from(mod.HEAPF32.subarray(LEFT_AT / 4, LEFT_AT / 4 + 5))).toEqual([
      0, 1, -1, 0.5, -0.5,
    ]);
  });

  it("batches at the bridge's capacity and passes a short final batch", async () => {
    // A deliberately tiny capacity so the loop has to run more than once; the
    // real bridge reports 1152 * 32.
    healthyEncoder(1152);
    const buffer = createMockAudioBuffer(1, 1152 * 2 + 500, 44100);
    await encodeToMp3(buffer, 192);

    expect(spies.encode).toHaveBeenCalledTimes(3);
    expect(spies.encode.mock.calls.map((c) => c[0])).toEqual([1152, 1152, 500]);
  });

  it("closes the encoder even when a batch fails", async () => {
    spies.encode.mockReturnValue(-3);
    const buffer = createMockAudioBuffer(1, 1152, 44100);

    await expect(encodeToMp3(buffer, 192)).rejects.toThrow(/-3/);
    expect(spies.close).toHaveBeenCalledTimes(1);
  });

  it("reports a refused configuration rather than encoding into a closed encoder", async () => {
    spies.open.mockReturnValue(-1);
    const buffer = createMockAudioBuffer(2, 1152, 44100);

    await expect(encodeToMp3(buffer, 192)).rejects.toThrow(/refused these settings/);
    expect(spies.encode).not.toHaveBeenCalled();
  });

  it("handles different bitrate values", async () => {
    const buffer = createMockAudioBuffer(2, 4410, 44100);

    for (const bitrate of [128, 192, 256, 320]) {
      vi.clearAllMocks();
      healthyEncoder();
      await encodeToMp3(buffer, bitrate);
      expect(spies.open).toHaveBeenCalledWith(2, 44100, bitrate);
    }
  });
});
