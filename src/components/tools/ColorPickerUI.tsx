"use client";

import { useCallback, useState } from "react";

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360; s /= 100; l /= 100;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [Math.round(hue2rgb(p, q, h + 1 / 3) * 255), Math.round(hue2rgb(p, q, h) * 255), Math.round(hue2rgb(p, q, h - 1 / 3) * 255)];
}

export function ColorPickerUI() {
  const [hex, setHex] = useState("#2dd4bf");
  const [copied, setCopied] = useState<string | null>(null);

  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);

  const handleHexChange = useCallback((val: string) => {
    setHex(val);
  }, []);

  const handleRgbChange = useCallback((nr: number, ng: number, nb: number) => {
    setHex(rgbToHex(nr, ng, nb));
  }, []);

  const handleHslChange = useCallback((nh: number, ns: number, nl: number) => {
    const [nr, ng, nb] = hslToRgb(nh, ns, nl);
    setHex(rgbToHex(nr, ng, nb));
  }, []);

  const handleCopy = useCallback((label: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }, []);

  const hexStr = hex;
  const rgbStr = `rgb(${r}, ${g}, ${b})`;
  const hslStr = `hsl(${h}, ${s}%, ${l}%)`;

  return (
    <div className="space-y-6">
      {/* Color preview + picker */}
      <div className="flex flex-col items-center gap-4">
        <div className="w-full max-w-xs h-32 rounded-lg border border-border" style={{ backgroundColor: hex }} />
        <input
          type="color"
          value={hex}
          onChange={(e) => handleHexChange(e.target.value)}
          className="w-16 h-10 cursor-pointer rounded border border-border"
        />
      </div>

      {/* Values */}
      <div className="space-y-3 max-w-md mx-auto">
        {/* HEX */}
        <div className="flex items-center gap-2">
          <label className="w-12 text-sm text-text-muted">HEX</label>
          <input
            type="text"
            value={hexStr}
            onChange={(e) => {
              const v = e.target.value;
              if (/^#[0-9a-fA-F]{6}$/.test(v)) handleHexChange(v);
              else setHex(v);
            }}
            className="flex-1 rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary font-mono"
          />
          <button onClick={() => handleCopy("hex", hexStr)} className="text-xs text-accent hover:text-accent-hover shrink-0">
            {copied === "hex" ? "Copied!" : "Copy"}
          </button>
        </div>

        {/* RGB */}
        <div className="flex items-center gap-2">
          <label className="w-12 text-sm text-text-muted">RGB</label>
          <div className="flex-1 flex gap-1">
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
                className="w-full rounded-md border border-border bg-bg-elevated px-2 py-2 text-sm text-text-primary font-mono text-center"
              />
            ))}
          </div>
          <button onClick={() => handleCopy("rgb", rgbStr)} className="text-xs text-accent hover:text-accent-hover shrink-0">
            {copied === "rgb" ? "Copied!" : "Copy"}
          </button>
        </div>

        {/* HSL */}
        <div className="flex items-center gap-2">
          <label className="w-12 text-sm text-text-muted">HSL</label>
          <div className="flex-1 flex gap-1">
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
                className="w-full rounded-md border border-border bg-bg-elevated px-2 py-2 text-sm text-text-primary font-mono text-center"
              />
            ))}
          </div>
          <button onClick={() => handleCopy("hsl", hslStr)} className="text-xs text-accent hover:text-accent-hover shrink-0">
            {copied === "hsl" ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
