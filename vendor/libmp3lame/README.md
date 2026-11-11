# libmp3lame, compiled to single-threaded SIMD WASM

The MP3 encoder transmute serves from `/vendor/libmp3lame.{js,wasm}`, built by
`scripts/build-libmp3lame-wasm.sh` from **LAME 3.100** plus the small bridge in
`mp3-bridge.c`. It replaces `@breezystack/lamejs`, the pure-JavaScript port of
this same library.

## Licence

**LAME is LGPL-2.0-or-later** — the same licence class as the lamejs port it
replaces, so the posture in `licensing-posture.md` does not change: the
artifact is **served unbundled from a stable same-origin URL** so a user can
substitute their own build of it (LGPL §4(d)(1) replaceability). Never let a
bundler inline it. `mp3-bridge.c` is ours; the upstream source is unmodified
LAME 3.100 as downloaded by the build script.

Nothing else is linked in: no mpglib decoder, no frontend, no libsndfile. The
build script's gates assert that rather than assuming it.

## Files

| File | Shipped? | What it is |
|---|---|---|
| `libmp3lame.js` + `libmp3lame.wasm` | **Yes**, staged into `public/vendor/` by `npm run copy:wasm` | `-sENVIRONMENT=web,worker` build — the artifact the site serves. |
| `libmp3lame-node.mjs` + `libmp3lame-node.wasm` | No | The SAME `libmp3lame.a` linked for Node, so `bench.mjs` and the build script's functional gate can run headlessly. Tracked only so the measurements below are reproducible without an emsdk install. |
| `mp3-bridge.c` | n/a | Our C bridge. Read its header before changing the encode loop. |
| `bench.mjs` | n/a | The before/after benchmark. |

Tracked in git on the same footing as `vendor/qpdf/` — these are the source of
truth, and `public/vendor/` holds the build's gitignored copies.

## Measurements

`node vendor/libmp3lame/bench.mjs <target> <seconds>`, stereo @ 192 kbps,
44 100 Hz, deterministic three-partial + shaped-noise signal. Measured
**2026-11-10** on an Apple-silicon macOS 27.2 desktop, Node 24.4.1:

| Input | lamejs (pure JS) | libmp3lame SIMD wasm | Speed-up |
|---|---|---|---|
| 60 s | 1 887 ms (31.8x realtime) | **483 ms (124.3x)** | **3.9x** |
| 30 min | 59 750 ms (30.1x realtime) | **14 392 ms (125.1x)** | **4.2x** |

All three builds emit byte-identical output length (1 440 705 B at 60 s;
43 201 097 B at 30 min) — same library, same settings, so this is a pure
throughput change.

SIMD's own share is modest: the same `libmp3lame.a` rebuilt **without**
`-msimd128` ran 60 s in 545 ms (110.1x), so `-msimd128` is worth ~11% and the
remaining 3.5x is simply native code instead of a JS port. LAME is branchy;
do not expect more from vectorisation alone.

### In the browser, which is where it runs

The table above is the Node build. The artifact that actually ships is the
`-sENVIRONMENT=web,worker` one, so it was measured separately — **2026-11-11**,
headless Chromium via Playwright, importing `public/vendor/libmp3lame.js` over
HTTP exactly as the site does, 60 s stereo @ 192 kbps:

| Encoder | Time | Realtime | Output |
|---|---|---|---|
| lamejs (pure JS) | 1 124 ms | 53.4x | 1 440 705 B |
| **libmp3lame (shipped web build)** | **264 ms** | **227.3x** | **1 440 705 B** |

**4.3x**, and the output is byte-identical — same library, same settings, so
this is throughput and nothing else. Both figures include the work each path
genuinely has to do: lamejs's includes the Float32 → Int16 conversion it
requires and the wasm build does not, because
`lame_encode_buffer_ieee_float` takes WebAudio's floats directly.

Chromium beats Node here (264 ms vs 483–494 ms for the same archive), so do
not read the Node numbers as the user-facing ones.

`-sALLOW_MEMORY_GROWTH=0` with a 16 MB heap held across the whole 30-minute
run — the bridge's buffers are fixed-size and LAME's state is bounded, so the
heap genuinely never grows.
