"use client";

import { useCallback, useMemo, useRef, useState } from "react";
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
import { getToolBySlug } from "@/data/tools";
import type { MediaProbe } from "@/lib/tools/video-probe";
import {
  MAX_SEGMENTS,
  MIN_SEGMENT_SECONDS,
  parseCutTimes,
  planSegments,
  type SegmentPlan,
  type SplitMode,
  type SplitVideoOptions,
  type SplitVideoResult,
} from "@/lib/tools/video-split";

/*
  split-video: cut one clip into several without decoding a frame.

  Every part is a `-ss S -i IN -t D -c copy` run, so the picture and sound in
  each part are the bytes that were in the source. What that costs — and this
  page says it in three separate places, because it is the one surprise the
  tool has — is that a stream copy can only cut at a keyframe. The boundary
  moves back to the nearest one, so a part starts a little earlier than asked
  and runs a little longer. Measured against the shipped core on the repo's
  2.090 s fixture:

      asked for 1.000 s from 0     ->  1.022 s
      asked for 1.000 s from 1     ->  1.022 s
      asked for 1.000 s from 0.5   ->  1.510 s  (the seek snapped back to 0)

  So the table below has TWO length columns: what was asked for, and what the
  written file measured. The second is read back off each part with ffprobe. A
  page that showed only the first would be describing files that do not exist.
*/

/*
  Read from the registry so the zone, the spec panel and the page all say one
  number. The fallbacks are only for the window in which this component exists
  and its registry row does not; `getToolBySlug` returns undefined then.
*/
const TOOL = getToolBySlug("split-video");
const ACCEPT = TOOL?.acceptFormats ?? ".mp4,.webm,.mov,.avi,.mkv";

const SIZE_CAP_REASON =
  "Each part is copied out of the source at full quality, so the tab has to hold the video and its parts at once.";

const MODES: readonly { value: SplitMode; label: string }[] = [
  { value: "equal-parts", label: "Equal parts" },
  { value: "fixed-duration", label: "Every N sec" },
  { value: "at-times", label: "At times" },
];

const PART_COUNTS = [2, 3, 4, 5, 6, 8, 10];
const PART_LENGTHS = [10, 15, 30, 60, 120, 300];

/**
 * `95.4` -> `1:35.4`. Seconds alone below a minute, so short clips stay readable.
 *
 * ⚠ THE ROUNDING HAPPENS BEFORE THE SPLIT INTO MINUTES, AND IT HAS TO.
 * Decomposing the raw value and rounding only the seconds field lets the two
 * halves disagree at a boundary, and both branches of the old line were wrong
 * in the last 50 ms of a step:
 *
 *     119.96  ->  minutes 1, rest 59.96 -> toFixed(1) "60.0"  ->  "1:60.0"
 *     69.96   ->  rest 9.96 pads (< 10) and then rounds to 10 ->  "1:010.0"
 *
 * `actualSeconds` is a raw ffprobe decimal — never pre-rounded — and it is the
 * column this page tells people to trust, so it cannot print a clock value no
 * clock permits. Rounding to the printed tenth first makes those "2:00.0" and
 * "1:10.0".
 */
function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${seconds.toFixed(2)} s`;
  const tenths = Math.round(seconds * 10) / 10;
  const minutes = Math.floor(tenths / 60);
  const rest = tenths - minutes * 60;
  return `${minutes}:${rest < 10 ? "0" : ""}${rest.toFixed(1)}`;
}

export function SplitVideoUI() {
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

  const [mode, setMode] = useState<SplitMode>("equal-parts");
  const [parts, setParts] = useState(3);
  const [segmentSeconds, setSegmentSeconds] = useState(30);
  const [cutTimesText, setCutTimesText] = useState("");

  const [status, setStatus] = useState<"idle" | "probing" | "processing" | "done" | "error">(
    "idle",
  );
  const [result, setResult] = useState<SplitVideoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  /*
    A run is async and clearing the state around it does not stop it. Change
    the mode (or the file) mid-run and the settling promise would still call
    setResult(), binding four parts to a rail that now reads "every 30 s".
    Every invalidation bumps this token; a run captures it at the start and
    commits nothing unless it still matches.
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
    setProgress(0);
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
    setProgress(0);
    setStatus("idle");
  }, []);

  const handleCancel = useCallback(() => {
    runToken.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
  }, []);

  const cuts = useMemo(() => parseCutTimes(cutTimesText), [cutTimesText]);

  const options: SplitVideoOptions = useMemo(
    () => ({ mode, parts, segmentSeconds, cutTimes: cuts.times }),
    [mode, parts, segmentSeconds, cuts.times],
  );

  const sourceSeconds = probe?.durationSeconds ?? null;

  /*
    The plan, worked out on the page from the SAME pure function the engine
    calls. Every refusal below therefore mirrors a throw inside `splitVideo`
    exactly — the user meets it while choosing, not after a click that would
    have failed. (`planSegments` throws to report a refusal, which is what the
    engine needs; here that becomes a message beside the button.)
  */
  const plan = useMemo<{ segments: SegmentPlan[] | null; refusal: string | null }>(() => {
    // Nothing has been read yet, or the read failed: the stat strip says
    // READING… and `probeError` owns the failure. No refusal to make.
    if (probe === null) return { segments: null, refusal: null };
    /*
      ⚠ THE PROBE SUCCEEDED AND STILL HAS NO LENGTH. Measured: a WebM written by
      MediaRecorder — which is exactly what this site's own screen, webcam and
      audio recorders produce — probes fine (`format_name` present, video stream
      present) with the `duration` key simply ABSENT, so `durationSeconds` is
      null. Without this branch the page showed LENGTH "—", PARTS "—", a dead
      button and not one word of explanation, because the only message channel
      below is gated on `plan.refusal`. `splitVideo` refuses this file too; this
      is that refusal, said while the user is still looking at the file.
    */
    if (sourceSeconds === null) {
      return {
        segments: null,
        refusal:
          "This file does not carry how long it is — recordings written by a browser, including the ones this site's own screen and webcam recorders produce, often have no duration in their header. Every cut is worked out from that length, so there is nothing here to plan against. Re-wrap it with the Video to MP4 tool first and the length becomes readable.",
      };
    }
    try {
      return { segments: planSegments(sourceSeconds, options), refusal: null };
    } catch (err) {
      return {
        segments: null,
        refusal: err instanceof Error ? err.message : "These settings cannot be cut.",
      };
    }
  }, [probe, sourceSeconds, options]);

  const noVideoTrack = probe !== null && probe.video === null;
  const blocked =
    probeError !== null || probe === null || noVideoTrack || plan.segments === null;

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
    setProgress(0);
    const startedAt = performance.now();
    try {
      const { splitVideo } = await import("@/lib/tools/video-split");
      const out = await splitVideo(file, options, {
        signal: controller.signal,
        onProgress: (pct) => {
          if (runToken.current === token) setProgress(pct);
        },
      });
      // Superseded while it ran — the surface has already been reset for a
      // file or a setting these parts do not describe.
      if (runToken.current !== token) return;
      setResult(out);
      const ms = performance.now() - startedAt;
      setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
      setStatus("done");
    } catch (err) {
      if (runToken.current !== token) return;
      setError(err instanceof Error ? err.message : "This video could not be split.");
      setStatus("error");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [file, blocked, options]);

  if (!file) {
    return (
      <DropZone
        accept={ACCEPT}
        sizeCapMB={TOOL?.maxSizeMB}
        sizeCapReason={SIZE_CAP_REASON}
        onFiles={handleFiles}
      />
    );
  }

  const busy = status === "probing" || status === "processing";
  const partCount = result?.segments.length ?? plan.segments?.length ?? 0;

  /*
    One row per part. Before a run the ACTUAL column is empty, because nothing
    has been written yet and the requested length is not a prediction this page
    is willing to print twice.
  */
  const rows =
    result?.segments.map((s) => ({
      key: s.fileName,
      name: s.fileName,
      range: `${formatSeconds(s.requestedStart)} → ${formatSeconds(s.requestedEnd)}`,
      asked: formatSeconds(s.requestedEnd - s.requestedStart),
      actual: formatSeconds(s.actualSeconds),
      size: formatFileSize(s.blob.size),
    })) ??
    plan.segments?.map((s) => ({
      key: `plan-${s.index}`,
      name: `Part ${s.index + 1}`,
      range: `${formatSeconds(s.start)} → ${formatSeconds(s.end)}`,
      asked: formatSeconds(s.end - s.start),
      actual: "—",
      size: "—",
    })) ??
    [];

  return (
    <>
      {/* ── Canvas: the clip, the parts it becomes, and what they came out as ── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={formatFileSize(file.size)}
          trailing={partCount > 0 ? `${partCount} PARTS` : undefined}
        />

        {videoUrl && !result && (
          <CanvasStage className={cn(STAGE_GROW, "flex items-center justify-center bg-black")}>
            <video src={videoUrl} controls className={cn(STAGE_MEDIA, "bg-black")} />
          </CanvasStage>
        )}

        {rows.length > 0 && (
          <div className="flex flex-col overflow-hidden rounded-[10px] border border-neutral-800 bg-bg-primary">
            <div className="grid grid-cols-[26px_1fr_84px_84px_74px] gap-3 border-b border-border px-3.5 py-[9px] font-mono text-[9.5px] leading-none font-medium tracking-[0.1em] text-text-muted">
              <span>#</span>
              <span>FROM → TO</span>
              <span className="text-right">ASKED</span>
              <span className="text-right">ACTUAL</span>
              <span className="text-right">SIZE</span>
            </div>
            {rows.map((row, i) => (
              <div
                key={row.key}
                className="grid grid-cols-[26px_1fr_84px_84px_74px] items-center gap-3 border-b border-text-primary/6 px-3.5 py-[11px] font-body text-xs leading-none last:border-b-0"
              >
                <span className="font-mono text-[10.5px] text-text-muted">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="truncate text-neutral-300">{row.range}</span>
                <span className="text-right font-mono text-[11px] text-text-muted">
                  {row.asked}
                </span>
                {/* The measured length, accented because it is the one that
                    describes the file the user is about to download. */}
                <span className="text-right font-mono text-[11px] text-accent-300">
                  {row.actual}
                </span>
                <span className="text-right font-mono text-[11px] text-text-muted">
                  {row.size}
                </span>
              </div>
            ))}
          </div>
        )}

        <StatStrip
          stats={[
            { label: "IN", value: formatFileSize(file.size), tone: "neutral" },
            {
              label: "LENGTH",
              value:
                status === "probing"
                  ? "READING…"
                  : sourceSeconds === null
                    ? "—"
                    : formatSeconds(sourceSeconds),
              tone: "neutral",
            },
            { label: "PARTS", value: partCount > 0 ? String(partCount) : "—", tone: "ok" },
            { label: "ZIP", value: result ? formatFileSize(result.newSize) : "—" },
          ]}
        />

        {probeError && <ErrorMessage message={probeError} />}
        {error && <ErrorMessage message={error} />}

        {noVideoTrack && (
          <WarningMessage message="There is no video track in this file, so there is nothing here to cut." />
        )}

        {/*
          Not an error: nothing failed, the settings simply do not describe a
          cut. Said while the user is choosing rather than after a click.
        */}
        {!noVideoTrack && plan.refusal && <WarningMessage message={plan.refusal} />}

        {cuts.invalid.length > 0 && mode === "at-times" && (
          <WarningMessage
            message={`Couldn't read ${cuts.invalid.join(", ")} as a time, so ${cuts.invalid.length === 1 ? "it was" : "they were"} left out. Use seconds (90) or minutes and seconds (1:30).`}
          />
        )}

        {result?.warnings?.map((warning) => (
          <WarningMessage key={warning} message={warning} />
        ))}

        {result && (
          <CanvasFootnote>
            NOT ONE FRAME WAS RE-ENCODED — EVERY PART HOLDS THE ORIGINAL PICTURE AND SOUND, BYTE
            FOR BYTE.
          </CanvasFootnote>
        )}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {busy && (
              <ToolProgress
                phase={status === "probing" ? "READING THE VIDEO" : "CUTTING"}
                // One exec per part, so this is a real count of finished parts
                // rather than FFmpeg's own per-exec sweep.
                percent={status === "processing" ? progress : null}
                label={status === "probing" ? "Reading this video" : "Cutting this video"}
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
                primaryLabel={partCount > 0 ? `Cut into ${partCount} parts` : "Split"}
                onPrimary={handleRun}
                primaryDisabled={busy || blocked}
              />
            )}
            {status !== "processing" && (
              <ToolResetLink
                onClick={handleReset}
                label={result ? "SPLIT ANOTHER" : "CHANGE FILE"}
              />
            )}
          </>
        }
      >
        <ToolControlGroup>
          <ToolControl label="HOW TO CUT">
            <ToolChoice
              label="Split mode"
              fill
              disabled={busy}
              value={mode}
              onChange={(value) => {
                invalidate();
                setMode(value);
              }}
              options={MODES}
            />
          </ToolControl>

          {mode === "equal-parts" && (
            <ToolControl label="NUMBER OF PARTS">
              <ToolChoice
                label="Number of parts"
                fill
                disabled={busy}
                value={parts}
                onChange={(value) => {
                  invalidate();
                  setParts(value);
                }}
                options={PART_COUNTS.map((n) => ({ value: n, label: String(n) }))}
              />
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                {sourceSeconds
                  ? `Each part is about ${formatSeconds(sourceSeconds / parts)} of this ${formatSeconds(sourceSeconds)} video.`
                  : "The video is divided into parts of the same length."}
              </span>
            </ToolControl>
          )}

          {mode === "fixed-duration" && (
            <ToolControl label="PART LENGTH">
              <ToolChoice
                label="Part length in seconds"
                fill
                disabled={busy}
                value={segmentSeconds}
                onChange={(value) => {
                  invalidate();
                  setSegmentSeconds(value);
                }}
                options={PART_LENGTHS.map((n) => ({
                  value: n,
                  label: n < 60 ? `${n}s` : `${n / 60}m`,
                }))}
              />
              {/*
                What the planner actually does. It emits the leftover as its
                own shorter final part and only folds a remainder under
                MIN_SEGMENT_SECONDS into the part before it — see the note on
                `interiorCuts` in video-split.ts. The part table beside this
                already shows that outcome before the click, so the sentence
                has to agree with it.
              */}
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                Cuts every {formatSeconds(segmentSeconds)}. Whatever is left at the end becomes a
                final, shorter part of its own — only a remainder under {MIN_SEGMENT_SECONDS} s,
                too short to write as a playable file, is folded into the part before it.
              </span>
            </ToolControl>
          )}

          {mode === "at-times" && (
            <ToolControl label="CUT AT">
              <input
                type="text"
                value={cutTimesText}
                onChange={(e) => {
                  invalidate();
                  setCutTimesText(e.target.value);
                }}
                placeholder="0:30, 1:15, 2:00"
                aria-label="Times to cut at"
                disabled={busy}
                className="w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              />
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                Seconds (90) or minutes and seconds (1:30), separated by commas. Each time is where
                one part ends and the next begins, so three times give four parts.
              </span>
            </ToolControl>
          )}
        </ToolControlGroup>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Parts", partCount > 0 ? String(partCount) : "—"],
              ["Re-encoded", result ? "No" : "No — never"],
              ["Download", result ? result.fileName : "One ZIP of all the parts"],
              ["Size", result ? formatFileSize(result.newSize) : "—"],
            ]}
          />
        </ToolAsideSection>

        <ToolAsideSection label="WHY THE PARTS ARE NOT EXACT">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Splitting normally means decoding every frame and encoding it again. This does not do
            that — it copies the picture and sound straight across, which is why it is fast and why
            nothing is lost. The price is that a copy can only cut at a keyframe, so each boundary
            moves back to the nearest one and a part starts slightly earlier, and runs slightly
            longer, than you asked for.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Measured in this engine on a 2.09 s clip: a part asked to be 1.000 s came out 1.022 s,
            and one asked to start at 0.5 s and run 1.0 s came out 1.510 s, because the seek
            snapped back to the keyframe at the start of the file. The ACTUAL column above is read
            back off each finished part, so it is what you are downloading — not what was asked
            for.
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="WHAT YOU GET">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Every part keeps the original format and quality, and they are all saved together in
            one ZIP — browsers cancel most of a burst of separate downloads, so a single archive is
            the only way all of them arrive. At most {MAX_SEGMENTS} parts in one go: each part is
            its own pass through the engine.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
