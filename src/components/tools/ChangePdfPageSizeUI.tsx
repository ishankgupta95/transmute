"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import type { PdfPageSizeName } from "@/lib/tools/pdf-engine";
import { PDF_PAGE_SIZES, changePdfPageSize, loadPdfjsDocument } from "@/lib/tools/pdf-engine";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolDone,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  CanvasHeader,
  CanvasStage,
  StatStrip,
} from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup, ToolProgress } from "@/components/tools/ToolControls";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { CANVAS_COLUMN } from "@/components/workspace/shared";

/*
  This file owns the page-dimension half of TWO tools: `change-pdf-page-size`,
  which is only this, and `pdf-resizer`, which switches between this and the
  compressor. `PdfPageSizeTool` is the shared body — controls, canvas, engine
  call and copy — so the two pages cannot drift into telling the user different
  things about the same operation. `PdfResizerUI` mounts it with a mode switch
  in `railHeader`; `ChangePdfPageSizeUI` mounts it with nothing.

  The file the tool works on is owned by the CALLER, not by this component.
  That is what lets the resizer flip between page dimensions and file size
  without the user having to drop the same PDF in twice.
*/

/** Explicit and ordered — `Object.keys` would type as `string[]` and reorder. */
const SIZE_OPTIONS: readonly { value: PdfPageSizeName; label: string }[] = [
  { value: "a3", label: "A3" },
  { value: "a4", label: "A4" },
  { value: "a5", label: "A5" },
  { value: "letter", label: "Letter" },
  { value: "legal", label: "Legal" },
  { value: "tabloid", label: "Tabloid" },
];

type Orientation = "portrait" | "landscape";

/** PDF points are 1/72", so both conversions below are exact. */
function ptToMm(pt: number): number {
  return (pt / 72) * 25.4;
}

/** "210 × 297 mm · 8.3 × 11.7 in" — nobody reads a page size in points. */
function pageSizeLabel(width: number, height: number): string {
  return (
    `${Math.round(ptToMm(width))} × ${Math.round(ptToMm(height))} mm` +
    ` · ${(width / 72).toFixed(1)} × ${(height / 72).toFixed(1)} in`
  );
}

export interface PdfPageSizeToolProps {
  file: File;
  /** Clears the file — the caller owns it, so it owns dropping it too. */
  onReset: () => void;
  resetLabel?: string;
  /** Rendered above the controls in the rail. `pdf-resizer` puts its mode switch here. */
  railHeader?: ReactNode;
}

export function PdfPageSizeTool({
  file,
  onReset,
  resetLabel = "CHANGE FILE",
  railHeader,
}: PdfPageSizeToolProps) {
  const [size, setSize] = useState<PdfPageSizeName>("a4");
  /*
    `null` means "nobody has picked one — follow the document", and it is the
    reason this is not seeded from the pdfjs probe.

    MEASURED DEFECT: the probe used to finish with an unconditional
    `setOrientation(viewport.width > viewport.height ? "landscape" : "portrait")`,
    while the ORIENTATION chips were gated on `status === "processing"` only —
    so they are live for the whole "READING PAGES" window (a first-use dynamic
    `import("pdfjs-dist")`, a worker-script fetch, `file.arrayBuffer()`, a copy
    and a parse). A driven repro with the probe held on a deferred promise:
    click Landscape while the progress bar is up and the header trailing reads
    "A4 LANDSCAPE"; when the probe resolves it silently reverts to "A4
    PORTRAIT", and the engine is then asked for {width: 595.28, height: 841.89}
    — the opposite of what was clicked. Most PDFs are portrait, so the seed
    clobbered exactly the one deliberate pick anyone makes on this control.

    The fix is to stop writing the control from an effect at all. The probe
    already publishes `source`; the opening orientation is DERIVED from it
    below, so an arrival-later measurement can never overwrite a decision the
    user has already made, in either order.
  */
  const [orientation, setOrientation] = useState<Orientation | null>(null);
  // Default true, and the copy under the control says what each half does —
  // moving the box without scaling the content silently crops or pads it.
  const [scaleContent, setScaleContent] = useState(true);
  const [pageCount, setPageCount] = useState(0);
  // Page 1's VISUAL size in points, from pdfjs's scale-1 viewport (which has
  // /Rotate applied). Measured, never assumed — the whole point of showing it
  // is so the user can see what is actually changing.
  const [source, setSource] = useState<{ width: number; height: number } | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "processing" | "done" | "error">(
    "idle",
  );
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The doc pins a "Done in 1.4 s" card above the primary once a run
  // finishes. Timed for real; cleared the moment the inputs change.
  const [elapsed, setElapsed] = useState<string | null>(null);
  const probedRef = useRef(false);

  // One pdfjs parse for both facts we need: how many pages there are and how
  // big page 1 is. `getPageCount` would be a second full parse of the same
  // bytes in the pdf-lib worker for a number this document proxy already has.
  useEffect(() => {
    if (probedRef.current) return;
    probedRef.current = true;
    let cancelled = false;
    let doc: Awaited<ReturnType<typeof loadPdfjsDocument>> | null = null;
    setStatus("loading");
    (async () => {
      try {
        doc = await loadPdfjsDocument(await file.arrayBuffer());
        const page = await doc.getPage(1);
        const viewport = page.getViewport({ scale: 1 });
        if (cancelled) return;
        setPageCount(doc.numPages);
        setSource({ width: viewport.width, height: viewport.height });
        setStatus("idle");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to read the PDF");
          setStatus("error");
        }
      } finally {
        await doc?.destroy();
        doc = null;
      }
    })();
    return () => {
      cancelled = true;
      // See the identical note on the thumbnail decks: the ref means "a probe
      // ran for this file", and a teardown (StrictMode, Fast Refresh) makes
      // that false again — leaving it true strands the tool with no page size.
      probedRef.current = false;
      void doc?.destroy();
    };
  }, [file]);

  /*
    Anything that changes what a run would produce also drops the finished
    one. The footer swaps the primary out for a Download the moment `result`
    is set, so leaving it in place would offer a file built from the previous
    settings with no way to re-run short of re-uploading.
  */
  const invalidate = useCallback(() => {
    setResult(null);
    setElapsed(null);
    setStatus((s) => (s === "done" ? "idle" : s));
  }, []);

  /*
    Opening on the orientation the document already has means the default run
    reshapes the sheet without also turning it sideways. Derived, not seeded:
    until page 1 has been measured there is nothing to follow, and "portrait"
    is the same opening value the state used to hold. A user pick wins from the
    moment it is made and is never overwritten by the probe landing after it.
  */
  const effectiveOrientation: Orientation =
    orientation ?? (source && source.width > source.height ? "landscape" : "portrait");

  const base = PDF_PAGE_SIZES[size];
  // The engine takes VISUAL dimensions and swaps them itself for a
  // quarter-turned page, so landscape here is purely "swap what I asked for".
  const target =
    effectiveOrientation === "landscape"
      ? { width: base.height, height: base.width }
      : { width: base.width, height: base.height };

  const handleRun = useCallback(async () => {
    setStatus("processing");
    setError(null);
    setElapsed(null);
    const startedAt = performance.now();
    try {
      const freshData = new Uint8Array(await file.arrayBuffer());
      const bytes = await changePdfPageSize(freshData, {
        width: target.width,
        height: target.height,
        scaleContent,
      });
      setResult(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      // A tiny PDF finishes in tens of milliseconds; "Done in 0.0 s" reads
      // like a stopwatch that never started. Sub-second runs report ms.
      const ms = performance.now() - startedAt;
      setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change the page size");
      setStatus("error");
    }
  }, [file, target.width, target.height, scaleContent]);

  const sizeLabel = SIZE_OPTIONS.find((o) => o.value === size)?.label ?? size.toUpperCase();
  const targetPt = `${Math.round(target.width)} × ${Math.round(target.height)} PT`;
  const sourcePt = source
    ? `${Math.round(source.width)} × ${Math.round(source.height)} PT`
    : "—";

  /*
    The two sheets drawn to scale against each other, which is the one thing a
    row of numbers cannot show: whether A4 → A5 is a small trim or half the
    page. Both boxes are sized as a percentage of the larger dimension in each
    axis, so the drawing is proportional rather than decorative.
  */
  const span = Math.max(target.width, source?.width ?? 0, target.height, source?.height ?? 0);
  const targetBox = { w: (target.width / span) * 100, h: (target.height / span) * 100 };
  const scale = source ? Math.min(target.width / source.width, target.height / source.height) : 1;
  const sourceBox = source
    ? scaleContent
      ? // What the run actually produces: the source uniformly scaled to fit
        // and centred inside the new sheet.
        { w: ((source.width * scale) / span) * 100, h: ((source.height * scale) / span) * 100 }
      : // Box-only: the content keeps its size, so the new sheet crops it or
        // pads around it. Anchored bottom-left below, because that is where
        // the engine puts the new box's origin.
        { w: (source.width / span) * 100, h: (source.height / span) * 100 }
    : null;

  return (
    <>
      {/* ── Canvas: the old sheet against the new one ────────── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={`${pageCount || "…"} PAGE${pageCount !== 1 ? "S" : ""} · ${formatFileSize(file.size)}`}
          trailing={`${sizeLabel.toUpperCase()} ${effectiveOrientation.toUpperCase()}`}
        />

        <CanvasStage className="flex items-center justify-center bg-bg-secondary p-6">
          {/* A SQUARE field, so a percentage means the same number of pixels
              in both axes and the two sheets keep their real proportions
              against each other. */}
          <div className="relative flex size-[13rem] items-center justify-center sm:size-[17rem]">
            <div
              className="relative flex items-center justify-center border border-accent bg-accent/5"
              style={{ width: `${targetBox.w}%`, height: `${targetBox.h}%` }}
            >
              {sourceBox && (
                <div
                  className={
                    scaleContent
                      ? "border border-dashed border-neutral-500 bg-neutral-500/10"
                      : "absolute bottom-0 left-0 border border-dashed border-neutral-500 bg-neutral-500/10"
                  }
                  style={{
                    // Relative to the target box, which is itself a % of the
                    // square field — so divide back out.
                    width: `${(sourceBox.w / targetBox.w) * 100}%`,
                    height: `${(sourceBox.h / targetBox.h) * 100}%`,
                  }}
                />
              )}
            </div>
          </div>
        </CanvasStage>

        <StatStrip
          stats={[
            { label: "PAGE 1 NOW", value: sourcePt, tone: "neutral" },
            { label: "NEW SIZE", value: targetPt },
            {
              label: "CONTENT",
              // The scale factor is only knowable once page 1 has been
              // measured — printing "SCALED 100%" against a placeholder would
              // be a number the tool has not worked out yet.
              value: !source ? "—" : scaleContent ? `SCALED ${Math.round(scale * 100)}%` : "UNCHANGED",
              tone: "neutral",
            },
            { label: "PAGES", value: pageCount ? `ALL ${pageCount}` : "—", tone: "neutral" },
          ]}
        />

        <CanvasFootnote>
          {scaleContent
            ? `EVERY PAGE BECOMES ${targetPt} AND ITS CONTENT IS SCALED TO FIT AND CENTRED — NOTHING IS CUT OFF`
            : `EVERY PAGE BECOMES ${targetPt} WITH THE CONTENT LEFT WHERE IT IS — A SMALLER SHEET CUTS INTO IT, A BIGGER ONE ADDS BLANK SPACE`}
        </CanvasFootnote>

        {error && <ErrorMessage message={error} />}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {(status === "loading" || status === "processing") && (
              <ToolProgress
                phase={status === "loading" ? "READING PAGES" : "RESIZING"}
                percent={null}
                label={status === "loading" ? "Reading pages" : "Resizing pages"}
              />
            )}
            {elapsed && <ToolDone elapsed={elapsed} />}
            {result ? (
              <DownloadButton
                blob={result}
                fileName={file.name.replace(/\.pdf$/i, `-${size}.pdf`)}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel={
                  status === "processing" ? "Resizing…" : `Resize to ${sizeLabel}`
                }
                primaryDisabled={status === "processing" || status === "loading"}
                onPrimary={handleRun}
              />
            )}
            <ToolResetLink onClick={onReset} label={resetLabel} />
          </>
        }
      >
        {railHeader}

        <ToolControlGroup>
          <ToolControl label="PAGE SIZE">
            <ToolChoice
              label="Target page size"
              fill
              value={size}
              onChange={(v: PdfPageSizeName) => {
                setSize(v);
                invalidate();
              }}
              disabled={status === "processing"}
              options={SIZE_OPTIONS}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              {sizeLabel} {effectiveOrientation} is {pageSizeLabel(target.width, target.height)}.
            </span>
          </ToolControl>

          <ToolControl label="ORIENTATION">
            <ToolChoice
              label="Page orientation"
              fill
              value={effectiveOrientation}
              onChange={(v: Orientation) => {
                setOrientation(v);
                invalidate();
              }}
              disabled={status === "processing"}
              options={[
                { value: "portrait", label: "Portrait" },
                { value: "landscape", label: "Landscape" },
              ]}
            />
          </ToolControl>

          <ToolControl label="CONTENT">
            <ToolChoice
              label="What happens to the page content"
              fill
              value={scaleContent ? "scale" : "box"}
              onChange={(v: string) => {
                setScaleContent(v === "scale");
                invalidate();
              }}
              disabled={status === "processing"}
              options={[
                { value: "scale", label: "Scale to fit" },
                { value: "box", label: "Box only" },
              ]}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              {scaleContent ? (
                <>
                  <strong>Scale the page content to fit.</strong> Everything on the page is
                  enlarged or shrunk by one factor
                  {source ? ` — ${Math.round(scale * 100)}% for page 1 — ` : " "}
                  and centred on the new sheet, so nothing is cut off and nothing changes shape.
                </>
              ) : (
                <>
                  <strong>Change the page box only.</strong> The content is not rescaled or
                  moved: the new sheet is drawn from the bottom-left corner, so a smaller size
                  crops into the page and a larger one adds blank space around it.
                </>
              )}
            </span>
          </ToolControl>
        </ToolControlGroup>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Page 1 now", sourcePt],
              ["New size", targetPt],
              ["Pages", pageCount ? `All ${pageCount}` : "—"],
            ]}
          />
          {/*
            This paragraph used to frame the annotation caveat as a SIZING
            issue ("their positions are moved, but their stored appearances are
            not rescaled"). MEASURED, that understated it badly: under Scale to
            fit the content gets the centring translation ex/ey from the page
            CTM while pdf-lib's `scaleAnnotations` only multiplies the numbers
            in /Rect, /L, /Vertices, /QuadPoints, /InkList, /RD and /CL about
            the coordinate ORIGIN — no translation at all. Whenever the source
            and target sheets have different proportions the two diverge by the
            whole centring offset: US Letter → A4 put a field box 36 pt (13 mm)
            below its own label, Letter → Legal 108 pt, Legal → Tabloid
            landscape 372 pt sideways, and a link annotation drifted off the
            words it covered. That is a DISPLACEMENT, not a size mismatch.

            The engine now applies the same scale AND the same centring offset
            to annotation geometry, so the sentence below can say positions
            follow the content. What survives is the genuine limitation the old
            copy was reaching for: an /AP appearance stream carries its own
            /BBox and /Matrix and is never re-rendered, so a filled-in form's
            box and its drawn text can still come out at different sizes.
          */}
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Every page in the file is resized. Text stays selectable and images are never
            re-encoded. One limitation worth knowing: links, comments and form fields are moved
            and scaled with the content, so they stay over what they belong to — but a
            field&apos;s stored appearance keeps its original size, and so does the font size
            recorded with it. Readers stretch the stored picture onto the new rectangle, so it
            normally looks right; one that redraws the field instead uses the point size the
            file still names, and the text comes out too small for the enlarged box.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}

export function ChangePdfPageSizeUI() {
  const [file, setFile] = useState<File | null>(null);

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (f) setFile(f);
  }, []);

  const handleReset = useCallback(() => setFile(null), []);

  if (!file) return <DropZone accept=".pdf" onFiles={handleFiles} />;

  // Keyed on the file so dropping a new one re-probes its page size rather
  // than showing the previous document's dimensions against the new name.
  return <PdfPageSizeTool key={file.name + file.size} file={file} onReset={handleReset} />;
}
