"use client";

import { useCallback, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { FilePreview } from "@/components/tools/FilePreview";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { useFileProcessor, type ProcessedResult } from "@/hooks/useFileProcessor";

type OutputFormat = "wav" | "mp3";

interface AudioConverterUIProps {
  acceptFormats: string;
  outputFormat: OutputFormat;
  showBitrateSelector?: boolean;
}

const BITRATE_OPTIONS = [128, 192, 256, 320];

export function AudioConverterUI({
  acceptFormats,
  outputFormat,
  showBitrateSelector = false,
}: AudioConverterUIProps) {
  const [file, setFile] = useState<File | null>(null);
  const [bitrate, setBitrate] = useState(192);

  const processFn = useCallback(
    async (f: File): Promise<ProcessedResult> => {
      if (outputFormat === "wav") {
        const { convertToWav } = await import("@/lib/tools/audio-encode-wav");
        return convertToWav(f);
      } else {
        const { convertToMp3 } = await import("@/lib/tools/audio-encode-mp3");
        return convertToMp3(f, { bitrate });
      }
    },
    [outputFormat, bitrate],
  );

  const { status, result, error, process, reset } = useFileProcessor(processFn);

  const handleFiles = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      setFile(f);
      reset();
    },
    [reset],
  );

  const handleConvert = useCallback(() => {
    if (!file) return;
    process(file, undefined as never);
  }, [file, process]);

  const handleReset = useCallback(() => {
    setFile(null);
    reset();
  }, [reset]);

  return (
    <div className="space-y-6">
      {!file ? (
        <DropZone accept={acceptFormats} onFiles={handleFiles} />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FilePreview fileName={file.name} fileSize={file.size} label="Original" />
            {result && (
              <FilePreview
                fileName={result.fileName}
                fileSize={result.newSize}
                label="Converted"
              />
            )}
          </div>

          {/* Bitrate selector for MP3 output */}
          {showBitrateSelector && outputFormat === "mp3" && (
            <div>
              <label className="flex items-center justify-between text-sm text-text-secondary mb-2">
                <span>Bitrate</span>
                <span className="font-mono text-text-muted">{bitrate} kbps</span>
              </label>
              <div className="flex gap-2">
                {BITRATE_OPTIONS.map((b) => (
                  <button
                    key={b}
                    onClick={() => setBitrate(b)}
                    disabled={status === "processing"}
                    className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                      bitrate === b
                        ? "border-accent bg-accent-muted text-accent"
                        : "border-border text-text-secondary hover:bg-bg-hover"
                    }`}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>
          )}

          {status === "processing" && (
            <div className="space-y-2">
              <ProgressBar progress={50} />
              <p className="text-sm text-text-muted text-center">Converting...</p>
            </div>
          )}

          {status === "error" && (
            <p className="text-sm text-error text-center">{error}</p>
          )}

          <div className="flex items-center justify-center gap-3">
            {status !== "done" && status !== "processing" && (
              <button
                onClick={handleConvert}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors"
              >
                Convert
              </button>
            )}
            {result && (
              <DownloadButton blob={result.blob} fileName={result.fileName} />
            )}
            <button
              onClick={handleReset}
              className="rounded-md border border-border px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-hover transition-colors"
            >
              {result ? "Convert another" : "Cancel"}
            </button>
          </div>

          {result && (
            <p className="text-sm text-text-muted text-center">
              {formatSizeComparison(file.size, result.newSize)}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function formatSizeComparison(original: number, converted: number): string {
  const diff = original - converted;
  const pct = Math.abs(Math.round((diff / original) * 100));
  if (diff > 0) return `${pct}% smaller than the original`;
  if (diff < 0) return `${pct}% larger than the original`;
  return "Same size as the original";
}
