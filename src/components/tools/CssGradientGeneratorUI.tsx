"use client";

import { useCallback, useState } from "react";

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

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(cssCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [cssCode]);

  return (
    <div className="space-y-4">
      {/* Preview */}
      <div className="w-full h-48 rounded-lg border border-border" style={{ background: cssValue }} />

      {/* Type selector */}
      <div className="flex items-center justify-center gap-2">
        {(["linear", "radial", "conic"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              type === t ? "bg-accent text-bg-primary" : "bg-bg-elevated text-text-secondary hover:bg-bg-hover"
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Angle (for linear and conic) */}
      {(type === "linear" || type === "conic") && (
        <div className="flex items-center justify-center gap-2">
          <label className="text-sm text-text-secondary">Angle:</label>
          <input
            type="range"
            min={0}
            max={360}
            value={angle}
            onChange={(e) => setAngle(Number(e.target.value))}
            className="w-40 accent-accent"
          />
          <span className="w-12 text-sm text-text-primary font-mono">{angle}°</span>
        </div>
      )}

      {/* Color stops */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-text-secondary">Color Stops</label>
          <button onClick={addStop} className="text-xs text-accent hover:text-accent-hover transition-colors">
            + Add Stop
          </button>
        </div>
        {stops.map((stop, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="color"
              value={stop.color}
              onChange={(e) => updateStop(i, "color", e.target.value)}
              className="w-8 h-8 rounded border border-border cursor-pointer"
            />
            <input
              type="text"
              value={stop.color}
              onChange={(e) => updateStop(i, "color", e.target.value)}
              className="w-24 rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-text-primary font-mono"
            />
            <input
              type="range"
              min={0}
              max={100}
              value={stop.position}
              onChange={(e) => updateStop(i, "position", Number(e.target.value))}
              className="flex-1 accent-accent"
            />
            <span className="w-10 text-xs text-text-muted font-mono">{stop.position}%</span>
            {stops.length > 2 && (
              <button
                onClick={() => removeStop(i)}
                className="text-xs text-error hover:text-error/80 transition-colors"
              >
                ×
              </button>
            )}
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
