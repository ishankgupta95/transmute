"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { useFileProcessor, type FileProcessorContext } from "@/hooks/useFileProcessor";
import { useIsClient } from "@/hooks/useIsClient";
import {
  isWebCodecsEncodeSupported,
  WEBCODECS_UNSUPPORTED_MESSAGE,
} from "@/lib/utils/webcodecs-support";
import { videoMeta, type Dimensions } from "@/lib/utils/canvas-meta";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import { ToolProgress } from "@/components/tools/ToolControls";
import {
  CanvasHeader,
  CanvasStage,
  Filmstrip,
  StatStrip,
} from "@/components/tools/ToolCanvas";
import { extractFilmstrip } from "@/lib/tools/media-preview";
import { CANVAS_COLUMN, STAGE_GROW, STAGE_MEDIA } from "@/components/workspace/shared";
import { cn } from "@/lib/utils/cn";
import { getToolBySlug } from "@/data/tools";

/** Frame count the doc's strip draws. */
const FILMSTRIP_FRAMES = 16;

/* Same registry read as CompressVideoUI — see the note there. */
const PRACTICAL_LIMIT_NOTE = getToolBySlug("webm-to-mp4")?.practicalLimitNote;

export function WebmToMp4UI() {
  // Read only after mount so the static export can't bake the build
  // machine's (absent) encoder support into the prerendered HTML.
  const mounted = useIsClient();
  const unsupported = mounted && !isWebCodecsEncodeSupported();
  const [file, setFile] = useState<File | null>(null);
  // The hook revokes on unmount and on swap; the hand-rolled version only
  // revoked on swap, so navigating away pinned the source blob for the tab.
  const videoUrl = useObjectUrl(file);
  const [frames, setFrames] = useState<string[]>([]);
  /* The doc's video readout leads with the frame size and the clip length:
     "1920 × 1080 · 00:47.2 · 28.6 MB". Both come off `loadedmetadata` on the
     preview that is already on screen — no extra decode. WebM written by
     MediaRecorder declares no duration, so that half stays absent rather than
     printing Infinity. */
  const [source, setSource] = useState<{ dims: Dimensions | null; duration: number | null }>({
    dims: null,
    duration: null,
  });

  const readSourceMeta = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    setSource({
      dims: v.videoWidth > 0 && v.videoHeight > 0 ? { w: v.videoWidth, h: v.videoHeight } : null,
      duration: Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null,
    });
  }, []);

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
      setSource({ dims: null, duration: null });
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
    setSource({ dims: null, duration: null });
    reset();
  }, [reset]);

  if (!file) {
    return (
      <>
        {/* Warn before the click, not after a wasted upload; the zone stays
            so the page keeps its shape on an unsupported browser. */}
        {unsupported && <ErrorMessage message={WEBCODECS_UNSUPPORTED_MESSAGE} />}
        <DropZone
          accept=".webm"
          practicalLimitNote={PRACTICAL_LIMIT_NOTE}
          onFiles={handleFiles}
        />
      </>
    );
  }

  return (
    <>
      {/* ── Canvas: what you look at ─────────────────────────── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={videoMeta(
            source.dims,
            source.duration ? formatClock(source.duration) : null,
            formatFileSize(file.size),
          )}
          trailing="MP4"
        />

        {videoUrl && (
          <CanvasStage className={cn(STAGE_GROW, "flex items-center justify-center bg-black")}>
            <video
              src={videoUrl}
              controls
              onLoadedMetadata={readSourceMeta}
              className={cn(STAGE_MEDIA, "bg-black")}
            />
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
              // A bare em dash read as "not run yet" even when the run had
              // finished and the MP4 came out BIGGER — re-encoding a
              // well-compressed WebM to H.264 routinely does. Say 0%, no green.
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

        {status === "error" && (
          <ErrorMessage message={error} />
        )}
        {/* The same pre-flight banner as the drop state — it is what explains
            the disabled primary once a file is already loaded. */}
        {unsupported && status !== "error" && (
          <ErrorMessage message={WEBCODECS_UNSUPPORTED_MESSAGE} />
        )}
      </div>

      {/* ── Controls: this tool has no options, so the rail is
             the readout plus the one action. ─────────────────── */}
      <ToolAside
        footer={
          <>
            {/* The doc pins the running readout to the rail footer, above the
                button that started it. The encoder reports nothing until the
                first frame lands, so stay indeterminate rather than sitting
                pinned at 0%. */}
            {status === "processing" && (
              <ToolProgress
                phase="RE-ENCODING"
                percent={progress > 0 ? progress : null}
                label="Converting to MP4"
              />
            )}
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
              <ToolActions
                primaryLabel="Convert to MP4"
                onPrimary={handleConvert}
                primaryDisabled={unsupported}
              />
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

/** `m:ss.d`, matching the doc's clip readouts. */
function formatClock(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins}:${String(secs).padStart(2, "0")}.${ms}`;
}
