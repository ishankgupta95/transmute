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
import { getToolBySlug } from "@/data/tools";
import { useCopied } from "@/hooks/useCopied";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { currentToolSlug } from "@/lib/utils/recent-outputs";
import {
  describeJsonFailure,
  describeYamlFailure,
  JSON_ACCEPT,
  jsonToYaml,
  KEY_KIND_LABEL,
  swapExtension,
  YAML_ACCEPT,
  yamlToJson,
  type Indent,
  type JsonToYamlResult,
  type LineWidth,
  type ParseFailure,
  type YamlToJsonResult,
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

/**
 * One component, two pages: `/yaml-to-json` and `/json-to-yaml`.
 *
 * They share a toolType because they share every control, every warning and
 * every line of parsing — the only thing that differs is which way round the
 * arrow points when the page opens. That is the `image-convert` /
 * `audio-convert` precedent (`src/data/tools.ts:62-71`), and a swap chip means
 * either URL gets you to either direction in one click.
 *
 * The seed is read off the REGISTRY rather than hard-coded against the two
 * slugs: whichever entry accepts `.json` is the page that opens on JSON → YAML.
 * A dev-tool client takes no props (`ToolClient.tsx` calls `<XClient />`), so
 * the slug comes from the URL.
 */
type Direction = "yaml-to-json" | "json-to-yaml";

function seedDirection(): Direction {
  if (typeof window === "undefined") return "yaml-to-json";
  const tool = getToolBySlug(currentToolSlug());
  return tool?.acceptFormats.includes(".json") ? "json-to-yaml" : "yaml-to-json";
}

/** See SubtitleConverterUI: a `<pre>` lays out every character it is handed. */
const PREVIEW_LIMIT = 40_000;

/** Named a few, counted the rest — a wall of literals helps nobody. */
function listSome(items: string[], limit = 4): string {
  if (items.length <= limit) return items.join(", ");
  return `${items.slice(0, limit).join(", ")} and ${items.length - limit} more`;
}

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/**
 * Everything the YAML → JSON trip changed, derived from the run. Empty when
 * nothing happened, so a clean file gets no reassuring list of zeroes.
 */
function yamlLossNotes(result: YamlToJsonResult): string[] {
  const notes: string[] = [];

  if (result.documents > 1) {
    notes.push(
      `This stream holds ${result.documents} YAML documents separated by ---, and JSON has no document separator. They are written out as a JSON array of ${result.documents} entries; reading only the first one back would silently drop the other ${result.documents - 1}.`,
    );
  }

  if (result.nonStringKeys.length > 0) {
    const n = result.nonStringKeys.length;
    const shown = listSome(
      result.nonStringKeys.map(
        (k) => `${k.source} (${KEY_KIND_LABEL[k.kind]}, line ${k.line}) → "${k.becomes}"`,
      ),
    );
    notes.push(
      `${n} mapping ${plural(n, "key")} in this file ${plural(n, "is", "are")} not a string, and a JSON object key can only be a string: ${shown}. A date key is the one to check — it is converted with the browser's local time zone and locale, so the same file converted on another machine produces a different key.`,
    );
  }

  if (result.aliasExpansions > 0) {
    const n = result.aliasExpansions;
    notes.push(
      `${n} ${plural(n, "alias")} (*name) ${plural(n, "was", "were")} expanded. YAML stores one node and points at it; JSON has no way to say that, so the node is written out again at every reference — a whole subtree if the anchor was on a mapping or a sequence, the value itself if it was on a plain scalar. The output is larger than the input by exactly that much, and editing one copy afterwards no longer changes the others.`,
    );
  }

  if (result.dates > 0) {
    const n = result.dates;
    notes.push(
      `${n} ${plural(n, "value")} ${plural(n, "was", "were")} read as a YAML timestamp and ${plural(n, "is", "are")} written as an ISO string with a time on it — 2026-01-01 becomes "2026-01-01T00:00:00.000Z". JSON has no date type, so it comes out as text either way.`,
    );
  }

  return notes;
}

/** The same, for JSON → YAML — the direction that cannot be lossless. */
function jsonLossNotes(result: JsonToYamlResult): string[] {
  const notes: string[] = [];

  if (result.changedNumbers.length > 0) {
    const n = result.changedNumbers.length;
    const shown = listSome(
      result.changedNumbers.map((x) => `${x.literal} → ${x.becomes} (line ${x.line})`),
    );
    notes.push(
      `${n} ${plural(n, "number")} in this file changed VALUE: ${shown}. Writing YAML means parsing the JSON first, and JavaScript holds every JSON number as a 64-bit float — about 17 significant digits, whether or not there is a decimal point. Integers run out of exactness at 9007199254740991, which is where Snowflake ids, Twitter ids and database bigints live, and a decimal with more digits than that is rounded the same way. Each arrow above is what you wrote against what the output file now says, character for character. If those digits matter, quote them in the source so they arrive as strings.`,
    );
  }

  if (result.duplicateKeys.length > 0) {
    const n = result.duplicateKeys.length;
    const shown = listSome(result.duplicateKeys.map((d) => `"${d.key}" (line ${d.line})`));
    notes.push(
      `${n} ${plural(n, "key")} ${plural(n, "is", "are")} written more than once in the same object: ${shown}. JSON parsing keeps the last one and discards the earlier value without an error, so that value is not in the YAML. YAML itself rejects a duplicate key outright, which is why this only bites in this direction.`,
    );
  }

  if (result.rewrittenNumbers.length > 0) {
    const n = result.rewrittenNumbers.length;
    const shown = listSome(
      result.rewrittenNumbers.map((x) => `${x.literal} → ${x.becomes}`),
    );
    notes.push(
      `${n} ${plural(n, "number")} ${plural(n, "is", "are")} spelled differently on the way out: ${shown}. Each pair was compared digit for digit as an exact decimal before it was put in this list, so the value really is the same one a program would read; only the characters differ, and a diff against a hand-written file will show them. Anything that failed that comparison is listed above as a changed value instead.`,
    );
  }

  return notes;
}

function failureLine(failure: ParseFailure): string {
  const where = failure.at ? ` — line ${failure.at.line}, column ${failure.at.column}` : "";
  return `${failure.message}${where}`;
}

export function YamlJsonConverterUI() {
  // Read once, on the first client render: the URL cannot change under a
  // mounted tool page, and re-reading it every render would make `swapped`
  // depend on `window` at render time.
  const [seed] = useState<Direction>(seedDirection);
  const [direction, setDirection] = useState<Direction>(seed);
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [file, setFile] = useState<File | null>(null);
  const [fileText, setFileText] = useState("");
  const [pasted, setPasted] = useState("");
  const [indent, setIndent] = useState<Indent>(2);
  const [lineWidth, setLineWidth] = useState<LineWidth>(80);
  const [readError, setReadError] = useState<string | null>(null);
  const { copied, copy } = useCopied();

  const toJson = direction === "yaml-to-json";
  const sourceText = mode === "paste" ? pasted : fileText;

  const run = useMemo((): {
    yaml: YamlToJsonResult | null;
    json: JsonToYamlResult | null;
    failure: ParseFailure | null;
  } => {
    if (!sourceText.trim()) return { yaml: null, json: null, failure: null };
    try {
      return toJson
        ? { yaml: yamlToJson(sourceText, indent), json: null, failure: null }
        : {
            yaml: null,
            json: jsonToYaml(sourceText, { indent, lineWidth }),
            failure: null,
          };
    } catch (err) {
      return {
        yaml: null,
        json: null,
        failure: toJson
          ? describeYamlFailure(err)
          : describeJsonFailure(err, sourceText),
      };
    }
  }, [sourceText, toJson, indent, lineWidth]);

  const outputText = toJson ? (run.yaml?.json ?? "") : (run.json?.yaml ?? "");
  const notes = run.yaml ? yamlLossNotes(run.yaml) : run.json ? jsonLossNotes(run.json) : [];

  const fileName = swapExtension(
    mode === "file" ? (file?.name ?? "data") : "data",
    toJson ? "json" : "yaml",
  );

  const blob = useMemo(
    () =>
      new Blob([outputText], {
        type: `${toJson ? "application/json" : "application/yaml"};charset=utf-8`,
      }),
    [outputText, toJson],
  );

  /*
    `text()` is async, so a slow read can resolve AFTER a second file has
    replaced it and hand the tool the wrong characters under the right name.
    Same token guard SubtitleConverterUI uses.
  */
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
  const swapped = direction !== seed;

  return (
    <>
      {/* ── Canvas: what came in, what goes out ─────────────────────── */}
      <div className={CANVAS_COLUMN}>
        {showDropZone ? (
          <DropZone
            accept={toJson ? YAML_ACCEPT : JSON_ACCEPT}
            onFiles={handleFiles}
            label={toJson ? "Drop a YAML file to begin" : "Drop a JSON file to begin"}
            acceptLabel={toJson ? "YAML YML" : "JSON"}
          />
        ) : (
          <>
            {mode === "file" && file && (
              <CanvasHeader
                file={file.name}
                meta={formatFileSize(file.size)}
                trailing={
                  run.yaml
                    ? `${run.yaml.documents} ${run.yaml.documents === 1 ? "DOCUMENT" : "DOCUMENTS"}`
                    : undefined
                }
              />
            )}

            {run.yaml?.cycle && (
              <ErrorMessage
                message={`This file has a cyclic anchor: the node at ${run.yaml.cycle} points back at one of its own parents. YAML can express that and JSON cannot — JSON.stringify throws "Converting circular structure to JSON" — so nothing was written. Break the loop, or use the YAML Formatter, which keeps the anchor.`}
              />
            )}
            {readError && <ErrorMessage message={readError} />}
            {run.failure && (
              <ErrorMessage
                message={`${toJson ? "YAML" : "JSON"} parse error: ${failureLine(run.failure)}. Nothing was converted — fix the source and the output returns.`}
              />
            )}
            {notes.length > 0 && <WarningMessage message={notes.join(" ")} />}

            <TextPanes columns={outputText ? 2 : 1}>
              <TextPane
                label={
                  mode === "paste"
                    ? `Paste your ${toJson ? "YAML" : "JSON"}`
                    : `Source · ${toJson ? "YAML" : "JSON"}`
                }
                lines={lineCount(sourceText)}
                size={formatFileSize(new Blob([sourceText]).size)}
              >
                {mode === "paste" ? (
                  <textarea
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    placeholder={
                      toJson
                        ? "name: transmute\nports:\n  - 8080\n  - 8443"
                        : '{"name": "transmute", "ports": [8080, 8443]}'
                    }
                    aria-label={`Paste your ${toJson ? "YAML" : "JSON"}`}
                    className={TEXT_PANE_BODY}
                  />
                ) : (
                  <pre
                    tabIndex={0}
                    role="region"
                    className={cn(TEXT_PANE_BODY, PANE_FOCUS)}
                    aria-label="Source text"
                  >
                    {sourcePreview}
                  </pre>
                )}
              </TextPane>

              {outputText && (
                <TextPane
                  tone="out"
                  label={toJson ? "JSON" : "YAML"}
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
                    aria-label="Converted output"
                  >
                    {preview}
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
          <ToolControl label="DIRECTION">
            <ToolChoice
              label="Conversion direction"
              value={direction}
              onChange={setDirection}
              options={[
                { value: "yaml-to-json" as const, label: "YAML → JSON" },
                { value: "json-to-yaml" as const, label: "JSON → YAML" },
              ]}
            />
            {swapped && (
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                Swapped. The ACCEPTS line at the top of the page describes the direction this
                URL opens on; the drop zone now takes{" "}
                <code className="font-mono text-[10.5px] text-neutral-300">
                  {toJson ? ".yaml, .yml" : ".json"}
                </code>{" "}
                instead.
              </span>
            )}
          </ToolControl>

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

          {!toJson && (
            <ToolControl label="LONG LINES">
              <ToolChoice
                label="Line width"
                value={lineWidth}
                onChange={setLineWidth}
                options={[
                  { value: 80 as const, label: "Wrap at 80" },
                  { value: 120 as const, label: "Wrap at 120" },
                  { value: -1 as const, label: "Never wrap" },
                ]}
              />
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                A long string past the limit is written as a folded block scalar, which reads
                back as the same string. Pick{" "}
                <span className="text-neutral-300">Never wrap</span> when a tool downstream
                compares the file line by line.
              </span>
            </ToolControl>
          )}
        </ToolControlGroup>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={
              toJson
                ? [
                    ["Documents in", run.yaml ? String(run.yaml.documents) : "—"],
                    [
                      "Keys quoted",
                      run.yaml ? String(run.yaml.nonStringKeys.length) : "—",
                    ],
                    ["Aliases expanded", run.yaml ? String(run.yaml.aliasExpansions) : "—"],
                    ["Timestamps", run.yaml ? String(run.yaml.dates) : "—"],
                  ]
                : [
                    [
                      "Numbers changed",
                      run.json ? String(run.json.changedNumbers.length) : "—",
                    ],
                    [
                      "Numbers respelled",
                      run.json ? String(run.json.rewrittenNumbers.length) : "—",
                    ],
                    [
                      "Duplicate keys",
                      run.json ? String(run.json.duplicateKeys.length) : "—",
                    ],
                    ["Out", outputText ? `${outputText.length} chars` : "—"],
                  ]
            }
          />
        </ToolAsideSection>

        <ToolAsideSection label="WHAT CHANGES">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Comments do not survive in either direction. JSON has no comment syntax at all, and
            the YAML parser here throws them away as it reads, so there is nothing left to write
            back — the same is true of blank lines and of the order you wrote a flow mapping in.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {toJson
              ? "Anchors are expanded, timestamps become ISO strings, and non-string keys are quoted — each one is counted above and spelled out on the canvas when it happens. An anchor on a plain value has no anchor left to count in the output: it is written out again as the value. A cyclic anchor stops the conversion instead of throwing."
              : "This direction parses the JSON before it can write anything, and that parse is where long numbers, trailing zeroes and duplicate keys are lost. A literal is only called a respelling once it has been compared against the output digit for digit; anything that lost a digit is counted as a changed value instead. Every one of them is found in the raw text first and reported above, before you download."}
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Nothing is uploaded. The file is read, parsed and written in this tab.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
