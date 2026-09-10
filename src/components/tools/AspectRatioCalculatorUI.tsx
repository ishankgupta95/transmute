"use client";

import { useCallback, useMemo, useState } from "react";

import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import {
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
  ToolPresets,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  StatStrip,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { cn } from "@/lib/utils/cn";
import {
  RATIO_PRESETS,
  describeRatio,
  fitBox,
  parseDimension,
  parseRatio,
  ratioLabel,
  solveHeight,
  solveWidth,
} from "@/lib/tools/aspect-ratio";

/** The one field box the redesign doc specifies — same shape as the subtitle tool's. */
const FIELD_CLASS =
  "h-[30px] rounded-[7px] border border-border bg-bg-elevated px-2.5 font-mono text-xs leading-none text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

type SolveFor = "width" | "height" | "ratio";

const ROW =
  "flex flex-wrap items-center gap-3 border-b border-border px-3.5 py-3 last:border-b-0";
const ROW_LABEL = "w-28 shrink-0 font-body text-[11.5px] leading-none text-text-muted";

/** Rounded to at most 4 decimals, with no trailing zeroes. */
function decimals(n: number, places = 4): string {
  return String(Number(n.toFixed(places)));
}

export function AspectRatioCalculatorUI() {
  const [solveFor, setSolveFor] = useState<SolveFor>("height");
  const [widthText, setWidthText] = useState("1920");
  const [heightText, setHeightText] = useState("1080");
  const [ratioText, setRatioText] = useState("16:9");
  const [preset, setPreset] = useState("custom");

  const [fitOn, setFitOn] = useState(false);
  const [fitMode, setFitMode] = useState<"contain" | "cover">("contain");
  const [boxWidthText, setBoxWidthText] = useState("1080");
  const [boxHeightText, setBoxHeightText] = useState("1080");

  const { copied, copy } = useCopied();

  const typedWidth = parseDimension(widthText);
  const typedHeight = parseDimension(heightText);
  const typedRatio = parseRatio(ratioText);

  /*
    One solved value, never two. The two fields the user is holding fixed are
    the inputs; the third is derived and read-only, so the three can never
    disagree with each other on screen.
  */
  const solved = useMemo(() => {
    if (solveFor === "height") {
      if (typedWidth === null || typedRatio === null) return null;
      return solveHeight(typedWidth, typedRatio);
    }
    if (solveFor === "width") {
      if (typedHeight === null || typedRatio === null) return null;
      return solveWidth(typedHeight, typedRatio);
    }
    if (typedWidth === null || typedHeight === null) return null;
    return {
      width: typedWidth,
      height: typedHeight,
      ratio: { w: typedWidth, h: typedHeight },
      rounded: false,
      exact: typedWidth / typedHeight,
    };
  }, [solveFor, typedWidth, typedHeight, typedRatio]);

  const description = solved ? describeRatio(solved.width, solved.height) : null;

  const fit = useMemo(() => {
    if (!fitOn || !solved) return null;
    const bw = parseDimension(boxWidthText);
    const bh = parseDimension(boxHeightText);
    if (bw === null || bh === null) return null;
    return fitBox({ w: solved.width, h: solved.height }, { w: bw, h: bh }, fitMode);
  }, [fitOn, solved, boxWidthText, boxHeightText, fitMode]);

  // What each field shows: the two typed ones verbatim, the solved one derived.
  const widthValue = solveFor === "width" && solved ? String(solved.width) : widthText;
  const heightValue = solveFor === "height" && solved ? String(solved.height) : heightText;
  const ratioValue =
    solveFor === "ratio" && description ? description.label : ratioText;

  const missing =
    solveFor === "height"
      ? typedWidth === null || typedRatio === null
      : solveFor === "width"
        ? typedHeight === null || typedRatio === null
        : typedWidth === null || typedHeight === null;

  const handlePreset = useCallback((id: string) => {
    const found = RATIO_PRESETS.find((p) => p.id === id);
    if (!found) return;
    setPreset(id);
    setRatioText(ratioLabel({ w: found.w, h: found.h }));
    // A preset names a ratio, so it can only be applied while the ratio is an
    // input. Solving FOR the ratio and then overwriting it would be a lie.
    setSolveFor((prev) => (prev === "ratio" ? "height" : prev));
  }, []);

  const handleReset = useCallback(() => {
    setSolveFor("height");
    setWidthText("1920");
    setHeightText("1080");
    setRatioText("16:9");
    setPreset("custom");
    setFitOn(false);
    setFitMode("contain");
    setBoxWidthText("1080");
    setBoxHeightText("1080");
  }, []);

  const summary = useMemo(() => {
    if (!solved || !description) return "";
    const lines = [
      `${solved.width} × ${solved.height}`,
      `Reduced ratio: ${description.label}`,
      `Decimal: ${decimals(description.decimal, 6)}`,
      description.nearest
        ? description.matchesPreset
          ? `Exactly ${description.nearest.label}`
          : `Nearest named ratio: ${description.nearest.label}, off by ${decimals(Math.abs(description.offByPercent ?? 0), 3)}%`
        : "No named ratio within 5%",
    ];
    if (fit) {
      lines.push(
        `Fit ${fitMode} into ${boxWidthText} × ${boxHeightText}: ${fit.width} × ${fit.height} at ${decimals(fit.scale, 5)}×`,
      );
      if (fit.effect !== "none") {
        // Both sides of the axis, always. An odd leftover puts one more pixel
        // on one side, and a single number would not add back up to the frame.
        lines.push(
          fitMode === "contain"
            ? fit.effect === "letterbox"
              ? `Letterbox bars: ${fit.barsTop} px above, ${fit.barsBottom} px below`
              : `Pillarbox bars: ${fit.barsLeft} px left, ${fit.barsRight} px right`
            : fit.effect === "crops-sides"
              ? `Cropped: ${fit.barsLeft} px off the left, ${fit.barsRight} px off the right`
              : `Cropped: ${fit.barsTop} px off the top, ${fit.barsBottom} px off the bottom`,
        );
      }
    }
    return lines.join("\n");
  }, [solved, description, fit, fitMode, boxWidthText, boxHeightText]);

  const handleCopy = useCallback(() => {
    void copy(summary);
  }, [copy, summary]);

  /** How far the integer approximation is from the value actually typed. */
  const approximationError =
    description && !description.reductionExact
      ? Math.abs(description.reduced.w / description.reduced.h - description.decimal) /
        description.decimal *
        100
      : 0;

  const stats = description
    ? [
        { label: "REDUCED", value: description.label, tone: "accent" as const },
        { label: "DECIMAL", value: decimals(description.decimal), tone: "neutral" as const },
        {
          label: "NEAREST NAME",
          value: description.nearest ? description.nearest.label : "none",
          tone: "neutral" as const,
        },
        {
          label: "MATCH",
          value: description.matchesPreset
            ? "exact"
            : description.nearest
              ? `off ${decimals(Math.abs(description.offByPercent ?? 0), 2)}%`
              : "unnamed",
          tone: description.matchesPreset ? ("ok" as const) : ("neutral" as const),
        },
      ]
    : [];

  return (
    <>
      {/* ── Canvas: the three values, and what they reduce to ────────── */}
      <div className={CANVAS_COLUMN}>
        {missing && (
          <ErrorMessage
            message={
              solveFor === "ratio"
                ? "Enter a width and a height as positive numbers, and the ratio follows."
                : "Enter a positive number and a ratio like 16:9, 2.39:1 or 1.7778, and the missing side follows."
            }
          />
        )}

        {description && !description.reductionExact && (
          <WarningMessage
            message={`One of the two sides is not a whole number, so ${description.label} is the closest integer pair below a denominator of 1000 rather than an exact reduction — it is ${decimals(approximationError, 4)}% away from the value you typed. Every other reduction on this page is exact, done with a greatest common divisor.`}
          />
        )}

        {description && description.nearest && !description.matchesPreset && (
          <WarningMessage
            message={`${solved?.width} × ${solved?.height} is ${description.label}, not ${description.nearest.label}. It is ${decimals(Math.abs(description.offByPercent ?? 0), 3)}% ${(description.offByPercent ?? 0) > 0 ? "wider" : "narrower"} than ${description.nearest.label} — close enough to look right and not close enough to be it.${solved?.rounded ? ` Rounding the solved side from ${decimals(solved.exact, 4)} to a whole pixel is what did it: no integer pair at this width is exactly ${description.nearest.label}.` : ""} ${description.nearest.note}`}
          />
        )}

        <TextPanes columns={1}>
          <TextPane
            label="Width, height, ratio — any one of the three"
            action={
              summary ? (
                <button
                  onClick={handleCopy}
                  aria-label={copied ? "Copied the result" : "Copy the result"}
                  className="cursor-pointer text-accent transition-colors hover:text-accent-hover"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              ) : undefined
            }
          >
            <div className="flex flex-col">
              <div className={ROW}>
                <label htmlFor="ar-width" className={ROW_LABEL}>
                  Width
                </label>
                <input
                  id="ar-width"
                  type="text"
                  inputMode="decimal"
                  value={widthValue}
                  readOnly={solveFor === "width"}
                  aria-readonly={solveFor === "width" || undefined}
                  onChange={(e) => {
                    setWidthText(e.target.value);
                    setPreset("custom");
                  }}
                  placeholder="1920"
                  className={cn(
                    FIELD_CLASS,
                    "w-[140px]",
                    solveFor === "width" && "border-accent/40 text-accent-300",
                  )}
                />
                {solveFor === "width" && (
                  <span className="font-mono text-[10px] leading-none tracking-[0.08em] text-accent-300">
                    SOLVED
                  </span>
                )}
              </div>

              <div className={ROW}>
                <label htmlFor="ar-height" className={ROW_LABEL}>
                  Height
                </label>
                <input
                  id="ar-height"
                  type="text"
                  inputMode="decimal"
                  value={heightValue}
                  readOnly={solveFor === "height"}
                  aria-readonly={solveFor === "height" || undefined}
                  onChange={(e) => {
                    setHeightText(e.target.value);
                    setPreset("custom");
                  }}
                  placeholder="1080"
                  className={cn(
                    FIELD_CLASS,
                    "w-[140px]",
                    solveFor === "height" && "border-accent/40 text-accent-300",
                  )}
                />
                {solveFor === "height" && (
                  <span className="font-mono text-[10px] leading-none tracking-[0.08em] text-accent-300">
                    SOLVED
                  </span>
                )}
              </div>

              <div className={ROW}>
                <label htmlFor="ar-ratio" className={ROW_LABEL}>
                  Ratio
                </label>
                <input
                  id="ar-ratio"
                  type="text"
                  value={ratioValue}
                  readOnly={solveFor === "ratio"}
                  aria-readonly={solveFor === "ratio" || undefined}
                  onChange={(e) => {
                    setRatioText(e.target.value);
                    setPreset("custom");
                  }}
                  placeholder="16:9"
                  className={cn(
                    FIELD_CLASS,
                    "w-[140px]",
                    solveFor === "ratio" && "border-accent/40 text-accent-300",
                  )}
                />
                <span className="font-body text-[10.5px] leading-[1.4] text-text-muted">
                  {solveFor === "ratio"
                    ? "Reduced with a GCD from the two sides above."
                    : "16:9, 16/9, 2.39:1 or a bare decimal like 1.7778."}
                </span>
              </div>
            </div>
          </TextPane>
        </TextPanes>

        {description && <StatStrip stats={stats} />}

        {fitOn && (
          <TextPanes columns={1}>
            <TextPane label={`Fit ${solved ? `${solved.width} × ${solved.height}` : "the box above"} into a frame`}>
              <div className="flex flex-col">
                <div className={ROW}>
                  <label htmlFor="ar-box-w" className={ROW_LABEL}>
                    Frame width
                  </label>
                  <input
                    id="ar-box-w"
                    type="text"
                    inputMode="decimal"
                    value={boxWidthText}
                    onChange={(e) => setBoxWidthText(e.target.value)}
                    placeholder="1080"
                    className={cn(FIELD_CLASS, "w-[140px]")}
                  />
                  <label htmlFor="ar-box-h" className="font-body text-[11.5px] leading-none text-text-muted">
                    Frame height
                  </label>
                  <input
                    id="ar-box-h"
                    type="text"
                    inputMode="decimal"
                    value={boxHeightText}
                    onChange={(e) => setBoxHeightText(e.target.value)}
                    placeholder="1080"
                    className={cn(FIELD_CLASS, "w-[140px]")}
                  />
                </div>

                {fit ? (
                  <>
                    <div className={ROW}>
                      <span className={ROW_LABEL}>Result</span>
                      <span className="font-mono text-[15px] leading-none font-medium text-accent-300">
                        {fit.width} × {fit.height}
                      </span>
                      <span className="font-mono text-[10.5px] leading-none text-text-muted">
                        SCALE {decimals(fit.scale, 5)}×
                      </span>
                    </div>
                    <div className={ROW}>
                      <span className={ROW_LABEL}>
                        {fitMode === "contain" ? "Empty frame" : "Cropped away"}
                      </span>
                      <span className="font-body text-[12px] leading-[1.5] text-neutral-300">
                        {fit.effect === "none"
                          ? "Nothing. The two boxes share a ratio, so the picture fills the frame exactly."
                          : fitMode === "contain"
                            ? fit.effect === "letterbox"
                              ? `Letterboxed: ${fit.barsTop} px of empty frame above and ${fit.barsBottom} px below — those two plus the ${fit.height} px picture are the ${fit.barsTop + fit.height + fit.barsBottom} px frame. The picture covers ${Math.round(fit.coverage * 100)}% of it.`
                              : `Pillarboxed: ${fit.barsLeft} px of empty frame on the left and ${fit.barsRight} px on the right — those two plus the ${fit.width} px picture are the ${fit.barsLeft + fit.width + fit.barsRight} px frame. The picture covers ${Math.round(fit.coverage * 100)}% of it.`
                            : fit.effect === "crops-sides"
                              ? `${fit.barsLeft} px is cut off the left and ${fit.barsRight} px off the right, out of ${fit.width} px of scaled picture. Nothing above or below is lost.`
                              : `${fit.barsTop} px is cut off the top and ${fit.barsBottom} px off the bottom, out of ${fit.height} px of scaled picture. Nothing at the sides is lost.`}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className={ROW}>
                    <span className="font-body text-[12px] leading-[1.5] text-text-muted">
                      Enter a frame width and height as positive numbers.
                    </span>
                  </div>
                )}
              </div>
            </TextPane>
          </TextPanes>
        )}

        <CanvasFootnote>
          {solveFor === "ratio"
            ? "RATIO REDUCED WITH A GCD — NEITHER SIDE WAS SOLVED FOR"
            : solved?.rounded
              ? `SOLVED SIDE ROUNDED FROM ${decimals(solved.exact, 4)} TO ${solveFor === "width" ? solved.width : solved.height}`
              : "NO ROUNDING — THE SOLVED SIDE CAME OUT WHOLE"}
          {fit?.rounded ? " · FITTED BOX ROUNDED TO WHOLE PIXELS" : ""}
        </CanvasFootnote>
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside footer={<ToolResetLink onClick={handleReset} label="RESET" />}>
        <ToolControlGroup>
          <ToolControl label="SOLVE FOR">
            <ToolChoice
              label="Which value to solve for"
              value={solveFor}
              onChange={setSolveFor}
              options={[
                { value: "width" as const, label: "Width" },
                { value: "height" as const, label: "Height" },
                { value: "ratio" as const, label: "Ratio" },
              ]}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              The other two fields are yours; this one is computed and read-only,
              so the three can never disagree on screen.
            </span>
          </ToolControl>

          <ToolControl label="FIT INTO A FRAME">
            <label className="flex cursor-pointer items-center gap-2.5 font-body text-[12.5px] text-neutral-300">
              <input
                type="checkbox"
                checked={fitOn}
                onChange={(e) => setFitOn(e.target.checked)}
                className="size-4 rounded-sm border-border accent-accent"
              />
              Scale this box into another one
            </label>
            {fitOn && (
              <ToolChoice
                label="Fit mode"
                value={fitMode}
                onChange={setFitMode}
                options={[
                  { value: "contain" as const, label: "Contain" },
                  { value: "cover" as const, label: "Cover" },
                ]}
              />
            )}
          </ToolControl>
        </ToolControlGroup>

        <ToolPresets
          presets={[
            ...RATIO_PRESETS.map((p) => ({ id: p.id, label: p.label, note: p.note })),
            {
              id: "custom",
              label: "Custom",
              note: "Whatever is typed in the Ratio field, reduced with a GCD.",
            },
          ]}
          active={preset}
          onSelect={handlePreset}
        />

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Reduced", description?.label ?? "—"],
              ["Decimal", description ? decimals(description.decimal, 6) : "—"],
              [
                "Off named",
                description?.nearest
                  ? `${decimals(Math.abs(description.offByPercent ?? 0), 3)}%`
                  : "—",
              ],
            ]}
          />
        </ToolAsideSection>

        <ToolAsideSection label="WHAT THE NUMBERS MEAN">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            The reduced pair is the two sides divided by their greatest common
            divisor, which is exact for whole numbers. 1920×1080 really is 16:9;
            1366×768 really is 683:384, and calling that 16:9 would be a rounding
            nobody asked for. Where the reduced pair is not a named ratio, the
            nearest name within 5% is shown with the percentage it is out by.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            21:9 is a marketing name rather than a ratio, and it does not even
            name one shape: the 2560×1080 ultrawides sold under it are 64:27,
            which is 2.370:1, while the 3440×1440 ones are 43:18, which is
            2.389:1. The chip is stored as 64:27. 2.39:1 and 1.85:1 are the
            cinema projection standards and are stored here as 239:100 and
            37:20. Everything is computed in this tab; no image is opened and
            nothing is uploaded.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
