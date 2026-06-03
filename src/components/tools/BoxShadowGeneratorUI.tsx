"use client";

import { useCallback, useState } from "react";

import { copyText } from "@/lib/utils/clipboard";

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
  const [copied, setCopied] = useState(false);

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
    copyText(cssCode).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    });
  }, [cssCode]);

  return (
    <div className="space-y-4">
      {/* Preview */}
      <div className="flex items-center justify-center py-12">
        <div
          className="w-48 h-48 rounded-lg bg-bg-secondary border border-border"
          style={{ boxShadow: cssValue }}
        />
      </div>

      {/* Shadow layers */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-text-secondary">Shadows</label>
          <button onClick={addShadow} className="text-xs text-accent hover:text-accent-hover transition-colors">
            + Add Layer
          </button>
        </div>

        {shadows.map((shadow, i) => (
          <div key={i} className="rounded-lg border border-border bg-bg-secondary p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">Layer {i + 1}</span>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1 text-xs text-text-secondary">
                  <input
                    type="checkbox"
                    checked={shadow.inset}
                    onChange={(e) => updateShadow(i, "inset", e.target.checked)}
                    className="rounded border-border accent-accent"
                  />
                  Inset
                </label>
                {shadows.length > 1 && (
                  <button onClick={() => removeShadow(i)} className="text-xs text-error hover:text-error/80">×</button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(["x", "y", "blur", "spread"] as const).map((field) => (
                <label key={field} className="space-y-1">
                  <span className="text-xs text-text-muted capitalize">{field} ({shadow[field]}px)</span>
                  <input
                    type="range"
                    min={field === "x" || field === "y" ? -50 : 0}
                    max={field === "spread" ? 50 : 100}
                    value={shadow[field]}
                    onChange={(e) => updateShadow(i, field, Number(e.target.value))}
                    className="w-full accent-accent"
                  />
                </label>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-text-muted">
                Color:
                <input
                  type="color"
                  value={shadow.color}
                  onChange={(e) => updateShadow(i, "color", e.target.value)}
                  className="w-7 h-7 rounded border border-border cursor-pointer"
                />
              </label>
              <label className="flex-1 space-y-1">
                <span className="text-xs text-text-muted">Opacity ({shadow.opacity}%)</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={shadow.opacity}
                  onChange={(e) => updateShadow(i, "opacity", Number(e.target.value))}
                  className="w-full accent-accent"
                />
              </label>
            </div>
          </div>
        ))}
      </div>

      {/* CSS code */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-medium text-text-secondary">CSS Code</label>
          <button onClick={handleCopy} className="text-xs text-accent hover:text-accent-hover transition-colors">
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <code className="block rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono break-all">
          {cssCode}
        </code>
      </div>
    </div>
  );
}
