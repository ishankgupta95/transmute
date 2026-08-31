import { cn } from "@/lib/utils/cn";

interface StatusMessageProps {
  /** Live region politeness — "polite" for processing/done, "assertive" for errors. */
  tone?: "polite" | "assertive";
  /**
   * Text that changes many times per run (a percentage, a frame counter).
   * Rendered in the same sentence but OUTSIDE the live region, so a screen
   * reader announces the phase once instead of re-reading the whole line on
   * every tick.
   */
  detail?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

/**
 * Wraps status text (e.g. "Loading FFmpeg…", "Converting") in an `aria-live`
 * region so screen readers announce state changes. The announced part is the
 * phase; pass fast-changing progress through `detail`.
 */
export function StatusMessage({
  tone = "polite",
  detail,
  className,
  children,
}: StatusMessageProps) {
  return (
    <p className={cn("text-sm text-text-muted text-center", className)}>
      <span aria-live={tone} aria-atomic="true">
        {children}
      </span>
      {detail}
    </p>
  );
}
