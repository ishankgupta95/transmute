"use client";

import { useCallback, useRef, useState } from "react";
import QRCode from "qrcode";
import { triggerDownload } from "@/lib/utils/download";
import { canvasToBlob } from "@/lib/tools/canvas-utils";

export function QrCodeGeneratorUI() {
  const [input, setInput] = useState("");
  const [fgColor, setFgColor] = useState("#000000");
  const [bgColor, setBgColor] = useState("#ffffff");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [error, setError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleGenerate = useCallback(async () => {
    setError("");
    setQrDataUrl("");
    if (!input.trim()) return;
    try {
      const canvas = canvasRef.current;
      if (!canvas) return;
      await QRCode.toCanvas(canvas, input, {
        width: 300,
        margin: 2,
        color: { dark: fgColor, light: bgColor },
      });
      setQrDataUrl(canvas.toDataURL("image/png"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate QR code");
    }
  }, [input, fgColor, bgColor]);

  const handleDownloadPng = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !qrDataUrl) return;
    try {
      const blob = await canvasToBlob(canvas, "image/png");
      triggerDownload(blob, "qrcode.png");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to download PNG");
    }
  }, [qrDataUrl]);

  const handleDownloadSvg = useCallback(async () => {
    if (!input.trim()) return;
    try {
      const svg = await QRCode.toString(input, {
        type: "svg",
        margin: 2,
        color: { dark: fgColor, light: bgColor },
      });
      const blob = new Blob([svg], { type: "image/svg+xml" });
      triggerDownload(blob, "qrcode.svg");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to download SVG");
    }
  }, [input, fgColor, bgColor]);

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">Text or URL</label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="https://example.com"
          rows={3}
          className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono resize-y placeholder:text-text-muted"
        />
      </div>

      {/* Color options */}
      <div className="flex items-center justify-center gap-4">
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          Foreground:
          <input type="color" value={fgColor} onChange={(e) => setFgColor(e.target.value)} className="w-8 h-8 rounded border border-border cursor-pointer" />
        </label>
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          Background:
          <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="w-8 h-8 rounded border border-border cursor-pointer" />
        </label>
      </div>

      <div className="flex justify-center">
        <button
          onClick={handleGenerate}
          className="rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors"
        >
          Generate QR Code
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">{error}</div>
      )}

      {/* Canvas (hidden until generated) */}
      <div className="flex justify-center">
        <canvas ref={canvasRef} className={qrDataUrl ? "rounded-lg" : "hidden"} />
      </div>

      {/* Download buttons */}
      {qrDataUrl && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={handleDownloadPng}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors"
          >
            Download PNG
          </button>
          <button
            onClick={handleDownloadSvg}
            className="rounded-md border border-border px-4 py-2 text-sm text-text-secondary hover:bg-bg-hover transition-colors"
          >
            Download SVG
          </button>
        </div>
      )}
    </div>
  );
}
