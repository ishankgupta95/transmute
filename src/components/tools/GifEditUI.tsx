"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { DropZone } from "@/components/tools/DropZone";
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
import { CanvasFootnote, CanvasHeader } from "@/components/tools/ToolCanvas";
import { ToolProgress } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { MIN_GIF_DELAY_MS, type GifEditResult } from "@/lib/tools/gif-edit";

/** The four verbs, and what each one puts in the controls rail. */
export type GifVerb = "resize" | "speed" | "reverse" | "split";

const LABEL: Record<GifVerb, { action: string; suffix: string }> = {
  resize: { action: "Resize GIF", suffix: "-resized" },
  speed: { action: "Change speed", suffix: "-respeed" },
  reverse: { action: "Reverse GIF", suffix: "-reversed" },
  split: { action: "Split into frames", suffix: "-frames" },
};

type Outcome =
  | { kind: "gif"; result: GifEditResult }
  | { kind: "zip"; blob: Blob; frameCount: number; width: number; height: number };

export function GifEditUI({ verb }: { verb: GifVerb }) {
  const [file, setFile] = useState<File | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [scale, setScale] = useState(50);
  const [speed, setSpeed] = useState(100);
  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<string | null>(null);

  const outputName = useMemo(() => {
    if (!file) return "";
    const stem = file.name.replace(/\.gif$/i, "");
    return verb === "split" ? `${stem}-frames.zip` : `${stem}${LABEL[verb].suffix}.gif`;
  }, [file, verb]);

  const blob = outcome ? (outcome.kind === "gif" ? outcome.result.blob : outcome.blob) : null;

  /*
    ONE object URL per result, revoked when it is replaced. Calling
    `URL.createObjectURL` in the JSX leaks a URL — and with it the whole blob —
    on every re-render, and a slider that re-renders on each drag turns that
    into tens of retained GIFs.
  */
  const previewUrl = useMemo(() => {
    if (!outcome || outcome.kind !== "gif") return null;
    return URL.createObjectURL(outcome.result.blob);
  }, [outcome]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const run = useCallback(
    async (f: File) => {
      setOutcome(null);
      setError(null);
      setElapsed(null);
      setPercent(0);
      setStatus("processing");
      const startedAt = performance.now();
      try {
        if (verb === "split") {
          const { splitGif } = await import("@/lib/tools/gif-edit");
          const { zipFrames } = await import("@/lib/tools/video-frames");
          const { frames, width, height } = await splitGif(f, (p) => setPercent(Math.round(p * 100)));
          const zipped = await zipFrames(frames.map((fr) => ({ fileName: fr.name, blob: fr.blob })));
          setOutcome({ kind: "zip", blob: zipped, frameCount: frames.length, width, height });
        } else {
          const { editGif } = await import("@/lib/tools/gif-edit");
          const result = await editGif(f, {
            scale: verb === "resize" ? scale / 100 : 1,
            speed: verb === "speed" ? 100 / speed : 1,
            reverse: verb === "reverse",
            onProgress: (p) => setPercent(Math.round(p * 100)),
          });
          setOutcome({ kind: "gif", result });
        }
        const ms = performance.now() - startedAt;
        setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
        setStatus("done");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not read this GIF");
        setStatus("error");
      } finally {
        setPercent(null);
      }
    },
    [scale, speed, verb],
  );

  const handleFiles = useCallback(
    async (files: File[]) => {
      const f = files[0];
      if (!f) return;
      setFile(f);
      await run(f);
    },
    [run],
  );

  const handleReset = useCallback(() => {
    setFile(null);
    setOutcome(null);
    setError(null);
    setElapsed(null);
    setPercent(null);
    setStatus("idle");
  }, []);

  if (!file) return <DropZone accept=".gif" onFiles={handleFiles} />;

  const frameCount = outcome
    ? outcome.kind === "gif"
      ? outcome.result.frameCount
      : outcome.frameCount
    : 0;
  const stillImage = outcome !== null && frameCount === 1;

  return (
    <>
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={formatFileSize(file.size)}
          trailing={outcome ? `${frameCount} FRAME${frameCount === 1 ? "" : "S"}` : undefined}
        />

        {/*
          A one-frame GIF is a still, and every verb here is a no-op on it. It
          is not an error — plenty of .gif files are stills — but a tool that
          reported success over a file it did nothing to would be lying by
          omission, so it says which it was.
        */}
        {stillImage && (
          <WarningMessage
            message="This GIF has a single frame, so it is a still picture rather than an animation. There was nothing to reorder, re-time or split — what you get back is the same one frame."
          />
        )}

        {outcome && blob && (
          <>
            {outcome.kind === "gif" && previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- an animated blob: GIF must play; next/image would optimise it into a still.
              <img
                src={previewUrl}
                alt="The edited animation, playing"
                className="mx-auto max-h-[52vh] max-w-full rounded-[9px] border border-border"
              />
            )}
            <CanvasFootnote>
              {outcome.kind === "gif"
                ? `${outcome.result.width}×${outcome.result.height} · ${frameCount} FRAMES · ${(outcome.result.durationMs / 1000).toFixed(2)}s · ${formatFileSize(blob.size)}`
                : `${outcome.width}×${outcome.height} · ${frameCount} PNG FRAMES · ${formatFileSize(blob.size)}`}
            </CanvasFootnote>
          </>
        )}

        {verb === "speed" && (
          <CanvasFootnote>
            GIF STORES DELAY IN HUNDREDTHS OF A SECOND, SO {MIN_GIF_DELAY_MS} MS PER FRAME IS THE
            FLOOR — PAST IT THE FILE CANNOT SAY FASTER
          </CanvasFootnote>
        )}

        {error && <ErrorMessage message={error} />}
      </div>

      <ToolAside
        footer={
          <>
            {status === "processing" && (
              <ToolProgress
                phase={verb === "split" ? "SPLITTING" : "RE-ENCODING"}
                percent={percent}
                label="Working through the frames"
              />
            )}
            {elapsed && <ToolDone elapsed={elapsed} />}
            {blob ? (
              <DownloadButton blob={blob} fileName={outputName} className="w-full justify-center" />
            ) : (
              status === "error" && (
                <ToolActions primaryLabel="Try again" onPrimary={() => void run(file)} />
              )
            )}
            <ToolResetLink onClick={handleReset} label="CHANGE FILE" />
          </>
        }
      >
        {verb === "resize" && (
          <ToolAsideSection label="SIZE">
            <label className="flex flex-col gap-1.5 font-body text-[12.5px] text-neutral-300">
              <span>Scale: {scale}%</span>
              <input
                type="range"
                min={10}
                max={100}
                step={5}
                value={scale}
                onChange={(e) => setScale(Number(e.target.value))}
                className="accent-accent"
              />
            </label>
            <button
              onClick={() => void run(file)}
              className="mt-1 cursor-pointer self-start text-[12px] text-accent hover:text-accent-hover"
            >
              {LABEL.resize.action}
            </button>
          </ToolAsideSection>
        )}

        {verb === "speed" && (
          <ToolAsideSection label="SPEED">
            <label className="flex flex-col gap-1.5 font-body text-[12.5px] text-neutral-300">
              <span>{speed}% of the original</span>
              <input
                type="range"
                min={25}
                max={400}
                step={25}
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="accent-accent"
              />
            </label>
            <button
              onClick={() => void run(file)}
              className="mt-1 cursor-pointer self-start text-[12px] text-accent hover:text-accent-hover"
            >
              {LABEL.speed.action}
            </button>
          </ToolAsideSection>
        )}

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Frames", outcome ? String(frameCount) : "—"],
              [
                "Size",
                outcome && blob ? formatFileSize(blob.size) : "—",
              ],
              [
                "Dimensions",
                outcome
                  ? outcome.kind === "gif"
                    ? `${outcome.result.width}×${outcome.result.height}`
                    : `${outcome.width}×${outcome.height}`
                  : "—",
              ],
            ]}
          />
        </ToolAsideSection>

        <ToolAsideSection label="THE ENGINE">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Decoded by your browser where it can, and by a small bundled reader where it cannot —
            Safari has no built-in image decoder for this. Re-encoded with gifenc, which this site
            already carries. Nothing is fetched and nothing is uploaded.
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="WHAT YOU GET">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {verb === "split"
              ? "One PNG per frame in a ZIP, numbered in order. PNG rather than GIF because the frames come out fully composited, and writing them back through a 256-colour palette would throw that away."
              : "A GIF re-encoded from every frame, with a fresh 256-colour palette per frame. Re-encoding is not lossless: a palette is chosen again, so flat colour survives and fine gradients may band."}
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
