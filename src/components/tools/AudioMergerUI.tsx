"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { mergeAudio } from "@/lib/tools/audio-merge";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { useFileProcessor, type FileProcessorContext } from "@/hooks/useFileProcessor";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import { ToolControl, ToolControlGroup, ToolProgress } from "@/components/tools/ToolControls";
import { CanvasHeader, StatStrip } from "@/components/tools/ToolCanvas";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { getToolBySlug } from "@/data/tools";

/*
  Read from the registry so the zone and the spec panel say one thing. This is
  a disclosure, not a check — nothing is compared against `file.size`, and the
  tool still accepts every queue it accepted before.
*/
const PRACTICAL_LIMIT_NOTE = getToolBySlug("merge-audio")?.practicalLimitNote;

export function AudioMergerUI() {
  const [files, setFiles] = useState<File[]>([]);
  const [outputFormat, setOutputFormat] = useState<"wav" | "mp3">("mp3");
  const [bitrate, setBitrate] = useState(192);

  /*
    The hook owns the run, not this component: it carries the AbortSignal that
    CLEAR ALL and unmounting need, and the run-id guard that stops an abandoned
    merge from writing its result over a queue the user has already changed.
    `mergeAudio` takes the whole list, so the per-call options are `void` and
    the queue/settings are closed over here.
  */
  const processFn = useCallback(
    async (_file: File, _options: void, ctx: FileProcessorContext) =>
      mergeAudio(files, { outputFormat, bitrate }, ctx),
    [files, outputFormat, bitrate],
  );

  const { status, result, error, progress, process, cancel, reset } =
    useFileProcessor<void>(processFn);

  /*
    Every mutation of the queue — add, remove, reorder — invalidates the merge
    that came out of the old queue. Dropping `result` also restores the
    `Merge n files` primary, since the footer branches on it.
  */
  const handleFiles = useCallback(
    (newFiles: File[]) => {
      setFiles((prev) => [...prev, ...newFiles]);
      reset();
    },
    [reset],
  );

  const removeFile = useCallback(
    (index: number) => {
      setFiles((prev) => prev.filter((_, i) => i !== index));
      reset();
    },
    [reset],
  );

  const moveFile = useCallback(
    (from: number, to: number) => {
      setFiles((prev) => {
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
      reset();
    },
    [reset],
  );

  // The file argument is only the hook's analytics label — `processFn` reads
  // the whole queue.
  const handleMerge = useCallback(() => {
    if (files.length < 2) return;
    process(files[0]);
  }, [files, process]);

  const handleReset = useCallback(() => {
    setFiles([]);
    reset();
  }, [reset]);

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <>
      {/* ── Canvas: the queue, in the order it will be joined ── */}
      <div className={CANVAS_COLUMN}>
        <DropZone
          accept=".mp3,.wav,.ogg,.m4a,.flac,.aac"
          multiple
          practicalLimitNote={PRACTICAL_LIMIT_NOTE}
          onFiles={handleFiles}
          disabled={status === "processing"}
        />

        {files.length > 0 && (
          <>
            {/* A section title rather than a filename, but the same header
                rhythm as every other canvas — hence `file` carrying the title
                and the counts sitting in the muted `meta` slot they already
                occupied. */}
            <CanvasHeader
              file="Join order"
              meta={`${files.length} FILES · ${formatFileSize(totalSize)}`}
            />

            <div className="flex flex-col overflow-hidden rounded-[10px] border border-neutral-800 bg-bg-primary">
              {files.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  className="flex items-center gap-3.5 border-b border-border px-4 py-3 last:border-b-0"
                >
                  <span className="w-5 flex-none font-mono text-[10px] leading-none text-text-muted">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-body text-xs leading-none text-neutral-300">
                    {file.name}
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
              ))}
            </div>

            <StatStrip
              stats={[
                { label: "FILES", value: String(files.length), tone: "neutral" },
                { label: "IN", value: formatFileSize(totalSize), tone: "neutral" },
                { label: "OUT", value: result ? formatFileSize(result.newSize) : "—" },
                { label: "FORMAT", value: outputFormat.toUpperCase(), tone: "ok" },
              ]}
            />
          </>
        )}

        {status === "error" && (
          <ErrorMessage message={error} />
        )}

        {result && (
          <CanvasHeader
            file={result.fileName}
            meta={formatFileSize(result.newSize)}
            trailing="MERGED"
          />
        )}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {/* The doc pins the running readout to the rail footer. Only the
                MP3 encoder reports progress, and only once it starts — the
                decode ahead of it is silent, so stay indeterminate until a
                real number arrives rather than sitting pinned at 0%. */}
            {status === "processing" && (
              <ToolProgress
                phase="MERGING"
                percent={outputFormat === "mp3" && progress > 0 ? progress : null}
                label="Merging audio files"
              />
            )}
            {result ? (
              <DownloadButton
                blob={result.blob}
                fileName={result.fileName}
                className="w-full justify-center"
              />
            ) : status === "processing" ? (
              // Cancel stops the run and keeps the queue; CLEAR ALL, which
              // throws the queue away, is hidden while a merge is in flight.
              <ToolActions primaryLabel="Cancel" onPrimary={cancel} />
            ) : (
              <ToolActions
                primaryLabel={`Merge ${files.length} files`}
                onPrimary={handleMerge}
                primaryDisabled={files.length < 2}
              />
            )}
            {files.length > 0 && status !== "processing" && (
              <ToolResetLink
                onClick={handleReset}
                label={result ? "START OVER" : "CLEAR ALL"}
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
              value={outputFormat}
              // Changing the format changes the output, so the finished merge is
              // no longer what these controls describe — drop it and re-offer the
              // primary rather than letting the strip lie about the download.
              onChange={(v) => {
                setOutputFormat(v);
                if (result) reset();
              }}
              disabled={status === "processing"}
              options={[
                { value: "mp3" as const, label: "MP3" },
                { value: "wav" as const, label: "WAV" },
              ]}
            />
          </ToolControl>

          {outputFormat === "mp3" && (
            <ToolControl label="BITRATE">
              <ToolChoice
                label="MP3 bitrate"
                fill
                value={bitrate}
                onChange={(v) => {
                  setBitrate(v);
                  if (result) reset();
                }}
                disabled={status === "processing"}
                options={[128, 192, 256, 320].map((b) => ({ value: b, label: String(b) }))}
              />
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                kbps
              </span>
            </ToolControl>
          )}
        </ToolControlGroup>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Files", String(files.length)],
              ["In", files.length > 0 ? formatFileSize(totalSize) : "—"],
              ["Out", result ? formatFileSize(result.newSize) : "—"],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {files.length < 2
              ? "Add at least two files to merge."
              : "They join end to end, top to bottom — use the arrows to reorder."}
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
