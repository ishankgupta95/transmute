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

/** Byte offset just past an ID3v2 tag, or 0 when the file does not open with one. */
function skipId3v2(b: Uint8Array): number {
  if (b.length < 10) return 0;
  if (b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0;
  // ID3v2: synchsafe length at 6..9, header is 10 bytes.
  return 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]);
}

/**
 * Raw ADTS AAC — a bare elementary stream (`.aac`) with no container box to
 * key off, which is why it used to fall through to `sniffMp3`.
 *
 * That fall-through was a live bug, not a theoretical one. AAC payload bytes
 * hit the MPEG sync pattern by chance often enough that every scan window
 * position of a real stream produced a false sync, so the same audio decoded
 * at 48 kHz as a `.aac` and 44.1 kHz as a `.m4a` — `decodeAudioData` RESAMPLES
 * to the context rate, which is precisely the loss this module exists to
 * prevent. `.aac` is accepted by aac-to-mp3, m4a-to-wav, m4a-to-mp3,
 * audio-trimmer and merge-audio.
 *
 * ADTS is only recognised at the START of the file (after any ID3v2 tag),
 * never by scanning: that is where an elementary stream actually begins, and
 * refusing to scan is what stops this sniffer from doing to other containers
 * what `sniffMp3` was doing to this one.
 */
const ADTS_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
];

function adtsFrameAt(b: Uint8Array, off: number): { rate: number; length: number } | null {
  if (off < 0 || off + 7 > b.length) return null;
  // Syncword 0xFFF plus layer == 00. Layer is the field that separates ADTS
  // from an MPEG audio frame header: 00 is reserved in MPEG audio, so a real
  // MP3 frame can never satisfy this and a real ADTS frame always does.
  if (b[off] !== 0xff || (b[off + 1] & 0xf6) !== 0xf0) return null;
  const rate = ADTS_RATES[(b[off + 2] >> 2) & 0x0f];
  if (rate === undefined) return null;
  // aac_frame_length: 13 bits spanning bytes 3..5, header included.
  const length = ((b[off + 3] & 0x03) << 11) | (b[off + 4] << 3) | (b[off + 5] >> 5);
  if (length < 7) return null;
  return { rate, length };
}

function sniffAdts(b: Uint8Array): number | null {
  const off = skipId3v2(b);
  const first = adtsFrameAt(b, off);
  if (!first) return null;
  const second = adtsFrameAt(b, off + first.length);
  // A second frame exactly one aac_frame_length on proves the length field was
  // real rather than two bytes that happened to line up. Only a read too short
  // to hold one is excused.
  if (second) return second.rate === first.rate ? first.rate : null;
  return off + first.length + 7 <= b.length ? null : first.rate;
}

const MP3_RATES: Record<number, [number, number, number]> = {
  3: [44100, 48000, 32000], // MPEG1
  2: [22050, 24000, 16000], // MPEG2
  0: [11025, 12000, 8000], // MPEG2.5
};

/** kbps by bitrate index, keyed by the layer field (3 = I, 2 = II, 1 = III). */
const MPEG1_BITRATES: Record<number, number[]> = {
  3: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0],
  2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0],
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
};
const MPEG2_BITRATES: Record<number, number[]> = {
  3: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
  1: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
};

/**
 * A fully validated MPEG audio frame header at `off`, or null.
 *
 * Eleven sync bits alone are cheap to hit by accident, so every reserved
 * encoding is rejected here — layer 00, version 01, bitrate index 0 (free) or
 * 15, sampling index 11 — and the frame length is computed so the caller can
 * demand a second frame where this one says it ends.
 */
function mpegFrameAt(
  b: Uint8Array,
  off: number,
): { rate: number; length: number; key: number } | null {
  if (off < 0 || off + 4 > b.length) return null;
  if (b[off] !== 0xff || (b[off + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[off + 1] >> 3) & 0x03;
  const layer = (b[off + 1] >> 1) & 0x03;
  if (version === 1 || layer === 0) return null; // reserved
  const bitrateIdx = (b[off + 2] >> 4) & 0x0f;
  const rateIdx = (b[off + 2] >> 2) & 0x03;
  if (bitrateIdx === 0 || bitrateIdx === 15 || rateIdx === 3) return null;
  const rates = MP3_RATES[version];
  const kbps = (version === 3 ? MPEG1_BITRATES : MPEG2_BITRATES)[layer]?.[bitrateIdx];
  if (!rates || !kbps) return null;
  const rate = rates[rateIdx];
  const padding = (b[off + 2] >> 1) & 0x01;
  // Layer I carries 384 samples a frame in 4-byte slots; Layer II and MPEG1
  // Layer III carry 1152; MPEG2/2.5 Layer III carries 576.
  const length =
    layer === 3
      ? (Math.floor((12 * kbps * 1000) / rate) + padding) * 4
      : Math.floor(((layer === 1 && version !== 3 ? 72 : 144) * kbps * 1000) / rate) + padding;
  if (length < 4) return null;
  return { rate, length, key: (version << 4) | (layer << 2) | rateIdx };
}

/** First MPEG audio frame header after any ID3v2 tag. */
function sniffMp3(b: Uint8Array): number | null {
  if (b.length < 10) return null;
  let off = skipId3v2(b);
  // Scan a bounded window for the frame sync so junk can't loop us forever.
  const limit = Math.min(b.length - 4, off + 4096);
  for (; off <= limit; off++) {
    const frame = mpegFrameAt(b, off);
    if (!frame) continue;
    const next = mpegFrameAt(b, off + frame.length);
    // Version, layer and sampling rate are fixed for the life of a stream, so
    // a matching header exactly one frame on is the cross-check that a lone
    // sync pattern inside somebody else's payload cannot fake.
    if (next) {
      if (next.key === frame.key) return frame.rate;
      continue;
    }
    // A read too short to hold the next frame has nothing to check against;
    // take the well-formed header rather than reporting nothing.
    if (off + frame.length + 4 > b.length) return frame.rate;
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
    // Ahead of the MP3 fall-through: a raw ADTS stream is not a container, so
    // sniffMp3 used to scan its payload and false-sync on it.
    sniffAdts(bytes) ??
    sniffMp3(bytes);
  // Web Audio contexts reject rates outside a sane band; treat absurd sniffs
  // (corrupt headers) as unknown rather than crashing the decode.
  if (rate === null || !Number.isFinite(rate) || rate < 8000 || rate > 384000) return null;
  return rate;
}

/**
 * Containers worth handing to FFmpeg when the browser's own decoder gives up:
 * AAC/M4A outside Chromium, Ogg Vorbis/Opus and FLAC in Safari, and WMA
 * everywhere. A deliberate allowlist — an unknown extension must fail fast,
 * not pull a 31 MB engine.
 *
 * `wma` is the one entry here that is not a fallback but the ONLY path. No
 * browser decodes WMA at all; measured 2026-09-04 on a real 35 744-byte
 * `wmav2`-in-ASF file, `decodeAudioData` rejected it in every engine:
 *   Chromium "Unable to decode audio data"
 *   WebKit   "Decoding failed"
 *   Firefox  "The buffer passed to decodeAudioData contains an unknown content type."
 * and the fallback below then handled it — the exact argv on line ~228,
 * against the shipped core in headless Chromium, returned EXIT=0 in 16 ms with
 * a 352 334-byte WAV, which `decodeAudioData` decoded to 2.0 s of stereo audio
 * at peak 0.3694. So a `.wma` here always costs the 31 MB engine, and there is
 * no cheaper way to open one in a browser.
 */
const FFMPEG_FALLBACK_EXTS = new Set(["m4a", "m4b", "aac", "mp4", "ogg", "oga", "opus", "flac", "mp3", "wav", "wma"]);

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
    try {
      const ret = await ffmpeg.exec(["-i", inputName, "-acodec", "pcm_s16le", "-f", "wav", outputName]);
      if (ret !== 0) throw new Error("FFmpeg could not decode this audio file");
      return (await ffmpeg.readFile(outputName)) as Uint8Array;
    } finally {
      // Both have to run even when exec threw. A failure is the ordinary path
      // here — /wma-to-mp3 is FFmpeg-only, and a DRM'd or truncated file fails
      // every time — and without this the whole source stays pinned in MEMFS
      // for the life of the tab, one full copy per attempt.
      await ffmpeg.deleteFile(inputName).catch(() => {
        /* never written */
      });
      await ffmpeg.deleteFile(outputName).catch(() => {
        /* never written */
      });
    }
  }, { signal: ctx.signal });

  const bytes =
    wavBytes instanceof Uint8Array ? wavBytes : new Uint8Array(wavBytes as ArrayBufferLike);
  /*
    Built here, NOT handed back to decodeAudioData. Measured 2026-11-11 in
    Chromium: Web Audio rejects 6-channel audio whose declared layout is 5.1
    with BACK surrounds (WAVEFORMATEXTENSIBLE mask 0x3F) — "Unable to decode
    audio data" — while the same samples with mask 0x60F (side surrounds) or no
    mask decode fine. 0x3F is the classic 5.1 mask, and FFmpeg writes it both as
    the FLAC channel-mask tag and in the >2-channel WAV this fallback produces.
    So a 5.1 FLAC or a DAW's 5.1 WAV failed the browser decode AND this
    fallback, and flac-to-mp3, audio-trimmer and reverse-audio showed the raw
    browser error. The samples are plain s16le, which needs no decoder at all.
  */
  const direct = pcm16WavToAudioBuffer(bytes);
  if (direct) return direct;
  return decodeBytes(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
}

/**
 * A 16-bit PCM WAV (plain or WAVE_FORMAT_EXTENSIBLE) as an AudioBuffer at its
 * own rate and channel count, with no decoder involved. Returns null for
 * anything else, so the caller can fall back to the browser. Exported for tests.
 */
export function pcm16WavToAudioBuffer(bytes: Uint8Array): AudioBuffer | null {
  if (bytes.length < 44 || typeof AudioBuffer === "undefined") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;

  let channels = 0;
  let rate = 0;
  let pcm16 = false;
  let dataAt = -1;
  let dataLen = 0;
  for (let o = 12; o + 8 <= bytes.length; ) {
    const id = tag(o);
    const size = view.getUint32(o + 4, true);
    const body = o + 8;
    if (id === "fmt " && size >= 16) {
      const format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      rate = view.getUint32(body + 4, true);
      const bits = view.getUint16(body + 14, true);
      // 0xFFFE: the sub-format GUID starts with the real format code.
      const real = format === 0xfffe && size >= 26 ? view.getUint16(body + 24, true) : format;
      pcm16 = real === 1 && bits === 16;
    } else if (id === "data") {
      dataAt = body;
      // FFmpeg writes 0xFFFFFFFF-style sizes when streaming; trust the file.
      dataLen = Math.min(size, bytes.length - body);
      break;
    }
    o = body + size + (size & 1);
  }
  if (!pcm16 || dataAt < 0 || channels < 1 || channels > 32 || rate < 3000 || rate > 768000) {
    return null;
  }
  const frames = Math.floor(dataLen / (2 * channels));
  if (frames < 1) return null;
  const buffer = new AudioBuffer({ numberOfChannels: channels, length: frames, sampleRate: rate });
  for (let c = 0; c < channels; c++) {
    const out = new Float32Array(frames);
    for (let i = 0, at = dataAt + c * 2; i < frames; i++, at += 2 * channels) {
      out[i] = view.getInt16(at, true) / 32768;
    }
    buffer.copyToChannel(out, c);
  }
  return buffer;
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
