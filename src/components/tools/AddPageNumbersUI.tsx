"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { addPageNumbers, type PageNumberPosition } from "@/lib/tools/pdf-engine";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  CanvasHeader,
  CanvasStage,
} from "@/components/tools/ToolCanvas";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { chipClass } from "@/components/workspace/shared";

/** The six anchors pdf-engine understands, in visual grid order. */
const POSITIONS = [
  { value: "top-left" as const, label: "TL" },
  { value: "top-center" as const, label: "TC" },
  { value: "top-right" as const, label: "TR" },
  { value: "bottom-left" as const, label: "BL" },
  { value: "bottom-center" as const, label: "BC" },
  { value: "bottom-right" as const, label: "BR" },
];

export function AddPageNumbersUI() {
  const [file, setFile] = useState<File | null>(null);
  const [position, setPosition] = useState<PageNumberPosition>("bottom-center");
  const [startNumber, setStartNumber] = useState(1);
  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setStatus("idle");
    setError(null);
  }, []);

  const handleProcess = useCallback(async () => {
    if (!file) return;
    setStatus("processing");
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const bytes = await addPageNumbers(buf, position, startNumber);
      setResult(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add page numbers");
      setStatus("error");
    }
  }, [file, position, startNumber]);

  const handleReset = useCallback(() => {
    setFile(null);
    setResult(null);
    setStatus("idle");
    setError(null);
  }, []);

  if (!file) return <DropZone accept=".pdf" onFiles={handleFiles} />;

  return (
    <>
      {/* ── Canvas: the page, with the number where it will land ── */}
      <div className="min-w-0 space-y-[13px]">
        <CanvasHeader file={file.name} meta={formatFileSize(file.size)} trailing="PDF" />

        <CanvasStage className="flex justify-center p-[15px]">
          {/* One page tile at reading size, carrying the live number position. */}
          <div className="relative aspect-3/4 w-[188px] overflow-hidden rounded-[5px] border-2 border-accent bg-[linear-gradient(170deg,#f3f5fe_0%,#dfe3f0_100%)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_22%,transparent)]">
            <span className="absolute inset-x-[13px] top-4 flex flex-col gap-[5px]">
              <span className="h-[5px] w-[70%] rounded-sm bg-[#75798c]" />
              <span className="h-[3px] w-full rounded-sm bg-[#b2b6ca]" />
              <span className="h-[3px] w-[92%] rounded-sm bg-[#b2b6ca]" />
              <span className="h-[3px] w-[97%] rounded-sm bg-[#b2b6ca]" />
              <span className="h-[3px] w-[64%] rounded-sm bg-[#b2b6ca]" />
            </span>
            {POSITIONS.map(({ value: pos }) => (
              <span
                key={pos}
                className={`absolute px-1.5 font-mono text-[11px] leading-none ${
                  pos === position ? "font-medium text-[#2b2741]" : "text-[#75798c] opacity-25"
                } ${pos.startsWith("top") ? "top-2" : "bottom-2"} ${
                  pos.endsWith("left")
                    ? "left-2"
                    : pos.endsWith("right")
                      ? "right-2"
                      : "left-1/2 -translate-x-1/2"
                }`}
              >
                {startNumber}
              </span>
            ))}
          </div>
        </CanvasStage>

        <CanvasFootnote>
          NUMBER SHOWN AT ITS CHOSEN CORNER · EVERY PAGE GETS ONE
        </CanvasFootnote>

        {status === "processing" && <ProgressBar progress={null} />}
        {error && <ErrorMessage message={error} />}
      </div>

      <ToolAside
        footer={
          <>
            {result ? (
              <DownloadButton
                blob={result}
                fileName={file.name.replace(/\.pdf$/i, "-numbered.pdf")}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel={status === "processing" ? "Processing…" : "Add page numbers"}
                onPrimary={handleProcess}
                primaryDisabled={status === "processing"}
              />
            )}
            <ToolResetLink onClick={handleReset} label="CHANGE FILE" />
          </>
        }
      >
        <ToolAsideSection label="POSITION">
          <div className="grid grid-cols-3 gap-1.5">
            {POSITIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setPosition(value)}
                aria-pressed={position === value}
                className={chipClass(position === value, "px-1 py-[7px] text-[11px]")}
              >
                {label}
              </button>
            ))}
          </div>
        </ToolAsideSection>

        <ToolAsideSection label="START NUMBER">
          <input
            type="number"
            min={1}
            value={startNumber}
            onChange={(e) => setStartNumber(Math.max(1, Number(e.target.value)))}
            aria-label="Start number"
            className="w-24 rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          />
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
