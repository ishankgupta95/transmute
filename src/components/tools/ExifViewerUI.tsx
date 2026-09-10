"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { readExifData, stripExifData, type ExifEntry } from "@/lib/tools/exif-viewer";
import type { ProcessedResult } from "@/hooks/useFileProcessor";
import { useImageDimensions } from "@/hooks/useImageDimensions";
import { imageMeta } from "@/lib/utils/canvas-meta";
import { formatFileSize } from "@/lib/utils/file-helpers";
import {
  ToolActions,
  ToolAdvanced,
  ToolAside,
  ToolAsideSection,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  CanvasHeader,
  TagGrid,
} from "@/components/tools/ToolCanvas";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { StatusMessage } from "@/components/tools/StatusMessage";

interface ExifViewerUIProps {
  acceptFormats: string;
}

/*
  WHAT THE STRIP ACTUALLY DID — read back, not asserted.

  `stripExifData` returns a bare `ProcessedResult`, and the warnings its
  pre-decode produces are thrown away one layer down: `toDecodableBlob` is a
  back-compat wrapper that returns `(await toDecodableSource(file)).blob` and
  drops the `warnings` beside it, so an animated WebP's "only its first frame
  was kept" and a multi-page TIFF's page count never reach this component.
  Plumbing them through means changing `lib/tools/`, which this change does
  not own, so NOTHING below pretends to be that warning list. The page's
  aboutText and its "How does metadata removal work?" FAQ carry those two
  losses in prose instead, and every row here is measured from the run's own
  outputs:

    • CONTAINER comes from `result.blob.type` — the type the ENCODER wrote,
      not the one the filename claims. A canvas asked for a format it cannot
      encode falls back to PNG and reports the fallback in the Blob's type
      (measured in WebKit for WebP; `image-encode-substitution.test.ts` pins
      both pipelines), and `stripExifData` runs no `writtenFormat` check, so
      on such a browser a `.webp` download really is a PNG and this row is
      the only place that says so.
    • OUTPUT PIXELS decodes the produced blob, exactly as `ImageCompressorUI`
      measures its own result rather than reprinting the source's dimensions.
    • TRANSPARENCY follows the measured container, because the engine's
      `fillBackground` runs precisely when the container carries no alpha.

  The first two rows are properties of the code path rather than of one run,
  and they are the reason the rest exists: this is a decode and a re-encode
  into sRGB, not an excision of tags from your bytes.
*/

/** `image/jpeg` → `JPEG`. Null when the encoder stated no type at all. */
function containerFromMime(mime: string): string | null {
  if (!mime.startsWith("image/")) return null;
  return normaliseContainer(mime.slice("image/".length).toUpperCase());
}

/** `photo.HEIC` → `HEIC`. Null for a name with no usable extension. */
function containerFromName(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  return normaliseContainer(name.slice(dot + 1).toUpperCase());
}

/**
 * One container, one name. `.jpg`/`.jpeg` and `.tif`/`.tiff` are spelling,
 * not format — printing `JPG → JPEG` would advertise a conversion that did
 * not happen, which is the exact class of claim this block exists to avoid.
 */
function normaliseContainer(label: string): string {
  if (label === "JPG") return "JPEG";
  if (label === "TIF") return "TIFF";
  return label;
}

export function ExifViewerUI({ acceptFormats }: ExifViewerUIProps) {
  const [file, setFile] = useState<File | null>(null);
  const [entries, setEntries] = useState<ExifEntry[]>([]);
  const [cleanResult, setCleanResult] = useState<ProcessedResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isStripping, setIsStripping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The doc's image readout is dimensions AND size, not the size alone.
  const sourceDims = useImageDimensions(file);
  // The cleaned copy is measured in its own right — see the block comment
  // above. Same object every render, so the decode runs once per result.
  const cleanDims = useImageDimensions(cleanResult ? cleanResult.blob : null);

  const handleFiles = useCallback(async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setCleanResult(null);
    setError(null);
    setIsLoading(true);

    try {
      const data = await readExifData(f);
      setEntries(data);
    } catch {
      setEntries([]);
      setError("Could not read metadata from this file.");
    }
    setIsLoading(false);
  }, []);

  const handleStrip = useCallback(async () => {
    if (!file) return;
    setIsStripping(true);
    setError(null);
    try {
      const result = await stripExifData(file);
      setCleanResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to strip metadata");
    }
    setIsStripping(false);
  }, [file]);

  const handleReset = useCallback(() => {
    setFile(null);
    setEntries([]);
    setCleanResult(null);
    setError(null);
  }, []);

  // Group entries by category
  const groupedEntries = entries.reduce<Record<string, ExifEntry[]>>((acc, entry) => {
    if (!acc[entry.group]) acc[entry.group] = [];
    acc[entry.group].push(entry);
    return acc;
  }, {});

  const groupLabels: Record<string, string> = {
    exif: "Camera & Image",
    gps: "GPS Location",
    iptc: "IPTC",
    xmp: "XMP",
    icc: "Color Profile",
  };

  if (!file) {
    return <DropZone accept={acceptFormats} onFiles={handleFiles} />;
  }

  const hasGps = entries.some((e) => e.group === "gps");

  const readAs = containerFromName(file.name);
  const writtenAs = cleanResult ? containerFromMime(cleanResult.blob.type) : null;
  const advancedRows: (readonly [string, string])[] = [
    ["Pixel data", "DECODED AND RE-ENCODED"],
    ["Colour space", "sRGB"],
  ];
  if (cleanResult) {
    advancedRows.push(
      [
        "Container",
        writtenAs === null
          ? "NOT DECLARED BY THE ENCODER"
          : readAs && readAs !== writtenAs
            ? `${readAs} → ${writtenAs}`
            : writtenAs,
      ],
      // No third state: without a container there is nothing to say about
      // alpha, so the row states the container's behaviour or a dash.
      [
        "Transparency",
        writtenAs === null ? "—" : writtenAs === "JPEG" ? "WHITE FILL" : "PRESERVED",
      ],
      // The byte size is already the OUTPUT panel's "Cleaned" row; this is
      // the half that panel cannot show.
      ["Output pixels", cleanDims ? `${cleanDims.w} × ${cleanDims.h}` : "—"],
    );
  }

  return (
    <>
      {/* ── Canvas: what you look at ─────────────────────────── */}
      <div className={CANVAS_COLUMN}>
        {/* File info */}
        <CanvasHeader
          file={file.name}
          meta={imageMeta(sourceDims, formatFileSize(file.size))}
          trailing={
            cleanResult
              ? "METADATA REMOVED"
              : `${entries.length} METADATA ${entries.length === 1 ? "FIELD" : "FIELDS"}`
          }
        />

        {/* Loading */}
        {isLoading && (
          <StatusMessage>Reading metadata...</StatusMessage>
        )}

        {/* Error */}
        {error && <ErrorMessage message={error} />}

        {/* No metadata */}
        {!isLoading && entries.length === 0 && !error && (
          <div className="rounded-lg border border-border bg-bg-secondary p-6 text-center">
            <p className="text-text-secondary">No metadata found in this image.</p>
            <p className="text-sm text-text-muted mt-1">
              This file may have already been stripped of metadata.
            </p>
          </div>
        )}

        {/* Once a cleaned copy exists the listing below is history, not the
            current state of the file the user is about to download. */}
        {cleanResult && entries.length > 0 && (
          <p className="font-mono text-[9.5px] leading-none font-medium tracking-[0.12em] uppercase text-text-muted">
            Original file — these tags are gone from the cleaned copy
          </p>
        )}

        {/* Metadata, grouped, in the doc's two-column tag grid */}
        {Object.entries(groupedEntries).map(([group, groupEntries]) => (
          <div key={group} className="space-y-2">
            {/*
              h3, and it has to stay h3. This used to be the only heading
              anywhere in the tool workspace, which made /exif-viewer's outline
              read h3 → h1 → h2 → h2 → h2: it started at level 3, skipped 1 and
              2, then went backwards. WCAG 1.3.1.

              The level above it is now the visually-hidden h2 that
              `ToolPageLayout` renders inside `[data-tool-surface]` (search
              `tool-surface-heading`), which names the tool region. These group
              labels are that region's immediate subsections, so h3 continues
              the outline with no level skipped — level 4 would reintroduce a
              gap. If that h2 is ever removed, these become orphans again.
            */}
            <h3 className="flex items-baseline gap-2 font-mono text-[9.5px] leading-none font-medium tracking-[0.12em] uppercase text-text-muted">
              {groupLabels[group] ?? group.toUpperCase()}
              {group === "gps" && !cleanResult && (
                <span className="text-warning">⚠ Contains location data</span>
              )}
            </h3>
            <TagGrid
              tags={groupEntries.map((e) => ({ label: e.tag, value: String(e.value) }))}
              identifying={() => group === "gps"}
            />
          </div>
        ))}

        {entries.length > 0 && (
          <CanvasFootnote>
            READ IN THIS TAB · GPS SHOWN ONLY TO YOU · STRIP BEFORE SHARING
          </CanvasFootnote>
        )}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {cleanResult ? (
              <DownloadButton
                blob={cleanResult.blob}
                fileName={cleanResult.fileName}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                // Not "& Download": this only produces the cleaned copy — the
                // Download button that replaces this button is the download.
                primaryLabel={isStripping ? "Stripping…" : "Remove EXIF"}
                onPrimary={handleStrip}
                primaryDisabled={isStripping || entries.length === 0}
              />
            )}
            <ToolResetLink onClick={handleReset} label={cleanResult ? "VIEW ANOTHER" : "CANCEL"} />
          </>
        }
      >
        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Fields", isLoading ? "…" : String(entries.length)],
              ["Location", hasGps ? "present" : "none"],
              ["Cleaned", cleanResult ? formatFileSize(cleanResult.newSize) : "—"],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {cleanResult
              ? "The cleaned copy is ready to download — every metadata block was dropped."
              : hasGps
                ? "This image carries GPS coordinates — strip it before sharing."
                : "Stripping re-encodes the image with every metadata block dropped."}
          </span>
        </ToolAsideSection>

        {/* What the strip did to the picture, measured — see the block
            comment above the component. */}
        <ToolAdvanced rows={advancedRows} />
      </ToolAside>
    </>
  );
}
