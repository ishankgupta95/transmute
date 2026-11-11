/**
 * Remove a tiny leading EMPTY EDIT from each track of an MP4/MOV, in place.
 *
 * WHY. A stream-copy cut (`-ss … -c copy -avoid_negative_ts make_zero`) almost
 * never starts its audio and video on the same instant: the audio packet that
 * straddles the cut begins a little before the video keyframe. `make_zero`
 * zeroes the EARLIER of the two, so the video track starts a millisecond or so
 * late, and the MP4 muxer records that gap as an empty edit — an `elst` whose
 * first entry has `media_time = -1`.
 *
 * Measured 2026-11-11 on `split-video`'s second part of the 2.09 s fixture
 * (cut at 1.0 s): the video `elst` was `[[1, -1, 1], [1000, 0, 1]]` — one
 * millisecond of nothing. Chromium ignores it. WebKit renders that first
 * instant as a BLACK frame (mean brightness 0 at t=0, then the real 146 from
 * t=0.01 s, three runs out of three), so in Safari the clip's first frame — the
 * one shown before play, and the one a thumbnail is taken from — is black.
 * The same file with only that entry removed shows the real frame at t=0 in
 * both engines. Part 1 of the same split has no empty edit and was never
 * affected.
 *
 * WHY THIS AND NOT `-use_editlist 0`. That flag drops every edit list, and an
 * edit list is also how an MP4 hides the composition delay of a B-frame
 * stream; without it, video on such a source shifts against its audio by that
 * delay. Here only an empty edit of at most `maxSeconds` is removed, so the
 * cost is an A/V shift no larger than that (1 ms in the measured case), and
 * every other edit is left exactly as FFmpeg wrote it.
 *
 * HOW. No box changes size. The dropped entry's bytes are handed to a `free`
 * box placed right after the shortened `elst`, inside the same `edts`, so
 * every enclosing size and every `stco`/`co64` chunk offset stays valid.
 */

/** One frame at 30 fps: the largest A/V shift this is allowed to introduce. */
export const MAX_EMPTY_EDIT_SECONDS = 1 / 30;

const CONTAINERS = new Set(["moov", "trak", "edts"]);

export function dropTinyLeadingEmptyEdits(
  input: Uint8Array,
  maxSeconds = MAX_EMPTY_EDIT_SECONDS,
): { bytes: Uint8Array; dropped: number } {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const type = (o: number) =>
    String.fromCharCode(input[o + 4], input[o + 5], input[o + 6], input[o + 7]);

  // Pass 1: find the movie timescale (elst durations are in it) and every elst.
  let movieTimescale = 0;
  const elsts: number[] = [];
  const walk = (start: number, end: number, depth: number) => {
    let o = start;
    while (o + 8 <= end && depth < 8) {
      let size = view.getUint32(o);
      let header = 8;
      if (size === 1) {
        if (o + 16 > end) return;
        size = Number(view.getBigUint64(o + 8));
        header = 16;
      } else if (size === 0) {
        size = end - o;
      }
      if (size < header || o + size > end) return;
      const t = type(o);
      if (t === "mvhd" && o + header + 24 <= end) {
        const v = input[o + header];
        movieTimescale = view.getUint32(o + header + (v === 1 ? 20 : 12));
      }
      if (t === "elst") elsts.push(o);
      if (CONTAINERS.has(t)) walk(o + header, o + size, depth + 1);
      o += size;
    }
  };
  walk(0, input.byteLength, 0);
  if (!movieTimescale || elsts.length === 0) return { bytes: input, dropped: 0 };

  let out: Uint8Array | null = null;
  let dropped = 0;
  for (const at of elsts) {
    const size = view.getUint32(at);
    if (size < 16) continue;
    const version = input[at + 8];
    const count = view.getUint32(at + 12);
    const entry = version === 1 ? 20 : 12;
    // Two entries at least: an empty edit followed by the real one. An elst
    // that is ONLY an empty edit describes a track with no picture at all,
    // which is not this problem and is left alone.
    if (count < 2 || 16 + count * entry > size) continue;
    const first = at + 16;
    const segment = version === 1 ? Number(view.getBigUint64(first)) : view.getUint32(first);
    const mediaTime =
      version === 1 ? Number(view.getBigInt64(first + 8)) : view.getInt32(first + 4);
    if (mediaTime !== -1 || segment / movieTimescale > maxSeconds) continue;

    // Copy on first write, so a file with nothing to fix is returned as-is.
    if (!out) out = new Uint8Array(input);
    const w = new DataView(out.buffer, out.byteOffset, out.byteLength);
    out.copyWithin(first, first + entry, at + 16 + count * entry);
    w.setUint32(at, size - entry);
    w.setUint32(at + 12, count - 1);
    const free = at + size - entry;
    w.setUint32(free, entry);
    out.set([0x66, 0x72, 0x65, 0x65], free + 4); // "free"
    out.fill(0, free + 8, free + entry);
    dropped++;
  }
  return { bytes: out ?? input, dropped };
}

/** Container extensions whose output is ISO-BMFF and so can carry an `elst`. */
export function isIsoBmffExtension(ext: string): boolean {
  return /^\.(mp4|m4v|mov|3gp)$/i.test(ext);
}
