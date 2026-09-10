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
/*
  Types and the bitrate default come from the LEAF (`audio-format.ts`), not
  from the engine — the same rule `AudioConverterUI` follows and for the same
  reason. `audio-effects.ts` itself stays behind a dynamic import inside
  `processFn` so the FFmpeg loader is not in this page's static graph.
*/
import { DEFAULT_MP3_BITRATE, type AudioOutputFormat } from "@/lib/tools/audio-format";
import type { NormalizeAudioResult, NormalizeTargetKey } from "@/lib/tools/audio-effects";

const WAVEFORM_BARS = 90;
const BITRATE_OPTIONS = [128, 192, 256, 320];

const FORMAT_OPTIONS: readonly { value: AudioOutputFormat; label: string }[] = [
  { value: "mp3", label: "MP3" },
  { value: "wav", label: "WAV" },
  { value: "flac", label: "FLAC" },
];

/**
 * The three targets as this PAGE presents them: a chip word, the number for
 * the stat cell, and the sentence that says what the number means.
 *
 * `lufs` MIRRORS `NORMALIZE_TARGETS[key].I` in `audio-effects.ts`, which is the
 * authority and is pinned by `audio-effects.test.ts`. It is copied rather than
 * imported because importing the const table would pull the whole engine module
 * into this page's static graph and make the dynamic import in `processFn`
 * pointless — the same rule `AudioConverterUI` states for `audio-format.ts`.
 * The mirror is safe in the direction that matters: AFTER a run the stat cell
 * and the analysis rows read `result.target`, the object the filtergraph was
 * actually built from, so any divergence shows itself on the first run rather
 * than living silently in the copy.
 *
 * The only claim here about the world outside this repo (EBU R128 = −23 LUFS)
 * is named as a standard rather than attributed to a service, because a
 * streaming service's playback level is not something this page can verify.
 */
const TARGETS: readonly {
  value: NormalizeTargetKey;
  label: string;
  lufs: number;
  note: string;
}[] = [
  {
    value: "streaming",
    label: "Streaming",
    lufs: -14,
    note: "−14 LUFS with a −1 dBTP ceiling, loudness range 11 LU. The common music-streaming playback level: a master louder than this gets turned down on the way to the listener rather than played louder.",
  },
  {
    value: "podcast",
    label: "Podcast",
    lufs: -16,
    note: "−16 LUFS with a −1.5 dBTP ceiling, loudness range 11 LU. The usual spoken-word delivery level, and a safe default for anything with a voice in it.",
  },
  {
    value: "broadcast",
    label: "Broadcast",
    lufs: -23,
    note: "−23 LUFS with a −2 dBTP ceiling, and the loudness range held to 7 LU. −23 LUFS is the EBU R128 television target; the 7 LU range is this page's choice, not part of the standard.",
  },
];

const TARGET_OPTIONS = TARGETS.map((t) => ({ value: t.value, label: t.label }));

/** As `AudioConverterUI` states them — the same three encoders, same costs. */
const FORMAT_NOTE: Record<AudioOutputFormat, string> = {
  mp3: "MP3 is lossy. The normalised audio is encoded again on the way out, and the encoder throws part of it away to make the file small.",
  wav: "WAV stores the normalised samples uncompressed at 16 bits, so nothing is compressed away — expect a file several times the size of a compressed source.",
  flac: "FLAC compresses the normalised samples without discarding any of them, at roughly half the size of WAV.",
};

const PRACTICAL_LIMIT_NOTE = getToolBySlug("normalize-audio")?.practicalLimitNote;

export function NormalizeAudioUI() {
  const [file, setFile] = useState<File | null>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [waveState, setWaveState] = useState<"loading" | "ok" | "failed">("loading");
  const [duration, setDuration] = useState(0);
  const [stream, setStream] = useState<{ sampleRate: number; channels: number } | null>(null);
  const [target, setTarget] = useState<NormalizeTargetKey>("podcast");
  const [format, setFormat] = useState<AudioOutputFormat>("mp3");
  const [bitrate, setBitrate] = useState(DEFAULT_MP3_BITRATE);

  /*
    THE PREVIEW DECODE IS ASYNCHRONOUS AND CANNOT BE STOPPED — the same fence
    every other audio surface carries (`AudioConverterUI.waveformRunRef`,
    `useFileProcessor.runIdRef`). Without it a discarded file's bars, duration
    and stream facts land on top of the file the user is looking at now.
  */
  const waveformRunRef = useRef(0);

  /*
    `useFileProcessor` is typed on `ProcessedResult`, so `twoPass`, `measured`
    and `sampleRate` — the three things this page exists to report — do not
    survive the hook. They are stashed here as the run resolves and matched back
    by BLOB IDENTITY, which is an exact fence: `result` is only ever the object
    the hook accepted, so a superseded run's detail can never be read as this
    one's. When they do not match the surface shows "—" rather than a stale
    number, which is the direction this repo fails in.
  */
  const detailRef = useRef<{ blob: Blob; detail: NormalizeAudioResult } | null>(null);

  const processFn = useCallback(
    async (f: File, _opts: void, ctx: FileProcessorContext): Promise<ProcessedResult> => {
      const { normalizeAudio } = await import("@/lib/tools/audio-effects");
      const out = await normalizeAudio(f, { target, format, bitrate }, ctx);
      detailRef.current = { blob: out.blob, detail: out };
      return out;
    },
    [target, format, bitrate],
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

      // Decoration only: the normalise runs inside FFmpeg and does not depend
      // on this decode, so a failed preview says the preview failed.
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
    Every setting change drops a finished run AND a failed one. The readouts
    below all follow the live controls, so a result left standing would be
    relabelled with settings it was never produced under — and an error left
    standing would sit beneath a target that was never attempted.
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
        label="Upload an audio file to normalise"
      />
    );
  }

  // Only this run's own detail, never a superseded run's.
  const detail =
    result && detailRef.current?.blob === result.blob ? detailRef.current.detail : null;
  const measured = detail?.measured ?? null;
  const activeTarget = detail?.target ?? null;
  const selected = TARGETS.find((t) => t.value === target) ?? TARGETS[1];

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
            /*
              `computeWaveform` has no FFmpeg fallback by design, so AAC on
              Firefox and WMA anywhere draw nothing — while the normalise
              itself, which runs entirely inside FFmpeg, still works.
            */
            <div className="flex h-full min-h-[170px] items-center justify-center px-3.5 text-center font-mono text-[10.5px] leading-none text-text-muted">
              PREVIEW UNAVAILABLE — NORMALISING STILL RUNS
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
              // The file's own measured loudness, which is the number that
              // makes this page worth using. Blank until a run has measured it.
              label: "IN LUFS",
              value: measured ? `${measured.input_i.toFixed(1)}` : "—",
              tone: "neutral",
            },
            {
              // The engine's own target after a run; this page's mirror before
              // one. See the comment on TARGETS.
              label: "TARGET",
              value: `${activeTarget ? activeTarget.I : selected.lufs} LUFS`,
              tone: "ok",
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
                phase="NORMALISING"
                percent={progress > 0 ? progress : null}
                label="Normalising audio"
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
              <ToolActions primaryLabel="Normalise" onPrimary={handleRun} />
            )}
            {status !== "processing" && (
              <ToolResetLink
                onClick={handleReset}
                label={result ? "NORMALISE ANOTHER" : "START OVER"}
              />
            )}
          </>
        }
      >
        <ToolControlGroup>
          <ToolControl label="TARGET">
            <ToolChoice
              label="Loudness target"
              fill
              value={target}
              onChange={touch(setTarget)}
              disabled={status === "processing"}
              options={TARGET_OPTIONS}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              {selected.note}
            </span>
          </ToolControl>

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
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                kbps. 192 is transparent for most material; 320 is the MP3 ceiling.
              </span>
            </ToolControl>
          )}
        </ToolControlGroup>

        {/*
          WHAT THE RUN ACTUALLY DID — every line here is read off
          `NormalizeAudioResult`, which derives `twoPass` from the argv that
          executed and `normalizationType` from what loudnorm printed in pass 2.
          Nothing on this page asserts either on its own.

          THE GAIN ROW IS NOT THE PASS ROW, and conflating them is what this
          section used to get wrong. Two passes running proves the file was
          measured; it does not prove the measurement was applied as ONE gain.
          `linear=true` is a request loudnorm refuses whenever the linear offset
          would breach the target's true-peak ceiling — measured, that is most
          unmastered speech and music — and it refuses silently, with no log
          line at any level. `print_format=json` on pass 2 is the only way to
          see it, so pass 2 carries it and the answer is printed here. When
          loudnorm reported nothing readable the row says so instead of
          assuming the better of the two.
        */}
        <ToolAsideSection label="ANALYSIS">
          <ToolOutput
            rows={[
              ["Mode", detail ? (detail.twoPass ? "Two passes" : "One pass") : "—"],
              [
                "Gain applied",
                detail
                  ? detail.normalizationType === "linear"
                    ? "One linear gain"
                    : detail.normalizationType === "dynamic"
                      ? "Dynamic — ridden across the file"
                      : "Not reported"
                  : "—",
              ],
              ["Measured", measured ? `${measured.input_i.toFixed(1)} LUFS` : "—"],
              ["True peak in", measured ? `${measured.input_tp.toFixed(1)} dBTP` : "—"],
              ["Range in", measured ? `${measured.input_lra.toFixed(1)} LU` : "—"],
              [
                "Written at",
                detail ? `${(detail.sampleRate / 1000).toFixed(1)} kHz` : "—",
              ],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {detail && detail.twoPass && measured
              ? detail.normalizationType === "linear"
                ? `Analysed in two passes: this file measured ${measured.input_i.toFixed(1)} LUFS, and one measured gain was applied to bring it to ${detail.target.I} LUFS. Loudnorm reported that correction as linear, so the dynamics inside the file were left alone.`
                : detail.normalizationType === "dynamic"
                  ? `Analysed in two passes: this file measured ${measured.input_i.toFixed(1)} LUFS, and loudnorm then reported that it rode the gain across the file rather than applying one. A single gain large enough to reach ${detail.target.I} LUFS would have pushed the true peak past the ${detail.target.TP} dBTP ceiling, so the dynamics were changed and the result lands near the target rather than exactly on it.`
                  : `Analysed in two passes: this file measured ${measured.input_i.toFixed(1)} LUFS and was corrected against that measurement toward ${detail.target.I} LUFS. Loudnorm did not report which of its two gain modes it used on this run, so this page will not name one.`
              : detail
                ? "Normalised in a single pass — see the note beside the waveform for why."
                : "FFmpeg's loudnorm filter measures the whole file first, then re-encodes it against that measurement. It applies one linear gain where the file allows it and rides the gain where a single one would break the true-peak ceiling; it does not announce which, so this page asks it directly and prints the answer. If the measurement comes back unusable — a digitally silent file is the case that does it — the run falls back to loudnorm's one-pass mode and says so here rather than claiming a precision it did not have."}
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            The measuring pass costs about 22 milliseconds per second of audio, so a five-minute
            file spends roughly seven seconds being measured before anything is written.
          </span>
        </ToolAsideSection>

        {/*
          Engine facts, each true of `audio-effects.ts` as written.
          "SOURCE RATE PINNED" is the 192 kHz trap: loudnorm negotiates a
          192 kHz output link, and `-ar` puts it back.

          The MP3 row does NOT say "SOURCE": that arm can only write one of the
          nine rates MPEG layer III defines, and `mp3SafeSampleRate` rounds a
          source that is not one of them UP rather than to the nearest, so a
          37 800 Hz file comes out at 44 100. The warning names both numbers
          when it happens.

          "NOT CARRIED OVER" is true because `-map_metadata -1` is on the argv.
          Without it FFmpeg's default copies every global tag through — measured,
          ID3 title/artist/album/comment all survived `-vn`, which drops an
          attached picture and nothing else.
        */}
        <ToolAdvanced
          rows={[
            ["Filter", "FFMPEG LOUDNORM"],
            [
              "Sample rate",
              format === "mp3" ? "MP3 RATES ONLY, 48 kHz CEILING" : "SOURCE RATE PINNED",
            ],
            ["Tags & cover art", "NOT CARRIED OVER"],
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
            Measured and re-encoded in this tab — the audio never leaves your device.
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
