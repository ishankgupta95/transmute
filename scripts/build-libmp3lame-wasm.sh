#!/usr/bin/env bash
# Build libmp3lame 3.100 as a single-threaded, SIMD-enabled WASM module with a
# small hand-written C bridge — the MP3 encoder this app serves from
# /vendor/libmp3lame.{js,wasm}, replacing the pure-JavaScript lamejs port.
#
# Licensing intent: LAME only, and LAME is LGPL-2.0-or-later. That is the same
# licence class as the lamejs port it replaces, so the posture does not change:
# the artifact is served UNBUNDLED from a stable same-origin URL so a user can
# substitute their own build (LGPL §4(d)(1) replaceability). See
# licensing-posture.md and the loader comments in src/lib/tools/audio-pcm.ts.
# Nothing else is linked in: no decoder (mpglib), no vbrtag writer, no
# frontend, no libsndfile — the gate at the bottom asserts that.
#
# Why we compile it rather than take an npm package:
#   * `lame-wasm` 0.3.0 (the only maintained npm wasm build of LAME) corrupts
#     the heap when handed a typed-array VIEW: its bridge destructures
#     `{ byteLength, buffer }` and writes `new Uint8Array(buffer)` — the WHOLE
#     backing buffer — into an allocation sized for the view, ignoring
#     byteOffset. A `subarray()` frame out of a 60 s buffer wrote 10 MB into a
#     9 KB block; measured 2026-11-10, it aborts with "memory access out of
#     bounds". Our encode loop is built on `subarray`, so that is a non-starter.
#   * `@mediabunny/mp3-encoder` is an extension of the mediabunny library,
#     which this app does not use.
# Compiling also means we choose -O3 -msimd128 and know, rather than hope,
# that the shipped binary is SIMD and single-threaded.
set -euo pipefail

LAME_VERSION=3.100
WORK="${WORK:-$HOME/lame-wasm-build}"
OUT="$WORK/out"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRIDGE="$REPO/vendor/libmp3lame/mp3-bridge.c"

EMSDK_DIR="${EMSDK_DIR:-$HOME/emsdk}"

# emsdk REFUSES to run on Python < 3.10, and macOS's `python3` is Xcode's
# 3.9.6 — the same trap documented at length in build-qpdf-wasm.sh. Prefer
# whatever the host has and fall back to uv's; set PYTHON3_DIR to override.
if [ -z "${PYTHON3_DIR:-}" ]; then
  if command -v uv >/dev/null 2>&1; then
    UV_PY="$(uv python find 3.12 2>/dev/null || true)"
    [ -n "$UV_PY" ] && PYTHON3_DIR="$(dirname "$UV_PY")"
  fi
fi
[ -n "${PYTHON3_DIR:-}" ] && export PATH="$PYTHON3_DIR:$PATH"

if [ ! -f "$EMSDK_DIR/emsdk_env.sh" ]; then
  echo "ERROR: no emsdk at $EMSDK_DIR. Install it:" >&2
  echo "  git clone --depth 1 https://github.com/emscripten-core/emsdk.git $EMSDK_DIR" >&2
  echo "  cd $EMSDK_DIR && ./emsdk install latest && ./emsdk activate latest" >&2
  exit 1
fi
# shellcheck disable=SC1091
source "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1

for t in emcc emconfigure; do
  command -v "$t" >/dev/null 2>&1 || { echo "ERROR: '$t' not on PATH after sourcing emsdk." >&2; exit 1; }
done
[ -f "$BRIDGE" ] || { echo "ERROR: bridge source missing at $BRIDGE" >&2; exit 1; }

mkdir -p "$WORK" "$OUT"
cd "$WORK"

echo "=== emcc: $(emcc --version | head -1)"

# ── source ─────────────────────────────────────────────────────────
if [ ! -d "lame-$LAME_VERSION" ]; then
  echo "=== downloading lame $LAME_VERSION"
  curl -sSL -o "lame-$LAME_VERSION.tar.gz" \
    "https://downloads.sourceforge.net/project/lame/lame/$LAME_VERSION/lame-$LAME_VERSION.tar.gz"
  tar xzf "lame-$LAME_VERSION.tar.gz"
fi
cd "lame-$LAME_VERSION"

# ── configure ──────────────────────────────────────────────────────
# -msimd128 is the whole point of this build: it lets LLVM auto-vectorise the
# filterbank/quantisation inner loops into WASM SIMD. It is the SINGLE-threaded
# SIMD proposal, shipped in every current browser and needing no COOP/COEP
# headers — which matters because GitHub Pages cannot send them, so
# SharedArrayBuffer and pthreads are off the table for this origin entirely.
# Do not "improve" this with -pthread.
#
# -ffast-math is safe here and not merely tolerated: the encoder's arithmetic
# is a psychoacoustic approximation, there are no NaNs or infinities in PCM,
# and MP3 has no bit-exactness requirement. (Measured: byte-identical output
# to the non-fast-math build on the benchmark signal anyway.)
export CFLAGS="-O3 -msimd128 -ffast-math -DNDEBUG -fno-exceptions"
#
# `--host=i686-pc-linux-gnu` is not a lie we tell for fun: it is the only way
# to get autoconf into cross-compile mode here. LAME 3.100 ships a 2017
# config.sub, which rejects both `wasm32` and `wasm32-unknown-emscripten`
# outright ("machine not recognized"), and without SOME --host, configure
# decides it is building natively for arm64 macOS and starts running the test
# binaries it just cross-compiled. A 32-bit little-endian triple is the correct
# shape of lie — it is what emscripten's own autotools guidance recommends, and
# what matters to LAME's configure is the word size and byte order, both of
# which match wasm32.
if [ ! -f config.status ]; then
  echo "=== configuring"
  emconfigure ./configure \
    --disable-shared \
    --enable-static \
    --disable-frontend \
    --disable-decoder \
    --disable-analyzer-hooks \
    --disable-gtktest \
    --disable-nasm \
    --disable-dependency-tracking \
    --host=i686-pc-linux-gnu \
    2>&1 | tail -15
fi

echo "=== building libmp3lame.a"
emmake make -C libmp3lame -j"$(sysctl -n hw.ncpu)" 2>&1 | tail -8
LAME_A="$WORK/lame-$LAME_VERSION/libmp3lame/.libs/libmp3lame.a"
[ -f "$LAME_A" ] || { echo "ERROR: $LAME_A not produced" >&2; exit 1; }
echo "    $LAME_A: $(stat -f%z "$LAME_A") bytes"

# ── link the bridge ────────────────────────────────────────────────
# MODULARIZE + EXPORT_ES6 so `import()` of the vendored file yields a factory,
# the same shape as the qpdf engine. ENVIRONMENT=web,worker: this runs on the
# main thread and in the audio pool worker, never in Node.
#
# NO FILESYSTEM and NO EXIT_RUNTIME: unlike qpdf (a CLI driven by argv through
# a MEMFS), this is a long-lived library instance — JS writes PCM into a fixed
# scratch buffer inside the heap and calls mp3_encode in a loop, so the runtime
# must stay up across calls.
#
# ALLOW_MEMORY_GROWTH is off on purpose. The bridge's buffers are a fixed size
# chosen at compile time (see mp3-bridge.c) and LAME's own state is a bounded
# couple of megabytes, so the heap never grows — and a growable heap means
# every HEAPF32 reference in the glue has to be re-read after any call that
# might have grown it, which is precisely the class of bug that makes a
# detached-ArrayBuffer crash show up only on long inputs. INITIAL_MEMORY is
# sized with headroom and verified by the 30-minute benchmark below.
echo "=== linking"
emcc -O3 -msimd128 -ffast-math \
  "$BRIDGE" \
  -I include -I libmp3lame \
  "$LAME_A" \
  -o "$OUT/libmp3lame.js" \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sEXPORT_NAME=createLameModule \
  -sENVIRONMENT=web,worker \
  -sFILESYSTEM=0 \
  -sINVOKE_RUN=0 \
  -sEXIT_RUNTIME=0 \
  -sALLOW_MEMORY_GROWTH=0 \
  -sINITIAL_MEMORY=16777216 \
  -sSTACK_SIZE=1048576 \
  -sEXPORTED_FUNCTIONS=_mp3_open,_mp3_in_left,_mp3_in_right,_mp3_out,_mp3_frame_capacity,_mp3_encode,_mp3_flush,_mp3_close,_mp3_lame_version \
  -sEXPORTED_RUNTIME_METHODS=HEAPF32,HEAPU8,UTF8ToString \
  --closure 0

# The SAME objects linked for Node, so the benchmark and the smoke test below
# can run headlessly. Not shipped — but built from the same libmp3lame.a, so
# what it attests to is the binary the gate inspects.
emcc -O3 -msimd128 -ffast-math \
  "$BRIDGE" \
  -I include -I libmp3lame \
  "$LAME_A" \
  -o "$OUT/libmp3lame-node.mjs" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createLameModule \
  -sENVIRONMENT=node -sFILESYSTEM=0 -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 \
  -sALLOW_MEMORY_GROWTH=0 -sINITIAL_MEMORY=16777216 -sSTACK_SIZE=1048576 \
  -sEXPORTED_FUNCTIONS=_mp3_open,_mp3_in_left,_mp3_in_right,_mp3_out,_mp3_frame_capacity,_mp3_encode,_mp3_flush,_mp3_close,_mp3_lame_version \
  -sEXPORTED_RUNTIME_METHODS=HEAPF32,HEAPU8,UTF8ToString \
  --closure 0

echo "=== artifacts"
ls -la "$OUT"

#
# ── GATES — each of these must be able to FAIL ─────────────────────
#
# The reason for compiling this ourselves rather than installing a package is
# to be able to PROVE what is in the artifact, so the checks below are written
# to discriminate, and the obvious spellings of them are traps:
#
#   * `strings libmp3lame.wasm | grep -i simd128` CANNOT PASS. emcc records
#     enabled features in a `target_features` custom section, but wasm-opt
#     strips every custom section at -O3 — measured on this exact recipe, the
#     shipped binary has none at all, and `strings` over it returns 661 lines
#     of float-table noise and nothing else. Likewise there is no "LAME3.100"
#     string to find. A grep for either can only ever report absence.
#   * `... | grep -q X` is worse than useless on a big file: grep exits at the
#     first match, `strings`/`cat` dies of SIGPIPE, and under `set -o pipefail`
#     the pipeline goes non-zero — so an `if` around it takes the ELSE branch
#     and the gate announces "clean" precisely when it found the thing.
#   * `grep -c` exits 1 on zero matches, which `set -e` turns into a silent
#     abort rather than a reported failure, hence the `|| true` on each count.
#
# So: disassemble and count instructions, read config.h, and finish with a
# functional positive control that runs the thing.
#
echo "=== GATES"
WASM="$OUT/libmp3lame.wasm"
WAT="$OUT/libmp3lame.wat"
"$EMSDK_DIR/upstream/bin/wasm-dis" "$WASM" > "$WAT"

# 1. SIMD, positively — counted off the disassembly, the one place the
#    evidence survives. Measured 2026-11-10 on this recipe: 4126 vectorised
#    instructions with -msimd128 and EXACTLY 0 without (the same libmp3lame.a
#    rebuilt with -msimd128 dropped from CFLAGS). The threshold sits far from
#    both, so this fails if the flag is ever lost.
SIMD_OPS="$(grep -coE '\b(f32x4|i32x4|i16x8|i8x16|f64x2|v128)\.' "$WAT" || true)"
if [ "$SIMD_OPS" -lt 500 ]; then
  echo "FAIL: only $SIMD_OPS vectorised instructions in the artifact (expected thousands)." >&2
  echo "      -msimd128 did not survive into the libmp3lame.a objects or the link." >&2
  exit 1
fi

# 2. Single-threaded, negatively. GitHub Pages cannot send COOP/COEP, so this
#    origin is not cross-origin-isolated and SharedArrayBuffer does not exist
#    here; a -pthread build would declare a SHARED memory and the glue would
#    reach for pthread_create. Both are checked because either alone can be
#    satisfied by a half-configured build.
MEM_DECL="$(grep -m1 -E '^ *\(memory ' "$WAT" || true)"
case "$MEM_DECL" in
  *shared*)
    echo "FAIL: the module declares a SHARED memory: $MEM_DECL" >&2
    echo "      This origin cannot be cross-origin-isolated. Drop -pthread." >&2
    exit 1 ;;
esac
THREAD_HITS="$(grep -ciE 'pthread|SharedArrayBuffer' "$OUT/libmp3lame.js" || true)"
if [ "$THREAD_HITS" != "0" ]; then
  echo "FAIL: the glue mentions threads/SharedArrayBuffer on $THREAD_HITS line(s)." >&2
  exit 1
fi

# 3. The decoder (mpglib) is really out. This app only ever encodes; the
#    decoder would be unused bytes and unused attack surface. Read from
#    config.h rather than hunted for in the binary, because --disable-decoder
#    works by never defining HAVE_MPGLIB and the evidence is right there.
CONFIG_H="$(cat config.h)"
case "$CONFIG_H" in
  *'#undef HAVE_MPGLIB'*) : ;;
  *)
    echo "FAIL: HAVE_MPGLIB is defined — --disable-decoder did not survive configure." >&2
    printf '%s\n' "$CONFIG_H" | grep -i mpglib >&2 || true
    exit 1 ;;
esac

# 4. FUNCTIONAL POSITIVE CONTROL. Gates 2 and 3 are satisfied by an artifact
#    that does not work at all, and there is no string in the binary to prove
#    LAME is in there — so run it. This encodes 5 s through the Node build of
#    the SAME libmp3lame.a and requires both LAME's own version string and a
#    real MPEG-1 Layer III frame sync (ff fb) on the output.
echo "=== functional control (5 s encode through the Node build)"
SMOKE="$(node "$REPO/vendor/libmp3lame/bench.mjs" "$OUT/libmp3lame-node.mjs" 5)"
printf '    %s\n' "$SMOKE"
case "$SMOKE" in
  *'"lameVersion":"3.100"'*) : ;;
  *) echo "FAIL: the module did not report LAME 3.100; is libmp3lame really linked?" >&2; exit 1 ;;
esac
case "$SMOKE" in
  *'"frameSync":"ff fb"'*) : ;;
  *) echo "FAIL: output does not start with an MPEG-1 Layer III frame sync." >&2; exit 1 ;;
esac

echo "OK: $SIMD_OPS vectorised instructions, unshared memory, no pthreads,"
echo "    no mpglib, LAME 3.100 encodes a real MPEG stream."
echo "    wasm bytes: $(stat -f%z "$WASM")"
echo "    js   bytes: $(stat -f%z "$OUT/libmp3lame.js")"

cat <<NEXT

=== INSTALL
  cp "$OUT/libmp3lame.js" "$OUT/libmp3lame.wasm" "$REPO/vendor/libmp3lame/"
  npm run copy:wasm   # stages them into public/vendor/

=== BENCHMARK (Node build, same objects)
  node "$REPO/vendor/libmp3lame/bench.mjs" "$OUT/libmp3lame-node.mjs" 60
NEXT
