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
        "inline-flex items-center gap-2 rounded-md bg-accent px-6 py-3 text-sm font-bold text-bg-primary shadow-lg shadow-accent/15 transition-all duration-200 hover:opacity-90 hover:-translate-y-px hover:shadow-[0_6px_24px_rgba(86,184,230,0.25)] active:translate-y-0",
        className,
      )}
    >
      <Download size={16} />
      Download
    </button>
  );
}
