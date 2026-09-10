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
import type { RemuxPlan, RemuxResult, VideoContainer } from "@/lib/tools/video-remux";

/*
  The container tools: video-to-mp4 (the hub), mov-to-mp4, mp4-to-mov,
  mkv-to-mp4, mp4-to-mkv, avi-to-mp4. All six are the same interaction — we
  rewrite the container and leave the streams alone — so all six mount this
  component and differ only in the `target` the registry declares.

  THE PRE-FLIGHT PROBE IS THE POINT OF THIS TOOL, not a nicety.

  An iPhone .mov is routinely H.265. `-c copy` into .mp4 succeeds on such a
  file and produces a perfectly valid MP4 whose video is still H.265 — which
  is the exact thing that stopped it playing wherever the user was trying to
  put it. A tool that reported that run as a success would be lying by
  omission, so on every drop this component probes the file with ffprobe,
  asks `planRemux` what a rewrap into the target would actually cost, and
  refuses to start a re-encode the user has not asked for by name.

  The claim "nothing was re-encoded" is derived from `RemuxResult.streamCopied`
  and NEVER from the plan: the plan is what we intended to do, and only the
  result knows what ran.
*/

/** What the transcode arm targets. Measured: libx265 DEADLOCKS in this
    single-threaded core (no output for 80 s on one 320x240 frame), and
    libvpx-vp9 traps after ~25 frames, so H.264 is the only usable encoder. */
const TRANSCODE_CODEC_LABEL = "H.264";

/**
 * Said BEFORE a run, from the plan. Future tense on purpose: it is a
 * prediction, and it must not be mistakable for the post-run claim below.
 */
const COPY_PLAN_NOTE =
  "NOTHING WILL BE RE-ENCODED — THE VIDEO AND AUDIO ARE COPIED ACROSS BIT FOR BIT, WHICH TAKES MILLISECONDS.";

/**
 * Said AFTER a run, and ONLY when `RemuxResult.streamCopied` is true.
 *
 * Deriving this from the plan instead would print it over a run that
 * re-encoded — the silent-success class this whole cluster exists to avoid.
 */
const COPIED_RESULT_NOTE =
  "NOTHING WAS RE-ENCODED — THE VIDEO AND AUDIO WERE COPIED ACROSS BIT FOR BIT.";

/** The other half of the same fact, for a run that really did re-encode. */
const TRANSCODED_RESULT_NOTE = `THIS RUN RE-ENCODED THE VIDEO TO ${TRANSCODE_CODEC_LABEL} — THE PICTURE IN THE DOWNLOAD IS A NEW ENCODE, NOT YOUR ORIGINAL.`;

/**
 * ffprobe's `codec_name` is a short lowercase identifier; "hevc" is not what
 * anyone calls the thing their phone recorded. Unknown codecs fall back to the
 * probe's own string upper-cased rather than being guessed at.
 */
const CODEC_LABELS: Record<string, string> = {
  h264: "H.264",
  hevc: "H.265 (HEVC)",
  av1: "AV1",
  vp8: "VP8",
  vp9: "VP9",
  mpeg4: "MPEG-4 Part 2",
  mpeg2video: "MPEG-2",
  msmpeg4v3: "MS MPEG-4 v3",
  prores: "Apple ProRes",
  dvvideo: "DV",
  theora: "Theora",
  wmv3: "Windows Media Video 9",
};

function codecLabel(codec: string): string {
  return CODEC_LABELS[codec.toLowerCase()] ?? codec.toUpperCase();
}

/**
 * The one sentence that says what was found and why a straight rewrap is not
 * the answer. Built as ONE string so the sentence the user reads is the
 * sentence the tests assert.
 */
function transcodeFinding(probe: MediaProbe, target: VideoContainer): string {
  const found = probe.video ? codecLabel(probe.video.codec) : "not a video stream this tool knows";
  return (
    `This recording is ${found}. Rewrapping it would hand you a valid .${target} file whose video is ` +
    `still ${found}, so it would still refuse to play wherever it refused to play before. The only ` +
    `other way into .${target} is to re-encode to ${TRANSCODE_CODEC_LABEL}, which decodes and encodes ` +
    `every frame — slow, and it costs some quality. Nothing runs until you pick one.`
  );
}

/**
 * The estimate, hedged the way an estimate has to be. `null` means the engine
 * would not guess (an unknown duration), and inventing a number there would be
 * worse than saying so.
 */
function estimateHint(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) {
    return "Re-encoding walks the whole video frame by frame. There is no duration to estimate from here, so expect minutes rather than milliseconds.";
  }
  const rough = seconds < 90 ? `${Math.round(seconds)} seconds` : `${Math.round(seconds / 60)} minutes`;
  return `Roughly ${rough} — a rough figure from the clip's length. A slow laptop or a phone can take several times that, and the tab has to stay open.`;
}

export interface VideoRemuxUIProps {
  /** The container this page converts INTO. Comes from the registry. */
  target: VideoContainer;
  /** `Tool.acceptFormats`, so the zone's list cannot drift from the registry. */
  acceptFormats: string;
  /**
   * `Tool.maxSizeMB` — the cap `validateFFmpegInput` really enforces. Absent
   * renders "NO SIZE CAP" in the zone, so it is only passed where a limit
   * exists.
   */
  sizeCapMB?: number;
}

export function VideoRemuxUI({ target, acceptFormats, sizeCapMB }: VideoRemuxUIProps) {
  const [file, setFile] = useState<File | null>(null);
  // The hook revokes on unmount and on swap; a hand-rolled URL only revoked on
  // swap, so navigating away pinned the source blob for the tab.
  const videoUrl = useObjectUrl(file);
  const [probe, setProbe] = useState<MediaProbe | null>(null);
  const [plan, setPlan] = useState<RemuxPlan | null>(null);
  /*
    Kept apart from `error` on purpose: a failed probe is a fact about the
    FILE and must survive every control change, where a failed run is a fact
    about the last click and must not.
  */
  const [probeError, setProbeError] = useState<string | null>(null);
  /** The explicit choice. NEVER defaulted to true, and reset with the file. */
  const [allowTranscode, setAllowTranscode] = useState(false);
  const [status, setStatus] = useState<"idle" | "probing" | "processing" | "done" | "error">(
    "idle",
  );
  const [result, setResult] = useState<RemuxResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The doc pins a "Done in 12 ms" card above the primary once a run
  // finishes. Timed for real; cleared the moment the inputs change.
  const [elapsed, setElapsed] = useState<string | null>(null);

  /*
    A run is async and clearing the state around it is not enough on its own.
    Swap the file (or flip the transcode choice) while FFmpeg is working and
    the settling promise would still call setResult(), binding the OLD file's
    bytes to the NEW one — the download then hands over the wrong video under
    the right name, and the "nothing was re-encoded" line would describe a run
    the user is no longer looking at. The same fence covers the probe, which
    would otherwise classify a file that has already been replaced.

    Every invalidation bumps this token; a run captures it at the start and
    commits nothing unless it still matches. A ref, not state, because the
    check has to see the value at the moment the promise settles rather than
    the one captured when the callback was created.
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

  const handleFiles = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      runToken.current += 1;
      const token = runToken.current;
      abortRef.current?.abort();
      abortRef.current = null;
      setFile(f);
      setProbe(null);
      setPlan(null);
      setProbeError(null);
      // A new file is a new decision. Carrying the opt-in across would let the
      // second video be re-encoded on the first one's consent.
      setAllowTranscode(false);
      setResult(null);
      setElapsed(null);
      setError(null);
      setStatus("probing");

      void (async () => {
        try {
          const [{ probeMedia }, { planRemux }] = await Promise.all([
            import("@/lib/tools/video-probe"),
            import("@/lib/tools/video-remux"),
          ]);
          const found = await probeMedia(f);
          if (runToken.current !== token) return;
          setProbe(found);
          setPlan(planRemux(found, target));
          setStatus("idle");
        } catch (err) {
          if (runToken.current !== token) return;
          // Nothing here is safe on a file we could not read: without a codec
          // there is no way to know whether a copy would produce something
          // that plays, and guessing is the failure this tool exists to stop.
          setProbeError(
            err instanceof Error ? err.message : "This file could not be read as a video.",
          );
          setStatus("idle");
        }
      })();
    },
    [target],
  );

  const handleReset = useCallback(() => {
    runToken.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setFile(null);
    setProbe(null);
    setPlan(null);
    setProbeError(null);
    setAllowTranscode(false);
    setResult(null);
    setElapsed(null);
    setError(null);
    setStatus("idle");
  }, []);

  /*
    Flipping the decision changes what the next run produces, so it drops the
    finished output. Otherwise the rail could read "Re-encode" while Download
    still held the stream-copied file, with no primary left to re-run it.
  */
  const handleDecision = useCallback(
    (value: "no" | "yes") => {
      invalidate();
      setAllowTranscode(value === "yes");
    },
    [invalidate],
  );

  const handleCancel = useCallback(() => {
    runToken.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
  }, []);

  /** The plan, narrowed, so its `estimateSeconds` is reachable without a cast. */
  const transcodePlan = plan?.kind === "transcode" ? plan : null;
  // The one gate on the transcode path. A dead button plus the finding above
  // it is the honest state: there is a decision to make and nothing to run
  // until it is made.
  const blocked = probeError !== null || plan === null || (transcodePlan !== null && !allowTranscode);

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
      const { remuxVideo } = await import("@/lib/tools/video-remux");
      const out = await remuxVideo(
        file,
        target,
        // Never `true` off the plan: this is the user's own answer, and the
        // engine throws rather than transcoding when it is false.
        { allowTranscode },
        { signal: controller.signal },
      );
      // Superseded while it ran: the file or the decision changed under it, so
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
      setError(err instanceof Error ? err.message : "This video could not be converted.");
      setStatus("error");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [file, blocked, target, allowTranscode]);

  if (!file) {
    return (
      <DropZone
        accept={acceptFormats}
        sizeCapMB={sizeCapMB}
        sizeCapReason="The whole file is copied through an FFmpeg build running inside this page, so the tab has to hold the source and a same-sized copy at once."
        onFiles={handleFiles}
      />
    );
  }

  const busy = status === "probing" || status === "processing";
  const upper = target.toUpperCase();
  /*
    THE CLAIM, AND WHERE IT COMES FROM. Before a run this is the plan's
    prediction; after one it is `RemuxResult.streamCopied`, which is the only
    thing that knows what actually ran.
  */
  const resultNote = result
    ? result.streamCopied
      ? COPIED_RESULT_NOTE
      : TRANSCODED_RESULT_NOTE
    : plan?.kind === "copy"
      ? COPY_PLAN_NOTE
      : null;

  const modeValue = result
    ? result.streamCopied
      ? "COPIED"
      : "RE-ENCODED"
    : plan === null
      ? "—"
      : plan.kind === "copy"
        ? "COPY"
        : allowTranscode
          ? "RE-ENCODE"
          : "NEEDS A CHOICE";

  return (
    <>
      {/* ── Canvas: the clip, what is inside it, and what we did to it ── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={formatFileSize(file.size)}
          trailing={result ? formatFileSize(result.blob.size) : upper}
        />

        {videoUrl && (
          <CanvasStage className={cn(STAGE_GROW, "flex items-center justify-center bg-black")}>
            <video src={videoUrl} controls className={cn(STAGE_MEDIA, "bg-black")} />
            <span className="absolute top-3 right-3.5 rounded-sm bg-[rgba(12,14,23,.72)] px-[7px] py-1 font-mono text-[9.5px] leading-none font-medium tracking-[0.12em] text-accent-300">
              {upper}
            </span>
          </CanvasStage>
        )}

        <StatStrip
          stats={[
            { label: "IN", value: formatFileSize(file.size), tone: "neutral" },
            { label: "OUT", value: result ? formatFileSize(result.blob.size) : "—" },
            {
              label: "VIDEO",
              value:
                status === "probing"
                  ? "READING…"
                  : probe === null
                    ? "—"
                    : probe.video === null
                      ? "NO VIDEO TRACK"
                      : codecLabel(probe.video.codec),
              tone: "neutral",
            },
            {
              label: "MODE",
              value: modeValue,
              // Green only where the run was (or would be) lossless.
              tone: result
                ? result.streamCopied
                  ? "ok"
                  : "neutral"
                : plan?.kind === "copy"
                  ? "ok"
                  : "neutral",
            },
          ]}
        />

        {/*
          A failed probe is a fact about the LOAD, so it stays on the canvas
          where it appeared, and the primary stays shut behind it.
        */}
        {probeError && <ErrorMessage message={probeError} />}

        {error && <ErrorMessage message={error} />}

        {/*
          The finding. `role="status"` and the warning token, not the error
          red: nothing has failed — there is a decision to make, and the two
          costs are stated so it can be made.
        */}
        {transcodePlan && probe && !result && (
          <WarningMessage message={transcodeFinding(probe, target)} />
        )}

        {resultNote && <CanvasFootnote>{resultNote}</CanvasFootnote>}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {busy && (
              <ToolProgress
                phase={
                  status === "probing"
                    ? "READING THE VIDEO"
                    : allowTranscode
                      ? "RE-ENCODING"
                      : "REWRAPPING"
                }
                /*
                  The loader exposes no log hook, so FFmpeg reports no progress
                  of any kind here: one exec, one exit code. An invented
                  percentage would be a number we made up.
                */
                percent={null}
                label={status === "probing" ? "Reading this video" : `Converting to ${upper}`}
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
              <ToolActions primaryLabel="Convert" onPrimary={handleRun} primaryDisabled={busy || blocked} />
            )}
            {status !== "processing" && (
              <ToolResetLink onClick={handleReset} label={result ? "CONVERT ANOTHER" : "CHANGE FILE"} />
            )}
          </>
        }
      >
        {transcodePlan && (
          <ToolControlGroup>
            <ToolControl label={`RE-ENCODE TO ${TRANSCODE_CODEC_LABEL}?`}>
              <ToolChoice
                label={`Re-encode to ${TRANSCODE_CODEC_LABEL}`}
                fill
                disabled={busy}
                value={allowTranscode ? "yes" : "no"}
                onChange={handleDecision}
                options={[
                  { value: "no", label: "Don't convert" },
                  { value: "yes", label: `Re-encode to ${TRANSCODE_CODEC_LABEL}` },
                ]}
              />
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                {allowTranscode
                  ? estimateHint(transcodePlan.estimateSeconds)
                  : "Leave this alone and nothing runs. Your file is not touched either way — the original stays exactly as it is on your disk."}
              </span>
            </ToolControl>
          </ToolControlGroup>
        )}

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Container", upper],
              ["In", formatFileSize(file.size)],
              ["Out", result ? formatFileSize(result.blob.size) : "—"],
              [
                "Re-encoded",
                // Straight off the result, so this row cannot disagree with
                // the sentence on the canvas.
                result ? (result.streamCopied ? "No" : `Yes — ${TRANSCODE_CODEC_LABEL}`) : "—",
              ],
            ]}
          />
        </ToolAsideSection>

        {/* The engine's own account of the plan, in its own words. */}
        {plan && (
          <ToolAsideSection label="WHAT THIS FILE NEEDS">
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              {plan.reason}
            </span>
          </ToolAsideSection>
        )}

        <ToolAsideSection label="WHAT THIS DOES">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            A container is the wrapper around the video and audio already in your file. Changing it
            copies those streams into a new wrapper without decoding them, so the picture and the
            sound in the download are the same bytes that went in, and the run takes milliseconds
            rather than minutes.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            That only works when {upper} can carry what is inside your file. When it cannot — an
            iPhone recording in H.265 is the common case — this page says so and asks before
            re-encoding anything. It will not quietly hand you a {upper} that still refuses to
            play.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
