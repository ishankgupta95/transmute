import { describe, expect, it } from "vitest";
import {
  MAX_EMPTY_EDIT_SECONDS,
  dropTinyLeadingEmptyEdits,
  isIsoBmffExtension,
} from "@/lib/tools/mp4-edit-list";

/*
 * Synthetic ISO-BMFF trees shaped like what FFmpeg's stream copy writes. The
 * measured file this exists for (split-video part 2, 2026-11-11) had the video
 * elst [[1, -1, 1], [1000, 0, 1]] and the audio elst [[1092, 0, 1]] at a movie
 * timescale of 1000 — `split()` below rebuilds exactly that shape.
 */

function box(type: string, ...children: Uint8Array[]): Uint8Array {
  const body = children.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(8 + body);
  new DataView(out.buffer).setUint32(0, 8 + body);
  out.set([...type].map((c) => c.charCodeAt(0)), 4);
  let o = 8;
  for (const c of children) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function mvhd(timescale: number): Uint8Array {
  const body = new Uint8Array(100);
  new DataView(body.buffer).setUint32(12, timescale); // v0: flags(4) ctime(4) mtime(4) timescale
  return box("mvhd", body);
}

function elst(entries: [number, number][], version: 0 | 1 = 0): Uint8Array {
  const size = version === 1 ? 20 : 12;
  const body = new Uint8Array(8 + entries.length * size);
  const v = new DataView(body.buffer);
  body[0] = version;
  v.setUint32(4, entries.length);
  entries.forEach(([segment, mediaTime], i) => {
    const at = 8 + i * size;
    if (version === 1) {
      v.setBigUint64(at, BigInt(segment));
      v.setBigInt64(at + 8, BigInt(mediaTime));
      v.setInt16(at + 16, 1);
    } else {
      v.setUint32(at, segment);
      v.setInt32(at + 4, mediaTime);
      v.setInt16(at + 8, 1);
    }
  });
  return box("elst", body);
}

const trak = (e: Uint8Array) => box("trak", box("edts", e), box("mdia", new Uint8Array(16)));

function movie(video: Uint8Array, audio = elst([[1092, 0]]), timescale = 1000): Uint8Array {
  return Uint8Array.from([
    ...box("ftyp", new Uint8Array(8)),
    ...box("moov", mvhd(timescale), trak(video), trak(audio)),
    ...box("mdat", new Uint8Array(64).fill(7)),
  ]);
}

/** Every elst in file order, decoded, plus the four-char types inside each edts. */
function readEdits(bytes: Uint8Array): { entries: [number, number][]; edtsChildren: string[] }[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const t = (o: number) => String.fromCharCode(...bytes.subarray(o + 4, o + 8));
  const found: { entries: [number, number][]; edtsChildren: string[] }[] = [];
  const walk = (s: number, e: number) => {
    for (let o = s; o + 8 <= e; o += v.getUint32(o)) {
      const type = t(o);
      const size = v.getUint32(o);
      if (type === "edts") {
        const kids: string[] = [];
        for (let k = o + 8; k + 8 <= o + size; k += v.getUint32(k)) kids.push(t(k));
        const at = o + 8;
        const ver = bytes[at + 8];
        const n = v.getUint32(at + 12);
        const entries: [number, number][] = [];
        for (let i = 0; i < n; i++) {
          const p = at + 16 + i * (ver === 1 ? 20 : 12);
          entries.push(
            ver === 1
              ? [Number(v.getBigUint64(p)), Number(v.getBigInt64(p + 8))]
              : [v.getUint32(p), v.getInt32(p + 4)],
          );
        }
        found.push({ entries, edtsChildren: kids });
      } else if (type === "moov" || type === "trak") {
        walk(o + 8, o + size);
      }
    }
  };
  walk(0, bytes.length);
  return found;
}

describe("dropTinyLeadingEmptyEdits", () => {
  it("drops the measured 1 ms empty edit from the video track, and only that", () => {
    const input = movie(elst([[1, -1], [1000, 0]]));
    const { bytes, dropped } = dropTinyLeadingEmptyEdits(input);

    expect(dropped).toBe(1);
    const [video, audio] = readEdits(bytes);
    expect(video.entries).toEqual([[1000, 0]]);
    expect(audio.entries).toEqual([[1092, 0]]);
  });

  it("keeps every box size, so no chunk offset can move", () => {
    const input = movie(elst([[1, -1], [1000, 0]]));
    const { bytes } = dropTinyLeadingEmptyEdits(input);

    expect(bytes.length).toBe(input.length);
    // The mdat payload sits at the same offset, byte for byte.
    expect(Array.from(bytes.subarray(bytes.length - 64))).toEqual(new Array(64).fill(7));
    // The freed entry became a `free` box inside the same edts.
    expect(readEdits(bytes)[0].edtsChildren).toEqual(["elst", "free"]);
  });

  it("handles version-1 (64-bit) edit lists", () => {
    const { bytes, dropped } = dropTinyLeadingEmptyEdits(movie(elst([[1, -1], [1000, 0]], 1)));
    expect(dropped).toBe(1);
    expect(readEdits(bytes)[0].entries).toEqual([[1000, 0]]);
    expect(readEdits(bytes)[0].edtsChildren).toEqual(["elst", "free"]);
  });

  it("leaves an empty edit longer than one frame alone — that is real A/V offset", () => {
    const input = movie(elst([[100, -1], [1000, 0]]));
    const { bytes, dropped } = dropTinyLeadingEmptyEdits(input);
    expect(dropped).toBe(0);
    expect(bytes).toBe(input);
  });

  it("uses the movie timescale, not a fixed unit, to judge the length", () => {
    // 30 ticks at 1000/s is 30 ms (dropped); at 600/s it is 50 ms (kept).
    expect(dropTinyLeadingEmptyEdits(movie(elst([[30, -1], [1000, 0]]), undefined, 1000)).dropped).toBe(1);
    expect(dropTinyLeadingEmptyEdits(movie(elst([[30, -1], [600, 0]]), undefined, 600)).dropped).toBe(0);
    expect(MAX_EMPTY_EDIT_SECONDS).toBeCloseTo(1 / 30);
  });

  it("leaves a lone empty edit alone (a track with no picture is a different problem)", () => {
    const input = movie(elst([[1, -1]]));
    expect(dropTinyLeadingEmptyEdits(input).dropped).toBe(0);
  });

  it("does not touch a composition-offset edit (positive media_time)", () => {
    const input = movie(elst([[1000, 1024]]));
    const { bytes, dropped } = dropTinyLeadingEmptyEdits(input);
    expect(dropped).toBe(0);
    expect(bytes).toBe(input);
  });

  it("returns the input itself when there is nothing to fix, and never mutates it", () => {
    const clean = movie(elst([[1000, 0]]));
    expect(dropTinyLeadingEmptyEdits(clean).bytes).toBe(clean);

    const dirty = movie(elst([[1, -1], [1000, 0]]));
    const before = Uint8Array.from(dirty);
    dropTinyLeadingEmptyEdits(dirty);
    expect(dirty).toEqual(before);
  });

  it("survives a file with no moov or a truncated box", () => {
    const junk = Uint8Array.from([0, 0, 0, 40, 0x6d, 0x6f, 0x6f, 0x76, 1, 2, 3]);
    expect(dropTinyLeadingEmptyEdits(junk).dropped).toBe(0);
    expect(dropTinyLeadingEmptyEdits(new Uint8Array(0)).dropped).toBe(0);
  });
});

describe("isIsoBmffExtension", () => {
  it("is true for the MP4 family and false for everything else", () => {
    expect([".mp4", ".MOV", ".m4v", ".3gp"].map(isIsoBmffExtension)).toEqual([true, true, true, true]);
    expect([".webm", ".mkv", ".avi", ""].map(isIsoBmffExtension)).toEqual([false, false, false, false]);
  });
});
