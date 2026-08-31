"use client";

import { openSearch } from "./CommandPalette";
import { useShortcutLabel } from "@/hooks/useIsClient";
import { cn } from "@/lib/utils/cn";

interface SearchTriggerProps {
  className?: string;
  /**
   * `bar` — the navbar pill. `field` — the larger homepage hero / 404 input.
   * `icon` — square, label-less; the phone top bar, where there is no keyboard
   * to press ⌘K with.
   */
  size?: "bar" | "field" | "icon";
  placeholder?: string;
  /** Overrides the placeholder — used by the hero's typewriter. */
  children?: React.ReactNode;
}

export function SearchTrigger({
  className,
  size = "bar",
  placeholder = "Search",
  children,
}: SearchTriggerProps) {
  const shortcut = useShortcutLabel();

  return (
    <button
      type="button"
      onClick={openSearch}
      aria-label="Search tools"
      aria-keyshortcuts="Meta+K Control+K"
      className={cn(
        "flex cursor-pointer items-center rounded-md border border-border text-text-muted transition-colors duration-200",
        "hover:border-accent/40 hover:text-text-secondary",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        size === "bar" && "h-[30px] gap-2 bg-transparent px-2.5 font-body text-xs",
        size === "field" &&
          "h-[54px] w-full max-w-[520px] gap-[11px] rounded-[11px] bg-bg-elevated px-4 font-body text-[15px] shadow-[0_8px_30px_rgba(0,0,0,.35)]",
        size === "icon" && "min-h-11 min-w-11 justify-center bg-transparent",
        className,
      )}
    >
      <svg
        width={size === "field" ? 17 : size === "icon" ? 16 : 12}
        height={size === "field" ? 17 : size === "icon" ? 16 : 12}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        className="flex-none"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>

      {size !== "icon" && (
        <>
          <span
            className={cn(
              "min-w-0 truncate text-left",
              size === "field" && "text-neutral-300",
            )}
          >
            {children ?? placeholder}
          </span>

          <kbd
            className={cn(
              "ml-auto flex-none rounded-sm font-mono leading-none font-medium",
              size === "bar"
                ? "bg-neutral-900 px-[5px] py-[3px] text-[10px] text-neutral-400"
                : "rounded-[5px] border border-border bg-bg-primary px-[7px] py-[5px] text-[10.5px] text-neutral-400",
            )}
          >
            {shortcut}
          </kbd>
        </>
      )}
    </button>
  );
}
