/**
 * Generate the *real* media fixtures the conversion E2E suite runs against.
 *
 *   node scripts/generate-test-fixtures.mjs
 *
 * Why this exists: the unit suite runs in jsdom (no canvas, no WASM) and the
 * older E2E specs fed tools stub blobs — a 16-byte "MP4", a silent WAV, a blank
 * PDF. Those prove the UI renders; they cannot prove FFmpeg.wasm / WebCodecs /
 * MuPDF / lamejs still produce correct output. `src/__tests__/e2e/conversion/`
 * needs inputs a real decoder will accept, so this script produces them.
 *
 * There is no `ffmpeg` binary on the dev box and Playwright's bundled build is
 * compiled `--disable-everything` (VP8/WebM/PNG only), so anything needing
 * H.264 or AAC is encoded by Chromium itself through WebCodecs + mp4-muxer.
 * WebCodecs is gated on a secure context, hence the routed `https://` origin
 * below rather than `about:blank`.
 *
 * Outputs land in `src/__tests__/fixtures/samples/` and are checked in — they
 * total well under a megabyte and regenerating them requires a browser.
 */

import { chromium } from "@playwright/test";
import { Buffer } from "node:buffer";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "src/__tests__/fixtures/samples");
const MUXER_UMD = path.join(ROOT, "node_modules/mp4-muxer/build/mp4-muxer.js");

const WIDTH = 320;
const HEIGHT = 240;
const FPS = 24;
const DURATION_S = 2;
const SAMPLE_RATE = 44100;

// ────────────────────────────────────────────────────────────────────────────
// Browser-encoded fixtures (H.264 + AAC, VP8/Opus, baseline JPEG)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Runs inside the page. Encodes:
 *   - an H.264 + AAC MP4 (video + audio tracks)
 *   - an AAC-only MP4, which is what an `.m4a` actually is
 *   - a VP8/Opus WebM via MediaRecorder
 *   - a real baseline JPEG via canvas
 *
 * Frames carry moving, high-contrast content on purpose: a flat-colour clip
 * compresses to almost nothing and would make "did compression do anything"
 * assertions vacuous, and a still frame makes trimming unfalsifiable.
 */
async function encodeInPage({ width, height, fps, durationS, sampleRate }) {
  const totalFrames = fps * durationS;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  const drawFrame = (i) => {
    const t = i / totalFrames;
    ctx.fillStyle = `hsl(${Math.round(t * 360)}, 70%, 45%)`;
    ctx.fillRect(0, 0, width, height);
    // A moving block plus per-frame text keeps inter-frame deltas non-trivial.
    ctx.fillStyle = "#fff";
    ctx.fillRect(Math.round(t * (width - 60)), Math.round(height / 2 - 30), 60, 60);
    ctx.fillStyle = "#000";
    ctx.font = "20px sans-serif";
    ctx.fillText(`frame ${i}`, 10, 30);
    // Diagonal stripes add spatial detail so the encoder cannot collapse the
    // frame to a couple of macroblocks.
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 3;
    for (let x = -height; x < width; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x + (t * 16), 0);
      ctx.lineTo(x + height + (t * 16), height);
      ctx.stroke();
    }
  };

  // Stereo 440/554 Hz (an A-C# dyad) so channel handling is observable and the
  // signal is clearly non-silent to a waveform/peak check.
  const makePcm = () => {
    const frames = sampleRate * durationS;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      const s = i / sampleRate;
      // Fade in/out to avoid a click at the boundaries.
      const env = Math.min(1, s * 8, (durationS - s) * 8);
      left[i] = Math.sin(2 * Math.PI * 440 * s) * 0.4 * env;
      right[i] = Math.sin(2 * Math.PI * 554.37 * s) * 0.4 * env;
    }
    return { left, right, frames };
  };

  const encodeAac = async (muxer, { left, right, frames }) => {
    const chunkFrames = 1024;
    const encoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => { throw e; },
    });
    encoder.configure({
      codec: "mp4a.40.2",
      sampleRate,
      numberOfChannels: 2,
      bitrate: 128000,
    });
    for (let off = 0; off < frames; off += chunkFrames) {
      const n = Math.min(chunkFrames, frames - off);
      // AudioData wants planar f32 as [all left][all right].
      const planar = new Float32Array(n * 2);
      planar.set(left.subarray(off, off + n), 0);
      planar.set(right.subarray(off, off + n), n);
      const data = new AudioData({
        format: "f32-planar",
        sampleRate,
        numberOfFrames: n,
        numberOfChannels: 2,
        timestamp: Math.round((off / sampleRate) * 1e6),
        data: planar,
      });
      encoder.encode(data);
      data.close();
    }
    await encoder.flush();
    encoder.close();
  };

  // ---- MP4: H.264 video + AAC audio -------------------------------------
  const muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: "avc", width, height },
    audio: { codec: "aac", numberOfChannels: 2, sampleRate },
    fastStart: "in-memory",
  });

  const vEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { throw e; },
  });
  vEncoder.configure({
    codec: "avc1.42001f", // Baseline 3.1 — the most broadly decodable profile.
    width,
    height,
    bitrate: 600_000,
    framerate: fps,
  });
  for (let i = 0; i < totalFrames; i++) {
    drawFrame(i);
    const frame = new VideoFrame(canvas, {
      timestamp: Math.round((i / fps) * 1e6),
      duration: Math.round(1e6 / fps),
    });
    // A keyframe every second keeps seeking (trim, filmstrip) honest.
    vEncoder.encode(frame, { keyFrame: i % fps === 0 });
    frame.close();
  }
  await vEncoder.flush();
  vEncoder.close();

  const pcm = makePcm();
  await encodeAac(muxer, pcm);
  muxer.finalize();
  const mp4 = new Uint8Array(muxer.target.buffer);

  // ---- M4A: AAC only, MP4 container --------------------------------------
  const aMuxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    audio: { codec: "aac", numberOfChannels: 2, sampleRate },
    fastStart: "in-memory",
  });
  await encodeAac(aMuxer, pcm);
  aMuxer.finalize();
  const m4a = new Uint8Array(aMuxer.target.buffer);

  // ---- WebM: VP8 + Opus via MediaRecorder --------------------------------
  // MediaRecorder is realtime, so this costs `durationS` of wall clock.
  const webm = await new Promise((resolve, reject) => {
    const stream = canvas.captureStream(fps);
    const ac = new AudioContext({ sampleRate });
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    gain.gain.value = 0.3;
    osc.frequency.value = 440;
    const dest = ac.createMediaStreamDestination();
    osc.connect(gain).connect(dest);
    osc.start();
    for (const track of dest.stream.getAudioTracks()) stream.addTrack(track);

    const rec = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8,opus" });
    const parts = [];
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    rec.onerror = reject;
    rec.onstop = async () => {
      osc.stop();
      await ac.close();
      const blob = new Blob(parts, { type: "video/webm" });
      resolve(new Uint8Array(await blob.arrayBuffer()));
    };
    rec.start();

    let i = 0;
    const timer = setInterval(() => {
      drawFrame(i % totalFrames);
      i++;
      if (i >= totalFrames) {
        clearInterval(timer);
        rec.stop();
      }
    }, 1000 / fps);
  });

  // ---- JPEG: real baseline JPEG from canvas ------------------------------
  const photo = document.createElement("canvas");
  photo.width = 800;
  photo.height = 600;
  const pctx = photo.getContext("2d");
  const grad = pctx.createLinearGradient(0, 0, 800, 600);
  grad.addColorStop(0, "#0b1020");
  grad.addColorStop(0.5, "#2f6fb2");
  grad.addColorStop(1, "#e8b04b");
  pctx.fillStyle = grad;
  pctx.fillRect(0, 0, 800, 600);
  for (let i = 0; i < 40; i++) {
    pctx.fillStyle = `hsla(${i * 9}, 80%, ${40 + (i % 5) * 8}%, 0.75)`;
    pctx.beginPath();
    pctx.arc((i * 97) % 800, (i * 53) % 600, 18 + (i % 7) * 6, 0, Math.PI * 2);
    pctx.fill();
  }
  pctx.fillStyle = "#fff";
  pctx.font = "bold 44px sans-serif";
  pctx.fillText("transmute fixture", 40, 550);
  const jpegBlob = await new Promise((r) => photo.toBlob(r, "image/jpeg", 0.92));
  const jpeg = new Uint8Array(await jpegBlob.arrayBuffer());

  const b64 = (u8) => {
    let s = "";
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    }
    return btoa(s);
  };

  return { mp4: b64(mp4), m4a: b64(m4a), webm: b64(webm), jpeg: b64(jpeg) };
}

// ────────────────────────────────────────────────────────────────────────────
// EXIF — built by hand so the photo fixture carries GPS
// ────────────────────────────────────────────────────────────────────────────

const TYPE = { BYTE: 1, ASCII: 2, SHORT: 3, LONG: 4, RATIONAL: 5, UNDEFINED: 7 };
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 };

function payloadLength(entry) {
  return TYPE_SIZE[entry.type] * entryCount(entry);
}

function entryCount(entry) {
  if (entry.type === TYPE.ASCII) return entry.value.length + 1; // NUL terminator
  if (entry.type === TYPE.RATIONAL) return entry.value.length / 2;
  return Array.isArray(entry.value) ? entry.value.length : 1;
}

function writePayload(buf, offset, entry) {
  let o = offset;
  switch (entry.type) {
    case TYPE.ASCII:
      buf.write(entry.value, o, "latin1");
      buf[o + entry.value.length] = 0;
      break;
    case TYPE.RATIONAL:
      // value is a flat [num, den, num, den, …] list.
      for (let i = 0; i < entry.value.length; i += 2) {
        buf.writeUInt32LE(entry.value[i], o);
        buf.writeUInt32LE(entry.value[i + 1], o + 4);
        o += 8;
      }
      break;
    case TYPE.SHORT:
      for (const v of [entry.value].flat()) { buf.writeUInt16LE(v, o); o += 2; }
      break;
    case TYPE.LONG:
      for (const v of [entry.value].flat()) { buf.writeUInt32LE(v, o); o += 4; }
      break;
    default: // BYTE / UNDEFINED
      for (const v of [entry.value].flat()) { buf[o] = v; o += 1; }
  }
}

/** Size an IFD occupies: the directory itself plus any out-of-line payloads. */
function ifdSize(entries) {
  let size = 2 + entries.length * 12 + 4;
  for (const e of entries) {
    const len = payloadLength(e);
    if (len > 4) size += len + (len % 2); // keep payloads word-aligned
  }
  return size;
}

/** Serialise an IFD into `buf` at absolute offset `start` (TIFF-relative). */
function writeIfd(buf, start, entries, tiffBase) {
  buf.writeUInt16LE(entries.length, start);
  let entryOff = start + 2;
  let dataOff = start + 2 + entries.length * 12 + 4;
  for (const e of entries) {
    buf.writeUInt16LE(e.tag, entryOff);
    buf.writeUInt16LE(e.type, entryOff + 2);
    buf.writeUInt32LE(entryCount(e), entryOff + 4);
    const len = payloadLength(e);
    if (len > 4) {
      buf.writeUInt32LE(dataOff - tiffBase, entryOff + 8);
      writePayload(buf, dataOff, e);
      dataOff += len + (len % 2);
    } else {
      writePayload(buf, entryOff + 8, e);
    }
    entryOff += 12;
  }
  buf.writeUInt32LE(0, start + 2 + entries.length * 12); // no next IFD
}

/**
 * Build an APP1 Exif segment carrying IFD0 + Exif SubIFD + GPS IFD.
 * Coordinates are the Golden Gate Bridge — a recognisable, obviously-synthetic
 * location, so nothing here looks like a real person's photo metadata.
 */
export function buildExifApp1(orientation = 1) {
  const gps = [
    { tag: 0x0000, type: TYPE.BYTE, value: [2, 3, 0, 0] },        // GPSVersionID
    { tag: 0x0001, type: TYPE.ASCII, value: "N" },                 // GPSLatitudeRef
    { tag: 0x0002, type: TYPE.RATIONAL, value: [37, 1, 49, 1, 3130, 100] },
    { tag: 0x0003, type: TYPE.ASCII, value: "W" },                 // GPSLongitudeRef
    { tag: 0x0004, type: TYPE.RATIONAL, value: [122, 1, 28, 1, 3000, 100] },
    { tag: 0x0005, type: TYPE.BYTE, value: [0] },                  // GPSAltitudeRef = above sea level
    { tag: 0x0006, type: TYPE.RATIONAL, value: [6700, 100] },      // GPSAltitude 67 m
  ];

  const exif = [
    { tag: 0x829a, type: TYPE.RATIONAL, value: [1, 250] },         // ExposureTime
    { tag: 0x829d, type: TYPE.RATIONAL, value: [56, 10] },         // FNumber f/5.6
    { tag: 0x8827, type: TYPE.SHORT, value: [200] },               // ISO
    { tag: 0x9003, type: TYPE.ASCII, value: "2026:08:08 11:24:31" }, // DateTimeOriginal
    { tag: 0x920a, type: TYPE.RATIONAL, value: [35, 1] },          // FocalLength
    { tag: 0xa002, type: TYPE.LONG, value: [800] },                // PixelXDimension
    { tag: 0xa003, type: TYPE.LONG, value: [600] },                // PixelYDimension
  ];

  // Pointer values are patched once the sub-IFD offsets are known; they are
  // LONG/inline either way, so sizing is unaffected by the placeholder.
  const ifd0 = [
    { tag: 0x010f, type: TYPE.ASCII, value: "Transmute" },         // Make
    { tag: 0x0110, type: TYPE.ASCII, value: "Fixture Camera" },    // Model
    { tag: 0x0112, type: TYPE.SHORT, value: [orientation] },       // Orientation
    { tag: 0x011a, type: TYPE.RATIONAL, value: [72, 1] },          // XResolution
    { tag: 0x011b, type: TYPE.RATIONAL, value: [72, 1] },          // YResolution
    { tag: 0x0128, type: TYPE.SHORT, value: [2] },                 // ResolutionUnit = inch
    { tag: 0x0131, type: TYPE.ASCII, value: "Transmute Fixtures 1.0" }, // Software
    { tag: 0x0132, type: TYPE.ASCII, value: "2026:08:08 11:24:31" },    // DateTime
    { tag: 0x8769, type: TYPE.LONG, value: [0] },                  // ExifIFDPointer
    { tag: 0x8825, type: TYPE.LONG, value: [0] },                  // GPSInfoIFDPointer
  ];

  const TIFF_BASE = 0;
  const ifd0Start = 8;
  const exifStart = ifd0Start + ifdSize(ifd0);
  const gpsStart = exifStart + ifdSize(exif);
  const total = gpsStart + ifdSize(gps);

  ifd0.find((e) => e.tag === 0x8769).value = [exifStart - TIFF_BASE];
  ifd0.find((e) => e.tag === 0x8825).value = [gpsStart - TIFF_BASE];

  const tiff = Buffer.alloc(total);
  tiff.write("II", 0, "latin1");      // little-endian
  tiff.writeUInt16LE(0x002a, 2);      // magic 42
  tiff.writeUInt32LE(ifd0Start, 4);   // offset of IFD0
  writeIfd(tiff, ifd0Start, ifd0, TIFF_BASE);
  writeIfd(tiff, exifStart, exif, TIFF_BASE);
  writeIfd(tiff, gpsStart, gps, TIFF_BASE);

  const header = Buffer.from("Exif\0\0", "latin1");
  const body = Buffer.concat([header, tiff]);
  const marker = Buffer.alloc(4);
  marker.writeUInt16BE(0xffe1, 0);
  marker.writeUInt16BE(body.length + 2, 2); // length includes the 2 length bytes
  return Buffer.concat([marker, body]);
}

/** Splice an APP1 Exif segment in directly after SOI. */
export function withExif(jpeg, orientation = 1) {
  if (jpeg.readUInt16BE(0) !== 0xffd8) throw new Error("not a JPEG (missing SOI)");
  return Buffer.concat([jpeg.subarray(0, 2), buildExifApp1(orientation), jpeg.subarray(2)]);
}

/** Remove an APP1 segment sitting directly after SOI (for re-tagging). */
export function withoutExif(jpeg) {
  if (jpeg.readUInt16BE(0) !== 0xffd8) throw new Error("not a JPEG (missing SOI)");
  if (jpeg.readUInt16BE(2) !== 0xffe1) return jpeg;
  const segLen = jpeg.readUInt16BE(4);
  return Buffer.concat([jpeg.subarray(0, 2), jpeg.subarray(4 + segLen)]);
}

// ────────────────────────────────────────────────────────────────────────────
// Node-side fixtures (MP3, WAV, PDF)
// ────────────────────────────────────────────────────────────────────────────

async function buildMp3() {
  const { Mp3Encoder } = (await import("@breezystack/lamejs")).default;
  const encoder = new Mp3Encoder(2, SAMPLE_RATE, 128);
  const frames = SAMPLE_RATE * DURATION_S;
  const left = new Int16Array(frames);
  const right = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    const s = i / SAMPLE_RATE;
    const env = Math.min(1, s * 8, (DURATION_S - s) * 8);
    left[i] = Math.round(Math.sin(2 * Math.PI * 440 * s) * 12000 * env);
    right[i] = Math.round(Math.sin(2 * Math.PI * 554.37 * s) * 12000 * env);
  }
  const parts = [];
  const BLOCK = 1152;
  for (let i = 0; i < frames; i += BLOCK) {
    const n = Math.min(BLOCK, frames - i);
    const buf = encoder.encodeBuffer(left.subarray(i, i + n), right.subarray(i, i + n));
    if (buf.length) parts.push(Buffer.from(buf));
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(Buffer.from(tail));
  return Buffer.concat(parts);
}

/** 16-bit stereo PCM WAV carrying an actual tone — silence makes peak/waveform
 *  assertions vacuous, which is exactly the trap the old fixtures fell into. */
function buildWav() {
  const frames = SAMPLE_RATE * DURATION_S;
  const dataSize = frames * 2 * 2; // stereo, 16-bit
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, "latin1");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "latin1");
  buf.write("fmt ", 12, "latin1");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);            // PCM
  buf.writeUInt16LE(2, 22);            // stereo
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 4, 28);
  buf.writeUInt16LE(4, 32);            // block align
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "latin1");
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < frames; i++) {
    const s = i / SAMPLE_RATE;
    const env = Math.min(1, s * 8, (DURATION_S - s) * 8);
    buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * s) * 12000 * env), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 554.37 * s) * 12000 * env), 44 + i * 4 + 2);
  }
  return buf;
}

/**
 * 5.1-style 6-channel WAV. Pins the multichannel paths for real: the WAV
 * encoder must interleave and preserve all six, the MP3 encoder must fold
 * them to stereo. Each channel carries a distinct tone so a dropped channel
 * is audible in the numbers, not just in theory.
 */
export function buildWav6ch() {
  const rate = SAMPLE_RATE;
  const channels = 6;
  const frames = rate * DURATION_S;
  const dataSize = frames * channels * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, "latin1");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "latin1");
  buf.write("fmt ", 12, "latin1");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32); // block align
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "latin1");
  buf.writeUInt32LE(dataSize, 40);
  const tones = [220, 277, 330, 110, 440, 554];
  for (let i = 0; i < frames; i++) {
    const s = i / rate;
    const env = Math.min(1, s * 8, (DURATION_S - s) * 8);
    for (let ch = 0; ch < channels; ch++) {
      buf.writeInt16LE(
        Math.round(Math.sin(2 * Math.PI * tones[ch] * s) * 9000 * env),
        44 + (i * channels + ch) * 2,
      );
    }
  }
  return buf;
}

/**
 * A genuinely variable-bitrate MP3: first second at 128 kbps, second at
 * 320 kbps, concatenated. No Xing header, so players that estimate duration
 * from the first frame's bitrate get it wrong — the duration-mismatch class
 * the trimmer's clamping exists for.
 */
export async function buildVbrMp3() {
  const { Mp3Encoder } = (await import("@breezystack/lamejs")).default;
  const half = SAMPLE_RATE; // 1 s per bitrate segment
  const parts = [];
  for (const [seg, kbps] of [[0, 128], [1, 320]]) {
    const encoder = new Mp3Encoder(2, SAMPLE_RATE, kbps);
    const left = new Int16Array(half);
    const right = new Int16Array(half);
    for (let i = 0; i < half; i++) {
      const s = (seg * half + i) / SAMPLE_RATE;
      const env = Math.min(1, s * 8, (DURATION_S - s) * 8);
      left[i] = Math.round(Math.sin(2 * Math.PI * 440 * s) * 12000 * env);
      right[i] = Math.round(Math.sin(2 * Math.PI * 554.37 * s) * 12000 * env);
    }
    const BLOCK = 1152;
    for (let i = 0; i < half; i += BLOCK) {
      const n = Math.min(BLOCK, half - i);
      const buf = encoder.encodeBuffer(left.subarray(i, i + n), right.subarray(i, i + n));
      if (buf.length) parts.push(Buffer.from(buf));
    }
    const tail = encoder.flush();
    if (tail.length) parts.push(Buffer.from(tail));
  }
  return Buffer.concat(parts);
}

/**
 * Mono 96 kHz tone. Pins the resample bug class: decoding through a plain
 * AudioContext silently resamples to the *device* rate, so a 96 kHz source
 * came back at 44.1/48 kHz. Mono also exercises the channel-count path the
 * stereo fixture can't.
 */
function buildWav96kMono() {
  const rate = 96000;
  const frames = rate * DURATION_S;
  const dataSize = frames * 2; // mono, 16-bit
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, "latin1");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "latin1");
  buf.write("fmt ", 12, "latin1");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "latin1");
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < frames; i++) {
    const s = i / rate;
    const env = Math.min(1, s * 8, (DURATION_S - s) * 8);
    buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 880 * s) * 12000 * env), 44 + i * 2);
  }
  return buf;
}

/**
 * 60 real pages — past the 50-page thumbnail cap in the PDF page tools, so
 * the cap behaviour is testable instead of silently invisible.
 */
async function buildBigPdf() {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setTitle("Transmute 60-page fixture");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 60; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Page ${i + 1} of 60`, { x: 60, y: 760, size: 28, font });
  }
  return Buffer.from(await doc.save());
}

/** No width/height attributes — only a viewBox. The dimensionless-SVG case. */
function buildDimensionlessSvg() {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120">` +
      `<rect width="240" height="120" fill="#1c2440"/>` +
      `<circle cx="60" cy="60" r="40" fill="#9184d9"/>` +
      `<rect x="130" y="30" width="80" height="60" fill="#7ee0a8"/>` +
      `</svg>`,
    "utf8",
  );
}

async function buildPdf() {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setTitle("Transmute fixture document");
  doc.setAuthor("Transmute fixtures");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 0; i < 5; i++) {
    const page = doc.addPage([595, 842]); // A4
    page.drawText(`Page ${i + 1}`, { x: 60, y: 760, size: 32, font: bold });
    page.drawText("Transmute conversion fixture", { x: 60, y: 715, size: 16, font });
    // Body text gives compress/extract something real to chew on.
    for (let line = 0; line < 24; line++) {
      page.drawText(
        `${String(line + 1).padStart(2, "0")}  The quick brown fox jumps over the lazy dog. 0123456789.`,
        { x: 60, y: 660 - line * 22, size: 11, font, color: rgb(0.15, 0.15, 0.2) },
      );
    }
    // A filled rect per page makes rasterisation (pdf-to-jpg) visibly non-blank.
    page.drawRectangle({
      x: 60, y: 80, width: 475, height: 40,
      color: rgb(0.2 + i * 0.15, 0.35, 0.75 - i * 0.12),
    });
  }
  return Buffer.from(await doc.save());
}

// ────────────────────────────────────────────────────────────────────────────

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  console.log("• launching Chromium for WebCodecs encoding…");
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.error("  [page error]", m.text());
  });
  // WebCodecs requires a secure context; a routed https origin is the cheapest
  // way to get one without a server.
  await page.route("https://fixtures.local/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>fixtures</title>" }),
  );
  await page.goto("https://fixtures.local/");
  await page.addScriptTag({ path: MUXER_UMD });

  const encoded = await page.evaluate(encodeInPage, {
    width: WIDTH, height: HEIGHT, fps: FPS, durationS: DURATION_S, sampleRate: SAMPLE_RATE,
  });
  await browser.close();

  const jpegWithExif = withExif(Buffer.from(encoded.jpeg, "base64"));

  const files = {
    "sample-video.mp4": Buffer.from(encoded.mp4, "base64"),
    "sample-video.webm": Buffer.from(encoded.webm, "base64"),
    "sample-audio.m4a": Buffer.from(encoded.m4a, "base64"),
    "sample-audio.mp3": await buildMp3(),
    "sample-audio-vbr.mp3": await buildVbrMp3(),
    "sample-audio.wav": buildWav(),
    "sample-audio-96k-mono.wav": buildWav96kMono(),
    "sample-audio-6ch.wav": buildWav6ch(),
    "sample-photo.jpg": jpegWithExif,
    "sample-photo-portrait.jpg": withExif(Buffer.from(encoded.jpeg, "base64"), 6),
    "sample-doc.pdf": await buildPdf(),
    "sample-doc-60p.pdf": await buildBigPdf(),
    "sample-vector.svg": buildDimensionlessSvg(),
  };

  for (const [name, buf] of Object.entries(files)) {
    await writeFile(path.join(OUT_DIR, name), buf);
    console.log(`  ${name.padEnd(20)} ${(buf.length / 1024).toFixed(1)} KB`);
  }
  console.log(`\nWrote ${Object.keys(files).length} fixtures to ${path.relative(ROOT, OUT_DIR)}`);
}

// Only run the full (browser-encoding) pipeline when invoked directly —
// the pure builders above are importable for targeted regeneration.
const { pathToFileURL } = await import("node:url");
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
