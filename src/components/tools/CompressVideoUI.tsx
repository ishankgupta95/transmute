"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import type {
  CompressionPreset,
  VideoCompressResult,
  VideoSizeTargetOutcome,
} from "@/lib/tools/video-compress";
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
  CanvasFootnote,
  CanvasHeader,
  CanvasStage,
  Filmstrip,
  StatStrip,
} from "@/components/tools/ToolCanvas";
import { extractFilmstrip } from "@/lib/tools/media-preview";
import { cn } from "@/lib/utils/cn";
import { getToolBySlug } from "@/data/tools";

/** Frame count the doc's strip draws. */
const FILMSTRIP_FRAMES = 16;

/**
 * Which question the rail asks. `compress-video` picks a named preset;
 * `compress-video-to-size` names a ceiling in MB and lets the engine solve a
 * bitrate for it.
 */
export type CompressVideoMode = "preset" | "target-size";

/*
  Read from the registry rather than retyped, so the drop zone and the spec
  panel cannot drift apart — the same move VideoTrimmerUI makes for its cap.
  This one is a disclosure, not a check: nothing here is compared to file.size.

  One entry per slug this component serves. Deliberately looked up HERE rather
  than taken as a prop: size-claims.test.ts scans this file for
  `getToolBySlug("…")?.practicalLimitNote` and asserts the registry actually
  carries a sentence for each slug it finds. A prop would satisfy the scan
  while quietly passing `undefined`, and the drop zone would print
  "NO SIZE CAP" over a path that reads the whole file into one buffer.
*/
const PRACTICAL_LIMIT_NOTE: Record<CompressVideoMode, string | undefined> = {
  preset: getToolBySlug("compress-video")?.practicalLimitNote,
  "target-size": getToolBySlug("compress-video-to-size")?.practicalLimitNote,
};

const PRESETS: { value: CompressionPreset; label: string; desc: string }[] = [
  { value: "whatsapp", label: "WhatsApp", desc: "720p, ~1 Mbps" },
  { value: "email", label: "Email", desc: "480p, ~500 kbps" },
  { value: "web", label: "Web", desc: "Original res, balanced" },
];

/*
  The three ceilings people actually run into, in MB. Each is a SEED for the
  field beside them, not a mode: clicking one writes the number, and the number
  stays editable. (The same seam `ImageCompressorUI` uses for its KB presets.)

  The descriptions are hedged on purpose — these are the limits as commonly
  published, and every one of these platforms has moved its own at least once.
*/
const SIZE_PRESETS: { mb: number; label: string; desc: string }[] = [
  { mb: 25, label: "Email", desc: "25 MB — the usual attachment ceiling" },
  { mb: 16, label: "WhatsApp", desc: "16 MB — WhatsApp's usual video ceiling" },
  { mb: 10, label: "Discord", desc: "10 MB — Discord's free-tier upload ceiling" },
];

/** Used when the registry ships no seed: the email ceiling, the widest of the three. */
const FALLBACK_TARGET_MB = 25;

/*
  ── THE PRE-FLIGHT, and why the typeof check was not one ──────────────

  `isWebCodecsEncodeSupported` asks whether VideoEncoder, AudioEncoder,
  VideoFrame and requestVideoFrameCallback EXIST. Modern WebKit and Gecko
  define all four, so `unsupported` stayed false on both of this component's
  slugs, no banner rendered, Compress was enabled, and the failure arrived
  from inside the encode — in Safari as mp4-muxer's own
  "null is not an object (evaluating 'track.info.decoderConfig.colorSpace')".
  The page's copy asserts the opposite in two places ("Safari and Firefox are
  told so up front rather than part-way through an encode"), so the question
  has to actually be asked, of the codecs, before a file is dropped.

  Two things are asked, both cheap and both deterministic:

    1. AAC. `mp4a.40.2` is the only audio codec this pipeline muxes, and
       Firefox ships no AAC encoder at all. `assertAacEncodable` in the engine
       already refuses — but only after a file is dropped, only after Compress
       is clicked, and only for a clip whose audio actually decoded, so a
       SILENT clip in Firefox slipped past it entirely.

    2. H.264, and then the codec description the encoder is supposed to return
       with its first chunk. mp4-muxer reads that description out of the
       metadata, so an encoder that omits it cannot write an MP4 here whatever
       `isConfigSupported` said — and `isConfigSupported` is the only thing
       that can be asked without encoding. One 64 × 48 frame settles it, in
       milliseconds, with no DOM and none of the user's video.

  ANYTHING THAT THROWS IS INCONCLUSIVE, NOT A REFUSAL. A browser that behaves
  unexpectedly under the probe must not be locked out of a tool that may work
  for it; only an explicit `supported: false`, or a first chunk that carries
  no `decoderConfig`, disables the button.
*/

/*
  Both sentences are duplicated from video-compress.ts rather than imported,
  and they have to stay identical to the constants exported there. A static
  import of that module would pull mp4-muxer and the whole encode path into
  the eager bundle of two tool pages that mostly never encode anything — the
  same trade `pdf-extract-images.ts` documents for its two load-failure
  sentences. If one changes, both change.
*/
const PREFLIGHT_AAC_MESSAGE =
  "This browser can't encode the audio track — its WebCodecs implementation doesn't support AAC. Please use Chrome or Edge.";

const PREFLIGHT_MP4_METADATA_MESSAGE =
  "This browser can't write the compressed MP4 — its video encoder doesn't return the H.264 codec description the container needs. Please use Chrome or Edge.";

/** Big enough for a real H.264 macroblock grid, small enough to be free. */
const PROBE_WIDTH = 64;
const PROBE_HEIGHT = 48;

/**
 * Encode one frame and report whether the encoder returned a codec
 * description with it — the exact thing mp4-muxer will reach for.
 *
 * An I420 buffer rather than a canvas, so the probe touches no DOM and runs
 * the same way in a page and in a test.
 */
async function returnsDecoderConfig(): Promise<boolean> {
  const config: VideoEncoderConfig = {
    codec: "avc1.42001f",
    width: PROBE_WIDTH,
    height: PROBE_HEIGHT,
    bitrate: 300_000,
    framerate: 30,
  };
  const support = await VideoEncoder.isConfigSupported(config);
  if (support.supported === false) return false;

  let seen = false;
  const encoder = new VideoEncoder({
    output: (_chunk, meta) => {
      if (meta?.decoderConfig) seen = true;
    },
    // A probe failure is not the user's problem; `seen` staying false is the
    // whole answer, and an unhandled throw here would become a page error.
    error: () => {},
  });
  try {
    encoder.configure(support.config ?? config);
    // One luma plane plus two half-resolution chroma planes = w × h × 1.5.
    const frame = new VideoFrame(new Uint8Array((PROBE_WIDTH * PROBE_HEIGHT * 3) / 2), {
      format: "I420",
      codedWidth: PROBE_WIDTH,
      codedHeight: PROBE_HEIGHT,
      timestamp: 0,
    });
    encoder.encode(frame, { keyFrame: true });
    frame.close();
    await encoder.flush();
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
  return seen;
}

/**
 * The sentence to show before anything starts, or null when this browser can
 * actually run the pipeline. Exported so the probe's verdicts can be asserted
 * without a component.
 */
export async function encodePipelineProblem(): Promise<string | null> {
  try {
    const aac = await AudioEncoder.isConfigSupported({
      codec: "mp4a.40.2",
      numberOfChannels: 2,
      sampleRate: 48_000,
      bitrate: 128_000,
    });
    if (aac.supported === false) return PREFLIGHT_AAC_MESSAGE;
  } catch {
    // Inconclusive — see the block above.
  }
  try {
    if (!(await returnsDecoderConfig())) return PREFLIGHT_MP4_METADATA_MESSAGE;
  } catch {
    // Inconclusive.
  }
  return null;
}

export interface CompressVideoUIProps {
  /**
   * Passed explicitly by the client rather than inferred from
   * `defaultTargetSizeKb` being present. A registry entry that forgot the seed
   * would otherwise render the WRONG TOOL — the preset page under the
   * size-target page's URL, with no error anywhere.
   */
  mode?: CompressVideoMode;
  /** Registry seed for the MB field in target mode. A starting point, not a lock. */
  defaultTargetSizeKb?: number;
  acceptFormats?: string;
}

export function CompressVideoUI({
  mode = "preset",
  defaultTargetSizeKb,
  acceptFormats = ".mp4,.webm,.mov",
}: CompressVideoUIProps = {}) {
  const targetMode = mode === "target-size";
  // Read only after mount so the static export can't bake the build
  // machine's (absent) encoder support into the prerendered HTML.
  const mounted = useIsClient();
  /*
    The probe's verdict, and it only ever moves one way: it starts null and is
    set only when the pipeline is refused. A resolve-to-fine writes no state at
    all, so the common case is one render and no work after paint.
  */
  const [probeProblem, setProbeProblem] = useState<string | null>(null);
  useEffect(() => {
    // The constructors have to be there before there is anything to ask.
    if (!isWebCodecsEncodeSupported()) return;
    let live = true;
    encodePipelineProblem().then((message) => {
      if (live && message) setProbeProblem(message);
    });
    return () => {
      live = false;
    };
  }, []);
  /*
    One sentence for the banner and one boolean for the button, so the two can
    never disagree about whether this browser can run the tool.
  */
  const unsupportedMessage = !mounted
    ? null
    : !isWebCodecsEncodeSupported()
      ? WEBCODECS_UNSUPPORTED_MESSAGE
      : probeProblem;
  const unsupported = unsupportedMessage !== null;
  const [file, setFile] = useState<File | null>(null);
  // The hook revokes on unmount and on swap; the hand-rolled version only
  // revoked on swap, so navigating away pinned the source blob for the tab.
  const videoUrl = useObjectUrl(file);
  const [frames, setFrames] = useState<string[]>([]);
  const [preset, setPreset] = useState<CompressionPreset>("whatsapp");
  /*
    Held in MB because that is the unit every one of these ceilings is quoted
    in; the registry seed is KB (`defaultTargetSizeKb`, shared with the image
    compressor) so it is converted once, here.
  */
  const [targetMb, setTargetMb] = useState(() =>
    defaultTargetSizeKb && defaultTargetSizeKb > 0
      ? Math.max(1, Math.round(defaultTargetSizeKb / 1024))
      : FALLBACK_TARGET_MB,
  );
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

  /*
    A cleared or zeroed field must never run. The engine throws on a
    non-positive target rather than quietly encoding at its floor, but the
    honest place to stop is before the click: the primary goes disabled and the
    header says SET A TARGET.
  */
  const targetValid = Number.isFinite(targetMb) && targetMb >= 1;

  const processFn = useCallback(
    async (f: File, _options: void, ctx: FileProcessorContext) => {
      const { compressVideo } = await import("@/lib/tools/video-compress");
      return compressVideo(
        f,
        targetMode ? { targetSizeKb: Math.round(targetMb * 1024) } : preset,
        ctx,
      );
    },
    [preset, targetMode, targetMb],
  );

  // `void` options: `processFn` closes over the preset, so `process` takes the
  // file alone. The hook owns progress and the AbortSignal that makes a 25 MB
  // re-encode cancellable.
  const { status, result, error, progress, process, cancel, reset } =
    useFileProcessor<void>(processFn);

  /*
    THE HONEST HALF OF THIS TOOL. A bitrate solver TARGETS a size; it does not
    guarantee one. `sizeTarget.met` is the finished blob weighed against the
    ceiling inside the engine, so every readout below describes the file the
    Download button is holding rather than what the solver hoped for.

    The hook types its slot as the narrower `ProcessedResult` but stores what
    the processor returned VERBATIM, so the report travels with the result —
    which is what makes it race-proof. A superseded run's numbers can never be
    printed beside a newer run's file, because they are the same object.
  */
  const outcome = (result as VideoCompressResult | null)?.sizeTarget ?? null;
  const targetLabel = `${targetMb} MB`;

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
    if (targetMode && !targetValid) return;
    process(file);
  }, [file, process, targetMode, targetValid]);

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

  /*
    Same contract for the ceiling: a new target is a different encode, so the
    finished file goes. Otherwise the header reads "≤ 10 MB" while Download
    still holds the 25 MB run — and the footnote under the canvas would be
    judging that old file against a target it was never given.
  */
  const handleTargetChange = useCallback(
    (value: number) => {
      if (result) reset();
      setTargetMb(value);
    },
    [result, reset],
  );

  if (!file) {
    return (
      <>
        {/* Warn before the click, not after a wasted upload; the zone stays
            so the page keeps its shape on an unsupported browser. */}
        {unsupportedMessage && <ErrorMessage message={unsupportedMessage} />}
        <DropZone
          accept={acceptFormats}
          practicalLimitNote={PRACTICAL_LIMIT_NOTE[mode]}
          onFiles={handleFiles}
        />
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
          trailing={
            !targetMode
              ? "MP4"
              : result
                ? // After a run the header states the size that EXISTS, not the
                  // one that was asked for.
                  formatFileSize(result.newSize)
                : targetValid
                  ? `≤ ${targetLabel}`
                  : "SET A TARGET"
          }
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
            // The ceiling sits between IN and OUT so the three numbers read as
            // one sentence: this much came in, this much was allowed, this much
            // came out.
            ...(targetMode
              ? [
                  {
                    label: "TARGET",
                    value: targetValid ? `≤ ${targetLabel}` : "—",
                    tone: "neutral" as const,
                  },
                ]
              : []),
            {
              label: "OUT",
              value: result ? formatFileSize(result.newSize) : "—",
              // Green is a claim. In target mode it means "this fits", and it
              // is withheld the moment the finished file is over the ceiling —
              // measured, never assumed.
              tone: targetMode && outcome ? (outcome.met ? "ok" : "neutral") : "accent",
            },
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
        {unsupportedMessage && status !== "error" && (
          <ErrorMessage message={unsupportedMessage} />
        )}

        {/*
          The verdict. It is the headline readout of the size-target page, not
          a footnote of apology: the number in OUT is only meaningful next to a
          sentence saying whether it cleared the ceiling.
        */}
        {outcome && result && (
          <CanvasFootnote>
            {targetOutcomeText(outcome, result.newSize, targetLabel, source.duration)}
          </CanvasFootnote>
        )}

        {/*
          Independent of the verdict: a clip that was already leaner than the
          ceiling is not encoded up to fill it, so the download can be far
          under the target for a reason that has nothing to do with the solver.

          WHICH sentence is decided by the file on the Download button, not by
          the cap having been applied. See `sourceCappedText`.
        */}
        {outcome?.sourceCapped && result && (
          <CanvasFootnote>
            {sourceCappedText(outcome, result.newSize, file.size, targetLabel)}
          </CanvasFootnote>
        )}

        {/*
          A resolution change is a visible change to the video, so it is stated
          rather than left for the user to notice. Gated on the SOURCE height
          being above the ceiling the plan chose, because that is the only case
          in which anything was actually scaled — the engine never scales up.
        */}
        {outcome && source.dims && source.dims.h > outcome.maxHeight && (
          <WarningMessage
            message={`Scaled down to ${outcome.maxHeight}p. ${Math.round(
              outcome.videoBitrate / 1000,
            )} kbps is not enough to carry ${source.dims.h}p, so those bits were spent on fewer pixels instead. The height rule is a rule of thumb, not a measurement of your clip.`}
          />
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
                primaryDisabled={unsupported || (targetMode && !targetValid)}
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
          {targetMode ? (
            <ToolControl label="TARGET SIZE">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={4096}
                  value={targetMb}
                  onChange={(e) => handleTargetChange(Number(e.target.value))}
                  aria-label="Target file size in MB"
                  className="w-24 rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  disabled={status === "processing"}
                />
                <span className="text-sm text-text-muted">MB</span>
              </div>
              {/* Cards, not chips: each carries the platform AND the number,
                  and a chip row could only show one of the two. */}
              <div className="flex flex-col gap-1.5" role="group" aria-label="Target size preset">
                {SIZE_PRESETS.map((p) => (
                  <button
                    key={p.mb}
                    type="button"
                    onClick={() => handleTargetChange(p.mb)}
                    disabled={status === "processing"}
                    aria-pressed={targetMb === p.mb}
                    className={chipClass(
                      targetMb === p.mb,
                      "px-3 py-2.5 text-left disabled:opacity-45",
                    )}
                  >
                    <span className="block text-sm font-medium">{p.label}</span>
                    <span className="mt-0.5 block text-xs text-text-muted">{p.desc}</span>
                  </button>
                ))}
              </div>
              {/*
                The one claim this control is allowed to make, and it is a
                careful one. "Aims at" — not "guarantees": H.264 rate control
                can spend more than it was given, and there is a bitrate floor
                below which this tool will not encode. Both misses are named
                on the canvas afterwards, against the file that actually
                exists.
              */}
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                A ceiling this aims at, not one it can promise. The bitrate is solved from your
                clip&rsquo;s length, encoded once, and the finished file is then weighed against
                the number above — whatever it says, the size you see after the run is the size
                you get.
              </span>
              {/*
                Plain arithmetic on two numbers the page already has — no
                heuristic, nothing predicted. It is the fastest way for someone
                to see that 25 MB across forty minutes was never going to be a
                watchable video, BEFORE spending the encode.
              */}
              {targetValid && source.duration && (
                <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                  {`${targetLabel} across ${formatClock(source.duration)} is about ${Math.round(
                    (targetMb * 1024 * 1024 * 8) / source.duration / 1000,
                  )} kbps for the whole file, audio included.`}{" "}
                  Low numbers leave the encoder little to work with, and it will not go under its
                  floor — so a long clip under a small ceiling comes back over that ceiling, and
                  this page says so rather than pretending otherwise.
                </span>
              )}
            </ToolControl>
          ) : (
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
          )}
        </ToolControlGroup>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["In", formatFileSize(file.size)],
              ...(targetMode
                ? ([["Target", targetValid ? `≤ ${targetLabel}` : "—"]] as [string, string][])
                : []),
              ["Out", result ? formatFileSize(result.newSize) : "—"],
              // The verdict belongs in the numbers panel too, in the one word
              // that answers the only question this tool was opened to answer.
              ...(targetMode
                ? ([["Fits", outcome ? (outcome.met ? "Yes" : "No") : "—"]] as [string, string][])
                : []),
              ["Progress", status === "processing" ? `${progress}%` : status === "done" ? "100%" : "—"],
            ]}
          />
          {result && result.newSize >= file.size && (
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              {targetMode
                ? "Re-encoding did not make this clip any smaller — keep your original."
                : "This clip was already smaller than the preset’s target — keep the original."}
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

/**
 * The one sentence that says whether the ceiling was cleared.
 *
 * A single producer, the same discipline `RecompressPdfImagesUI.disclosureText`
 * keeps, so the three outcomes cannot drift into three different registers —
 * and so a test can assert each one without rendering three encodes.
 *
 * Order matters. `met` is checked FIRST because it is the only branch decided
 * by weighing the finished file: a solve clamped to the floor can still land
 * under a generous ceiling, and calling that a failure would be as wrong as
 * calling an overshoot a success.
 */
export function targetOutcomeText(
  outcome: VideoSizeTargetOutcome,
  achievedBytes: number,
  targetLabel: string,
  durationSeconds: number | null,
): string {
  const achieved = formatFileSize(achievedBytes);
  if (outcome.met) {
    return `UNDER THE ${targetLabel} CEILING — THIS FILE IS ${achieved}`;
  }
  if (outcome.atFloor) {
    // The duration is what makes this branch legible ("of course 40 minutes
    // doesn't fit"), but it comes off the preview's metadata and a
    // MediaRecorder WebM declares none. Say the rest rather than say nothing.
    const span = durationSeconds ? `${formatClock(durationSeconds)} OF VIDEO` : "A CLIP THIS LONG";
    return `COULD NOT REACH ${targetLabel} — ${span} WILL NOT FIT UNDER IT AT THE LOWEST BITRATE THIS TOOL WILL ENCODE (${Math.round(
      outcome.videoBitrate / 1000,
    )} KBPS), AND THE CLOSEST IT GOT IS ${achieved}`;
  }
  /*
    Deliberately NOT "the encoder spent more than it was given". An overshoot
    can also come out of the container costing more than the allowance held
    back for it, and blaming the encoder for that would be a guess dressed as
    a diagnosis. State what is certain: the budget, the outcome, the fix.
  */
  return `MISSED THE ${targetLabel} CEILING — ${Math.round(
    outcome.videoBitrate / 1000,
  )} KBPS SHOULD HAVE FIT, BUT THE FINISHED FILE CAME BACK AT ${achieved}. RATE CONTROL IS NOT EXACT; A SMALLER TARGET WILL GET YOU UNDER IT.`;
}

/**
 * The never-inflate sentence — decided by WEIGHING the download, exactly as
 * `targetOutcomeText` decides the verdict by weighing it.
 *
 * This used to be one unconditional string ending "THIS TOOL DOES NOT INFLATE
 * A FILE TO FILL A CEILING", printed whenever the cap had been applied. The
 * cap being applied is not the same claim as the file having come back
 * smaller, and on a very lean clip the two came apart: an 87.6 KB screencast
 * spending 36 kbps is under `SIZE_TARGET_MIN_VIDEO_BITRATE`, so the floor
 * raises the encode above the source's own rate and the download was 238.3 KB
 * — 2.7× the input, under a sentence saying that could not happen.
 *
 * `planSizeTarget` now caps the WHOLE plan rather than the video track alone,
 * so the ordinary case genuinely does not inflate. The floor case still can,
 * and cannot be solved by arithmetic: this tool has no passthrough, and it
 * will not encode below its floor. So it is said out loud, with the two
 * numbers, and the user is told to keep the file they already have.
 */
export function sourceCappedText(
  outcome: VideoSizeTargetOutcome,
  achievedBytes: number,
  sourceBytes: number,
  targetLabel: string,
): string {
  // Naming the BITRATE rather than the rule. "90% of its own bitrate" would
  // have been false in the corner where the source is so lean that the cap
  // lands on the floor instead — the number below is true in both.
  const kbps = Math.round(outcome.videoBitrate / 1000);
  if (achievedBytes >= sourceBytes) {
    return `THIS CLIP ALREADY SPENDS LESS THAN ${targetLabel} ALLOWS, BUT ${kbps} KBPS IS THE LOWEST THIS TOOL ENCODES AND YOUR CLIP SPENDS LESS THAN THAT — SO THE RE-ENCODE CAME BACK AT ${formatFileSize(
      achievedBytes,
    )}, LARGER THAN THE ${formatFileSize(sourceBytes)} YOU STARTED WITH. KEEP YOUR ORIGINAL.`;
  }
  return `THIS CLIP ALREADY SPENDS LESS THAN ${targetLabel} ALLOWS, SO IT WAS ENCODED AT ${kbps} KBPS RATHER THAN THE HIGHER BITRATE ${targetLabel} WOULD HAVE PAID FOR — THIS TOOL DOES NOT INFLATE A FILE TO FILL A CEILING`;
}

/** `m:ss.d`, matching the doc's clip readouts. */
function formatClock(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins}:${String(secs).padStart(2, "0")}.${ms}`;
}
