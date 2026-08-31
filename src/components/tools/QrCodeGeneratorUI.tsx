"use client";

import { useCallback, useRef, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import QRCode from "qrcode";
import { triggerDownload } from "@/lib/utils/download";
import { canvasToBlob } from "@/lib/tools/canvas-utils";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolOutput,
} from "@/components/tools/ToolAside";
import {
  CanvasHeader,
  ColorStage,
  lineCount,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { formatFileSize } from "@/lib/utils/file-helpers";

const SECONDARY_BUTTON =
  "h-9 w-full cursor-pointer rounded-[9px] border border-border font-display text-[13px] leading-none font-medium text-neutral-300 transition-colors duration-200 hover:bg-text-primary/7 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

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
    <>
      {/* ── Canvas: the doc's colour stage, checkerboard behind ── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file="QR code"
          trailing={qrDataUrl ? "READY · PNG" : "ENTER TEXT TO GENERATE"}
        />

        <TextPanes columns={1}>
          <TextPane
            label="Text or URL"
            lines={lineCount(input)}
            size={formatFileSize(new Blob([input]).size)}
          >
            <textarea
              value={input}
              onChange={(e) => {
                // The canvas holds the PREVIOUS payload until Generate runs
                // again — leaving it up under a lit "READY" header, with a
                // Download PNG that saves the old code, is a lie.
                setInput(e.target.value);
                setQrDataUrl("");
              }}
              placeholder="https://example.com"
              aria-label="Text or URL"
              className={TEXT_PANE_BODY}
            />
          </TextPane>
        </TextPanes>

        {error && <ErrorMessage message={error} />}

        <ColorStage checkered caption="scan target">
          <canvas ref={canvasRef} className={qrDataUrl ? "rounded-[10px]" : "hidden"} />
        </ColorStage>
      </div>

      <ToolAside
        footer={
          <>
            {/* Generate stays mounted for the whole session — it is the only
                way back to a fresh code after the text or a colour changes.
                Exactly one ToolActions, so only one control owns the accent
                style and the Cmd+Enter binding. */}
            <ToolActions
              primaryLabel="Generate QR Code"
              onPrimary={handleGenerate}
              primaryDisabled={!input.trim()}
            />
            {qrDataUrl && (
              <>
                <button type="button" onClick={handleDownloadPng} className={SECONDARY_BUTTON}>
                  Download PNG
                </button>
                <button type="button" onClick={handleDownloadSvg} className={SECONDARY_BUTTON}>
                  Download SVG
                </button>
              </>
            )}
          </>
        }
      >
        <ToolAsideSection label="COLORS">
          <label className="flex items-center justify-between gap-3 font-body text-[12.5px] text-neutral-300">
            Foreground
            <input
              type="color"
              value={fgColor}
              onChange={(e) => {
                setFgColor(e.target.value);
                setQrDataUrl("");
              }}
              className="size-8 cursor-pointer rounded-sm border border-border"
            />
          </label>
          <label className="flex items-center justify-between gap-3 font-body text-[12.5px] text-neutral-300">
            Background
            <input
              type="color"
              value={bgColor}
              onChange={(e) => {
                setBgColor(e.target.value);
                setQrDataUrl("");
              }}
              className="size-8 cursor-pointer rounded-sm border border-border"
            />
          </label>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Keep the contrast high — scanners need it.
          </span>
        </ToolAsideSection>

        {qrDataUrl && (
          <ToolAsideSection label="OUTPUT">
            <ToolOutput
              rows={[
                ["Format", "PNG · SVG"],
                ["Encoded", `${input.length} chars`],
              ]}
            />
          </ToolAsideSection>
        )}
      </ToolAside>
    </>
  );
}
