"use client";

import { useCallback, useRef, useState } from "react";
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
/*
  The types and the bitrate default come from the LEAF (`audio-format.ts`), not
  from `audio-convert.ts` which re-exports them: `audio-convert` reaches
  `decodeAudioFile`, and a static edge to it from a component is what
  `size-claims.test.ts` walks. This page decodes either way — but the rule is
  the leaf's, and `ExtractAudioUI` next door genuinely cannot afford the edge.
  The engine itself stays behind a dynamic import inside `processFn`.
*/
import { DEFAULT_MP3_BITRATE, type AudioOutputFormat } from "@/lib/tools/audio-format";

/*
  ONE component, every audio format pair.

  The output format used to be a LITERAL in the client wrapper — `mp3-to-wav`
  passed "wav", `wav-to-mp3` and `m4a-to-mp3` passed "mp3" — which made the
  last two byte-identical wrappers and meant the only way to add a format pair
  was to add another one. It now comes off the registry entry, through
  `AudioToolClients`, as a SEED for a control the user can still change: the
  same seam `PdfToJpgUI` (`defaultFormat`) and `ImageConverterUI`
  (`targetFormat`) already use.

  Nothing here is lossless. Every path decodes the file to PCM and encodes it
  again, so the QUALITY section states what the chosen format costs, and adds a
  second sentence when the SOURCE is one we can see is already lossy — that is
  read off the loaded file, never off the page, so the same page says different
  things about a .ogg and a .wav.
*/

/** The chips, in the order the rail draws them. */
const FORMAT_OPTIONS: readonly { value: AudioOutputFormat; label: string }[] = [
  { value: "mp3", label: "MP3" },
  { value: "wav", label: "WAV" },
  { value: "flac", label: "FLAC" },
];

/**
 * What the CHOSEN output format costs. Written for the format the user has
 * actually picked, not for the page's title — `mp3-converter` and `wav-to-flac`
 * mount the same component and must not share a sentence.
 *
 * THE WAV SENTENCE NAMES THE BIT DEPTH BECAUSE THE WRITER HAS ONLY ONE. It used
 * to say "this step discards nothing", which is false: the engine behind this
 * chip is `encodePcmToWav`, hard-wired to `BYTES_PER_SAMPLE = 2`
 * (`audio-pcm.ts`), so a 24-bit or 32-bit-float source is quantised to 16 bits
 * per sample — and the file comes back SMALLER, which the DELTA cell then
 * paints green. Uncompressed is not the same claim as lossless, and this is the
 * one arm of the three where the two come apart: the FLAC arm hands the whole
 * file to FFmpeg and keeps the source depth. Either the writer grows a depth or
 * the copy names the one it has; the copy names it.
 */
const QUALITY_NOTE: Record<AudioOutputFormat, string> = {
  mp3: "MP3 is a lossy format. This run decodes your file and encodes it again, and the encoder throws part of the sound away to make it small — a higher bitrate throws away less, but no bitrate makes it lossless.",
  wav: "WAV stores the decoded samples uncompressed, so nothing is thrown away to make the file small. It is written at 16 bits per sample, though: a 24-bit or 32-bit-float source is reduced to 16-bit here, and that resolution does not come back. Nothing is compressed either — expect a file several times the size of a compressed source, and a smaller one than a 24-bit master.",
  flac: "FLAC compresses the decoded samples without discarding any of them, so this step is lossless — decode the FLAC and the same samples come back, at roughly half the size of WAV.",
};

/**
 * What does NOT come out the other side — the silent loss this cluster is
 * obliged to disclose rather than let a user discover in their library.
 *
 * The two Web Audio arms decode the file to raw samples, which is where tags,
 * cover art and chapter marks stop existing. The FFmpeg arm passes the file
 * through whole but runs `-vn` (`audio-convert.ts` argv), which drops an
 * embedded picture — what FFmpeg does with the tags is its own business and is
 * not claimed here either way.
 */
const METADATA_NOTE: Record<AudioOutputFormat, string> = {
  mp3: "Only the sound comes across. The decode reduces your file to raw samples, so tags, cover art and chapter marks are not in the download.",
  wav: "Only the sound comes across. The decode reduces your file to raw samples, so tags, cover art and chapter marks are not in the download.",
  flac: "Cover art does not come across — the encoder is told to drop attached pictures. Tags are handed to FFmpeg along with the file and may survive; nothing here promises they will.",
};

/**
 * Source extensions whose contents are lossy BY DEFINITION of the format.
 *
 * `.m4a` is deliberately absent. It usually holds AAC, but it can hold Apple
 * Lossless, and there is no container parser on this page to tell them apart —
 * printing "your source is already lossy" over an ALAC master would be exactly
 * the kind of confident wrong sentence this cluster exists to avoid.
 */
const KNOWN_LOSSY_SOURCE_EXTS = ["mp3", "ogg", "oga", "opus", "aac", "wma", "amr", "spx", "weba"];

/** Lowercase extension without the dot, or "" for a dot-less name. */
function extensionOf(fileName: string): string {
  const m = /\.([^.]+)$/.exec(fileName);
  return m ? m[1].toLowerCase() : "";
}

/**
 * The generational-loss sentence, or `null` when the source is not one we can
 * SEE is lossy. Lossy → lossy is a second destructive encode over audio that
 * has already lost detail, and "convert your OGG to MP3" pages sell it as if it
 * were free.
 */
function generationalLossNote(fileName: string, format: AudioOutputFormat): string | null {
  const ext = extensionOf(fileName);
  if (!KNOWN_LOSSY_SOURCE_EXTS.includes(ext)) return null;
  const upper = ext.toUpperCase();
  return format === "mp3"
    ? `Your source is ${upper}, which is already lossy. What it dropped when it was made is gone, and encoding it to MP3 is a second lossy pass over what is left — it cannot come out sounding better than the file you started with.`
    : `Your source is ${upper}, which is already lossy. ${format.toUpperCase()} keeps exactly what is left of it, which is not the same as keeping the original recording — nothing here can bring back what the ${upper} encoder discarded.`;
}

interface AudioConverterUIProps {
  acceptFormats: string;
  /**
   * Seeds the FORMAT toggle — every page in this cluster preselects its own
   * output and the user can still change it. `AudioToolClients` reads it off
   * the registry entry; see the block comment there for why the registry field
   * is read widened rather than through the image-only `targetFormat` union.
   */
  defaultFormat?: AudioOutputFormat;
  /*
    Every slug sharing this component pays a different multiplier for the same
    decode, so the sentence cannot be a module constant here the way it is in
    the single-slug UIs — `AudioToolClients` passes each tool's own
    `practicalLimitNote` through.
  */
  practicalLimitNote?: string;
}

const BITRATE_OPTIONS = [128, 192, 256, 320];
/** Bar count the doc's waveform draws. */
const WAVEFORM_BARS = 90;

export function AudioConverterUI({
  acceptFormats,
  defaultFormat = "mp3",
  practicalLimitNote,
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
  // Seeded by the registry, owned by the user from the first click.
  const [format, setFormat] = useState<AudioOutputFormat>(defaultFormat);
  const [bitrate, setBitrate] = useState(DEFAULT_MP3_BITRATE);

  /*
    THE PREVIEW DECODE IS ASYNCHRONOUS AND CANNOT BE STOPPED.

    `computeWaveform` resolves when it resolves; `reset()` and the setState
    calls beside it only clear what is on screen, so a file the user discarded
    a second ago still lands its duration, sample rate, channel count and bars
    on top of the file they are looking at NOW — a two-second clip whose header
    reads "48 kHz · STEREO · 15:00" and whose end-cap says 15:00, with the
    abandoned file's bars underneath.

    Every other async surface in this cluster is fenced the same way
    (`useFileProcessor.runIdRef`, `ExtractAudioUI.runToken`). A ref, not state:
    the check has to see the value at the moment the promise settles, not the
    one captured when the callback was created.
  */
  const waveformRunRef = useRef(0);

  const processFn = useCallback(
    async (f: File, _opts: void, ctx: FileProcessorContext): Promise<ProcessedResult> => {
      // One entry point for all three formats: the engine decides which of
      // them the audio worker can encode and which needs FFmpeg.
      const { convertAudio } = await import("@/lib/tools/audio-convert");
      return convertAudio(f, { format, bitrate }, ctx);
    },
    [format, bitrate],
  );

  // `void` options: the conversion settings are closed over by `processFn`,
  // so `process` takes the file alone.
  const { status, result, error, progress, process, cancel, reset } =
    useFileProcessor<void>(processFn);

  const handleFiles = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      // Supersede any preview decode still in flight for the file being
      // replaced; its writes are dropped below.
      const run = ++waveformRunRef.current;
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
          if (waveformRunRef.current !== run) return;
          setPeaks(w.peaks);
          setDuration(w.duration);
          setStream({ sampleRate: w.sampleRate, channels: w.channels });
          setWaveState("ok");
        })
        .catch(() => {
          // Fenced on the failure path too: a discarded file's rejection must
          // not put "PREVIEW UNAVAILABLE" over a preview that has since drawn.
          if (waveformRunRef.current !== run) return;
          setPeaks(null);
          setWaveState("failed");
        });
    },
    [reset],
  );

  const handleConvert = useCallback(() => {
    if (!file) return;
    // `processFn` closes over `format`/`bitrate`, so there are no per-call
    // options to pass.
    process(file);
  }, [file, process]);

  const handleReset = useCallback(() => {
    // START OVER throws the file away, so the decode still running for it has
    // nothing left to describe.
    waveformRunRef.current += 1;
    setFile(null);
    setPeaks(null);
    setWaveState("loading");
    setDuration(0);
    setStream(null);
    reset();
  }, [reset]);

  /*
    A new format is a new output. Dropping the finished one is what keeps the
    readouts from describing bytes nobody can download — the same rule the
    bitrate chips follow, and the reason the labels below can be read off the
    live state without lying.

    A FAILED run is dropped for the same reason, and this is the half that was
    missing. Everything else on the surface follows the chip — `formatLabel`,
    the FORMAT cell, the QUALITY note, the OUTPUT rows — so leaving `error`
    standing put the NEW format's name directly above the OLD arm's failure
    text, with no run behind it: a user who switched to FLAC after a browser
    decode failed read "FLAC" over "Unable to decode audio data" and gave up on
    the arm that would have run, because FLAC does not use that decoder at all.
  */
  const handleFormatChange = useCallback(
    (next: AudioOutputFormat) => {
      setFormat(next);
      if (result || error) reset();
    },
    [result, error, reset],
  );

  if (!file) {
    return (
      <DropZone
        accept={acceptFormats}
        practicalLimitNote={practicalLimitNote}
        onFiles={handleFiles}
      />
    );
  }

  /*
    AFTER a run this is the extension the engine actually wrote, not the chip
    that is lit. They agree today because a format change drops the result, but
    an engine that falls back to another container would otherwise be relabelled
    by the picker, and the page would name a format the download is not.
  */
  const formatLabel = result
    ? (extensionOf(result.fileName) || format).toUpperCase()
    : format.toUpperCase();
  const generationalLoss = generationalLossNote(file.name, format);

  return (
    <>
      {/* ── Canvas: the doc's waveform stage ─────────────────── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={audioMeta(stream, duration ? formatClock(duration) : null, formatFileSize(file.size))}
          trailing={formatLabel}
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
            { label: "FORMAT", value: formatLabel, tone: "neutral" },
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
            {/* The doc pins the running readout to the rail footer. Only some
                of the encoders report progress, and only once they start — the
                decode ahead of them is silent, so stay indeterminate until a
                real number arrives rather than sitting pinned at 0%. */}
            {status === "processing" && (
              <ToolProgress
                phase="CONVERTING"
                percent={progress > 0 ? progress : null}
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
        <ToolControlGroup>
          <ToolControl label="FORMAT">
            <ToolChoice
              label="Output format"
              fill
              value={format}
              onChange={handleFormatChange}
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
                // A new bitrate is a new output — drop the finished one rather
                // than letting the chips describe bytes nobody can download,
                // and drop a FAILED one rather than letting last run's error
                // sit under this run's settings.
                onChange={(b) => {
                  setBitrate(b);
                  if (result || error) reset();
                }}
                disabled={status === "processing"}
                options={BITRATE_OPTIONS.map((b) => ({ value: b, label: String(b) }))}
              />
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                kbps. 192 is transparent for most music; 320 is the MP3 ceiling.
              </span>
            </ToolControl>
          )}
        </ToolControlGroup>

        {/*
          What the run costs, in the two halves that are actually knowable: what
          the OUTPUT format does to the samples, and — only where the loaded
          file's own extension says so — that the SOURCE was already lossy.
        */}
        <ToolAsideSection label="QUALITY">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {QUALITY_NOTE[format]}
          </span>
          {generationalLoss && (
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              {generationalLoss}
            </span>
          )}
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {METADATA_NOTE[format]}
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Format", formatLabel],
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
