"use client";

import { useCallback, useRef, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolDone,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  CanvasHeader,
  CanvasStage,
  Filmstrip,
  StatStrip,
} from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup, ToolProgress } from "@/components/tools/ToolControls";
import { extractFilmstrip } from "@/lib/tools/media-preview";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { CANVAS_COLUMN, STAGE_GROW, STAGE_MEDIA } from "@/components/workspace/shared";
import { cn } from "@/lib/utils/cn";
/*
  From the LEAF, never from `audio-convert.ts`. That module reaches
  `decodeAudioFile`, and a static edge to it from this file would put a Web
  Audio decoder in the extractor's chunk and put this page's drop zone in the
  set `size-claims.test.ts` forbids from printing "NO SIZE CAP" — a claim that
  is TRUE here, because the source is mounted into FFmpeg and never decoded in
  the tab. See the header of `audio-format.ts`.
*/
import { DEFAULT_MP3_BITRATE } from "@/lib/tools/audio-format";
import type { ExtractAudioFormat, ExtractAudioResult } from "@/lib/tools/extract-audio";

/*
  Pull the audio track out of a video container.

  ONE of the three arms can be lossless and the other two never are, so the
  whole design of this page is about not confusing them:

    - "Keep original" asks for `-c:a copy`. FFmpeg lifts the encoded audio out
      of the container and writes it into a new one without decoding a single
      sample — measured at 2–27 ms across this repo's fixtures.
    - MP3 and WAV decode that track and encode it again. Picking either is
      asking for a re-encode by name, which is why neither needs a consent gate.

  THE CLAIM IS DERIVED FROM `ExtractAudioResult.streamCopied`, NEVER FROM THE
  PICKER. "Keep original" is what we ASKED for; `streamCopied` is what HAPPENED.
  `extract-audio.ts` falls back to an MP3 re-encode when the probed codec has no
  container measured to hold it, and again when FFmpeg refuses the copy it did
  attempt — both come back `streamCopied: false` with a `warnings` entry saying
  which. Deriving the sentence from `format === "original"` would print "nothing
  was re-encoded" over exactly those runs, which is the silent-success class
  this cluster exists to stop. `VideoRemuxUI` holds the same line for the
  container tools.

  THE WARNINGS ARE NOT DECORATION. None of the nine audio/video UIs rendered
  `ProcessedResult.warnings` before this one, and the engine's fallback sentence
  is the only place the user is told WHY their lossless copy became an MP3.
*/

/**
 * Said BEFORE a run, from the picker. Future tense on purpose: it is what we
 * are about to ask for, and it must not be mistakable for the post-run claim.
 */
const COPY_PLAN_NOTE =
  "NOTHING WILL BE RE-ENCODED — THE AUDIO TRACK IS LIFTED OUT OF THE CONTAINER BIT FOR BIT, WHICH TAKES MILLISECONDS.";

/** Said AFTER a run, and ONLY when `ExtractAudioResult.streamCopied` is true. */
const COPIED_RESULT_NOTE =
  "NOTHING WAS RE-ENCODED — THE AUDIO TRACK IN THE DOWNLOAD IS THE ONE THAT WAS INSIDE YOUR FILE, BIT FOR BIT.";

/** The other half of the same fact, for a run that really did re-encode. */
const REENCODED_RESULT_NOTE =
  "THIS RUN DECODED AND RE-ENCODED THE AUDIO — THE DOWNLOAD IS A NEW ENCODE, NOT THE TRACK THAT WAS INSIDE YOUR FILE.";

/** Frame count the doc's strip draws. */
const FILMSTRIP_FRAMES = 16;

const BITRATE_OPTIONS = [128, 192, 256, 320];

const FORMAT_OPTIONS: readonly { value: ExtractAudioFormat; label: string }[] = [
  { value: "original", label: "Keep original" },
  { value: "mp3", label: "MP3" },
  { value: "wav", label: "WAV" },
];

/**
 * What each arm costs, in the rail, before anything runs. The copy arm is the
 * only sentence in this file allowed to use the word lossless.
 */
const QUALITY_NOTE: Record<ExtractAudioFormat, string> = {
  original: "The track comes out in whatever format it was already in — usually AAC from a phone or a camera, Opus from a WebM. Nothing is decoded, so nothing is lost and the run takes milliseconds. Where the codec has no container this tool can hold it in, it falls back to an MP3 and says so rather than pretending.",
  mp3: "MP3 is a lossy format, and the track inside a video almost always is too. Decoding it and encoding it again is a second destructive pass: it will not sound better than the audio already in your file. Pick it when you need something that plays everywhere.",
  wav: "WAV holds the decoded samples uncompressed. Nothing is discarded at this step, but nothing the video's own encoder discarded comes back either — and the file gets much larger. Pick it when something downstream needs raw PCM.",
};

/** Lowercase extension without the dot, or "" for a dot-less name. */
function extensionOf(fileName: string): string {
  const m = /\.([^.]+)$/.exec(fileName);
  return m ? m[1].toLowerCase() : "";
}

export interface ExtractAudioUIProps {
  /** `Tool.acceptFormats`, so the zone's list cannot drift from the registry. */
  acceptFormats: string;
  /**
   * Seeds the AUDIO OUT toggle — `video-to-wav` and `mp4-to-wav` preselect WAV,
   * the `extract-audio` hub starts on the lossless copy. The user can change it.
   */
  defaultFormat?: ExtractAudioFormat;
  /**
   * `Tool.maxSizeMB` — the cap `validateFFmpegInput` really enforces. Absent
   * renders "NO SIZE CAP" in the zone, which is honest here: the source is
   * MOUNTED into FFmpeg rather than copied into the tab.
   */
  sizeCapMB?: number;
  /**
   * `Tool.practicalLimitNote` — the ceiling a tool HAS but does not ENFORCE.
   * None of the three slugs sets one today, and "NO SIZE CAP" is honest for all
   * three. It is passed through anyway because the alternative fails SILENTLY:
   * a registry entry that grows a note would keep printing the absolute claim,
   * and nothing would say so.
   */
  practicalLimitNote?: string;
}

export function ExtractAudioUI({
  acceptFormats,
  defaultFormat = "original",
  sizeCapMB,
  practicalLimitNote,
}: ExtractAudioUIProps) {
  const [file, setFile] = useState<File | null>(null);
  // The hook revokes on unmount and on swap; a hand-rolled URL only revoked on
  // swap, so navigating away pinned the source blob for the tab.
  const videoUrl = useObjectUrl(file);
  const [frames, setFrames] = useState<string[]>([]);
  const [format, setFormat] = useState<ExtractAudioFormat>(defaultFormat);
  const [bitrate, setBitrate] = useState(DEFAULT_MP3_BITRATE);
  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [progress, setProgress] = useState(0);
  /*
    `ExtractAudioResult`, not `ProcessedResult`: `streamCopied` is the whole
    point of this page and `useFileProcessor` erases it at the type boundary.
    That is also why the status machine below is hand-rolled.
  */
  const [result, setResult] = useState<ExtractAudioResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The doc pins a "Done in 29 ms" card above the primary once a run finishes.
  // Timed for real; cleared the moment the inputs change.
  const [elapsed, setElapsed] = useState<string | null>(null);

  /*
    A run is async and clearing the state around it is not enough on its own.
    Swap the file (or change the format) while FFmpeg is working and the
    settling promise would still call setResult(), binding the OLD file's bytes
    to the NEW one — the download then hands over the wrong audio under the
    right name, and the "nothing was re-encoded" line would describe a run the
    user is no longer looking at.

    Every invalidation bumps this token; a run captures it at the start and
    commits nothing unless it still matches. A ref, not state, because the check
    has to see the value at the moment the promise settles rather than the one
    captured when the callback was created.
  */
  const runToken = useRef(0);
  /** Cancelling an FFmpeg job means terminating its worker; this is the wire. */
  const abortRef = useRef<AbortController | null>(null);

  const invalidate = useCallback(() => {
    runToken.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setResult(null);
    setElapsed(null);
    setError(null);
    setProgress(0);
    setStatus("idle");
  }, []);

  const handleFiles = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      invalidate();
      setFile(f);
      setFrames([]);
      // Decoration only — see VideoTrimmerUI. A video whose frames will not
      // draw still extracts perfectly well.
      extractFilmstrip(f, FILMSTRIP_FRAMES)
        .then(setFrames)
        .catch(() => setFrames([]));
    },
    [invalidate],
  );

  const handleReset = useCallback(() => {
    invalidate();
    setFile(null);
    setFrames([]);
  }, [invalidate]);

  /*
    Changing either setting changes what the next run produces, so it drops the
    finished output. Otherwise the rail could read "MP3" while Download still
    held the copied AAC, with no primary left to re-run it.
  */
  const handleFormatChange = useCallback(
    (next: ExtractAudioFormat) => {
      invalidate();
      setFormat(next);
    },
    [invalidate],
  );

  const handleBitrateChange = useCallback(
    (next: number) => {
      invalidate();
      setBitrate(next);
    },
    [invalidate],
  );

  const handleCancel = useCallback(() => {
    runToken.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setProgress(0);
    setStatus("idle");
  }, []);

  const handleRun = useCallback(async () => {
    if (!file) return;
    runToken.current += 1;
    const token = runToken.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("processing");
    setProgress(0);
    setError(null);
    setElapsed(null);
    setResult(null);
    const startedAt = performance.now();
    try {
      const { extractAudio } = await import("@/lib/tools/extract-audio");
      const out = await extractAudio(
        file,
        { format, bitrate },
        {
          signal: controller.signal,
          onProgress: (value) => {
            // A superseded run must not move the bar of the one that replaced it.
            if (runToken.current === token) setProgress(value);
          },
        },
      );
      // Superseded while it ran: the file or the format changed under it, so
      // this output belongs to a video the user is no longer looking at. Drop
      // it on the floor — the invalidation has already reset the surface.
      if (runToken.current !== token) return;
      setResult(out);
      // A stream copy finishes in single-digit milliseconds; "Done in 0.0 s"
      // reads like a stopwatch that never started. Sub-second runs report ms.
      const ms = performance.now() - startedAt;
      setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
      setStatus("done");
    } catch (err) {
      // Same fence on the failure path: a superseded run's error must not land
      // on the file the user has since loaded.
      if (runToken.current !== token) return;
      setError(
        err instanceof Error ? err.message : "The audio could not be extracted from this file.",
      );
      setStatus("error");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [file, format, bitrate]);

  if (!file) {
    return (
      <DropZone
        accept={acceptFormats}
        sizeCapMB={sizeCapMB}
        sizeCapReason="The whole file is read through an FFmpeg build running inside this page, so the tab has to hold what it produces."
        practicalLimitNote={practicalLimitNote}
        onFiles={handleFiles}
      />
    );
  }

  /*
    THE CLAIM, AND WHERE IT COMES FROM. Before a run this is the picker's
    prediction, in the future tense. After one it is `streamCopied`, which is
    the only thing that knows what actually ran.
  */
  const resultNote = result
    ? result.streamCopied
      ? COPIED_RESULT_NOTE
      : REENCODED_RESULT_NOTE
    : format === "original"
      ? COPY_PLAN_NOTE
      : null;

  const modeValue = result
    ? result.streamCopied
      ? "COPIED"
      : "RE-ENCODED"
    : format === "original"
      ? "COPY"
      : "RE-ENCODE";

  /*
    The copy arm cannot know its own extension until the run: it is whatever
    container the track's codec needs. So this says what it knows and no more.
  */
  const outLabel = result
    ? (extensionOf(result.fileName) || "AUDIO").toUpperCase()
    : format === "original"
      ? "AS-IS"
      : format.toUpperCase();

  return (
    <>
      {/* ── Canvas: the clip, and what came out of it ─────────── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={formatFileSize(file.size)}
          trailing={outLabel}
        />

        {videoUrl && (
          <CanvasStage className={cn(STAGE_GROW, "flex items-center justify-center bg-black")}>
            <video src={videoUrl} controls className={cn(STAGE_MEDIA, "bg-black")} />
            <span className="absolute top-3 right-3.5 rounded-sm bg-[rgba(12,14,23,.72)] px-[7px] py-1 font-mono text-[9.5px] leading-none font-medium tracking-[0.12em] text-accent-300">
              {outLabel}
            </span>
          </CanvasStage>
        )}

        <Filmstrip frames={frames} startPct={0} endPct={100} />

        <StatStrip
          stats={[
            { label: "IN", value: formatFileSize(file.size), tone: "neutral" },
            { label: "OUT", value: result ? formatFileSize(result.newSize) : "—" },
            {
              label: "MODE",
              value: modeValue,
              // Green only where the run was (or would be) lossless.
              tone: result ? (result.streamCopied ? "ok" : "neutral") : format === "original" ? "ok" : "neutral",
            },
            {
              /*
                What was actually in there, as ffprobe named it. Only knowable
                after a run — this page has no pre-flight probe of its own — and
                `null` when the probe could not read the file, which is a state
                the engine treats as "try anyway" rather than as a failure.
              */
              label: "TRACK",
              value: !result ? "—" : (result.sourceCodec ?? "UNREADABLE").toUpperCase(),
              tone: "neutral",
            },
          ]}
        />

        {error && <ErrorMessage message={error} />}

        {/*
          The engine's own account of a fallback. `role="status"` and the
          warning token, not the error red: the run SUCCEEDED — it just did
          not do the lossless thing that was asked for, and this sentence is
          the only place that is explained.
        */}
        {result?.warnings?.map((warning) => (
          <WarningMessage key={warning} message={warning} />
        ))}

        {resultNote && <CanvasFootnote>{resultNote}</CanvasFootnote>}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {status === "processing" && (
              <ToolProgress
                phase={format === "original" ? "COPYING THE AUDIO TRACK" : "RE-ENCODING THE AUDIO"}
                percent={progress > 0 ? progress : null}
                label="Extracting audio"
              />
            )}
            {elapsed && <ToolDone elapsed={elapsed} />}
            {result ? (
              <DownloadButton
                blob={result.blob}
                fileName={result.fileName}
                className="w-full justify-center"
              />
            ) : status === "processing" ? (
              // The one reachable control while FFmpeg runs. It replaces the
              // primary rather than sitting beside it so "Cancel" is never two
              // different things at once.
              <ToolActions primaryLabel="Cancel" onPrimary={handleCancel} />
            ) : (
              <ToolActions primaryLabel="Extract Audio" onPrimary={handleRun} />
            )}
            {status !== "processing" && (
              <ToolResetLink
                onClick={handleReset}
                label={result ? "EXTRACT ANOTHER" : "CHANGE FILE"}
              />
            )}
          </>
        }
      >
        <ToolControlGroup>
          <ToolControl label="AUDIO OUT">
            <ToolChoice
              label="Audio output"
              fill
              value={format}
              onChange={handleFormatChange}
              disabled={status === "processing"}
              options={FORMAT_OPTIONS}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              {QUALITY_NOTE[format]}
            </span>
          </ToolControl>

          {format === "mp3" && (
            <ToolControl label="BITRATE">
              <ToolChoice
                label="MP3 bitrate"
                fill
                value={bitrate}
                onChange={handleBitrateChange}
                disabled={status === "processing"}
                options={BITRATE_OPTIONS.map((b) => ({ value: b, label: String(b) }))}
              />
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                kbps. Higher than the video&rsquo;s own audio track buys nothing.
              </span>
            </ToolControl>
          )}
        </ToolControlGroup>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Source", formatFileSize(file.size)],
              ["Audio", result ? formatFileSize(result.newSize) : "—"],
              ["File", outLabel],
              [
                "Re-encoded",
                // Straight off the result, so this row cannot disagree with the
                // sentence on the canvas.
                result ? (result.streamCopied ? "No" : "Yes") : "—",
              ],
            ]}
          />
        </ToolAsideSection>

        <ToolAsideSection label="WHAT THIS DOES">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            A video file is a container holding a picture track and a sound track side by side.
            Extracting the audio drops the picture and keeps the sound — on the &ldquo;Keep
            original&rdquo; setting the sound is moved across without being decoded, so the download
            holds the same bytes the video did and the run takes milliseconds rather than minutes.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Nothing is uploaded. FFmpeg runs inside this page, and the page reports what the run
            actually did rather than what it set out to do.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
