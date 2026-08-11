"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { pdfToImages } from "@/lib/tools/pdf-engine";
import { triggerDownload, downloadFilesAsZip } from "@/lib/utils/download";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
  ToolResetLink,
  ToolSlider,
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  CanvasHeader,
  PageDeck,
  PageTile,
  StatStrip,
} from "@/components/tools/ToolCanvas";
import { formatFileSize } from "@/lib/utils/file-helpers";

export function PdfToJpgUI() {
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<"jpeg" | "png">("jpeg");
  const [quality, setQuality] = useState(0.85);
  const [scale, setScale] = useState(2);
  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [results, setResults] = useState<{ blob: Blob; name: string; url: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setResults([]);
    setStatus("idle");
    setError(null);
  }, []);

  const handleConvert = useCallback(async () => {
    if (!file) return;
    setStatus("processing");
    setError(null);
    setProgress(0);
    try {
      const buf = await file.arrayBuffer();
      // Pages encode in the image worker pool; progress ticks per page done.
      const images = await pdfToImages(buf, format, quality, scale, {
        onProgress: (value) => setProgress(Math.round(value)),
      });
      setResults(images.map((img) => ({ ...img, url: URL.createObjectURL(img.blob) })));
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to convert PDF");
      setStatus("error");
    }
  }, [file, format, quality, scale]);

  const handleReset = useCallback(() => {
    results.forEach((r) => URL.revokeObjectURL(r.url));
    setFile(null);
    setResults([]);
    setStatus("idle");
    setError(null);
  }, [results]);

  const downloadAll = useCallback(() => {
    // Bundle into a single ZIP — firing N synchronous downloads gets throttled
    // by browsers (only the first would actually save).
    const baseName = file?.name.replace(/\.[^.]+$/, "") ?? "pdf";
    void downloadFilesAsZip(
      results.map((r) => ({ blob: r.blob, name: r.name })),
      `${baseName}-pages.zip`,
    );
  }, [results, file]);

  if (!file) return <DropZone accept=".pdf" onFiles={handleFiles} />;

  return (
    <>
      <div className="min-w-0 space-y-[13px]">
        <CanvasHeader
          file={file.name}
          meta={results.length > 0 ? `${results.length} PAGES` : "PDF"}
          trailing={format === "jpeg" ? "JPG" : "PNG"}
        />

        {status === "processing" && (
          <ProgressBar progress={progress > 0 ? progress : null} />
        )}
        {error && <ErrorMessage message={error} />}

        {results.length > 0 && (
          <>
            <PageDeck>
              {results.map((r, idx) => (
                <PageTile key={idx} number={idx + 1} thumb={r.url} selected onClick={() => triggerDownload(r.blob, r.name)} label={`Download page ${idx + 1}`} />
              ))}
            </PageDeck>

            <StatStrip
              stats={[
                { label: "PAGES", value: String(results.length), tone: "neutral" },
                { label: "FORMAT", value: format === "jpeg" ? "JPG" : "PNG" },
                { label: "SCALE", value: `${scale}×`, tone: "neutral" },
                {
                  label: "SIZE",
                  value: formatFileSize(results.reduce((n, r) => n + r.blob.size, 0)),
                  tone: "ok",
                },
              ]}
            />

            <CanvasFootnote>CLICK A PAGE TO SAVE IT ON ITS OWN</CanvasFootnote>
          </>
        )}
      </div>

      <ToolAside
        footer={
          <>
            {results.length > 0 ? (
              <ToolActions primaryLabel="Download all (ZIP)" onPrimary={downloadAll} />
            ) : (
              <ToolActions
                primaryLabel={status === "processing" ? "Converting…" : "Convert to images"}
                onPrimary={handleConvert}
                primaryDisabled={status === "processing"}
              />
            )}
            <ToolResetLink onClick={handleReset} label="CHANGE FILE" />
          </>
        }
      >
        <ToolAsideSection label="FORMAT">
          <ToolChoice
            label="Output format"
            fill
            value={format}
            onChange={setFormat}
            options={[
              { value: "jpeg" as const, label: "JPG" },
              { value: "png" as const, label: "PNG" },
            ]}
          />
        </ToolAsideSection>

        {format === "jpeg" && (
          <ToolAsideSection>
            <ToolSlider
              label="Quality"
              display={`${Math.round(quality * 100)}%`}
              min={0.1}
              max={1}
              step={0.05}
              value={quality}
              onChange={setQuality}
            />
          </ToolAsideSection>
        )}

        <ToolAsideSection>
          <ToolSlider
            label="Scale"
            display={`${scale}×`}
            hint="Higher scale renders more pixels per page — better for print."
            min={1}
            max={4}
            step={0.5}
            value={scale}
            onChange={setScale}
          />
        </ToolAsideSection>

        {results.length > 0 && (
          <ToolAsideSection label="OUTPUT">
            <ToolOutput
              rows={[
                ["Pages", String(results.length)],
                ["Format", format === "jpeg" ? "JPG" : "PNG"],
              ]}
            />
          </ToolAsideSection>
        )}
      </ToolAside>
    </>
  );
}
