"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { mergePdfs, getPageCount } from "@/lib/tools/pdf-engine";
import { formatFileSize } from "@/lib/utils/file-helpers";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import { DocCard, DocStrip, StatStrip } from "@/components/tools/ToolCanvas";

interface PdfEntry {
  file: File;
  pageCount: number | null;
}

export function MergePdfUI() {
  const [entries, setEntries] = useState<PdfEntry[]>([]);
  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const handleFiles = useCallback(async (files: File[]) => {
    const newEntries: PdfEntry[] = [];
    for (const file of files) {
      let pageCount: number | null = null;
      try {
        const buf = await file.arrayBuffer();
        pageCount = await getPageCount(buf);
      } catch {
        // ignore
      }
      newEntries.push({ file, pageCount });
    }
    setEntries((prev) => [...prev, ...newEntries]);
    setResult(null);
    setStatus("idle");
  }, []);

  const removeEntry = useCallback((idx: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== idx));
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
    // Add and remove already clear the previous merge; a reorder must too,
    // or the download button keeps offering a PDF in the old page order.
    setResult(null);
    setStatus("idle");
  }, [dragIdx]);

  const handleMerge = useCallback(async () => {
    if (entries.length < 2) return;
    setStatus("processing");
    setError(null);
    try {
      const buffers = await Promise.all(entries.map((e) => e.file.arrayBuffer()));
      const merged = await mergePdfs(buffers);
      setResult(new Blob([merged as BlobPart], { type: "application/pdf" }));
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to merge PDFs");
      setStatus("error");
    }
  }, [entries]);

  const handleReset = useCallback(() => {
    setEntries([]);
    setResult(null);
    setStatus("idle");
    setError(null);
  }, []);

  const totalPages = entries.reduce((n, e) => n + (e.pageCount ?? 0), 0);

  return (
    <>
      <div className="min-w-0 space-y-6">
        <DropZone accept=".pdf" multiple onFiles={handleFiles} disabled={status === "processing"} />

        <p className="text-xs text-text-muted">
          Merge combines whole files in the order below. To reorder or delete individual{" "}
          <em>pages</em> within a PDF, use{" "}
          <Link
            href="/pdf-page-reorder"
            className="text-accent underline hover:text-accent-hover"
          >
            Reorder PDF Pages
          </Link>
          .
        </p>

        {entries.length > 0 && (
          <>
            <div className="flex items-baseline gap-3">
              <span className="font-display text-[13px] leading-none font-medium text-text-primary">
                Assembly order
              </span>
              <span className="font-mono text-[10.5px] leading-none text-text-muted">
                DRAG TO REORDER · {entries.length} DOCS
                {totalPages ? ` · ${totalPages} PAGES` : ""}
              </span>
            </div>

            <DocStrip>
              {entries.map((entry, idx) => (
                <DocCard
                  key={`${entry.file.name}-${idx}`}
                  index={idx + 1}
                  name={entry.file.name}
                  meta={formatFileSize(entry.file.size)}
                  badge={entry.pageCount !== null ? `${entry.pageCount} p` : undefined}
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

            <StatStrip
              stats={[
                { label: "DOCS", value: String(entries.length), tone: "neutral" },
                { label: "PAGES", value: totalPages ? String(totalPages) : "—" },
                {
                  label: "SIZE",
                  value: formatFileSize(entries.reduce((n, e) => n + e.file.size, 0)),
                  tone: "neutral",
                },
                { label: "OUTPUT", value: result ? "merged.pdf" : "—", tone: "ok" },
              ]}
            />
          </>
        )}

        {status === "processing" && <ProgressBar progress={null} />}
        {error && <ErrorMessage message={error} />}
      </div>

      <ToolAside
        footer={
          <>
            {result ? (
              <DownloadButton blob={result} fileName="merged.pdf" className="w-full justify-center" />
            ) : (
              <ToolActions
                primaryLabel={status === "processing" ? "Merging…" : "Merge PDFs"}
                onPrimary={handleMerge}
                primaryDisabled={entries.length < 2 || status === "processing"}
              />
            )}
            {entries.length > 0 && <ToolResetLink onClick={handleReset} label="START OVER" />}
          </>
        }
      >
        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Files", String(entries.length)],
              ["Pages", totalPages ? String(totalPages) : "—"],
              ["Size", formatFileSize(entries.reduce((n, e) => n + e.file.size, 0))],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {entries.length < 2
              ? "Add at least two PDFs to merge."
              : "Drag the cards in the canvas to set the order."}
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
