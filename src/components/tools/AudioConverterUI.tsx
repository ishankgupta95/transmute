"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import {
  useFileProcessor,
  type FileProcessorContext,
  type ProcessedResult,
} from "@/hooks/useFileProcessor";
import { audioMeta } from "@/lib/utils/canvas-meta";
import { formatDelta, formatFileSize } from "@/lib/utils/file-helpers";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import { ToolControl, ToolControlGroup, ToolProgress } from "@/components/tools/ToolControls";
import {
  CanvasHeader,
  CanvasStage,
  StatStrip,
  Waveform,
  WaveformSkeleton,
} from "@/components/tools/ToolCanvas";
import { computeWaveform } from "@/lib/tools/media-preview";
import { CANVAS_COLUMN, STAGE_GROW } from "@/components/workspace/shared";
import { cn } from "@/lib/utils/cn";

type OutputFormat = "wav" | "mp3";

interface AudioConverterUIProps {
  acceptFormats: string;
  outputFormat: OutputFormat;
  showBitrateSelector?: boolean;
}

const BITRATE_OPTIONS = [128, 192, 256, 320];
/** Bar count the doc's waveform draws. */
const WAVEFORM_BARS = 90;

export function AudioConverterUI({
  acceptFormats,
  outputFormat,
  showBitrateSelector = false,
}: AudioConverterUIProps) {
  const [file, setFile] = useState<File | null>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  /*
    `peaks === null` alone cannot tell "still decoding" from "could not
    decode", and this tool has no <audio> element to report the failure the way
    the trimmer's does — so a failed preview sat under the loading skeleton
    forever. Tracked separately so the stage can say which one it is.
  */
  const [waveState, setWaveState] = useState<"loading" | "ok" | "failed">("loading");
  const [duration, setDuration] = useState(0);
  /*
    Stream facts off the same decode that draws the bars — the doc's header
    reads "48 kHz · STEREO · 11:30 · 126 MB".
  */
  const [stream, setStream] = useState<{ sampleRate: number; channels: number } | null>(null);
  const [bitrate, setBitrate] = useState(192);

  const processFn = useCallback(
    async (f: File, _opts: void, ctx: FileProcessorContext): Promise<ProcessedResult> => {
      if (outputFormat === "wav") {
        const { convertToWav } = await import("@/lib/tools/audio-encode-wav");
        return convertToWav(f, ctx);
      } else {
        const { convertToMp3 } = await import("@/lib/tools/audio-encode-mp3");
        return convertToMp3(f, { bitrate }, ctx);
      }
    },
    [outputFormat, bitrate],
  );

  // `void` options: the conversion settings are closed over by `processFn`,
  // so `process` takes the file alone.
  const { status, result, error, progress, process, cancel, reset } =
    useFileProcessor<void>(processFn);

  const handleFiles = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      setFile(f);
      setPeaks(null);
      setWaveState("loading");
      setDuration(0);
      setStream(null);
      reset();

      // Decoration only — the conversion decodes independently (and through
      // the FFmpeg fallback this preview lacks), so a failed preview says the
      // preview failed, never that the conversion will.
      computeWaveform(f, WAVEFORM_BARS)
        .then((w) => {
          setPeaks(w.peaks);
          setDuration(w.duration);
          setStream({ sampleRate: w.sampleRate, channels: w.channels });
          setWaveState("ok");
        })
        .catch(() => {
          setPeaks(null);
          setWaveState("failed");
        });
    },
    [reset],
  );

  const handleConvert = useCallback(() => {
    if (!file) return;
    // `processFn` closes over `outputFormat`/`bitrate`, so there are no
    // per-call options to pass.
    process(file);
  }, [file, process]);

  const handleReset = useCallback(() => {
    setFile(null);
    setPeaks(null);
    setWaveState("loading");
    setDuration(0);
    setStream(null);
    reset();
  }, [reset]);

  if (!file) {
    return <DropZone accept={acceptFormats} onFiles={handleFiles} />;
  }

  const showBitrate = showBitrateSelector && outputFormat === "mp3";

  return (
    <>
      {/* ── Canvas: the doc's waveform stage ─────────────────── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={audioMeta(stream, duration ? formatClock(duration) : null, formatFileSize(file.size))}
          trailing={outputFormat.toUpperCase()}
        />

        {/* The one growing stage in this column — the waveform is the whole
            canvas, so it takes the height the column has spare. */}
        <CanvasStage className={cn(STAGE_GROW, "flex flex-col")}>
          <div className="absolute inset-x-0 top-1/2 h-px bg-border" aria-hidden="true" />
          {peaks ? (
            <Waveform peaks={peaks} startPct={0} endPct={100} />
          ) : waveState === "failed" ? (
            <div className="flex h-full min-h-[170px] items-center justify-center px-3.5 text-center font-mono text-[10.5px] leading-none text-text-muted">
              PREVIEW UNAVAILABLE — CONVERSION STILL RUNS
            </div>
          ) : (
            <WaveformSkeleton />
          )}
          <span className="absolute bottom-2.5 left-3.5 font-mono text-[9.5px] leading-none text-text-muted">
            0:00
          </span>
          <span className="absolute right-3.5 bottom-2.5 font-mono text-[9.5px] leading-none text-text-muted">
            {duration ? formatClock(duration) : "—"}
          </span>
        </CanvasStage>

        <StatStrip
          stats={[
            { label: "IN", value: formatFileSize(file.size), tone: "neutral" },
            { label: "OUT", value: result ? formatFileSize(result.newSize) : "—" },
            // Terse and mono, like every other cell — the prose form of this
            // number wrapped to two lines and set the height of the whole row.
            {
              label: "DELTA",
              value: result ? formatDelta(file.size, result.newSize) : "—",
              // Green is a claim. MP3 → WAV multiplies the size by ~10 and
              // this cell used to paint that growth as a success.
              tone: !result || result.newSize <= file.size ? "ok" : "accent",
            },
            { label: "FORMAT", value: outputFormat.toUpperCase(), tone: "neutral" },
          ]}
        />

        {status === "error" && (
          <ErrorMessage message={error} />
        )}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {/* The doc pins the running readout to the rail footer. Only the
                MP3 encoder reports progress, and only once it starts — the
                decode ahead of it is silent, so stay indeterminate until a
                real number arrives rather than sitting pinned at 0%. */}
            {status === "processing" && (
              <ToolProgress
                phase="CONVERTING"
                percent={outputFormat === "mp3" && progress > 0 ? progress : null}
                label="Converting audio"
              />
            )}
            {result ? (
              <DownloadButton
                blob={result.blob}
                fileName={result.fileName}
                className="w-full justify-center"
              />
            ) : status === "processing" ? (
              // Cancel stops the run and keeps the loaded file; the reset link,
              // which throws it away, is hidden while the run is in flight.
              <ToolActions primaryLabel="Cancel" onPrimary={cancel} />
            ) : (
              <ToolActions primaryLabel="Convert" onPrimary={handleConvert} />
            )}
            {status !== "processing" && (
              <ToolResetLink
                onClick={handleReset}
                label={result ? "CONVERT ANOTHER" : "START OVER"}
              />
            )}
          </>
        }
      >
        {showBitrate && (
          <ToolControlGroup>
            <ToolControl label="BITRATE">
              <ToolChoice
                label="MP3 bitrate"
                fill
                value={bitrate}
                // A new bitrate is a new output — drop the finished one rather
                // than letting the chips describe bytes nobody can download.
                onChange={(b) => {
                  setBitrate(b);
                  if (result) reset();
                }}
                disabled={status === "processing"}
                options={BITRATE_OPTIONS.map((b) => ({ value: b, label: String(b) }))}
              />
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                kbps. 192 is transparent for most music; 320 is the MP3 ceiling.
              </span>
            </ToolControl>
          </ToolControlGroup>
        )}

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Format", outputFormat.toUpperCase()],
              ["In", formatFileSize(file.size)],
              ["Out", result ? formatFileSize(result.newSize) : "—"],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {result
              ? `${formatSizeComparison(file.size, result.newSize)}. Decoded and re-encoded in this tab — the audio never leaves your device.`
              : "Decoded and re-encoded in this tab — the audio never leaves your device."}
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}

/** `m:ss`, matching the doc's waveform end-caps. */
function formatClock(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

/** The same quantity as a sentence, for the aside — where prose belongs. */
function formatSizeComparison(original: number, converted: number): string {
  const diff = original - converted;
  const pct = Math.abs(Math.round((diff / original) * 100));
  if (diff > 0) return `${pct}% smaller than the original`;
  if (diff < 0) return `${pct}% larger than the original`;
  return "Same size as the original";
}
