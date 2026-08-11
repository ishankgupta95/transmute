"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { MONO_LABEL, SCROLL_CLASS } from "@/components/workspace/shared";
import { TOOL_RANGE_CLASS } from "@/components/tools/ToolAside";

/*
  TrimOverlay lived in the workspace explorer's panes first; when the panes
  retired (Phase 4 — the workspace now mounts the real tools), the primitive
  moved here, the one place both trimming surfaces (video stage below,
  AudioTrimmerUI's waveform) draw it from.
*/
const TRIM_HANDLE =
  "pointer-events-none absolute inset-y-0 w-0.5 bg-nocturne-accent shadow-[0_0_12px_color-mix(in_srgb,var(--color-nocturne-accent)_70%,transparent)]";
const TRIM_MASK = "pointer-events-none absolute inset-y-0 bg-[rgba(15,17,28,.68)]";

/** Dims everything outside the selection and marks both edges. */
export function TrimOverlay({ trimA, trimB }: { trimA: number; trimB: number }) {
  return (
    <>
      <div className={cn(TRIM_MASK, "left-0")} style={{ width: `${trimA}%` }} />
      <div className={cn(TRIM_MASK, "right-0")} style={{ width: `${100 - trimB}%` }} />
      <div className={TRIM_HANDLE} style={{ left: `${trimA}%` }} />
      <div className={TRIM_HANDLE} style={{ left: `${trimB}%` }} />
    </>
  );
}

/*
  The canvas half of the Tool Redesign doc.

  `ToolAside` covers the controls; this covers what the doc draws *in* the
  canvas — the file header line, the dark stage, the trim timeline, the page
  deck. Since Phase 4, `/workspace` mounts the same working tools, so both
  surfaces render these exact components with real data.

  `TrimOverlay` is defined above: it is pure presentation shared by every
  trimming surface, kept in one place so the surfaces cannot drift apart.
*/

/** Filename + mono metadata, with an optional accent stat pushed to the right. */
export function CanvasHeader({
  file,
  meta,
  trailing,
}: {
  file: string;
  meta?: string;
  trailing?: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="min-w-0 truncate font-display text-[12.5px] leading-none font-medium text-text-primary">
        {file}
      </span>
      {meta && (
        <span className="font-mono text-[10.5px] leading-none text-text-muted">{meta}</span>
      )}
      {trailing && (
        <span className="ml-auto font-mono text-[10.5px] leading-none text-accent-300">
          {trailing}
        </span>
      )}
    </div>
  );
}

/** The bordered, near-black plate every media canvas sits on. */
export function CanvasStage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[10px] border border-neutral-800 bg-bg-primary",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The waveform the doc draws behind an audio clip. Bars inside the selection
 * take the accent; everything else stays neutral, and `TrimOverlay` dims it.
 */
export function Waveform({
  peaks,
  startPct,
  endPct,
  className,
}: {
  peaks: number[];
  startPct: number;
  endPct: number;
  className?: string;
}) {
  return (
    <div className={cn("relative flex h-[170px] items-center gap-0.5 px-3.5", className)}>
      {peaks.map((h, i) => {
        const pos = (i / peaks.length) * 100;
        const inSelection = pos >= startPct && pos <= endPct;
        return (
          <span
            key={i}
            className={cn(
              "flex-1 rounded-[1px] transition-colors duration-200",
              inSelection ? "bg-accent" : "bg-neutral-800",
            )}
            // A silent stretch still needs a visible hairline.
            style={{ height: `${Math.max(2, h * 100)}%` }}
          />
        );
      })}
    </div>
  );
}

/** A placeholder waveform while the file is still decoding. */
export function WaveformSkeleton() {
  return (
    <div className="flex h-[170px] items-center gap-0.5 px-3.5" aria-hidden="true">
      {Array.from({ length: 90 }, (_, i) => (
        <span
          key={i}
          className="flex-1 rounded-[1px] bg-neutral-800/60"
          style={{ height: `${8 + ((i * 37) % 22)}%` }}
        />
      ))}
    </div>
  );
}

/** The frame strip under a video, with the trim selection cut into it. */
export function Filmstrip({
  frames,
  startPct,
  endPct,
}: {
  frames: string[];
  startPct: number;
  endPct: number;
}) {
  return (
    <div className="relative h-[52px] overflow-hidden rounded-lg border border-neutral-800 bg-bg-primary">
      <div className="absolute inset-0 flex gap-0.5 p-0.5">
        {frames.length > 0
          ? frames.map((src, i) => (
              <span
                key={i}
                className="flex-1 rounded-[3px] bg-neutral-900 bg-cover bg-center"
                style={{ backgroundImage: `url(${src})` }}
              />
            ))
          : Array.from({ length: 16 }, (_, i) => (
              <span key={i} className="flex-1 rounded-[3px] bg-neutral-900" />
            ))}
      </div>
      <TrimOverlay trimA={startPct} trimB={endPct} />
    </div>
  );
}

interface TrimControlsProps {
  /** Selection in seconds. */
  start: number;
  end: number;
  duration: number;
  onStartChange: (seconds: number) => void;
  onEndChange: (seconds: number) => void;
  format: (seconds: number) => string;
  /** e.g. `CLIP` or `SEL` — prefixes the selection-length readout. */
  summaryLabel: string;
  startName: string;
  endName: string;
  disabled?: boolean;
}

/**
 * The doc's IN / OUT handle pair. Unlike the explorer's version these are real
 * seconds, and each handle is clamped so the selection can never invert.
 */
export function TrimControls({
  start,
  end,
  duration,
  onStartChange,
  onEndChange,
  format,
  summaryLabel,
  startName,
  endName,
  disabled,
}: TrimControlsProps) {
  const max = duration || 0;
  const step = max > 600 ? 1 : 0.1;

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex min-w-[220px] flex-1 items-center gap-2">
        <span className={cn(MONO_LABEL, "w-6 tracking-[0.1em] text-text-muted")}>IN</span>
        <input
          type="range"
          min={0}
          max={max}
          step={step}
          value={Math.min(start, max)}
          disabled={disabled || max === 0}
          onChange={(e) => onStartChange(Math.min(Number(e.target.value), end))}
          aria-label={startName}
          className={cn(TOOL_RANGE_CLASS, disabled && "cursor-not-allowed opacity-45")}
        />
        <span className="w-[52px] text-right font-mono text-[11px] leading-none font-medium text-accent-300">
          {format(start)}
        </span>
      </div>

      <div className="flex min-w-[220px] flex-1 items-center gap-2">
        <span className={cn(MONO_LABEL, "w-[26px] tracking-[0.1em] text-text-muted")}>OUT</span>
        <input
          type="range"
          min={0}
          max={max}
          step={step}
          value={Math.min(end, max)}
          disabled={disabled || max === 0}
          onChange={(e) => onEndChange(Math.max(Number(e.target.value), start))}
          aria-label={endName}
          className={cn(TOOL_RANGE_CLASS, disabled && "cursor-not-allowed opacity-45")}
        />
        <span className="w-[52px] text-right font-mono text-[11px] leading-none font-medium text-accent-300">
          {format(end)}
        </span>
      </div>

      <span className="font-mono text-[10.5px] leading-none whitespace-nowrap text-text-muted">
        {summaryLabel} {format(Math.max(0, end - start))}
      </span>
    </div>
  );
}

/**
 * One page in a PDF page deck. `thumb` is a rendered pdf.js data URL; without
 * one the tile falls back to the doc's ruled-paper placeholder.
 */
export function PageTile({
  number,
  thumb,
  selected,
  onClick,
  label,
  badge,
  draggableProps,
  className,
}: {
  number: number;
  thumb?: string;
  selected: boolean;
  onClick?: () => void;
  label?: string;
  /** Rendered over a corner, e.g. the rotation marker or the drag grip. */
  badge?: ReactNode;
  /** Spread onto the tile when the deck is a drag-to-reorder one. */
  draggableProps?: Record<string, unknown>;
  className?: string;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick, "aria-pressed": selected } : {})}
      {...draggableProps}
      aria-label={label ?? `Page ${number}`}
      className={cn(
        "relative aspect-3/4 overflow-hidden rounded-[5px] border-2 p-0 transition-all duration-200",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        onClick && "cursor-pointer",
        thumb ? "bg-bg-elevated" : "bg-[linear-gradient(170deg,#f3f5fe_0%,#dfe3f0_100%)]",
        selected
          ? "border-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_22%,transparent)]"
          : "border-transparent opacity-55 hover:opacity-80",
        className,
      )}
    >
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element -- data: URL from pdf.js, nothing for next/image to optimise
        <img src={thumb} alt="" className="size-full object-cover" />
      ) : (
        <span className="absolute inset-x-[7px] top-2 flex flex-col gap-[3px]">
          <span className="h-[3px] w-[70%] rounded-sm bg-[#75798c]" />
          <span className="h-0.5 w-full rounded-sm bg-[#b2b6ca]" />
          <span className="h-0.5 w-[92%] rounded-sm bg-[#b2b6ca]" />
          <span className="h-0.5 w-[97%] rounded-sm bg-[#b2b6ca]" />
          <span className="h-0.5 w-[64%] rounded-sm bg-[#b2b6ca]" />
        </span>
      )}
      {badge}
      <span
        className={cn(
          "absolute inset-x-0 bottom-0 py-0.5 text-center font-mono text-[9.5px] leading-[1.4] font-medium",
          selected ? "bg-accent text-bg-primary" : "bg-[rgba(22,24,38,.6)] text-[#cfd3e5]",
        )}
      >
        {number}
      </span>
    </Tag>
  );
}

/** The doc's page deck: a scrolling 8-up grid on a dark plate. */
export function PageDeck({ children }: { children: ReactNode }) {
  return (
    <CanvasStage className="p-[15px]">
      <div className="grid grid-cols-4 gap-[11px] sm:grid-cols-6 lg:grid-cols-8">{children}</div>
    </CanvasStage>
  );
}

const METER_SEGMENTS = 40;

/**
 * The doc's recording stage: pulsing rings around a red dot, an oversized mono
 * clock, a metadata line, and an input-level meter. `level` is 0–1; pass null
 * when there is no audio track to meter.
 */
export function RecordStage({
  elapsed,
  meta,
  level,
  paused,
}: {
  elapsed: string;
  meta: string[];
  level: number | null;
  paused?: boolean;
}) {
  const lit = level === null ? 0 : Math.round(level * METER_SEGMENTS);
  // Above this the signal is into headroom and reads as a warning tint.
  const headroom = Math.round(METER_SEGMENTS * 0.82);

  return (
    <div className="relative flex animate-tm-rise items-center justify-center p-9">
      <div className="flex w-full max-w-[520px] flex-col items-center gap-6">
        <div className="relative flex size-24 items-center justify-center">
          <span
            className={cn(
              "absolute inset-0 rounded-full border border-accent/35",
              !paused && "animate-tm-pulse",
            )}
          />
          <span className="absolute inset-[13px] rounded-full border border-accent/20" />
          <span
            className={cn(
              "size-10 rounded-full",
              paused
                ? "bg-neutral-700"
                : "bg-error shadow-[0_0_26px_color-mix(in_srgb,var(--color-error)_50%,transparent)]",
            )}
          />
        </div>

        <div className="font-mono text-[42px] leading-none font-medium text-text-primary">
          {elapsed}
        </div>

        <div className="flex flex-wrap justify-center gap-5 font-mono text-[10.5px] leading-none tracking-[0.06em] whitespace-nowrap text-text-muted">
          {meta.map((m, i) => (
            <span key={m} className="contents">
              {i > 0 && <span className="opacity-40">·</span>}
              <span>{m}</span>
            </span>
          ))}
        </div>

        <div className="flex w-full flex-col gap-[7px]">
          <div className="flex justify-between font-mono text-[9.5px] leading-none tracking-[0.1em] text-text-muted">
            <span>INPUT LEVEL</span>
            <span>{level === null ? "NO MIC" : `${Math.round(level * 100)}%`}</span>
          </div>
          <div className="flex h-[5px] gap-0.5 overflow-hidden rounded-[3px] bg-neutral-900 p-px">
            {Array.from({ length: METER_SEGMENTS }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "flex-1 rounded-[1px] transition-colors duration-75",
                  i < lit && i < headroom && "bg-accent",
                  i < lit && i >= headroom && "bg-error",
                  i >= lit && "bg-neutral-800",
                )}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The RANGE strip under a page deck — reads the selection, writes it back. */
export function RangeField({
  value,
  onChange,
  onApply,
  hint = "Type a range or click pages — the two stay in sync.",
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onApply: () => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <span className={cn(MONO_LABEL, "tracking-[0.1em] text-text-muted")}>RANGE</span>
      <input
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onApply}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onApply();
          }
        }}
        placeholder="1-3, 5, 8-10"
        aria-label="Page range"
        className="h-[30px] w-[190px] rounded-[7px] border border-border bg-bg-elevated px-2.5 font-mono text-xs leading-none text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none disabled:opacity-45"
      />
      <span className="font-body text-[11px] leading-[1.4] text-text-muted">{hint}</span>
    </div>
  );
}

/* ── Text archetype ───────────────────────────────────────────────────────
   `TextPane` draws two panes side by side, each with a mono header carrying
   the pane's name and its line count. The header is uppercased in CSS rather
   than in the string so the label a tool already uses stays intact. */

const PANE_HEAD =
  "flex h-8 flex-none items-center justify-between gap-3 border-b border-border px-3.5 font-mono text-[9.5px] leading-none font-medium tracking-[0.12em] uppercase";

/** Body styling for whatever sits in a text pane — textarea, pre or div. */
export const TEXT_PANE_BODY = cn(
  "m-0 min-h-[15rem] flex-1 resize-none overflow-auto border-0 bg-transparent p-3.5",
  "font-mono text-[11.5px] leading-[1.8] break-words whitespace-pre-wrap text-neutral-300",
  "placeholder:text-text-muted focus:outline-none",
  SCROLL_CLASS,
);

/** Line count for a pane header; empty text is 0 lines, not 1. */
export function lineCount(text: string): number {
  return text ? text.split("\n").length : 0;
}

/** One pane. `tone="out"` marks it as the result side, as the doc does. */
export function TextPane({
  label,
  lines,
  action,
  tone = "in",
  children,
}: {
  label: string;
  lines?: number;
  /** Rendered at the right of the header, e.g. a copy button. */
  action?: ReactNode;
  tone?: "in" | "out";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col",
        tone === "out" ? "bg-bg-primary" : "bg-bg-secondary",
      )}
    >
      <div className={cn(PANE_HEAD, tone === "out" ? "text-accent-300" : "text-text-muted")}>
        <span className="truncate">{label}</span>
        <span className="flex flex-none items-center gap-3 text-text-muted">
          {lines !== undefined && <span>{lines} LINES</span>}
          {action}
        </span>
      </div>
      {children}
    </div>
  );
}

/** The two-up plate the panes sit on; hairlines come from the gap. */
export function TextPanes({
  children,
  columns = 2,
}: {
  children: ReactNode;
  columns?: 1 | 2;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-px overflow-hidden rounded-[10px] border border-neutral-800 bg-border",
        columns === 2 && "md:grid-cols-2",
      )}
    >
      {children}
    </div>
  );
}

/* ── Shared readouts ──────────────────────────────────────────────────── */

export interface StatCell {
  label: string;
  value: string;
  tone?: "accent" | "ok" | "neutral";
}

/** The doc's four-up stat strip under an image or document canvas. */
export function StatStrip({ stats }: { stats: StatCell[] }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[9px] border border-border bg-border sm:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="flex flex-col gap-[5px] bg-bg-primary px-[13px] py-2.5">
          <span className="font-mono text-[9.5px] leading-none tracking-[0.12em] text-text-muted">
            {s.label}
          </span>
          <span
            className={cn(
              "font-mono text-[15px] leading-none font-medium",
              s.tone === "ok" && "text-success",
              s.tone === "neutral" && "text-neutral-300",
              (s.tone ?? "accent") === "accent" && "text-accent-300",
            )}
          >
            {s.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The sunken mono block the doc puts generated code in. */
export function CodeBlock({
  children,
  action,
  label,
}: {
  children: ReactNode;
  action?: ReactNode;
  /** Mono heading above the block, as the doc's HEAD SNIPPET block has. */
  label?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {(action || label) && (
        <div className="flex items-center justify-between">
          <span className="font-mono text-[9.5px] leading-none font-medium tracking-[0.12em] uppercase text-text-muted">
            {label}
          </span>
          {action}
        </div>
      )}
      <pre
        className={cn(
          "m-0 overflow-auto rounded-[9px] border border-neutral-800 bg-bg-secondary px-3.5 py-3",
          "font-mono text-[11.5px] leading-[1.7] whitespace-pre-wrap text-neutral-400",
          SCROLL_CLASS,
        )}
      >
        {/* <pre><code> rather than a bare <pre>: this is source you copy. */}
        <code className="break-all">{children}</code>
      </pre>
    </div>
  );
}

/** The doc's swatch row: colour, hex, share. */
export function SwatchRow({
  swatches,
  onPick,
}: {
  swatches: readonly { hex: string; meta?: string }[];
  onPick?: (hex: string, index: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2.5">
      {swatches.map(({ hex, meta }, i) => {
        const Tag = onPick ? "button" : "div";
        return (
          <Tag
            key={`${hex}-${i}`}
            {...(onPick
              ? { type: "button" as const, onClick: () => onPick(hex, i), title: "Copy hex code" }
              : {})}
            className={cn(
              "flex min-w-[68px] flex-1 flex-col gap-2 text-left",
              onPick && "cursor-pointer",
            )}
          >
            <span
              className="block h-11 rounded-[7px] border border-neutral-800"
              style={{ background: hex }}
            />
            <span className="font-mono text-[10.5px] leading-none font-medium text-neutral-300">
              {hex}
            </span>
            {meta && (
              <span className="font-mono text-[9.5px] leading-none text-text-muted">{meta}</span>
            )}
          </Tag>
        );
      })}
    </div>
  );
}

/** The doc's numbered value list for the generators. */
export function GenList({
  rows,
  onCopy,
  copiedIndex,
}: {
  rows: readonly { value: string; meta?: string }[];
  onCopy?: (value: string, index: number) => void;
  copiedIndex?: number | null;
}) {
  return (
    <div
      className={cn(
        "flex max-h-[26rem] flex-col overflow-y-auto rounded-[10px] border border-neutral-800 bg-bg-primary",
        SCROLL_CLASS,
      )}
    >
      {rows.map((row, i) => (
        <div
          key={`${row.value}-${i}`}
          className="flex items-center gap-3.5 border-b border-border px-4 py-3 last:border-b-0"
        >
          <span className="w-5 flex-none font-mono text-[10px] leading-none text-text-muted">
            {String(i + 1).padStart(2, "0")}
          </span>
          {/* A <code> rather than a <span>: every generator's value is a
              literal you are meant to copy verbatim. */}
          <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] leading-none font-medium text-neutral-200">
            {row.value}
          </code>
          {row.meta && (
            <span className="flex-none font-mono text-[10px] leading-none text-text-muted">
              {row.meta}
            </span>
          )}
          {onCopy && (
            <button
              type="button"
              onClick={() => onCopy(row.value, i)}
              aria-label={`Copy value ${i + 1}`}
              className="flex-none cursor-pointer font-body text-[10.5px] leading-none text-accent transition-colors hover:text-accent-hover"
            >
              {/* The doc sets this lowercase; the app's own string wins so the
                  label stays consistent with every other copy button. */}
              {copiedIndex === i ? "Copied!" : "Copy"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** The doc's EXIF tag grid; rows past `identifyingFrom` take the warning tint. */
export function TagGrid({
  tags,
  identifying,
}: {
  tags: readonly { label: string; value: string }[];
  /** Predicate for the tags that identify the person or the location. */
  identifying?: (label: string) => boolean;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 content-start gap-px overflow-hidden rounded-[10px] border border-neutral-800 bg-border md:grid-cols-2",
      )}
    >
      {tags.map(({ label, value }, i) => (
        <div
          key={`${label}-${i}`}
          className="flex items-center justify-between gap-3.5 bg-bg-primary px-4 py-[11px]"
        >
          <span className="font-body text-[11.5px] leading-none text-text-muted">{label}</span>
          <span
            className={cn(
              "truncate text-right font-mono text-[11.5px] leading-none font-medium",
              identifying?.(label) ? "text-warning" : "text-neutral-300",
            )}
          >
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The mono footnote the doc runs under several canvases. */
export function CanvasFootnote({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[10.5px] leading-none text-text-muted">{children}</span>
  );
}

/** The doc's icon-size row: each emitted size previewed at its own scale. */
export function IconSizes({
  sizes,
  previewUrl,
}: {
  /** [emitted size, what asks for it, rendered preview size in px] */
  sizes: readonly (readonly [number, string, number])[];
  previewUrl?: string | null;
}) {
  return (
    <div className="flex flex-wrap items-start gap-5">
      {sizes.map(([px, use, box]) => (
        <div key={px} className="flex flex-col items-center gap-[9px]">
          <div
            className="flex items-center justify-center overflow-hidden border border-neutral-800 bg-[linear-gradient(150deg,#2b2741,#423a6a)]"
            style={{ width: box, height: box, borderRadius: Math.max(3, box * 0.14) }}
          >
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- blob: URL, nothing for next/image to optimise
              <img src={previewUrl} alt="" className="size-full object-contain" />
            ) : (
              <span
                className="block bg-accent"
                style={{
                  width: Math.round(box * 0.5),
                  height: Math.round(box * 0.5),
                  borderRadius: Math.max(1, box * 0.08),
                }}
              />
            )}
          </div>
          <div className="flex flex-col items-center gap-0.5">
            <span className="font-mono text-[10.5px] leading-none font-medium text-neutral-300">
              {px}×{px}
            </span>
            <span className="max-w-20 text-center font-body text-[9.5px] leading-[1.3] text-text-muted">
              {use}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** The doc's colour stage: a big plate carrying the generated result. */
export function ColorStage({
  children,
  caption,
  className,
  style,
  checkered,
}: {
  children?: ReactNode;
  caption?: string;
  className?: string;
  style?: React.CSSProperties;
  /** Draw the transparency checkerboard behind the content. */
  checkered?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative flex min-h-[16rem] items-center justify-center overflow-hidden rounded-[10px] border border-neutral-800",
        checkered &&
          "bg-[#e4e7f5] bg-[repeating-conic-gradient(#161826_0%_25%,#e4e7f5_0%_50%)] bg-[length:26px_26px]",
        className,
      )}
      style={style}
    >
      {children}
      {caption && (
        <span className="absolute bottom-3 left-3.5 font-mono text-[9.5px] leading-none text-[rgba(233,233,237,.6)]">
          {caption}
        </span>
      )}
    </div>
  );
}

/**
 * The doc's before/after wipe. Drag anywhere on the plate to move the seam;
 * the "after" side is clipped to the right of it.
 */
export function CompareStage({
  beforeUrl,
  afterUrl,
  inLabel,
  outLabel,
  split,
  onSplitChange,
  busy,
  caption,
}: {
  beforeUrl: string | null;
  afterUrl: string | null;
  inLabel: string;
  outLabel: string;
  /** Seam position, 4–96. */
  split: number;
  onSplitChange: (value: number) => void;
  busy?: boolean;
  caption?: string;
}) {
  const BADGE =
    "absolute top-3 rounded-sm bg-[rgba(12,14,23,.72)] px-[7px] py-1 font-mono text-[9.5px] leading-none font-medium tracking-[0.12em]";

  // The doc's three view modes. Split is the interactive default; the tabs
  // only appear once there is an "after" to compare against.
  const [view, setView] = useState<"split" | "side" | "diff">("split");
  const diffRef = useRef<HTMLCanvasElement>(null);

  // Pixel-difference render. Draws straight to the canvas ref — no state, so
  // an unmount or mode change mid-decode can't write anywhere stale.
  useEffect(() => {
    if (view !== "diff" || !beforeUrl || !afterUrl) return;
    const canvas = diffRef.current;
    if (!canvas) return;
    let cancelled = false;

    (async () => {
      try {
        const [blobA, blobB] = await Promise.all([
          fetch(beforeUrl).then((r) => r.blob()),
          fetch(afterUrl).then((r) => r.blob()),
        ]);
        const [ba, bb] = await Promise.all([
          createImageBitmap(blobA),
          createImageBitmap(blobB),
        ]);
        try {
          if (cancelled) return;
          const scale = Math.min(1, 640 / Math.max(ba.width, ba.height));
          const w = Math.max(1, Math.round(ba.width * scale));
          const h = Math.max(1, Math.round(ba.height * scale));
          const scratch = document.createElement("canvas");
          scratch.width = w;
          scratch.height = h;
          const sctx = scratch.getContext("2d", { willReadFrequently: true });
          if (!sctx) return;
          sctx.drawImage(ba, 0, 0, w, h);
          const da = sctx.getImageData(0, 0, w, h);
          sctx.clearRect(0, 0, w, h);
          sctx.drawImage(bb, 0, 0, w, h);
          const db = sctx.getImageData(0, 0, w, h);

          const out = sctx.createImageData(w, h);
          for (let i = 0; i < da.data.length; i += 4) {
            // ×4 amplification, or subtle JPEG error would render as black —
            // the caption declares it.
            out.data[i] = Math.min(255, Math.abs(da.data[i] - db.data[i]) * 4);
            out.data[i + 1] = Math.min(255, Math.abs(da.data[i + 1] - db.data[i + 1]) * 4);
            out.data[i + 2] = Math.min(255, Math.abs(da.data[i + 2] - db.data[i + 2]) * 4);
            out.data[i + 3] = 255;
          }
          if (cancelled) return;
          canvas.width = w;
          canvas.height = h;
          canvas.getContext("2d")?.putImageData(out, 0, 0);
        } finally {
          ba.close();
          bb.close();
        }
      } catch {
        // Decoration: an undecodable pair simply leaves the stage dark.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [view, beforeUrl, afterUrl]);

  const showTabs = Boolean(beforeUrl && afterUrl);
  const mode = showTabs ? view : "split";

  return (
    <div className="relative min-h-[18rem] overflow-hidden rounded-[10px] border border-neutral-800 bg-[#0c0e17]">
      {mode === "side" ? (
        <div className="absolute inset-0 grid grid-cols-2 gap-px">
          <div className="relative">
            {beforeUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- blob: URL, nothing for next/image to optimise
              <img src={beforeUrl} alt="" className="absolute inset-0 size-full object-contain" />
            )}
          </div>
          <div className="relative border-l border-neutral-800">
            {afterUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- blob: URL, nothing for next/image to optimise
              <img src={afterUrl} alt="" className="absolute inset-0 size-full object-contain" />
            )}
          </div>
        </div>
      ) : mode === "diff" ? (
        <canvas ref={diffRef} className="absolute inset-0 size-full object-contain" />
      ) : (
        <>
          {beforeUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- blob: URL, nothing for next/image to optimise
            <img src={beforeUrl} alt="" className="absolute inset-0 size-full object-contain" />
          )}

          {/* The "after" side, revealed by the wipe. */}
          {afterUrl && (
            <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL, nothing for next/image to optimise */}
              <img src={afterUrl} alt="" className="absolute inset-0 size-full object-contain" />
            </div>
          )}

          {afterUrl && (
            <div
              className="pointer-events-none absolute inset-y-0 w-px bg-accent shadow-[0_0_14px_color-mix(in_srgb,var(--color-accent)_70%,transparent)]"
              style={{ left: `${split}%` }}
            />
          )}
        </>
      )}

      <span className={cn(BADGE, "left-3.5 text-neutral-300")}>{inLabel}</span>
      {afterUrl && mode !== "diff" && (
        <span className={cn(BADGE, "right-3.5 text-accent-300")}>{outLabel}</span>
      )}

      {showTabs && (
        /* z-10 keeps the tabs clickable above the full-stage split-drag input. */
        <div className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-px overflow-hidden rounded-md border border-neutral-800 bg-[rgba(12,14,23,.72)]">
          {(
            [
              ["split", "SPLIT"],
              ["side", "SIDE BY SIDE"],
              ["diff", "DIFF"],
            ] as const
          ).map(([value, tabLabel]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => setView(value)}
              className={cn(
                "cursor-pointer px-2 py-1.5 font-mono text-[9px] leading-none font-medium tracking-[0.1em] transition-colors duration-150",
                "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
                view === value
                  ? "bg-accent/15 text-accent-200"
                  : "text-text-muted hover:text-neutral-300",
              )}
            >
              {tabLabel}
            </button>
          ))}
        </div>
      )}

      {mode === "diff" ? (
        <span className="absolute bottom-3 left-3.5 font-mono text-[9.5px] leading-none text-[rgba(233,233,237,.5)]">
          PIXEL DIFF ×4 — BLACK MEANS IDENTICAL
        </span>
      ) : (
        caption && (
          <span className="absolute bottom-3 left-3.5 font-mono text-[9.5px] leading-none text-[rgba(233,233,237,.5)]">
            {caption}
          </span>
        )
      )}

      {mode === "split" && afterUrl && (
        <input
          type="range"
          min={4}
          max={96}
          step={0.5}
          value={split}
          onChange={(e) => onSplitChange(Number(e.target.value))}
          aria-label="Compare position"
          className={cn(TOOL_RANGE_CLASS, "absolute inset-0 h-full cursor-ew-resize opacity-0")}
        />
      )}

      {busy && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-14 animate-tm-sweep bg-[linear-gradient(180deg,transparent,color-mix(in_srgb,var(--color-accent)_55%,transparent),transparent)]" />
      )}
    </div>
  );
}

export interface QueueRow {
  name: string;
  inSize: string;
  outSize: string;
  /** 0–100. */
  pct: number;
  state: "DONE" | "RUNNING" | "QUEUED" | "FAILED";
}

const QUEUE_GRID = "grid grid-cols-[26px_1fr_88px_88px_110px_70px] gap-3";

/** The doc's batch queue: one row per file, with progress and state. */
export function QueueTable({ rows, footnote }: { rows: QueueRow[]; footnote?: string }) {
  return (
    <div className="flex flex-col gap-[11px]">
      <div className="flex flex-col overflow-hidden rounded-[10px] border border-neutral-800 bg-bg-primary">
        <div
          className={cn(
            QUEUE_GRID,
            "border-b border-border px-3.5 py-[9px] font-mono text-[9.5px] leading-none font-medium tracking-[0.1em] text-text-muted",
          )}
        >
          <span>#</span>
          <span>FILE</span>
          <span className="text-right">IN</span>
          <span className="text-right">OUT</span>
          <span>PROGRESS</span>
          <span className="text-right">STATE</span>
        </div>

        <div className={cn("max-h-[26rem] overflow-y-auto", SCROLL_CLASS)}>
          {rows.map((r, i) => (
            <div
              key={`${r.name}-${i}`}
              className={cn(
                QUEUE_GRID,
                "items-center border-b border-border px-3.5 py-[11px] font-body text-xs leading-none last:border-b-0",
              )}
            >
              <span className="font-mono text-[10.5px] text-text-muted">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="truncate text-neutral-300">{r.name}</span>
              <span className="text-right font-mono text-[11px] text-text-muted">{r.inSize}</span>
              <span className="text-right font-mono text-[11px] text-accent-300">{r.outSize}</span>
              <span className="block h-[3px] overflow-hidden rounded-sm bg-neutral-800">
                <span
                  className={cn(
                    "block h-full rounded-sm",
                    r.state === "FAILED"
                      ? "bg-error"
                      : r.pct === 100
                        ? "bg-success"
                        : "bg-accent",
                  )}
                  style={{ width: `${r.pct}%` }}
                />
              </span>
              <span
                className={cn(
                  "text-right font-mono text-[9.5px] leading-none font-medium tracking-[0.08em]",
                  r.state === "DONE" && "text-success",
                  r.state === "RUNNING" && "text-accent",
                  r.state === "QUEUED" && "text-text-muted",
                  r.state === "FAILED" && "text-error",
                )}
              >
                {r.state}
              </span>
            </div>
          ))}
        </div>
      </div>

      {footnote && <CanvasFootnote>{footnote}</CanvasFootnote>}
    </div>
  );
}

/** One document card in the doc's assembly-order strip. */
export function DocCard({
  index,
  name,
  meta,
  badge,
  thumb,
  onRemove,
  draggableProps,
}: {
  index: number;
  name: string;
  meta: string;
  /** Corner badge, e.g. the page count. */
  badge?: string;
  /**
   * Real preview to show instead of the generic paper mock. Used where the
   * source is an image rather than a document, so the card shows the actual
   * page that will be produced.
   */
  thumb?: string;
  onRemove?: () => void;
  draggableProps?: Record<string, unknown>;
}) {
  return (
    <div className="flex w-[166px] flex-none flex-col gap-2">
      <div
        {...draggableProps}
        className="relative h-[214px] cursor-grab overflow-hidden rounded-lg border border-neutral-800 bg-[linear-gradient(170deg,#f3f5fe_0%,#cfd3e5_100%)] shadow-[0_8px_22px_rgba(0,0,0,.4)] active:cursor-grabbing"
      >
        {thumb ? (
          // A blob: URL — next/image can't optimise it under output: "export",
          // so this reports the same no-img-element warning as the other
          // preview surfaces (FilePreview, VideoToGifUI). Left as-is for
          // consistency with them.
          <img src={thumb} alt={name} className="size-full object-cover" />
        ) : (
          <div className="absolute inset-x-[13px] top-[15px] flex flex-col gap-[5px]">
            <div className="h-[7px] w-[62%] rounded-sm bg-[#75798c]" />
            <div className="h-[3px] w-full rounded-sm bg-[#b2b6ca]" />
            <div className="h-[3px] w-[94%] rounded-sm bg-[#b2b6ca]" />
            <div className="h-[3px] w-[71%] rounded-sm bg-[#b2b6ca]" />
            <div className="mt-1.5 h-8 w-full rounded-[3px] bg-[#cfd3e5]" />
            <div className="mt-1 h-[3px] w-[88%] rounded-sm bg-[#b2b6ca]" />
            <div className="h-[3px] w-[60%] rounded-sm bg-[#b2b6ca]" />
          </div>
        )}
        <span className="absolute top-[9px] left-[9px] size-5 rounded-[5px] bg-bg-primary text-center font-mono text-[10.5px] leading-5 font-medium text-accent-300">
          {index}
        </span>
        {badge && (
          <span className="absolute right-[9px] bottom-[9px] rounded-sm bg-[rgba(22,24,38,.82)] px-1.5 py-1 font-mono text-[9.5px] leading-none font-medium text-neutral-300">
            {badge}
          </span>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${name}`}
            className="absolute top-[9px] right-[9px] cursor-pointer rounded-[5px] bg-[rgba(22,24,38,.82)] px-1.5 py-1 font-mono text-[9.5px] leading-none text-neutral-300 transition-colors hover:text-error"
          >
            ✕
          </button>
        )}
      </div>
      <div className="flex flex-col gap-[3px]">
        <span className="truncate font-body text-[11.5px] leading-[1.3] text-neutral-300">
          {name}
        </span>
        <span className="font-mono text-[10px] leading-none text-text-muted">{meta}</span>
      </div>
    </div>
  );
}

/** The horizontal strip the document cards live on. */
export function DocStrip({ children }: { children: ReactNode }) {
  return (
    <div className={cn("flex gap-[13px] overflow-x-auto pb-1.5", SCROLL_CLASS)}>{children}</div>
  );
}
