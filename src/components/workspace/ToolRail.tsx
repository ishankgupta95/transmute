"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils/cn";
import type { WorkspaceTool } from "@/data/workspace";
import { SCROLL_CLASS } from "@/components/workspace/shared";
import { RecentOutputs } from "@/components/tools/RecentOutputs";

interface ToolRailProps {
  tools: WorkspaceTool[];
  activeSlug: string;
  onPick: (slug: string) => void;
}

export function ToolRail({ tools, activeSlug, onPick }: ToolRailProps) {
  const listRef = useRef<HTMLDivElement>(null);

  /*
    The list is a real scroller now that the shell is one screen tall (doc:
    `flex:1;overflow-y:auto` on a `height:770px` band), so `?tool=` deep links
    to anything past the first fifteen rows would land with no selected row on
    screen — and the horizontal phone strip had the same blind spot all along.
    `block:"nearest"` is deliberate: a row that is already visible is left
    exactly where it is, so clicking through the rail never jerks the list.
  */
  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-current="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeSlug]);

  return (
    <nav
      aria-label="Tools"
      className="flex flex-none flex-col border-b border-nocturne-divider bg-nocturne-rail lg:w-[230px] lg:border-r lg:border-b-0"
    >
      <div className="flex items-baseline justify-between px-3 pt-3 pb-[9px]">
        <span className="font-nocturne-mono text-[9.5px] leading-none font-medium tracking-[0.14em] text-nocturne-neutral-500">
          TOOLS
        </span>
        <span className="font-nocturne-mono text-[9.5px] leading-none text-nocturne-neutral-500">
          {tools.length} SHOWN
        </span>
      </div>

      <div
        ref={listRef}
        className={cn(
          "flex gap-px overflow-x-auto px-2 pb-3 lg:flex-1 lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto",
          SCROLL_CLASS,
        )}
      >
        {tools.map((t) => {
          const active = t.slug === activeSlug;
          return (
            <button
              key={t.slug}
              type="button"
              onClick={() => onPick(t.slug)}
              aria-current={active ? "true" : undefined}
              // Without this the name concatenates to "HEIC to JPGHEIC → JPG".
              aria-label={`${t.name} — ${t.route}`}
              className={cn(
                "flex flex-none cursor-pointer items-center gap-2 rounded-[7px] border-0 px-2 py-[7px] text-left transition-colors duration-150 lg:w-full",
                "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-nocturne-accent",
                active
                  ? "bg-nocturne-accent/14 text-nocturne-accent-200"
                  : "bg-transparent text-nocturne-neutral-500 hover:bg-nocturne-text/5 hover:text-nocturne-neutral-300",
              )}
            >
              <span
                className={cn(
                  // A 2px bar with the project's 4px `rounded-sm` is a lozenge; the doc
                  // draws `border-radius:2px`.
                  "h-[21px] w-0.5 flex-none rounded-[2px]",
                  active ? "bg-nocturne-accent" : "bg-transparent",
                )}
              />
              <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                <span className="max-w-[170px] truncate font-nocturne text-xs leading-[1.25] font-medium">
                  {t.name}
                </span>
                {/* The route line is the only thing separating near-identical
                    entries ("to 100 KB" / "to 200 KB"), so it gets a real
                    colour rather than 60% of the parent's — that composited to
                    3.04:1 at 9px on every row. */}
                <span
                  className={cn(
                    "font-nocturne-mono text-[9px] leading-none tracking-[0.04em]",
                    active ? "text-nocturne-accent-300" : "text-nocturne-neutral-400",
                  )}
                >
                  {t.route}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Real entries from this browser's saved downloads — hidden until
          the first one exists (desktop rail only; the horizontal mobile
          strip has no room for it). */}
      <div className="hidden lg:block">
        <RecentOutputs onPickTool={onPick} />
      </div>
    </nav>
  );
}
