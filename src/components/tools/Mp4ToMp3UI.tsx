"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { useFileProcessor, type FileProcessorContext } from "@/hooks/useFileProcessor";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
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
import { CANVAS_COLUMN, STAGE_GROW, STAGE_MEDIA } from "@/components/workspace/shared";
import { cn } from "@/lib/utils/cn";
import { StatusMessage } from "@/components/tools/StatusMessage";

/** Frame count the doc's strip draws. */
const FILMSTRIP_FRAMES = 16;

const BITRATE_OPTIONS = [128, 192, 256, 320];

export function Mp4ToMp3UI() {
  const [file, setFile] = useState<File | null>(null);
  // The hook revokes on unmount and on swap; the hand-rolled version only
  // revoked on swap, so navigating away pinned the source blob for the tab.
  const videoUrl = useObjectUrl(file);
  const [frames, setFrames] = useState<string[]>([]);
  const [bitrate, setBitrate] = useState(192);

  const processFn = useCallback(
    async (f: File, _options: void, ctx: FileProcessorContext) => {
      const { mp4ToMp3 } = await import("@/lib/tools/mp4-to-mp3");
      return mp4ToMp3(f, { bitrate }, ctx);
    },
    [bitrate],
  );

  // `void` options: `processFn` closes over the bitrate. The hook's signal
  // reaches FFmpeg, where cancelling means terminating the worker.
  const { status, result, error, progress, process, cancel, reset } =
    useFileProcessor<void>(processFn);

  const handleFiles = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      setFile(f);
      reset();
      setFrames([]);
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
    setFile(null);
    setFrames([]);
    reset();
  }, [reset]);

  /*
    The bitrate decides what the next run produces, so picking a new one drops
    the finished MP3. Otherwise the rail shows the new bitrate while the
    Download button still holds audio encoded at the old one, with no primary
    left to re-run it.
  */
  const handleBitrateChange = useCallback(
    (v: number) => {
      if (result) reset();
      setBitrate(v);
    },
    [result, reset],
  );

  if (!file) {
    return <DropZone accept=".mp4,.webm,.mov,.avi,.mkv" onFiles={handleFiles} />;
  }

  return (
    <>
      {/* ── Canvas: what you look at ─────────────────────────── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={formatFileSize(file.size)}
          trailing="MP3"
        />

        {videoUrl && (
          <CanvasStage className={cn(STAGE_GROW, "flex items-center justify-center bg-black")}>
            <video src={videoUrl} controls className={cn(STAGE_MEDIA, "bg-black")} />
            <span className="absolute top-3 right-3.5 rounded-sm bg-[rgba(12,14,23,.72)] px-[7px] py-1 font-mono text-[9.5px] leading-none font-medium tracking-[0.12em] text-accent-300">
              MP3
            </span>
          </CanvasStage>
        )}

        <Filmstrip frames={frames} startPct={0} endPct={100} />

        <StatStrip
          stats={[
            { label: "IN", value: formatFileSize(file.size), tone: "neutral" },
            { label: "OUT", value: result ? formatFileSize(result.newSize) : "—" },
            {
              // A bare em dash read as "not run yet" even when the run had
              // finished and the MP3 came out BIGGER than the source (a short,
              // high-bitrate clip does that). Say 0% and drop the green.
              label: "SAVED",
              value: !result
                ? "—"
                : result.newSize < file.size
                  ? `${Math.round(((file.size - result.newSize) / file.size) * 100)}%`
                  : "0%",
              tone: result && result.newSize >= file.size ? "neutral" : "ok",
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
            <ProgressBar progress={progress > 0 ? progress : null} label="Extracting audio" />
            <StatusMessage detail={progress > 0 ? ` (${progress}%)` : "..."}>
              Extracting audio
            </StatusMessage>
          </div>
        )}

        {status === "error" && (
          <ErrorMessage message={error} />
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
            ) : status === "processing" ? (
              // The one reachable control while FFmpeg runs. It replaces the
              // primary rather than sitting beside it so "Cancel" is never two
              // different things at once.
              <ToolActions primaryLabel="Cancel" onPrimary={cancel} />
            ) : (
              <ToolActions primaryLabel="Extract Audio" onPrimary={handleConvert} />
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
        <ToolAsideSection label="BITRATE">
          <ToolChoice
            label="MP3 bitrate"
            fill
            value={bitrate}
            onChange={handleBitrateChange}
            disabled={status === "processing"}
            options={BITRATE_OPTIONS.map((b) => ({ value: b, label: String(b) }))}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            kbps. Higher than the video&rsquo;s own audio track buys nothing.
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Video", formatFileSize(file.size)],
              ["MP3", result ? formatFileSize(result.newSize) : "—"],
              ["Progress", status === "processing" ? `${progress}%` : status === "done" ? "100%" : "—"],
            ]}
          />
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
