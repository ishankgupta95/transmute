"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { encodeIcoAsync } from "@/lib/tools/ico-encode";
import { loadImage } from "@/lib/tools/canvas-utils";
import { drawContained } from "@/lib/tools/image-draw";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { useImageDimensions } from "@/hooks/useImageDimensions";
import { imageMeta } from "@/lib/utils/canvas-meta";
import { formatFileSize } from "@/lib/utils/file-helpers";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import { ToolProgress } from "@/components/tools/ToolControls";
import { CanvasHeader, IconSizes } from "@/components/tools/ToolCanvas";
import { CANVAS_COLUMN } from "@/components/workspace/shared";

const ICO_SIZES = [16, 32, 48];

interface PngToIcoUIProps {
  acceptFormats: string;
}

export function PngToIcoUI({ acceptFormats }: PngToIcoUIProps) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ blob: Blob; fileName: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewUrl = useObjectUrl(file);
  // The doc's icon readout is "1024 × 1024 · 84 KB" — the source dimensions
  // matter here, since anything under 48px is upscaled into the .ico.
  const sourceDims = useImageDimensions(file);

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setError(null);
  }, []);

  const handleConvert = useCallback(async () => {
    if (!file) return;
    setIsProcessing(true);
    setError(null);

    try {
      const img = await loadImage(file);
      const images = ICO_SIZES.map((size) => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas 2D context not available");
        drawContained(ctx, img, size);
        return { canvas, size };
      });

      const icoBlob = await encodeIcoAsync(images);
      const baseName = file.name.replace(/\.[^.]+$/, "");
      setResult({ blob: icoBlob, fileName: `${baseName}.ico` });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Conversion failed");
    }
    setIsProcessing(false);
  }, [file]);

  const handleReset = useCallback(() => {
    setFile(null);
    setResult(null);
    setError(null);
  }, []);

  if (!file) {
    return <DropZone accept={acceptFormats} onFiles={handleFiles} />;
  }

  return (
    <>
      {/* ── Canvas: the icon, at the sizes it will actually ship ─ */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={imageMeta(sourceDims, formatFileSize(file.size))}
          trailing="ICO"
        />

        <IconSizes
          previewUrl={previewUrl}
          sizes={[
            [16, "Browser tab", 16],
            [32, "Browser tab", 24],
            [48, "Windows", 34],
          ]}
        />

        {error && <ErrorMessage message={error} />}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {/* The doc pins the running readout to the rail footer. The three
                canvas draws report no progress, so the bar is indeterminate. */}
            {isProcessing && (
              <ToolProgress phase="ENCODING ICO" percent={null} label="Encoding ICO" />
            )}
            {result ? (
              <DownloadButton
                blob={result.blob}
                fileName={result.fileName}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel={isProcessing ? "Converting…" : "Convert to ICO"}
                onPrimary={handleConvert}
                primaryDisabled={isProcessing}
              />
            )}
            <ToolResetLink
              onClick={handleReset}
              label={result ? "CONVERT ANOTHER" : "CANCEL"}
            />
          </>
        }
      >
        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Source", formatFileSize(file.size)],
              ["Sizes", ICO_SIZES.map((s) => `${s}`).join(" · ")],
              ["ICO", result ? formatFileSize(result.blob.size) : "—"],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            One .ico containing all three sizes — Windows and older browsers pick the one they
            need.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
