"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import Cropper from "cropperjs";
import "cropperjs/dist/cropper.css";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { cropImage, type CropData } from "@/lib/tools/image-crop";
import type { ProcessedResult } from "@/hooks/useFileProcessor";
import { formatFileSize } from "@/lib/utils/file-helpers";

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
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState<ProcessedResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const cropperRef = useRef<Cropper | null>(null);

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setError(null);
    setRotation(0);
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

  const handleAspectRatio = useCallback((ratio: number) => {
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
      const data = cropperRef.current.getData(true);
      const cropData: CropData = {
        x: data.x,
        y: data.y,
        width: data.width,
        height: data.height,
        rotate: data.rotate,
      };
      const output = await cropImage(file, cropData);
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
  }, [imageUrl]);

  return (
    <div className="space-y-6">
      {!file ? (
        <DropZone accept={acceptFormats} onFiles={handleFiles} />
      ) : result ? (
        <>
          {/* Result preview */}
          <div className="flex flex-col items-center gap-4">
            <img
              src={URL.createObjectURL(result.blob)}
              alt="Cropped"
              className="max-h-96 rounded border border-border"
            />
            <p className="text-sm text-text-muted">
              {formatFileSize(result.newSize)}
            </p>
          </div>
          <div className="flex items-center justify-center gap-3">
            <DownloadButton blob={result.blob} fileName={result.fileName} />
            <button
              onClick={handleReset}
              className="rounded-md border border-border px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-hover transition-colors"
            >
              Crop another
            </button>
          </div>
        </>
      ) : (
        <>
          {/* Cropper area */}
          <div className="max-h-[500px] overflow-hidden rounded-lg border border-border bg-bg-secondary">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={imageUrl!}
              alt="Crop preview"
              className="block max-w-full"
            />
          </div>

          {/* Aspect ratio presets */}
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <span className="text-sm text-text-muted mr-1">Aspect:</span>
            {ASPECT_RATIOS.map((ar) => (
              <button
                key={ar.label}
                onClick={() => handleAspectRatio(ar.value)}
                className="rounded-md bg-bg-elevated px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-hover transition-colors"
              >
                {ar.label}
              </button>
            ))}
          </div>

          {/* Rotation slider */}
          <div>
            <label className="flex items-center justify-between text-sm text-text-secondary mb-2">
              <span>Rotation</span>
              <span className="font-mono text-text-muted">{rotation}°</span>
            </label>
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={rotation}
              onChange={(e) => handleRotation(Number(e.target.value))}
              className="w-full accent-accent"
            />
          </div>

          {/* Progress / Error */}
          {isProcessing && (
            <div className="space-y-2">
              <ProgressBar progress={null} />
              <p className="text-sm text-text-muted text-center">Cropping...</p>
            </div>
          )}
          {error && <ErrorMessage message={error} />}

          {/* Actions */}
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={handleCrop}
              disabled={isProcessing}
              className="inline-flex items-center gap-2 rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              Crop
            </button>
            <button
              onClick={handleReset}
              className="rounded-md border border-border px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-hover transition-colors"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
