import { cn } from "@/lib/utils/cn";

/**
 * The seam — a hard-cornered bracket (the file as it arrived) beside a filled
 * semicircle (the file as it leaves), with two units of clear space between them.
 * The gap never closes: it's the same accent line the compare slider draws.
 *
 * Painted in `currentColor` so it reverses onto light and section grounds.
 * Below 16px the design calls for the arc alone — see `LogoArc`.
 */
export function LogoMark({
  size = 21,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn("flex-none", className)}
    >
      <path
        d="M13 6.5 H7.5 V25.5 H13"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinejoin="miter"
        fill="none"
      />
      <path d="M16.5 5 A11 11 0 0 1 16.5 27 Z" fill="currentColor" />
    </svg>
  );
}

/** The mark at sizes too small for the bracket and seam to survive. */
export function LogoArc({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn("flex-none", className)}
    >
      <path d="M16.5 5 A11 11 0 0 1 16.5 27 Z" fill="currentColor" />
    </svg>
  );
}

interface LogoProps {
  /** Mark size in px; the wordmark scales alongside it. */
  size?: number;
  className?: string;
  wordmarkClassName?: string;
  /** Stacked is the narrow lockup from the Logo doc. */
  stacked?: boolean;
}

/** Mark plus wordmark — the primary lockup. */
export function Logo({
  size = 21,
  className,
  wordmarkClassName,
  stacked = false,
}: LogoProps) {
  return (
    <span
      className={cn(
        "flex",
        stacked ? "flex-col items-start gap-3" : "items-center gap-[9px]",
        className,
      )}
    >
      <LogoMark size={size} className="text-accent" />
      <span
        className={cn(
          "font-display leading-none font-semibold tracking-[-0.015em] text-text-primary",
          wordmarkClassName,
        )}
        style={{ fontSize: size * 0.72 }}
      >
        Transmute
      </span>
    </span>
  );
}
