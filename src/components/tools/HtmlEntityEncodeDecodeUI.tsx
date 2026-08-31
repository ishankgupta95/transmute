"use client";

import { useCallback, useState } from "react";

import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
} from "@/components/tools/ToolAside";
import {
  lineCount,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { formatFileSize } from "@/lib/utils/file-helpers";

function encodeHtmlEntities(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return text.replace(/[&<>"']/g, (ch) => map[ch]);
}

function decodeHtmlEntities(text: string): string {
  const el = document.createElement("textarea");
  el.innerHTML = text;
  return el.value;
}

export function HtmlEntityEncodeDecodeUI() {
  const [mode, setMode] = useState<"encode" | "decode">("encode");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const { copied, copy } = useCopied();

  const handleConvert = useCallback(
    (text: string, m: "encode" | "decode") => {
      setInput(text);
      setOutput("");
      if (!text) return;
      setOutput(m === "encode" ? encodeHtmlEntities(text) : decodeHtmlEntities(text));
    },
    [],
  );

  const handleModeChange = useCallback(
    (m: "encode" | "decode") => {
      setMode(m);
      if (input) handleConvert(input, m);
    },
    [input, handleConvert],
  );

  const handleCopy = useCallback(() => {
    void copy(output);
  }, [copy, output]);

  return (
    <>
      {/* ── Canvas: the doc's two-up IN / OUT panes ──────────── */}
      <div className={CANVAS_COLUMN}>
        <TextPanes columns={output ? 2 : 1}>
          <TextPane
            label={mode === "encode" ? "Text to Encode" : "HTML Entities to Decode"}
            lines={lineCount(input)}
            size={formatFileSize(new Blob([input]).size)}
          >
            <textarea
              value={input}
              onChange={(e) => handleConvert(e.target.value, mode)}
              placeholder={
                mode === "encode"
                  ? '<p>Hello & "World"</p>'
                  : "&lt;p&gt;Hello &amp; &quot;World&quot;&lt;/p&gt;"
              }
              aria-label={mode === "encode" ? "Text to encode" : "HTML entities to decode"}
              className={TEXT_PANE_BODY}
            />
          </TextPane>

          {output && (
            <TextPane
              tone="out"
              label="Output"
              lines={lineCount(output)}
              size={formatFileSize(new Blob([output]).size)}
              action={
                <button
                  onClick={handleCopy}
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
      </div>

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
        <ToolAsideSection label="DIRECTION">
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
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Converts as you type — nothing to run.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
