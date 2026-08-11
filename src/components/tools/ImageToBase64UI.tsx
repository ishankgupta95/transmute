"use client";

import { useCallback, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { copyText } from "@/lib/utils/clipboard";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
} from "@/components/tools/ToolAside";
import {
  CanvasHeader,
  CodeBlock,
  lineCount,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";

interface ImageToBase64UIProps {
  acceptFormats: string;
}

export function ImageToBase64UI({ acceptFormats }: ImageToBase64UIProps) {
  const [file, setFile] = useState<File | null>(null);
  const [base64, setBase64] = useState<string>("");
  const [dataUri, setDataUri] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [outputMode, setOutputMode] = useState<"datauri" | "raw">("datauri");

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setCopied(false);

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setDataUri(result);
      // Extract raw base64 (strip data:...;base64, prefix)
      const raw = result.split(",")[1] ?? "";
      setBase64(raw);
    };
    reader.readAsDataURL(f);
  }, []);

  const handleCopy = useCallback(() => {
    const text = outputMode === "datauri" ? dataUri : base64;
    copyText(text).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    });
  }, [outputMode, dataUri, base64]);

  const handleReset = useCallback(() => {
    setFile(null);
    setBase64("");
    setDataUri("");
    setCopied(false);
  }, []);

  const output = outputMode === "datauri" ? dataUri : base64;

  if (!file) {
    return <DropZone accept={acceptFormats} onFiles={handleFiles} />;
  }

  const growth = file.size > 0 ? Math.round((output.length / file.size - 1) * 100) : 0;

  return (
    <>
      {/* ── Canvas: what you look at ─────────────────────────── */}
      <div className="min-w-0 space-y-[13px]">
        <CanvasHeader
          file={file.name}
          meta={formatFileSize(file.size)}
          trailing={outputMode === "datauri" ? "DATA URI" : "BASE64"}
        />

        <TextPanes columns={1}>
          <TextPane
            tone="out"
            label={outputMode === "datauri" ? "Data URI" : "Raw Base64"}
            lines={lineCount(output)}
            action={
              <button
                onClick={handleCopy}
                className="cursor-pointer text-accent transition-colors hover:text-accent-hover"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            }
          >
            <textarea
              readOnly
              value={output}
              aria-label={outputMode === "datauri" ? "Data URI output" : "Raw Base64 output"}
              className={TEXT_PANE_BODY}
            />
          </TextPane>
        </TextPanes>

        {outputMode === "datauri" && dataUri && (
          <CodeBlock label="Usage in HTML">
            {`<img src="${dataUri.slice(0, 60)}…" />`}
          </CodeBlock>
        )}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <ToolActions
            primaryLabel={copied ? "Copied to clipboard" : "Copy to Clipboard"}
            onPrimary={handleCopy}
            primaryDisabled={!output}
            onReset={handleReset}
            resetLabel="CONVERT ANOTHER"
          />
        }
      >
        <ToolAsideSection label="FORMAT">
          <ToolChoice
            label="Output format"
            fill
            value={outputMode}
            onChange={setOutputMode}
            options={[
              { value: "datauri" as const, label: "Data URI" },
              { value: "raw" as const, label: "Raw Base64" },
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {outputMode === "datauri"
              ? "Carries the MIME type, so it drops straight into src or url()."
              : "Payload only — for JSON bodies and APIs that add their own prefix."}
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["File", formatFileSize(file.size)],
              ["Encoded", output ? formatFileSize(output.length) : "—"],
              ["Overhead", output ? `+${growth}%` : "—"],
            ]}
          />
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
