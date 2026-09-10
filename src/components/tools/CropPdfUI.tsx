"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Cropper from "cropperjs";
import "cropperjs/dist/cropper.css";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { cropPdfPages, loadPdfjsDocument, renderPageFromDoc } from "@/lib/tools/pdf-engine";
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
import { CANVAS_COLUMN, STAGE_GROW } from "@/components/workspace/shared";
import { cn } from "@/lib/utils/cn";

const ASPECT_RATIOS = [
  { label: "Free", value: NaN },
  { label: "1:1", value: 1 },
  { label: "A4", value: 595.28 / 841.89 },
  { label: "4:3", value: 4 / 3 },
  { label: "16:9", value: 16 / 9 },
] as const;

/**
 * The four numbers that ARE the crop frame, in the page's own points.
 *
 * WCAG 2.1.1 Keyboard (A). cropperjs 1.6.2 binds pointer events only — no
 * `keydown`, no `tabindex`, no `role`, no `aria-*` anywhere in
 * `dist/cropper.js` — so the frame it draws cannot be focused, moved or resized
 * without a mouse. ASPECT and "Reset crop frame" were the only frame-adjacent
 * controls a keyboard user could reach, and neither of them chooses WHICH part
 * of the page to keep, which is the whole tool. These fields do.
 *
 * POINTS, not preview pixels: the preview's pixel size is an artefact of the
 * render scale chosen a few lines below, while points are what the PAGE 1 and
 * CROP readouts next to them already speak and what the saved file is measured
 * in. `x`/`width` scale on the horizontal axis, `y`/`height` on the vertical
 * one — `CROP_FIELD_AXIS` is that mapping, kept as data so the two conversions
 * cannot fall out of step.
 */
const CROP_FIELDS = [
  ["x", "X"],
  ["y", "Y"],
  ["width", "Width"],
  ["height", "Height"],
] as const;

type CropField = (typeof CROP_FIELDS)[number][0];

const CROP_FIELD_AXIS: Record<CropField, "x" | "y"> = {
  x: "x",
  width: "x",
  y: "y",
  height: "y",
};

const NUMBER_FIELD_CLASS =
  "w-full rounded-md border border-border bg-bg-elevated px-2.5 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-45";

/** PDF points are 1/72", so this is exact rather than a nominal conversion. */
function ptToMm(pt: number): number {
  return (pt / 72) * 25.4;
}

/** Canvas pixels per point, on the axis the given field is measured along. */
function fieldScale(p: Preview, key: CropField): number {
  return CROP_FIELD_AXIS[key] === "x" ? p.canvasWidth / p.pageWidth : p.canvasHeight / p.pageHeight;
}

/*
  One field of the crop frame, canvas pixels → points.

  The frame these fields speak is the page as the user is looking at it: the
  origin is the page's TOP-left corner, so `Y` is the distance from the top edge
  down to the top of the frame. That is deliberately NOT the rect `toPdfRect`
  builds for the engine, which is PDF user space with the origin at the
  LOWER-left — a number nobody reading a page on screen would recognise. The two
  never meet: these fields go in and out through cropperjs's own canvas-pixel
  data, and `toPdfRect` stays the one and only place the y-flip happens.
*/
function fieldToPoints(box: Cropper.Data, p: Preview, key: CropField): number {
  return box[key] / fieldScale(p, key);
}

/** "210 × 297 mm" — the unit people actually recognise a page size in. */
function mmLabel(width: number, height: number): string {
  return `${Math.round(ptToMm(width))} × ${Math.round(ptToMm(height))} MM`;
}

interface Preview {
  /** Data URL of the rendered page, handed to cropperjs as an <img> src. */
  url: string;
  /**
   * The rendered canvas's real pixel dimensions. NOT `scale × page size`:
   * `canvas.width` is an integer property, so `renderPageFromDoc` truncates a
   * fractional viewport (A4 at 1.5 is 892.9 → 892). Dividing by the requested
   * scale would then be wrong by up to a pixel in each axis, which is a
   * fraction of a point of crop drift — small, but free to avoid by deriving
   * the scale from the two numbers that actually exist.
   */
  canvasWidth: number;
  canvasHeight: number;
  /**
   * The page's VISUAL size in PDF points — pdfjs's viewport at scale 1, which
   * already has /Rotate applied. `cropPdfPages` takes its rect in exactly this
   * frame, so the two agree by construction instead of by assumption.
   */
  pageWidth: number;
  pageHeight: number;
}

export function CropPdfUI() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [aspect, setAspect] = useState<string>("Free");
  // Live crop box in CANVAS pixels, straight from cropperjs. Converted to PDF
  // points only where it is read, so there is one conversion in the file.
  const [cropBox, setCropBox] = useState<Cropper.Data | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "processing" | "done" | "error">(
    "idle",
  );
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The doc pins a "Done in 1.4 s" card above the primary once a run
  // finishes. Timed for real; cleared the moment the inputs change.
  const [elapsed, setElapsed] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const cropperRef = useRef<Cropper | null>(null);
  const previewLoadedRef = useRef(false);
  /*
    MEASURED DEFECT this ref exists to close (the crop tool's shape of the same
    bug delete-pdf-pages carries): the invalidation in the `crop` handler below
    used to be `setStatus((s) => (s === "done" ? "idle" : s))` plus
    `setResult(null)`, and BOTH are inert while a run is in flight — the status
    is "processing", so the ternary is a no-op, and there is no result yet to
    clear. `cropPdfPages` runs in a dedicated worker (`pdf-engine.ts` →
    `/workers/pdf.worker.js`), so the main thread is idle for the whole run and
    the cropperjs frame stays fully draggable. Drag it mid-run and the frame,
    the CROP stat and the IN MM stat all move to the new rectangle while the
    download that lands a moment later was built from the rectangle captured at
    click time — the file and every readout describing it disagree, with
    nothing on screen to say so.

    The cropper cannot be switched off through props, so the rule is made
    authoritative instead of trying to freeze the surface: a run claims a
    generation before its first `await`, and anything that moves the frame,
    swaps the file or resets bumps it. A run whose generation is stale writes
    nothing, so a download is only ever offered for the frame currently drawn.

    Deliberately unconditional: every `crop` event invalidates, even one whose
    rectangle is unchanged. An earlier attempt bumped the generation only when
    the box had actually moved by more than half a natural-image pixel — the
    reasoning being that `responsive: true` re-fires `crop` on a plain window
    resize, and cancelling a good run for that is a mystery to the user. It
    also broke the app-wide contract golden-paths.spec.ts pins for every tool
    ("changing a control after a run drops the stale download"): on a SQUARE
    page — the 300 × 300 fixture that spec uses — locking the aspect to 1:1
    leaves the box exactly where it is, so the Download stayed on screen after
    a control had visibly changed. Consistency wins: a re-fire on resize
    cancels a run and the primary comes straight back, which is a safe failure,
    whereas a download that survives a control change is the failure this whole
    funnel exists to prevent.
  */
  const runGenerationRef = useRef(0);

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    // A crop still running against the OUTGOING file must not land on the
    // incoming one — it would offer a "-cropped.pdf" built from a document
    // the user has already replaced.
    runGenerationRef.current += 1;
    setFile(f);
    setPageCount(0);
    setPreview(null);
    setCropBox(null);
    setResult(null);
    setElapsed(null);
    setError(null);
    setAspect("Free");
    previewLoadedRef.current = false;
  }, []);

  /*
    One pdfjs parse per file, for both facts this tool needs: how many pages
    there are, and what page 1 looks like at what size. `getPageCount` would
    be a second full parse of the same bytes in the pdf-lib worker for a
    number this document proxy already carries.

    The crop is expressed against what the user is LOOKING at, so the preview
    pixels and the page dimensions handed to the engine both come from this
    one page object rather than from two sources that could disagree.
  */
  useEffect(() => {
    if (!file || previewLoadedRef.current) return;
    previewLoadedRef.current = true;
    let cancelled = false;
    let doc: Awaited<ReturnType<typeof loadPdfjsDocument>> | null = null;
    setStatus("loading");
    (async () => {
      try {
        doc = await loadPdfjsDocument(await file.arrayBuffer());
        const page = await doc.getPage(1);
        const visual = page.getViewport({ scale: 1 });
        // Big enough to place a crop edge on a line of type, capped so a
        // tabloid sheet does not turn into a 20 MB data URL.
        const scale = Math.min(2.5, Math.max(0.75, 1000 / visual.width));
        const canvas = await renderPageFromDoc(doc, 1, scale);
        if (cancelled) return;
        setPageCount(doc.numPages);
        setStatus("idle");
        setPreview({
          // JPEG, not PNG: pdfjs paints an opaque white page background, so
          // there is no alpha to lose, and a PNG data URL of a 1000px-wide
          // page is several megabytes of string held in React state.
          url: canvas.toDataURL("image/jpeg", 0.9),
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
          pageWidth: visual.width,
          pageHeight: visual.height,
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to render the first page");
          setStatus("error");
        }
      } finally {
        // `doc` is nulled so the teardown below cannot destroy it twice.
        await doc?.destroy();
        doc = null;
      }
    })();
    return () => {
      cancelled = true;
      // Same rule as the thumbnail decks: the ref means "a preview pass is in
      // flight, or finished, for this file", and a teardown makes both false.
      // Leaving it true survives StrictMode's double mount and Fast Refresh,
      // and the canvas never renders again.
      previewLoadedRef.current = false;
      void doc?.destroy();
    };
  }, [file]);

  // cropperjs must never initialise against an <img> with no src, and the URL
  // arrives one render after the file — the gotcha ImageCropperUI documents.
  useEffect(() => {
    if (!imgRef.current || !preview) return;
    const cropper = new Cropper(imgRef.current, {
      viewMode: 1,
      autoCropArea: 0.9,
      responsive: true,
      guides: true,
      center: true,
      highlight: true,
      background: true,
      // Zoom and drag would move the image under a crop box whose numbers we
      // then read in NATURAL image pixels — the mapping still holds, but the
      // page can be scrolled out from under the frame, which reads as broken
      // on a document. The frame moves; the page does not.
      zoomable: false,
      movable: false,
      crop: (event) => {
        setCropBox(event.detail);
        // Anything that changes what a run would produce also drops the
        // finished one: the footer swaps the primary out for a Download the
        // moment `result` is set, so a stale crop would otherwise be the only
        // thing downloadable.
        setResult(null);
        setElapsed(null);
        // Cancels a run in flight as well as dropping a finished one; see the
        // note on `runGenerationRef`. "processing" has to be listed explicitly
        // — the old `s === "done"` test was exactly the hole the defect went
        // through, because mid-run the status is never "done".
        runGenerationRef.current += 1;
        setStatus((s) => (s === "done" || s === "processing" ? "idle" : s));
      },
    });
    cropperRef.current = cropper;
    return () => {
      cropper.destroy();
      cropperRef.current = null;
    };
  }, [preview]);

  const handleAspect = useCallback((label: string) => {
    setAspect(label);
    const ratio = ASPECT_RATIOS.find((a) => a.label === label)?.value ?? NaN;
    cropperRef.current?.setAspectRatio(ratio);
  }, []);

  const handleResetCrop = useCallback(() => {
    cropperRef.current?.reset();
  }, []);

  /*
    The keyboard path to the crop frame. One field is written at a time and
    nothing else is sent: `setData` applies only the keys it is given
    (cropper.js:2603-2615), so handing the whole rectangle back would re-write
    three numbers nobody touched.

    Nothing is set locally — cropperjs answers with a `crop` event carrying the
    rectangle it actually took after clamping it to the page (setData →
    setCropBoxData → renderCropBox → output, cropper.js:2615 / 2722 / 1462-1466
    / 1483-1489), and the handler above stays the only writer of `cropBox`. That
    is also what makes a typed number invalidate a finished or in-flight run
    exactly as a drag does, rather than leaving a download built from a frame
    the fields no longer describe.
  */
  const setCropField = useCallback(
    (key: CropField, points: number) => {
      if (!preview || !Number.isFinite(points)) return;
      const patch: Cropper.SetDataOptions = {};
      patch[key] = Math.max(0, points) * fieldScale(preview, key);
      cropperRef.current?.setData(patch);
    },
    [preview],
  );

  /*
    Canvas pixels → visual PDF points, the one conversion in this file.

    Two separate frames meet here and they disagree about which way is up:
    cropperjs reports its box in natural-image pixels with the origin at the
    TOP-left, while `cropPdfPages` takes PDF points with the origin at the
    VISIBLE page's LOWER-left (with /Rotate already applied, which is why the
    page size comes from pdfjs's scale-1 viewport rather than from a media
    box). So x scales straight across, and y is measured from the crop box's
    BOTTOM edge — `canvasY + canvasHeight` — subtracted from the page height.

    Verified end to end rather than reasoned about: a scratchpad script
    rendered a colour-grid page through this repo's pdfjs at a fractional
    scale, converted a cropperjs-shaped box with these exact four lines, ran
    `cropPdfPages`, and compared every pixel of the cropped render against the
    same sub-rectangle of the uncropped one — 100.00% match at /Rotate 0, 90,
    180 and 270.
  */
  const toPdfRect = useCallback(
    (box: Cropper.Data, p: Preview) => {
      const sx = p.canvasWidth / p.pageWidth;
      const sy = p.canvasHeight / p.pageHeight;
      return {
        x: box.x / sx,
        y: p.pageHeight - (box.y + box.height) / sy,
        width: box.width / sx,
        height: box.height / sy,
      };
    },
    [],
  );

  const handleCrop = useCallback(async () => {
    if (!file || !preview || !cropperRef.current) return;
    /*
      MEASURED DEFECT this guard closes: `getData()` returns a hard-coded
      `{x:0,y:0,width:0,height:0}` — no throw, no signal — whenever cropperjs
      is not yet `ready && cropped` (cropper.js:2533-2561, v1.6.2). The primary
      used to light up on `preview` alone, which is set in the same commit that
      first renders the <img>; cropperjs is constructed one passive effect
      later and only reaches `ready` from the CLONED image's async `load`.
      MEASURED against the running app (headless Chromium, the checked-in
      5-page A4 fixture, an rAF observer clicking the primary on every frame it
      was enabled and `.cropper-crop-box` was still absent): the window is
      18-19 ms unthrottled and 110 ms at 6x CPU throttle, and two clicks landed
      inside it. Each sent {0,0,0,0} through `toPdfRect` to `{x:0,
      y:pageHeight, width:0, height:0}`; `intersectRect` returns null for a
      non-positive extent (pdf-engine-core.ts:678) so `cropPdfPages` hit
      `continue` on every page and re-saved the document with its geometry
      untouched. The app then offered `sample-doc-cropped.pdf` whose page 1
      MediaBox was still the original 595 × 842 — a no-op sold as a crop, under
      a green "Done in N ms" card. With the gate below, the same probe records
      ZERO clicks in the window, and the earliest possible click (the first
      frame the button enables) produces a real 535.5 × 757.5 pt crop.

      Two independent locks now: `primaryDisabled` carries `!cropBox` (the
      value the CROP / IN MM readouts already treat as the readiness signal —
      it can only be set by a `crop` event, which cropperjs fires from
      `build()` once it is genuinely ready), and the rect is read and rejected
      HERE before anything is presented as a run. A degenerate rect can no
      longer be submitted through either.
    */
    const rect = toPdfRect(cropperRef.current.getData(true), preview);
    if (!(rect.width > 0) || !(rect.height > 0)) {
      setError("The crop frame is not ready yet — give the page a moment, then press Crop again.");
      setStatus("error");
      return;
    }
    // Claimed BEFORE the first await. Moving the frame, swapping the file and
    // resetting all bump the same counter, so a mismatch on the way out means
    // "the frame this run was for is gone" — drop the bytes silently rather
    // than publishing a download for a rectangle nobody is looking at.
    const generation = (runGenerationRef.current += 1);
    setStatus("processing");
    setError(null);
    setElapsed(null);
    const startedAt = performance.now();
    try {
      const freshData = new Uint8Array(await file.arrayBuffer());
      // No page indices: the crop applies to every page. The engine clamps the
      // rectangle to each page's own visible area, so a mixed-size document
      // crops per page rather than producing degenerate sheets.
      const bytes = await cropPdfPages(freshData, rect);
      if (runGenerationRef.current !== generation) return;
      setResult(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      // A tiny PDF finishes in tens of milliseconds; "Done in 0.0 s" reads
      // like a stopwatch that never started. Sub-second runs report ms.
      const ms = performance.now() - startedAt;
      setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
      setStatus("done");
    } catch (err) {
      // An abandoned run's failure is not the user's problem either — the
      // frame it failed on is no longer the one on screen, and surfacing it
      // would put an error box over a perfectly valid new frame.
      if (runGenerationRef.current !== generation) return;
      setError(err instanceof Error ? err.message : "Failed to crop PDF");
      setStatus("error");
    }
  }, [file, preview, toPdfRect]);

  const handleReset = useCallback(() => {
    runGenerationRef.current += 1;
    setFile(null);
    setPageCount(0);
    setPreview(null);
    setCropBox(null);
    setResult(null);
    setElapsed(null);
    setStatus("idle");
    setError(null);
    setAspect("Free");
    previewLoadedRef.current = false;
  }, []);

  if (!file) return <DropZone accept=".pdf" onFiles={handleFiles} />;

  const rect = cropBox && preview ? toPdfRect(cropBox, preview) : null;
  const sourceLabel = preview
    ? `${Math.round(preview.pageWidth)} × ${Math.round(preview.pageHeight)} PT`
    : "—";
  const cropLabel = rect ? `${Math.round(rect.width)} × ${Math.round(rect.height)} PT` : "—";

  return (
    <>
      {/* ── Canvas: page 1 with the crop frame over it ───────── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={`${pageCount} PAGE${pageCount !== 1 ? "S" : ""} · ${formatFileSize(file.size)}`}
          trailing={cropLabel}
        />

        <CanvasStage className={cn(STAGE_GROW, "flex bg-bg-secondary")}>
          {preview && (
            /* eslint-disable-next-line @next/next/no-img-element -- data: URL of a canvas we rendered; nothing for next/image to optimise under output: "export" */
            <img
              ref={imgRef}
              src={preview.url}
              alt="Page 1 — drag the handles to set the crop area"
              className="block max-h-full max-w-full"
            />
          )}
        </CanvasStage>

        <StatStrip
          stats={[
            { label: "PAGE 1", value: sourceLabel, tone: "neutral" },
            { label: "CROP", value: cropLabel },
            {
              label: "IN MM",
              value: rect ? mmLabel(rect.width, rect.height) : "—",
              tone: "neutral",
            },
            /*
              Was `ALL ${pageCount}`, which claimed every page had been
              cropped. MEASURED against the shipped engine: a page whose
              visible rect does not intersect the mapped frame at all reaches
              `if (!box) continue` (pdf-engine-core.ts:782) and comes out at
              its ORIGINAL full size. `cropPdfPages` returns bytes only — it
              has no channel for a skipped-page count — so this strip cannot
              say how many pages the frame really reached. It states the one
              number it knows instead, and the APPLIES TO panel carries the
              exception in words.
            */
            { label: "PAGES", value: pageCount ? `${pageCount} IN FILE` : "—", tone: "neutral" },
          ]}
        />

        {/*
          The honesty line the registry's aboutText is NOT allowed to carry
          alone. Cropping a PDF moves the page boxes; the marks outside them
          are still in the file and any tool that widens the boxes back out
          gets them back. That is the difference between cropping and
          redaction, and this app has no redaction tool — so the person about
          to crop a bank statement has to read it here, next to the button.
        */}
        <CanvasFootnote>
          CROPPING HIDES CONTENT — IT DOES NOT DELETE IT. THE AREA OUTSIDE THE FRAME STAYS IN
          THE FILE AND CAN BE RECOVERED. THIS IS NOT REDACTION.
        </CanvasFootnote>

        {error && <ErrorMessage message={error} />}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {(status === "loading" || status === "processing") && (
              <ToolProgress
                phase={status === "loading" ? "RENDERING PAGE" : "CROPPING"}
                percent={null}
                label={status === "loading" ? "Rendering page" : "Cropping pages"}
              />
            )}
            {elapsed && <ToolDone elapsed={elapsed} />}
            {result ? (
              <DownloadButton
                blob={result}
                fileName={file.name.replace(/\.pdf$/i, "-cropped.pdf")}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel={
                  status === "processing"
                    ? "Cropping…"
                    : pageCount === 0
                      ? "Crop pages"
                      : `Crop ${pageCount} page${pageCount !== 1 ? "s" : ""}`
                }
                onPrimary={handleCrop}
                // `!cropBox` is the readiness term, not decoration: `preview`
                // is set the commit the <img> first renders, but cropperjs
                // only fires its first `crop` event from `build()` — i.e. once
                // `ready` is true and `getData()` stops returning zeros. See
                // the measured note in `handleCrop`.
                primaryDisabled={
                  !preview || !cropBox || status === "processing" || status === "loading"
                }
              />
            )}
            <ToolResetLink onClick={handleReset} label="CHANGE FILE" />
          </>
        }
      >
        <ToolControlGroup>
          <ToolControl label="ASPECT">
            <ToolChoice
              label="Crop aspect ratio"
              fill
              value={aspect}
              onChange={handleAspect}
              disabled={!preview || status === "processing"}
              options={ASPECT_RATIOS.map((a) => ({ value: a.label, label: a.label }))}
            />
          </ToolControl>

          {/* The frame has no keyboard affordance of its own — cropperjs 1.6.2
              draws it from pointer events and gives it neither focus nor ARIA.
              These four fields ARE that frame, so the crop area is reachable,
              readable and settable without a pointer. */}
          <ToolControl label="CROP FRAME">
            <div className="grid grid-cols-2 gap-2">
              {CROP_FIELDS.map(([key, fieldLabel]) => (
                <label key={key} className="flex min-w-0 flex-col gap-1">
                  <span className="font-body text-[11px] text-text-muted">{fieldLabel}</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={
                      cropBox && preview ? Math.round(fieldToPoints(cropBox, preview, key)) : ""
                    }
                    placeholder="—"
                    onChange={(e) => setCropField(key, Number(e.target.value))}
                    aria-label={`Crop ${fieldLabel.toLowerCase()} in points from the page's top-left corner`}
                    // `!cropBox` is a readiness term, not decoration: until
                    // cropperjs has fired its first `crop` event `setData` is a
                    // silent no-op and a typed number would vanish. Same signal
                    // the primary is gated on.
                    disabled={
                      !preview || !cropBox || status === "processing" || status === "loading"
                    }
                    className={NUMBER_FIELD_CLASS}
                  />
                </label>
              ))}
            </div>
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              Points (1/72 inch), measured from the page&apos;s top-left corner. Drag the handles
              on the page, or type here — the arrow keys nudge a field by one point.
            </span>
          </ToolControl>

          <ToolControl label="CROP AREA">
            <ToolOutput
              rows={[
                ["Page 1", sourceLabel],
                ["Crop", cropLabel],
                ["Millimetres", rect ? mmLabel(rect.width, rect.height) : "—"],
              ]}
            />
            <button
              type="button"
              onClick={handleResetCrop}
              disabled={!preview || status === "processing"}
              className="cursor-pointer self-start text-xs text-accent transition-colors hover:text-accent-hover disabled:cursor-not-allowed disabled:text-text-muted"
            >
              Reset crop frame
            </button>
          </ToolControl>
        </ToolControlGroup>

        {/*
          MEASURED, and the reason this no longer says "applied to every page":
          `cropPdfPages` maps the frame into each page's own space and
          intersects it with that page's visible rect. A page that OVERLAPS the
          frame keeps the clamped sliver — that half of the old copy was true
          (a 700 pt-tall second page came back 535 × 50 next to page 1's
          535 × 150). A page the frame does not reach AT ALL takes
          `intersectRect` → null → `if (!box) continue` (pdf-engine-core.ts:
          781-782) and is written out at its original full size, untouched. The
          engine's own docblock calls that deliberate — better than emitting a
          degenerate sheet — and it is not changing. What was wrong was that no
          surface said so: a portrait report with one landscape page, cropped
          along the top band of page 1, silently leaves the landscape page
          whole. There is no skipped-page count to show (the engine returns
          bytes only), so the exception is stated in words.
        */}
        <ToolAsideSection label="APPLIES TO">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            The frame you set on page 1 is offered to <strong>every page</strong> and clamped to
            each page&apos;s own visible area. In a document whose pages are not all the same size,
            a page that only partly overlaps the frame keeps the part that fits — so pages can end
            up cropped differently. A page the frame misses completely, such as a landscape sheet
            under a frame set near the top of a portrait one, is left uncropped at its original
            size, and nothing here can tell you afterwards which pages those were.
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="WHAT CROPPING DOES">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Cropping rewrites the page boxes — the rectangles a reader draws — and never touches
            the content. Nothing is scaled or moved, so text stays selectable and images are
            never re-encoded. The flip side: the content outside the frame is still in the file.
            It is hidden, not removed, and widening the boxes brings it back. Use a redaction
            tool if the point is that nobody can ever see it.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
