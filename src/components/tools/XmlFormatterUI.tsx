"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
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
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { formatFileSize } from "@/lib/utils/file-helpers";

export function XmlFormatterUI() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"format" | "minify">("format");
  const { copied, copy } = useCopied();

  /*
    Takes its inputs as parameters so the MODE chip can re-run it immediately,
    the way JsonFormatterUI already does. Flipping to Minify used to leave the
    pretty-printed output on screen under a lit "Minify" chip — a claim the
    control no longer backed.
  */
  const runFormat = useCallback((text: string, m: "format" | "minify") => {
    setError("");
    setOutput("");
    if (!text.trim()) return;
    try {
      setOutput(m === "format" ? formatXml(text) : minifyXml(text));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid XML");
    }
  }, []);

  const handleCopy = useCallback(() => {
    void copy(output);
  }, [copy, output]);

  return (
    <>
      {/* ── Canvas: the doc's two-up IN / OUT panes ────────── */}
      <div className={CANVAS_COLUMN}>
        <TextPanes columns={output ? 2 : 1}>
          <TextPane
            label="Input XML"
            lines={lineCount(input)}
            size={formatFileSize(new Blob([input]).size)}
          >
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
            onPrimary={() => runFormat(input, mode)}
            primaryDisabled={!input.trim()}
          />
        }
      >
        <ToolAsideSection label="MODE">
          <ToolChoice
            label="Output mode"
            fill
            value={mode}
            onChange={(m) => {
              setMode(m);
              runFormat(input, m);
            }}
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
