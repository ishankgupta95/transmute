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
  StatStrip,
} from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup, ToolProgress } from "@/components/tools/ToolControls";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { CANVAS_COLUMN, STAGE_GROW, STAGE_MEDIA } from "@/components/workspace/shared";
import { cn } from "@/lib/utils/cn";
import type { MediaProbe } from "@/lib/tools/video-probe";
import type { RemuxResult, RotationDegrees } from "@/lib/tools/video-remux";

/*
  rotate-video: rewrite the video stream's rotation flag and copy every byte of
  picture and sound across unchanged.

  THE CATEGORICAL WIN IS THE PRODUCT, and it is measured. On the same clip in
  the shipped single-threaded core:

      -c copy -metadata:s:v:0 rotate=90    ->  EXIT 0 in     6 ms
      -vf transpose=1  (720p30, 10 s)      ->  EXIT 0 in 7,579 ms

  Three orders of magnitude, and the fast one is lossless because no frame is
  ever decoded. Every sentence this file prints about speed comes from those
  two numbers.

  THE PRE-FLIGHT IS NOT OPTIONAL HERE, for two measured reasons in
  `video-remux.ts`:

    1. Only the MP4 family stores this flag. `-metadata:s:v:0 rotate=90` into
       .mkv / .avi / .ts / .flv exits 0 and the rotation is SILENTLY DROPPED —
       the user would get a "rotated" download that looks identical. The engine
       refuses those containers, and a refusal the user only meets after
       clicking is a page that looks broken. So the container is checked on
       drop, not on click.
    2. The flag is ABSOLUTE and the engine composes it with whatever the file
       already declares. A portrait iPhone clip arrives tagged 90 already, so
       "rotate 90" on it lands at 180. That is only predictable if the page
       shows the rotation the file arrived with, which is what the probe reads.

  `degrees` is CLOCKWISE at this boundary — `rotateVideo` converts to the tag's
  counter-clockwise convention itself, off a two-decoder measurement recorded
  in its header. That is why these chips can honestly say "right" and "left".
*/

/** Said AFTER a run, and ONLY when `RemuxResult.streamCopied` is true. */
const COPIED_RESULT_NOTE =
  "NOT ONE PIXEL WAS TOUCHED — THE ROTATION FLAG WAS REWRITTEN AND THE VIDEO AND AUDIO WERE COPIED ACROSS BIT FOR BIT.";

/**
 * The other half of the same fact. `rotateVideo` only ever stream-copies today,
 * so this is unreachable in production — it is kept because the alternative is
 * a page that would print the lossless claim over a re-encode if the engine
 * ever gained one.
 */
const TRANSCODED_RESULT_NOTE =
  "THIS RUN DID NOT COPY THE STREAMS ACROSS UNTOUCHED — THE PICTURE IN THE DOWNLOAD IS A NEW ENCODE, NOT YOUR ORIGINAL.";

/**
 * The honest limit of a metadata rotation, said out loud rather than in a
 * footnote nobody reads: a user whose upload pipeline strips the flag will
 * otherwise think the tool failed.
 */
const FLAG_CAVEAT =
  "A rotation flag tells the player how to turn the picture; it does not turn the picture. Most modern players honour it. Some players — and some upload pipelines — ignore it and will show the original orientation. If that happens where your video is going, the only fix is a full re-encode, which this tool deliberately does not do.";

/**
 * ffprobe's `format.format_name` for the whole MP4 family — .mp4, .mov, .m4v
 * and .3gp all report this one string, because they share a demuxer.
 *
 * Duplicated from `video-remux.ts`, where it is private and where the same
 * comparison decides whether `rotateVideo` throws. Kept in step by hand; if it
 * ever moves, this page would start offering a run the engine refuses.
 */
const ISOBMFF_FORMAT_NAME = "mov,mp4,m4a,3gp,3g2,mj2";

/** Said on drop for a container that cannot store the flag at all. */
const UNSUPPORTED_CONTAINER_MESSAGE =
  "Rotating without re-encoding works by setting a flag inside the file, and this container does not store one — FFmpeg accepts the command and then drops the rotation, so the download would look exactly like the original. Convert this to MP4 first, then rotate that.";

/** Said on drop for a file with no picture to turn. */
const NO_VIDEO_MESSAGE = "There is no video track in this file, so there is nothing here to rotate.";

/**
 * Clockwise, because that is what "rotate right" means to a person, and
 * because `rotateVideo` takes clockwise degrees. 270 clockwise is a quarter
 * turn to the left, and saying so is more use than saying "270".
 */
const ROTATIONS: readonly { value: RotationDegrees; label: string }[] = [
  { value: 90, label: "90° right" },
  { value: 180, label: "180°" },
  { value: 270, label: "90° left" },
];

/** How an absolute clockwise angle reads in a stat cell. */
function orientationLabel(clockwise: number): string {
  return clockwise === 0 ? "UPRIGHT" : `${clockwise}° RIGHT`;
}

export interface RotateVideoUIProps {
  /** `Tool.acceptFormats`, so the zone's list cannot drift from the registry. */
  acceptFormats: string;
  /** `Tool.maxSizeMB` — the cap `validateFFmpegInput` really enforces. */
  sizeCapMB?: number;
}

export function RotateVideoUI({ acceptFormats, sizeCapMB }: RotateVideoUIProps) {
  const [file, setFile] = useState<File | null>(null);
  // The hook revokes on unmount and on swap, so navigating away cannot pin
  // the source blob for the tab.
  const videoUrl = useObjectUrl(file);
  const [probe, setProbe] = useState<MediaProbe | null>(null);
  /*
    Kept apart from `error`: a failed probe is a fact about the FILE and has to
    survive everything except a new file, where a failed run is a fact about
    the last click.
  */
  const [probeError, setProbeError] = useState<string | null>(null);
  const [degrees, setDegrees] = useState<RotationDegrees>(90);
  const [status, setStatus] = useState<"idle" | "probing" | "processing" | "done" | "error">(
    "idle",
  );
  const [result, setResult] = useState<RemuxResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<string | null>(null);

  /*
    A run is async and clearing the state around it does not stop it. Change
    the angle (or the file) mid-run and the settling promise would still call
    setResult(), binding a 90° output to a rail that now reads 180° — the
    download hands over a rotation the surface does not describe. Every
    invalidation bumps this token; a run captures it at the start and commits
    nothing unless it still matches. A ref, not state, because the check has to
    see the value at the moment the promise settles.
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
    setStatus("idle");
  }, []);

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    runToken.current += 1;
    const token = runToken.current;
    abortRef.current?.abort();
    abortRef.current = null;
    setFile(f);
    setProbe(null);
    setProbeError(null);
    setResult(null);
    setElapsed(null);
    setError(null);
    setStatus("probing");

    void (async () => {
      try {
        const { probeMedia } = await import("@/lib/tools/video-probe");
        const found = await probeMedia(f);
        if (runToken.current !== token) return;
        setProbe(found);
        setStatus("idle");
      } catch (err) {
        if (runToken.current !== token) return;
        setProbeError(
          err instanceof Error ? err.message : "This file could not be read as a video.",
        );
        setStatus("idle");
      }
    })();
  }, []);

  const handleReset = useCallback(() => {
    runToken.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setFile(null);
    setProbe(null);
    setProbeError(null);
    setResult(null);
    setElapsed(null);
    setError(null);
    setStatus("idle");
  }, []);

  /*
    The angle decides what the next run produces, so picking a new one drops
    the finished video. Otherwise the rail would show 180° while Download still
    held the file built at 90°, with no primary left to re-run it.
  */
  const handleDegrees = useCallback(
    (value: RotationDegrees) => {
      invalidate();
      setDegrees(value);
    },
    [invalidate],
  );

  const handleCancel = useCallback(() => {
    runToken.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
  }, []);

  /*
    What the pre-flight makes of the file. Both refusals mirror a throw inside
    `rotateVideo`; saying them on drop is the difference between a page that
    explains itself and a button that looks broken.
  */
  const refusal =
    probe === null
      ? null
      : probe.video === null
        ? NO_VIDEO_MESSAGE
        : probe.container !== ISOBMFF_FORMAT_NAME
          ? UNSUPPORTED_CONTAINER_MESSAGE
          : null;
  const blocked = probeError !== null || probe === null || refusal !== null;

  const handleRun = useCallback(async () => {
    if (!file || blocked) return;
    runToken.current += 1;
    const token = runToken.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("processing");
    setError(null);
    setElapsed(null);
    setResult(null);
    const startedAt = performance.now();
    try {
      const { rotateVideo } = await import("@/lib/tools/video-remux");
      const out = await rotateVideo(file, degrees, { signal: controller.signal });
      // Superseded while it ran — the surface has already been reset for a
      // file or an angle this output does not describe.
      if (runToken.current !== token) return;
      setResult(out);
      // Measured at 6 ms; "Done in 0.0 s" would read like a stopwatch that
      // never started.
      const ms = performance.now() - startedAt;
      setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
      setStatus("done");
    } catch (err) {
      if (runToken.current !== token) return;
      setError(err instanceof Error ? err.message : "This video could not be rotated.");
      setStatus("error");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [file, blocked, degrees]);

  if (!file) {
    return (
      <DropZone
        accept={acceptFormats}
        sizeCapMB={sizeCapMB}
        sizeCapReason="The video is copied through an FFmpeg build running inside this page, so the tab has to hold the source and a same-sized copy at once."
        onFiles={handleFiles}
      />
    );
  }

  const busy = status === "probing" || status === "processing";
  /* THE CLAIM COMES OFF THE RESULT. `streamCopied` is the only thing that
     knows whether the frames really were left alone. */
  const resultNote = result
    ? result.streamCopied
      ? COPIED_RESULT_NOTE
      : TRANSCODED_RESULT_NOTE
    : null;

  // The engine composes the new turn with the one the file already declares,
  // so the page has to show both or the arithmetic is invisible.
  const already = probe?.video?.rotationDegreesClockwise ?? 0;
  const total = (already + degrees) % 360;
  const chosen = ROTATIONS.find((r) => r.value === degrees);

  return (
    <>
      {/* ── Canvas: the clip, where it is now, and where it lands ── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={formatFileSize(file.size)}
          trailing={chosen?.label.toUpperCase()}
        />

        {videoUrl && (
          <CanvasStage className={cn(STAGE_GROW, "flex items-center justify-center bg-black")}>
            {/*
              The preview is the file as it is today, deliberately NOT turned.
              Turning it here would show a rotation the browser is applying and
              the download's own player has to apply for itself, and a preview
              that disagrees with the download is worse than no preview.
            */}
            <video src={videoUrl} controls className={cn(STAGE_MEDIA, "bg-black")} />
            <span className="absolute top-3 right-3.5 rounded-sm bg-[rgba(12,14,23,.72)] px-[7px] py-1 font-mono text-[9.5px] leading-none font-medium tracking-[0.12em] text-accent-300">
              {chosen?.label.toUpperCase()}
            </span>
          </CanvasStage>
        )}

        <StatStrip
          stats={[
            { label: "IN", value: formatFileSize(file.size), tone: "neutral" },
            { label: "OUT", value: result ? formatFileSize(result.blob.size) : "—" },
            {
              label: "NOW",
              value: status === "probing" ? "READING…" : probe === null ? "—" : orientationLabel(already),
              tone: "neutral",
            },
            {
              label: "AFTER",
              value: blocked ? "—" : orientationLabel(total),
              tone: "ok",
            },
          ]}
        />

        {probeError && <ErrorMessage message={probeError} />}
        {error && <ErrorMessage message={error} />}

        {/*
          Not an error: nothing failed, the file simply cannot carry the flag.
          It is said on drop rather than after a click that would have thrown.
        */}
        {refusal && <WarningMessage message={refusal} />}

        {/* The engine's own non-fatal notices — today, the "this file was
            already rotated, so the two were added" line. */}
        {result?.warnings?.map((warning) => (
          <WarningMessage key={warning} message={warning} />
        ))}

        {resultNote && <CanvasFootnote>{resultNote}</CanvasFootnote>}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {busy && (
              <ToolProgress
                phase={status === "probing" ? "READING THE VIDEO" : "WRITING THE ROTATION FLAG"}
                // The loader exposes no log hook, so FFmpeg reports no progress
                // here: one exec, one exit code. A percentage would be invented
                // — and at 6 ms there would be nothing to show it on.
                percent={null}
                label={status === "probing" ? "Reading this video" : "Rotating this video"}
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
              <ToolActions primaryLabel="Cancel" onPrimary={handleCancel} />
            ) : (
              <ToolActions
                primaryLabel="Rotate"
                onPrimary={handleRun}
                primaryDisabled={busy || blocked}
              />
            )}
            {status !== "processing" && (
              <ToolResetLink
                onClick={handleReset}
                label={result ? "ROTATE ANOTHER" : "CHANGE FILE"}
              />
            )}
          </>
        }
      >
        <ToolControlGroup>
          <ToolControl label="ROTATION">
            <ToolChoice
              label="Rotation"
              fill
              disabled={busy}
              value={degrees}
              onChange={handleDegrees}
              options={ROTATIONS}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              {already === 0
                ? "A quarter turn right, a half turn, or a quarter turn left."
                : `This video is already flagged as turned ${already}° to the right, and the new turn is added to that — it will end up ${
                    total === 0 ? "upright" : `${total}° to the right of upright`
                  }.`}
            </span>
          </ToolControl>
        </ToolControlGroup>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Turn", chosen?.label ?? `${degrees}°`],
              ["Ends up", blocked ? "—" : total === 0 ? "Upright" : `${total}° right of upright`],
              ["Out", result ? formatFileSize(result.blob.size) : "—"],
              [
                "Re-encoded",
                // Straight off the result, so this row cannot disagree with the
                // sentence on the canvas.
                result ? (result.streamCopied ? "No" : "Yes") : "—",
              ],
            ]}
          />
        </ToolAsideSection>

        <ToolAsideSection label="WHY THIS IS INSTANT">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Rotating a video normally means decoding every frame, turning it and encoding it again.
            This does not do that. It rewrites the rotation flag the file already carries — a
            handful of bytes — and copies the video and audio across untouched.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Measured on the same clip in this engine: 6 ms for the flag rewrite against 7,579 ms to
            re-encode the same rotation. About a thousand times faster, and lossless, because not
            one pixel is touched.
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="WHERE THE FLAG IS IGNORED">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {FLAG_CAVEAT}
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
