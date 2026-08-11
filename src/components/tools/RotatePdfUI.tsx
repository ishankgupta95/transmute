"use client";

import { useCallback, useState, useEffect, useRef } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { RotateCw } from "lucide-react";
import { rotatePdfPages, getPageCount, loadPdfjsDocument, renderPageFromDoc } from "@/lib/tools/pdf-engine";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import { CanvasHeader, PageDeck, PageTile } from "@/components/tools/ToolCanvas";

export function RotatePdfUI() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [angle, setAngle] = useState(90);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "processing" | "done" | "error">("idle");
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const thumbsLoadedRef = useRef(false);

  const handleFiles = useCallback(async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setStatus("loading");
    setError(null);
    setSelectedPages(new Set());
    setThumbnails([]);
    thumbsLoadedRef.current = false;
    try {
      const buf = await f.arrayBuffer();
      const count = await getPageCount(buf);
      setPageCount(count);
      setSelectedPages(new Set(Array.from({ length: count }, (_, i) => i)));
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load PDF");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!file || pageCount === 0 || thumbsLoadedRef.current) return;
    thumbsLoadedRef.current = true;
    let cancelled = false;
    (async () => {
      const freshBuf = await file.arrayBuffer();
      const doc = await loadPdfjsDocument(freshBuf);
      const thumbs: string[] = [];
      for (let i = 1; i <= Math.min(pageCount, 50); i++) {
        if (cancelled) return;
        try {
          const canvas = await renderPageFromDoc(doc, i, 0.3);
          thumbs.push(canvas.toDataURL("image/jpeg", 0.6));
        } catch {
          thumbs.push("");
        }
      }
      if (!cancelled) setThumbnails(thumbs);
    })();
    return () => { cancelled = true; };
  }, [file, pageCount]);

  const togglePage = useCallback((idx: number) => {
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedPages(new Set(Array.from({ length: pageCount }, (_, i) => i)));
  }, [pageCount]);

  const selectNone = useCallback(() => {
    setSelectedPages(new Set());
  }, []);

  const handleRotate = useCallback(async () => {
    if (!file || selectedPages.size === 0) return;
    setStatus("processing");
    setError(null);
    try {
      const freshData = new Uint8Array(await file.arrayBuffer());
      const indices = Array.from(selectedPages).sort((a, b) => a - b);
      const bytes = await rotatePdfPages(freshData, indices, angle);
      setResult(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rotate PDF");
      setStatus("error");
    }
  }, [file, selectedPages, angle]);

  const handleReset = useCallback(() => {
    setFile(null);
    setPageCount(0);
    setSelectedPages(new Set());
    setThumbnails([]);
    thumbsLoadedRef.current = false;
    setResult(null);
    setStatus("idle");
    setError(null);
  }, []);

  if (!file) return <DropZone accept=".pdf" onFiles={handleFiles} />;

  return (
    <>
      <div className="min-w-0 space-y-[13px]">
        <CanvasHeader
          file={file.name}
          meta={`${pageCount} page${pageCount !== 1 ? "s" : ""}`}
          trailing={`${selectedPages.size} PAGES SELECTED`}
        />

        <PageDeck>
          {Array.from({ length: pageCount }, (_, idx) => (
            <PageTile
              key={idx}
              number={idx + 1}
              thumb={thumbnails[idx] || undefined}
              selected={selectedPages.has(idx)}
              onClick={() => togglePage(idx)}
              badge={
                selectedPages.has(idx) ? (
                  <span className="absolute top-1 right-1 rounded-sm bg-[rgba(12,14,23,.72)] p-0.5">
                    <RotateCw size={11} className="text-accent" aria-hidden="true" />
                  </span>
                ) : undefined
              }
            />
          ))}
        </PageDeck>
        {pageCount > 50 && (
          <p className="m-0 font-mono text-[9.5px] leading-none tracking-[0.06em] text-text-muted">
            THUMBNAILS RENDERED FOR THE FIRST 50 OF {pageCount} PAGES — EVERY PAGE STAYS SELECTABLE
          </p>
        )}

        {(status === "loading" || status === "processing") && <ProgressBar progress={null} />}
        {error && <ErrorMessage message={error} />}
      </div>

      <ToolAside
        footer={
          <>
            {result ? (
              <DownloadButton
                blob={result}
                fileName={file.name.replace(/\.pdf$/i, "-rotated.pdf")}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel={
                  status === "processing"
                    ? "Rotating…"
                    : `Rotate ${selectedPages.size} page${selectedPages.size !== 1 ? "s" : ""}`
                }
                onPrimary={handleRotate}
                primaryDisabled={selectedPages.size === 0 || status === "processing"}
              />
            )}
            <ToolResetLink onClick={handleReset} label="CHANGE FILE" />
          </>
        }
      >
        <ToolAsideSection label="ROTATION">
          <ToolChoice
            label="Rotation angle"
            fill
            value={angle}
            onChange={setAngle}
            options={[
              { value: 90, label: "90°" },
              { value: 180, label: "180°" },
              { value: 270, label: "270°" },
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Clockwise. 270° is the same as 90° counter-clockwise.
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="PAGES">
          <div className="flex gap-2">
            <button
              onClick={selectAll}
              className="cursor-pointer text-xs text-accent transition-colors hover:text-accent-hover"
            >
              Select all
            </button>
            <button
              onClick={selectNone}
              className="cursor-pointer text-xs text-text-muted transition-colors hover:text-text-secondary"
            >
              Deselect all
            </button>
          </div>
          <ToolOutput
            rows={[
              ["Selected", `${selectedPages.size} of ${pageCount}`],
              ["Angle", `${angle}°`],
            ]}
          />
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
