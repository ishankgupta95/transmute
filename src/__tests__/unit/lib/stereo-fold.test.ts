import { describe, expect, it } from "vitest";
import { toStereoFloats } from "@/lib/tools/audio-pcm";

/*
 * MP3 carries two channels, so wider sources are folded. Each channel here
 * holds a distinct constant, so the output says exactly which source channel
 * went where and at what gain. Layout order is Web Audio's (and WAV/FLAC's):
 * 5.1 = L R C LFE SL SR.
 *
 * Found 2026-11-11: every channel past L/R used to go into BOTH sides,
 * LFE included, collapsing a surround mix's rear image to the middle.
 */

const G = Math.SQRT1_2;

/** n channels, channel k a constant k-th value, 1 sample each. */
function channels(values: number[]): Float32Array[] {
  return values.map((v) => Float32Array.of(v));
}

function fold(values: number[]): [number, number | undefined] {
  const [l, r] = toStereoFloats(channels(values));
  return [l[0], r?.[0]];
}

describe("toStereoFloats", () => {
  it("leaves mono and stereo alone", () => {
    expect(fold([0.3])).toEqual([Float32Array.of(0.3)[0], undefined]);
    expect(fold([0.1, 0.2])).toEqual([Float32Array.of(0.1)[0], Float32Array.of(0.2)[0]]);
  });

  it("5.1: centre into both at −3 dB, each surround into its own side, LFE dropped", () => {
    // Only one channel live at a time, so each assertion isolates one route.
    expect(fold([0, 0, 0.1, 0, 0, 0])[0]).toBeCloseTo(0.1 * G); // C → L
    expect(fold([0, 0, 0.1, 0, 0, 0])[1]).toBeCloseTo(0.1 * G); // C → R
    expect(fold([0, 0, 0, 0.1, 0, 0])).toEqual([0, 0]); // LFE → nowhere
    const sl = fold([0, 0, 0, 0, 0.1, 0]);
    expect(sl[0]).toBeCloseTo(0.1 * G); // SL → L
    expect(sl[1]).toBe(0); // …and NOT into R
    const sr = fold([0, 0, 0, 0, 0, 0.1]);
    expect(sr[0]).toBe(0);
    expect(sr[1]).toBeCloseTo(0.1 * G);
    // Fronts pass straight through to their own side.
    expect(fold([0.1, 0, 0, 0, 0, 0])).toEqual([Float32Array.of(0.1)[0], 0]);
    expect(fold([0, 0.1, 0, 0, 0, 0])).toEqual([0, Float32Array.of(0.1)[0]]);
  });

  it("quad and 5.0 keep surrounds on their own side; 3.0 centres the third", () => {
    const quad = fold([0, 0, 0.1, 0]); // SL
    expect(quad[0]).toBeCloseTo(0.1 * G);
    expect(quad[1]).toBe(0);
    const five = fold([0, 0, 0, 0, 0.1]); // SR in 5.0
    expect(five[0]).toBe(0);
    expect(five[1]).toBeCloseTo(0.1 * G);
    const three = fold([0, 0, 0.1]); // C
    expect(three[0]).toBeCloseTo(0.1 * G);
    expect(three[1]).toBeCloseTo(0.1 * G);
  });

  it("an unknown wider layout keeps the old rule: extras into both sides", () => {
    const seven = fold([0, 0, 0, 0, 0, 0, 0.1]);
    expect(seven[0]).toBeCloseTo(0.1 * G);
    expect(seven[1]).toBeCloseTo(0.1 * G);
  });

  it("normalises a sum above full scale instead of clipping it", () => {
    const [l, r] = fold([1, 1, 1, 0, 1, 1]);
    expect(Math.max(Math.abs(l), Math.abs(r!))).toBeCloseTo(1);
  });
});
