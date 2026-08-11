"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { imagesToPdf, type PageSize } from "@/lib/tools/pdf-engine";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import { DocCard, DocStrip, StatStrip } from "@/components/tools/ToolCanvas";
import { formatFileSize } from "@/lib/utils/file-helpers";

interface ImageEntry {
  file: File;
  url: string;
}

export function ImagesToPdfUI() {
  const [entries, setEntries] = useState<ImageEntry[]>([]);
  const [pageSize, setPageSize] = useState<PageSize>("a4");
  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const handleFiles = useCallback((files: File[]) => {
    const newEntries = files.map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));
    setEntries((prev) => [...prev, ...newEntries]);
    setResult(null);
    setStatus("idle");
  }, []);

  const removeEntry = useCallback((idx: number) => {
    setEntries((prev) => {
      URL.revokeObjectURL(prev[idx].url);
      return prev.filter((_, i) => i !== idx);
    });
    setResult(null);
    setStatus("idle");
  }, []);

  const handleDragStart = useCallback((idx: number) => {
    setDragIdx(idx);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    setEntries((prev) => {
      const updated = [...prev];
      const [item] = updated.splice(dragIdx, 1);
      updated.splice(idx, 0, item);
      return updated;
    });
    setDragIdx(idx);
  }, [dragIdx]);

  const handleConvert = useCallback(async () => {
    if (entries.length === 0) return;
    setStatus("processing");
    setError(null);
    try {
      const images = await Promise.all(
        entries.map(async (e) => {
          const bytes = new Uint8Array(await e.file.arrayBuffer());
          return { bytes, type: e.file.type };
        }),
      );
      const pdfBytes = await imagesToPdf(images, pageSize);
      setResult(new Blob([pdfBytes as BlobPart], { type: "application/pdf" }));
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create PDF");
      setStatus("error");
    }
  }, [entries, pageSize]);

  const handleReset = useCallback(() => {
    entries.forEach((e) => URL.revokeObjectURL(e.url));
    setEntries([]);
    setResult(null);
    setStatus("idle");
    setError(null);
  }, [entries]);

  return (
    <>
      <div className="min-w-0 space-y-6">
        <DropZone accept=".jpg,.jpeg,.png" multiple onFiles={handleFiles} disabled={status === "processing"} />

        {entries.length > 0 && (
          <>
            {/* Same assembly language as Merge PDF — both tools order source
                files into one document, so they share the doc's card strip. */}
            <div className="flex items-baseline gap-3">
              <span className="font-display text-[13px] leading-none font-medium text-text-primary">
                Assembly order
              </span>
              <span className="font-mono text-[10.5px] leading-none text-text-muted">
                DRAG TO REORDER · {entries.length}{" "}
                {entries.length === 1 ? "IMAGE" : "IMAGES"} · {entries.length}{" "}
                {entries.length === 1 ? "PAGE" : "PAGES"}
              </span>
            </div>

            <DocStrip>
              {entries.map((entry, idx) => (
                <DocCard
                  key={`${entry.file.name}-${idx}`}
                  index={idx + 1}
                  name={entry.file.name}
                  meta={formatFileSize(entry.file.size)}
                  thumb={entry.url}
                  onRemove={() => removeEntry(idx)}
                  draggableProps={{
                    draggable: true,
                    onDragStart: () => handleDragStart(idx),
                    onDragOver: (e: React.DragEvent) => handleDragOver(e, idx),
                    onDragEnd: () => setDragIdx(null),
                  }}
                />
              ))}
            </DocStrip>
          </>
        )}

        <StatStrip
          stats={[
            { label: "IMAGES", value: String(entries.length), tone: "neutral" },
            { label: "PAGE SIZE", value: pageSize.toUpperCase(), tone: "neutral" },
            { label: "PAGES", value: String(entries.length) },
            { label: "OUTPUT", value: result ? "images.pdf" : "—", tone: "ok" },
          ]}
        />

        {status === "processing" && <ProgressBar progress={null} />}
        {error && <ErrorMessage message={error} />}
      </div>

      <ToolAside
        footer={
          <>
            {result ? (
              <DownloadButton
                blob={result}
                fileName="images.pdf"
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel={status === "processing" ? "Creating PDF…" : "Create PDF"}
                onPrimary={handleConvert}
                primaryDisabled={entries.length === 0 || status === "processing"}
              />
            )}
            {entries.length > 0 && <ToolResetLink onClick={handleReset} label="START OVER" />}
          </>
        }
      >
        <ToolAsideSection label="PAGE SIZE">
          <ToolChoice
            label="Page size"
            fill
            value={pageSize}
            onChange={setPageSize}
            options={[
              { value: "a4" as PageSize, label: "A4" },
              { value: "letter" as PageSize, label: "Letter" },
              { value: "fit" as PageSize, label: "Fit" },
            ]}
          />
        </ToolAsideSection>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Images", String(entries.length)],
              ["Pages", String(entries.length)],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {entries.length === 0
              ? "Add images to build a PDF."
              : "Drag the thumbnails to set page order."}
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
