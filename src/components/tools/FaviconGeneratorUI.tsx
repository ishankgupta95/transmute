"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import JSZip from "jszip";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { encodeIcoAsync } from "@/lib/tools/ico-encode";
import { canvasToBlob, loadImage } from "@/lib/tools/canvas-utils";
import { drawContained } from "@/lib/tools/image-draw";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { useImageDimensions } from "@/hooks/useImageDimensions";
import { imageMeta } from "@/lib/utils/canvas-meta";
import { formatFileSize } from "@/lib/utils/file-helpers";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import { ToolProgress } from "@/components/tools/ToolControls";
import {
  CanvasHeader,
  CodeBlock,
  IconSizes,
} from "@/components/tools/ToolCanvas";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";

const FAVICON_SIZES = [
  { size: 16, name: "favicon-16x16.png", label: "16×16 (Browser tab)" },
  { size: 32, name: "favicon-32x32.png", label: "32×32 (Browser tab)" },
  { size: 48, name: "favicon-48x48.png", label: "48×48 (Windows)" },
  { size: 180, name: "apple-touch-icon.png", label: "180×180 (Apple Touch)" },
  { size: 192, name: "android-chrome-192x192.png", label: "192×192 (PWA)" },
  { size: 512, name: "android-chrome-512x512.png", label: "512×512 (PWA)" },
];

/*
  The head snippet links a manifest, so the ZIP has to contain one — a snippet
  that points at a file the download does not carry is a broken instruction.
  It names the two android-chrome PNGs above, which are otherwise referenced by
  nothing. `name`/`short_name` are left blank deliberately: this tool never
  learns the site's name, and inventing one would be worse than an empty field
  the user fills in.
*/
const WEB_MANIFEST = JSON.stringify(
  {
    name: "",
    short_name: "",
    icons: [
      { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    display: "standalone",
  },
  null,
  2,
);

/** PNGs + the .ico + the manifest — what the ZIP actually contains. */
const ASSET_COUNT = FAVICON_SIZES.length + 2;

export function FaviconGeneratorUI({ acceptFormats }: { acceptFormats: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ blob: Blob } | null>(null);
  const [htmlSnippet, setHtmlSnippet] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { copied, copy } = useCopied();
  const previewUrl = useObjectUrl(file);
  // The doc's icon readout is "1024 × 1024 · 84 KB" — the source dimensions
  // matter here, since every size below the source is a downscale and every
  // size above it is an upscale.
  const sourceDims = useImageDimensions(file);

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setError(null);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!file) return;
    setIsProcessing(true);
    setError(null);

    try {
      const img = await loadImage(file);
      const zip = new JSZip();

      // Generate each size as PNG
      for (const { size, name } of FAVICON_SIZES) {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas 2D context not available");
        drawContained(ctx, img, size);
        const blob = await canvasToBlob(canvas, "image/png");
        zip.file(name, blob);
      }

      // Generate ICO (16, 32, 48)
      const icoSizes = [16, 32, 48];
      const icoImages = icoSizes.map((size) => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas 2D context not available");
        drawContained(ctx, img, size);
        return { canvas, size };
      });
      const icoBlob = await encodeIcoAsync(icoImages);
      zip.file("favicon.ico", icoBlob);
      zip.file("site.webmanifest", WEB_MANIFEST);

      const zipBlob = await zip.generateAsync({ type: "blob" });
      setResult({ blob: zipBlob });

      setHtmlSnippet(
        `<link rel="icon" type="image/x-icon" href="/favicon.ico" />
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
<link rel="manifest" href="/site.webmanifest" />`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    }
    setIsProcessing(false);
  }, [file]);

  const handleCopySnippet = useCallback(() => {
    void copy(htmlSnippet);
  }, [copy, htmlSnippet]);

  const handleReset = useCallback(() => {
    setFile(null);
    setResult(null);
    setError(null);
    setHtmlSnippet("");
  }, []);

  if (!file) {
    return <DropZone accept={acceptFormats} onFiles={handleFiles} />;
  }

  return (
    <>
      {/* ── Canvas: the source mark and every size it becomes ── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={imageMeta(sourceDims, formatFileSize(file.size))}
          trailing={`${ASSET_COUNT} ASSETS → favicons.zip`}
        />

        <IconSizes
          previewUrl={previewUrl}
          sizes={[
            [16, "Browser tab", 16],
            [32, "Browser tab", 24],
            [48, "Windows", 34],
            [180, "Apple touch", 52],
            [192, "PWA", 64],
            [512, "PWA splash", 84],
          ]}
        />

        {error && <ErrorMessage message={error} />}

        {/* The doc gives this block a bordered Copy button, not bare link
            text — `CodeBlock` already draws the label/action row. */}
        {htmlSnippet && (
          <CodeBlock
            label="HEAD SNIPPET"
            action={
              <button
                type="button"
                onClick={handleCopySnippet}
                className="h-6 cursor-pointer rounded-[6px] border border-border px-[9px] font-body text-[11px] leading-none font-medium text-accent transition-colors hover:border-accent/40 hover:text-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            }
          >
            {htmlSnippet}
          </CodeBlock>
        )}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {/* The doc pins the running readout to the rail footer. The canvas
                draws report no progress, so the bar is indeterminate. */}
            {isProcessing && (
              <ToolProgress phase="GENERATING" percent={null} label="Generating favicons" />
            )}
            {result ? (
              <DownloadButton
                blob={result.blob}
                fileName="favicons.zip"
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                // The doc's primary names the work with its count.
                primaryLabel={isProcessing ? "Generating…" : `Generate ${ASSET_COUNT} assets`}
                onPrimary={handleGenerate}
                primaryDisabled={isProcessing}
              />
            )}
            <ToolResetLink
              onClick={handleReset}
              label={result ? "GENERATE FOR ANOTHER" : "CANCEL"}
            />
          </>
        }
      >
        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Source", formatFileSize(file.size)],
              ["ZIP", result ? formatFileSize(result.blob.size) : "—"],
              ["Files", String(ASSET_COUNT)],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Every size is drawn from your original, fitted inside a square with transparent
            padding — start from a square image at 512px or larger for edge-to-edge icons.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
