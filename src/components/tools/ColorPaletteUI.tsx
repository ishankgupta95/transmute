"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { extractColorPalette, type ColorInfo } from "@/lib/tools/color-palette";
import { copyText } from "@/lib/utils/clipboard";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
} from "@/components/tools/ToolAside";
import { ColorStage, SwatchRow } from "@/components/tools/ToolCanvas";

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
  const [copiedAll, setCopiedAll] = useState(false);
  const [colorCount, setColorCount] = useState(8);

  const extract = useCallback(async (f: File, count: number) => {
    setColors([]);
    setError(null);
    setIsProcessing(true);
    try {
      const palette = await extractColorPalette(f, count);
      setColors(palette);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to extract colors");
    }
    setIsProcessing(false);
  }, []);

  const handleFiles = useCallback(
    async (files: File[]) => {
      const f = files[0];
      if (!f) return;
      setFile(f);
      setPreviewUrl(URL.createObjectURL(f));
      await extract(f, colorCount);
    },
    [colorCount, extract],
  );

  // Changing the count in the rail re-runs the extraction on the same image.
  const handleCountChange = useCallback(
    (n: number) => {
      setColorCount(n);
      if (file) void extract(file, n);
    },
    [file, extract],
  );

  const handleCopy = useCallback((hex: string, idx: number) => {
    copyText(hex).then((ok) => {
      if (ok) {
        setCopiedIdx(idx);
        setTimeout(() => setCopiedIdx(null), 1500);
      }
    });
  }, []);

  const handleCopyAll = useCallback(() => {
    copyText(colors.map((c) => c.hex).join("\n")).then((ok) => {
      if (ok) {
        setCopiedAll(true);
        setTimeout(() => setCopiedAll(false), 2000);
      }
    });
  }, [colors]);

  const handleReset = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    setColors([]);
    setError(null);
  }, [previewUrl]);

  if (!file) {
    return <DropZone accept={acceptFormats} onFiles={handleFiles} />;
  }

  return (
    <>
      {/* ── Canvas: what you look at ─────────────────────────── */}
      <div className="min-w-0 space-y-[15px]">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-[13px] leading-none font-medium text-text-primary">
            Extracted palette
          </span>
          <span className="ml-auto font-mono text-[10.5px] leading-none text-text-muted">
            {isProcessing ? "SAMPLING…" : `${colors.length} COLORS`}
          </span>
        </div>

        {previewUrl && (
          <ColorStage className="bg-bg-primary" caption={file.name}>
            {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL, nothing for next/image to optimise */}
            <img
              src={previewUrl}
              alt={file.name}
              className="max-h-72 w-full object-contain"
            />
          </ColorStage>
        )}

        {isProcessing && (
          <p className="py-8 text-center text-sm text-text-muted">Extracting colors...</p>
        )}
        {error && <ErrorMessage message={error} />}

        {colors.length > 0 && (
          <>
            <SwatchRow
              swatches={colors.map((c, i) => ({
                hex: c.hex,
                meta: copiedIdx === i ? "Copied!" : `${Math.round(c.frequency * 100)}%`,
              }))}
              onPick={handleCopy}
            />

            {/* The doc's combined bar: every colour at its real share. */}
            <div className="flex h-12 overflow-hidden rounded-lg border border-neutral-800">
              {colors.map((color, i) => (
                <div
                  key={i}
                  className="h-full"
                  style={{ backgroundColor: color.hex, flex: color.frequency }}
                  title={color.hex}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <ToolActions
            primaryLabel={copiedAll ? "Copied to clipboard" : "Copy all hex codes"}
            onPrimary={handleCopyAll}
            primaryDisabled={colors.length === 0}
            onReset={handleReset}
            resetLabel="ANALYZE ANOTHER"
          />
        }
      >
        <ToolAsideSection label="COLORS TO EXTRACT">
          <ToolChoice
            label="Colors to extract"
            value={colorCount}
            onChange={handleCountChange}
            disabled={isProcessing}
            options={[4, 6, 8, 10, 12].map((n) => ({ value: n, label: String(n) }))}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Changing this re-analyses the same image. Click any swatch to copy its hex.
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Found", isProcessing ? "…" : String(colors.length)],
              [
                "Dominant",
                colors[0] ? `${Math.round(colors[0].frequency * 100)}%` : "—",
              ],
            ]}
          />
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
