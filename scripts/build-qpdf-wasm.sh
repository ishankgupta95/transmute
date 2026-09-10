#!/usr/bin/env bash
# Build qpdf as a single-threaded WASM module (CLI-shaped, driven by argv —
# the same posture as the FFmpeg core this app already self-hosts).
#
# Licensing intent: Apache-2.0 qpdf only. Implicit crypto is OFF and the native
# crypto provider is REQUIRED, so GnuTLS (LGPL) and OpenSSL can never be picked
# up from the host. zlib and libjpeg come from Emscripten's own ports (zlib
# licence / IJG licence — both permissive).
set -euo pipefail

QPDF_VERSION=12.4.1
WORK="${WORK:-$HOME/qpdf-wasm-build}"
OUT="$WORK/out"

EMSDK_DIR="${EMSDK_DIR:-$HOME/emsdk}"

# emsdk REFUSES to run on Python < 3.10, and macOS's `python3` is Xcode's 3.9.6
# — this is the first thing that stops anyone reproducing this build, and it
# fails with a message about python, not about emsdk. `uv` already provides a
# suitable interpreter; prefer whatever the host has and fall back to uv's.
# Set PYTHON3_DIR to override.
if [ -z "${PYTHON3_DIR:-}" ]; then
  if command -v uv >/dev/null 2>&1; then
    UV_PY="$(uv python find 3.12 2>/dev/null || true)"
    [ -n "$UV_PY" ] && PYTHON3_DIR="$(dirname "$UV_PY")"
  fi
fi
[ -n "${PYTHON3_DIR:-}" ] && export PATH="$PYTHON3_DIR:$PATH"

PY_VER="$(python3 -c 'import sys;print("%d.%d"%sys.version_info[:2])' 2>/dev/null || echo none)"
case "$PY_VER" in
  none|3.[0-9]) echo "ERROR: emsdk needs Python >= 3.10; found $PY_VER. Install one (e.g. 'uv python install 3.12') or set PYTHON3_DIR." >&2; exit 1 ;;
esac

if [ ! -f "$EMSDK_DIR/emsdk_env.sh" ]; then
  echo "ERROR: no emsdk at $EMSDK_DIR. Install it:" >&2
  echo "  git clone --depth 1 https://github.com/emscripten-core/emsdk.git $EMSDK_DIR" >&2
  echo "  cd $EMSDK_DIR && ./emsdk install latest && ./emsdk activate latest" >&2
  exit 1
fi
# shellcheck disable=SC1091
source "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1

for t in emcc em++ cmake ninja; do
  command -v "$t" >/dev/null 2>&1 || { echo "ERROR: '$t' not on PATH after sourcing emsdk. For cmake/ninja: brew install cmake ninja" >&2; exit 1; }
done

mkdir -p "$WORK" "$OUT"
cd "$WORK"

echo "=== python3: $PY_VER"
echo "=== emcc: $(emcc --version | head -1)"
echo "=== cmake: $(cmake --version | head -1)"

# ── ports: zlib + libjpeg, built by emscripten itself ──────────────
echo "=== building emscripten ports (zlib, libjpeg)"
embuilder build zlib libjpeg

SYSROOT="$(em-config CACHE)/sysroot"
echo "=== sysroot: $SYSROOT"
ls "$SYSROOT/lib/wasm32-emscripten/" | grep -Ei 'z|jpeg' || true

# ── source ─────────────────────────────────────────────────────────
if [ ! -d "qpdf-$QPDF_VERSION" ]; then
  echo "=== downloading qpdf $QPDF_VERSION"
  curl -sSL -o "qpdf-$QPDF_VERSION.tar.gz" \
    "https://github.com/qpdf/qpdf/releases/download/v$QPDF_VERSION/qpdf-$QPDF_VERSION.tar.gz"
  tar xzf "qpdf-$QPDF_VERSION.tar.gz"
fi

# ── configure ──────────────────────────────────────────────────────
# -sUSE_ZLIB / -sUSE_LIBJPEG must be present at COMPILE time too, so the port
# headers are on the include path when qpdf's own sources are compiled.
# -fwasm-exceptions is NOT optional: qpdf signals every error condition
# (wrong password, damaged xref) by throwing QPDFExc. Emscripten disables C++
# exceptions by default, which turns each of those into a bare wasm abort()
# with no message — verified: an encrypted file opened with the wrong password
# aborted the module instead of reporting. A security tool must report.
PORT_FLAGS="-sUSE_ZLIB=1 -sUSE_LIBJPEG=1 -fwasm-exceptions"

rm -rf build
echo "=== configuring"
emcmake cmake -S "qpdf-$QPDF_VERSION" -B build -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DBUILD_STATIC_LIBS=ON \
  -DUSE_IMPLICIT_CRYPTO=OFF \
  -DREQUIRE_CRYPTO_NATIVE=ON \
  -DBUILD_DOC=OFF \
  -DBUILD_DOC_PDF=OFF \
  -DBUILD_DOC_HTML=OFF \
  -DQTEST_SKIP_TESTS=ON \
  -DCMAKE_C_FLAGS="$PORT_FLAGS" \
  -DCMAKE_CXX_FLAGS="$PORT_FLAGS" \
  -DZLIB_LIBRARY="$SYSROOT/lib/wasm32-emscripten/libz.a" \
  -DZLIB_INCLUDE_DIR="$SYSROOT/include" \
  -DCMAKE_EXE_LINKER_FLAGS="$PORT_FLAGS" \
  2>&1 | tail -40

echo "=== building"
cmake --build build --target qpdf -j"$(sysctl -n hw.ncpu)" 2>&1 | tail -15

echo "=== linking the CLI to wasm"
# The qpdf CLI object set, linked as a MODULARIZE'd ES module with a MEMFS the
# JS side writes the input PDF into. Single-threaded on purpose: this app can
# not send COOP/COEP from GitHub Pages, so SharedArrayBuffer is unavailable.
#
# -sEXIT_RUNTIME=1 makes each Module instance ONE-SHOT: callMain runs qpdf's
# main(), the runtime tears down, and calling it again on the same instance
# does not re-run the program. The wrapper must therefore create a FRESH
# module per operation (which is also what keeps one job's MEMFS out of the
# next job's). Do not "optimise" this into a long-lived singleton — that is
# how you get a second run reporting an exit status left over from the first.
#
link_qpdf() {
  # $1 = -sENVIRONMENT value, $2 = output .js path
  em++ -O3 \
    build/qpdf/CMakeFiles/qpdf.dir/*.o \
    build/libqpdf/libqpdf.a \
    $PORT_FLAGS \
    -o "$2" \
    -sMODULARIZE=1 \
    -sEXPORT_ES6=1 \
    -sEXPORT_NAME=createQpdfModule \
    -sENVIRONMENT="$1" \
    -sINVOKE_RUN=0 \
    -sEXIT_RUNTIME=1 \
    -sALLOW_MEMORY_GROWTH=1 \
    -sFORCE_FILESYSTEM=1 \
    -sEXPORTED_RUNTIME_METHODS=callMain,FS \
    -sSTACK_SIZE=1048576
}

# The artifact the site would serve.
link_qpdf web,worker "$OUT/qpdf.js"
# The SAME objects linked for Node, purely so the functional verification below
# can run headlessly. It is not shipped — but it must be built from the same
# .a, or the verification would be attesting to a different binary than the one
# the licensing check above inspects.
link_qpdf node "$OUT/qpdf-node.js"

echo "=== artifacts"
ls -la "$OUT"
#
# ── LICENSING GATE — this must be able to FAIL ─────────────────────
#
# The whole reason for compiling qpdf ourselves is to be able to PROVE what is
# in the static-link set. A check that cannot fail proves nothing, and the
# obvious spelling of it is a trap twice over:
#
#   strings x.wasm | grep -i gnutls || echo "none found — good"
#
# `|| echo` swallows grep's exit status, so the gate reports success whether or
# not GnuTLS is linked. And `strings BIG | grep -q` is worse: grep exits at the
# first match, `strings` dies of SIGPIPE, and under `set -o pipefail` the
# pipeline goes non-zero — so an `if` around it takes the ELSE branch and the
# gate announces "clean" precisely when it found something. Reproduced on a
# 5 MB file with an early match.
#
# Reading the strings once into a variable avoids both: command substitution
# consumes the whole stream, and the tests below are plain string tests.
#
echo "=== LICENSING GATE"
QPDF_STRINGS="$(strings -n 5 "$OUT/qpdf.wasm")"

FORBIDDEN="$(printf '%s\n' "$QPDF_STRINGS" | grep -iE 'gnutls|openssl|libgcrypt|nettle' || true)"
if [ -n "$FORBIDDEN" ]; then
  echo "FAIL: a non-permissive crypto backend is linked into the artifact:" >&2
  printf '%s\n' "$FORBIDDEN" | sort -u | head -20 >&2
  exit 1
fi

# Assert the POSITIVE too. An empty result above is also what you would get
# from an artifact that failed to build at all, or from a `strings` that read
# nothing — so require the native provider to actually be present.
if ! printf '%s\n' "$QPDF_STRINGS" | grep -qx 'native'; then
  echo "FAIL: qpdf's native (Apache-2.0) crypto provider is not present in the artifact." >&2
  echo "      Check that -DUSE_IMPLICIT_CRYPTO=OFF -DREQUIRE_CRYPTO_NATIVE=ON survived configure." >&2
  exit 1
fi

echo "OK: no GnuTLS/OpenSSL/libgcrypt/nettle; native (Apache-2.0) crypto provider present."
echo "    wasm bytes: $(stat -f%z "$OUT/qpdf.wasm")"

cat <<'NEXT'

=== VERIFY IT ACTUALLY WORKS (uses out/qpdf-node.js, same objects, Node build)
  Exit codes are NOT a simple pass/fail — a wrapper that treats non-zero as
  failure will break repair-pdf on the very files it exists to fix:
      0 = success
      2 = genuine error (this is what a wrong password gives)
      3 = COMPLETED WITH WARNINGS — a success, and the normal result of
          repairing a damaged xref
NEXT
