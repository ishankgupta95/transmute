import { cn } from "@/lib/utils/cn";

/** Sizes under a megabyte read better in KB. */
export function fmtMB(n: number): string {
  return n >= 1 ? `${n.toFixed(2)} MB` : `${Math.round(n * 1024)} KB`;
}

/** Turn a 0–100 position on a clip of `total` seconds into `m:ss`. */
export function mmss(pct: number, total: number): string {
  const t = (pct / 100) * total;
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
}

/**
 * The one interactive chip in this UI — preset picks, choice controls and the
 * category filters all wear it. Outlined, never filled: the accent carries the
 * selected state as a line and a tint.
 */
export function chipClass(active: boolean, extra?: string): string {
  return cn(
    "cursor-pointer whitespace-nowrap rounded-md border font-nocturne font-medium transition-all duration-200",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nocturne-accent",
    active
      ? "border-nocturne-accent bg-nocturne-accent/12 text-nocturne-accent hover:bg-nocturne-accent/20"
      : "border-nocturne-divider bg-transparent text-nocturne-neutral-400 hover:border-nocturne-accent/40 hover:text-nocturne-accent-200",
    extra,
  );
}

/**
 * Range inputs are styled per-pseudo-element rather than in a stylesheet, so the
 * whole system stays in Tailwind utilities. WebKit and Gecko need separate rules;
 * the design only specified WebKit, so the Gecko half mirrors it.
 */
export const RANGE_CLASS = cn(
  "h-[22px] w-full cursor-pointer appearance-none bg-transparent",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nocturne-accent",
  // track
  "[&::-webkit-slider-runnable-track]:h-0.5 [&::-webkit-slider-runnable-track]:rounded-sm [&::-webkit-slider-runnable-track]:bg-nocturne-neutral-800",
  "[&::-moz-range-track]:h-0.5 [&::-moz-range-track]:rounded-sm [&::-moz-range-track]:bg-nocturne-neutral-800",
  // thumb
  "[&::-webkit-slider-thumb]:-mt-1.5 [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full",
  "[&::-webkit-slider-thumb]:border-[1.5px] [&::-webkit-slider-thumb]:border-nocturne-accent [&::-webkit-slider-thumb]:bg-nocturne-bg",
  "[&::-webkit-slider-thumb]:shadow-[0_0_0_4px_var(--tm-ring)] [&::-webkit-slider-thumb]:transition-shadow",
  "hover:[&::-webkit-slider-thumb]:shadow-[0_0_0_7px_var(--tm-ring-hover)]",
  "[&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full",
  "[&::-moz-range-thumb]:border-[1.5px] [&::-moz-range-thumb]:border-nocturne-accent [&::-moz-range-thumb]:bg-nocturne-bg",
  "[&::-moz-range-thumb]:shadow-[0_0_0_4px_var(--tm-ring)] [&::-moz-range-thumb]:transition-shadow",
  "hover:[&::-moz-range-thumb]:shadow-[0_0_0_7px_var(--tm-ring-hover)]",
  "[--tm-ring:color-mix(in_srgb,var(--color-nocturne-accent)_16%,transparent)]",
  "[--tm-ring-hover:color-mix(in_srgb,var(--color-nocturne-accent)_20%,transparent)]",
);

/** Scroll panes inside the shell get a thin themed bar rather than the OS default. */
export const SCROLL_CLASS = cn(
  "[&::-webkit-scrollbar]:size-[9px]",
  "[&::-webkit-scrollbar-thumb]:rounded-[9px] [&::-webkit-scrollbar-thumb]:bg-nocturne-neutral-800",
  "[&::-webkit-scrollbar-track]:bg-transparent",
);

/** The all-caps mono label used for every section heading and readout. */
export const MONO_LABEL =
  "font-nocturne-mono text-[9.5px] leading-none font-medium tracking-[0.14em] text-nocturne-neutral-500";

/** Smaller mono text for inline metadata. */
export const MONO_META =
  "font-nocturne-mono text-[10.5px] leading-none text-nocturne-neutral-500";
