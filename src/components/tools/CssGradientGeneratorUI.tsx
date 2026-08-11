"use client";

import { useCallback, useState } from "react";

import { copyText } from "@/lib/utils/clipboard";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolSlider,
} from "@/components/tools/ToolAside";
import { CodeBlock, ColorStage } from "@/components/tools/ToolCanvas";
import { parseHex, rgbToHex } from "@/lib/tools/color-picker";

interface ColorStop {
  color: string;
  position: number;
}

type GradientType = "linear" | "radial" | "conic";

export function CssGradientGeneratorUI() {
  const [type, setType] = useState<GradientType>("linear");
  const [angle, setAngle] = useState(135);
  const [stops, setStops] = useState<ColorStop[]>([
    { color: "#2dd4bf", position: 0 },
    { color: "#6366f1", position: 100 },
  ]);
  const [copied, setCopied] = useState(false);
  /*
    In-progress hex text edits, keyed by stop index. `stops[i].color` is
    ALWAYS a valid colour — a half-typed "#2d" used to flow straight into the
    generated CSS (silently breaking the preview AND the copied snippet) and
    into the swatch input, which rejects it on the console. The draft holds
    the raw text; it commits the moment it parses and snaps back on blur.
  */
  const [colorDrafts, setColorDrafts] = useState<Record<number, string>>({});

  const cssValue = (() => {
    const stopsStr = stops.map((s) => `${s.color} ${s.position}%`).join(", ");
    switch (type) {
      case "linear":
        return `linear-gradient(${angle}deg, ${stopsStr})`;
      case "radial":
        return `radial-gradient(circle, ${stopsStr})`;
      case "conic":
        return `conic-gradient(from ${angle}deg, ${stopsStr})`;
    }
  })();

  const cssCode = `background: ${cssValue};`;

  const addStop = useCallback(() => {
    setStops((prev) => [...prev, { color: "#ffffff", position: 50 }]);
  }, []);

  const removeStop = useCallback((i: number) => {
    setStops((prev) => (prev.length > 2 ? prev.filter((_, j) => j !== i) : prev));
  }, []);

  const updateStop = useCallback((i: number, field: "color" | "position", value: string | number) => {
    setStops((prev) =>
      prev.map((s, j) => (j === i ? { ...s, [field]: value } : s)),
    );
  }, []);

  const handleColorText = useCallback((i: number, raw: string) => {
    setColorDrafts((prev) => ({ ...prev, [i]: raw }));
    const rgb = parseHex(raw);
    if (rgb) updateStop(i, "color", rgbToHex(...rgb));
  }, [updateStop]);

  const commitColorText = useCallback((i: number) => {
    setColorDrafts((prev) => {
      const next = { ...prev };
      delete next[i];
      return next;
    });
  }, []);

  const handleCopy = useCallback(() => {
    copyText(cssCode).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    });
  }, [cssCode]);

  return (
    <>
      {/* ── Canvas: the doc's colour stage + code block ────── */}
      <div className="min-w-0 space-y-[15px]">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-[13px] leading-none font-medium text-text-primary">
            Gradient
          </span>
          <span className="ml-auto font-mono text-[10.5px] leading-none text-text-muted">
            {stops.length} STOPS · {type.toUpperCase()}
          </span>
        </div>

        <ColorStage style={{ background: cssValue }} caption="live preview" />

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
        <ToolAsideSection label="TYPE">
          <ToolChoice
            label="Gradient type"
            fill
            value={type}
            onChange={setType}
            options={[
              { value: "linear" as const, label: "Linear" },
              { value: "radial" as const, label: "Radial" },
              { value: "conic" as const, label: "Conic" },
            ]}
          />
        </ToolAsideSection>

        {(type === "linear" || type === "conic") && (
          <ToolAsideSection>
            <ToolSlider
              label="Angle"
              display={`${angle}°`}
              min={0}
              max={360}
              value={angle}
              onChange={setAngle}
            />
          </ToolAsideSection>
        )}

        <ToolAsideSection label="COLOR STOPS">
          {stops.map((stop, i) => (
            <div key={i} className="flex flex-col gap-2 border-b border-border pb-3 last:border-b-0 last:pb-0">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={stop.color}
                  onChange={(e) => updateStop(i, "color", e.target.value)}
                  aria-label={`Stop ${i + 1} color`}
                  className="size-8 flex-none cursor-pointer rounded border border-border"
                />
                <input
                  type="text"
                  value={colorDrafts[i] ?? stop.color}
                  onChange={(e) => handleColorText(i, e.target.value)}
                  onBlur={() => commitColorText(i)}
                  aria-label={`Stop ${i + 1} hex`}
                  className="min-w-0 flex-1 rounded-md border border-border bg-bg-elevated px-2 py-1.5 font-mono text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                />
                {stops.length > 2 && (
                  <button
                    onClick={() => removeStop(i)}
                    aria-label={`Remove stop ${i + 1}`}
                    className="flex-none cursor-pointer text-sm text-error transition-opacity hover:opacity-70"
                  >
                    ×
                  </button>
                )}
              </div>
              <ToolSlider
                label="Position"
                display={`${stop.position}%`}
                min={0}
                max={100}
                value={stop.position}
                onChange={(v) => updateStop(i, "position", v)}
              />
            </div>
          ))}
          <button
            type="button"
            onClick={addStop}
            className="cursor-pointer self-start rounded-md border border-dashed border-border px-2.5 py-1.5 font-body text-[11.5px] text-text-muted transition-colors duration-200 hover:border-accent/50 hover:text-accent-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            + Add Stop
          </button>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
