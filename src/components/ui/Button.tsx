import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

type Variant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const variantStyles: Record<Variant, string> = {
  primary:
    "bg-accent text-bg-primary hover:bg-accent-hover",
  secondary:
    "bg-bg-elevated text-text-primary border border-border hover:bg-bg-hover",
  ghost:
    "text-text-secondary hover:text-text-primary hover:bg-bg-hover",
};

export function Button({ variant = "primary", className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none",
        variantStyles[variant],
        className,
      )}
      {...props}
    />
  );
}
