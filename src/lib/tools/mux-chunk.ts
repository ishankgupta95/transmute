import type { ArrayBufferTarget, Muxer } from "mp4-muxer";

/**
 * Hand encoder chunks to mp4-muxer even when the browser leaves
 * `chunk.duration` null.
 *
 * WebCodecs makes `EncodedVideoChunk.duration` / `EncodedAudioChunk.duration`
 * nullable, and WebKit's encoders leave it null. mp4-muxer's `addVideoChunk`
 * passes it straight through and throws "addVideoChunkRaw's fourth argument
 * (duration) must be a non-negative real number" — on the FIRST chunk, before
 * the codec description is stored, so `finalize()` then dies with the raw
 * "null is not an object (evaluating 'track.info.decoderConfig.colorSpace')".
 * Measured 2026-11-11 in Playwright's WebKit on compress-video: that string
 * was what the page showed the user.
 *
 * What the duration is for (read from mp4-muxer 5's `addSampleToTrack`): the
 * gap between consecutive samples comes from their TIMESTAMPS; a sample's own
 * duration only sets the LAST sample's length and so the track's total. So
 * the stand-in for a missing video duration is the previous frame gap, and
 * for AAC it is exact — one AAC frame is always 1024 samples.
 *
 * Kept out of `video-utils.ts` on purpose: that module is `vi.mock`ed by name
 * in several unit suites, and every new export there churns their factories.
 */

type Mp4Muxer = Muxer<ArrayBufferTarget>;

/** Used only until a second frame has shown what the real gap is. */
const FIRST_FRAME_GUESS_US = 1_000_000 / 30;

function usable(duration: number | null | undefined): duration is number {
  return typeof duration === "number" && Number.isFinite(duration) && duration >= 0;
}

function bytesOf(chunk: EncodedVideoChunk | EncodedAudioChunk): Uint8Array {
  const data = new Uint8Array(chunk.byteLength);
  chunk.copyTo(data);
  return data;
}

/** A video `output` handler for one encode. Tracks the frame gap as it goes. */
export function videoChunkAdder(
  muxer: Mp4Muxer,
): (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => void {
  let previous: number | null = null;
  let gap = FIRST_FRAME_GUESS_US;
  return (chunk, meta) => {
    if (previous !== null && chunk.timestamp > previous) gap = chunk.timestamp - previous;
    previous = chunk.timestamp;
    if (usable(chunk.duration)) {
      muxer.addVideoChunk(chunk, meta);
      return;
    }
    muxer.addVideoChunkRaw(bytesOf(chunk), chunk.type, chunk.timestamp, gap, meta);
  };
}

/** An AAC `output` handler. One AAC frame is 1024 samples at `sampleRate`. */
export function audioChunkAdder(
  muxer: Mp4Muxer,
  sampleRate: number,
): (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => void {
  const aacFrameUs = (1024 / sampleRate) * 1_000_000;
  return (chunk, meta) => {
    if (usable(chunk.duration)) {
      muxer.addAudioChunk(chunk, meta);
      return;
    }
    muxer.addAudioChunkRaw(bytesOf(chunk), chunk.type, chunk.timestamp, aacFrameUs, meta);
  };
}
