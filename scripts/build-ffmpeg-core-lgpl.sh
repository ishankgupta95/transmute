#!/usr/bin/env bash
#
# Build a custom, GPL-free FFmpeg WASM core for transmute.tools.
#
# WHY THIS EXISTS
# ---------------
# The core we ship today (`@ffmpeg/core` 0.12.10) is configured `--enable-gpl
# --enable-libx264 --enable-libx265`, so the binary is GPL-2.0-or-later. The
# site is closed-source and carries ads, and our compliance argument is the
# "separate program" reading: a WASM module loaded into the page and driven
# through a JS API is not a derived work of the page. That argument is
# genuinely contested — the FSF reading of dynamic linking is one combined
# work — and the /licenses source offer does not cure it for a closed app.
#
# Dropping the GPL components removes the question instead of arguing it.
#
# ⚠ THE PREMISE CHANGED ON 2026-09-05. READ THIS BEFORE BUILDING. ⚠
# -----------------------------------------------------------------
# This script was written on 2026-09-02 around a claim that nothing the app
# runs could reach x264 or x265, so removing the three flags cost the product
# nothing. That claim was true the day it was written. It is false now — and
# the more important half is HOW it went false unnoticed: it was written as a
# COMMENT. No line of this script has ever read src/, so it could not fail. It
# simply rotted for three days while the work that falsified it shipped.
#
# What falsified it: `transcodeArgs()` in src/lib/tools/video-remux.ts passes
#
#     -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p
#
# and it is not dead code. src/components/tools/VideoRemuxUI.tsx renders a
# "Re-encode to H.264" toggle that switches it on, and ToolClient.tsx routes
# six container pages through it ("one case, six pages" — video-to-mp4,
# mov-to-mp4, mp4-to-mov, mkv-to-mp4, mp4-to-mkv, avi-to-mp4). It is what those
# pages offer when a stream copy would produce a file that does not actually
# play: the iPhone HEVC case, per transcodeReason() in the same file. This
# build cannot answer that with H.265 instead — libx265 is compiled in and
# DEADLOCKS, libvpx-vp9 traps.
#
# SO: REMOVING --enable-libx264 REMOVES A SHIPPED FEATURE. This is a product
# trade-off now, not a free risk reduction. Three options, stated neutrally.
# THE CHOICE IS THE OWNER'S AND THIS SCRIPT DOES NOT MAKE IT:
#
#   (i)   Keep the GPL core. The separate-program posture plus the full source
#         offer is what /licenses documents today, and that page is accurate
#         for what ships. Nothing breaks; the contested-argument risk stays
#         exactly where it is, documented.
#   (ii)  Ship the LGPL core and drop the transcode arm. /video-remux keeps
#         every stream-copy path and refuses, honestly, the files it cannot
#         copy — but that is a capability loss on six pages.
#   (iii) Move that transcode to WebCodecs, as compress-video and webm-to-mp4
#         already do (VideoEncoder + mp4-muxer), and then take the LGPL core
#         with no capability loss. The largest of the three, and the only one
#         that ends with both the feature and a permissive binary.
#
# --enable-libx265 stays free to drop under any of the three: that encoder
# DEADLOCKS in this build and nothing selects it (measured — see the comment
# above transcodeArgs in src/lib/tools/video-remux.ts).
#
# WHERE THE CURRENT INVENTORY LIVES — DELIBERATELY NOT IN THIS COMMENT
# --------------------------------------------------------------------
# src/__tests__/unit/lib/ffmpeg-argv-inventory.test.ts reads the source tree on
# every unit run and pins: which files may build an FFmpeg argv, where
# libx264/libx265 may appear as a literal and how often, that every video-codec
# selection is an explicit vetted literal (`-c` is only ever `copy`), which
# files may build a filtergraph and with which filters, and where `-map` may
# appear. It runs below, BEFORE the build, and a failure stops the run.
#
# Do not restate its findings here. Prose that repeats a greppable fact is the
# thing that rotted, and that gate now fails on three of the phrasings which
# did — including this script's own retired wording.
#
# PREREQUISITES
# -------------
# Docker, with the daemon RUNNING. ffmpeg.wasm's build is Docker-only: its
# Makefile drives `docker buildx build` and its Dockerfile bases on
# emscripten/emsdk:3.1.40. Note that base image is published for linux/amd64
# ONLY — on an Apple Silicon host it runs under emulation, so budget hours,
# not minutes, and expect the fans. There is no host-native path upstream.
#
#   open -a Docker           # then wait for `docker info` to report a Server
#
# EXIT CRITERIA (from plan.md — all four must hold before swapping the core)
# -------------------------------------------------------------------------
#   1. `npm run test:e2e:conversion` green in BOTH projects on the new core.
#   2. The configure line is reproducible from `strings` on the artifact we
#      ship — see the verification step at the bottom of this script.
#   3. /licenses rewritten from GPL-with-source-offer to
#      LGPL-with-replaceability.
#   4. Record the size delta against the 32,232,419-byte core we ship today.
#
# If the build fails, the current posture STANDS and stays documented. This is
# a risk reduction, not a blocker.
#
set -euo pipefail

FFMPEG_WASM_REF="${FFMPEG_WASM_REF:-v0.12.10}"
WORK="${WORK:-$HOME/ffmpeg-wasm-lgpl}"

# ── PRE-FLIGHT: the premise, CHECKED rather than asserted ───────────
#
# This is the line whose absence let a comment stand in for a gate for three
# days. It runs first, before the Docker check and hours of emulated compiling,
# because a premise that no longer holds should cost seconds to discover.
#
# The test asserts, from the other side, that this script still calls it — so
# deleting this block turns the unit suite red rather than quietly restoring
# the old situation.
#
# `npx --no-install` on purpose: with no node_modules the right answer is to
# STOP, not to fetch some vitest off the network and report a pass. A gate that
# can skip itself is the same bug in a friendlier costume.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARGV_GATE="src/__tests__/unit/lib/ffmpeg-argv-inventory.test.ts"

echo "=== PRE-FLIGHT — the FFmpeg argv inventory this build's premise rests on"
if ! (cd "$REPO_ROOT" && npx --no-install vitest run "$ARGV_GATE" --reporter=dot); then
  echo "FAIL: the argv inventory gate is red, or could not run at all." >&2
  echo "      The source tree no longer matches what this script assumes." >&2
  echo "      Read the failure, then update this script's premise AND" >&2
  echo "      licensing-posture.md before building anything." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: the Docker daemon is not running. Start Docker Desktop first:" >&2
  echo "  open -a Docker" >&2
  exit 1
fi

mkdir -p "$WORK"
cd "$WORK"

if [ ! -d ffmpeg.wasm ]; then
  git clone --branch "$FFMPEG_WASM_REF" --depth 1 \
    https://github.com/ffmpegwasm/ffmpeg.wasm.git
fi
cd ffmpeg.wasm

# ── the one edit that matters ──────────────────────────────────────
#
# build/ffmpeg.sh holds the base CONF_FLAGS; the GPL components are added by
# the wrapper that calls it. Strip them here rather than hand-editing, so the
# change is visible in this script and survives a re-clone.
#
# Flags removed (and only these):
#     --enable-gpl  --enable-libx264  --enable-libx265
#
# Everything else in the shipped configure line is already permissive:
#   libmp3lame LGPL · libfribidi LGPL · libopus/libvorbis/libtheora/libvpx/
#   libwebp BSD · libass ISC · libfreetype FTL · libzimg WTFPL · zlib zlib.
grep -rl -- '--enable-gpl' build/ | while read -r f; do
  sed -i.bak \
    -e 's/[[:space:]]*--enable-gpl//g' \
    -e 's/[[:space:]]*--enable-libx264//g' \
    -e 's/[[:space:]]*--enable-libx265//g' \
    "$f"
  echo "patched: $f"
done

# x264/x265 no longer need building at all; skip their sub-builds if the
# Dockerfile references them individually.
sed -i.bak -e '/x26[45]\.sh/d' Dockerfile || true

echo "=== building (this is the long part; amd64 under emulation on arm64)"
make build

echo
echo "=== artifacts"
ls -la packages/core/dist/umd/

#
# NOTE ON THE TWO CHECKS BELOW — do not "simplify" them back into pipelines.
#
# `strings BIG.wasm | grep -q PATTERN` is WRONG here, and wrong in the most
# dangerous direction: grep exits the moment it matches, `strings` then dies of
# SIGPIPE with status 141, and `set -o pipefail` makes the whole pipeline
# non-zero — so the `if` takes its ELSE branch and the script announces that no
# GPL flag was found ON A BINARY THAT CONTAINS ONE. Reproduced on this machine
# with a 5 MB file whose match sits near the start (which is exactly where a
# configure banner sits in a 32 MB core): the pipeline exits 141 and the gate
# prints OK. Under plain `set -e` the same pipeline aborts the script instead,
# which is how EXIT CRITERION 2 used to kill the run before it ever reached the
# size delta.
#
# Reading the whole stream into a variable first removes both failure modes:
# command substitution consumes all of `strings`' output, so nothing ever gets
# SIGPIPE, and the emptiness test is then a plain string test that cannot be
# confused with a process status.
#
CORE_WASM=packages/core/dist/umd/ffmpeg-core.wasm
ALL_STRINGS="$(strings -n 8 "$CORE_WASM")"

echo
echo "=== EXIT CRITERION 2 — configure line reproduced from the artifact"
CONFIGURE_LINE="$(printf '%s\n' "$ALL_STRINGS" | grep -- '--target-os=none' | head -1)"
if [ -z "$CONFIGURE_LINE" ]; then
  echo "FAIL: no configure banner found in $CORE_WASM — cannot verify what was built" >&2
  exit 1
fi
printf '%s\n' "$CONFIGURE_LINE" | tr ' ' '\n' | grep -E '^--' | sort

echo
echo "=== GPL components must be ABSENT from the list above"
GPL_HITS="$(printf '%s\n' "$ALL_STRINGS" | grep -E -- '--enable-(gpl|libx26[45])' || true)"
if [ -n "$GPL_HITS" ]; then
  echo "FAIL: a GPL flag is still embedded in the artifact:" >&2
  printf '%s\n' "$GPL_HITS" >&2
  exit 1
fi
echo "OK: no --enable-gpl / --enable-libx264 / --enable-libx265 in the artifact"

echo
echo "=== EXIT CRITERION 4 — size delta"
NEW=$(stat -f%z packages/core/dist/umd/ffmpeg-core.wasm)
OLD=32232419   # the GPL core shipped as of 2026-09-02
echo "old: $OLD bytes"
echo "new: $NEW bytes"
echo "delta: $(( NEW - OLD )) bytes"

cat <<'NEXT'

=== NEXT STEPS (not automated — they change what the site serves)
  0. THE ONE THAT IS NOT OPTIONAL: this core has no libx264, so
     video-remux.ts's transcodeArgs() cannot run on it. Land option (ii) or
     (iii) from the header FIRST — dropping the arm and saying so, or moving
     it to WebCodecs. Swapping the core without doing that ships a toggle
     that fails at runtime, which is the silent-loss class this repo purges.
  1. Copy packages/core/dist/umd/ffmpeg-core.{js,wasm} over the copy:wasm
     source, or repoint package.json's copy:wasm at this build.
  2. npm run test:e2e:conversion   # must be green in BOTH projects
  3. Rewrite the FFmpeg section of src/app/licenses/page.tsx from
     GPL-with-source-offer to LGPL-with-replaceability, and paste in the
     configure line printed above (it must match `strings` on what ships).
  4. node scripts/generate-license-notices.mjs   # a unit test diffs this
  5. Record the size delta in licensing-posture.md.
NEXT
