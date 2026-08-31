"use client";

import { useCallback, useState } from "react";

import {
  ToolActions,
  ToolAside,
} from "@/components/tools/ToolAside";
import { CanvasHeader, CodeBlock, ColorStage } from "@/components/tools/ToolCanvas";
import { hslToRgb, parseHex, rgbToHex, rgbToHsl } from "@/lib/tools/color-picker";
import { ToolControl, ToolControlGroup } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { cn } from "@/lib/utils/cn";

/**
 * The doc's small `Copy` button (the HEAD SNIPPET block):
 * `padding:0 9px;border-radius:6px;border:1px solid var(--color-divider);
 * background:transparent;color:var(--color-accent);font:500 11px/1`.
 * Sized to 30px so it sits level with the fields it copies, and focus is the
 * system's outline rather than the ring this file was still using.
 */
const COPY_BUTTON =
  "inline-flex h-[30px] flex-none cursor-pointer items-center justify-center rounded-[6px] border border-border px-[9px] font-display text-[11px] leading-none font-medium text-accent transition-colors duration-200 hover:bg-accent/12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * The doc's one field box, from the RANGE strip:
 * `height:30px;border-radius:7px;background:var(--color-surface);border:1px
 * solid var(--color-divider);font:400 12px/1 'IBM Plex Mono';padding:0 10px`.
 * The same shape `RangeField` and the regex pattern input already wear.
 */
const FIELD_CLASS =
  "h-[30px] rounded-[7px] border border-border bg-bg-elevated px-2.5 font-mono text-xs leading-none text-text-primary focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

// `cn` and not a template string: `px-1.5` has to actually beat the
// field's `px-2.5`, which only tailwind-merge guarantees.
const NUMBER_INPUT = cn(FIELD_CLASS, "w-full min-w-0 px-1.5 text-center");

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
  const { copied, copy } = useCopied<string>();

  const [r, g, b] = parseHex(hex) ?? [0, 0, 0];

  /*
    H and S are HELD, not derived from the hex on every render — the same
    split as `hex`/`hexInput` above, for the same reason. RGB is achromatic at
    black, white and full grey, so `rgbToHsl` can only answer `[0, 0, l]`
    there: deriving meant sliding Lightness to 0 and back returned #808080
    grey, and Saturation to 0 and back returned red. The user's teal was
    unrecoverable, with no undo.
  */
  const [hsl, setHsl] = useState<[number, number, number]>(() =>
    rgbToHsl(...(parseHex("#2dd4bf") ?? [0, 0, 0])),
  );
  const [h, s, l] = hsl;

  /*
    A colour arriving from ANOTHER surface — the hex field, the RGB triple, the
    native picker — is an explicit new colour, so H/S resync canonically there.
    Preservation is scoped to the HSL fields' own edits, which is where the
    round trip destroyed information: it is one continuous gesture on those
    three fields, and the hue the user is protecting is the one on screen.
  */
  const syncHsl = useCallback((rgb: [number, number, number]) => {
    setHsl(rgbToHsl(...rgb));
  }, []);

  const applyHex = useCallback((valid: string) => {
    setHex(valid);
    setHexInput(valid);
  }, []);

  const handleHexChange = useCallback(
    (val: string) => {
      setHexInput(val);
      const rgb = parseHex(val);
      if (rgb) {
        setHex(rgbToHex(...rgb));
        syncHsl(rgb);
      }
    },
    [syncHsl],
  );

  const handleRgbChange = useCallback(
    (nr: number, ng: number, nb: number) => {
      applyHex(rgbToHex(nr, ng, nb));
      syncHsl([nr, ng, nb]);
    },
    [applyHex, syncHsl],
  );

  const handleHslChange = useCallback(
    (nh: number, ns: number, nl: number) => {
      setHsl([nh, ns, nl]);
      applyHex(rgbToHex(...hslToRgb(nh, ns, nl)));
    },
    [applyHex],
  );

  const handleCopy = useCallback((label: string, value: string) => {
    void copy(value, label);
  }, [copy]);

  const hexStr = hex;
  const rgbStr = `rgb(${r}, ${g}, ${b})`;
  const hslStr = `hsl(${h}, ${s}%, ${l}%)`;

  const handleCopyAll = useCallback(() => {
    handleCopy("all", `${hexStr}\n${rgbStr}\n${hslStr}`);
  }, [handleCopy, hexStr, rgbStr, hslStr]);

  return (
    <>
      {/* ── Canvas: the doc's colour stage + code block ────── */}
      <div className={CANVAS_COLUMN}>
        {/* "HEX · RGB · HSL" names the formats below rather than reporting a
            result, so it keeps the muted tone it already had. */}
        <CanvasHeader file="Picker" trailing="HEX · RGB · HSL" trailingTone="muted" />

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
        {/* One bordered block for the whole control set — the doc gives its
            own rule only to START FROM, ADVANCED and OUTPUT. */}
        <ToolControlGroup>
          <ToolControl label="PICKER">
            <input
              type="color"
              value={hex}
              onChange={(e) => handleHexChange(e.target.value)}
              aria-label="Pick a color"
              className="h-11 w-full cursor-pointer rounded-[7px] border border-border bg-bg-elevated p-1"
            />
          </ToolControl>

          <ToolControl label="HEX">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={hexInput}
                onChange={(e) => handleHexChange(e.target.value)}
                aria-label="Hex value"
                className={cn(FIELD_CLASS, "min-w-0 flex-1")}
              />
              <button
                onClick={() => handleCopy("hex", hexStr)}
                aria-label={copied === "hex" ? "Copied HEX" : "Copy HEX value"}
                className={COPY_BUTTON}
              >
                {copied === "hex" ? "Copied!" : "Copy"}
              </button>
            </div>
          </ToolControl>

          <ToolControl label="RGB">
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
          </ToolControl>

          <ToolControl label="HSL">
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
          </ToolControl>
        </ToolControlGroup>
      </ToolAside>
    </>
  );
}
