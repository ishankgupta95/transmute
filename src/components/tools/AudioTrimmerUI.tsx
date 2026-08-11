"use client";

import { useCallback, useRef, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { StatusMessage } from "@/components/tools/StatusMessage";
import { useFileProcessor, type FileProcessorContext } from "@/hooks/useFileProcessor";
import { trimAudio, type AudioTrimOptions } from "@/lib/tools/audio-trim";
import { formatFileSize } from "@/lib/utils/file-helpers";
import {
  ToolActions,
  ToolAdvanced,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
  ToolPresets,
  ToolResetLink,
} from "@/components/tools/ToolAside";

/*
  The doc's presets, constrained to the format/bitrate chips this tool has —
  its "Podcast: mono" and "64 kbps" claims need channel and lower-bitrate
  controls that don't exist, so those presets say only what they set.
*/
const PRESETS = [
  { id: "podcast", label: "Podcast", note: "MP3 at 128 kbps — speech-tuned, small file." },
  { id: "music", label: "Music", note: "MP3 at 320 kbps. No normalisation applied." },
  { id: "lossless", label: "Lossless", note: "WAV — uncompressed, roughly ten times the size." },
  { id: "custom", label: "Custom", note: "Every control unlocked. Nothing is assumed." },
] as const;
import {
  CanvasHeader,
  CanvasStage,
  StatStrip,
  TrimControls,
  Waveform,
  WaveformSkeleton,
} from "@/components/tools/ToolCanvas";
import { TrimOverlay } from "@/components/tools/ToolCanvas";
import { computeWaveform } from "@/lib/tools/media-preview";

/** Bar count the doc's waveform draws at; wide enough to read as a shape. */
const WAVEFORM_BARS = 90;

export function AudioTrimmerUI() {
  const [file, setFile] = useState<File | null>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [duration, setDuration] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [outputFormat, setOutputFormat] = useState<"wav" | "mp3">("mp3");
  const [bitrate, setBitrate] = useState(192);
  const [preset, setPreset] = useState<string>("custom");

  const applyPreset = useCallback((id: string) => {
    setPreset(id);
    if (id === "podcast") {
      setOutputFormat("mp3");
      setBitrate(128);
    } else if (id === "music") {
      setOutputFormat("mp3");
      setBitrate(320);
    } else if (id === "lossless") {
      setOutputFormat("wav");
    }
  }, []);

  // Any hand edit un-lights the preset chip, so what's lit is what runs.
  const touch = useCallback(<T,>(setter: (v: T) => void) => {
    return (v: T) => {
      setPreset("custom");
      setter(v);
    };
  }, []);
  const [loadError, setLoadError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const processFn = useCallback(
    (f: File, opts: AudioTrimOptions, ctx: FileProcessorContext) => trimAudio(f, opts, ctx),
    [],
  );

  const { status, result, error, process, reset } = useFileProcessor(processFn);

  const handleFiles = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      // Revoke any prior URL before allocating a new one.
      setAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(f);
      });
      setFile(f);
      setLoadError(null);
      setDuration(0);
      setPeaks(null);
      reset();

      // Decoration only — a decode failure must not block trimming, which reads
      // duration from the <audio> element independently.
      computeWaveform(f, WAVEFORM_BARS)
        .then((w) => setPeaks(w.peaks))
        .catch(() => setPeaks(null));
    },
    [reset],
  );

  // Read duration from the rendered <audio> via onLoadedMetadata + onError —
  // no separate hidden Audio element to leak.
  const handleAudioLoadedMetadata = useCallback(() => {
    const a = audioRef.current;
    if (!a || !Number.isFinite(a.duration)) return;
    setDuration(a.duration);
    setStartTime(0);
    setEndTime(a.duration);
  }, []);

  const handleAudioError = useCallback(() => {
    setLoadError("Could not read this audio file. Try a different file.");
  }, []);

  const handleTrim = useCallback(() => {
    if (!file) return;
    process(file, { startTime, endTime, outputFormat, bitrate });
  }, [file, process, startTime, endTime, outputFormat, bitrate]);

  const handleReset = useCallback(() => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setFile(null);
    setAudioUrl(null);
    setDuration(0);
    setLoadError(null);
    reset();
  }, [audioUrl, reset]);

  if (!file) {
    return (
      <DropZone
        accept=".mp3,.wav,.ogg,.m4a,.flac,.aac"
        onFiles={handleFiles}
        label="Upload an audio file to trim"
      />
    );
  }

  // The overlay and the bar colouring work in percentages of the clip.
  const startPct = duration ? (startTime / duration) * 100 : 0;
  const endPct = duration ? (endTime / duration) * 100 : 100;

  return (
    <>
      {/* ── Canvas: the waveform, with the selection cut into it ─ */}
      <div className="min-w-0 space-y-[15px]">
        {/* No trailing stat — `TrimControls` already carries the SEL readout. */}
        <CanvasHeader
          file={file.name}
          meta={`${formatFileSize(file.size)} · ${formatTime(duration)}`}
        />

        <CanvasStage>
          <div className="absolute inset-x-0 top-1/2 h-px bg-border" aria-hidden="true" />
          {peaks ? (
            <Waveform peaks={peaks} startPct={startPct} endPct={endPct} />
          ) : (
            <WaveformSkeleton />
          )}
          <TrimOverlay trimA={startPct} trimB={endPct} />
          <span className="absolute bottom-2.5 left-3.5 font-mono text-[9.5px] leading-none text-text-muted">
            {formatTime(0)}
          </span>
          <span className="absolute right-3.5 bottom-2.5 font-mono text-[9.5px] leading-none text-text-muted">
            {formatTime(duration)}
          </span>
        </CanvasStage>

        <TrimControls
          start={startTime}
          end={endTime}
          duration={duration}
          onStartChange={setStartTime}
          onEndChange={setEndTime}
          format={formatTime}
          summaryLabel="SEL"
          startName="Selection start"
          endName="Selection end"
          disabled={status === "processing"}
        />

        {audioUrl && (
          <audio
            ref={audioRef}
            src={audioUrl}
            controls
            onLoadedMetadata={handleAudioLoadedMetadata}
            onError={handleAudioError}
            aria-label={`Preview ${file.name}`}
            className="h-10 w-full"
          />
        )}

        {loadError && <ErrorMessage message={loadError} />}

        {status === "processing" && (
          <div className="space-y-2">
            <ProgressBar progress={null} label="Trimming audio" />
            <StatusMessage>Trimming...</StatusMessage>
          </div>
        )}

        {status === "error" && error && <ErrorMessage message={error} />}

        <StatStrip
          stats={[
            { label: "IN", value: formatFileSize(file.size), tone: "neutral" },
            { label: "OUT", value: result ? formatFileSize(result.newSize) : "—" },
            { label: "SEL", value: formatTime(Math.max(0, endTime - startTime)), tone: "ok" },
            { label: "FORMAT", value: outputFormat.toUpperCase(), tone: "neutral" },
          ]}
        />
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
                primaryLabel={status === "processing" ? "Trimming…" : "Trim"}
                onPrimary={handleTrim}
                primaryDisabled={loadError !== null || status === "processing"}
              />
            )}
            <ToolResetLink onClick={handleReset} label={result ? "TRIM ANOTHER" : "CANCEL"} />
          </>
        }
      >
        <ToolPresets
          presets={PRESETS}
          active={preset}
          onSelect={applyPreset}
          disabled={status === "processing"}
        />

        <ToolAsideSection label="FORMAT">
          <ToolChoice
            label="Output format"
            fill
            value={outputFormat}
            onChange={touch(setOutputFormat)}
            disabled={status === "processing"}
            options={[
              { value: "mp3" as const, label: "MP3" },
              { value: "wav" as const, label: "WAV" },
            ]}
          />
        </ToolAsideSection>

        {outputFormat === "mp3" && (
          <ToolAsideSection label="BITRATE">
            <ToolChoice
              label="MP3 bitrate"
              fill
              value={bitrate}
              onChange={touch(setBitrate)}
              disabled={status === "processing"}
              options={[128, 192, 256, 320].map((b) => ({ value: b, label: String(b) }))}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              kbps
            </span>
          </ToolAsideSection>
        )}

        {/* Engine facts — true of audio-trim.ts + the WAV/MP3 encoders. */}
        <ToolAdvanced
          rows={[
            ["Precision", "SAMPLE-ACCURATE"],
            ["WAV channels", "PRESERVED"],
            ["MP3 surround", "FOLDED TO STEREO −3 dB"],
          ]}
        />

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Selected", formatTime(Math.max(0, endTime - startTime))],
              ["Format", outputFormat.toUpperCase()],
              ["Trimmed", result ? formatFileSize(result.newSize) : "—"],
            ]}
          />
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins}:${String(secs).padStart(2, "0")}.${ms}`;
}
