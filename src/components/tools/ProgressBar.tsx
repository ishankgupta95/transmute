import { cn } from "@/lib/utils/cn";

interface ProgressBarProps {
  progress: number;
  className?: string;
}

export function ProgressBar({ progress, className }: ProgressBarProps) {
  return (
    <div className={cn("h-2 w-full rounded-full bg-bg-elevated overflow-hidden", className)}>
      <div
        className="h-full rounded-full bg-accent transition-all duration-300"
        style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
      />
    </div>
  );
}
