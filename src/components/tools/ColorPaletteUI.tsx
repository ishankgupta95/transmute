"use client";

import { useCallback, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { extractColorPalette, type ColorInfo } from "@/lib/tools/color-palette";

interface ColorPaletteUIProps {
  acceptFormats: string;
}

export function ColorPaletteUI({ acceptFormats }: ColorPaletteUIProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [colors, setColors] = useState<ColorInfo[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [colorCount, setColorCount] = useState(8);

  const handleFiles = useCallback(
    async (files: File[]) => {
      const f = files[0];
      if (!f) return;
      setFile(f);
      setPreviewUrl(URL.createObjectURL(f));
      setColors([]);
      setError(null);
      setIsProcessing(true);

      try {
        const palette = await extractColorPalette(f, colorCount);
        setColors(palette);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to extract colors");
      }
      setIsProcessing(false);
    },
    [colorCount],
  );

  const handleCopy = useCallback((hex: string, idx: number) => {
    navigator.clipboard.writeText(hex);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1500);
  }, []);

  const handleReset = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    setColors([]);
    setError(null);
  }, [previewUrl]);

  return (
    <div className="space-y-6">
      {!file ? (
        <>
          <div className="flex items-center justify-center gap-2 mb-2">
            <span className="text-sm text-text-muted">Colors to extract:</span>
            {[4, 6, 8, 10, 12].map((n) => (
              <button
                key={n}
                onClick={() => setColorCount(n)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  colorCount === n
                    ? "bg-accent text-bg-primary"
                    : "bg-bg-elevated text-text-muted hover:bg-bg-hover"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <DropZone accept={acceptFormats} onFiles={handleFiles} />
        </>
      ) : (
        <>
          {/* Image preview + palette side by side */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {previewUrl && (
              <div className="flex items-center justify-center rounded-lg border border-border bg-bg-secondary p-4">
                <img
                  src={previewUrl}
                  alt={file.name}
                  className="max-h-64 rounded object-contain"
                />
              </div>
            )}
            <div className="flex flex-col gap-2">
              {isProcessing && (
                <p className="text-sm text-text-muted text-center py-8">Extracting colors...</p>
              )}
              {error && <p className="text-sm text-error text-center">{error}</p>}
              {colors.map((color, i) => (
                <button
                  key={i}
                  onClick={() => handleCopy(color.hex, i)}
                  className="flex items-center gap-3 rounded-md border border-border bg-bg-secondary p-2 hover:bg-bg-hover transition-colors text-left"
                  title="Click to copy hex code"
                >
                  <div
                    className="w-10 h-10 rounded shrink-0"
                    style={{ backgroundColor: color.hex }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-text-primary font-mono">
                      {copiedIdx === i ? "Copied!" : color.hex}
                    </p>
                    <p className="text-xs text-text-muted">
                      rgb({color.rgb.join(", ")}) · {Math.round(color.frequency * 100)}%
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Combined palette bar */}
          {colors.length > 0 && (
            <div className="flex h-12 rounded-lg overflow-hidden border border-border">
              {colors.map((color, i) => (
                <div
                  key={i}
                  className="h-full"
                  style={{
                    backgroundColor: color.hex,
                    flex: color.frequency,
                  }}
                  title={color.hex}
                />
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-center">
            <button
              onClick={handleReset}
              className="rounded-md border border-border px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-hover transition-colors"
            >
              Analyze another image
            </button>
          </div>
        </>
      )}
    </div>
  );
}
