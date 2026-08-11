"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import Cropper from "cropperjs";
import "cropperjs/dist/cropper.css";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { cropImage } from "@/lib/tools/image-crop";
import type { ProcessedResult } from "@/hooks/useFileProcessor";
import { useObjectUrl } from "@/hooks/useObjectUrl";
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
import {
  CanvasHeader,
  CanvasStage,
  StatStrip,
} from "@/components/tools/ToolCanvas";

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
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [aspect, setAspect] = useState("Free");
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState<ProcessedResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const cropperRef = useRef<Cropper | null>(null);
  const resultUrl = useObjectUrl(result?.blob ?? null);

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setError(null);
    setRotation(0);
    setAspect("Free");
    setImageUrl(URL.createObjectURL(f));
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
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setFile(null);
    setImageUrl(null);
    setResult(null);
    setError(null);
    setRotation(0);
    setAspect("Free");
  }, [imageUrl]);

  if (!file) {
    return <DropZone accept={acceptFormats} onFiles={handleFiles} />;
  }

  return (
    <>
      {/* ── Canvas: the crop frame, then the cropped result ──── */}
      <div className="min-w-0 space-y-[13px]">
        <CanvasHeader
          file={file.name}
          meta={formatFileSize(file.size)}
          trailing={result ? "CROPPED" : aspect === "Free" ? "FREE" : aspect}
        />

        {result ? (
          <CanvasStage className="flex items-center justify-center bg-[#0c0e17] p-4">
            {resultUrl && (
              /* eslint-disable-next-line @next/next/no-img-element -- blob: URL, nothing for next/image to optimise */
              <img src={resultUrl} alt="Cropped" className="max-h-96 w-full object-contain" />
            )}
          </CanvasStage>
        ) : (
          <>
            <CanvasStage className="max-h-[500px] bg-bg-secondary">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={imageUrl!}
                alt="Crop preview"
                className="block max-w-full"
              />
            </CanvasStage>

            {isProcessing && (
              <div className="space-y-2">
                <ProgressBar progress={null} />
                <p className="text-sm text-text-muted text-center">Cropping...</p>
              </div>
            )}
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
            <ToolActions
              primaryLabel={isProcessing ? "Cropping…" : "Crop"}
              onPrimary={handleCrop}
              primaryDisabled={isProcessing}
              onReset={handleReset}
              resetLabel="CANCEL"
            />
          )
        }
      >
        {!result && (
          <>
            <ToolAsideSection label="ASPECT">
              <ToolChoice
                label="Aspect ratio"
                value={aspect}
                onChange={handleAspectRatio}
                disabled={isProcessing}
                options={ASPECT_RATIOS.map((ar) => ({ value: ar.label, label: ar.label }))}
              />
            </ToolAsideSection>

            <ToolAsideSection>
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
            </ToolAsideSection>
          </>
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
