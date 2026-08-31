import { cn } from "@/lib/utils/cn";

interface WarningMessageProps {
  message: string | null | undefined;
  className?: string;
}

/**
 * ErrorMessage's non-fatal sibling: the run succeeded, but something was
 * dropped along the way (frames, pages). role="status" — it informs, it does
 * not alert — and the warning token instead of the error red.
 */
export function WarningMessage({ message, className }: WarningMessageProps) {
  if (!message) return null;
  return (
    <div
      role="status"
      className={cn(
        "rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning",
        className,
      )}
    >
      {message}
    </div>
  );
}
