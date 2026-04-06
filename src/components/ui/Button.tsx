import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

type Variant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const variantStyles: Record<Variant, string> = {
  primary:
    "bg-accent text-bg-primary shadow-lg shadow-accent/15 hover:opacity-90 hover:-translate-y-px hover:shadow-[0_6px_24px_rgba(86,184,230,0.25)] active:translate-y-0",
  secondary:
    "bg-transparent text-text-secondary border border-border-hover hover:text-text-primary hover:border-accent hover:shadow-[0_4px_16px_rgba(86,184,230,0.08)]",
  ghost:
    "text-text-secondary hover:text-text-primary hover:bg-[rgba(255,255,255,0.04)]",
};

export function Button({ variant = "primary", className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-bold transition-all duration-200 disabled:opacity-40 disabled:pointer-events-none",
        variantStyles[variant],
        className,
      )}
      {...props}
    />
  );
}
