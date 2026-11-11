/*
 * The C side of transmute's MP3 encoder: a deliberately tiny bridge over
 * libmp3lame, compiled to single-threaded SIMD WASM by
 * scripts/build-libmp3lame-wasm.sh and served (unbundled, see
 * licensing-posture.md) from /vendor/libmp3lame.js + .wasm.
 *
 * It replaces lamejs, the pure-JavaScript port of this same library, whose
 * problem was never its API — it was that a 90-minute recording took minutes
 * of grinding in JS. The JS side of the new arrangement (encodePcmToMp3 in
 * src/lib/tools/audio-pcm.ts) keeps the shape it already had: 1152-sample MP3
 * frames, batched, progress ticks, one Blob at the end.
 *
 * Three design choices here are load-bearing.
 *
 * 1. FIXED SCRATCH BUFFERS, NOT malloc PER CALL. The input and output blocks
 *    are file-scope arrays, so their addresses never move and JS can write
 *    straight into HEAPF32 at a pointer it fetched once. This is not just
 *    tidiness: the npm package this build replaced (`lame-wasm` 0.3.0)
 *    allocated per call and wrote `new Uint8Array(view.buffer)` — the whole
 *    backing buffer, byteOffset ignored — into a block sized for the view, so
 *    handing it a `subarray()` frame out of a long recording smashed the heap.
 *    A fixed buffer plus an explicit sample count cannot express that bug.
 *
 * 2. ieee_float INPUT. lame_encode_buffer_ieee_float takes [-1,1] floats,
 *    which is exactly what WebAudio hands us, so the Float32 -> Int16 pass the
 *    JS encoder needed is gone entirely — one fewer O(samples) loop and one
 *    fewer whole-signal allocation per export, on top of the encoder itself
 *    being native. The clamp that loop also performed has moved into
 *    `clamp_into` below, where it vectorises; effects chains can and do push
 *    samples past unity, and LAME's own handling of out-of-range input is not
 *    something to find out about in production.
 *
 * 3. THE ENCODER SETTINGS MATCH lamejs EXACTLY — quality 3, plain STEREO
 *    rather than joint, no VBR tag, no bit reservoir, no automatic ID3. This
 *    is a performance change and nothing else; matching the old settings is
 *    what keeps "the same file, faster" true. `disable_reservoir` in
 *    particular is a quality compromise LAME does not make by default (lamejs
 *    chose it), and relaxing it is a separate, auditable decision about the
 *    output — not something to smuggle in under a speed-up.
 */
#include <lame.h>

/*
 * Samples per channel per mp3_encode call: 32 MP3 frames. The frame count is
 * what the JS loop batches to, and 32 is the knee — it amortises the JS->wasm
 * call away (at 1 frame per call, call overhead dominated) while keeping the
 * progress callback's resolution finer than a second of audio and the static
 * footprint under 350 KB.
 */
#define FRAME_SAMPLES (1152 * 32)

/* LAME's documented worst case for mp3buf: 1.25x the input plus 7200. */
#define OUT_CAPACITY ((FRAME_SAMPLES * 5) / 4 + 7200)

static lame_global_flags *gfp = 0;
static int channel_count = 2;

static float in_left[FRAME_SAMPLES];
static float in_right[FRAME_SAMPLES];
static unsigned char out_bytes[OUT_CAPACITY];

/* Pointers for the JS side. Constant for the lifetime of the module — the
 * heap never grows (ALLOW_MEMORY_GROWTH=0), so a cached HEAPF32 view stays
 * valid too. */
float *mp3_in_left(void) { return in_left; }
float *mp3_in_right(void) { return in_right; }
unsigned char *mp3_out(void) { return out_bytes; }
int mp3_frame_capacity(void) { return FRAME_SAMPLES; }

/*
 * LAME's own version string ("3.100"). Exists purely so the build script's
 * gate can assert, from outside, that real libmp3lame is linked in — the
 * shipped .wasm carries no readable strings at all (wasm-opt strips every
 * custom section at -O3 and the data section is float tables), so there is
 * nothing to grep for. A gate needs something it can actually read.
 */
const char *mp3_lame_version(void) { return get_lame_version(); }

/* Returns 0 on success, negative on failure. */
int mp3_open(int channels, int sample_rate, int kbps) {
  if (gfp) {
    lame_close(gfp);
    gfp = 0;
  }
  if (channels < 1 || channels > 2) return -1;

  gfp = lame_init();
  if (!gfp) return -2;

  channel_count = channels;
  lame_set_num_channels(gfp, channels);
  lame_set_in_samplerate(gfp, sample_rate);
  lame_set_brate(gfp, kbps);
  lame_set_mode(gfp, channels == 1 ? MONO : STEREO);
  lame_set_quality(gfp, 3);
  lame_set_bWriteVbrTag(gfp, 0);
  lame_set_disable_reservoir(gfp, 1);
  lame_set_write_id3tag_automatic(gfp, 0);

  if (lame_init_params(gfp) < 0) {
    lame_close(gfp);
    gfp = 0;
    return -3;
  }
  return 0;
}

static void clamp_into(float *buf, int n) {
  for (int i = 0; i < n; i++) {
    float s = buf[i];
    buf[i] = s < -1.0f ? -1.0f : (s > 1.0f ? 1.0f : s);
  }
}

/*
 * Encode `samples` frames per channel out of the scratch buffers. Returns the
 * number of MP3 bytes now in mp3_out(), or LAME's negative error code.
 *
 * Mono reads in_left only — LAME wants both pointers non-null even then, so it
 * is handed the same buffer twice rather than a null it would dereference.
 */
int mp3_encode(int samples) {
  if (!gfp || samples < 0 || samples > FRAME_SAMPLES) return -1;
  clamp_into(in_left, samples);
  if (channel_count > 1) clamp_into(in_right, samples);
  return lame_encode_buffer_ieee_float(
      gfp, in_left, channel_count > 1 ? in_right : in_left, samples, out_bytes,
      OUT_CAPACITY);
}

/* Final partial frame + the encoder's lookahead. Bytes land in mp3_out(). */
int mp3_flush(void) {
  if (!gfp) return -1;
  return lame_encode_flush(gfp, out_bytes, OUT_CAPACITY);
}

void mp3_close(void) {
  if (gfp) {
    lame_close(gfp);
    gfp = 0;
  }
}
