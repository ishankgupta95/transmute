"use client";

import { useCallback, useMemo, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { pdfToImages } from "@/lib/tools/pdf-engine";
import { triggerDownload, downloadFilesAsZip } from "@/lib/utils/download";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolDone,
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
import { ToolControl, ToolControlGroup, ToolProgress } from "@/components/tools/ToolControls";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { CANVAS_COLUMN } from "@/components/workspace/shared";

/**
 * A ~200px preview of a rendered page, so the deck does not decode the
 * full-resolution export once per tile. Returns undefined when the browser
 * cannot make one — PageTile then falls back to its ruled-paper placeholder.
 */
async function makeThumb(blob: Blob): Promise<string | undefined> {
  try {
    const bmp = await createImageBitmap(blob);
    const s = Math.min(1, 200 / bmp.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * s));
    canvas.height = Math.max(1, Math.round(bmp.height * s));
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    return canvas.toDataURL("image/jpeg", 0.6);
  } catch {
    return undefined;
  }
}

export function PdfToJpgUI() {
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<"jpeg" | "png">("jpeg");
  const [quality, setQuality] = useState(0.85);
  const [scale, setScale] = useState(2);
  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [results, setResults] = useState<{ blob: Blob; name: string; thumb?: string }[]>([]);
  /*
    What the files in `results` were actually rendered with. The readouts used
    to read the live `format` / `scale` state, so clicking PNG after a JPG run
    relabelled the existing JPEGs as PNG — the page said one thing and the ZIP
    held another. Every readout below reads this instead.
  */
  const [renderedWith, setRenderedWith] = useState<{
    format: "jpeg" | "png";
    quality: number;
    scale: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  // The doc pins a "Done in 1.4 s" card above the primary once a run
  // finishes. Timed for real; cleared the moment the inputs change.
  const [elapsed, setElapsed] = useState<string | null>(null);

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setResults([]);
    setRenderedWith(null);
    setElapsed(null);
    setStatus("idle");
    setError(null);
  }, []);

  const handleConvert = useCallback(async () => {
    if (!file) return;
    setStatus("processing");
    setError(null);
    setProgress(0);
    setElapsed(null);
    const startedAt = performance.now();
    try {
      const buf = await file.arrayBuffer();
      // Pages encode in the image worker pool; progress ticks per page done.
      const images = await pdfToImages(buf, format, quality, scale, {
        onProgress: (value) => setProgress(Math.round(value)),
      });
      // The deck tiles are ~100px wide. Feeding them the full output blob
      // decoded a 1190x1684 bitmap per tile at 2x (2380x3368 at 4x), so a
      // 60-page export at high scale painted gigabytes just to draw
      // thumbnails. Downscale once, here, and keep the blob for the download.
      const withThumbs = await Promise.all(
        images.map(async (img) => ({ ...img, thumb: await makeThumb(img.blob) })),
      );
      setResults(withThumbs);
      setRenderedWith({ format, quality, scale });
      // A tiny PDF finishes in tens of milliseconds; "Done in 0.0 s" reads
      // like a stopwatch that never started. Sub-second runs report ms.
      const ms = performance.now() - startedAt;
      setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to convert PDF");
      setStatus("error");
    }
  }, [file, format, quality, scale]);

  const handleReset = useCallback(() => {
    setFile(null);
    setResults([]);
    setRenderedWith(null);
    setElapsed(null);
    setStatus("idle");
    setError(null);
  }, []);

  const downloadAll = useCallback(() => {
    // Bundle into a single ZIP — firing N synchronous downloads gets throttled
    // by browsers (only the first would actually save).
    const baseName = file?.name.replace(/\.[^.]+$/, "") ?? "pdf";
    void downloadFilesAsZip(
      results.map((r) => ({ blob: r.blob, name: r.name })),
      `${baseName}-pages.zip`,
    );
  }, [results, file]);

  // Live settings that no longer match what produced `results`. The primary
  // action goes back to Convert so the new settings can actually be applied —
  // wiping `results` on every slider tick would instead destroy a finished
  // render mid-drag of the Quality control.
  const stale = useMemo(
    () =>
      renderedWith === null ||
      renderedWith.format !== format ||
      renderedWith.scale !== scale ||
      // Quality only applies to the JPEG encoder.
      (format === "jpeg" && renderedWith.quality !== quality),
    [renderedWith, format, quality, scale],
  );
  const outFormat = renderedWith?.format ?? format;
  const outFormatLabel = outFormat === "jpeg" ? "JPG" : "PNG";

  if (!file) return <DropZone accept=".pdf" onFiles={handleFiles} />;

  return (
    <>
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          // The doc's readout is a technical line ("24 PAGES · 12.4 MB"); the
          // source size is known from the moment the file lands, the page
          // count only once a render has produced pages.
          meta={
            results.length > 0
              ? `${results.length} PAGE${results.length !== 1 ? "S" : ""} · ${formatFileSize(file.size)}`
              : formatFileSize(file.size)
          }
          trailing={outFormatLabel}
        />

        {error && <ErrorMessage message={error} />}

        {results.length > 0 && (
          <>
            <PageDeck>
              {results.map((r, idx) => (
                <PageTile key={idx} number={idx + 1} thumb={r.thumb} selected onClick={() => triggerDownload(r.blob, r.name)} label={`Download page ${idx + 1}`} />
              ))}
            </PageDeck>

            <StatStrip
              stats={[
                { label: "PAGES", value: String(results.length), tone: "neutral" },
                { label: "FORMAT", value: outFormatLabel },
                { label: "SCALE", value: `${renderedWith?.scale ?? scale}×`, tone: "neutral" },
                {
                  label: "SIZE",
                  value: formatFileSize(results.reduce((n, r) => n + r.blob.size, 0)),
                  tone: "ok",
                },
              ]}
            />

            <CanvasFootnote>
              {stale
                ? `THESE ARE THE ${outFormatLabel} PAGES AT ${renderedWith?.scale ?? scale}× — RUN CONVERT AGAIN TO APPLY THE NEW SETTINGS`
                : "CLICK A PAGE TO SAVE IT ON ITS OWN"}
            </CanvasFootnote>
          </>
        )}
      </div>

      <ToolAside
        footer={
          <>
            {status === "processing" && (
              <ToolProgress
                phase="RENDERING PAGES"
                percent={progress > 0 ? progress : null}
                label="Rendering pages"
              />
            )}
            {/* Stale settings mean the elapsed time no longer describes what the
                controls would produce, so the card retires with the ZIP. */}
            {elapsed && !stale && <ToolDone elapsed={elapsed} />}
            {results.length > 0 && !stale ? (
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
        {/* One bordered block for the whole control set — the doc gives its
            own rule only to START FROM, ADVANCED and OUTPUT. */}
        <ToolControlGroup>
          <ToolControl label="FORMAT">
            <ToolChoice
              label="Output format"
              value={format}
              onChange={setFormat}
              options={[
                { value: "jpeg" as const, label: "JPG" },
                { value: "png" as const, label: "PNG" },
              ]}
            />
          </ToolControl>

          {format === "jpeg" && (
            <ToolSlider
              label="Quality"
              display={`${Math.round(quality * 100)}%`}
              min={0.1}
              max={1}
              step={0.05}
              value={quality}
              onChange={setQuality}
            />
          )}

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
        </ToolControlGroup>

        {results.length > 0 && (
          <ToolAsideSection label="OUTPUT">
            <ToolOutput
              rows={[
                ["Pages", String(results.length)],
                ["Format", outFormatLabel],
              ]}
            />
          </ToolAsideSection>
        )}
      </ToolAside>
    </>
  );
}
