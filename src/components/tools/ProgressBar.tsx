import { cn } from "@/lib/utils/cn";

interface ProgressBarProps {
  /**
   * Progress percentage 0–100. Pass `null` for an indeterminate bar
   * (use when the underlying operation does not report progress).
   */
  progress: number | null;
  /** Accessible label announcing what is progressing, e.g. "Converting to GIF". */
  label?: string;
  className?: string;
}

export function ProgressBar({ progress, label, className }: ProgressBarProps) {
  const indeterminate = progress === null;
  const value = indeterminate ? 0 : Math.min(100, Math.max(0, progress));

  return (
    <div
      className={cn("h-2 w-full rounded-full bg-bg-elevated overflow-hidden", className)}
      role="progressbar"
      aria-label={label ?? "Progress"}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(indeterminate ? {} : { "aria-valuenow": Math.round(value) })}
    >
      {indeterminate ? (
        <div className="h-full w-full rounded-full bg-accent/60 shadow-sm shadow-accent/30 animate-pulse motion-reduce:animate-none motion-reduce:opacity-60" />
      ) : (
        <div
          className="h-full rounded-full bg-accent shadow-sm shadow-accent/30 transition-all duration-300 motion-reduce:transition-none"
          style={{ width: `${value}%` }}
        />
      )}
    </div>
  );
}
