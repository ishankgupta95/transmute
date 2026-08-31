"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { DropZone } from "./DropZone";
import { ErrorMessage } from "./ErrorMessage";
import { PrintFrame } from "./markdown-pdf/PrintFrame";
import { renderMarkdown, type MarkdownPdfTheme, type MarkdownPdfFont } from "@/lib/tools/markdown-to-pdf";
import { buildPrintHtml } from "@/lib/tools/markdown-pdf-print-css";
import { cn } from "@/lib/utils/cn";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
} from "@/components/tools/ToolAside";
import {
  lineCount,
  StatStrip,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup, ToolProgress } from "@/components/tools/ToolControls";
import { chipClass, CANVAS_COLUMN } from "@/components/workspace/shared";
import { formatFileSize } from "@/lib/utils/file-helpers";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

const SAMPLE_MARKDOWN = `# Hello, Markdown

A short paragraph with **bold**, *italic*, and \`inline code\`.

## Code block

\`\`\`ts
type User = { id: string; name: string };

export function greet(user: User) {
  return \`Hello, \${user.name}!\`;
}
\`\`\`

## Tables

| Tool | Output | Bytes |
| --- | --- | ---: |
| Markdown to PDF | PDF | ~80 KB |
| Markdown to HTML | HTML | ~4 KB |

## Task list

- [x] Install Shiki
- [x] Wire print iframe
- [ ] Sip coffee

> "Typography is the craft of endowing human language with a durable visual form." — Robert Bringhurst
`;

type Mode = "paste" | "upload";

export function MarkdownToPdfUI() {
  const [mode, setMode] = useState<Mode>("paste");
  const [markdown, setMarkdown] = useState("");
  const [theme, setTheme] = useState<MarkdownPdfTheme>("light");
  const [font, setFont] = useState<MarkdownPdfFont>("serif");
  const [previewHtml, setPreviewHtml] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [exportingHtml, setExportingHtml] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced live preview — re-render on markdown / theme / font change.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    let cancelled = false;
    debounceRef.current = setTimeout(async () => {
      if (!markdown.trim()) {
        if (!cancelled) setPreviewHtml("");
        return;
      }
      try {
        const html = await renderMarkdown(markdown, { theme, font });
        if (!cancelled) setPreviewHtml(html);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to render preview");
        }
      }
    }, 200);
    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [markdown, theme, font]);

  const handleFiles = useCallback(async (files: File[]) => {
    setError(null);
    const file = files[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Limit is 10 MB.`);
      return;
    }
    const name = file.name.toLowerCase();
    const okType =
      name.endsWith(".md") ||
      name.endsWith(".markdown") ||
      name.endsWith(".txt") ||
      file.type === "text/markdown" ||
      file.type === "text/plain" ||
      file.type === "";
    if (!okType) {
      setError("Unsupported file type. Upload a .md, .markdown, or .txt file.");
      return;
    }
    try {
      const text = await file.text();
      setMarkdown(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read file");
    }
  }, []);

  const handleExport = useCallback(async () => {
    setError(null);
    if (!markdown.trim()) return;
    setStatus("Preparing PDF…");
    try {
      const html = await renderMarkdown(markdown, { theme, font });
      const doc = buildPrintHtml({
        bodyHtml: html,
        title: deriveTitle(markdown),
        theme,
        font,
      });
      setExportingHtml(doc);
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : "Failed to render PDF");
    }
  }, [markdown, theme, font]);

  const handlePrintDone = useCallback(() => {
    setExportingHtml(null);
    setStatus(null);
  }, []);

  const previewBackground = theme === "dark" ? "bg-[#1a1814]" : "bg-[#fdfdfb]";
  const previewText = theme === "dark" ? "text-[#f0eee8]" : "text-[#1f1d1a]";

  const exportDisabled = useMemo(() => !markdown.trim(), [markdown]);

  return (
    <>
      {/* ── Canvas: source on the left, live preview on the right ── */}
      <div className={CANVAS_COLUMN}>
        {mode === "upload" && (
          <DropZone
            accept=".md,.markdown,.txt,text/markdown"
            onFiles={handleFiles}
            label="Upload a Markdown or text file"
          />
        )}

        {/*
          This tool was the one text tool still drawing its own two columns of
          `rounded-lg` textareas. It is the doc's two-up IN / OUT archetype —
          same plate, same 32px mono pane headers with a LINES count, same
          hairline seam — so it now uses the shared primitive like every other
          text tool. `TextPanes` carries `STAGE_GROW`, which is also what lets
          the editor take the canvas column's leftover height instead of
          naming its own `calc(100vh - 24rem)`.
        */}
        <TextPanes>
          <TextPane
            label="Markdown source"
            lines={lineCount(markdown)}
            size={formatFileSize(new Blob([markdown]).size)}
          >
            <textarea
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              placeholder={mode === "paste" ? SAMPLE_MARKDOWN : undefined}
              className={TEXT_PANE_BODY}
              aria-label={
                mode === "upload"
                  ? "Uploaded Markdown content (editable)"
                  : "Markdown source"
              }
            />
          </TextPane>

          <TextPane
            tone="out"
            label="Preview"
            lines={lineCount(markdown)}
            size={formatFileSize(new Blob([markdown]).size)}
          >
            {/*
              The preview keeps its own light/dark ground on purpose: it is a
              proof of the PDF, not a pane of app chrome.
            */}
            <div
              className={cn(
                "prose prose-sm min-h-[12rem] max-w-none flex-1 overflow-auto p-6",
                previewBackground,
                previewText,
                theme === "dark" ? "prose-invert" : "",
              )}
              data-testid="markdown-pdf-preview"
              dangerouslySetInnerHTML={{
                __html:
                  previewHtml ||
                  '<p class="text-text-muted italic">Your rendered Markdown will appear here. Type or paste on the left to start.</p>',
              }}
            />
          </TextPane>
        </TextPanes>

        <StatStrip
          stats={[
            { label: "WORDS", value: String(markdown.trim() ? markdown.trim().split(/\s+/).length : 0), tone: "neutral" },
            { label: "LINES", value: String(markdown ? markdown.split("\n").length : 0), tone: "neutral" },
            { label: "THEME", value: theme.toUpperCase() },
            { label: "FONT", value: font.toUpperCase(), tone: "ok" },
          ]}
        />

        <ErrorMessage message={error} />

        {exportingHtml && <PrintFrame html={exportingHtml} onDone={handlePrintDone} />}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {/* The doc pins the running readout ABOVE the primary, as a mono
                split row — not a centred sentence under the canvas. There is
                no measurable percentage here (the browser's own print dialog
                does the rest), so the right-hand slot says WORKING rather
                than inventing one. */}
            {status && <ToolProgress phase="PREPARING PDF" percent={null} label={status} />}
            <ToolActions
              primaryLabel="Export to PDF"
              onPrimary={handleExport}
              primaryDisabled={exportDisabled || exportingHtml !== null}
            />
          </>
        }
      >
        {/* One bordered block for the whole control set — the doc gives its
            own rule only to START FROM, ADVANCED and OUTPUT. */}
        <ToolControlGroup>
          <ToolControl label="SOURCE">
            <ModeTabs mode={mode} onChange={setMode} />
          </ToolControl>

          <ToolControl label="THEME">
            <ToolChoice
              label="Theme"
              fill
              value={theme}
              onChange={(v) => setTheme(v as MarkdownPdfTheme)}
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
            />
          </ToolControl>

          <ToolControl label="FONT">
            <ToolChoice
              label="Font"
              fill
              value={font}
              onChange={(v) => setFont(v as MarkdownPdfFont)}
              options={[
                { value: "serif", label: "Serif" },
                { value: "sans", label: "Sans" },
              ]}
            />
          </ToolControl>
        </ToolControlGroup>

        <ToolAsideSection label="EXPORT">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Your browser&rsquo;s print dialog opens — pick &ldquo;Save as PDF&rdquo; as the
            destination. Firefox users: turn on &ldquo;Print backgrounds&rdquo; in the dialog so
            the code-block tints render.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}

/*
  The doc has no filled segmented control — its selected state is an accent
  outline over a 12% tint, which is exactly `chipClass`. This was the last
  `bg-accent-muted` fill left in the dev family, on a plate the doc does not
  draw. The tablist roles stay: they are the honest semantics for two views of
  one input, and the E2E and unit suites address the buttons by them.
*/
/** The doc's choice chip: `padding:7px 4px;border-radius:6px;font:500 11.5px/1`. */
const CHIP = "flex-1 rounded-[6px] px-3 py-[7px] text-[11.5px]";

function ModeTabs({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="flex gap-[5px]" role="tablist" aria-label="Input mode">
      <button
        type="button"
        role="tab"
        aria-selected={mode === "paste"}
        onClick={() => onChange("paste")}
        className={chipClass(mode === "paste", cn(CHIP, mode !== "paste" && "text-text-muted"))}
      >
        <FileText size={13} aria-hidden="true" className="mr-1.5 inline align-[-2px]" />
        Paste markdown
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "upload"}
        onClick={() => onChange("upload")}
        className={chipClass(mode === "upload", cn(CHIP, mode !== "upload" && "text-text-muted"))}
      >
        Upload .md
      </button>
    </div>
  );
}

/** Pull the first H1 (or filename-friendly chunk) for the print doc <title>. */
function deriveTitle(md: string): string {
  const h1 = md.match(/^#\s+(.+?)\s*$/m);
  if (h1?.[1]) return h1[1].trim().slice(0, 100);
  return "Markdown Document";
}
