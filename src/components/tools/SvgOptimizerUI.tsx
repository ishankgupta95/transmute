"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { diffLines } from "diff";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { DropZone } from "@/components/tools/DropZone";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
  ToolPresets,
  ToolResetLink,
  ToolSlider,
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  CanvasHeader,
  lineCount,
  StatStrip,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN, MONO_LABEL } from "@/components/workspace/shared";
import { getToolBySlug } from "@/data/tools";
import { useCopied } from "@/hooks/useCopied";
import { cn } from "@/lib/utils/cn";
import { formatFileSize } from "@/lib/utils/file-helpers";
import {
  AUTO_OPTIMIZE_LIMIT,
  DEFAULT_SETTINGS,
  MAX_PRECISION,
  MIN_PRECISION,
  OPT_IN_GROUP_LABEL,
  OPT_IN_LABELS,
  RISKY_DEFAULT_PLUGINS,
  SVG_PRESETS,
  SvgOptimizeError,
  decodeSvgBytes,
  encodingNote,
  indentSvg,
  lossNotes,
  optimizeSvg,
  optimizedFileName,
  payloadNotes,
  presetIdFor,
  settingsKey,
  utf8Bytes,
  type DecodedSvg,
  type RiskyPluginId,
  type SvgOptimizeResult,
  type SvgOptimizeSettings,
} from "@/lib/tools/svg-optimize";

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
 * How much of either pane is drawn. An icon is a few hundred bytes and a map
 * export is megabytes, and a `<pre>` lays out every character it is handed.
 * The copy button and the download carry the whole file either way, and the
 * footnote says so whenever the cap bites.
 */
const PREVIEW_LIMIT = 40_000;

/*
  The whole file is parsed into a node tree and rewritten synchronously in this
  tab, so this zone may not print the absolute "NO SIZE CAP" — the registry
  entry's own block carries the reasoning. Read off the registry rather than
  retyped, exactly as HashGeneratorUI does, so the spec row on the page and the
  line under the zone cannot drift apart.

  `size-claims.test.ts` does NOT require this note (the whole-file scan there
  is narrower: it wants a `@/lib/workers/*-client` handoff, and there is none
  here). It DOES check that the slug named below still carries a note, so
  deleting `practicalLimitNote` from the registry goes red rather than quietly
  putting "NO SIZE CAP" back on the page.
*/
const PRACTICAL_LIMIT_NOTE = getToolBySlug("svg-optimizer")?.practicalLimitNote;

/**
 * The diff is a second full parse plus a line-by-line comparison, so it is
 * capped lower than the panes. Past this the side-by-side view is still there.
 */
const DIFF_LIMIT = 60_000;

/** Ruled band under the checkbox rows, matching `ToolAdvanced`'s drawer. */
const DRAWER =
  "-mx-4 flex animate-tm-drawer flex-col gap-3.5 border-t border-border bg-text-primary/3 px-4 py-3.5 motion-reduce:animate-none";

const HINT = "font-body text-[10.5px] leading-[1.5] text-text-muted";
const CHECK_ROW = "flex cursor-pointer items-start gap-2.5 font-body text-[12.5px] text-neutral-300";
const CHECK_BOX = "mt-px size-4 shrink-0 rounded-sm border-border accent-accent";

export function SvgOptimizerUI() {
  const [file, setFile] = useState<File | null>(null);
  const [decoded, setDecoded] = useState<DecodedSvg | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  const [precision, setPrecision] = useState(DEFAULT_SETTINGS.precision);
  const [disabled, setDisabled] = useState<readonly RiskyPluginId[]>(DEFAULT_SETTINGS.disabled);
  const [removeScripts, setRemoveScripts] = useState(DEFAULT_SETTINGS.removeScripts);
  const [removeEmbeddedImages, setRemoveEmbeddedImages] = useState(
    DEFAULT_SETTINGS.removeEmbeddedImages,
  );
  const [removeDimensions, setRemoveDimensions] = useState(DEFAULT_SETTINGS.removeDimensions);

  const [view, setView] = useState<"panes" | "diff">("panes");
  /*
    The settings the user last pressed OPTIMISE SVG for. Only consulted for a
    file too big to re-run live: below the ceiling the run happens on every
    change and this is ignored.
  */
  const [approved, setApproved] = useState<string | null>(null);
  const { copied, copy } = useCopied();

  const settings = useMemo<SvgOptimizeSettings>(
    () => ({ precision, disabled, removeScripts, removeEmbeddedImages, removeDimensions }),
    [precision, disabled, removeScripts, removeEmbeddedImages, removeDimensions],
  );
  const key = settingsKey(settings);
  const preset = presetIdFor(settings);

  const source = decoded?.text ?? "";
  const sourceBytes = useMemo(() => (source ? utf8Bytes(source) : 0), [source]);
  /*
    `optimize` is synchronous, so the tab is frozen while it runs. Measured on
    this build: 313 KB took 113 ms and 1.88 MB took just over a second. A range
    input fires an event per pixel of travel, so past the ceiling the run waits
    for a button instead of re-running under the user's thumb.
  */
  const heavy = sourceBytes > AUTO_OPTIMIZE_LIMIT;
  const armed = source !== "" && (!heavy || approved === key);

  const run = useMemo((): { result: SvgOptimizeResult | null; error: string | null } => {
    if (!armed) return { result: null, error: null };
    try {
      return { result: optimizeSvg(source, settings), error: null };
    } catch (err) {
      return {
        result: null,
        error:
          err instanceof SvgOptimizeError
            ? err.message
            : err instanceof Error
              ? `This SVG could not be optimised: ${err.message}`
              : "This SVG could not be optimised.",
      };
    }
  }, [armed, source, settings]);

  const { result, error } = run;
  const output = result?.svg ?? "";

  const blob = useMemo(
    () => new Blob([output], { type: "image/svg+xml;charset=utf-8" }),
    [output],
  );
  const outputName = optimizedFileName(file?.name ?? "image.svg");

  const diffTooBig = sourceBytes > DIFF_LIMIT;
  const diff = useMemo(() => {
    if (view !== "diff" || !result || diffTooBig) return null;
    return diffLines(indentSvg(source), indentSvg(result.svg));
  }, [view, result, source, diffTooBig]);
  const diffText = diff ? diff.map((part) => part.value).join("") : "";

  /*
    `arrayBuffer()` is async, so a slow first read can resolve AFTER a second
    file has replaced it and hand the tool the wrong bytes under the right
    name. Every load and the reset bump this token, and a read whose token is
    stale drops its result on the floor.
  */
  const loadToken = useRef(0);

  const handleFiles = useCallback(async (files: File[]) => {
    const picked = files[0];
    if (!picked) return;
    const token = ++loadToken.current;
    setFile(picked);
    setDecoded(null);
    setReadError(null);
    setApproved(null);
    try {
      const buffer = await picked.arrayBuffer();
      if (loadToken.current !== token) return;
      setDecoded(decodeSvgBytes(new Uint8Array(buffer)));
    } catch {
      if (loadToken.current !== token) return;
      setReadError("This file could not be read from disk.");
    }
  }, []);

  const handleReset = useCallback(() => {
    loadToken.current++;
    setFile(null);
    setDecoded(null);
    setReadError(null);
    setApproved(null);
  }, []);

  const handleRun = useCallback(() => setApproved(key), [key]);
  const handleCopy = useCallback(() => {
    void copy(output);
  }, [copy, output]);

  const applyPreset = useCallback((id: string) => {
    const chosen = SVG_PRESETS.find((p) => p.id === id);
    if (!chosen) return;
    setPrecision(chosen.settings.precision);
    setDisabled(chosen.settings.disabled);
    setRemoveScripts(chosen.settings.removeScripts);
    setRemoveEmbeddedImages(chosen.settings.removeEmbeddedImages);
    setRemoveDimensions(chosen.settings.removeDimensions);
  }, []);

  const toggleRisky = useCallback((id: RiskyPluginId) => {
    setDisabled((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const payload = result ? payloadNotes(result, settings) : [];
  const losses = result ? lossNotes(result, settings) : [];

  /*
    Stated whenever the bytes on disk are not the bytes being optimised. Both
    sides of BEFORE/AFTER are UTF-8 counts of the decoded text, so the encoding
    change is NOT in the saving — `encodingNote` says so and prints the on-disk
    delta separately, derived from the file's own size.
  */
  const encoding =
    file && decoded ? encodingNote(decoded, file.size, sourceBytes) : null;

  const preview = output.length > PREVIEW_LIMIT ? output.slice(0, PREVIEW_LIMIT) : output;
  const sourcePreview = source.length > PREVIEW_LIMIT ? source.slice(0, PREVIEW_LIMIT) : source;
  const savedLabel = result
    ? result.savedPercent >= 0
      ? `${result.savedPercent}% SMALLER`
      : `${Math.abs(result.savedPercent)}% LARGER`
    : undefined;

  return (
    <>
      {/* ── Canvas: the file that came in, and the file going out ────── */}
      <div className={CANVAS_COLUMN}>
        {!file ? (
          <DropZone
            accept=".svg"
            onFiles={handleFiles}
            label="Drop an SVG to begin"
            acceptLabel="SVG"
            practicalLimitNote={PRACTICAL_LIMIT_NOTE}
          />
        ) : (
          <>
            <CanvasHeader
              file={file.name}
              meta={`${formatFileSize(file.size)} ON DISK${
                decoded ? ` · ${decoded.encoding.toUpperCase()}` : ""
              }`}
              trailing={savedLabel}
              trailingTone={result && result.savedPercent <= 0 ? "muted" : "accent"}
            />

            {readError && <ErrorMessage message={readError} />}
            {error && <ErrorMessage message={error} />}
            {encoding && <WarningMessage message={encoding} />}
            {payload.length > 0 && <WarningMessage message={payload.join(" ")} />}
            {losses.length > 0 && <WarningMessage message={losses.join(" ")} />}

            {result && (
              <StatStrip
                stats={[
                  { label: "BEFORE", value: formatFileSize(result.inputBytes), tone: "neutral" },
                  { label: "AFTER", value: formatFileSize(result.outputBytes) },
                  {
                    label: "SAVED",
                    value: `${result.savedPercent}%`,
                    tone: result.savedPercent > 0 ? "ok" : "neutral",
                  },
                  {
                    label: "ELEMENTS",
                    value: `${result.after.elements} of ${result.before.elements}`,
                    tone: "neutral",
                  },
                  {
                    label: "TOOK",
                    value:
                      result.elapsedMs < 1 ? "<1 ms" : `${Math.round(result.elapsedMs)} ms`,
                    tone: "neutral",
                  },
                ]}
              />
            )}

            {view === "diff" && result ? (
              <TextPanes columns={1}>
                <TextPane
                  tone="out"
                  label="Original against optimised"
                  lines={lineCount(diffText)}
                  size={diff ? undefined : "NOT DRAWN"}
                >
                  {diff ? (
                    <div
                      tabIndex={0}
                      role="region"
                      className={cn(TEXT_PANE_BODY, PANE_FOCUS)}
                      aria-label="Difference between the two files"
                    >
                      {diff.map((part, i) => (
                        <span
                          key={i}
                          className={
                            part.added
                              ? "bg-success/20 text-success"
                              : part.removed
                                ? "bg-error/20 text-error line-through"
                                : "text-neutral-400"
                          }
                        >
                          {part.value}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <pre
                      tabIndex={0}
                      role="region"
                      aria-label="Why the diff was not drawn"
                      className={cn(TEXT_PANE_BODY, PANE_FOCUS)}
                    >
                      {`This file is ${formatFileSize(sourceBytes)}, past the ${formatFileSize(DIFF_LIMIT)} the diff is capped at — laying out a line-by-line comparison of it would cost more than it tells you. Switch to SIDE BY SIDE.`}
                    </pre>
                  )}
                </TextPane>
              </TextPanes>
            ) : (
              <TextPanes columns={output ? 2 : 1}>
                <TextPane
                  label="Source"
                  lines={lineCount(source)}
                  size={formatFileSize(sourceBytes)}
                >
                  <pre
                    tabIndex={0}
                    role="region"
                    className={cn(TEXT_PANE_BODY, PANE_FOCUS)}
                    aria-label="Source SVG"
                  >
                    {sourcePreview}
                  </pre>
                </TextPane>

                {output && (
                  <TextPane
                    tone="out"
                    label="Optimised"
                    lines={lineCount(output)}
                    size={formatFileSize(blob.size)}
                    action={
                      <button
                        onClick={handleCopy}
                        aria-label={copied ? "Copied optimised SVG" : "Copy optimised SVG"}
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
                      aria-label="Optimised SVG"
                    >
                      {preview}
                    </pre>
                  </TextPane>
                )}
              </TextPanes>
            )}

            {heavy && !armed && !error && (
              <CanvasFootnote>
                {`${formatFileSize(sourceBytes)} OF SVG — PAST ${formatFileSize(AUTO_OPTIMIZE_LIMIT)} THE RUN WAITS FOR THE BUTTON, BECAUSE IT BLOCKS THIS TAB WHILE IT WORKS`}
              </CanvasFootnote>
            )}
            {view === "panes" && output.length > PREVIEW_LIMIT && (
              <CanvasFootnote>
                {`PREVIEWING THE FIRST ${PREVIEW_LIMIT.toLocaleString()} OF ${output.length.toLocaleString()} CHARACTERS — COPY AND DOWNLOAD CARRY ALL OF IT`}
              </CanvasFootnote>
            )}
          </>
        )}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ────────── */}
      <ToolAside
        footer={
          file ? (
            <>
              {result && (
                <DownloadButton
                  blob={blob}
                  fileName={outputName}
                  className="w-full justify-center"
                />
              )}
              {heavy && !armed && (
                <ToolActions primaryLabel="Optimise SVG" onPrimary={handleRun} />
              )}
              <ToolResetLink onClick={handleReset} label="CHANGE FILE" />
            </>
          ) : undefined
        }
      >
        {!file && (
          <ToolAsideSection label="BEFORE YOU DROP ONE">
            <span className={HINT}>
              SVGO is the optimiser every build pipeline uses, and its default settings are not
              safe for every file. Seven of its default passes can change how a drawing renders
              or cut off something outside the file that was reaching into it. This page runs
              them, names the ones that fired, and lets you switch each one off.
            </span>
          </ToolAsideSection>
        )}

        {file && (
          <>
            <ToolPresets presets={SVG_PRESETS} active={preset} onSelect={applyPreset} />

            <ToolControlGroup>
              <ToolControl>
                <ToolSlider
                  label="Coordinate precision"
                  display={`${precision} dp`}
                  min={MIN_PRECISION}
                  max={MAX_PRECISION}
                  value={precision}
                  onChange={setPrecision}
                  hint="Decimal places kept on path data, transforms and numeric attributes. Three is SVGO's default and is invisible on an icon. Below that, curves start to move — how far depends on the viewBox, so watch the preview rather than the number."
                />
              </ToolControl>

              <ToolControl label="COMPARE">
                <ToolChoice
                  label="How to compare the two files"
                  value={view}
                  onChange={setView}
                  options={[
                    { value: "panes" as const, label: "Side by side" },
                    { value: "diff" as const, label: "Diff" },
                  ]}
                />
                <span className={HINT}>
                  The diff re-indents both files first — one element per line — so the two sides
                  line up. That indentation is a view only; the file you download is the
                  optimised one in the right-hand pane.
                </span>
              </ToolControl>

              <ToolControl label={OPT_IN_GROUP_LABEL}>
                <label className={CHECK_ROW}>
                  <input
                    type="checkbox"
                    checked={removeScripts}
                    onChange={(e) => setRemoveScripts(e.target.checked)}
                    className={CHECK_BOX}
                  />
                  {OPT_IN_LABELS.removeScripts}
                </label>
                <label className={CHECK_ROW}>
                  <input
                    type="checkbox"
                    checked={removeEmbeddedImages}
                    onChange={(e) => setRemoveEmbeddedImages(e.target.checked)}
                    className={CHECK_BOX}
                  />
                  {OPT_IN_LABELS.removeEmbeddedImages}
                </label>
                <label className={CHECK_ROW}>
                  <input
                    type="checkbox"
                    checked={removeDimensions}
                    onChange={(e) => setRemoveDimensions(e.target.checked)}
                    className={CHECK_BOX}
                  />
                  {OPT_IN_LABELS.removeDimensions}
                </label>
                <span className={HINT}>
                  None of these runs unless you ask. Scripts and on… handlers survive SVGO&rsquo;s
                  defaults untouched. Embedded images are deleted outright, picture and all —
                  this page does that itself, because SVGO&rsquo;s own pass only looks at the
                  legacy xlink:href spelling. Dropping width and height makes the SVG fill its
                  container, and writes a viewBox from them first if there was not one &mdash;
                  but only where both are plain numbers. A root sized in mm, in, pt, em or %
                  is left exactly as it is, because building a viewBox from it would mean
                  guessing at a scale; the page says so above the panes when that happens.
                </span>
              </ToolControl>
            </ToolControlGroup>

            {/*
              A `<details>`, not a section: seven checkboxes and seven
              explanations is the tallest block on this page, and it is
              reference material the moment you have chosen a preset. The
              markup follows `ToolAdvanced` in ToolAside.tsx.
            */}
            <details className="group border-b border-border px-4 last:border-b-0">
              <summary
                className={cn(
                  "flex cursor-pointer list-none items-center gap-2 py-3",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                )}
              >
                <span className={cn(MONO_LABEL, "text-text-muted")}>RISKY DEFAULTS</span>
                <span className="font-mono text-[10px] leading-none text-text-muted opacity-60">
                  {`${RISKY_DEFAULT_PLUGINS.length - disabled.length} OF ${RISKY_DEFAULT_PLUGINS.length} ON`}
                </span>
                <span
                  aria-hidden="true"
                  className="ml-auto font-mono text-[15px] leading-none text-text-muted transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none"
                >
                  ›
                </span>
              </summary>
              <div className={DRAWER}>
                <span className={HINT}>
                  Every one of these is on in SVGO&rsquo;s own default preset, and every sentence
                  below describes something that was reproduced against svgo 4.1.0 rather than
                  taken from the documentation. Untick one to switch that pass off.
                </span>
                {RISKY_DEFAULT_PLUGINS.map((risky) => (
                  <div key={risky.id} className="flex flex-col gap-1.5">
                    <label className={CHECK_ROW}>
                      <input
                        type="checkbox"
                        checked={!disabled.includes(risky.id)}
                        onChange={() => toggleRisky(risky.id)}
                        className={CHECK_BOX}
                      />
                      {risky.label}
                    </label>
                    <span className={cn(HINT, "pl-[26px]")}>{risky.why}</span>
                  </div>
                ))}
                <span className={HINT}>
                  Two passes people expect here are not: SVGO 4 does not remove the viewBox and
                  does not remove width and height in its default preset. The warning you have
                  read about losing your viewBox has not described this tool for some years.
                </span>
              </div>
            </details>

            <ToolAsideSection label="OUTPUT">
              <ToolOutput
                rows={[
                  ["Before", result ? `${result.inputBytes.toLocaleString()} B` : "—"],
                  ["After", result ? `${result.outputBytes.toLocaleString()} B` : "—"],
                  [
                    "Saves as",
                    result ? outputName : heavy ? "press Optimise SVG" : "—",
                  ],
                ]}
              />
              {/*
                The obvious sentence here — "gzip already got most of this" —
                is not reliably true, and was cut after measuring. Three files
                through this build: a 471 KB generated path drawing saved 50.2%
                raw and 73.2% gzipped, this site's 438-byte icon.svg saved 26.0%
                raw and 19.1% gzipped, and a 222-byte fixture saved 9.0% raw and
                1.2% gzipped. Which figure is larger depends on the entropy of
                what came out, so the copy says that instead of guessing.
              */}
              <span className={HINT}>
                Sizes are UTF-8 bytes of the text on each side, which is what the file weighs on
                disk. They are not gzip figures, and the gzip saving is not a fraction of this
                one — it can land either side of it, depending on whether what came out was
                repetition gzip was already collapsing or high-entropy coordinates it could not
                touch. Nothing is uploaded; the parse and every pass run in this tab.
              </span>
            </ToolAsideSection>
          </>
        )}
      </ToolAside>
    </>
  );
}
