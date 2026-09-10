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
import { ToolProgress } from "@/components/tools/ToolControls";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { CANVAS_COLUMN, STAGE_GROW, STAGE_MEDIA } from "@/components/workspace/shared";
import { cn } from "@/lib/utils/cn";
import type { MediaProbe } from "@/lib/tools/video-probe";
import type { RemuxResult } from "@/lib/tools/video-remux";

/*
  mute-video: drop the audio track and copy the video across untouched.

  One argv (`-i in -an -c copy out`), measured at 7 ms on the sample clip. The
  only judgement in the tool is the pre-flight: `-an` on a file that has no
  audio track in the first place succeeds, produces a near-identical file, and
  would be reported as "audio removed" — a success for work that never
  happened. So the drop probes the file, and a file with nothing to remove is
  told so instead of being quietly re-muxed.
*/

/** Said AFTER a run, and ONLY when `RemuxResult.streamCopied` is true. */
const COPIED_RESULT_NOTE =
  "THE AUDIO TRACK IS GONE AND THE PICTURE WAS NOT RE-ENCODED — THE VIDEO WAS COPIED ACROSS BIT FOR BIT.";

/** The other half of the same fact, for a run that did not stream-copy. */
const TRANSCODED_RESULT_NOTE =
  "THE AUDIO TRACK IS GONE, BUT THIS RUN DID NOT COPY THE VIDEO ACROSS UNTOUCHED — THE PICTURE IN THE DOWNLOAD IS A NEW ENCODE.";

/** The pre-flight's one refusal. Stated as a fact about the file, not a failure. */
const NO_AUDIO_MESSAGE =
  "This video has no audio track, so there is nothing here to remove. Muting it would hand you back a copy of the file you already have.";

export interface MuteVideoUIProps {
  /** `Tool.acceptFormats`, so the zone's list cannot drift from the registry. */
  acceptFormats: string;
  /** `Tool.maxSizeMB` — the cap `validateFFmpegInput` really enforces. */
  sizeCapMB?: number;
}

export function MuteVideoUI({ acceptFormats, sizeCapMB }: MuteVideoUIProps) {
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
  const [status, setStatus] = useState<"idle" | "probing" | "processing" | "done" | "error">(
    "idle",
  );
  const [result, setResult] = useState<RemuxResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<string | null>(null);

  /*
    A run is async and nothing about clearing state stops it. Swap the file
    while FFmpeg is working and the settling promise would still call
    setResult(), binding the OLD video's bytes to the NEW file — the download
    then hands over the wrong video under the right name. Every invalidation
    bumps this token; a run captures it at the start and commits nothing
    unless it still matches. A ref, not state, because the check has to see the
    value at the moment the promise settles.
  */
  const runToken = useRef(0);
  /** Cancelling an FFmpeg job means terminating its worker; this is the wire. */
  const abortRef = useRef<AbortController | null>(null);

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

  const handleCancel = useCallback(() => {
    runToken.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
  }, []);

  /** True once the probe has landed and found no audio stream at all. */
  const noAudio = probe !== null && probe.audio === null;
  const blocked = probeError !== null || probe === null || noAudio;

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
      const { muteVideo } = await import("@/lib/tools/video-remux");
      const out = await muteVideo(file, { signal: controller.signal });
      // Superseded while it ran — the surface has already been reset for a
      // file this output does not describe.
      if (runToken.current !== token) return;
      setResult(out);
      // Measured at 7 ms on the sample clip; "Done in 0.0 s" would read like a
      // stopwatch that never started.
      const ms = performance.now() - startedAt;
      setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
      setStatus("done");
    } catch (err) {
      if (runToken.current !== token) return;
      setError(err instanceof Error ? err.message : "The audio could not be removed.");
      setStatus("error");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [file, blocked]);

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
     knows whether the picture survived untouched. */
  const resultNote = result
    ? result.streamCopied
      ? COPIED_RESULT_NOTE
      : TRANSCODED_RESULT_NOTE
    : null;

  const audioValue =
    status === "probing"
      ? "READING…"
      : probe === null
        ? "—"
        : probe.audio === null
          ? "NONE"
          : probe.audio.codec.toUpperCase();

  return (
    <>
      {/* ── Canvas: the clip, its audio track, and what happened to it ── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={formatFileSize(file.size)}
          trailing={result ? formatFileSize(result.blob.size) : "NO AUDIO"}
        />

        {videoUrl && (
          <CanvasStage className={cn(STAGE_GROW, "flex items-center justify-center bg-black")}>
            <video src={videoUrl} controls className={cn(STAGE_MEDIA, "bg-black")} />
          </CanvasStage>
        )}

        <StatStrip
          stats={[
            { label: "IN", value: formatFileSize(file.size), tone: "neutral" },
            { label: "OUT", value: result ? formatFileSize(result.blob.size) : "—" },
            { label: "AUDIO", value: audioValue, tone: "neutral" },
            {
              label: "VIDEO",
              value: result ? (result.streamCopied ? "COPIED" : "RE-ENCODED") : "UNTOUCHED",
              tone: result && !result.streamCopied ? "neutral" : "ok",
            },
          ]}
        />

        {probeError && <ErrorMessage message={probeError} />}
        {error && <ErrorMessage message={error} />}

        {/*
          Nothing has failed — the file simply has no audio in it. `role=status`
          and the warning token say that without dressing it as an error.
        */}
        {noAudio && !result && <WarningMessage message={NO_AUDIO_MESSAGE} />}

        {resultNote && <CanvasFootnote>{resultNote}</CanvasFootnote>}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {busy && (
              <ToolProgress
                phase={status === "probing" ? "READING THE VIDEO" : "REMOVING AUDIO"}
                // The loader exposes no log hook, so FFmpeg reports no progress
                // here: one exec, one exit code. A percentage would be invented.
                percent={null}
                label={status === "probing" ? "Reading this video" : "Removing the audio track"}
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
                primaryLabel="Remove audio"
                onPrimary={handleRun}
                primaryDisabled={busy || blocked}
              />
            )}
            {status !== "processing" && (
              <ToolResetLink onClick={handleReset} label={result ? "MUTE ANOTHER" : "CHANGE FILE"} />
            )}
          </>
        }
      >
        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Audio track", audioValue === "NONE" ? "None" : audioValue],
              ["In", formatFileSize(file.size)],
              ["Out", result ? formatFileSize(result.blob.size) : "—"],
              [
                "Video re-encoded",
                // Straight off the result, so this row cannot disagree with the
                // sentence on the canvas.
                result ? (result.streamCopied ? "No" : "Yes") : "—",
              ],
            ]}
          />
        </ToolAsideSection>

        <ToolAsideSection label="WHAT THIS DOES">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            The audio track is dropped and the video track is copied into the new file without
            being decoded, so the picture in the download is the same bytes that went in and the
            run takes milliseconds. The container stays what it was.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            The audio is removed from the copy, not from your file — your original keeps its sound
            and is not touched.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
