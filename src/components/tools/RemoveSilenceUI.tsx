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
  ToolSlider,
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
import type { RemoveSilenceResult } from "@/lib/tools/audio-effects";

const WAVEFORM_BARS = 90;
const BITRATE_OPTIONS = [128, 192, 256, 320];

const FORMAT_OPTIONS: readonly { value: AudioOutputFormat; label: string }[] = [
  { value: "mp3", label: "MP3" },
  { value: "wav", label: "WAV" },
  { value: "flac", label: "FLAC" },
];

type SilenceMode = "ends" | "all";

/**
 * What each mode does, written from the FILTERGRAPH `silenceRemoveFilter`
 * builds — not from the chip's name.
 *
 * Both sentences carry the measurement that produced them: a 5.500 s fixture
 * of silence · tone · silence · tone · silence came out at 3.50 s under "ends"
 * and 2.04 s under "every gap".
 */
const MODE_NOTE: Record<SilenceMode, string> = {
  ends: "Trims the quiet run at the start and the quiet run at the end. Everything between them is left exactly as it was, pauses included — this is the mode for tidying a recording without changing its pacing.",
  all: "Removes every quiet stretch longer than the minimum gap, wherever it falls. This shortens the file and changes its rhythm: pauses between sentences close up, which is what you want for a rough cut and not what you want for music.",
};

const PRACTICAL_LIMIT_NOTE = getToolBySlug("remove-silence")?.practicalLimitNote;

export function RemoveSilenceUI() {
  const [file, setFile] = useState<File | null>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [waveState, setWaveState] = useState<"loading" | "ok" | "failed">("loading");
  const [duration, setDuration] = useState(0);
  const [stream, setStream] = useState<{ sampleRate: number; channels: number } | null>(null);
  const [mode, setMode] = useState<SilenceMode>("ends");
  const [thresholdDb, setThresholdDb] = useState(-50);
  const [minGapSeconds, setMinGapSeconds] = useState(0.5);
  const [format, setFormat] = useState<AudioOutputFormat>("mp3");
  const [bitrate, setBitrate] = useState(DEFAULT_MP3_BITRATE);

  // Same stale-decode fence as every other audio surface in this cluster.
  const waveformRunRef = useRef(0);

  /*
    The three durations do not survive `useFileProcessor`'s `ProcessedResult`
    typing, so they are stashed and matched back by blob identity — an exact
    fence, and one that shows "—" rather than a stale number if a superseded
    run ever wins the race.
  */
  const detailRef = useRef<{ blob: Blob; detail: RemoveSilenceResult } | null>(null);

  const processFn = useCallback(
    async (f: File, _opts: void, ctx: FileProcessorContext): Promise<ProcessedResult> => {
      const { removeSilence } = await import("@/lib/tools/audio-effects");
      const out = await removeSilence(
        f,
        { mode, thresholdDb, minGapSeconds, format, bitrate },
        ctx,
      );
      detailRef.current = { blob: out.blob, detail: out };
      return out;
    },
    [mode, thresholdDb, minGapSeconds, format, bitrate],
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

  // Any setting change drops a finished run AND a failed one — the durations
  // and the mode note below all follow the live controls.
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
    detailRef.current = null;
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
        label="Upload an audio file to trim silence from"
      />
    );
  }

  const detail =
    result && detailRef.current?.blob === result.blob ? detailRef.current.detail : null;

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
          trailing={format.toUpperCase()}
        />

        <CanvasStage className={cn(STAGE_GROW, "flex flex-col")}>
          <div className="absolute inset-x-0 top-1/2 h-px bg-border" aria-hidden="true" />
          {peaks ? (
            <Waveform peaks={peaks} startPct={0} endPct={100} />
          ) : waveState === "failed" ? (
            <div className="flex h-full min-h-[170px] items-center justify-center px-3.5 text-center font-mono text-[10.5px] leading-none text-text-muted">
              PREVIEW UNAVAILABLE — TRIMMING STILL RUNS
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
            {
              label: "WAS",
              value: detail ? `${detail.originalSeconds.toFixed(1)}s` : "—",
              tone: "neutral",
            },
            { label: "NOW", value: detail ? `${detail.newSeconds.toFixed(1)}s` : "—" },
            {
              // Green is a claim, and here it is only true when something was
              // actually cut. Zero stays neutral rather than reading as a win.
              label: "REMOVED",
              value: detail ? `${detail.removedSeconds.toFixed(1)}s` : "—",
              tone: detail && detail.removedSeconds > 0 ? "ok" : "neutral",
            },
            { label: "OUT", value: result ? formatFileSize(result.newSize) : "—" },
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
                phase="TRIMMING"
                percent={progress > 0 ? progress : null}
                label="Removing silence"
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
              <ToolActions primaryLabel="Remove silence" onPrimary={handleRun} />
            )}
            {status !== "processing" && (
              <ToolResetLink
                onClick={handleReset}
                label={result ? "TRIM ANOTHER" : "START OVER"}
              />
            )}
          </>
        }
      >
        <ToolControlGroup>
          <ToolControl label="WHAT TO CUT">
            <ToolChoice
              label="Which silence to remove"
              fill
              value={mode}
              onChange={touch(setMode)}
              disabled={status === "processing"}
              options={[
                { value: "ends" as const, label: "Ends only" },
                { value: "all" as const, label: "Every gap" },
              ]}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              {MODE_NOTE[mode]}
            </span>
          </ToolControl>

          <ToolSlider
            label="Silence below"
            display={`${thresholdDb} dB`}
            hint="How quiet a stretch has to be to count as silence. −50 dB catches room tone; go nearer 0 to catch quiet speech and breath as well, which also risks cutting into the words."
            min={-70}
            max={-20}
            step={5}
            value={thresholdDb}
            onChange={touch(setThresholdDb)}
            disabled={status === "processing"}
          />

          {mode === "all" && (
            <ToolSlider
              label="Minimum gap"
              display={`${minGapSeconds.toFixed(1)} s`}
              hint="A quiet stretch shorter than this is left alone. Below about 0.3 s you start closing the pauses between words rather than between sentences."
              min={0.1}
              max={3}
              step={0.1}
              value={minGapSeconds}
              onChange={touch(setMinGapSeconds)}
              disabled={status === "processing"}
            />
          )}

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
          Engine facts. "SOURCE RATE KEPT" is measured, not assumed:
          `silenceremove` was run at 44 100 Hz and came out at 44 100 Hz, which
          is why `audio-effects.ts` deliberately does NOT pass `-ar` here the
          way the loudnorm arm has to.
        */}
        <ToolAdvanced
          rows={[
            ["Filter", "FFMPEG SILENCEREMOVE"],
            ["Sample rate", format === "mp3" ? "SOURCE, MP3 CEILING 48 kHz" : "SOURCE RATE KEPT"],
            ["Tags & cover art", "NOT CARRIED OVER"],
          ]}
        />

        <ToolAsideSection label="RESULT">
          <ToolOutput
            rows={[
              ["Was", detail ? `${detail.originalSeconds.toFixed(1)} s` : "—"],
              ["Now", detail ? `${detail.newSeconds.toFixed(1)} s` : "—"],
              ["Removed", detail ? `${detail.removedSeconds.toFixed(1)} s` : "—"],
              ["Out", result ? formatFileSize(result.newSize) : "—"],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {detail && detail.removedSeconds > 0
              ? `${detail.originalSeconds.toFixed(1)} s in, ${detail.newSeconds.toFixed(1)} s out — ${detail.removedSeconds.toFixed(1)} s of silence gone.`
              : "The three durations are FFmpeg's own report of what it read and what it wrote. They carry its hundredth-of-a-second resolution, so treat them as accurate to about a twentieth of a second, not to the millisecond."}
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Trimmed and re-encoded in this tab — the audio never leaves your device.
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
