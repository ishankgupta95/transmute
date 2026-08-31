"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import type { CompressionPreset } from "@/lib/tools/video-compress";
import { useFileProcessor, type FileProcessorContext } from "@/hooks/useFileProcessor";
import { useIsClient } from "@/hooks/useIsClient";
import {
  isWebCodecsEncodeSupported,
  WEBCODECS_UNSUPPORTED_MESSAGE,
} from "@/lib/utils/webcodecs-support";
import { videoMeta, type Dimensions } from "@/lib/utils/canvas-meta";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { CANVAS_COLUMN, STAGE_GROW, STAGE_MEDIA, chipClass } from "@/components/workspace/shared";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import { ToolControl, ToolControlGroup, ToolProgress } from "@/components/tools/ToolControls";
import {
  CanvasHeader,
  CanvasStage,
  Filmstrip,
  StatStrip,
} from "@/components/tools/ToolCanvas";
import { extractFilmstrip } from "@/lib/tools/media-preview";
import { cn } from "@/lib/utils/cn";

/** Frame count the doc's strip draws. */
const FILMSTRIP_FRAMES = 16;

const PRESETS: { value: CompressionPreset; label: string; desc: string }[] = [
  { value: "whatsapp", label: "WhatsApp", desc: "720p, ~1 Mbps" },
  { value: "email", label: "Email", desc: "480p, ~500 kbps" },
  { value: "web", label: "Web", desc: "Original res, balanced" },
];

export function CompressVideoUI() {
  // Read only after mount so the static export can't bake the build
  // machine's (absent) encoder support into the prerendered HTML.
  const mounted = useIsClient();
  const unsupported = mounted && !isWebCodecsEncodeSupported();
  const [file, setFile] = useState<File | null>(null);
  // The hook revokes on unmount and on swap; the hand-rolled version only
  // revoked on swap, so navigating away pinned the source blob for the tab.
  const videoUrl = useObjectUrl(file);
  const [frames, setFrames] = useState<string[]>([]);
  const [preset, setPreset] = useState<CompressionPreset>("whatsapp");
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

  const processFn = useCallback(
    async (f: File, _options: void, ctx: FileProcessorContext) => {
      const { compressVideo } = await import("@/lib/tools/video-compress");
      return compressVideo(f, preset, ctx);
    },
    [preset],
  );

  // `void` options: `processFn` closes over the preset, so `process` takes the
  // file alone. The hook owns progress and the AbortSignal that makes a 25 MB
  // re-encode cancellable.
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

  const handleCompress = useCallback(() => {
    if (!file) return;
    process(file);
  }, [file, process]);

  const handleReset = useCallback(() => {
    setFile(null);
    setFrames([]);
    setSource({ dims: null, duration: null });
    reset();
  }, [reset]);

  /*
    Each preset is a different target bitrate and height, so switching drops the
    finished file. Otherwise the rail describes the new preset while Download
    still holds the previous encode, and the primary is gone so there is no way
    to run the one that is now selected.
  */
  const handlePresetChange = useCallback(
    (value: CompressionPreset) => {
      if (result) reset();
      setPreset(value);
    },
    [result, reset],
  );

  if (!file) {
    return (
      <>
        {/* Warn before the click, not after a wasted upload; the zone stays
            so the page keeps its shape on an unsupported browser. */}
        {unsupported && <ErrorMessage message={WEBCODECS_UNSUPPORTED_MESSAGE} />}
        <DropZone accept=".mp4,.webm,.mov" onFiles={handleFiles} />
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
              // finished and the output was BIGGER. Say 0% and drop the green.
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

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {/* The doc pins the running readout to the rail footer, above the
                button that started it. WebCodecs reports nothing until the
                first frame lands, so stay indeterminate rather than sitting
                pinned at 0%. */}
            {status === "processing" && (
              <ToolProgress
                phase="RE-ENCODING"
                percent={progress > 0 ? progress : null}
                label="Compressing video"
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
                primaryLabel="Compress"
                onPrimary={handleCompress}
                primaryDisabled={unsupported}
              />
            )}
            {status !== "processing" && (
              <ToolResetLink
                onClick={handleReset}
                label={result ? "COMPRESS ANOTHER" : "CANCEL"}
              />
            )}
          </>
        }
      >
        <ToolControlGroup>
          <ToolControl label="PRESET">
            {/* Each preset carries a second line, so these are cards not chips. */}
            <div className="flex flex-col gap-1.5" role="group" aria-label="Compression preset">
              {PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => handlePresetChange(p.value)}
                  disabled={status === "processing"}
                  aria-pressed={preset === p.value}
                  className={chipClass(
                    preset === p.value,
                    "px-3 py-2.5 text-left disabled:opacity-45",
                  )}
                >
                  <span className="block text-sm font-medium">{p.label}</span>
                  <span className="mt-0.5 block text-xs text-text-muted">{p.desc}</span>
                </button>
              ))}
            </div>
          </ToolControl>
        </ToolControlGroup>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["In", formatFileSize(file.size)],
              ["Out", result ? formatFileSize(result.newSize) : "—"],
              ["Progress", status === "processing" ? `${progress}%` : status === "done" ? "100%" : "—"],
            ]}
          />
          {result && result.newSize >= file.size && (
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              This clip was already smaller than the preset&rsquo;s target — keep the original.
            </span>
          )}
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Re-encoded with WebCodecs in this tab. Long clips take a while — keep the tab open.
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
