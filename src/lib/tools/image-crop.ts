import type { ProcessedResult } from "@/hooks/useFileProcessor";
import { canvasToBlob } from "./canvas-utils";

/**
 * Encode a cropped region that cropperjs has already rendered.
 *
 * The crop *transform* deliberately lives with the cropper instead of being
 * re-derived here. This module used to take `getData()` — x/y/width/height plus
 * a rotation — rebuild the rotated bitmap by hand onto a bounding-box canvas,
 * and then index into it with those coordinates. The two never lined up:
 * `getData()` measures the selection against the rotated on-screen canvas while
 * reporting it in unrotated natural pixels, and the hand-built canvas is larger
 * than the source by `w·|cos| + h·|sin|` with its own origin. Any non-zero
 * rotation therefore cut a region that was offset from the one the user had
 * selected — silently, since the output was still a plausible-looking crop.
 *
 * `Cropper.getCroppedCanvas()` applies rotation, scale and selection in a single
 * transform, and it is the same one driving the preview the user is looking at,
 * so what they see is what they get.
 */
export async function cropImage(
  croppedCanvas: HTMLCanvasElement,
  file: File,
): Promise<ProcessedResult> {
  // PNG regardless of input: a rotated crop leaves transparent corners, and
  // re-encoding to a lossy format would also compound artefacts on an image the
  // user may crop repeatedly. Pinned by `image-crop.test.ts`.
  const blob = await canvasToBlob(croppedCanvas, "image/png", 1);
  const baseName = file.name.replace(/\.[^.]+$/, "");

  return {
    blob,
    fileName: `${baseName}-cropped.png`,
    originalSize: file.size,
    newSize: blob.size,
  };
}
