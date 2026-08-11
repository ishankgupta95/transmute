"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { copyText } from "@/lib/utils/clipboard";
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
import { formatXml, minifyXml } from "@/lib/tools/xml-format";

export function XmlFormatterUI() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"format" | "minify">("format");
  const [copied, setCopied] = useState(false);

  const handleFormat = useCallback(() => {
    setError("");
    setOutput("");
    if (!input.trim()) return;
    try {
      setOutput(mode === "format" ? formatXml(input) : minifyXml(input));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid XML");
    }
  }, [input, mode]);

  const handleCopy = useCallback(() => {
    copyText(output).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    });
  }, [output]);

  return (
    <>
      {/* ── Canvas: the doc's two-up IN / OUT panes ────────── */}
      <div className="min-w-0 space-y-[13px]">
        <TextPanes columns={output ? 2 : 1}>
          <TextPane label="Input XML" lines={lineCount(input)}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder='<root><item id="1"><name>Test</name></item></root>'
              aria-label="Input XML"
              className={TEXT_PANE_BODY}
            />
          </TextPane>

          {output && (
            <TextPane
              tone="out"
              label="Output"
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
              <pre className={TEXT_PANE_BODY} aria-label="Formatted XML">{output}</pre>
            </TextPane>
          )}
        </TextPanes>

        {error && <ErrorMessage message={error} />}
      </div>

      <ToolAside
        footer={
          <ToolActions
            primaryLabel={mode === "format" ? "Format XML" : "Minify XML"}
            onPrimary={handleFormat}
            primaryDisabled={!input.trim()}
          />
        }
      >
        <ToolAsideSection label="MODE">
          <ToolChoice
            label="Output mode"
            fill
            value={mode}
            onChange={setMode}
            options={[
              { value: "format" as const, label: "Format" },
              { value: "minify" as const, label: "Minify" },
            ]}
          />
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
