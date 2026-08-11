"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { cn } from "@/lib/utils/cn";
import { chipClass, MONO_LABEL, SCROLL_CLASS } from "@/components/workspace/shared";

/*
  The Tool Redesign doc puts a tool's controls in a right-hand rail on desktop
  and, below `lg`, in a bottom sheet under the canvas ("Tablet keeps the canvas
  and pushes controls to a bottom sheet. Phone is canvas-first, one sheet, one
  action.").

  `ToolPageLayout` opens a two-column grid only when it finds `[data-tool-aside]`
  inside the canvas, so a tool that has not been migrated yet keeps the full
  width and nothing breaks mid-migration.

  Styling deliberately mirrors `components/workspace/Sidebar.tsx`, which is the
  same panel drawn for the design explorer.
*/

const SECTION = "border-b border-border px-4 py-3.5";

/**
 * Touch wants a bigger target than the 14px thumb the desktop screens draw, so
 * the thumb grows below `lg` — the doc's Phone screen specifies exactly this.
 */
export const TOOL_RANGE_CLASS = cn(
  "h-[22px] w-full cursor-pointer appearance-none bg-transparent",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
  "[&::-webkit-slider-runnable-track]:h-0.5 [&::-webkit-slider-runnable-track]:rounded-sm [&::-webkit-slider-runnable-track]:bg-neutral-800",
  "[&::-moz-range-track]:h-0.5 [&::-moz-range-track]:rounded-sm [&::-moz-range-track]:bg-neutral-800",
  "[&::-webkit-slider-thumb]:-mt-[9px] [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full",
  "lg:[&::-webkit-slider-thumb]:-mt-1.5 lg:[&::-webkit-slider-thumb]:size-3.5",
  "[&::-webkit-slider-thumb]:border-[1.5px] [&::-webkit-slider-thumb]:border-accent [&::-webkit-slider-thumb]:bg-bg-primary",
  "[&::-webkit-slider-thumb]:shadow-[0_0_0_4px_var(--tm-ring)] [&::-webkit-slider-thumb]:transition-shadow",
  "hover:[&::-webkit-slider-thumb]:shadow-[0_0_0_7px_var(--tm-ring-hover)]",
  "[&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full",
  "lg:[&::-moz-range-thumb]:size-3.5",
  "[&::-moz-range-thumb]:border-[1.5px] [&::-moz-range-thumb]:border-accent [&::-moz-range-thumb]:bg-bg-primary",
  "[&::-moz-range-thumb]:shadow-[0_0_0_4px_var(--tm-ring)] [&::-moz-range-thumb]:transition-shadow",
  "hover:[&::-moz-range-thumb]:shadow-[0_0_0_7px_var(--tm-ring-hover)]",
  "[--tm-ring:color-mix(in_srgb,var(--color-accent)_16%,transparent)]",
  "[--tm-ring-hover:color-mix(in_srgb,var(--color-accent)_20%,transparent)]",
);

interface ToolAsideProps {
  /** Optional heading — usually the tool's own name is already in the top bar. */
  title?: string;
  blurb?: string;
  children: ReactNode;
  /** Pinned to the bottom of the rail / sheet: the primary action. */
  footer?: ReactNode;
}

export function ToolAside({ title, blurb, children, footer }: ToolAsideProps) {
  return (
    <aside
      data-tool-aside
      aria-label="Settings"
      className={cn(
        "flex min-w-0 flex-col rounded-xl border border-border bg-nocturne-rail",
        // Below lg this is the sheet: it sits under the canvas, edge to edge.
        "lg:sticky lg:top-[74px] lg:max-h-[calc(100vh-124px)] lg:self-start",
      )}
    >
      {/* The sheet's grabber — the doc draws one on tablet and phone. */}
      <div className="flex justify-center pt-2.5 pb-0.5 lg:hidden">
        <span aria-hidden="true" className="h-[3px] w-9 rounded-sm bg-neutral-700" />
      </div>

      {title && (
        <div className="flex flex-col gap-[5px] border-b border-border px-4 pt-[15px] pb-3">
          <div className="font-display text-base leading-[1.2] font-medium text-text-primary">
            {title}
          </div>
          {blurb && (
            <div className="font-body text-[11.5px] leading-[1.45] text-text-muted">
              {blurb}
            </div>
          )}
        </div>
      )}

      <div className={cn("flex min-h-0 flex-1 flex-col lg:overflow-y-auto", SCROLL_CLASS)}>
        {children}
      </div>

      {footer && (
        <div className="flex flex-col gap-[9px] border-t border-border px-4 py-[13px]">
          {footer}
        </div>
      )}
    </aside>
  );
}

/** A labelled block inside the rail. Pass `label` for the mono section heading. */
export function ToolAsideSection({
  label,
  children,
  className,
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(SECTION, "flex flex-col gap-[9px] last:border-b-0", className)}>
      {label && <div className={cn(MONO_LABEL, "text-text-muted")}>{label}</div>}
      {children}
    </div>
  );
}

interface ToolChoiceProps<T extends string | number> {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group — required, the chips alone are ambiguous. */
  label: string;
  disabled?: boolean;
  /** Chips share the row width instead of hugging their text. */
  fill?: boolean;
}

export function ToolChoice<T extends string | number>({
  options,
  value,
  onChange,
  label,
  disabled,
  fill,
}: ToolChoiceProps<T>) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          aria-pressed={o.value === value}
          className={cn(
            chipClass(o.value === value, "px-3 py-[7px] text-xs disabled:opacity-45"),
            fill && "flex-1",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface ToolSliderProps {
  label: string;
  /** The right-hand readout, e.g. "80%" or "1.4 MB". */
  display: string;
  hint?: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

export function ToolSlider({
  label,
  display,
  hint,
  min,
  max,
  step = 1,
  value,
  onChange,
  disabled,
}: ToolSliderProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2.5">
        <span className="font-body text-[12.5px] leading-[1.2] text-neutral-300">{label}</span>
        <span className="font-mono text-xs leading-none font-medium text-accent-300">
          {display}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className={cn(TOOL_RANGE_CLASS, disabled && "cursor-not-allowed opacity-45")}
      />
      {hint && (
        <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">{hint}</span>
      )}
    </div>
  );
}

/** The key/value readout the doc puts under OUTPUT. */
export function ToolOutput({ rows }: { rows: readonly [string, string][] }) {
  return (
    <div className="flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border">
      {rows.map(([label, value], i) => (
        <div
          key={label}
          className="flex items-center justify-between gap-3 bg-bg-primary px-3 py-[9px]"
        >
          <span className="flex-none font-body text-[11.5px] leading-none text-text-muted">
            {label}
          </span>
          <span
            className={cn(
              "truncate text-right font-mono text-[11.5px] leading-none font-medium",
              i === 1 ? "text-accent-300" : "text-neutral-300",
            )}
          >
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The quiet reset affordance, on its own when the primary slot holds a download. */
export function ToolResetLink({
  onClick,
  label = "START OVER",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer self-end rounded-sm font-mono text-[10px] leading-none tracking-[0.04em] text-text-muted transition-colors duration-200 hover:text-accent-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {label}
    </button>
  );
}

/** The pinned action row: one primary button, one quiet reset. */
export function ToolActions({
  primaryLabel,
  onPrimary,
  primaryDisabled,
  onReset,
  resetLabel = "RESET",
}: {
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  onReset?: () => void;
  resetLabel?: string;
}) {
  // The doc's "⌘↵ TO RUN" — bound for real, so the hint is a promise kept.
  useEffect(() => {
    if (primaryDisabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        onPrimary();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onPrimary, primaryDisabled]);

  return (
    <>
      <button
        type="button"
        onClick={onPrimary}
        disabled={primaryDisabled}
        className={cn(
          "h-11 w-full cursor-pointer rounded-[9px] border border-accent bg-accent/10 font-display text-sm leading-none font-medium text-accent",
          "transition-colors duration-200 hover:bg-accent/20",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          "disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-accent/10",
          "lg:h-10",
        )}
      >
        {primaryLabel}
      </button>
      {onReset && (
        <div className="flex items-center justify-between">
          {/* ⌘↵ means nothing on touch — the sheet keeps the device line. */}
          <span className="font-mono text-[10px] leading-none tracking-[0.04em] text-text-muted lg:hidden">
            RUNS ON THIS DEVICE
          </span>
          <span className="hidden font-mono text-[10px] leading-none tracking-[0.04em] text-text-muted lg:inline">
            ⌘↵ TO RUN
          </span>
          <button
            type="button"
            onClick={onReset}
            className="cursor-pointer rounded-sm font-mono text-[10px] leading-none tracking-[0.04em] text-text-muted transition-colors duration-200 hover:text-accent-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {resetLabel}
          </button>
        </div>
      )}
    </>
  );
}

/** A named preset for the START FROM row. Applying it lives with the caller. */
export interface ToolPreset {
  id: string;
  label: string;
  /** One honest sentence shown under the chips while this preset is active. */
  note: string;
}

/**
 * The doc's START FROM row: preset chips plus the active preset's note.
 * Callers apply settings on select and must flip `active` back to "custom"
 * whenever a control is touched by hand — a preset chip that stays lit over
 * hand-edited settings would misstate what actually runs.
 */
export function ToolPresets({
  presets,
  active,
  onSelect,
  disabled,
}: {
  presets: readonly ToolPreset[];
  active: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  const current = presets.find((p) => p.id === active);
  return (
    <ToolAsideSection label="START FROM">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Start from preset">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={active === p.id}
            disabled={disabled}
            onClick={() => onSelect(p.id)}
            className={chipClass(
              active === p.id,
              "px-2.5 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-45",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {current && (
        <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
          {current.note}
        </span>
      )}
    </ToolAsideSection>
  );
}

/**
 * The doc's ADVANCED disclosure. Rows are engine facts, stated only where
 * true — this section never carries aspirational values.
 */
export function ToolAdvanced({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return (
    <details className={cn(SECTION, "group last:border-b-0")}>
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-2",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        )}
      >
        <span className={cn(MONO_LABEL, "text-text-muted")}>ADVANCED</span>
        <span className="font-mono text-[9.5px] leading-none text-text-muted">{rows.length}</span>
        <span
          aria-hidden="true"
          className="ml-auto font-mono text-[11px] leading-none text-text-muted transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none"
        >
          ›
        </span>
      </summary>
      <div className="flex flex-col gap-2 pt-[9px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3">
            <span className="font-body text-xs text-text-muted">{k}</span>
            <span className="text-right font-mono text-[10px] leading-[1.4] font-medium tracking-[0.04em] text-neutral-300">
              {v}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}
