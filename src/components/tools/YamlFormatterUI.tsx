"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { DropZone } from "@/components/tools/DropZone";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import {
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  CanvasHeader,
  lineCount,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { formatFileSize } from "@/lib/utils/file-helpers";
import {
  describeYamlFailure,
  formatYaml,
  KEY_KIND_LABEL,
  swapExtension,
  YAML_ACCEPT,
  type Indent,
  type LineWidth,
  type ParseFailure,
  type YamlFormatResult,
} from "@/lib/tools/yaml-tools";
import { cn } from "@/lib/utils/cn";

/**
 * Focus ring for the keyboard-focusable text panes below. It cannot live in
 * `TEXT_PANE_BODY` today, and it needs `outline-solid` of its own:
 * `TEXT_PANE_BODY` ends in `focus:outline-none`, which sets
 * `--tw-outline-style: none`, and a bare `focus-visible:outline-2` resolves
 * its style from that same variable — so the ring would compile to nothing.
 */
const PANE_FOCUS =
  "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent";

/** See SubtitleConverterUI: a `<pre>` lays out every character it is handed. */
const PREVIEW_LIMIT = 40_000;

function listSome(items: string[], limit = 4): string {
  if (items.length <= limit) return items.join(", ");
  return `${items.slice(0, limit).join(", ")} and ${items.length - limit} more`;
}

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/**
 * What the re-write changed, derived from the run.
 *
 * This is a parse and a re-emit, not a text tidy, so several things about the
 * SOURCE do not come back. The ones that can be counted are counted here; the
 * ones that cannot (comments, blank lines, quoting style) are stated once in
 * the rail rather than dressed up as a number.
 */
function formatNotes(result: YamlFormatResult, sorted: boolean): string[] {
  const notes: string[] = [];

  if (result.documents > 1) {
    notes.push(
      `${result.documents} documents were read and written back separated by ---, in the order they arrived.`,
    );
  }

  if (result.nonStringKeys.length > 0) {
    const n = result.nonStringKeys.length;
    const shown = listSome(
      result.nonStringKeys.map(
        (k) => `${k.source} (${KEY_KIND_LABEL[k.kind]}, line ${k.line}) → ${k.becomes}`,
      ),
    );
    notes.push(
      `${n} mapping ${plural(n, "key")} ${plural(n, "is", "are")} not a string, and js-yaml turns every key into one as it reads: ${shown}. A number or boolean key comes back quoted, which changes its type. A DATE key is worse — it is rendered through the browser's local time zone and locale, so it comes back as a sentence and will not round-trip. Check those before you save over the original.`,
    );
  }

  if (result.anchoredNodes > 0) {
    const n = result.anchoredNodes;
    notes.push(
      `${n} ${plural(n, "node")} ${plural(n, "is", "are")} referenced more than once. The structure survives — js-yaml re-emits ${plural(n, "it", "them")} as an anchor — but the anchor NAME does not: &whatever-you-called-it comes back as &ref_0, &ref_1 and so on.`,
    );
  }

  if (result.expandedAliases > 0) {
    const n = result.expandedAliases;
    notes.push(
      `${n} ${plural(n, "alias")} (*name) ${plural(n, "points", "point")} at a plain value rather than a mapping or a sequence, and js-yaml only writes an anchor for a shared mapping or sequence. So ${plural(n, "that one is", "those are")} not re-anchored — the value is written out again in ${plural(n, "its", "their")} place and both &name and *name are gone from the output. Nothing about what the file MEANS changes, but the link does: editing one copy afterwards no longer changes the other.`,
    );
  }

  if (result.cycle) {
    notes.push(
      `One node points back at a parent (${result.cycle}). YAML can hold that and it is written back as an anchor, so the file still round-trips — but converting this file to JSON cannot work at all.`,
    );
  }

  if (result.dates > 0) {
    const n = result.dates;
    notes.push(
      `${n} ${plural(n, "value")} ${plural(n, "was", "were")} read as a timestamp and ${plural(n, "is", "are")} written back in full ISO form with a time and a Z, even where the source wrote only a date.`,
    );
  }

  if (sorted) {
    notes.push(
      `Keys are sorted alphabetically at every level. That is a real edit to the file, not a display option — the order you wrote is not recoverable from the output.`,
    );
  }

  return notes;
}

export function YamlFormatterUI() {
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [file, setFile] = useState<File | null>(null);
  const [fileText, setFileText] = useState("");
  const [pasted, setPasted] = useState("");
  const [indent, setIndent] = useState<Indent>(2);
  const [lineWidth, setLineWidth] = useState<LineWidth>(80);
  const [sortKeys, setSortKeys] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const { copied, copy } = useCopied();

  const sourceText = mode === "paste" ? pasted : fileText;

  const run = useMemo((): {
    result: YamlFormatResult | null;
    failure: ParseFailure | null;
  } => {
    if (!sourceText.trim()) return { result: null, failure: null };
    try {
      return {
        result: formatYaml(sourceText, { indent, sortKeys, lineWidth }),
        failure: null,
      };
    } catch (err) {
      return { result: null, failure: describeYamlFailure(err) };
    }
  }, [sourceText, indent, sortKeys, lineWidth]);

  const { result, failure } = run;
  const outputText = result?.yaml ?? "";
  const notes = result ? formatNotes(result, sortKeys) : [];

  const fileName = swapExtension(mode === "file" ? (file?.name ?? "config") : "config", "yaml");

  const blob = useMemo(
    () => new Blob([outputText], { type: "application/yaml;charset=utf-8" }),
    [outputText],
  );

  /* Async read, same stale-token guard SubtitleConverterUI uses. */
  const loadToken = useRef(0);

  const handleFiles = useCallback(async (files: File[]) => {
    const picked = files[0];
    if (!picked) return;
    const token = ++loadToken.current;
    setReadError(null);
    setFile(picked);
    setFileText("");
    try {
      const text = await picked.text();
      if (loadToken.current !== token) return;
      setFileText(text);
    } catch {
      if (loadToken.current !== token) return;
      setReadError("This file could not be read from disk.");
    }
  }, []);

  const handleReset = useCallback(() => {
    loadToken.current++;
    setFile(null);
    setFileText("");
    setReadError(null);
  }, []);

  const handleCopy = useCallback(() => {
    void copy(outputText);
  }, [copy, outputText]);

  const preview =
    outputText.length > PREVIEW_LIMIT ? outputText.slice(0, PREVIEW_LIMIT) : outputText;
  const sourcePreview =
    sourceText.length > PREVIEW_LIMIT ? sourceText.slice(0, PREVIEW_LIMIT) : sourceText;

  const showDropZone = mode === "file" && !file;

  return (
    <>
      {/* ── Canvas ──────────────────────────────────────────────────── */}
      <div className={CANVAS_COLUMN}>
        {showDropZone ? (
          <DropZone
            accept={YAML_ACCEPT}
            onFiles={handleFiles}
            label="Drop a YAML file to check and re-format"
            acceptLabel="YAML YML"
          />
        ) : (
          <>
            {mode === "file" && file && (
              <CanvasHeader
                file={file.name}
                meta={formatFileSize(file.size)}
                trailing={
                  result
                    ? `VALID · ${result.documents} ${result.documents === 1 ? "DOCUMENT" : "DOCUMENTS"}`
                    : failure
                      ? "INVALID"
                      : undefined
                }
              />
            )}

            {readError && <ErrorMessage message={readError} />}
            {failure && (
              <ErrorMessage
                message={`This is not valid YAML: ${failure.message}${
                  failure.at ? ` — line ${failure.at.line}, column ${failure.at.column}` : ""
                }. Nothing was re-written; the source is shown unchanged on the left.`}
              />
            )}
            {notes.length > 0 && <WarningMessage message={notes.join(" ")} />}

            <TextPanes columns={outputText || failure ? 2 : 1}>
              <TextPane
                label={mode === "paste" ? "Paste your YAML" : "Source · YAML"}
                lines={lineCount(sourceText)}
                size={formatFileSize(new Blob([sourceText]).size)}
              >
                {mode === "paste" ? (
                  <textarea
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    placeholder={"name: transmute\nports:\n  - 8080\n  - 8443"}
                    aria-label="Paste your YAML"
                    className={TEXT_PANE_BODY}
                  />
                ) : (
                  <pre
                    tabIndex={0}
                    role="region"
                    className={cn(TEXT_PANE_BODY, PANE_FOCUS)}
                    aria-label="Source YAML"
                  >
                    {sourcePreview}
                  </pre>
                )}
              </TextPane>

              {outputText && (
                <TextPane
                  tone="out"
                  label="Formatted YAML"
                  lines={lineCount(outputText)}
                  size={formatFileSize(blob.size)}
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
                  <pre
                    tabIndex={0}
                    role="region"
                    className={cn(TEXT_PANE_BODY, PANE_FOCUS)}
                    aria-label="Formatted YAML"
                  >
                    {preview}
                  </pre>
                </TextPane>
              )}

              {/*
                js-yaml prints its own excerpt with the offending column marked,
                which is more precise than anything reconstructed from a byte
                offset — so the failure pane shows the parser's snippet verbatim.
              */}
              {!outputText && failure && (
                <TextPane
                  label="✕ Parse error"
                  action={
                    failure.at && (
                      <span className="text-error">
                        LINE {failure.at.line} · COL {failure.at.column}
                      </span>
                    )
                  }
                >
                  <pre
                    tabIndex={0}
                    role="region"
                    className={cn(TEXT_PANE_BODY, PANE_FOCUS)}
                    aria-label="Parser output"
                  >
                    {failure.snippet ?? failure.message}
                  </pre>
                </TextPane>
              )}
            </TextPanes>

            {outputText.length > PREVIEW_LIMIT && (
              <CanvasFootnote>
                PREVIEWING THE FIRST {PREVIEW_LIMIT.toLocaleString()} OF{" "}
                {outputText.length.toLocaleString()} CHARACTERS — COPY AND DOWNLOAD CARRY ALL
                OF IT
              </CanvasFootnote>
            )}
          </>
        )}
      </div>

      {/* ── Rail ────────────────────────────────────────────────────── */}
      <ToolAside
        footer={
          <>
            {outputText && (
              <DownloadButton blob={blob} fileName={fileName} className="w-full justify-center" />
            )}
            {mode === "file" && file && <ToolResetLink onClick={handleReset} label="CHANGE FILE" />}
          </>
        }
      >
        <ToolControlGroup>
          <ToolControl label="SOURCE">
            <ToolChoice
              label="Input source"
              value={mode}
              onChange={setMode}
              options={[
                { value: "file" as const, label: "File" },
                { value: "paste" as const, label: "Paste" },
              ]}
            />
          </ToolControl>

          <ToolControl label="INDENT">
            <ToolChoice
              label="Indent width"
              value={indent}
              onChange={setIndent}
              options={[
                { value: 2 as const, label: "2 spaces" },
                { value: 4 as const, label: "4 spaces" },
              ]}
            />
          </ToolControl>

          <ToolControl label="LINE WIDTH">
            <ToolChoice
              label="Line width"
              value={lineWidth}
              onChange={setLineWidth}
              options={[
                { value: 80 as const, label: "80" },
                { value: 120 as const, label: "120" },
                { value: -1 as const, label: "Never wrap" },
              ]}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              A string longer than the limit is written as a folded block scalar over several
              lines. It reads back as the same string, but a line-by-line diff against the
              original will show it.
            </span>
          </ToolControl>

          <ToolControl label="KEY ORDER">
            <label className="flex cursor-pointer items-center gap-2.5 font-body text-[12.5px] text-neutral-300">
              <input
                type="checkbox"
                checked={sortKeys}
                onChange={(e) => setSortKeys(e.target.checked)}
                className="size-4 rounded-sm border-border accent-accent"
              />
              Sort keys alphabetically
            </label>
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              Off by default. Sorting makes two hand-edited copies of the same file comparable,
              and it permanently loses the order the author chose — a Compose file reads worse
              with{" "}
              <code className="font-mono text-[10.5px] text-neutral-300">image</code> after{" "}
              <code className="font-mono text-[10.5px] text-neutral-300">environment</code>.
            </span>
          </ToolControl>
        </ToolControlGroup>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Valid", sourceText.trim() ? (failure ? "No" : "Yes") : "—"],
              ["Documents", result ? String(result.documents) : "—"],
              ["Keys retyped", result ? String(result.nonStringKeys.length) : "—"],
              ["Re-anchored", result ? String(result.anchoredNodes) : "—"],
            ]}
          />
        </ToolAsideSection>

        <ToolAsideSection label="WHAT CHANGES">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            This is a parse and a re-write, not a whitespace tidy: the file is read into values
            and printed again by js-yaml. So the output is valid YAML that means exactly what the
            input meant — and several things about the TEXT do not survive.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Comments are gone. The parser discards them as it reads and never records where they
            were, so there is nothing to write back. Blank lines go the same way, and so does
            your choice of quotes: js-yaml quotes a string only when the value would otherwise
            change meaning, which is why{" "}
            <code className="font-mono text-[10.5px] text-neutral-300">yes</code> and{" "}
            <code className="font-mono text-[10.5px] text-neutral-300">no</code> come back as{" "}
            <code className="font-mono text-[10.5px] text-neutral-300">&apos;yes&apos;</code> and{" "}
            <code className="font-mono text-[10.5px] text-neutral-300">&apos;no&apos;</code> —
            unquoted, YAML 1.1 would read them as booleans.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            A merge key (<code className="font-mono text-[10.5px] text-neutral-300">&lt;&lt;: *base</code>
            ) is resolved as it is read, so the merged keys are written out in place and the
            merge itself is gone. An anchor on a plain value goes the same way: only a shared
            mapping or sequence gets an anchor back, so{" "}
            <code className="font-mono text-[10.5px] text-neutral-300">&amp;tag &quot;1.24&quot;</code>{" "}
            is written out as the value at every use and the anchor disappears. That one is not
            in the Re-anchored count, because it is not re-anchored — it is named in the warning
            above the panes instead. Nothing is uploaded: the file is read, parsed and written
            in this tab.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
