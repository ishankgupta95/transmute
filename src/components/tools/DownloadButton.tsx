"use client";

import { Download } from "lucide-react";
import { triggerDownload } from "@/lib/utils/download";
import { cn } from "@/lib/utils/cn";

interface DownloadButtonProps {
  blob: Blob;
  fileName: string;
  className?: string;
}

export function DownloadButton({ blob, fileName, className }: DownloadButtonProps) {
  return (
    <button
      onClick={() => triggerDownload(blob, fileName)}
      className={cn(
        "inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors",
        className,
      )}
    >
      <Download size={16} />
      Download
    </button>
  );
}
