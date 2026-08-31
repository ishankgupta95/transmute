"use client";

import { useEffect, useState } from "react";
import type { Dimensions } from "@/lib/utils/canvas-meta";

export type { Dimensions as ImageDimensions } from "@/lib/utils/canvas-meta";

/**
 * The intrinsic pixel size of an image file, for the canvas header's technical
 * readout ("4032 × 3024 · 4.28 MB" in the Tool Redesign doc).
 *
 * Decoding is the only way to learn it, so this owns a throwaway object URL
 * rather than borrowing the preview's — `useObjectUrl` hands its URL to an
 * `<img>` that is still on screen, and revoking that would blank the preview.
 *
 * The measurement is stored WITH the file it was taken from and compared on
 * render, so swapping the file reads as "not measured yet" immediately, with
 * no synchronous reset inside the effect (which would cascade a render on
 * every mount). Returns `null` while the decode is in flight and for anything
 * that will not decode — an SVG with no intrinsic size, a corrupt file — so
 * callers must fall back to the size-only meta line, never a placeholder.
 *
 * Accepts any Blob, not just File: the compressor measures its own OUTPUT
 * blob, whose dimensions can differ from the source once the target-size
 * engine has stepped them down.
 */
export function useImageDimensions(file: Blob | null | undefined): Dimensions | null {
  const [measured, setMeasured] = useState<{
    file: Blob;
    dims: Dimensions;
  } | null>(null);

  useEffect(() => {
    if (!file) return;

    let live = true;
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      if (live && img.naturalWidth > 0 && img.naturalHeight > 0) {
        setMeasured({ file, dims: { w: img.naturalWidth, h: img.naturalHeight } });
      }
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
    };
    img.src = url;

    return () => {
      live = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  return measured && file && measured.file === file ? measured.dims : null;
}
