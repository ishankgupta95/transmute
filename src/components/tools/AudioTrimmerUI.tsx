"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { useFileProcessor, type FileProcessorContext } from "@/hooks/useFileProcessor";
import { trimAudio, type AudioTrimOptions } from "@/lib/tools/audio-trim";
import { audioMeta } from "@/lib/utils/canvas-meta";
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
import { ToolControl, ToolControlGroup, ToolProgress } from "@/components/tools/ToolControls";

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
import { CANVAS_COLUMN, STAGE_GROW } from "@/components/workspace/shared";
import { cn } from "@/lib/utils/cn";

/** Bar count the doc's waveform draws at; wide enough to read as a shape. */
const WAVEFORM_BARS = 90;

export function AudioTrimmerUI() {
  const [file, setFile] = useState<File | null>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  /*
    Stream facts off the same decode that draws the bars — the doc's header
    reads "48 kHz · STEREO · 11:30 · 126 MB", and nothing else in this tool
    can learn the rate or the channel count without decoding a second time.
  */
  const [stream, setStream] = useState<{ sampleRate: number; channels: number } | null>(null);
  const [duration, setDuration] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [outputFormat, setOutputFormat] = useState<"wav" | "mp3">("mp3");
  const [bitrate, setBitrate] = useState(192);
  const [preset, setPreset] = useState<string>("custom");

  const [loadError, setLoadError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  /*
    The URL currently handed to <audio>, mirrored in a ref so the unmount
    cleanup below can revoke it without the effect re-running (and revoking a
    live URL) every time the file is swapped. Without this the last blob stays
    pinned for the life of the document — a routine leak in /workspace, which
    mounts and unmounts these tools as the user switches between them.
  */
  const audioUrlRef = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    },
    [],
  );

  /*
    The decoded duration, once `computeWaveform` has produced one. It is the
    real length of the audio; `<audio>.duration` is an estimate that overshoots
    on VBR MP3 and M4A, which drew a timeline with a phantom tail the trim
    engine then rejected as an empty range.
  */
  const decodedDurationRef = useRef<number | null>(null);

  const processFn = useCallback(
    (f: File, opts: AudioTrimOptions, ctx: FileProcessorContext) => trimAudio(f, opts, ctx),
    [],
  );

  const { status, result, error, progress, process, cancel, reset } =
    useFileProcessor(processFn);

  /*
    Any hand edit un-lights the preset chip, so what's lit is what runs — and
    invalidates a finished trim, so the controls can never describe an output
    the download does not contain. Guarded on `result` so a slider drag is not
    calling reset() on every tick. Declared below the hook: `reset` is in the
    dependency list.
  */
  const touch = useCallback(
    <T,>(setter: (v: T) => void) =>
      (v: T) => {
        setPreset("custom");
        if (result) reset();
        setter(v);
      },
    [result, reset],
  );

  const applyPreset = useCallback(
    (id: string) => {
      if (result) reset();
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
    },
    [result, reset],
  );

  const handleFiles = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      // Revoke any prior URL before allocating a new one.
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      const url = URL.createObjectURL(f);
      audioUrlRef.current = url;
      setAudioUrl(url);
      setFile(f);
      setLoadError(null);
      setDuration(0);
      decodedDurationRef.current = null;
      setPeaks(null);
      setStream(null);
      reset();

      /*
        The decode is the authority on both the shape and the length of the
        clip. It draws the bars, and — since it is the same decode `trimAudio`
        performs — it is the ruler the bars are actually drawn against. The
        handles are only nudged back inside the real range, never reset: the
        user may already have set them before this resolves.
      */
      computeWaveform(f, WAVEFORM_BARS)
        .then((w) => {
          setPeaks(w.peaks);
          setStream({ sampleRate: w.sampleRate, channels: w.channels });
          if (!Number.isFinite(w.duration) || w.duration <= 0) return;
          decodedDurationRef.current = w.duration;
          setDuration(w.duration);
          setStartTime((s) => Math.min(s, w.duration));
          setEndTime((e) => (e === 0 || e > w.duration ? w.duration : e));
        })
        .catch(() => setPeaks(null));
    },
    [reset],
  );

  // The <audio> element's duration is the fallback ruler, used only when the
  // decode produced none (m4a in Firefox, where computeWaveform has no FFmpeg
  // path). Its estimate overshoots on VBR, so the decode always wins.
  const handleAudioLoadedMetadata = useCallback(() => {
    const a = audioRef.current;
    if (!a || !Number.isFinite(a.duration)) return;
    if (decodedDurationRef.current !== null) return;
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
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
    setFile(null);
    setAudioUrl(null);
    setDuration(0);
    decodedDurationRef.current = null;
    setLoadError(null);
    setStream(null);
    reset();
  }, [reset]);

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
      <div className={CANVAS_COLUMN}>
        {/* No trailing stat — `TrimControls` already carries the SEL readout. */}
        <CanvasHeader
          file={file.name}
          meta={audioMeta(
            stream,
            duration ? formatTime(duration) : null,
            formatFileSize(file.size),
          )}
        />

        {/* The one growing stage in this column: the waveform is the tool, so
            it takes the height the column has spare (Waveform itself is
            `h-full min-h-[170px]`). */}
        <CanvasStage className={cn(STAGE_GROW, "flex flex-col")}>
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
          // Moving a handle changes what a re-run would produce, so a finished
          // trim of the old selection stops being offered.
          onStartChange={(v) => {
            if (result) reset();
            setStartTime(v);
          }}
          onEndChange={(v) => {
            if (result) reset();
            setEndTime(v);
          }}
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
            {/* The doc pins the running readout to the rail footer, above the
                button that started it. The MP3 encoder reports real frame
                progress; the decode ahead of it reports nothing and WAV
                reports nothing at all, so those stay indeterminate rather
                than sitting pinned at 0%. */}
            {status === "processing" && (
              <ToolProgress
                phase="TRIMMING"
                percent={outputFormat === "mp3" && progress > 0 ? progress : null}
                label="Trimming audio"
              />
            )}
            {result ? (
              <DownloadButton
                blob={result.blob}
                fileName={result.fileName}
                className="w-full justify-center"
              />
            ) : status === "processing" ? (
              // Cancel stops the run and keeps the file and the selection. The
              // reset link, which throws both away, is hidden while it runs —
              // nothing labelled Cancel should destroy the input.
              <ToolActions primaryLabel="Cancel" onPrimary={cancel} />
            ) : (
              <ToolActions
                primaryLabel="Trim"
                onPrimary={handleTrim}
                primaryDisabled={loadError !== null}
              />
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
        <ToolPresets
          presets={PRESETS}
          active={preset}
          onSelect={applyPreset}
          disabled={status === "processing"}
        />

        <ToolControlGroup>
          <ToolControl label="FORMAT">
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
          </ToolControl>

          {outputFormat === "mp3" && (
            <ToolControl label="BITRATE">
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
            </ToolControl>
          )}
        </ToolControlGroup>

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
