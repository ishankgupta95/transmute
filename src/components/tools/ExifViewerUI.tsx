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

export function ExifViewerUI({ acceptFormats }: ExifViewerUIProps) {
  const [file, setFile] = useState<File | null>(null);
  const [entries, setEntries] = useState<ExifEntry[]>([]);
  const [cleanResult, setCleanResult] = useState<ProcessedResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isStripping, setIsStripping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The doc's image readout is dimensions AND size, not the size alone.
  const sourceDims = useImageDimensions(file);

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
      </ToolAside>
    </>
  );
}
