"use client";

import { useCallback, useState } from "react";

import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolSlider,
} from "@/components/tools/ToolAside";
import { CanvasHeader, CodeBlock, ColorStage } from "@/components/tools/ToolCanvas";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";

interface Shadow {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
  opacity: number;
  inset: boolean;
}

const defaultShadow: Shadow = {
  x: 0,
  y: 4,
  blur: 16,
  spread: 0,
  color: "#000000",
  opacity: 25,
  inset: false,
};

function shadowToCss(s: Shadow): string {
  const hex = s.color;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const rgba = `rgba(${r}, ${g}, ${b}, ${s.opacity / 100})`;
  return `${s.inset ? "inset " : ""}${s.x}px ${s.y}px ${s.blur}px ${s.spread}px ${rgba}`;
}

export function BoxShadowGeneratorUI() {
  const [shadows, setShadows] = useState<Shadow[]>([{ ...defaultShadow }]);
  const { copied, copy } = useCopied();

  const cssValue = shadows.map(shadowToCss).join(", ");
  const cssCode = `box-shadow: ${cssValue};`;

  const addShadow = useCallback(() => {
    setShadows((prev) => [...prev, { ...defaultShadow, y: (prev.length + 1) * 4 }]);
  }, []);

  const removeShadow = useCallback((i: number) => {
    setShadows((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev));
  }, []);

  const updateShadow = useCallback((i: number, field: keyof Shadow, value: number | string | boolean) => {
    setShadows((prev) =>
      prev.map((s, j) => (j === i ? { ...s, [field]: value } : s)),
    );
  }, []);

  const handleCopy = useCallback(() => {
    void copy(cssCode);
  }, [copy, cssCode]);

  return (
    <>
      {/* ── Canvas: the doc's colour stage + code block ────── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file="Shadow"
          trailing={`${shadows.length} LAYER${shadows.length === 1 ? "" : "S"}`}
        />

        <ColorStage className="bg-[#1b1e2e]" caption="card on the page ground">
          <div
            className="h-[45%] min-h-32 w-[55%] rounded-[10px] bg-bg-elevated"
            style={{ boxShadow: cssValue }}
          />
        </ColorStage>

        <CodeBlock
          label="CSS Code"
          action={
            <button
              onClick={handleCopy}
              className="cursor-pointer font-body text-[11px] leading-none text-accent transition-colors hover:text-accent-hover"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          }
        >
          {cssCode}
        </CodeBlock>
      </div>

      <ToolAside
        footer={<ToolActions primaryLabel="Copy CSS" onPrimary={handleCopy} />}
      >
        <ToolAsideSection label="SHADOWS">
          <button
            type="button"
            onClick={addShadow}
            className="cursor-pointer self-start rounded-md border border-dashed border-border px-2.5 py-1.5 font-body text-[11.5px] text-text-muted transition-colors duration-200 hover:border-accent/50 hover:text-accent-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            + Add Layer
          </button>
        </ToolAsideSection>

        {shadows.map((shadow, i) => (
          <ToolAsideSection key={i} label={`LAYER ${i + 1}`}>
            <div className="flex items-center justify-between gap-3">
              <label className="flex cursor-pointer items-center gap-2 font-body text-[11.5px] text-neutral-300">
                <input
                  type="checkbox"
                  checked={shadow.inset}
                  onChange={(e) => updateShadow(i, "inset", e.target.checked)}
                  className="size-3.5 rounded-sm border-border accent-accent"
                />
                Inset
              </label>
              <div className="flex items-center gap-2.5">
                <input
                  type="color"
                  value={shadow.color}
                  onChange={(e) => updateShadow(i, "color", e.target.value)}
                  aria-label={`Layer ${i + 1} color`}
                  className="size-7 cursor-pointer rounded-sm border border-border"
                />
                {shadows.length > 1 && (
                  <button
                    onClick={() => removeShadow(i)}
                    aria-label={`Remove layer ${i + 1}`}
                    className="cursor-pointer text-sm text-error transition-opacity hover:opacity-70"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            {(["x", "y", "blur", "spread"] as const).map((field) => (
              <ToolSlider
                key={field}
                label={field.charAt(0).toUpperCase() + field.slice(1)}
                display={`${shadow[field]}px`}
                min={field === "x" || field === "y" ? -50 : 0}
                max={field === "spread" ? 50 : 100}
                value={shadow[field]}
                onChange={(v) => updateShadow(i, field, v)}
              />
            ))}

            <ToolSlider
              label="Opacity"
              display={`${shadow.opacity}%`}
              min={0}
              max={100}
              value={shadow.opacity}
              onChange={(v) => updateShadow(i, "opacity", v)}
            />
          </ToolAsideSection>
        ))}
      </ToolAside>
    </>
  );
}
