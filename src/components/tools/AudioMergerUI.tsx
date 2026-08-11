"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { mergeAudio, type AudioMergeOptions } from "@/lib/tools/audio-merge";
import { formatFileSize } from "@/lib/utils/file-helpers";
import type { ProcessedResult } from "@/hooks/useFileProcessor";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import { CanvasHeader, StatStrip } from "@/components/tools/ToolCanvas";

export function AudioMergerUI() {
  const [files, setFiles] = useState<File[]>([]);
  const [outputFormat, setOutputFormat] = useState<"wav" | "mp3">("mp3");
  const [bitrate, setBitrate] = useState(192);
  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [result, setResult] = useState<ProcessedResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = useCallback((newFiles: File[]) => {
    setFiles((prev) => [...prev, ...newFiles]);
    setStatus("idle");
    setResult(null);
    setError(null);
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const moveFile = useCallback((from: number, to: number) => {
    setFiles((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const handleMerge = useCallback(async () => {
    if (files.length < 2) return;
    setStatus("processing");
    setError(null);
    setResult(null);
    try {
      const opts: AudioMergeOptions = { outputFormat, bitrate };
      const output = await mergeAudio(files, opts);
      setResult(output);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Merge failed");
      setStatus("error");
    }
  }, [files, outputFormat, bitrate]);

  const handleReset = useCallback(() => {
    setFiles([]);
    setStatus("idle");
    setResult(null);
    setError(null);
  }, []);

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <>
      {/* ── Canvas: the queue, in the order it will be joined ── */}
      <div className="min-w-0 space-y-[15px]">
        <DropZone
          accept=".mp3,.wav,.ogg,.m4a,.flac,.aac"
          multiple
          onFiles={handleFiles}
          disabled={status === "processing"}
        />

        {files.length > 0 && (
          <>
            <div className="flex items-baseline gap-3">
              <span className="font-display text-[13px] leading-none font-medium text-text-primary">
                Join order
              </span>
              <span className="font-mono text-[10.5px] leading-none text-text-muted">
                {files.length} FILES · {formatFileSize(totalSize)}
              </span>
            </div>

            <div className="flex flex-col overflow-hidden rounded-[10px] border border-neutral-800 bg-bg-primary">
              {files.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  className="flex items-center gap-3.5 border-b border-border px-4 py-3 last:border-b-0"
                >
                  <span className="w-5 flex-none font-mono text-[10px] leading-none text-text-muted">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-body text-xs leading-none text-neutral-300">
                    {file.name}
                  </span>
                  <span className="flex-none font-mono text-[10px] leading-none text-text-muted">
                    {formatFileSize(file.size)}
                  </span>
                  <div className="flex flex-none items-center gap-1">
                    <button
                      onClick={() => index > 0 && moveFile(index, index - 1)}
                      disabled={index === 0 || status === "processing"}
                      className="cursor-pointer rounded p-1 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-30"
                      aria-label="Move up"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="18 15 12 9 6 15" />
                      </svg>
                    </button>
                    <button
                      onClick={() => index < files.length - 1 && moveFile(index, index + 1)}
                      disabled={index === files.length - 1 || status === "processing"}
                      className="cursor-pointer rounded p-1 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-30"
                      aria-label="Move down"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    <button
                      onClick={() => removeFile(index)}
                      disabled={status === "processing"}
                      className="cursor-pointer rounded p-1 text-text-muted transition-colors hover:bg-bg-hover hover:text-error disabled:opacity-30"
                      aria-label="Remove file"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <StatStrip
              stats={[
                { label: "FILES", value: String(files.length), tone: "neutral" },
                { label: "IN", value: formatFileSize(totalSize), tone: "neutral" },
                { label: "OUT", value: result ? formatFileSize(result.newSize) : "—" },
                { label: "FORMAT", value: outputFormat.toUpperCase(), tone: "ok" },
              ]}
            />
          </>
        )}

        {status === "processing" && (
          <div className="space-y-2">
            <ProgressBar progress={null} />
            <p className="text-sm text-text-muted text-center">Merging audio files...</p>
          </div>
        )}

        {status === "error" && (
          <ErrorMessage message={error} />
        )}

        {result && (
          <CanvasHeader
            file={result.fileName}
            meta={formatFileSize(result.newSize)}
            trailing="MERGED"
          />
        )}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {result ? (
              <DownloadButton
                blob={result.blob}
                fileName={result.fileName}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel={
                  status === "processing" ? "Merging…" : `Merge ${files.length} files`
                }
                onPrimary={handleMerge}
                primaryDisabled={files.length < 2 || status === "processing"}
              />
            )}
            {files.length > 0 && (
              <ToolResetLink
                onClick={handleReset}
                label={result ? "START OVER" : "CLEAR ALL"}
              />
            )}
          </>
        }
      >
        <ToolAsideSection label="FORMAT">
          <ToolChoice
            label="Output format"
            fill
            value={outputFormat}
            onChange={setOutputFormat}
            disabled={status === "processing"}
            options={[
              { value: "mp3" as const, label: "MP3" },
              { value: "wav" as const, label: "WAV" },
            ]}
          />
        </ToolAsideSection>

        {outputFormat === "mp3" && (
          <ToolAsideSection label="BITRATE">
            <ToolChoice
              label="MP3 bitrate"
              fill
              value={bitrate}
              onChange={setBitrate}
              disabled={status === "processing"}
              options={[128, 192, 256, 320].map((b) => ({ value: b, label: String(b) }))}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              kbps
            </span>
          </ToolAsideSection>
        )}

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Files", String(files.length)],
              ["In", files.length > 0 ? formatFileSize(totalSize) : "—"],
              ["Out", result ? formatFileSize(result.newSize) : "—"],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {files.length < 2
              ? "Add at least two files to merge."
              : "They join end to end, top to bottom — use the arrows to reorder."}
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
