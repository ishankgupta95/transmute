"use client";

import type { ReactNode } from "react";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { ToolAsideSection } from "@/components/tools/ToolAside";
import { MONO_LABEL } from "@/components/workspace/shared";
import { cn } from "@/lib/utils/cn";

/*
  The pieces a tool composes *inside* `ToolAside`.

  `ToolAside` owns the rail itself — its shell, its footer box, its primary.
  These three live here because they are assembled per tool: the doc puts all
  of a tool's controls in ONE bordered block, and it pins the running readout
  to the rail footer rather than leaving it under the canvas.
*/

/**
 * The Tool Redesign doc draws every control of a tool inside a single bordered
 * section — `START FROM`, `ADVANCED` and `OUTPUT` are the only siblings that
 * get their own rule. Controls sit `17px` apart inside it.
 *
 * Before this, each control carried its own `ToolAsideSection` and therefore
 * its own bottom border, which drew the rail as five thin stripes instead of
 * one panel.
 */
export function ToolControlGroup({ children }: { children: ReactNode }) {
  return <ToolAsideSection className="gap-[17px]">{children}</ToolAsideSection>;
}

/**
 * One control inside `ToolControlGroup`: an optional mono heading over the
 * control itself, `8px` apart, as the doc sets it.
 */
export function ToolControl({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {label && <div className={cn(MONO_LABEL, "text-text-muted")}>{label}</div>}
      {children}
    </div>
  );
}

/**
 * The doc's progress block, which lives in the rail footer above the primary —
 * not under the canvas, where it used to sit far from the button that started
 * the run.
 *
 * The label row is a mono split: the tool's own phase on the left, the real
 * percentage on the right. `percent === null` means the underlying operation
 * reports no progress (a WAV write, a canvas crop), so the readout says so
 * rather than inventing a number — the bar goes indeterminate to match.
 */
export function ToolProgress({
  phase,
  percent,
  label,
}: {
  /** Short, all-caps, and true of what is running: "COMPRESSING", "ENCODING GIF". */
  phase: string;
  /** 0–100, or `null` when the operation reports no progress. */
  percent: number | null;
  /** Accessible name for the bar; defaults to the phase. */
  label?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 font-mono text-[10.5px] leading-none text-text-muted">
        <span aria-live="polite" aria-atomic="true">
          {phase}
        </span>
        <span className="text-accent-300">{percent === null ? "WORKING" : `${percent}%`}</span>
      </div>
      <ProgressBar progress={percent} label={label ?? phase} />
    </div>
  );
}
