"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolDone,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import { ToolProgress } from "@/components/tools/ToolControls";
import { CanvasFootnote, CanvasHeader, StatStrip } from "@/components/tools/ToolCanvas";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { cn } from "@/lib/utils/cn";
import { getToolBySlug } from "@/data/tools";
import {
  codecLabel,
  compareMergeInputs,
  containerLabel,
  describeSizeRefusal,
  MERGE_TOTAL_MAX_BYTES,
  type MergeInputInfo,
  type MergeVideoResult,
} from "@/lib/tools/video-merge";

/*
  merge-video: join clips end to end with FFmpeg's concat demuxer and `-c copy`.
  Nothing is decoded, nothing is encoded, and the output holds the exact bytes
  that were in the inputs.

  ⚠ WHY THE MISMATCH TABLE IS THE PRODUCT, NOT AN ERROR PAGE
  Measured 2026-09-05 against the shipped core: given two clips whose
  parameters differ, the concat demuxer EXITS 0 AND WRITES A FILE CONTAINING
  ONLY THE FIRST ONE. `sample-video.mp4` joined to `sample-video.mkv` — same
  H.264, same 320x240, same yuv420p, same AAC 44.1 kHz stereo, differing only
  in container — expected 4.180 s, produced 2.090 s, exit code 0, no error
  message anywhere.

  So a page that just called `mergeVideos` and offered the download would hand
  people a truncated video and call it a success. Instead every clip is probed
  as it lands, `compareMergeInputs` says exactly which property differs, and
  the table below shows it before anything runs. `mergeVideos` then re-checks
  for itself AND measures the finished file against the total length of its
  parts — refusing in BOTH directions, because a join that comes out LONGER
  than its parts has re-timed a track rather than copied it (measured: 6.39 s
  written for 4.18 s of clips, the picture ending 2.2 s after its own sound) —
  so neither guard depends on this page having been used.

  ⚠ EVERY REFUSAL ON THIS PAGE ARRIVES BEFORE THE CLICK, INCLUDING THE SIZE ONE.
  The zone caps each clip, but the engine's ceiling is the TOTAL across the
  queue, so a queue built entirely out of legal files can still be refused.
  That refusal is computed here from the same exported function `mergeVideos`
  throws with, and it blocks the button — the mismatch table's own principle,
  applied to the one guard that used to break it.

  D3, recorded: v1 has no transcode fallback. Offering one would mean encoding
  with libx264 on the one tool whose whole pitch is "nothing is re-encoded".
  Naming the difference, and the tool that fixes it, is the better answer.
*/

/*
  Read from the registry so the zone and the spec panel say one thing. The
  fallback covers the window in which this component exists and its registry
  row does not.
*/
const TOOL = getToolBySlug("merge-video");
const ACCEPT = TOOL?.acceptFormats ?? ".mp4,.mov,.mkv,.webm";

/** "1.5 GB" — the same string the zone's own badge prints for this cap. */
const TOTAL_CAP_LABEL = formatFileSize(MERGE_TOTAL_MAX_BYTES);

const SIZE_CAP_REASON = `The clips are copied into one file inside this tab, so it has to hold the parts and the whole at once — which is why ${TOTAL_CAP_LABEL} is the total for the whole queue, not each clip.`;

/** `95.4` -> `1:35.4`. Seconds alone below a minute, so short clips stay readable. */
function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${seconds.toFixed(2)} s`;
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest < 10 ? "0" : ""}${rest.toFixed(1)}`;
}

/** The one-line description of what is inside a clip, for the queue row. */
function describeStreams(info: MergeInputInfo): string {
  const parts = [containerLabel(info.container)];
  if (info.videoCodec) {
    parts.push(
      info.width && info.height
        ? `${codecLabel(info.videoCodec)} ${info.width}×${info.height}`
        : codecLabel(info.videoCodec),
    );
  }
  parts.push(info.audioCodec ? codecLabel(info.audioCodec) : "no audio");
  return parts.join(" · ");
}

export function MergeVideoUI() {
  const [files, setFiles] = useState<File[]>([]);
  /*
    Each clip is probed ONCE, when it lands, and the answer is kept against the
    File itself. Reordering changes which clip is the reference and therefore
    changes the mismatches — but `compareMergeInputs` is pure, so a reorder
    re-runs the comparison without touching FFmpeg again.
  */
  const [infoByFile, setInfoByFile] = useState<Map<File, MergeInputInfo>>(new Map());
  const [probeErrors, setProbeErrors] = useState<Map<File, string>>(new Map());

  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [result, setResult] = useState<MergeVideoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  /*
    Every mutation of the queue invalidates the join that came out of the old
    queue. A ref, not state, because the check has to see the value at the
    moment an async run settles.
  */
  const runToken = useRef(0);
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
    (newFiles: File[]) => {
      if (newFiles.length === 0) return;
      invalidate();
      setFiles((prev) => [...prev, ...newFiles]);

      void (async () => {
        const { checkMergeCompatibility } = await import("@/lib/tools/video-merge");
        for (const f of newFiles) {
          try {
            // One file in, so this only probes — the comparison it also
            // returns has nothing to compare against.
            const { infos } = await checkMergeCompatibility([f]);
            setInfoByFile((prev) => new Map(prev).set(f, infos[0]));
          } catch (err) {
            setProbeErrors((prev) =>
              new Map(prev).set(
                f,
                err instanceof Error ? err.message : "This file could not be read as a video.",
              ),
            );
          }
        }
      })();
    },
    [invalidate],
  );

  const removeFile = useCallback(
    (index: number) => {
      invalidate();
      setFiles((prev) => prev.filter((_, i) => i !== index));
    },
    [invalidate],
  );

  const moveFile = useCallback(
    (from: number, to: number) => {
      invalidate();
      setFiles((prev) => {
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
    },
    [invalidate],
  );

  const handleReset = useCallback(() => {
    runToken.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setFiles([]);
    setInfoByFile(new Map());
    setProbeErrors(new Map());
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

  /** The probed clips, in join order. Absent entries are still being read. */
  const infos = useMemo(
    () => files.map((f) => infoByFile.get(f)).filter((i): i is MergeInputInfo => i !== undefined),
    [files, infoByFile],
  );
  /*
    Derived, not a flag. A `probing` boolean set false at the end of one drop
    would be turned off by the FIRST batch to finish while a second was still
    reading; and a `probeErrors` map keyed by File keeps entries for clips the
    user has since removed, which would block the join forever. Both questions
    are answered exactly by looking at the queue that exists right now.
  */
  const unreadable = useMemo(() => files.filter((f) => probeErrors.has(f)), [files, probeErrors]);
  const probing = useMemo(
    () => files.some((f) => !infoByFile.has(f) && !probeErrors.has(f)),
    [files, infoByFile, probeErrors],
  );
  const allProbed = infos.length === files.length && unreadable.length === 0;

  // Pure, and the same function `mergeVideos` refuses on — so what the table
  // says and what the engine does cannot drift apart.
  const mismatches = useMemo(
    () => (allProbed ? compareMergeInputs(infos) : []),
    [allProbed, infos],
  );

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const totalSeconds = infos.reduce((sum, i) => sum + i.durationSeconds, 0);
  const firstProbeError = unreadable.length > 0 ? (probeErrors.get(unreadable[0]) ?? null) : null;

  /*
    The size refusal, in the same sentence and against the same threshold the
    engine uses — imported, not restated. The drop zone's cap is per file, so
    this is the only surface that can catch a queue whose parts are each legal
    and whose total is not.
  */
  const sizeRefusal = useMemo(() => describeSizeRefusal(files), [files]);

  const blocked =
    files.length < 2 ||
    probing ||
    !allProbed ||
    mismatches.length > 0 ||
    sizeRefusal !== null ||
    status === "processing";

  const handleMerge = useCallback(async () => {
    if (blocked) return;
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
      const { mergeVideos } = await import("@/lib/tools/video-merge");
      const out = await mergeVideos(files, {
        signal: controller.signal,
        onProgress: (pct) => {
          if (runToken.current === token) setProgress(pct);
        },
      });
      if (runToken.current !== token) return;
      setResult(out);
      const ms = performance.now() - startedAt;
      setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
      setStatus("done");
    } catch (err) {
      if (runToken.current !== token) return;
      setError(err instanceof Error ? err.message : "These clips could not be joined.");
      setStatus("error");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [blocked, files]);

  return (
    <>
      {/* ── Canvas: the queue, in the order it will be joined ── */}
      <div className={CANVAS_COLUMN}>
        <DropZone
          accept={ACCEPT}
          multiple
          sizeCapMB={TOOL?.maxSizeMB}
          sizeCapReason={SIZE_CAP_REASON}
          onFiles={handleFiles}
          disabled={status === "processing"}
        />

        {files.length > 0 && (
          <>
            <CanvasHeader
              file="Join order"
              meta={`${files.length} CLIPS · ${formatFileSize(totalSize)}`}
              trailing={
                probing
                  ? "READING…"
                  : mismatches.length > 0
                    ? "CAN'T JOIN"
                    : sizeRefusal
                      ? "TOO BIG"
                      : allProbed && files.length > 1
                        ? "READY"
                        : undefined
              }
              trailingTone={mismatches.length > 0 || sizeRefusal ? "muted" : "accent"}
            />

            <div className="flex flex-col overflow-hidden rounded-[10px] border border-neutral-800 bg-bg-primary">
              {files.map((file, index) => {
                const info = infoByFile.get(file);
                const failed = probeErrors.get(file);
                const offending = mismatches.some((m) => m.fileName === file.name);
                return (
                  <div
                    key={`${file.name}-${index}`}
                    className="flex items-center gap-3.5 border-b border-border px-4 py-3 last:border-b-0"
                  >
                    <span className="w-5 flex-none font-mono text-[10px] leading-none text-text-muted">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="truncate font-body text-xs leading-none text-neutral-300">
                        {file.name}
                      </span>
                      {/* What is actually inside it — the fields the join is
                          refused on, so the table below is never the first
                          time the user sees them. */}
                      <span
                        className={cn(
                          "truncate font-mono text-[10px] leading-none",
                          // Accented on a clip that is blocking the join, so
                          // the row and the table below point at the same file.
                          offending || failed ? "text-accent-300" : "text-text-muted",
                        )}
                      >
                        {failed
                          ? "COULD NOT BE READ"
                          : info
                            ? `${formatSeconds(info.durationSeconds)} · ${describeStreams(info)}`
                            : "READING…"}
                      </span>
                    </span>
                    <span className="flex-none font-mono text-[10px] leading-none text-text-muted">
                      {formatFileSize(file.size)}
                    </span>
                    <div className="flex flex-none items-center gap-1">
                      <button
                        onClick={() => index > 0 && moveFile(index, index - 1)}
                        disabled={index === 0 || status === "processing"}
                        className="cursor-pointer rounded p-1 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-30"
                        aria-label="Move up"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polyline points="18 15 12 9 6 15" />
                        </svg>
                      </button>
                      <button
                        onClick={() => index < files.length - 1 && moveFile(index, index + 1)}
                        disabled={index === files.length - 1 || status === "processing"}
                        className="cursor-pointer rounded p-1 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-30"
                        aria-label="Move down"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>
                      <button
                        onClick={() => removeFile(index)}
                        disabled={status === "processing"}
                        className="cursor-pointer rounded p-1 text-text-muted transition-colors hover:bg-bg-hover hover:text-error disabled:opacity-30"
                        aria-label="Remove file"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <StatStrip
              stats={[
                { label: "CLIPS", value: String(files.length), tone: "neutral" },
                {
                  /*
                    The queue total is the number the size guard actually
                    measures, so when it is the thing stopping the run it is
                    labelled as such and accented — the same treatment the
                    queue rows give a clip that is blocking the join. The
                    ceiling itself is spelled out in the message below rather
                    than crammed into a 9px label that would wrap.
                  */
                  label: sizeRefusal ? "OVER CAP" : "IN",
                  value: formatFileSize(totalSize),
                  tone: sizeRefusal ? "accent" : "neutral",
                },
                {
                  label: "LENGTH",
                  value: allProbed && files.length > 0 ? formatSeconds(totalSeconds) : "—",
                  tone: "ok",
                },
                { label: "OUT", value: result ? formatFileSize(result.newSize) : "—" },
              ]}
            />
          </>
        )}

        {/*
          ── The mismatch report ──
          A feature, not an error page: FFmpeg's own answer to this set is a
          truncated file and exit code 0, so naming the file and the property
          is the entire value the tool adds here.
        */}
        {mismatches.length > 0 && (
          <>
            <WarningMessage
              message={`These clips can't be joined without re-encoding, and this tool never re-encodes. ${mismatches.length === 1 ? "One thing differs" : `${mismatches.length} things differ`} from ${files[0]?.name ?? "the first clip"} — joining anyway would produce a file with clips silently missing.`}
            />
            <div className="flex flex-col overflow-hidden rounded-[10px] border border-neutral-800 bg-bg-primary">
              <div className="grid grid-cols-[1fr_110px_100px_100px] gap-3 border-b border-border px-3.5 py-[9px] font-mono text-[9.5px] leading-none font-medium tracking-[0.1em] text-text-muted">
                <span>CLIP</span>
                <span>WHAT DIFFERS</span>
                <span className="text-right">FIRST CLIP</span>
                <span className="text-right">THIS CLIP</span>
              </div>
              {mismatches.map((m, i) => (
                <div
                  key={`${m.fileName}-${m.property}-${i}`}
                  className="grid grid-cols-[1fr_110px_100px_100px] items-center gap-3 border-b border-text-primary/6 px-3.5 py-[11px] font-body text-xs leading-none last:border-b-0"
                >
                  <span className="truncate text-neutral-300">{m.fileName}</span>
                  <span className="truncate font-mono text-[11px] text-text-muted">
                    {m.property}
                  </span>
                  <span className="truncate text-right font-mono text-[11px] text-text-muted">
                    {m.expected}
                  </span>
                  <span className="truncate text-right font-mono text-[11px] text-accent-300">
                    {m.found}
                  </span>
                </div>
              ))}
            </div>
            <CanvasFootnote>
              MAKE THEM MATCH FIRST — THEN COME BACK AND THE JOIN COSTS NOTHING.
            </CanvasFootnote>
          </>
        )}

        {/*
          The queue is over the ceiling. Said here, while clips can still be
          removed, rather than after a click — the same sentence `mergeVideos`
          would have thrown, so nothing is learned by pressing the button.
        */}
        {sizeRefusal && <ErrorMessage message={sizeRefusal} />}

        {firstProbeError && <ErrorMessage message={firstProbeError} />}
        {status === "error" && error && <ErrorMessage message={error} />}

        {result?.warnings?.map((warning) => (
          <WarningMessage key={warning} message={warning} />
        ))}

        {result && (
          <>
            <CanvasHeader
              file={result.fileName}
              meta={formatFileSize(result.newSize)}
              trailing="JOINED"
            />
            {/* THE CLAIM COMES OFF THE RESULT. `streamCopied` is read from the
                argv that actually ran, and `outputSeconds` was measured on the
                finished file — neither is asserted by this page. */}
            <CanvasFootnote>
              {result.streamCopied
                ? `NOT ONE FRAME WAS RE-ENCODED — ${formatSeconds(result.outputSeconds)} OF PICTURE AND SOUND, COPIED ACROSS BYTE FOR BYTE.`
                : "THIS RUN DID NOT COPY THE STREAMS ACROSS UNTOUCHED — THE PICTURE IN THE DOWNLOAD IS A NEW ENCODE, NOT YOUR ORIGINALS."}
            </CanvasFootnote>
          </>
        )}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {(probing || status === "processing") && (
              <ToolProgress
                phase={probing ? "READING THE CLIPS" : "JOINING"}
                percent={status === "processing" ? progress : null}
                label={probing ? "Reading these clips" : "Joining these clips"}
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
              // Cancel stops the run and keeps the queue; CLEAR ALL, which
              // throws the queue away, is hidden while a join is in flight.
              <ToolActions primaryLabel="Cancel" onPrimary={handleCancel} />
            ) : (
              <ToolActions
                primaryLabel={files.length > 1 ? `Join ${files.length} clips` : "Join clips"}
                onPrimary={handleMerge}
                primaryDisabled={blocked}
              />
            )}
            {files.length > 0 && status !== "processing" && (
              <ToolResetLink onClick={handleReset} label={result ? "START OVER" : "CLEAR ALL"} />
            )}
          </>
        }
      >
        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Clips", files.length > 0 ? String(files.length) : "—"],
              ["Re-encoded", result ? (result.streamCopied ? "No" : "Yes") : "No — never"],
              ["Length", allProbed && files.length > 0 ? formatSeconds(totalSeconds) : "—"],
              ["Out", result ? formatFileSize(result.newSize) : "—"],
            ]}
          />
          {/*
            The cap is stated where it binds. The zone's badge prints the same
            number, but it enforces it per file, and on a tool that needs two
            files the per-file reading is never the one that decides a run.
          */}
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {files.length < 2
              ? "Add at least two clips to join."
              : "They join end to end, top to bottom — use the arrows to reorder."}{" "}
            {TOTAL_CAP_LABEL} is the total for the whole queue, not each clip.
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="NOTHING IS RE-ENCODED">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Nothing here is ever re-encoded: the clips are copied into one file exactly as they
            are, so they have to share a codec, a frame size, a container the copy can be written
            into, and the timing base that container counts in. That is what makes it lossless, and
            near-instant, on clips a normal editor would spend minutes re-rendering.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Every clip is read before anything runs, and any difference is listed on the left with
            the file and the property named. It is not the extension that has to match — it is what
            is inside — but a .mkv and a .mp4 holding identical H.264 were measured to lose a clip
            when joined, so the container is checked too, and so is the timing base: two MP4s that
            agree on everything else and count time differently were measured to produce a join
            whose picture no longer runs in step with its own sound.
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="IF THEY DON'T MATCH">
          {/*
            Only claims what those two tools actually do. /video-to-mp4 takes
            .mov/.mkv/.avi/.m4v and rewraps them into MP4, usually without
            re-encoding — exactly the fix for the container and codec rows.
            /compress-video's three presets cap the height at 1080, 720 or 480,
            so it cannot be promised as a way to hit another clip's exact frame
            size, and it is not offered as one.

            ⚠ AND THE REWRAP IS NOT PROMISED AS A CURE FOR THE TIMEBASE ROW.
            Measured on this build: rewrapping sample-video.mkv with
            /video-to-mp4's stream-copy arm writes a file whose video timebase
            is 1/16000, against the 1/57600 of an untouched sample-video.mp4 —
            so that pair comes back here and is refused again, on a different
            row. Saying "rewrap and it will join" would be the lie this page
            exists to avoid.
          */}
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Make them match first, then come back — the join itself costs nothing. A clip in the
            wrong container or codec can be rewrapped by{" "}
            <Link href="/video-to-mp4" className="text-accent-300 underline underline-offset-2">
              Video to MP4
            </Link>
            , usually without re-encoding anything. A clip at a different frame size has to be
            re-encoded to match the others, which nothing here does in one step.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            A rewrap fixes the container, but the tool doing it picks its own timing base for the
            file it writes — measured here, an MKV rewrapped to MP4 came out counting in 1/16000
            where the untouched MP4 counted in 1/57600 — so a pair can come back still refused, on
            that row instead. Clips exported by the same camera, app or settings are the ones that
            join for nothing.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            This tool will not quietly re-encode them for you. FFmpeg, asked to join clips that do
            not match, reports success and writes a file with clips missing — measured, on the
            build this page runs. Refusing and telling you why is the only honest answer.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
