"use client";

import { useEffect, useRef } from "react";
import { Download } from "lucide-react";
import { triggerDownload } from "@/lib/utils/download";
import { cn } from "@/lib/utils/cn";

interface DownloadButtonProps {
  blob: Blob;
  fileName: string;
  className?: string;
  /**
   * Take focus on mount. Default on: this button replaces the primary the user
   * just pressed, so without it the focused element is torn out of the DOM and
   * focus falls back to <body> — the keyboard user has to Tab past the whole
   * navbar and sibling rail to get back to their result. WCAG 2.4.3.
   */
  focusOnMount?: boolean;
}

export function DownloadButton({
  blob,
  fileName,
  className,
  focusOnMount = true,
}: DownloadButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!focusOnMount) return;
    // Only when focus was actually orphaned. A user who tabbed elsewhere while
    // the job ran keeps their place — stealing it back would be its own bug.
    if (document.activeElement === document.body || document.activeElement === null) {
      ref.current?.focus();
    }
  }, [focusOnMount]);

  return (
    <button
      ref={ref}
      type="button"
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
