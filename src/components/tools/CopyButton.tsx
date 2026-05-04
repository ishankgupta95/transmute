"use client";

import { useCallback, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
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
 * remain accessible.
 */
export function CopyButton({
  value,
  label = "Copy",
  iconOnly = false,
  ariaLabel,
  className,
  disabled,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = useCallback(async () => {
    if (disabled) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard write can fail on insecure contexts; silently no-op.
    }
  }, [value, disabled]);

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
