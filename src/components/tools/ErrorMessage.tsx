import { cn } from "@/lib/utils/cn";

interface ErrorMessageProps {
  message: string | null | undefined;
  className?: string;
}

export function ErrorMessage({ message, className }: ErrorMessageProps) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className={cn(
        "rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error",
        className,
      )}
    >
      {message}
    </div>
  );
}
