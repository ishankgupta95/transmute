"use client";

import { useCallback, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { readExifData, stripExifData, type ExifEntry } from "@/lib/tools/exif-viewer";
import type { ProcessedResult } from "@/hooks/useFileProcessor";
import { formatFileSize } from "@/lib/utils/file-helpers";

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

  return (
    <div className="space-y-6">
      {!file ? (
        <DropZone accept={acceptFormats} onFiles={handleFiles} />
      ) : (
        <>
          {/* File info */}
          <div className="flex items-center justify-between rounded-lg border border-border bg-bg-secondary p-4">
            <div>
              <p className="text-sm text-text-primary font-medium">{file.name}</p>
              <p className="text-xs text-text-muted">{formatFileSize(file.size)}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted">
                {entries.length} metadata {entries.length === 1 ? "field" : "fields"} found
              </span>
            </div>
          </div>

          {/* Loading */}
          {isLoading && (
            <p className="text-sm text-text-muted text-center">Reading metadata...</p>
          )}

          {/* Error */}
          {error && <p className="text-sm text-error text-center">{error}</p>}

          {/* No metadata */}
          {!isLoading && entries.length === 0 && !error && (
            <div className="rounded-lg border border-border bg-bg-secondary p-6 text-center">
              <p className="text-text-secondary">No metadata found in this image.</p>
              <p className="text-sm text-text-muted mt-1">
                This file may have already been stripped of metadata.
              </p>
            </div>
          )}

          {/* Metadata table grouped */}
          {Object.entries(groupedEntries).map(([group, groupEntries]) => (
            <div key={group}>
              <h3 className="text-sm font-medium text-text-primary mb-2">
                {groupLabels[group] ?? group.toUpperCase()}
                {group === "gps" && (
                  <span className="ml-2 text-xs text-warning">⚠ Contains location data</span>
                )}
              </h3>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <tbody>
                    {groupEntries.map((entry, i) => (
                      <tr
                        key={`${entry.tag}-${i}`}
                        className={i % 2 === 0 ? "bg-bg-secondary" : "bg-bg-primary"}
                      >
                        <td className="px-3 py-2 text-text-muted w-1/3 align-top">
                          {entry.tag}
                        </td>
                        <td className="px-3 py-2 text-text-primary break-all">
                          {entry.value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {/* Actions */}
          <div className="flex items-center justify-center gap-3 flex-wrap">
            {entries.length > 0 && !cleanResult && (
              <button
                onClick={handleStrip}
                disabled={isStripping}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors disabled:opacity-50"
              >
                {isStripping ? "Stripping..." : "Remove EXIF & Download"}
              </button>
            )}
            {cleanResult && (
              <DownloadButton blob={cleanResult.blob} fileName={cleanResult.fileName} />
            )}
            {cleanResult && (
              <p className="text-sm text-text-muted w-full text-center">
                All metadata removed · {formatFileSize(cleanResult.newSize)}
              </p>
            )}
            <button
              onClick={handleReset}
              className="rounded-md border border-border px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-hover transition-colors"
            >
              {cleanResult ? "View another" : "Cancel"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
