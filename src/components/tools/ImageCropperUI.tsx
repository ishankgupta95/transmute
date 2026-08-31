"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import Cropper from "cropperjs";
import "cropperjs/dist/cropper.css";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { cropImage } from "@/lib/tools/image-crop";
import type { ProcessedResult } from "@/hooks/useFileProcessor";
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

interface ImageCropperUIProps {
  acceptFormats: string;
}

export function ImageCropperUI({ acceptFormats }: ImageCropperUIProps) {
  const [file, setFile] = useState<File | null>(null);
  const [aspect, setAspect] = useState("Free");
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState<ProcessedResult | null>(null);
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

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setError(null);
    setRotation(0);
    setAspect("Free");
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
      const output = await cropImage(croppedCanvas, file);
      setResult(output);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Crop failed");
    }
    setIsProcessing(false);
  }, [file]);

  const handleReset = useCallback(() => {
    setFile(null);
    setResult(null);
    setError(null);
    setRotation(0);
    setAspect("Free");
  }, []);

  if (!file) {
    return <DropZone accept={acceptFormats} onFiles={handleFiles} />;
  }

  return (
    <>
      {/* ── Canvas: the crop frame, then the cropped result ──── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={imageMeta(sourceDims, formatFileSize(file.size))}
          trailing={result ? "CROPPED" : aspect === "Free" ? "FREE" : aspect}
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

            <ToolControl>
              <ToolSlider
                label="Rotation"
                display={`${rotation}°`}
                hint="Drag the handles on the canvas to move or resize the crop box."
                min={-180}
                max={180}
                step={1}
                value={rotation}
                onChange={handleRotation}
                disabled={isProcessing}
              />
            </ToolControl>
          </ToolControlGroup>
        )}

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Source", formatFileSize(file.size)],
              ["Cropped", result ? formatFileSize(result.newSize) : "—"],
            ]}
          />
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
