"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Printer } from "lucide-react";
import { DropZone } from "./DropZone";
import { ErrorMessage } from "./ErrorMessage";
import { StatusMessage } from "./StatusMessage";
import { PrintFrame } from "./markdown-pdf/PrintFrame";
import { renderMarkdown, type MarkdownPdfTheme, type MarkdownPdfFont } from "@/lib/tools/markdown-to-pdf";
import { buildPrintHtml } from "@/lib/tools/markdown-pdf-print-css";
import { cn } from "@/lib/utils/cn";

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
    <div className="space-y-4">
      {/* Mode + style toolbar */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <ModeTabs mode={mode} onChange={setMode} />
        <span aria-hidden="true" className="hidden sm:inline text-text-muted">·</span>
        <SegmentedControl
          label="Theme"
          value={theme}
          onChange={(v) => setTheme(v as MarkdownPdfTheme)}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
        <SegmentedControl
          label="Font"
          value={font}
          onChange={(v) => setFont(v as MarkdownPdfFont)}
          options={[
            { value: "serif", label: "Serif" },
            { value: "sans", label: "Sans" },
          ]}
        />
      </div>

      {/* Two-column input + preview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="flex flex-col gap-3">
          {mode === "upload" ? (
            <>
              <DropZone
                accept=".md,.markdown,.txt,text/markdown"
                onFiles={handleFiles}
                label="Upload a Markdown or text file"
              />
              {markdown && (
                <textarea
                  value={markdown}
                  onChange={(e) => setMarkdown(e.target.value)}
                  rows={14}
                  className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono resize-y"
                  aria-label="Uploaded Markdown content (editable)"
                />
              )}
            </>
          ) : (
            <textarea
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              placeholder={SAMPLE_MARKDOWN}
              rows={20}
              className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono resize-y placeholder:text-text-muted min-h-[28rem]"
              aria-label="Markdown source"
            />
          )}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm text-text-secondary">Preview</span>
          <div
            className={cn(
              "w-full rounded-lg border border-border p-6 prose prose-sm max-w-none min-h-[28rem] overflow-y-auto",
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
        </div>
      </div>

      <ErrorMessage message={error} />

      <div className="flex flex-col gap-2 items-center pt-1">
        <button
          type="button"
          onClick={handleExport}
          disabled={exportDisabled || exportingHtml !== null}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-bg-primary transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary disabled:opacity-50 disabled:cursor-not-allowed min-h-11"
        >
          <Printer size={16} aria-hidden="true" />
          Export to PDF
        </button>
        {status && <StatusMessage>{status}</StatusMessage>}
        <p className="text-xs text-text-muted text-center max-w-md leading-relaxed">
          Your browser&rsquo;s print dialog opens — pick &ldquo;Save as PDF&rdquo; as the destination. Firefox users:
          turn on &ldquo;Print backgrounds&rdquo; in the dialog so the code-block tints render.
        </p>
      </div>

      {exportingHtml && <PrintFrame html={exportingHtml} onDone={handlePrintDone} />}
    </div>
  );
}

function ModeTabs({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="inline-flex items-center rounded-md border border-border bg-bg-elevated p-0.5" role="tablist" aria-label="Input mode">
      <button
        type="button"
        role="tab"
        aria-selected={mode === "paste"}
        onClick={() => onChange("paste")}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-xs font-medium transition-colors min-h-9",
          mode === "paste"
            ? "bg-accent-muted text-accent"
            : "text-text-muted hover:text-text-secondary",
        )}
      >
        <FileText size={13} aria-hidden="true" /> Paste markdown
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "upload"}
        onClick={() => onChange("upload")}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-xs font-medium transition-colors min-h-9",
          mode === "upload"
            ? "bg-accent-muted text-accent"
            : "text-text-muted hover:text-text-secondary",
        )}
      >
        Upload .md
      </button>
    </div>
  );
}

interface SegmentedControlProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}

function SegmentedControl({ label, value, onChange, options }: SegmentedControlProps) {
  return (
    <div className="inline-flex items-center gap-2">
      <span className="text-xs text-text-muted">{label}</span>
      <div className="inline-flex rounded-md border border-border bg-bg-elevated p-0.5" role="group" aria-label={label}>
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={value === opt.value}
            className={cn(
              "rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors",
              value === opt.value
                ? "bg-accent-muted text-accent"
                : "text-text-muted hover:text-text-secondary",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Pull the first H1 (or filename-friendly chunk) for the print doc <title>. */
function deriveTitle(md: string): string {
  const h1 = md.match(/^#\s+(.+?)\s*$/m);
  if (h1?.[1]) return h1[1].trim().slice(0, 100);
  return "Markdown Document";
}
