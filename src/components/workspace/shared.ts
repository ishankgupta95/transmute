import { cn } from "@/lib/utils/cn";

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

/** Scroll panes inside the shell get a thin themed bar rather than the OS default. */
export const SCROLL_CLASS = cn(
  "[&::-webkit-scrollbar]:size-[9px]",
  "[&::-webkit-scrollbar-thumb]:rounded-[9px] [&::-webkit-scrollbar-thumb]:bg-nocturne-neutral-800",
  "[&::-webkit-scrollbar-track]:bg-transparent",
);

/** The all-caps mono label used for every section heading and readout. */
export const MONO_LABEL =
  "font-nocturne-mono text-[9.5px] leading-none font-medium tracking-[0.14em] text-nocturne-neutral-500";


/*
  ── Tool canvas geometry ──────────────────────────────────────────────────
  Shared by the tool pages (`ToolPageLayout`) and the workspace shell
  (`Workspace.tsx`), which draw the same surface and must not drift. Kept in
  this module rather than `ToolPageLayout` because that file is a Server
  Component pulling in the whole registry — importing from it would drag that
  graph into the client bundle.
*/

/**
 * The tool's own interactive surface: canvas on the left, control rail on the
 * right once there is room for both.
 *
 * The split waits for `xl`, not `lg`. At `lg` the 230px sibling rail has
 * already landed, so adding a 328px control rail on top of it left the canvas
 * column *narrower* at 1024 (374px) than it was at 768 (704px) — the preview
 * shrank as the window grew.
 *
 * With a rail present the width ceiling is the band itself (1440) minus the
 * sibling rail and the band padding; naming a smaller number here silently
 * capped the tool below the space it actually had.
 */
export const TOOL_SURFACE = cn(
  "relative mx-auto grid w-full max-w-[820px] grid-cols-1 items-start gap-5",
  "has-[[data-tool-aside]]:max-w-none",
  // Absorb the band's leftover height so the stage below has something
  // definite to grow into; `min-h-0` keeps it able to shrink again.
  "lg:min-h-0 lg:flex-1",
  // Stacked (lg–xl): canvas takes the slack, the sheet stays intrinsic under
  // it. Without the explicit rows both children shrink-wrap and the band goes
  // back to being mostly empty.
  "lg:has-[[data-tool-aside]]:grid-rows-[minmax(0,1fr)_auto]",
  "lg:has-[[data-tool-aside]]:items-stretch",
  // Side by side (xl and up): one row, two columns.
  //
  // The rail is the doc's flat 340px (`aside width:340px;flex:none`). The
  // `clamp(300px,24%,368px)` it replaces never reached that number: inside the
  // 1440 band minus the 230px sibling rail minus the band padding, 24% of
  // ~1146 is 275, so the clamp floor won and every screen up to 1920 drew a
  // 300px rail.
  "xl:has-[[data-tool-aside]]:grid-rows-none",
  "xl:has-[[data-tool-aside]]:grid-cols-[minmax(0,1fr)_340px]",
  "xl:has-[[data-tool-aside]]:gap-7",
);

/**
 * The canvas half of a tool. A flex column (not `space-y-*`) so exactly one
 * child can be marked `STAGE_GROW` and take the slack.
 *
 * `gap:14px` is the doc's modal canvas gap (it draws 12px for the batch queue
 * and 16px for audio/favicon; 14 is the value four of its seven branches use).
 * The rise-in is the doc's `animation:tmRise …` on every loaded branch — it ran
 * on exactly one canvas (`RecordStage`) before this.
 */
export const CANVAS_COLUMN =
  "flex min-h-0 min-w-0 animate-tm-rise flex-col gap-[14px] motion-reduce:animate-none";

/**
 * Put on the one `CanvasStage` that should absorb the column's leftover
 * height — the video plate, the image compare, the page deck.
 */
export const STAGE_GROW = "min-h-0 flex-1";

/**
 * Media inside a growing stage. `h-full` fills the plate when the column has a
 * definite height (xl and up); below that the column is intrinsic, `h-full`
 * resolves to `auto`, and the vh cap is what stops a 4K source from running
 * past the fold.
 */
export const STAGE_MEDIA = "h-full max-h-[70vh] w-full object-contain";

