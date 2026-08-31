"use client";

import { useCallback } from "react";
import { Check, Copy } from "lucide-react";
import { useCopied } from "@/hooks/useCopied";
import { cn } from "@/lib/utils/cn";

interface CopyButtonProps {
  /** Text that will be copied to the clipboard. */
  value: string;
  /** Visible label, defaults to "Copy". Hidden when `iconOnly`. */
  label?: string;
  /** Render as an icon-only button (uses `aria-label` for accessibility). */
  iconOnly?: boolean;
  /** Override the accessible label — required when `iconOnly` and no `label`. */
  ariaLabel?: string;
  className?: string;
  /** When true, button is disabled (e.g. nothing to copy yet). */
  disabled?: boolean;
}

/**
 * Standardized copy-to-clipboard button. Honors a 44×44px minimum touch
 * target by default and exposes an `aria-label` so icon-only variants
 * remain accessible. Shares `useCopied` with the tools that render their own
 * copy affordance, so the confirmation timing cannot drift between them.
 */
export function CopyButton({
  value,
  label = "Copy",
  iconOnly = false,
  ariaLabel,
  className,
  disabled,
}: CopyButtonProps) {
  const { copied, copy } = useCopied();

  const handleClick = useCallback(() => {
    if (disabled) return;
    // `copy` resolves false on an insecure context or a denied permission and
    // leaves the label alone, so the button never claims a copy that failed.
    void copy(value);
  }, [copy, value, disabled]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      aria-label={ariaLabel ?? (copied ? "Copied" : `Copy ${label.toLowerCase()}`)}
      aria-live="polite"
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-bg-elevated text-sm text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary disabled:opacity-50 disabled:cursor-not-allowed",
        iconOnly ? "min-h-11 min-w-11 p-2" : "min-h-9 px-3 py-1.5",
        copied && "text-accent border-accent/40",
        className,
      )}
    >
      {copied ? (
        <Check size={iconOnly ? 18 : 14} aria-hidden="true" />
      ) : (
        <Copy size={iconOnly ? 18 : 14} aria-hidden="true" />
      )}
      {!iconOnly && <span>{copied ? "Copied" : label}</span>}
    </button>
  );
}
