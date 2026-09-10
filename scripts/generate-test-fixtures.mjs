/**
 * Generate the *real* media fixtures the conversion E2E suite runs against.
 *
 *   node scripts/generate-test-fixtures.mjs
 *
 * Why this exists: the unit suite runs in jsdom (no canvas, no WASM) and the
 * older E2E specs fed tools stub blobs — a 16-byte "MP4", a silent WAV, a blank
 * PDF. Those prove the UI renders; they cannot prove FFmpeg.wasm / WebCodecs /
 * pdf-lib / lamejs still produce correct output. `src/__tests__/e2e/conversion/`
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
 *
 * Six entry points:
 *
 *   node scripts/generate-test-fixtures.mjs                  everything
 *   node scripts/generate-test-fixtures.mjs --containers     only the four
 *                                                            container fixtures
 *   node scripts/generate-test-fixtures.mjs --audio-formats  only the five
 *                                                            audio source formats
 *   node scripts/generate-test-fixtures.mjs --silence-gaps   only the
 *                                                            silence-gap WAV
 *   node scripts/generate-test-fixtures.mjs --engine-inputs  only the QR PNG
 *                                                            and the two archives
 *   node scripts/generate-test-fixtures.mjs --avif           only sample.avif
 *
 * The narrow ones exist because a full run REPLACES every fixture, and several
 * specs pin exact bytes of one — `pdf-recompress.spec.ts` asserts
 * `sample-photo-doc.pdf` is exactly 64,364 bytes, and that file is rebuilt from
 * a freshly canvas-encoded JPEG on every full run. Adding a video container
 * therefore must not mean regenerating the PDFs. `--containers` derives the
 * `.mov`/`.mkv`/`.avi`/HEVC fixtures from the checked-in `sample-video.mp4` and
 * writes nothing else. Add `--force` to re-encode the HEVC fixture too.
 * `--audio-formats` is the same deal for the FLAC/Ogg/AAC/Opus/WMA sources,
 * derived from the checked-in `sample-audio.wav`, `sample-audio.m4a` and
 * `sample-video.webm`. `--silence-gaps` writes `sample-audio-gaps.wav` and
 * nothing else — pure arithmetic, no browser and no core. `--avif` writes
 * `sample.avif` and nothing else; see `buildAvifSample` for why that one is
 * the only fixture here encoded by a native library rather than by Chromium.
 * It is deliberately absent from the no-flag full run, so that a machine whose
 * `sharp` has been hoisted away can still rebuild everything else.
 */

import { chromium } from "@playwright/test";
import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "src/__tests__/fixtures/samples");
const MUXER_UMD = path.join(ROOT, "node_modules/mp4-muxer/build/mp4-muxer.js");
/** Where `npm run copy:wasm` drops the FFmpeg core the app itself ships. */
const CORE_DIR = path.join(ROOT, "public");

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
 * Stereo 44.1 kHz WAV laid out as SILENCE · TONE · SILENCE · TONE · SILENCE,
 * exactly 5.500000 s:
 *
 *     0.0 → 1.0   digital silence
 *     1.0 → 2.0   440 Hz at 12000 (−8.7 dBFS)   ← the LOUD tone
 *     2.0 → 3.5   digital silence
 *     3.5 → 4.5   440 Hz at 4000  (−18.3 dBFS)  ← the QUIET tone
 *     4.5 → 5.5   digital silence
 *
 * Two tools need this and neither can be tested without it.
 *
 * `remove-silence` needs REAL silence to remove, and the layout is the one the
 * `silenceremove` recipes were measured against (the E2E expectations are
 * pinned to those numbers): "ends" mode leaves 3.50 s, "all" mode 2.04 s.
 * Every fixture next door is a continuous tone, against which "removed 0.00 s"
 * and "removed everything correctly" are the same observation.
 *
 * `reverse-audio` needs an ASYMMETRIC amplitude profile. The layout of gaps is
 * a palindrome, so the two tones carry deliberately different amplitudes —
 * loud-then-quiet in, quiet-then-loud out. Against `sample-audio.wav`, whose
 * envelope is symmetric by construction, a reversal and a no-op decode to the
 * same samples and no assertion can separate them. Both amplitudes sit far
 * above the −50 dB silence threshold (which is ~103 in int16), so the quiet
 * tone is never mistaken for a gap.
 *
 * Digital silence is exact zeros, and the tones start and stop on a sample
 * boundary with no fade: a ramp through the threshold would move the very
 * boundaries the durations above are measuring.
 */
export function buildWavWithGaps() {
  const rate = SAMPLE_RATE;
  /** [seconds, amplitude] — amplitude 0 is digital silence. */
  const SPANS = [
    [1.0, 0],
    [1.0, 12000],
    [1.5, 0],
    [1.0, 4000],
    [1.0, 0],
  ];
  const frames = SPANS.reduce((sum, [seconds]) => sum + Math.round(seconds * rate), 0);
  const dataSize = frames * 2 * 2; // stereo, 16-bit
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, "latin1");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "latin1");
  buf.write("fmt ", 12, "latin1");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(2, 22); // stereo
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 4, 28);
  buf.writeUInt16LE(4, 32); // block align
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "latin1");
  buf.writeUInt32LE(dataSize, 40);

  let frame = 0;
  for (const [seconds, amplitude] of SPANS) {
    const span = Math.round(seconds * rate);
    for (let i = 0; i < span; i++, frame++) {
      // Phase runs from the START OF THE SPAN, so each tone opens at zero
      // amplitude and no span begins with a step discontinuity.
      const value = amplitude === 0
        ? 0
        : Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * amplitude);
      buf.writeInt16LE(value, 44 + frame * 4);
      buf.writeInt16LE(value, 44 + frame * 4 + 2);
    }
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
// PNG, written by hand — the images the recompressor must REFUSE to touch
// ────────────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function pngChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  // The CRC covers the type and the payload, but NOT the length field.
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * A genuine 8-bit truecolour PNG, built here rather than fetched, so the two
 * shapes that matter can be produced on demand:
 *
 *   `alpha: false` → pdf-lib embeds ONE FlateDecode image XObject.
 *   `alpha: true`  → pdf-lib embeds the colour channels plus a separate
 *                    DeviceGray /SMask, because `utils/png.ts` keeps the alpha
 *                    channel only when some sample is genuinely below 255.
 *
 * Those are the recompressor's two skip paths — a non-DCTDecode filter, and an
 * image tangled up with a transparency mask — so the fixture that carries them
 * has to be exact about which one it is producing.
 */
export function buildPng(size, { alpha = false } = {}) {
  const channels = alpha ? 4 : 3;
  const stride = size * channels + 1; // one filter-type byte per scanline
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    const row = y * stride;
    raw[row] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const o = row + 1 + x * channels;
      raw[o] = Math.round((x / (size - 1)) * 255);
      raw[o + 1] = Math.round((y / (size - 1)) * 255);
      raw[o + 2] = 128;
      if (alpha) raw[o + 3] = x < size / 2 ? 120 : 255;
    }
  }
  const ihdr = Buffer.alloc(13); // the trailing compression/filter/interlace
  ihdr.writeUInt32BE(size, 0);   // bytes are all 0, which is the only legal
  ihdr.writeUInt32BE(size, 4);   // combination anyway
  ihdr[8] = 8;                   // bit depth
  ihdr[9] = alpha ? 6 : 2;       // colour type: truecolour, ± alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * A photo-heavy document, for `recompress-pdf-images`.
 *
 * `sample-doc.pdf` is text and vector fills — the recompressor has nothing to
 * do to it, so it cannot show that the tool works OR that it is honest about
 * what it skipped. This document is built so both are falsifiable:
 *
 *   · The checked-in `sample-photo.jpg` is embedded ONCE and drawn on all four
 *     pages. pdf-lib reuses the single XObject across the four /Resources
 *     dicts, which is exactly the shape the engine's "replace each XObject
 *     once, not once per page" rule exists for — a per-page implementation
 *     re-encodes it four times and writes four copies into the output.
 *   · An opaque PNG lands as a FlateDecode image → skipped as `filter`.
 *   · A translucent PNG lands as a FlateDecode image carrying a DeviceGray
 *     /SMask → both objects skipped as `mask`.
 *
 * So: four image XObjects, exactly one of them eligible, and two distinct skip
 * reasons on screen. The photo is passed in rather than read off disk because
 * `main()` writes every fixture only after all of them are built — reading
 * `sample-photo.jpg` back here would pick up the PREVIOUS run's photo, or
 * nothing at all on a clean checkout.
 */
export async function buildPhotoPdf(jpeg) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setTitle("Transmute photo fixture");
  doc.setAuthor("Transmute fixtures");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const photo = await doc.embedJpg(new Uint8Array(jpeg));
  const opaque = await doc.embedPng(buildPng(48));
  const translucent = await doc.embedPng(buildPng(40, { alpha: true }));
  for (let i = 0; i < 4; i++) {
    const page = doc.addPage([595, 842]); // A4
    page.drawText(`Photo page ${i + 1} of 4`, { x: 60, y: 780, size: 18, font });
    // 800×600 drawn at 4:3 — the photo dominates the byte count, which is what
    // makes a size assertion on the output mean something.
    page.drawImage(photo, { x: 60, y: 340, width: 475, height: 356 });
    page.drawImage(opaque, { x: 60, y: 220, width: 90, height: 90 });
    page.drawImage(translucent, { x: 170, y: 220, width: 90, height: 90 });
    page.drawRectangle({
      x: 60, y: 120, width: 475, height: 40,
      color: rgb(0.2 + i * 0.15, 0.35, 0.75 - i * 0.12),
    });
  }
  return Buffer.from(await doc.save());
}

// ────────────────────────────────────────────────────────────────────────────
// Container fixtures — remuxed by the SHIPPED FFmpeg core, in Node
// ────────────────────────────────────────────────────────────────────────────

/**
 * Load `public/ffmpeg-core.js` — the exact 32 MB core the site serves — as a
 * plain Node module.
 *
 * No browser is involved. The Chromium stage above exists because WebCodecs
 * needs a secure context; a stream copy needs nothing but the core, and running
 * it here keeps the container fixtures decoupled from the WebCodecs stage (see
 * the header: they must be regenerable WITHOUT rewriting the PDFs).
 *
 * The core is an Emscripten UMD bundle written for a browser or worker, so it
 * reads `self` and `location` at module scope. Both are stubbed below; nothing
 * else in this script touches either global.
 */
async function loadShippedFfmpeg() {
  const coreJs = path.join(CORE_DIR, "ffmpeg-core.js");
  const coreWasm = path.join(CORE_DIR, "ffmpeg-core.wasm");
  if (!existsSync(coreJs) || !existsSync(coreWasm)) {
    throw new Error(
      "public/ffmpeg-core.{js,wasm} are missing — they are gitignored copies.\n" +
        "Run `npm run copy:wasm` before regenerating the container fixtures.",
    );
  }
  globalThis.self ??= globalThis;
  globalThis.location ??= { href: pathToFileURL(coreJs).href };
  const require = createRequire(import.meta.url);
  const factory = require(coreJs);
  const core = await factory({
    locateFile: (file) => path.join(CORE_DIR, file),
    wasmBinary: await readFile(coreWasm),
  });
  const logs = [];
  core.setLogger(({ message }) => logs.push(message));
  return { core, logs };
}

/**
 * `.mov` / `.mkv` / `.avi` carrying the SAME H.264 and AAC elementary streams as
 * `sample-video.mp4` — the inputs the container tools rewrap.
 *
 * These are stream copies, and that is the point. Measured against this core
 * (`-c copy`, 6–33 ms each), a remux back out of any of the three reproduces
 * `sample-video.mp4`'s video `avcC` byte-for-byte and its `stsz` sample-size
 * table entry-for-entry, while an x264 re-encode of the same clip writes a
 * 41-byte `avcC` (vs 32) and a completely different size table. So a test can
 * prove "the video was copied, not re-encoded" by comparing the output against
 * the checked-in MP4 — including for the AVI, where FFmpeg has to rebuild the
 * `avcC` from in-band SPS/PPS and still lands on the identical 32 bytes.
 *
 * `+bitexact` drops the muxer's date/UID/encoder strings and `-map_metadata -1`
 * drops the source's, which makes every run produce identical bytes. Without
 * them the Matroska output differs on every run (`DateUTC` + `SegmentUID`);
 * MOV and AVI happen to be stable either way. Reproducible fixtures matter here
 * because these files are checked in — a rerun should show no diff at all.
 */
export async function buildContainerFixtures(mp4) {
  const { core, logs } = await loadShippedFfmpeg();
  core.FS.writeFile("/src.mp4", new Uint8Array(mp4));

  const remux = (ext) => {
    logs.length = 0;
    const started = Date.now();
    const code = core.exec(
      "-nostdin",
      "-i", "/src.mp4",
      "-c", "copy",
      "-fflags", "+bitexact",
      "-map_metadata", "-1",
      `/out.${ext}`,
    );
    if (code !== 0) {
      throw new Error(`remux to .${ext} exited ${code}: ${logs.slice(-4).join(" | ")}`);
    }
    const bytes = Buffer.from(core.FS.readFile(`/out.${ext}`));
    console.log(`    remuxed .${ext} in ${Date.now() - started} ms`);
    return bytes;
  };

  return {
    "sample-video.mov": remux("mov"),
    "sample-video.mkv": remux("mkv"),
    "sample-video.avi": remux("avi"),
  };
}

/**
 * An H.265 QuickTime recording — the iPhone case, and the one input the
 * container tools must NOT silently rewrap.
 *
 * It cannot come from the shipped core: `-c:v libx265` DEADLOCKS in this
 * single-threaded wasm build (measured — it initialises, then produces nothing
 * for 80 s+ on one 320x240 frame), and there is no `ffmpeg` binary on the dev
 * box. macOS's own `avconvert` drives VideoToolbox, which has a hardware HEVC
 * encoder, so that is what builds this one: ~2 s of wall clock for a 320x240
 * 2.04 s clip, out as `hvc1`/Main video + AAC audio in a QuickTime container
 * (verified by running the shipped `ffprobe` over the result).
 *
 * VideoToolbox output is not byte-reproducible — two runs of the identical
 * command differ — so an existing fixture is KEPT unless `--force` is passed.
 * Off macOS there is no encoder at all and this returns null; the caller says so
 * loudly rather than writing a stand-in that would not actually be H.265.
 */
export async function buildHevcMov(mp4, { force = false } = {}) {
  const existing = path.join(OUT_DIR, "sample-video-hevc.mov");
  if (!force && existsSync(existing)) {
    console.log("    HEVC: keeping the existing fixture (VideoToolbox output is not reproducible; --force to re-encode)");
    return null;
  }
  if (process.platform !== "darwin" || !existsSync("/usr/bin/avconvert")) {
    console.warn(
      "    HEVC: SKIPPED — /usr/bin/avconvert (VideoToolbox) is macOS-only and the\n" +
        "          shipped FFmpeg core deadlocks on libx265, so there is no encoder here.\n" +
        "          sample-video-hevc.mov was NOT written; regenerate it on a Mac.",
    );
    return null;
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), "transmute-hevc-"));
  try {
    const source = path.join(dir, "src.mp4");
    const out = path.join(dir, "hevc.mov");
    await writeFile(source, mp4);
    await promisify(execFile)("/usr/bin/avconvert", [
      "--source", source,
      "--output", out,
      "--preset", "PresetHEVCHighestQuality",
      "--replace",
    ]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Audio source formats — encoded by the SHIPPED FFmpeg core, in Node
// ────────────────────────────────────────────────────────────────────────────

/**
 * The input formats the audio converters take: FLAC, Ogg Vorbis, raw ADTS AAC,
 * Ogg Opus and WMA. Every one carries the same 2-second 440/554 Hz stereo dyad
 * as `sample-audio.wav`, so one duration/peak assertion works across the whole
 * matrix and a converter that emits silence, mono or the wrong length fails.
 *
 * Why each is built the way it is — all measured against this exact core:
 *
 *   .flac  `-c:a flac`, 28 ms. The native encoder. Lossless, so this file is
 *          also the reference a `wav-to-flac` output can be checked against.
 *   .ogg   `-c:a libvorbis`, 39 ms.
 *   .aac   a stream copy of `sample-audio.m4a`'s AAC into ADTS, 6 ms. A bare
 *          elementary stream with no container — a genuinely different demux
 *          path from the `.m4a` fixture, which is what makes it worth having.
 *   .opus  a stream copy of the Opus track already inside `sample-video.webm`,
 *          3 ms. It is a COPY because **`-c:a libopus` TRAPS this core**: at the
 *          default `compression_level 10` a stereo encode dies with
 *          `RuntimeError: memory access out of bounds` (measured safe only at
 *          `<= 4`). Never add an Opus encode here. Note the WebM's track is
 *          48 kHz and ~1.86 s, not 2.00 s — MediaRecorder decides that length.
 *   .wma   `-c:a wmav2 -b:a 128k`, 13 ms. Measured end to end before it was
 *          added: the ASF demuxer and `wmav2` decoder round-trip it back to
 *          1.997 s of 44.1 kHz stereo PCM at a non-zero peak, so the format is
 *          genuinely decodable by the core the site ships — not assumed to be.
 *
 * `+bitexact` on both the muxer and the encoder, plus `-map_metadata -1`, drops
 * the encoder/date/UID strings so every run produces identical bytes. Verified
 * by running each command twice in one process and comparing md5. These files
 * are checked in; a rerun should show no diff at all.
 */
export async function buildAudioFormatFixtures({ wav, m4a, webm }) {
  const { core, logs } = await loadShippedFfmpeg();
  core.FS.writeFile("/a-src.wav", new Uint8Array(wav));
  core.FS.writeFile("/a-src.m4a", new Uint8Array(m4a));
  core.FS.writeFile("/a-src.webm", new Uint8Array(webm));

  // Muxer- and encoder-level bitexact: without both, FLAC stamps a vendor
  // string and Ogg stamps an encoder comment, and the bytes drift per build.
  const BITEXACT = ["-fflags", "+bitexact", "-flags", "+bitexact", "-map_metadata", "-1"];

  const encode = (label, args, out) => {
    logs.length = 0;
    const started = Date.now();
    const code = core.exec("-nostdin", "-y", ...args, ...BITEXACT, out);
    if (code !== 0) {
      throw new Error(`${label} exited ${code}: ${logs.slice(-4).join(" | ")}`);
    }
    const bytes = Buffer.from(core.FS.readFile(out));
    console.log(`    encoded ${label} in ${Date.now() - started} ms`);
    return bytes;
  };

  return {
    "sample-audio.flac": encode("flac", ["-i", "/a-src.wav", "-c:a", "flac"], "/a.flac"),
    "sample-audio.ogg": encode("ogg vorbis", ["-i", "/a-src.wav", "-c:a", "libvorbis"], "/a.ogg"),
    "sample-audio.aac": encode("adts aac", ["-i", "/a-src.m4a", "-c:a", "copy", "-f", "adts"], "/a.aac"),
    "sample-audio.opus": encode("ogg opus", ["-i", "/a-src.webm", "-vn", "-c:a", "copy"], "/a.opus"),
    "sample-audio.wma": encode("wma", ["-i", "/a-src.wav", "-c:a", "wmav2", "-b:a", "128k"], "/a.wma"),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Inputs for the two self-hosted WebAssembly engines: zxing and libarchive
// ────────────────────────────────────────────────────────────────────────────

/**
 * The exact string encoded into `sample-qr.png`.
 *
 * ASCII, no scheme and no punctuation `qr-decode.ts` gives a special reading
 * to, so zxing classifies the symbol as plain Text and the spec can assert the
 * payload verbatim without also asserting a URL parse, a risk banner or a
 * field table. Anything URL-shaped here would make the assertion a test of the
 * payload classifier rather than of the engine.
 */
export const QR_FIXTURE_PAYLOAD = "TRANSMUTE-QR-FIXTURE-8F2C1D";

/**
 * A real QR code, drawn by `qrcode` (which is already a dependency, because
 * `/qr-code-generator` uses it).
 *
 * Deliberately NOT produced by our own generator page through a browser: the
 * point of the reader spec is that zxing-cpp reads a code that something else
 * wrote. `scale: 6` and a 4-module quiet zone give a 198 × 198 PNG —
 * large enough to decode without denoising, small enough that nothing near the
 * canvas-size ceiling triggers the reader's downscale warning.
 *
 * Deterministic: the encoder has no timestamp and pngjs writes no ancillary
 * chunks, so a rerun reproduces the bytes and shows no diff.
 */
export async function buildQrPng() {
  const QRCode = (await import("qrcode")).default;
  return QRCode.toBuffer(QR_FIXTURE_PAYLOAD, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 4,
    scale: 6,
  });
}

/**
 * What both archive fixtures contain, byte for byte.
 *
 * Flat and identical across the two containers on purpose: `/extract-archive`
 * reads a ZIP and a TAR through the same libarchive build, so one expected
 * listing covers both and any difference between them is the engine's, not the
 * fixture's. No directory members, because a folder entry is a property of how
 * the archive was written rather than of what libarchive can read, and the two
 * writers here disagree about emitting them.
 */
export const ARCHIVE_FIXTURE_MEMBERS = [
  { path: "readme.txt", body: "Transmute archive fixture.\n" },
  { path: "notes.md", body: "# notes\n\nThe second member of the fixture archive.\n" },
  { path: "values.csv", body: "a,b,c\n1,2,3\n4,5,6\n" },
];

/** Fixed epoch for every archive member, so a rerun reproduces the bytes. */
const ARCHIVE_FIXTURE_MTIME = Date.UTC(2020, 0, 1, 0, 0, 0);

export async function buildZipArchive() {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const date = new Date(ARCHIVE_FIXTURE_MTIME);
  for (const m of ARCHIVE_FIXTURE_MEMBERS) zip.file(m.path, m.body, { date });
  // `platform: "UNIX"` and a pinned date are what keep two runs identical:
  // JSZip otherwise stamps the current time into every local file header.
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", platform: "UNIX" });
}

/**
 * A POSIX ustar tar, written here rather than shelled out to `tar`.
 *
 * Hand-built for the reason the PNGs above are: the fixture has to be
 * reproducible on a box that has no particular tar, and a checked-in binary
 * blob nobody can regenerate is not a fixture, it is a mystery. The format is
 * 512-byte headers, each file padded to a 512-byte boundary, two zero blocks
 * to finish — which is also small enough to read at a glance and verify with
 * `tar -tvf`.
 */
function buildTarArchive() {
  /** Octal, zero-padded, NUL-terminated — the ustar numeric convention. */
  const octal = (value, width) => value.toString(8).padStart(width - 1, "0") + "\0";

  const blocks = [];
  for (const member of ARCHIVE_FIXTURE_MEMBERS) {
    const body = Buffer.from(member.body, "utf8");
    const header = Buffer.alloc(512);
    header.write(member.path, 0, 100, "utf8");
    header.write(octal(0o644, 8), 100, 8, "ascii"); // mode
    header.write(octal(0, 8), 108, 8, "ascii"); // uid
    header.write(octal(0, 8), 116, 8, "ascii"); // gid
    header.write(octal(body.length, 12), 124, 12, "ascii");
    header.write(octal(Math.floor(ARCHIVE_FIXTURE_MTIME / 1000), 12), 136, 12, "ascii");
    header.write("        ", 148, 8, "ascii"); // checksum placeholder: 8 spaces
    header.write("0", 156, 1, "ascii"); // typeflag: regular file
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    // The checksum is the unsigned sum of every header byte with its own field
    // read as those 8 spaces — which is why it is written last, and why the
    // placeholder above is not optional.
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");

    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024)); // end-of-archive: two zero blocks
  return Buffer.concat(blocks);
}

/**
 * `--engine-inputs`: rebuild only the QR image and the two archives.
 *
 * Its own entry point for the reason `--silence-gaps` has one — a full run
 * REPLACES every fixture, and `pdf-recompress.spec.ts` pins
 * `sample-photo-doc.pdf` at an exact byte count a fresh canvas encode will not
 * reproduce. Nothing here needs a browser or the FFmpeg core.
 */
async function engineInputsOnly() {
  console.log("• building the barcode and archive fixtures…");
  const count = await writeFixtures(await buildEngineInputFixtures());
  console.log(`\nWrote ${count} fixtures to ${path.relative(ROOT, OUT_DIR)}`);
}

async function buildEngineInputFixtures() {
  return {
    "sample-qr.png": await buildQrPng(),
    "sample-archive.zip": await buildZipArchive(),
    "sample-archive.tar": buildTarArchive(),
  };
}

/** Write a `{ name: Buffer }` map into the samples directory. */
async function writeFixtures(files) {
  for (const [name, buf] of Object.entries(files)) {
    await writeFile(path.join(OUT_DIR, name), buf);
    console.log(`  ${name.padEnd(24)} ${(buf.length / 1024).toFixed(1)} KB`);
  }
  return Object.keys(files).length;
}

/**
 * `--containers`: rebuild only the container fixtures, from the MP4 already on
 * disk. Deliberately does not touch anything else — see the header.
 */
async function containersOnly({ force }) {
  const mp4 = await readFile(path.join(OUT_DIR, "sample-video.mp4"));
  console.log("• remuxing container fixtures with the shipped FFmpeg core…");
  const files = await buildContainerFixtures(mp4);
  const hevc = await buildHevcMov(mp4, { force });
  if (hevc) files["sample-video-hevc.mov"] = hevc;
  const count = await writeFixtures(files);
  console.log(`\nWrote ${count} container fixtures to ${path.relative(ROOT, OUT_DIR)}`);
}

/**
 * `--audio-formats`: rebuild only the FLAC/Ogg/AAC/Opus/WMA sources, from the
 * WAV, M4A and WebM already on disk. Deliberately does not touch anything else.
 */
/**
 * `--silence-gaps`: rebuild only `sample-audio-gaps.wav`.
 *
 * Its own entry point for the reason the two above have one: a full run
 * REPLACES every fixture, and `pdf-recompress.spec.ts` pins
 * `sample-photo-doc.pdf` at an exact byte count that a fresh canvas encode
 * will not reproduce. This builder is pure arithmetic — no browser, no FFmpeg
 * core, no other fixture read — so it is also the cheapest of the three.
 */
async function silenceGapsOnly() {
  console.log("• building the silence-gap fixture…");
  const count = await writeFixtures({ "sample-audio-gaps.wav": buildWavWithGaps() });
  console.log(`\nWrote ${count} fixture to ${path.relative(ROOT, OUT_DIR)}`);
}

/**
 * `--avif`: write `sample.avif` and nothing else.
 *
 * Every other still-image fixture in this file is encoded by Chromium, and
 * AVIF is the one format that route cannot produce: `canvas.toBlob("image/
 * avif")` does not fail on a browser without an AVIF *encoder*, it silently
 * writes PNG and hands back a Blob typed `image/png` (measured 2026-08-19 and
 * again 2026-09-06 — see the note in e2e/image/converters.spec.ts). A fixture
 * built that way would be a PNG named `.avif`, which is worse than no fixture:
 * `avif-to-png` would pass while decoding nothing of the sort.
 *
 * So this one is encoded by libaom through `sharp`, which is already on disk
 * as a transitive dependency of `next`. It is resolved at call time and NOT
 * declared in package.json on purpose — nothing that ships depends on it, and
 * a fixture regenerated once a year does not justify a native build in every
 * install. If it has been hoisted away, the throw below says so.
 */
async function avifOnly() {
  console.log("• encoding the AVIF fixture with sharp/libaom…");
  const count = await writeFixtures({ "sample.avif": await buildAvifSample() });
  console.log(`\nWrote ${count} fixture to ${path.relative(ROOT, OUT_DIR)}`);
}

/**
 * 48×32 AVIF: four quadrants of flat colour over a fully transparent top band.
 *
 * Every property is load-bearing for the tests that read it back:
 *   - non-square, so a width/height transposition cannot pass;
 *   - four distinct quadrant colours, so a decode that lost the pixel layout
 *     (or drew an empty canvas) cannot pass either;
 *   - `lossless: true`, so `avif-to-png` — whose whole claim is that PNG adds
 *     no second lossy pass — can be asserted against EXACT RGB values rather
 *     than a tolerance that would also accept a re-encode;
 *   - a genuine alpha channel, because both AVIF pages promise transparency
 *     survives and JPEG's white-flatten is the failure mode next door.
 *
 * 483 bytes, so it is checked in like every other fixture here.
 */
export async function buildAvifSample() {
  const require = createRequire(import.meta.url);
  let sharp;
  try {
    sharp = require("sharp");
  } catch {
    throw new Error(
      "sharp is not resolvable — it is used here only as a build-time AVIF encoder\n" +
        "(a transitive dependency of next, deliberately not declared in package.json).\n" +
        "`npm install` should restore it; do NOT add it as a dependency to get past this.",
    );
  }

  const width = 48;
  const height = 32;
  const raw = Buffer.alloc(width * height * 4);
  // [r, g, b] per quadrant: top-left, top-right, bottom-left, bottom-right.
  const quadrants = [
    [220, 40, 60],
    [30, 160, 80],
    [40, 80, 200],
    [230, 190, 20],
  ];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b] = quadrants[(y < height / 2 ? 0 : 2) + (x < width / 2 ? 0 : 1)];
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      // Top 8 rows fully transparent — the band a JPEG target would flatten.
      raw[i + 3] = y < 8 ? 0 : 255;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 4 } })
    .avif({ lossless: true })
    .toBuffer();
}

async function audioFormatsOnly() {
  const [wav, m4a, webm] = await Promise.all([
    readFile(path.join(OUT_DIR, "sample-audio.wav")),
    readFile(path.join(OUT_DIR, "sample-audio.m4a")),
    readFile(path.join(OUT_DIR, "sample-video.webm")),
  ]);
  console.log("• encoding audio source fixtures with the shipped FFmpeg core…");
  const files = await buildAudioFormatFixtures({ wav, m4a, webm });
  const count = await writeFixtures(files);
  console.log(`\nWrote ${count} audio source fixtures to ${path.relative(ROOT, OUT_DIR)}`);
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
  const mp4 = Buffer.from(encoded.mp4, "base64");

  // Derived from the MP4 that was just encoded, so a full run stays coherent:
  // the container fixtures always carry the same elementary streams as
  // `sample-video.mp4`, which is the invariant the container specs assert on.
  console.log("• remuxing container fixtures with the shipped FFmpeg core…");
  const containers = await buildContainerFixtures(mp4);
  const hevc = await buildHevcMov(mp4, { force: process.argv.includes("--force") });

  // Same reasoning one layer down: the audio source formats are derived from
  // the WAV/M4A/WebM this run just produced, so a full run stays coherent and
  // every fixture in the matrix carries the identical 440/554 Hz dyad.
  const webm = Buffer.from(encoded.webm, "base64");
  const m4a = Buffer.from(encoded.m4a, "base64");
  const wav = buildWav();
  console.log("• encoding audio source fixtures with the shipped FFmpeg core…");
  const audioFormats = await buildAudioFormatFixtures({ wav, m4a, webm });

  const files = {
    "sample-video.mp4": mp4,
    ...containers,
    ...(hevc ? { "sample-video-hevc.mov": hevc } : {}),
    "sample-video.webm": webm,
    "sample-audio.m4a": m4a,
    ...audioFormats,
    "sample-audio.mp3": await buildMp3(),
    "sample-audio-vbr.mp3": await buildVbrMp3(),
    "sample-audio.wav": wav,
    "sample-audio-96k-mono.wav": buildWav96kMono(),
    "sample-audio-6ch.wav": buildWav6ch(),
    "sample-audio-gaps.wav": buildWavWithGaps(),
    "sample-photo.jpg": jpegWithExif,
    "sample-photo-portrait.jpg": withExif(Buffer.from(encoded.jpeg, "base64"), 6),
    "sample-doc.pdf": await buildPdf(),
    "sample-doc-60p.pdf": await buildBigPdf(),
    "sample-photo-doc.pdf": await buildPhotoPdf(jpegWithExif),
    "sample-vector.svg": buildDimensionlessSvg(),
    ...(await buildEngineInputFixtures()),
  };

  const count = await writeFixtures(files);
  console.log(`\nWrote ${count} fixtures to ${path.relative(ROOT, OUT_DIR)}`);
}

// Only run a pipeline when invoked directly — the pure builders above are
// importable for targeted regeneration.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--containers")) {
    await mkdir(OUT_DIR, { recursive: true });
    await containersOnly({ force: process.argv.includes("--force") });
  } else if (process.argv.includes("--audio-formats")) {
    await mkdir(OUT_DIR, { recursive: true });
    await audioFormatsOnly();
  } else if (process.argv.includes("--silence-gaps")) {
    await mkdir(OUT_DIR, { recursive: true });
    await silenceGapsOnly();
  } else if (process.argv.includes("--engine-inputs")) {
    await mkdir(OUT_DIR, { recursive: true });
    await engineInputsOnly();
  } else if (process.argv.includes("--avif")) {
    await mkdir(OUT_DIR, { recursive: true });
    await avifOnly();
  } else {
    await main();
  }
}
