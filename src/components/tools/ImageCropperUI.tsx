"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import Cropper from "cropperjs";
import "cropperjs/dist/cropper.css";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { WarningMessage } from "@/components/tools/WarningMessage";
import { OutputFormatPicker } from "@/components/tools/OutputFormatPicker";
import { cropImage } from "@/lib/tools/image-crop";
import type { CropResult } from "@/lib/tools/image-crop";
import type { EditOutputFormat } from "@/lib/workers/image-protocol";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { useImageDimensions } from "@/hooks/useImageDimensions";
import { imageMeta } from "@/lib/utils/canvas-meta";
import { formatFileSize } from "@/lib/utils/file-helpers";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
  ToolResetLink,
  ToolSlider,
} from "@/components/tools/ToolAside";
import { ToolControl, ToolControlGroup, ToolProgress } from "@/components/tools/ToolControls";
import {
  CanvasHeader,
  CanvasStage,
  StatStrip,
} from "@/components/tools/ToolCanvas";
import { CANVAS_COLUMN, STAGE_GROW, STAGE_MEDIA } from "@/components/workspace/shared";
import { cn } from "@/lib/utils/cn";

const ASPECT_RATIOS = [
  { label: "Free", value: NaN },
  { label: "1:1", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "16:9", value: 16 / 9 },
  { label: "3:2", value: 3 / 2 },
];

/**
 * The four numbers that ARE the crop box, in the image's own pixels.
 *
 * WCAG 2.1.1 Keyboard (A). cropperjs 1.6.2 binds pointer events only — the
 * library carries no `keydown` listener, no `tabindex`, no `role` and no
 * `aria-*` anywhere in `dist/cropper.js` — so nothing in the frame it draws can
 * be focused, moved or resized without a mouse. ASPECT and Rotation were the
 * only region-adjacent controls a keyboard user could operate, and neither of
 * them chooses WHICH region to keep, which is the whole tool. These fields do.
 *
 * Same shape as the REGION block in `PixelateImageUI.tsx`, deliberately: the
 * fields and the drag are one rectangle, so the two can never disagree.
 */
const BOX_FIELDS = [
  ["x", "X"],
  ["y", "Y"],
  ["width", "Width"],
  ["height", "Height"],
] as const;

type BoxField = (typeof BOX_FIELDS)[number][0];

const NUMBER_FIELD_CLASS =
  "w-full rounded-md border border-border bg-bg-elevated px-2.5 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-45";

/**
 * Source containers whose bytes CAN carry an alpha channel. JPG and BMP cannot,
 * so a JPG crop of a JPG loses nothing to the flatten. This is a "may", not a
 * "does" — reading the real answer costs a full decode, and the crop that ran
 * reports the truth afterwards through `result.warnings`.
 */
const ALPHA_CAPABLE_SOURCE = /\.(png|webp|gif|avif)$/i;

interface ImageCropperUIProps {
  acceptFormats: string;
}

export function ImageCropperUI({ acceptFormats }: ImageCropperUIProps) {
  const [file, setFile] = useState<File | null>(null);
  const [aspect, setAspect] = useState("Free");
  const [rotation, setRotation] = useState(0);
  // PNG stays the default: this tool was PNG-only before the picker landed, and
  // nobody's saved file should change format because a control appeared.
  const [format, setFormat] = useState<EditOutputFormat>("png");
  const [quality, setQuality] = useState(0.92);
  const [result, setResult] = useState<CropResult | null>(null);
  // The live crop box in natural image pixels, exactly as cropperjs reports it.
  // `null` until the library is ready: it fires its first `crop` event from
  // `build()`, once the CLONED image has decoded, and `getData()` returns a
  // hard-coded {0,0,0,0} before that (cropper.js:2533-2561, v1.6.2). So
  // `box === null` is the readiness signal the number fields gate on.
  const [box, setBox] = useState<Cropper.Data | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const cropperRef = useRef<Cropper | null>(null);
  // Hook-owned so the source URL is revoked on unmount too — the hand-rolled
  // createObjectURL was only ever revoked by handleReset.
  const imageUrl = useObjectUrl(file);
  const resultUrl = useObjectUrl(result?.blob ?? null);
  // The doc's header reads "4032 × 3024 · 4.28 MB", not the byte size alone.
  const sourceDims = useImageDimensions(file);

  // Rotation and aspect describe the crop frame, which is rebuilt for the new
  // image, so they go back to neutral. Format and quality are a preference
  // about the saved file and survive — cropping a second picture should not
  // silently put the user back on PNG.
  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setError(null);
    setRotation(0);
    setAspect("Free");
    // The outgoing image's rectangle must not be shown against the incoming one,
    // nor leave the fields live while the next cropper is still building —
    // `setData` is a silent no-op until it is ready (cropper.js:2581).
    setBox(null);
  }, []);

  // Initialize cropper when image is set
  useEffect(() => {
    if (!imgRef.current || !imageUrl) return;

    const cropper = new Cropper(imgRef.current, {
      viewMode: 1,
      autoCropArea: 0.8,
      responsive: true,
      guides: true,
      center: true,
      highlight: true,
      background: true,
      /*
        Keeps the four number fields and the dragged frame as ONE value, in both
        directions. cropperjs dispatches `crop` from `output()` for every change
        it makes — including the ones `setData` makes on our behalf (setData →
        setCropBoxData → renderCropBox → output, cropper.js:2615 / 2722 /
        1483-1489) — and `renderCropBox` clamps to the canvas first
        (cropper.js:1462-1466), so a typed number the frame cannot honour comes
        back as the number it actually took instead of the field and the frame
        drifting apart. Same invariant PixelateImageUI.tsx:514-518 documents.
      */
      crop: (event) => setBox(event.detail),
    });
    cropperRef.current = cropper;

    return () => {
      cropper.destroy();
      cropperRef.current = null;
    };
  }, [imageUrl]);

  const handleAspectRatio = useCallback((label: string) => {
    setAspect(label);
    const ratio = ASPECT_RATIOS.find((ar) => ar.label === label)?.value ?? NaN;
    cropperRef.current?.setAspectRatio(ratio);
  }, []);

  /*
    The keyboard path to the crop box. One field is written at a time and
    nothing else is sent: `setData` applies only the keys it is given
    (cropper.js:2603-2615), so handing the whole rounded rectangle back would
    re-write three numbers nobody touched and walk the frame by that rounding on
    every keystroke.

    No local `setBox` here on purpose — cropperjs answers with a `crop` event
    carrying the rectangle it actually took, and that handler is the only writer
    of `box`. A `setData` on a cropper that is not ready is a silent no-op; no
    event fires and the field keeps the value it had.
  */
  const setBoxField = useCallback((key: BoxField, value: number) => {
    if (!Number.isFinite(value)) return;
    const patch: Cropper.SetDataOptions = {};
    patch[key] = Math.max(0, Math.round(value));
    cropperRef.current?.setData(patch);
  }, []);

  const handleRotation = useCallback(
    (deg: number) => {
      const delta = deg - rotation;
      cropperRef.current?.rotate(delta);
      setRotation(deg);
    },
    [rotation],
  );

  const handleCrop = useCallback(async () => {
    if (!file || !cropperRef.current) return;
    setIsProcessing(true);
    setError(null);

    try {
      // Let the cropper do the transform — see `image-crop.ts` for why
      // reconstructing it from `getData()` cut the wrong region once the image
      // was rotated.
      const croppedCanvas = cropperRef.current.getCroppedCanvas();
      if (!croppedCanvas) throw new Error("Could not read the cropped region");
      const output = await cropImage(croppedCanvas, file, { format, quality });
      setResult(output);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Crop failed");
    }
    setIsProcessing(false);
  }, [file, format, quality]);

  const handleReset = useCallback(() => {
    setFile(null);
    setResult(null);
    setError(null);
    setRotation(0);
    setAspect("Free");
    setBox(null);
  }, []);

  if (!file) {
    return <DropZone accept={acceptFormats} onFiles={handleFiles} />;
  }

  // Read off the file that was actually written rather than off the picker's
  // state, so the readout cannot drift from the download sitting next to it.
  const outputLabel = result ? (result.fileName.split(".").pop() ?? "").toUpperCase() : null;

  // The picker gates its own notice on the format; what this tool knows is
  // where transparency would come from. Two places, and both are honest as a
  // "may": a rotated crop box leaves corners the image never covered, and an
  // alpha-capable container may hold transparency of its own.
  const mayHaveTransparency = rotation !== 0 || ALPHA_CAPABLE_SOURCE.test(file.name);

  return (
    <>
      {/* ── Canvas: the crop frame, then the cropped result ──── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={imageMeta(sourceDims, formatFileSize(file.size))}
          trailing={
            outputLabel ? `CROPPED · ${outputLabel}` : aspect === "Free" ? "FREE" : aspect
          }
        />

        {result ? (
          <CanvasStage className={cn(STAGE_GROW, "flex items-center justify-center bg-[#0c0e17] p-4")}>
            {resultUrl && (
              /* eslint-disable-next-line @next/next/no-img-element -- blob: URL, nothing for next/image to optimise */
              <img src={resultUrl} alt="Cropped" className={STAGE_MEDIA} />
            )}
          </CanvasStage>
        ) : (
          <>
            {/*
              The crop frame is the tool, so it takes the canvas's slack rather
              than sitting at a fixed 500px in a viewport-tall band. cropperjs
              sizes its container from the <img>'s RENDERED box, so the cap has
              to live on the image: `max-h-full` against a stage that now has a
              definite height.
            */}
            <CanvasStage className={cn(STAGE_GROW, "flex bg-bg-secondary")}>
              {/* The URL arrives one render after the file, and cropperjs must
                  never initialise against an <img> with no src. */}
              {imageUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  ref={imgRef}
                  src={imageUrl}
                  alt="Crop preview"
                  className="block max-h-full max-w-full"
                />
              )}
            </CanvasStage>

            {error && <ErrorMessage message={error} />}
          </>
        )}

        <StatStrip
          stats={[
            { label: "SOURCE", value: formatFileSize(file.size), tone: "neutral" },
            { label: "ASPECT", value: aspect === "Free" ? "FREE" : aspect },
            { label: "ROTATION", value: `${rotation}°`, tone: "neutral" },
            { label: "CROPPED", value: result ? formatFileSize(result.newSize) : "—", tone: "ok" },
          ]}
        />

        {/* Warnings ride on the result, so they clear with it the moment a new
            crop starts. The only one this tool raises is the white flatten, and
            it is raised from the pixels that were actually encoded — not from
            the chosen format, which would claim it for an opaque JPG crop too. */}
        {(result?.warnings ?? []).map((warning) => (
          <WarningMessage key={warning} message={warning} />
        ))}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          result ? (
            <>
              <DownloadButton
                blob={result.blob}
                fileName={result.fileName}
                className="w-full justify-center"
              />
              <ToolResetLink onClick={handleReset} label="CROP ANOTHER" />
            </>
          ) : (
            <>
              {/* The doc pins the running readout to the rail footer, above
                  the button that started it. The canvas crop reports no
                  progress, so the bar stays indeterminate. */}
              {isProcessing && (
                <ToolProgress phase="CROPPING" percent={null} label="Cropping image" />
              )}
              <ToolActions
                primaryLabel={isProcessing ? "Cropping…" : "Crop"}
                onPrimary={handleCrop}
                primaryDisabled={isProcessing}
                onReset={handleReset}
                resetLabel="CANCEL"
              />
            </>
          )
        }
      >
        {!result && (
          <ToolControlGroup>
            <ToolControl label="ASPECT">
              <ToolChoice
                label="Aspect ratio"
                fill
                value={aspect}
                onChange={handleAspectRatio}
                disabled={isProcessing}
                options={ASPECT_RATIOS.map((ar) => ({ value: ar.label, label: ar.label }))}
              />
            </ToolControl>

            {/* The crop box has no keyboard affordance of its own — cropperjs
                1.6.2 draws it from pointer events and gives it neither focus
                nor ARIA. These four fields ARE that rectangle, so the region is
                reachable, readable and settable without a pointer. */}
            <ToolControl label="CROP BOX">
              <div className="grid grid-cols-2 gap-2">
                {BOX_FIELDS.map(([key, fieldLabel]) => (
                  <label key={key} className="flex min-w-0 flex-col gap-1">
                    <span className="font-body text-[11px] text-text-muted">{fieldLabel}</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={box ? Math.round(box[key]) : ""}
                      placeholder="—"
                      onChange={(e) => setBoxField(key, Number(e.target.value))}
                      aria-label={`Crop ${fieldLabel.toLowerCase()} in image pixels`}
                      // `!box` is a readiness term, not decoration: until
                      // cropperjs has fired its first `crop` event `setData` does
                      // nothing, and a typed number would vanish silently.
                      disabled={isProcessing || !box}
                      className={NUMBER_FIELD_CLASS}
                    />
                  </label>
                ))}
              </div>
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                Measured in the image&apos;s own pixels from its top-left corner. Drag the handles
                on the canvas, or type here — the arrow keys nudge a field by one pixel.
              </span>
            </ToolControl>

            <ToolControl>
              <ToolSlider
                label="Rotation"
                display={`${rotation}°`}
                hint="Rotates the image before the crop is taken, so the box keeps whatever ends up inside it."
                min={-180}
                max={180}
                step={1}
                value={rotation}
                onChange={handleRotation}
                disabled={isProcessing}
              />
            </ToolControl>

            {/* Renders its own ToolControls, so it goes straight into this
                group rather than inside one — see OutputFormatPicker's head
                comment. */}
            <OutputFormatPicker
              value={format}
              onChange={setFormat}
              quality={quality}
              onQualityChange={setQuality}
              disabled={isProcessing}
              alphaWarning={mayHaveTransparency}
            />
          </ToolControlGroup>
        )}

        <ToolAsideSection label="OUTPUT">
          {/* ToolOutput accents its SECOND row (ToolAside.tsx:239), so the
              measured size keeps that slot and Format follows it. */}
          <ToolOutput
            rows={[
              ["Source", formatFileSize(file.size)],
              ["Cropped", result ? formatFileSize(result.newSize) : "—"],
              ["Format", outputLabel ?? "—"],
            ]}
          />
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
