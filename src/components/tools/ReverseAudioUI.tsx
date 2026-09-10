"use client";

import { useCallback, useRef, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import {
  useFileProcessor,
  type FileProcessorContext,
  type ProcessedResult,
} from "@/hooks/useFileProcessor";
import { audioMeta } from "@/lib/utils/canvas-meta";
import { formatFileSize } from "@/lib/utils/file-helpers";
import {
  ToolActions,
  ToolAdvanced,
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
import { getToolBySlug } from "@/data/tools";
// Leaf types only; the engine stays behind the dynamic import in `processFn`.
import { DEFAULT_MP3_BITRATE, type AudioOutputFormat } from "@/lib/tools/audio-format";

const WAVEFORM_BARS = 90;
const BITRATE_OPTIONS = [128, 192, 256, 320];

const FORMAT_OPTIONS: readonly { value: AudioOutputFormat; label: string }[] = [
  { value: "mp3", label: "MP3" },
  { value: "wav", label: "WAV" },
  { value: "flac", label: "FLAC" },
];

/**
 * What the chosen output costs. Reversing itself changes nothing but the order
 * of the samples — the format is the only place quality is spent, so it is the
 * only place this page talks about quality.
 */
const FORMAT_NOTE: Record<AudioOutputFormat, string> = {
  mp3: "MP3 is lossy. Reversing does not touch the samples, but encoding them to MP3 afterwards does — a lossy source reversed into MP3 has been through two lossy encoders. MP3 also carries at most two channels and 48 kHz, so a surround or hi-res source is folded or resampled on the way out; the run says so when it happens.",
  wav: "WAV stores the reversed samples uncompressed at 16 bits. Nothing is compressed away; a 24-bit source is still reduced to 16-bit on the way out.",
  flac: "FLAC compresses the reversed samples without discarding any of them, at roughly half the size of WAV. This is the choice that costs nothing beyond the decode itself.",
};

const PRACTICAL_LIMIT_NOTE = getToolBySlug("reverse-audio")?.practicalLimitNote;

export function ReverseAudioUI() {
  const [file, setFile] = useState<File | null>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [waveState, setWaveState] = useState<"loading" | "ok" | "failed">("loading");
  const [duration, setDuration] = useState(0);
  const [stream, setStream] = useState<{ sampleRate: number; channels: number } | null>(null);
  const [format, setFormat] = useState<AudioOutputFormat>("mp3");
  const [bitrate, setBitrate] = useState(DEFAULT_MP3_BITRATE);

  // Same stale-decode fence as every other audio surface in this cluster.
  const waveformRunRef = useRef(0);

  const processFn = useCallback(
    async (f: File, _opts: void, ctx: FileProcessorContext): Promise<ProcessedResult> => {
      const { reverseAudio } = await import("@/lib/tools/audio-effects");
      return reverseAudio(f, { format, bitrate }, ctx);
    },
    [format, bitrate],
  );

  const { status, result, error, progress, process, cancel, reset } =
    useFileProcessor<void>(processFn);

  const handleFiles = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      const run = ++waveformRunRef.current;
      setFile(f);
      setPeaks(null);
      setWaveState("loading");
      setDuration(0);
      setStream(null);
      reset();

      computeWaveform(f, WAVEFORM_BARS)
        .then((w) => {
          if (waveformRunRef.current !== run) return;
          setPeaks(w.peaks);
          setDuration(w.duration);
          setStream({ sampleRate: w.sampleRate, channels: w.channels });
          setWaveState("ok");
        })
        .catch(() => {
          if (waveformRunRef.current !== run) return;
          setPeaks(null);
          setWaveState("failed");
        });
    },
    [reset],
  );

  // A new format is a new output; a failed run under the old one must not sit
  // under the new one's label.
  const touch = useCallback(
    <T,>(setter: (v: T) => void) =>
      (v: T) => {
        if (result || error) reset();
        setter(v);
      },
    [result, error, reset],
  );

  const handleRun = useCallback(() => {
    if (!file) return;
    process(file);
  }, [file, process]);

  const handleReset = useCallback(() => {
    waveformRunRef.current += 1;
    setFile(null);
    setPeaks(null);
    setWaveState("loading");
    setDuration(0);
    setStream(null);
    reset();
  }, [reset]);

  if (!file) {
    return (
      <DropZone
        accept=".mp3,.wav,.ogg,.m4a,.flac,.aac,.opus,.wma"
        practicalLimitNote={PRACTICAL_LIMIT_NOTE}
        onFiles={handleFiles}
        label="Upload an audio file to reverse"
      />
    );
  }

  return (
    <>
      {/* ── Canvas ───────────────────────────────────────────── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={audioMeta(
            stream,
            duration ? formatClock(duration) : null,
            formatFileSize(file.size),
          )}
          trailing={result ? "REVERSED" : format.toUpperCase()}
        />

        <CanvasStage className={cn(STAGE_GROW, "flex flex-col")}>
          <div className="absolute inset-x-0 top-1/2 h-px bg-border" aria-hidden="true" />
          {peaks ? (
            /*
              The SOURCE's shape, always — not a preview of the output. Drawing
              the reversed bars would be a picture of a file that does not exist
              until the run finishes, and this tool has nothing to compare
              against afterwards.
            */
            <Waveform peaks={peaks} startPct={0} endPct={100} />
          ) : waveState === "failed" ? (
            <div className="flex h-full min-h-[170px] items-center justify-center px-3.5 text-center font-mono text-[10.5px] leading-none text-text-muted">
              PREVIEW UNAVAILABLE — REVERSING STILL RUNS
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
            {
              label: "LENGTH",
              value: duration ? formatClock(duration) : "—",
              tone: "neutral",
            },
            { label: "FORMAT", value: format.toUpperCase(), tone: "neutral" },
          ]}
        />

        {result?.warnings?.map((warning) => (
          <WarningMessage key={warning} message={warning} />
        ))}

        {status === "error" && <ErrorMessage message={error} />}
      </div>

      {/* ── Controls ─────────────────────────────────────────── */}
      <ToolAside
        footer={
          <>
            {status === "processing" && (
              <ToolProgress
                phase="REVERSING"
                percent={progress > 0 ? progress : null}
                label="Reversing audio"
              />
            )}
            {result ? (
              <DownloadButton
                blob={result.blob}
                fileName={result.fileName}
                className="w-full justify-center"
              />
            ) : status === "processing" ? (
              <ToolActions primaryLabel="Cancel" onPrimary={cancel} />
            ) : (
              <ToolActions primaryLabel="Reverse" onPrimary={handleRun} />
            )}
            {status !== "processing" && (
              <ToolResetLink
                onClick={handleReset}
                label={result ? "REVERSE ANOTHER" : "START OVER"}
              />
            )}
          </>
        }
      >
        <ToolControlGroup>
          <ToolControl label="FORMAT">
            <ToolChoice
              label="Output format"
              fill
              value={format}
              onChange={touch(setFormat)}
              disabled={status === "processing"}
              options={FORMAT_OPTIONS}
            />
          </ToolControl>

          {format === "mp3" && (
            <ToolControl label="BITRATE">
              <ToolChoice
                label="MP3 bitrate"
                fill
                value={bitrate}
                onChange={touch(setBitrate)}
                disabled={status === "processing"}
                options={BITRATE_OPTIONS.map((b) => ({ value: b, label: String(b) }))}
              />
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">kbps</span>
            </ToolControl>
          )}
        </ToolControlGroup>

        {/*
          Engine facts. The reverse itself walks the samples back to front into
          a new buffer of the same shape, so the LENGTH really is unchanged.

          The engine row follows the chosen FORMAT because it has to: the
          reverse is pure Web Audio, but the worker pool has no FLAC encoder, so
          that arm renders a lossless WAV and hands it to `convertAudio` —
          FFmpeg. A flat "WEB AUDIO" over a run that downloads a 31 MB engine
          would be untrue.

          THE CHANNELS ROW FOLLOWS THE FORMAT FOR THE SAME REASON. It used to
          read a flat "UNCHANGED", which is a claim about the reverse being read
          as a claim about the download: MP3 holds two channels and 48 kHz, so a
          96 kHz master really does come back at 48 kHz and a 5.1 mix really
          does come back stereo. When either happens the run raises a warning
          beside the waveform naming both numbers; this row states the ceiling
          before the run so the choice can be made first.
        */}
        <ToolAdvanced
          rows={[
            ["Engine", format === "flac" ? "WEB AUDIO → FFMPEG FLAC" : "WEB AUDIO"],
            ["Length", "UNCHANGED"],
            [
              "Channels & rate",
              format === "mp3" ? "MP3 CEILING: 2 CH, 48 kHz" : "UNCHANGED",
            ],
          ]}
        />

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Format", format.toUpperCase()],
              ["In", formatFileSize(file.size)],
              ["Out", result ? formatFileSize(result.newSize) : "—"],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {FORMAT_NOTE[format]}
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Decoded, reversed and re-encoded in this tab — the audio never leaves your device. Tags
            and cover art do not survive the decode.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Your browser does the decoding where it can. A container it will not read — WMA
            everywhere, AAC and Ogg in some browsers — falls back to the FFmpeg engine, and so does
            FLAC output; that engine is only downloaded if one of those actually happens.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}

/** `m:ss`, matching the waveform end-caps everywhere else in this cluster. */
function formatClock(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
