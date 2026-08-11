"use client";

import { useCallback, useMemo, useState } from "react";
import { copyText } from "@/lib/utils/clipboard";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  lineCount,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";
import { cn } from "@/lib/utils/cn";

interface Stats {
  characters: number;
  charactersNoSpaces: number;
  words: number;
  sentences: number;
  paragraphs: number;
  readingTime: string;
}

function computeStats(text: string): Stats {
  const characters = text.length;
  const charactersNoSpaces = text.replace(/\s/g, "").length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const sentences = text.trim() ? (text.match(/[.!?]+\s|[.!?]+$/g) || []).length || (words > 0 ? 1 : 0) : 0;
  const paragraphs = text.trim() ? text.split(/\n\s*\n/).filter((p) => p.trim()).length || (words > 0 ? 1 : 0) : 0;

  const mins = Math.ceil(words / 225);
  const readingTime = mins < 1 ? "< 1 min" : `${mins} min`;

  return { characters, charactersNoSpaces, words, sentences, paragraphs, readingTime };
}

export function WordCounterUI() {
  const [input, setInput] = useState("");
  const [copied, setCopied] = useState(false);
  const stats = useMemo(() => computeStats(input), [input]);

  const handleCopy = useCallback(() => {
    copyText(input).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    });
  }, [input]);

  return (
    <>
      {/* ── Canvas: the text itself is the whole canvas here ─── */}
      <div className="min-w-0 space-y-[13px]">
        <TextPanes columns={1}>
          <TextPane label="Enter or paste your text" lines={lineCount(input)}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Start typing or paste your text here..."
              aria-label="Text to count"
              className={cn(TEXT_PANE_BODY, "min-h-[24rem] font-body text-[13px] leading-[1.7]")}
            />
          </TextPane>
        </TextPanes>

        <CanvasFootnote>COUNTED IN THIS TAB · NOTHING UPLOADED</CanvasFootnote>
      </div>

      {/* ── Controls: this tool has no settings, so the rail is
             the live readout plus the one action worth having. ─ */}
      <ToolAside
        footer={
          <ToolActions
            primaryLabel={copied ? "Copied to clipboard" : "Copy text"}
            onPrimary={handleCopy}
            primaryDisabled={!input}
            onReset={() => setInput("")}
            resetLabel="CLEAR"
          />
        }
      >
        <ToolAsideSection label="COUNTS">
          {/* Bigger than `ToolOutput` on purpose — these numbers are the product. */}
          <div className="flex flex-col gap-1.5">
            {[
              { label: "Characters", value: stats.characters },
              { label: "Characters (no spaces)", value: stats.charactersNoSpaces },
              { label: "Words", value: stats.words },
              { label: "Sentences", value: stats.sentences },
              { label: "Paragraphs", value: stats.paragraphs },
              { label: "Reading Time", value: stats.readingTime },
            ].map((stat) => (
              <div
                key={stat.label}
                className="flex items-baseline justify-between gap-3 rounded-lg border border-border bg-bg-secondary px-3 py-2"
              >
                <p className="text-xs text-text-muted">{stat.label}</p>
                <p className="text-2xl font-bold text-text-primary font-mono leading-none">
                  {stat.value}
                </p>
              </div>
            ))}
          </div>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Reading time assumes 225 words per minute.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
