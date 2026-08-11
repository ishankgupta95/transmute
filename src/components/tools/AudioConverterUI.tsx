"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import {
  useFileProcessor,
  type FileProcessorContext,
  type ProcessedResult,
} from "@/hooks/useFileProcessor";
import { formatFileSize } from "@/lib/utils/file-helpers";
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
  StatStrip,
  Waveform,
  WaveformSkeleton,
} from "@/components/tools/ToolCanvas";
import { computeWaveform } from "@/lib/tools/media-preview";

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
  const [duration, setDuration] = useState(0);
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
  const { status, result, error, process, reset } = useFileProcessor<void>(processFn);

  const handleFiles = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      setFile(f);
      setPeaks(null);
      setDuration(0);
      reset();

      // Decoration only — a decode failure leaves the skeleton and the
      // conversion, which decodes independently, is unaffected.
      computeWaveform(f, WAVEFORM_BARS)
        .then((w) => {
          setPeaks(w.peaks);
          setDuration(w.duration);
        })
        .catch(() => setPeaks(null));
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
    setDuration(0);
    reset();
  }, [reset]);

  if (!file) {
    return <DropZone accept={acceptFormats} onFiles={handleFiles} />;
  }

  const showBitrate = showBitrateSelector && outputFormat === "mp3";

  return (
    <>
      {/* ── Canvas: the doc's waveform stage ─────────────────── */}
      <div className="min-w-0 space-y-[15px]">
        <CanvasHeader
          file={file.name}
          meta={`${formatFileSize(file.size)}${duration ? ` · ${formatClock(duration)}` : ""}`}
          trailing={outputFormat.toUpperCase()}
        />

        <CanvasStage>
          <div className="absolute inset-x-0 top-1/2 h-px bg-border" aria-hidden="true" />
          {peaks ? (
            <Waveform peaks={peaks} startPct={0} endPct={100} />
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
            {
              label: "DELTA",
              value: result ? formatSizeComparison(file.size, result.newSize) : "—",
              tone: "ok",
            },
            { label: "FORMAT", value: outputFormat.toUpperCase(), tone: "neutral" },
          ]}
        />

        {status === "processing" && (
          <div className="space-y-2">
            <ProgressBar progress={null} />
            <p className="text-sm text-text-muted text-center">Converting...</p>
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
            ) : (
              <ToolActions
                primaryLabel={status === "processing" ? "Converting…" : "Convert"}
                onPrimary={handleConvert}
                primaryDisabled={status === "processing"}
              />
            )}
            <ToolResetLink
              onClick={handleReset}
              label={result ? "CONVERT ANOTHER" : "CANCEL"}
            />
          </>
        }
      >
        {showBitrate && (
          <ToolAsideSection label="BITRATE">
            <ToolChoice
              label="MP3 bitrate"
              fill
              value={bitrate}
              onChange={setBitrate}
              disabled={status === "processing"}
              options={BITRATE_OPTIONS.map((b) => ({ value: b, label: String(b) }))}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              kbps. 192 is transparent for most music; 320 is the MP3 ceiling.
            </span>
          </ToolAsideSection>
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
            Decoded and re-encoded in this tab — the audio never leaves your device.
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

function formatSizeComparison(original: number, converted: number): string {
  const diff = original - converted;
  const pct = Math.abs(Math.round((diff / original) * 100));
  if (diff > 0) return `${pct}% smaller than the original`;
  if (diff < 0) return `${pct}% larger than the original`;
  return "Same size as the original";
}
