import { workspaceCategories, type WorkspaceFilter } from "@/data/workspace";
import { chipClass } from "@/components/workspace/shared";

interface TopBarProps {
  category: string;
  toolName: string;
  filter: WorkspaceFilter;
  onFilterChange: (filter: WorkspaceFilter) => void;
}

export function TopBar({ category, toolName, filter, onFilterChange }: TopBarProps) {
  return (
    /* Background runs edge to edge; the content stops at the site's measure. */
    <div className="border-b border-nocturne-divider bg-nocturne-chrome">
      <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-4 px-3.5 py-2.5 pl-[18px] lg:h-13 lg:flex-nowrap lg:py-0">
        <div className="flex flex-none items-center gap-[7px] font-nocturne-mono text-[11px] leading-none whitespace-nowrap text-nocturne-neutral-500">
          <span>{category}</span>
          <span className="opacity-45">/</span>
          <span className="text-nocturne-text">{toolName}</span>
        </div>

        <div
          className="flex flex-none items-center gap-[5px] lg:ml-auto"
          role="group"
          aria-label="Filter tools by category"
        >
          {workspaceCategories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onFilterChange(c)}
              aria-pressed={filter === c}
              className={chipClass(
                filter === c,
                "px-[9px] py-[5px] font-nocturne-mono text-[10px] tracking-[0.06em]",
              )}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="ml-3 flex flex-none items-center gap-[7px]">
          <span className="size-1.5 animate-tm-blink rounded-full bg-nocturne-ok motion-reduce:animate-none" />
          <span className="font-nocturne-mono text-[10.5px] leading-none tracking-[0.04em] whitespace-nowrap text-nocturne-neutral-500">
            LOCAL
          </span>
        </div>
      </div>
    </div>
  );
}
