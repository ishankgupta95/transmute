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
                "flex flex-none cursor-pointer items-center gap-2 rounded-[7px] border-0 p-2 text-left transition-colors duration-150 lg:w-full",
                "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-nocturne-accent",
                active
                  ? "bg-nocturne-accent/14 text-nocturne-accent-200"
                  : "bg-transparent text-nocturne-neutral-500 hover:bg-nocturne-text/5 hover:text-nocturne-neutral-300",
              )}
            >
              <span
                className={cn(
                  "h-[21px] w-0.5 flex-none rounded-sm",
                  active ? "bg-nocturne-accent" : "bg-transparent",
                )}
              />
              <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                <span className="max-w-[170px] truncate font-nocturne text-xs leading-[1.25] font-medium">
                  {t.name}
                </span>
                <span className="font-nocturne-mono text-[9px] leading-none tracking-[0.04em] opacity-60">
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
