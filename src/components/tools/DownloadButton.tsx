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
      aria-label={`Download ${fileName}`}
      className={cn(
        "inline-flex items-center gap-2 rounded-md bg-accent px-6 py-3 text-sm font-bold text-bg-primary shadow-lg shadow-accent/15 transition-all duration-200 motion-reduce:transition-none hover:opacity-90 hover:-translate-y-px motion-reduce:hover:translate-y-0 hover:shadow-[0_6px_24px_var(--color-glow-accent)] active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary",
        className,
      )}
    >
      <Download size={16} aria-hidden="true" />
      Download
    </button>
  );
}
