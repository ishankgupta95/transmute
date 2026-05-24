import { cn } from "@/lib/utils/cn";

interface StatusMessageProps {
  /** Live region politeness — "polite" for processing/done, "assertive" for errors. */
  tone?: "polite" | "assertive";
  className?: string;
  children: React.ReactNode;
}

/**
 * Wraps status text (e.g. "Loading FFmpeg…", "Converting (42%)") in an
 * `aria-live` region so screen readers announce state changes.
 */
export function StatusMessage({ tone = "polite", className, children }: StatusMessageProps) {
  return (
    <p
      aria-live={tone}
      aria-atomic="true"
      className={cn("text-sm text-text-muted text-center", className)}
    >
      {children}
    </p>
  );
}
