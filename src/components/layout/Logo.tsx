import { cn } from "@/lib/utils/cn";

/**
 * The seam — a hard-cornered bracket (the file as it arrived) beside a filled
 * semicircle (the file as it leaves), with a band of clear space between them.
 * The gap never closes: it's the same accent line the compare slider draws.
 *
 * Geometry is the Logo doc's two paths, verbatim: a 32×32 grid, 3-unit stroke,
 * mitred corners, butt caps, the arc a true semicircle at radius 11. (The doc's
 * prose calls the seam "2 units at x=15.5"; its own paths put the bracket's arms
 * at x=13 and the arc's chord at x=16.5 — a 3.5-unit gap. The paths win: all 13
 * instances in the doc are drawn from them.)
 *
 * Clear space is one bracket-width — 13 − 7.5 = 5.5 of 32, i.e. 17.2% of the
 * rendered size (3.6px at 21, 3.3px at 19) — on every side. Deliberately not
 * encoded as padding: padding would change the lockup's measured box and break
 * the 9px mark-to-wordmark gap the screen docs specify. Callers clear it by
 * layout (the navbar's `gap-5` to the nav pills; the footer lockup stands alone).
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
  /** Mark size in px. The wordmark's size is stated, not derived — see below. */
  size?: number;
  className?: string;
  /** Overrides the mark's colour, for the section and light grounds. */
  markClassName?: string;
  /** Carries the wordmark's size, and may override its colour. */
  wordmarkClassName?: string;
  /** Stacked is the narrow lockup from the Logo doc (38 / 22 / 13px gap). */
  stacked?: boolean;
}

/**
 * Mark plus wordmark — the primary lockup.
 *
 * Every lockup in the docs states its wordmark size literally, and no single
 * ratio to the mark satisfies them (navbar .714, footer .737, mobile shell .750,
 * the Logo doc's own three cards .833 / .579 / .654). So the caller passes the
 * size through `wordmarkClassName`; the default is the navbar's 15px.
 *
 * The mark and wordmark colours are overridable so the lockup can reverse: the
 * Logo doc's ground test paints both `#e4e7f5` (`text-neutral-200`) on
 * `--color-section` and `#5d5294` (`text-accent-700`) on `--color-neutral-100`.
 */
export function Logo({
  size = 21,
  className,
  markClassName,
  wordmarkClassName,
  stacked = false,
}: LogoProps) {
  return (
    <span
      className={cn(
        "flex",
        stacked ? "flex-col items-start gap-[13px]" : "items-center gap-[9px]",
        className,
      )}
    >
      <LogoMark size={size} className={cn("text-accent", markClassName)} />
      <span
        className={cn(
          "font-display font-semibold text-text-primary",
          stacked ? "text-[22px] tracking-[-0.022em]" : "text-[15px] tracking-[-0.015em]",
          wordmarkClassName,
          // Last, deliberately: tailwind-merge treats a font-size class as
          // conflicting with leading, so a caller's `text-[14px]` would strip an
          // earlier `leading-none`. Every lockup in the docs is `/1`.
          "leading-none",
        )}
      >
        Transmute
      </span>
    </span>
  );
}
