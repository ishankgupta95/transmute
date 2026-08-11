"use client";

import { useCallback, useState } from "react";

import { copyText } from "@/lib/utils/clipboard";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
} from "@/components/tools/ToolAside";
import { CodeBlock, ColorStage } from "@/components/tools/ToolCanvas";
import { hslToRgb, parseHex, rgbToHex, rgbToHsl } from "@/lib/tools/color-picker";

const COPY_BUTTON =
  "shrink-0 inline-flex items-center justify-center min-h-9 px-3 py-1.5 rounded-md text-xs font-medium text-accent hover:bg-accent-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary transition-colors";

const NUMBER_INPUT =
  "w-full rounded-md border border-border bg-bg-elevated px-2 py-2 text-sm text-text-primary font-mono text-center";

export function ColorPickerUI() {
  /*
    `hex` is ALWAYS a valid #rrggbb — every derived value (stage background,
    RGB/HSL fields, CSS block) reads from it. `hexInput` is whatever is in
    the text field, so a half-typed "#2d" neither NaNs the picker nor fights
    the user's cursor; it snaps into `hex` the moment it parses (3- or
    6-digit, # optional).
  */
  const [hex, setHex] = useState("#2dd4bf");
  const [hexInput, setHexInput] = useState("#2dd4bf");
  const [copied, setCopied] = useState<string | null>(null);

  const [r, g, b] = parseHex(hex) ?? [0, 0, 0];
  const [h, s, l] = rgbToHsl(r, g, b);

  const applyHex = useCallback((valid: string) => {
    setHex(valid);
    setHexInput(valid);
  }, []);

  const handleHexChange = useCallback((val: string) => {
    setHexInput(val);
    const rgb = parseHex(val);
    if (rgb) setHex(rgbToHex(...rgb));
  }, []);

  const handleRgbChange = useCallback((nr: number, ng: number, nb: number) => {
    applyHex(rgbToHex(nr, ng, nb));
  }, [applyHex]);

  const handleHslChange = useCallback((nh: number, ns: number, nl: number) => {
    const [nr, ng, nb] = hslToRgb(nh, ns, nl);
    applyHex(rgbToHex(nr, ng, nb));
  }, [applyHex]);

  const handleCopy = useCallback((label: string, value: string) => {
    copyText(value).then((ok) => {
      if (ok) {
        setCopied(label);
        setTimeout(() => setCopied(null), 2000);
      }
    });
  }, []);

  const hexStr = hex;
  const rgbStr = `rgb(${r}, ${g}, ${b})`;
  const hslStr = `hsl(${h}, ${s}%, ${l}%)`;

  const handleCopyAll = useCallback(() => {
    handleCopy("all", `${hexStr}\n${rgbStr}\n${hslStr}`);
  }, [handleCopy, hexStr, rgbStr, hslStr]);

  return (
    <>
      {/* ── Canvas: the doc's colour stage + code block ────── */}
      <div className="min-w-0 space-y-[15px]">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-[13px] leading-none font-medium text-text-primary">
            Picker
          </span>
          <span className="ml-auto font-mono text-[10.5px] leading-none text-text-muted">
            HEX · RGB · HSL
          </span>
        </div>

        <ColorStage style={{ backgroundColor: hex }} caption={hexStr} className="min-h-[18rem]" />

        <CodeBlock label="CSS">
          {`color: ${hexStr};\ncolor: ${rgbStr};\ncolor: ${hslStr};`}
        </CodeBlock>
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <ToolActions
            primaryLabel={copied === "all" ? "Copied to clipboard" : "Copy all formats"}
            onPrimary={handleCopyAll}
          />
        }
      >
        <ToolAsideSection label="PICKER">
          <input
            type="color"
            value={hex}
            onChange={(e) => handleHexChange(e.target.value)}
            aria-label="Pick a color"
            className="h-11 w-full cursor-pointer rounded-md border border-border bg-bg-elevated p-1"
          />
        </ToolAsideSection>

        <ToolAsideSection label="HEX">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={hexInput}
              onChange={(e) => handleHexChange(e.target.value)}
              aria-label="Hex value"
              className="min-w-0 flex-1 rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary font-mono"
            />
            <button
              onClick={() => handleCopy("hex", hexStr)}
              aria-label={copied === "hex" ? "Copied HEX" : "Copy HEX value"}
              className={COPY_BUTTON}
            >
              {copied === "hex" ? "Copied!" : "Copy"}
            </button>
          </div>
        </ToolAsideSection>

        <ToolAsideSection label="RGB">
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 flex-1 gap-1">
              {([r, g, b] as const).map((v, i) => (
                <input
                  key={i}
                  type="number"
                  min={0}
                  max={255}
                  value={v}
                  onChange={(e) => {
                    const vals = [r, g, b];
                    vals[i] = Number(e.target.value);
                    handleRgbChange(vals[0], vals[1], vals[2]);
                  }}
                  aria-label={["Red", "Green", "Blue"][i]}
                  className={NUMBER_INPUT}
                />
              ))}
            </div>
            <button
              onClick={() => handleCopy("rgb", rgbStr)}
              aria-label={copied === "rgb" ? "Copied RGB" : "Copy RGB value"}
              className={COPY_BUTTON}
            >
              {copied === "rgb" ? "Copied!" : "Copy"}
            </button>
          </div>
        </ToolAsideSection>

        <ToolAsideSection label="HSL">
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 flex-1 gap-1">
              {([h, s, l] as const).map((v, i) => (
                <input
                  key={i}
                  type="number"
                  min={0}
                  max={i === 0 ? 360 : 100}
                  value={v}
                  onChange={(e) => {
                    const vals = [h, s, l];
                    vals[i] = Number(e.target.value);
                    handleHslChange(vals[0], vals[1], vals[2]);
                  }}
                  aria-label={["Hue", "Saturation", "Lightness"][i]}
                  className={NUMBER_INPUT}
                />
              ))}
            </div>
            <button
              onClick={() => handleCopy("hsl", hslStr)}
              aria-label={copied === "hsl" ? "Copied HSL" : "Copy HSL value"}
              className={COPY_BUTTON}
            >
              {copied === "hsl" ? "Copied!" : "Copy"}
            </button>
          </div>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
