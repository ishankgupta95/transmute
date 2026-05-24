"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { FilePreview } from "@/components/tools/FilePreview";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import type { CompressionPreset } from "@/lib/tools/video-compress";

type Status = "idle" | "processing" | "done" | "error";

const PRESETS: { value: CompressionPreset; label: string; desc: string }[] = [
  { value: "whatsapp", label: "WhatsApp", desc: "720p, ~1 Mbps" },
  { value: "email", label: "Email", desc: "480p, ~500 kbps" },
  { value: "web", label: "Web", desc: "Original res, balanced" },
];

export function CompressVideoUI() {
  const [file, setFile] = useState<File | null>(null);
  const [preset, setPreset] = useState<CompressionPreset>("whatsapp");
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ blob: Blob; fileName: string; size: number } | null>(null);

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setStatus("idle");
    setResult(null);
    setError(null);
  }, []);

  const handleCompress = useCallback(async () => {
    if (!file) return;
    setStatus("processing");
    setProgress(0);
    setError(null);
    setResult(null);
    try {
      const { compressVideo } = await import("@/lib/tools/video-compress");
      const output = await compressVideo(file, preset, setProgress);
      setResult({ blob: output.blob, fileName: output.fileName, size: output.newSize });
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Compression failed");
      setStatus("error");
    }
  }, [file, preset]);

  const handleReset = useCallback(() => {
    setFile(null);
    setStatus("idle");
    setResult(null);
    setError(null);
  }, []);

  return (
    <div className="space-y-6">
      {!file ? (
        <DropZone accept=".mp4,.webm,.mov,.avi,.mkv" onFiles={handleFiles} />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FilePreview fileName={file.name} fileSize={file.size} label="Original" />
            {result && (
              <FilePreview fileName={result.fileName} fileSize={result.size} label="Compressed" />
            )}
          </div>

          {/* Preset selector */}
          <div>
            <label className="block text-sm text-text-secondary mb-2">Compression preset</label>
            <div className="grid grid-cols-3 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setPreset(p.value)}
                  disabled={status === "processing"}
                  className={`rounded-md border px-3 py-3 text-left transition-colors ${
                    preset === p.value
                      ? "border-accent bg-accent-muted"
                      : "border-border hover:bg-bg-hover"
                  }`}
                >
                  <span className={`block text-sm font-medium ${preset === p.value ? "text-accent" : "text-text-primary"}`}>
                    {p.label}
                  </span>
                  <span className="block text-xs text-text-muted mt-0.5">{p.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {status === "processing" && (
            <div className="space-y-2">
              <ProgressBar progress={progress} />
              <p className="text-sm text-text-muted text-center">
                Compressing{progress > 0 ? ` (${progress}%)` : "..."}
              </p>
            </div>
          )}

          {status === "error" && (
            <ErrorMessage message={error} />
          )}

          <div className="flex items-center justify-center gap-3">
            {status !== "done" && status !== "processing" && (
              <button
                onClick={handleCompress}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors"
              >
                Compress
              </button>
            )}
            {result && (
              <DownloadButton blob={result.blob} fileName={result.fileName} />
            )}
            <button
              onClick={handleReset}
              className="rounded-md border border-border px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-hover transition-colors"
            >
              {result ? "Compress another" : "Cancel"}
            </button>
          </div>

          {result && (
            <p className="text-sm text-text-muted text-center">
              {Math.round(((file.size - result.size) / file.size) * 100)}% smaller than the original
            </p>
          )}
        </>
      )}
    </div>
  );
}
