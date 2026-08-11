"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { useFileProcessor, type FileProcessorContext } from "@/hooks/useFileProcessor";
import { formatFileSize } from "@/lib/utils/file-helpers";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import {
  CanvasHeader,
  CanvasStage,
  Filmstrip,
  StatStrip,
} from "@/components/tools/ToolCanvas";
import { extractFilmstrip } from "@/lib/tools/media-preview";

/** Frame count the doc's strip draws. */
const FILMSTRIP_FRAMES = 16;

export function WebmToMp4UI() {
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [frames, setFrames] = useState<string[]>([]);

  const processFn = useCallback(async (f: File, _options: void, ctx: FileProcessorContext) => {
    const { webmToMp4 } = await import("@/lib/tools/webm-to-mp4");
    return webmToMp4(f, ctx);
  }, []);

  // This tool has no settings, so `void` options and the hook owns everything:
  // progress, and the AbortSignal that makes the re-encode cancellable.
  const { status, result, error, progress, process, cancel, reset } =
    useFileProcessor<void>(processFn);

  const handleFiles = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      setFile(f);
      reset();
      setFrames([]);
      setVideoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(f);
      });

      // Decoration only — see VideoTrimmerUI.
      extractFilmstrip(f, FILMSTRIP_FRAMES)
        .then(setFrames)
        .catch(() => setFrames([]));
    },
    [reset],
  );

  const handleConvert = useCallback(() => {
    if (!file) return;
    process(file);
  }, [file, process]);

  const handleReset = useCallback(() => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setFile(null);
    setVideoUrl(null);
    setFrames([]);
    reset();
  }, [videoUrl, reset]);

  if (!file) {
    return <DropZone accept=".webm" onFiles={handleFiles} />;
  }

  return (
    <>
      {/* ── Canvas: what you look at ─────────────────────────── */}
      <div className="min-w-0 space-y-[13px]">
        <CanvasHeader
          file={file.name}
          meta={formatFileSize(file.size)}
          trailing="MP4"
        />

        {videoUrl && (
          <CanvasStage className="flex items-center justify-center bg-black">
            <video src={videoUrl} controls className="max-h-72 w-full bg-black" />
            <span className="absolute top-3 right-3.5 rounded-sm bg-[rgba(12,14,23,.72)] px-[7px] py-1 font-mono text-[9.5px] leading-none font-medium tracking-[0.12em] text-accent-300">
              MP4
            </span>
          </CanvasStage>
        )}

        <Filmstrip frames={frames} startPct={0} endPct={100} />

        <StatStrip
          stats={[
            { label: "IN", value: formatFileSize(file.size), tone: "neutral" },
            { label: "OUT", value: result ? formatFileSize(result.newSize) : "—" },
            {
              label: "SAVED",
              value:
                result && result.newSize < file.size
                  ? `${Math.round(((file.size - result.newSize) / file.size) * 100)}%`
                  : "—",
              tone: "ok",
            },
            {
              label: "PROGRESS",
              value: status === "processing" ? `${progress}%` : status === "done" ? "100%" : "—",
              tone: "neutral",
            },
          ]}
        />

        {status === "processing" && (
          <div className="space-y-2">
            <ProgressBar progress={progress} />
            <p className="text-sm text-text-muted text-center">
              Converting to MP4{progress > 0 ? ` (${progress}%)` : "..."}
            </p>
          </div>
        )}

        {status === "error" && (
          <ErrorMessage message={error} />
        )}
      </div>

      {/* ── Controls: this tool has no options, so the rail is
             the readout plus the one action. ─────────────────── */}
      <ToolAside
        footer={
          <>
            {result ? (
              <DownloadButton
                blob={result.blob}
                fileName={result.fileName}
                className="w-full justify-center"
              />
            ) : status === "processing" ? (
              // The one reachable control while a re-encode runs. It replaces
              // the primary rather than sitting beside it so "Cancel" is never
              // two different things at once.
              <ToolActions primaryLabel="Cancel" onPrimary={cancel} />
            ) : (
              <ToolActions primaryLabel="Convert to MP4" onPrimary={handleConvert} />
            )}
            {status !== "processing" && (
              <ToolResetLink
                onClick={handleReset}
                label={result ? "CONVERT ANOTHER" : "CANCEL"}
              />
            )}
          </>
        }
      >
        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["In", formatFileSize(file.size)],
              ["Out", result ? formatFileSize(result.newSize) : "—"],
              ["Progress", status === "processing" ? `${progress}%` : status === "done" ? "100%" : "—"],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Video is re-encoded to H.264 and audio to AAC so the file plays anywhere.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
