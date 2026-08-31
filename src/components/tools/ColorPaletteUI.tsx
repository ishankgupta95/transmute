"use client";

import { useCallback, useState } from "react";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { useImageDimensions } from "@/hooks/useImageDimensions";
import { imageMeta } from "@/lib/utils/canvas-meta";
import { useCopied } from "@/hooks/useCopied";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { extractColorPalette, type ColorInfo } from "@/lib/tools/color-palette";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
} from "@/components/tools/ToolAside";
import { ToolControl, ToolControlGroup, ToolProgress } from "@/components/tools/ToolControls";
import { CanvasHeader, ColorStage, SwatchRow } from "@/components/tools/ToolCanvas";
import { CANVAS_COLUMN } from "@/components/workspace/shared";

interface ColorPaletteUIProps {
  acceptFormats: string;
}

export function ColorPaletteUI({ acceptFormats }: ColorPaletteUIProps) {
  const [file, setFile] = useState<File | null>(null);
  // Hook-owned: revoked on unmount and when a second image is dropped. The
  // hand-rolled createObjectURL leaked on every route change away from here.
  const previewUrl = useObjectUrl(file);
  const [colors, setColors] = useState<ColorInfo[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { copied: copiedIdx, copy: copySwatch } = useCopied<number>();
  const { copied: copiedAll, copy: copyAll } = useCopied();
  const [colorCount, setColorCount] = useState(8);
  // The doc's image readout is dimensions AND size — the palette's own header
  // names the artefact, so the source's facts go in the meta slot.
  const sourceDims = useImageDimensions(file);

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

  const handleCopy = useCallback(
    (hex: string, idx: number) => {
      void copySwatch(hex, idx);
    },
    [copySwatch],
  );

  const handleCopyAll = useCallback(() => {
    void copyAll(colors.map((c) => c.hex).join("\n"));
  }, [copyAll, colors]);

  const handleReset = useCallback(() => {
    setFile(null);
    setColors([]);
    setError(null);
  }, []);

  if (!file) {
    return <DropZone accept={acceptFormats} onFiles={handleFiles} />;
  }

  return (
    <>
      {/* ── Canvas: what you look at ─────────────────────────── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file="Extracted palette"
          meta={imageMeta(sourceDims, formatFileSize(file.size))}
          trailing={isProcessing ? "SAMPLING…" : `${colors.length} COLORS`}
        />

        {previewUrl && (
          <ColorStage className="bg-bg-primary" caption={file.name}>
            {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL, nothing for next/image to optimise */}
            <img
              src={previewUrl}
              alt={file.name}
              className="max-h-full w-full object-contain"
            />
          </ColorStage>
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
          <>
            {/* The doc pins the running readout to the rail footer. The
                sampler reports no progress, so the bar stays indeterminate
                rather than inventing a number. */}
            {isProcessing && (
              <ToolProgress phase="SAMPLING" percent={null} label="Extracting colors" />
            )}
            <ToolActions
              primaryLabel={copiedAll ? "Copied to clipboard" : "Copy all hex codes"}
              onPrimary={handleCopyAll}
              primaryDisabled={colors.length === 0}
              onReset={handleReset}
              resetLabel="ANALYZE ANOTHER"
            />
          </>
        }
      >
        <ToolControlGroup>
          <ToolControl label="COLORS TO EXTRACT">
            <ToolChoice
              label="Colors to extract"
              fill
              value={colorCount}
              onChange={handleCountChange}
              disabled={isProcessing}
              options={[4, 6, 8, 10, 12].map((n) => ({ value: n, label: String(n) }))}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              Changing this re-analyses the same image. Click any swatch to copy its hex.
            </span>
          </ToolControl>
        </ToolControlGroup>

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
