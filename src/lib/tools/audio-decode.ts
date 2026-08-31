/**
 * Decode an audio file into an AudioBuffer at its ORIGINAL sample rate.
 *
 * `decodeAudioData` resamples to its context's rate, and a plain
 * `new AudioContext()` runs at the *device* output rate — so a 96 kHz WAV
 * silently came back at 44.1/48 kHz. The fix: sniff the source rate from the
 * container header and decode through an `OfflineAudioContext` at that rate,
 * which makes the decode a no-op resample. When the sniff comes up empty we
 * fall back to the old device-rate decode rather than failing.
 */

import type { ProcessingContext } from "@/hooks/useFileProcessor";
import { isAbortError, throwIfAborted } from "@/lib/utils/abort";

/** "RIFF…WAVE" → rate from the fmt chunk. */
function sniffWav(b: Uint8Array, view: DataView): number | null {
  if (b.length < 44) return null;
  if (view.getUint32(0) !== 0x52494646 /* RIFF */) return null;
  if (view.getUint32(8) !== 0x57415645 /* WAVE */) return null;
  let off = 12;
  while (off + 8 <= b.length) {
    const id = view.getUint32(off);
    const size = view.getUint32(off + 4, true);
    if (id === 0x666d7420 /* "fmt " */) {
      if (off + 12 > b.length) return null;
      return view.getUint32(off + 12, true);
    }
    off += 8 + size + (size & 1);
  }
  return null;
}

const MP3_RATES: Record<number, [number, number, number]> = {
  3: [44100, 48000, 32000], // MPEG1
  2: [22050, 24000, 16000], // MPEG2
  0: [11025, 12000, 8000], // MPEG2.5
};

/** First MPEG audio frame header after any ID3v2 tag. */
function sniffMp3(b: Uint8Array): number | null {
  if (b.length < 10) return null;
  let off = 0;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    // ID3v2: synchsafe length at 6..9, header is 10 bytes.
    off = 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]);
  }
  // Scan a bounded window for the frame sync so junk can't loop us forever.
  const limit = Math.min(b.length - 4, off + 4096);
  for (; off <= limit; off++) {
    if (b[off] === 0xff && (b[off + 1] & 0xe0) === 0xe0) {
      const version = (b[off + 1] >> 3) & 0x03;
      const layer = (b[off + 1] >> 1) & 0x03;
      const rateIdx = (b[off + 2] >> 2) & 0x03;
      if (version === 1 || layer === 0 || rateIdx === 3) continue; // reserved
      const rates = MP3_RATES[version];
      if (!rates) continue;
      return rates[rateIdx];
    }
  }
  return null;
}

/** "fLaC" → 20-bit rate field in STREAMINFO (always the first block). */
function sniffFlac(b: Uint8Array): number | null {
  if (b.length < 22) return null;
  if (b[0] !== 0x66 || b[1] !== 0x4c || b[2] !== 0x61 || b[3] !== 0x43) return null;
  return (b[18] << 12) | (b[19] << 4) | (b[20] >> 4);
}

/** OggS → Vorbis identification header or OpusHead. */
function sniffOgg(b: Uint8Array, view: DataView): number | null {
  if (b.length < 4 || b[0] !== 0x4f || b[1] !== 0x67 || b[2] !== 0x67 || b[3] !== 0x53)
    return null;
  const limit = Math.min(b.length - 16, 4096);
  for (let i = 0; i < limit; i++) {
    // "\x01vorbis": version(4) channels(1) rate(4 LE)
    if (
      b[i] === 0x01 &&
      b[i + 1] === 0x76 &&
      b[i + 2] === 0x6f &&
      b[i + 3] === 0x72 &&
      b[i + 4] === 0x62 &&
      b[i + 5] === 0x69 &&
      b[i + 6] === 0x73
    ) {
      return view.getUint32(i + 12, true);
    }
    // "OpusHead": version(1) channels(1) preskip(2) inputRate(4 LE).
    // (Opus itself decodes at 48 kHz; the header carries the original rate.)
    if (
      b[i] === 0x4f &&
      b[i + 1] === 0x70 &&
      b[i + 2] === 0x75 &&
      b[i + 3] === 0x73 &&
      b[i + 4] === 0x48 &&
      b[i + 5] === 0x65 &&
      b[i + 6] === 0x61 &&
      b[i + 7] === 0x64
    ) {
      return view.getUint32(i + 12, true);
    }
  }
  return null;
}

/**
 * ISO-BMFF (m4a/mp4): the audio track's `mdhd` timescale is the sample rate.
 *
 * Bounded recursive box walk. The walk runs twice: first accepting only tracks
 * whose `mdia` carries a `soun` handler, then — for single-track files and
 * anything with a missing/unreadable `hdlr` — falling back to the historical
 * first-mdhd-wins behaviour. Without the handler check a container whose video
 * or timed-metadata track is written first (chaptered audiobooks, muxed mp4)
 * hands back that track's timescale, and a plausible-looking 90000 sails
 * through the sanity band below and decodes the audio at the wrong rate.
 */
function sniffMp4(b: Uint8Array, view: DataView): number | null {
  if (b.length < 12) return null;
  if (view.getUint32(4) !== 0x66747970 /* ftyp */) return null;

  const CONTAINERS = new Set([0x6d6f6f76, 0x7472616b, 0x6d646961]); // moov trak mdia

  /** Handler type from an `mdia`'s direct `hdlr` child, or null if absent. */
  function mdiaHandler(start: number, end: number): number | null {
    let off = start;
    while (off + 8 <= end) {
      const size = view.getUint32(off);
      if (size < 8) return null;
      const type = view.getUint32(off + 4);
      const boxEnd = Math.min(off + size, end);
      if (type === 0x68646c72 /* hdlr */) {
        // FullBox: 8-byte header, 4 version/flags, 4 pre_defined, then handler.
        const at = off + 8 + 4 + 4;
        if (at + 4 > boxEnd) return null;
        return view.getUint32(at);
      }
      off = boxEnd;
    }
    return null;
  }

  function walk(start: number, end: number, depth: number, audioOnly: boolean): number | null {
    if (depth > 6) return null;
    let off = start;
    while (off + 8 <= end) {
      const size = view.getUint32(off);
      const type = view.getUint32(off + 4);
      if (size < 8) return null;
      const boxEnd = Math.min(off + size, end);
      if (type === 0x6d646864 /* mdhd */) {
        const version = b[off + 8];
        const at = version === 1 ? off + 8 + 4 + 16 : off + 8 + 4 + 8;
        if (at + 4 > boxEnd) return null;
        return view.getUint32(at);
      }
      if (CONTAINERS.has(type)) {
        // Step over a track that declares itself as something other than sound
        // (vide, meta, text) so its timescale can never stand in for audio.
        if (audioOnly && type === 0x6d646961 /* mdia */) {
          const handler = mdiaHandler(off + 8, boxEnd);
          if (handler !== null && handler !== 0x736f756e /* soun */) {
            off = boxEnd;
            continue;
          }
        }
        const found = walk(off + 8, boxEnd, depth + 1, audioOnly);
        if (found !== null) return found;
      }
      off = boxEnd;
    }
    return null;
  }

  return walk(0, b.length, 0, true) ?? walk(0, b.length, 0, false);
}

/**
 * Best-effort source sample rate from container headers. Null when unsure —
 * callers treat null as "decode at device rate", never as an error.
 */
export function sniffSampleRate(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rate =
    sniffWav(bytes, view) ??
    sniffFlac(bytes) ??
    sniffOgg(bytes, view) ??
    sniffMp4(bytes, view) ??
    sniffMp3(bytes);
  // Web Audio contexts reject rates outside a sane band; treat absurd sniffs
  // (corrupt headers) as unknown rather than crashing the decode.
  if (rate === null || !Number.isFinite(rate) || rate < 8000 || rate > 384000) return null;
  return rate;
}

/**
 * Containers worth handing to FFmpeg when the browser's own decoder gives up:
 * AAC/M4A outside Chromium, Ogg Vorbis/Opus and FLAC in Safari. A deliberate
 * allowlist — an unknown extension must fail fast, not pull a 31 MB engine.
 */
const FFMPEG_FALLBACK_EXTS = new Set(["m4a", "m4b", "aac", "mp4", "ogg", "oga", "opus", "flac", "mp3", "wav"]);

function canFallbackToFFmpeg(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return FFMPEG_FALLBACK_EXTS.has(ext);
}

/**
 * Last-resort decode: FFmpeg transcodes to WAV (which every browser decodes),
 * then the WAV goes through the normal rate-preserving path. Reached only
 * when `decodeAudioData` rejects a container on the allowlist above — e.g.
 * M4A/AAC in Firefox, Ogg in Safari.
 *
 * Only `ctx.signal` is forwarded, never `ctx.onProgress`: this is the *decode*
 * half of a job whose encode owns the progress bar, and letting it drive the
 * same bar 0→100 would make the encode appear to restart from zero.
 */
async function decodeViaFFmpeg(
  file: File,
  ctx: ProcessingContext = {},
): Promise<AudioBuffer> {
  const { runFFmpegTask, fileToUint8Array } = await import("./ffmpeg-loader");
  const dot = file.name.lastIndexOf(".");
  const inputName = "input" + (dot >= 0 ? file.name.slice(dot) : ".dat");
  const outputName = "decoded.wav";

  const wavBytes = await runFFmpegTask(async (ffmpeg) => {
    await ffmpeg.writeFile(inputName, await fileToUint8Array(file));
    const ret = await ffmpeg.exec(["-i", inputName, "-acodec", "pcm_s16le", "-f", "wav", outputName]);
    if (ret !== 0) throw new Error("FFmpeg could not decode this audio file");
    const data = await ffmpeg.readFile(outputName);
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);
    return data as Uint8Array;
  }, { signal: ctx.signal });

  const bytes =
    wavBytes instanceof Uint8Array ? wavBytes : new Uint8Array(wavBytes as ArrayBufferLike);
  return decodeBytes(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
}

/** The shared rate-preserving decode over raw bytes. */
async function decodeBytes(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
  const sourceRate = sniffSampleRate(new Uint8Array(arrayBuffer));

  if (sourceRate !== null) {
    try {
      // Offline context at the source rate — decode without resampling.
      // (decodeAudioData detaches its input, hence the copy: the fallback
      // below must still be able to read the bytes.)
      const offline = new OfflineAudioContext(1, 1, sourceRate);
      return await offline.decodeAudioData(arrayBuffer.slice(0));
    } catch {
      // A wrong sniff must not turn a decodable file into an error.
    }
  }

  const audioCtx = new AudioContext();
  try {
    return await audioCtx.decodeAudioData(arrayBuffer);
  } finally {
    await audioCtx.close();
  }
}

/**
 * `ctx.signal` gives the caller two real checkpoints (before the read, before
 * the FFmpeg fallback) and lets an abort tear the FFmpeg worker down mid-run.
 * `decodeAudioData` itself is not interruptible, so a browser decode already
 * under way still runs to completion — what changes is that the 31 MB fallback
 * no longer keeps grinding after the user has cancelled.
 */
export async function decodeAudioFile(
  file: File,
  ctx: ProcessingContext = {},
): Promise<AudioBuffer> {
  throwIfAborted(ctx.signal);
  const arrayBuffer = await file.arrayBuffer();
  try {
    return await decodeBytes(arrayBuffer);
  } catch (err) {
    if (canFallbackToFFmpeg(file)) {
      throwIfAborted(ctx.signal);
      try {
        return await decodeViaFFmpeg(file, ctx);
      } catch (fallbackErr) {
        // Report the browser's own decode error, not the fallback's — except
        // for a cancellation, which is a user decision and must stay one.
        if (isAbortError(fallbackErr)) throw fallbackErr;
      }
    }
    throw err;
  }
}

/**
 * Extract raw Int16 samples from an AudioBuffer for a given channel.
 * Converts float32 [-1, 1] to int16 [-32768, 32767].
 */
export function getInt16Samples(buffer: AudioBuffer, channel: number): Int16Array {
  const float32 = buffer.getChannelData(channel);
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}
