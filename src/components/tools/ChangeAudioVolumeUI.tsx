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
import type { ChangeVolumeResult } from "@/lib/tools/audio-effects";

const WAVEFORM_BARS = 90;
const BITRATE_OPTIONS = [128, 192, 256, 320];

const FORMAT_OPTIONS: readonly { value: AudioOutputFormat; label: string }[] = [
  { value: "mp3", label: "MP3" },
  { value: "wav", label: "WAV" },
  { value: "flac", label: "FLAC" },
];

const PRACTICAL_LIMIT_NOTE = getToolBySlug("change-audio-volume")?.practicalLimitNote;

export function ChangeAudioVolumeUI() {
  const [file, setFile] = useState<File | null>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [waveState, setWaveState] = useState<"loading" | "ok" | "failed">("loading");
  const [duration, setDuration] = useState(0);
  const [stream, setStream] = useState<{ sampleRate: number; channels: number } | null>(null);
  const [gainDb, setGainDb] = useState(0);
  const [format, setFormat] = useState<AudioOutputFormat>("mp3");
  const [bitrate, setBitrate] = useState(DEFAULT_MP3_BITRATE);

  // Same stale-decode fence as every other audio surface in this cluster.
  const waveformRunRef = useRef(0);

  /*
    `clipped` and the two peaks are the point of this page and do not survive
    `ProcessedResult`. Stashed and matched back by blob identity, so a
    superseded run's peak can never be printed under this run's gain.
  */
  const detailRef = useRef<{ blob: Blob; detail: ChangeVolumeResult } | null>(null);

  const processFn = useCallback(
    async (f: File, _opts: void, ctx: FileProcessorContext): Promise<ProcessedResult> => {
      const { changeAudioVolume } = await import("@/lib/tools/audio-effects");
      const out = await changeAudioVolume(f, { gainDb, format, bitrate }, ctx);
      detailRef.current = { blob: out.blob, detail: out };
      return out;
    },
    [gainDb, format, bitrate],
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

  /*
    Every control drops a finished run AND a failed one. It matters more here
    than anywhere else in the cluster: the CLIPPING warning is a statement about
    ONE gain, and leaving it up while the slider moves would put a measured
    "+6 dB clips this file" under a −3 dB setting.
  */
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
        label="Upload an audio file to change the volume of"
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
          trailing={formatGain(gainDb)}
        />

        <CanvasStage className={cn(STAGE_GROW, "flex flex-col")}>
          <div className="absolute inset-x-0 top-1/2 h-px bg-border" aria-hidden="true" />
          {peaks ? (
            /*
              The bars are NORMALISED — `computeWaveform` scales the loudest one
              to 1 — so they show the shape of the file and cannot show its
              absolute level. That is exactly why the clipping answer only
              appears after a run: nothing on this canvas knows the real peak
              until the engine has decoded and measured it.
            */
            <Waveform peaks={peaks} startPct={0} endPct={100} />
          ) : waveState === "failed" ? (
            <div className="flex h-full min-h-[170px] items-center justify-center px-3.5 text-center font-mono text-[10.5px] leading-none text-text-muted">
              PREVIEW UNAVAILABLE — THE GAIN STILL RUNS
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
            { label: "GAIN", value: formatGain(gainDb), tone: "neutral" },
            {
              // Green is a claim: it says the peak fits. A clipped run turns
              // this cell to the accent colour instead of colouring a failure
              // as a success.
              label: "PEAK OUT",
              value: detail ? formatDbfs(detail.peakAfter) : "—",
              tone: !detail || !detail.clipped ? "ok" : "accent",
            },
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
                phase="APPLYING"
                percent={progress > 0 ? progress : null}
                label="Changing volume"
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
              <ToolActions
                primaryLabel="Apply"
                onPrimary={handleRun}
                // 0 dB is exactly the identity gain, so a run at 0 would decode
                // and re-encode the file to produce the same audio at a
                // different quality. Nothing here should charge for that.
                primaryDisabled={gainDb === 0}
              />
            )}
            {status !== "processing" && (
              <ToolResetLink
                onClick={handleReset}
                label={result ? "ADJUST ANOTHER" : "START OVER"}
              />
            )}
          </>
        }
      >
        <ToolControlGroup>
          <ToolSlider
            label="Volume"
            display={formatGain(gainDb)}
            hint="Every sample is multiplied by this. +6 dB is roughly twice the amplitude, −6 dB roughly half. Nothing is limited or compressed on the way — if the loudest peak ends up above full scale, the download says so."
            min={-30}
            max={30}
            step={0.5}
            value={gainDb}
            onChange={touch(setGainDb)}
            disabled={status === "processing"}
          />

          {/* Why the button below is off, said where the control that turns it
              on lives. A disabled primary with no explanation is a dead end. */}
          {gainDb === 0 && (
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              At 0 dB the gain is exactly 1, so a run would decode your file and encode it again to
              produce the same audio at whatever the output format costs. Move the slider to turn
              Apply on.
            </span>
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
          Engine facts, each true of `changeAudioVolume` as written: one
          multiply per sample and no limiter.

          THE ENGINE ROW IS NOT A FLAT "WEB AUDIO", and that matters. The gain
          itself never touches FFmpeg, but the audio worker pool has exactly two
          encoders (the LAME MP3 build and the WAV writer), so a FLAC output is rendered
          to a lossless WAV and handed to `convertAudio`, which encodes it with
          FFmpeg. Saying "WEB AUDIO" over a run that downloads a 31 MB engine
          would be the kind of quiet inaccuracy this page is otherwise careful
          about.

          AND NEITHER IS THE CHANNELS ROW, for exactly the same reason. It used
          to read a flat "UNCHANGED", which is true of the gain and true of the
          WAV and FLAC arms — and false of the DEFAULT one, because MP3 holds two
          channels and 48 kHz. A 96 kHz master came back at 48 kHz and a 5.1 mix
          came back stereo while this row said nothing had moved. Before a run it
          states the ceiling; after one it reports what the run actually wrote.
        */}
        <ToolAdvanced
          rows={[
            ["Engine", format === "flac" ? "WEB AUDIO → FFMPEG FLAC" : "WEB AUDIO"],
            ["Limiter", "NONE — CLIPPING REPORTED"],
            [
              "Channels & rate",
              detail
                ? detail.channels === detail.sourceChannels &&
                  detail.sampleRate === detail.sourceSampleRate
                  ? "UNCHANGED"
                  : `${detail.sourceChannels} CH ${formatKHz(detail.sourceSampleRate)} → ${detail.channels} CH ${formatKHz(detail.sampleRate)}`
                : format === "mp3"
                  ? "MP3 CEILING: 2 CH, 48 kHz"
                  : "UNCHANGED",
            ],
          ]}
        />

        {/*
          "Peak out" is the peak of the FILE THAT WAS WRITTEN, measured on the
          samples the encoder was handed. That distinction is not pedantry: on
          the MP3 arm a wider-than-stereo source is summed into L/R, and if the
          sum crosses unity the whole mix is divided by its own peak. Measuring
          before that step printed a number the download did not have, under a
          "Clipping: No" that was reporting on samples nobody received.
          `Clipping` is the other half of the pair — the peak the GAIN produced,
          which is what could not be stored — so the two rows differ exactly
          when something was done to make the file fit.
        */}
        <ToolAsideSection label="LEVEL">
          <ToolOutput
            rows={[
              ["Peak in", detail ? formatDbfs(detail.peakBefore) : "—"],
              ["Peak out", detail ? formatDbfs(detail.peakAfter) : "—"],
              ["Clipping", detail ? (detail.clipped ? "Yes" : "No") : "—"],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {detail && detail.foldedToStereo
              ? `MP3 holds two channels, so the ${detail.sourceChannels} channels were summed into stereo before encoding${detail.foldScale < 1 ? " and the sum was scaled down to fit — the warning above has the numbers, and that scaling is not part of the gain you set" : ""}. Peak out is the peak of the file you download. Export WAV or FLAC to get the gain exactly, with every channel intact.`
              : detail && detail.clipped
                ? "The peaks above full scale cannot be stored. Lower the gain by the amount shown in the warning and run it again."
                : detail
                  ? "The loudest peak still fits under full scale, so nothing was flattened."
                  : "The peak is measured from the decoded file, which is why it appears only after a run — the waveform above is normalised and cannot tell you the absolute level."}
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Format", format.toUpperCase()],
              ["In", formatFileSize(file.size)],
              ["Out", result ? formatFileSize(result.newSize) : "—"],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Decoded, scaled and re-encoded in this tab — the audio never leaves your device. Tags
            and cover art do not survive the decode.
          </span>
          {/* Stated where the format is chosen, not only after a run has
              already spent the file on it. */}
          {format === "mp3" && (
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              MP3 carries at most two channels and 48 kHz. A surround source is summed into stereo
              and a source above 48 kHz is resampled down — both are reported when they happen, and
              WAV or FLAC keeps every channel at the source rate.
            </span>
          )}
          {/* Two paths reach FFmpeg, and neither is obvious from the chips:
              `decodeAudioFile`'s fallback for containers the browser refuses,
              and the FLAC encoder, which the worker pool does not have. */}
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

/** `+6.0 dB` / `−3.5 dB` / `0 dB`, with a real minus sign. */
function formatGain(db: number): string {
  if (db === 0) return "0 dB";
  return `${db > 0 ? "+" : "−"}${Math.abs(db).toFixed(1)} dB`;
}

/**
 * A 0..∞ linear amplitude as dBFS. Mirrors the engine's own formatter so the
 * cell and the warning cannot disagree about the same number.
 */
function formatDbfs(amplitude: number): string {
  if (!(amplitude > 0)) return "−inf";
  return `${(20 * Math.log10(amplitude)).toFixed(1)} dBFS`;
}

/** `44.1 kHz`, for the engine-facts row that compares two of them. */
function formatKHz(sampleRate: number): string {
  return `${(sampleRate / 1000).toFixed(1)} kHz`;
}

/** `m:ss`, matching the waveform end-caps everywhere else in this cluster. */
function formatClock(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
