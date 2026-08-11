"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import JSZip from "jszip";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { encodeIcoAsync } from "@/lib/tools/ico-encode";
import { canvasToBlob, loadImage } from "@/lib/tools/canvas-utils";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { copyText } from "@/lib/utils/clipboard";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import {
  CanvasHeader,
  CodeBlock,
  IconSizes,
} from "@/components/tools/ToolCanvas";

const FAVICON_SIZES = [
  { size: 16, name: "favicon-16x16.png", label: "16×16 (Browser tab)" },
  { size: 32, name: "favicon-32x32.png", label: "32×32 (Browser tab)" },
  { size: 48, name: "favicon-48x48.png", label: "48×48 (Windows)" },
  { size: 180, name: "apple-touch-icon.png", label: "180×180 (Apple Touch)" },
  { size: 192, name: "android-chrome-192x192.png", label: "192×192 (PWA)" },
  { size: 512, name: "android-chrome-512x512.png", label: "512×512 (PWA)" },
];

export function FaviconGeneratorUI({ acceptFormats }: { acceptFormats: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ blob: Blob } | null>(null);
  const [htmlSnippet, setHtmlSnippet] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const previewUrl = useObjectUrl(file);

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
        ctx.drawImage(img, 0, 0, size, size);
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
        ctx.drawImage(img, 0, 0, size, size);
        return { canvas, size };
      });
      const icoBlob = await encodeIcoAsync(icoImages);
      zip.file("favicon.ico", icoBlob);

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
    copyText(htmlSnippet).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    });
  }, [htmlSnippet]);

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
      <div className="min-w-0 space-y-[15px]">
        <CanvasHeader file={file.name} meta={formatFileSize(file.size)} trailing="ZIP" />

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

        {/* Progress */}
        {isProcessing && (
          <div className="space-y-2">
            <ProgressBar progress={null} />
            <p className="text-sm text-text-muted text-center">Generating favicons...</p>
          </div>
        )}
        {error && <ErrorMessage message={error} />}

        {/* HTML snippet */}
        {htmlSnippet && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9.5px] leading-none font-medium tracking-[0.12em] uppercase text-text-muted">
                HEAD SNIPPET
              </span>
              <button
                onClick={handleCopySnippet}
                className="cursor-pointer font-body text-[11px] leading-none text-accent transition-colors hover:text-accent-hover"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <CodeBlock>{htmlSnippet}</CodeBlock>
          </div>
        )}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {result ? (
              <DownloadButton
                blob={result.blob}
                fileName="favicons.zip"
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel={isProcessing ? "Generating…" : "Generate All Favicons"}
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
              ["Files", String(FAVICON_SIZES.length + 1)],
              ["ZIP", result ? formatFileSize(result.blob.size) : "—"],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Every size is drawn from your original, so start from a square image at 512px or
            larger.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
