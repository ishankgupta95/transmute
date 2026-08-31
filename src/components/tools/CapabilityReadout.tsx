"use client";

import { useIsClient } from "@/hooks/useIsClient";
import { poolSize } from "@/lib/workers/pool";

/**
 * The design docs draw "SIMD ✓ · THREADS 8 · WEBGPU ✓" in the status bar as
 * seeded sample data. This renders the machine's real values instead — a
 * capability claim we can't verify is a claim we don't make.
 *
 * THREADS is the machine's count; POOL is what the worker pool actually uses
 * (hardwareConcurrency − 1, capped — see workers/pool.ts). Both real, both
 * from this device (Phase 3 lit the pool segment up).
 *
 * Values are read only after mount (`useIsClient`), so the static export
 * can't bake the build machine's hardware into the prerendered HTML.
 */

/**
 * wasm-feature-detect's SIMD probe: a minimal module using v128 ops.
 * `WebAssembly.validate` is synchronous and cheap; memoised anyway so the
 * bytes are checked once per session, not once per render.
 */
let simdSupport: boolean | null = null;
function detectSimd(): boolean {
  if (simdSupport === null) {
    try {
      simdSupport = WebAssembly.validate(
        new Uint8Array([
          0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10,
          10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
        ]),
      );
    } catch {
      simdSupport = false;
    }
  }
  return simdSupport;
}

export function hardwareThreads(): number {
  return Math.max(1, navigator.hardwareConcurrency ?? 1);
}

/**
 * Renders nothing until mounted, so it carries its own leading "│" divider —
 * a bare divider next to an empty slot would read as a typo in the bar.
 */
export function CapabilityReadout() {
  const mounted = useIsClient();
  if (!mounted) return null;

  const simd = detectSimd();
  const webgpu = "gpu" in navigator;

  return (
    <>
      <span aria-hidden="true" className="px-3 opacity-30">
        │
      </span>
      <span>
        SIMD {simd ? "✓" : "—"} · THREADS {hardwareThreads()} · POOL {poolSize()}{" "}
        · WEBGPU {webgpu ? "✓" : "—"}
      </span>
    </>
  );
}
