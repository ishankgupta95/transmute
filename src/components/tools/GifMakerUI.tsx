"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { DropZone } from "@/components/tools/DropZone";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import {
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
import type { GifEditResult } from "@/lib/tools/gif-edit";

export function GifMakerUI({ acceptFormats }: { acceptFormats: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<GifEditResult | null>(null);
  const [delayMs, setDelayMs] = useState(100);
  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<string | null>(null);

  const previewUrl = useMemo(
    () => (result ? URL.createObjectURL(result.blob) : null),
    [result],
  );
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const run = useCallback(
    async (list: File[], ms: number) => {
      setResult(null);
      setError(null);
      setElapsed(null);
      setPercent(0);
      setStatus("processing");
      const startedAt = performance.now();
      try {
        const { makeGif } = await import("@/lib/tools/gif-edit");
        const made = await makeGif(list, {
          delayMs: ms,
          onProgress: (p) => setPercent(Math.round(p * 100)),
        });
        setResult(made);
        const t = performance.now() - startedAt;
        setElapsed(t < 950 ? `${Math.round(t)} ms` : `${(t / 1000).toFixed(1)} s`);
        setStatus("done");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not build a GIF from these images");
        setStatus("error");
      } finally {
        setPercent(null);
      }
    },
    [],
  );

  const handleFiles = useCallback(
    async (list: File[]) => {
      if (list.length === 0) return;
      /*
        Dropped files arrive in whatever order the OS hands them over, which is
        rarely the order a person means. Sorting by name with a numeric
        collator puts frame-2 before frame-10 — the order the filenames imply.
      */
      const ordered = [...list].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
      );
      setFiles(ordered);
      await run(ordered, delayMs);
    },
    [delayMs, run],
  );

  const handleReset = useCallback(() => {
    setFiles([]);
    setResult(null);
    setError(null);
    setElapsed(null);
    setPercent(null);
    setStatus("idle");
  }, []);

  if (files.length === 0) return <DropZone accept={acceptFormats} multiple onFiles={handleFiles} />;

  return (
    <>
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={`${files.length} image${files.length === 1 ? "" : "s"}`}
          meta={formatFileSize(files.reduce((s, f) => s + f.size, 0))}
          trailing={result ? `${result.frameCount} FRAMES` : undefined}
        />

        {result && previewUrl && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- an animated blob: GIF must play; next/image would optimise it into a still. */}
            <img
              src={previewUrl}
              alt="The animation, playing"
              className="mx-auto max-h-[52vh] max-w-full rounded-[9px] border border-border"
            />
            <CanvasFootnote>
              {result.width}×{result.height} · {result.frameCount} FRAMES ·{" "}
              {(result.durationMs / 1000).toFixed(2)}s · {formatFileSize(result.blob.size)}
            </CanvasFootnote>
          </>
        )}

        <CanvasFootnote>
          FRAMES ARE ORDERED BY FILENAME — PICTURES OF DIFFERENT SHAPES ARE FITTED, NEVER
          STRETCHED OR CROPPED
        </CanvasFootnote>

        {error && <ErrorMessage message={error} />}
      </div>

      <ToolAside
        footer={
          <>
            {status === "processing" && (
              <ToolProgress phase="BUILDING" percent={percent} label="Building the animation" />
            )}
            {elapsed && <ToolDone elapsed={elapsed} />}
            {result && (
              <DownloadButton
                blob={result.blob}
                fileName="animation.gif"
                className="w-full justify-center"
              />
            )}
            <ToolResetLink onClick={handleReset} label="CHANGE IMAGES" />
          </>
        }
      >
        <ToolAsideSection label="TIMING">
          <label className="flex flex-col gap-1.5 font-body text-[12.5px] text-neutral-300">
            <span>{delayMs} ms per frame · {(1000 / delayMs).toFixed(1)} fps</span>
            <input
              type="range"
              min={20}
              max={1000}
              step={10}
              value={delayMs}
              onChange={(e) => setDelayMs(Number(e.target.value))}
              className="accent-accent"
            />
          </label>
          <button
            onClick={() => void run(files, delayMs)}
            className="mt-1 cursor-pointer self-start text-[12px] text-accent hover:text-accent-hover"
          >
            Rebuild GIF
          </button>
        </ToolAsideSection>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Frames", result ? String(result.frameCount) : "—"],
              ["Size", result ? formatFileSize(result.blob.size) : "—"],
              ["Dimensions", result ? `${result.width}×${result.height}` : "—"],
            ]}
          />
        </ToolAsideSection>

        <ToolAsideSection label="WHAT YOU GET">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            One GIF, each picture shown for the same length of time, ordered by filename. Every
            frame of a GIF has to be the same size, so pictures of different shapes are fitted
            inside the canvas with the spare space left transparent rather than stretched.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
