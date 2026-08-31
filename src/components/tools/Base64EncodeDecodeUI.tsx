"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
} from "@/components/tools/ToolAside";
import {
  lineCount,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";
import { cn } from "@/lib/utils/cn";
import { ToolControl, ToolControlGroup } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { formatFileSize } from "@/lib/utils/file-helpers";

export function Base64EncodeDecodeUI() {
  const [mode, setMode] = useState<"encode" | "decode">("encode");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const { copied, copy } = useCopied();
  const [fileMode, setFileMode] = useState(false);
  // The loaded file's name lives OUTSIDE the text state: it used to be
  // written into `input`, so switching direction re-encoded "photo.jpg" as
  // text and silently replaced the file's Base64 with garbage.
  const [fileName, setFileName] = useState("");

  const handleConvert = useCallback(
    (text: string, m: "encode" | "decode") => {
      setInput(text);
      setError("");
      setOutput("");
      if (!text.trim()) return;
      try {
        if (m === "encode") {
          // Handle UTF-8 properly
          const bytes = new TextEncoder().encode(text);
          let binary = "";
          for (const b of bytes) binary += String.fromCharCode(b);
          setOutput(btoa(binary));
        } else {
          // Accept URL-safe Base64 (-/_ , no padding) as used by JWTs and many
          // APIs, and line-wrapped Base64 — `base64` wraps at 76 columns, and
          // PEM bodies and `kubectl get secret -o yaml` values are wrapped.
          // `atob` tolerates the newlines itself; it was the `% 4` padding
          // arithmetic below that counted them and produced a wrong pad.
          let normalized = text.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
          while (normalized.length % 4) normalized += "=";
          const binary = atob(normalized);
          const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
          setOutput(new TextDecoder().decode(bytes));
        }
      } catch {
        setError(m === "encode" ? "Failed to encode" : "Invalid Base64 string");
      }
    },
    [],
  );

  const handleModeChange = useCallback(
    (m: "encode" | "decode") => {
      setMode(m);
      setFileMode(false);
      setFileName("");
      // Re-run the TEXT input (preserved while file mode was active) —
      // never the file's name.
      handleConvert(input, m);
    },
    [input, handleConvert],
  );

  const handleSourceChange = useCallback(
    (source: "text" | "file") => {
      setFileMode(source === "file");
      setFileName("");
      setError("");
      // Whatever the previous source produced no longer describes this one.
      if (source === "file") setOutput("");
      else handleConvert(input, mode);
    },
    [input, mode, handleConvert],
  );

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] ?? "";
      setOutput(base64);
      setFileName(f.name);
      setError("");
    };
    reader.readAsDataURL(f);
  }, []);

  const handleCopy = useCallback(() => {
    void copy(output);
  }, [copy, output]);

  return (
    <>
      {/* ── Canvas: the doc's two-up IN / OUT panes ──────────── */}
      <div className={CANVAS_COLUMN}>
        {fileMode && <DropZone accept="*/*" onFiles={handleFiles} />}

        <TextPanes columns={output ? 2 : 1}>
          {fileMode ? (
            <TextPane label="File" lines={undefined}>
              <div className={cn(TEXT_PANE_BODY, "text-text-muted")}>
                {fileName || "Drop a file above to encode it."}
              </div>
            </TextPane>
          ) : (
            <TextPane
              label={mode === "encode" ? "Text to Encode" : "Base64 to Decode"}
              lines={lineCount(input)}
              size={formatFileSize(new Blob([input]).size)}
            >
              <textarea
                value={input}
                onChange={(e) => handleConvert(e.target.value, mode)}
                placeholder={mode === "encode" ? "Enter text to encode..." : "Paste Base64 string..."}
                aria-label={mode === "encode" ? "Text to encode" : "Base64 to decode"}
                className={TEXT_PANE_BODY}
              />
            </TextPane>
          )}

          {output && (
            <TextPane
              tone="out"
              label="Output"
              lines={lineCount(output)}
              size={formatFileSize(new Blob([output]).size)}
              action={
                <button
                  onClick={handleCopy}
                  aria-label={copied ? "Copied output" : "Copy output"}
                  className="cursor-pointer text-accent transition-colors hover:text-accent-hover"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              }
            >
              <textarea readOnly value={output} aria-label="Output" className={TEXT_PANE_BODY} />
            </TextPane>
          )}
        </TextPanes>

        {error && (
          <ErrorMessage message={error} />
        )}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          output ? (
            <ToolActions
              primaryLabel={copied ? "Copied to clipboard" : "Copy output"}
              onPrimary={handleCopy}
            />
          ) : undefined
        }
      >
        {/* One bordered block for the whole control set — the doc gives its
            own rule only to START FROM, ADVANCED and OUTPUT. */}
        <ToolControlGroup>
          <ToolControl label="DIRECTION">
            <ToolChoice
              label="Direction"
              fill
              value={mode}
              onChange={handleModeChange}
              options={[
                { value: "encode" as const, label: "Encode" },
                { value: "decode" as const, label: "Decode" },
              ]}
            />
          </ToolControl>

          {mode === "encode" && (
            <ToolControl label="SOURCE">
              <ToolChoice
                label="Input source"
                fill
                value={fileMode ? "file" : "text"}
                onChange={handleSourceChange}
                options={[
                  { value: "text" as const, label: "Text" },
                  { value: "file" as const, label: "File" },
                ]}
              />
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                A file is read as bytes and encoded whole — nothing leaves this device.
              </span>
            </ToolControl>
          )}
        </ToolControlGroup>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["In", fileMode ? fileName || "—" : `${input.length} chars`],
              ["Out", output ? `${output.length} chars` : "—"],
            ]}
          />
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
