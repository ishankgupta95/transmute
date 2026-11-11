/*
 * MP3 encode benchmark — the measurement behind the lamejs -> libmp3lame swap.
 *
 *   node vendor/libmp3lame/bench.mjs <module.mjs|lamejs> [seconds] [bitrate]
 *
 * `<module.mjs>` is a NODE-targeted build of the bridge, which
 * scripts/build-libmp3lame-wasm.sh emits beside the shipped one as
 * libmp3lame-node.mjs from the same libmp3lame.a. Passing the literal
 * `lamejs` instead measures the old pure-JS encoder out of node_modules, so
 * before/after come off one machine, one signal and one loop shape.
 *
 * The signal is deterministic and deliberately NOT silence or a single tone:
 * three partials plus shaped noise, so the psychoacoustic model and the
 * quantisation loops do representative work. Encoding silence measures
 * nothing — LAME short-circuits it.
 *
 * Node is not a browser, but it is the same V8 and the same wasm engine, and
 * what is being compared here is a ratio between two encoders on one host.
 * The absolute numbers on a phone will be several times worse for both.
 */
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

const RATE = 44100;
const target = process.argv[2];
const seconds = Number(process.argv[3] ?? 60);
const bitrate = Number(process.argv[4] ?? 192);

if (!target) {
  console.error("usage: node bench.mjs <module.mjs|lamejs> [seconds] [bitrate]");
  process.exit(2);
}

function makePcm(n) {
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const tone =
      0.3 * Math.sin(2 * Math.PI * 440 * t) +
      0.2 * Math.sin(2 * Math.PI * 1310 * t) +
      0.1 * Math.sin(2 * Math.PI * 5000 * t);
    const noise = 0.15 * rnd();
    left[i] = Math.max(-1, Math.min(1, tone + noise));
    right[i] = Math.max(-1, Math.min(1, tone * 0.9 - noise));
  }
  return [left, right];
}

/** The old encoder: lamejs out of node_modules, driven as audio-pcm.ts drove it. */
async function runLamejs(left, right) {
  // The package's `main` is an IIFE bundle with no usable export; the ESM
  // build under `module` is what audio-pcm.ts used to load from
  // public/vendor/lamejs.js, so name it directly.
  const require = createRequire(import.meta.url);
  const iife = require.resolve("@breezystack/lamejs"); // …/dist/lamejs.iife.js
  const mod = await import(pathToFileURL(path.join(path.dirname(iife), "lamejs.js")).href);
  const { Mp3Encoder } = mod.default ?? mod;
  const t0 = performance.now();
  const encoder = new Mp3Encoder(2, RATE, bitrate);
  const toI16 = (f32) => {
    const i16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return i16;
  };
  const l = toI16(left);
  const r = toI16(right);
  const chunks = [];
  for (let i = 0; i < l.length; i += 1152) {
    const out = encoder.encodeBuffer(l.subarray(i, i + 1152), r.subarray(i, i + 1152));
    if (out.length > 0) chunks.push(out);
  }
  const flushed = encoder.flush();
  if (flushed.length > 0) chunks.push(flushed);
  return { ms: performance.now() - t0, chunks };
}

/** The new encoder, driven exactly as encodePcmToMp3 drives it in the worker. */
async function runWasm(left, right) {
  const { default: createLameModule } = await import(target);
  const mod = await createLameModule();
  lameVersion = mod.UTF8ToString(mod._mp3_lame_version());
  const t0 = performance.now();
  if (mod._mp3_open(2, RATE, bitrate) !== 0) throw new Error("mp3_open failed");
  const capacity = mod._mp3_frame_capacity();
  const leftPtr = mod._mp3_in_left() >>> 2;
  const rightPtr = mod._mp3_in_right() >>> 2;
  const outPtr = mod._mp3_out();
  const chunks = [];
  for (let i = 0; i < left.length; i += capacity) {
    const n = Math.min(capacity, left.length - i);
    mod.HEAPF32.set(left.subarray(i, i + n), leftPtr);
    mod.HEAPF32.set(right.subarray(i, i + n), rightPtr);
    const bytes = mod._mp3_encode(n);
    if (bytes < 0) throw new Error(`mp3_encode: ${bytes}`);
    if (bytes > 0) chunks.push(mod.HEAPU8.slice(outPtr, outPtr + bytes));
  }
  const tail = mod._mp3_flush();
  if (tail > 0) chunks.push(mod.HEAPU8.slice(outPtr, outPtr + tail));
  mod._mp3_close();
  return { ms: performance.now() - t0, chunks };
}

/** Reported by the wasm bridge; the build script gates on it. */
let lameVersion = null;

const samples = Math.round(RATE * seconds);
const [left, right] = makePcm(samples);
const { ms, chunks } = target === "lamejs" ? await runLamejs(left, right) : await runWasm(left, right);

const bytes = chunks.reduce((n, c) => n + c.length, 0);
const head = chunks[0];
console.log(
  JSON.stringify({
    encoder: target === "lamejs" ? "lamejs (pure JS)" : target,
    lameVersion,
    seconds,
    bitrate,
    ms: Math.round(ms),
    realtimeX: +((seconds * 1000) / ms).toFixed(1),
    bytes,
    measuredKbps: +((bytes * 8) / seconds / 1000).toFixed(1),
    // 0xFF 0xFB is an MPEG-1 Layer III frame sync with no CRC — the same thing
    // the conversion e2e suite asserts on the real download.
    // & 0xff because lamejs hands back a SIGNED Int8Array (the wasm bridge
    // returns Uint8Array); the bytes on the wire are the same either way.
    frameSync: `${(head[0] & 0xff).toString(16)} ${(head[1] & 0xff).toString(16)}`,
  }),
);
