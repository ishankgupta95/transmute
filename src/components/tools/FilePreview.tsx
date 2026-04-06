"use client";

import { formatFileSize } from "@/lib/utils/file-helpers";

interface FilePreviewProps {
  fileName: string;
  fileSize: number;
  previewUrl?: string;
  label?: string;
}

export function FilePreview({ fileName, fileSize, previewUrl, label }: FilePreviewProps) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-bg-secondary p-4">
      {label && (
        <span className="text-xs font-medium text-text-muted uppercase tracking-wide">
          {label}
        </span>
      )}
      {previewUrl && (
        <img
          src={previewUrl}
          alt={fileName}
          className="max-h-48 rounded object-contain"
        />
      )}
      <p className="text-sm text-text-primary truncate max-w-full">{fileName}</p>
      <p className="text-xs text-text-muted">{formatFileSize(fileSize)}</p>
    </div>
  );
}
