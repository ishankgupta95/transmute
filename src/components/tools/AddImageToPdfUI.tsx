"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import {
  loadPdfjsDocument,
  renderPageFromDoc,
  stampPdf,
  type PdfStamp,
} from "@/lib/tools/pdf-engine";
import { readImageOrientation } from "@/lib/tools/image-orientation";
import { canvasToBlob, loadImage } from "@/lib/tools/canvas-utils";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolDone,
  ToolOutput,
  ToolResetLink,
  ToolSlider,
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
import { cn } from "@/lib/utils/cn";

/*
  ADD IMAGE TO PDF — place one picture on the pages of an existing document.

  The engine is `stampPdf` (pdf-engine.ts → pdf-engine-core.ts:1975), the same
  op the watermark / signature / annotate pages use. It takes placement as
  FRACTIONS of the page AS DISPLAYED, measured from the page's top-left corner,
  which is exactly what an overlay drawn on a rasterised preview can report —
  so the number in the X field, the marker on the page and the argument handed
  to the engine are one value, never three that have to agree.

  TWO THINGS THIS FILE IS CAREFUL ABOUT, both of them measured rather than
  assumed:

  1. EXIF ORIENTATION. `stampPdf` embeds the image bytes UNCHANGED
     (`pdf.embedPng` / `pdf.embedJpg`, pdf-engine-core.ts:1998) and sizes the
     draw from the STORED sample grid (`image.height / image.width`,
     pdf-engine-core.ts:2111). pdf-lib never decodes, and a PDF reader never
     looks at an EXIF Orientation tag inside a `/DCTDecode` stream — but every
     image viewer, and the `<img>` this page previews with, does. So a phone
     photo tagged Orientation 6 previews upright and would be embedded on its
     side, at the wrong aspect ratio. `imagesToPdf` answers that with a
     placement transform (pdf-engine-core.ts:1448-1490); `stampPdf` has no such
     arm, so the cure here is to bake the rotation into the pixels BEFORE the
     bytes reach the engine — see `prepareImage`. Baking is also the answer
     that survives an engine fix: an image whose tag is already 1 is drawn the
     same way by every version.

  2. STALE RESULTS. Every control changes what a run would produce, and the
     footer swaps the primary out for a Download the moment there is a result.
     `invalidate()` runs in front of every setter and bumps a token a run in
     flight is checked against, so a finished PDF can never sit under settings
     that no longer describe it.
*/

/** The doc's one field box — the shape `AddPageNumbersUI` and `RangeField` wear. */
const FIELD_CLASS =
  "h-[30px] w-full rounded-[7px] border border-border bg-bg-elevated px-2.5 font-mono text-xs leading-none text-text-primary focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-45";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * The two byte formats pdf-lib can embed, decided by MAGIC BYTES.
 *
 * Names and MIME types lie — a WebP saved as `logo.png` is a file the picker's
 * `accept` list waves through and `embedPng` then rejects with a parser
 * internal. The sniff is the same rule `images-to-pdf-prep.ts` uses one
 * directory over, kept local because that module statically imports the
 * HEIC/TIFF decoders and this page has no use for them.
 */
function sniffImageType(bytes: Uint8Array): "image/png" | "image/jpeg" | null {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return "image/png";
  return null;
}

/**
 * Quality for the re-encode an EXIF-tagged JPEG needs. The same 0.92 the
 * images→PDF family re-encodes at (`PDF_JPEG_QUALITY`, images-to-pdf-prep.ts) —
 * not imported, because that module reaches libheif and utif2.
 */
const REENCODE_JPEG_QUALITY = 0.92;

interface PlacedImage {
  name: string;
  /** What goes to the engine — original bytes, or the re-encoded ones. */
  bytes: Uint8Array;
  type: "image/png" | "image/jpeg";
  /** Object URL of exactly those bytes, so the preview is the embedded picture. */
  url: string;
  /** Size of the picture the engine will draw, in its own pixels. */
  width: number;
  height: number;
  /** Bytes on disk, for the readout. */
  sourceSize: number;
  /** The EXIF Orientation the file carried. 1 means "as stored". */
  orientation: number;
  /** True when the rotation had to be baked in, which costs a re-encode. */
  reencoded: boolean;
}

interface PagePreview {
  /** Data URL of the rasterised page. */
  url: string;
  /** The page's VISUAL size in points — pdfjs's scale-1 viewport, /Rotate applied. */
  pageWidth: number;
  pageHeight: number;
  /** The page's own /Rotate, normalised to 0/90/180/270. See the warning below. */
  rotate: number;
}

type PagesChoice = "all" | "first" | "last" | "one";

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10));
}

export function AddImageToPdfUI() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [previewPage, setPreviewPage] = useState(1);
  const [preview, setPreview] = useState<PagePreview | null>(null);
  const [image, setImage] = useState<PlacedImage | null>(null);

  // The placement, in PER CENT of the displayed page from its top-left corner.
  // These four numbers ARE the stamp: the X/Y fields, the marker on the page
  // and the `at`/`widthFraction` handed to the engine read the same state, so
  // the drag and the fields cannot disagree — the rule `PixelateImageUI`
  // established, and the reason this tool is usable without a pointer.
  const [xPercent, setXPercent] = useState(10);
  const [yPercent, setYPercent] = useState(10);
  const [widthPercent, setWidthPercent] = useState(25);
  const [opacityPercent, setOpacityPercent] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [behind, setBehind] = useState(false);
  const [pagesChoice, setPagesChoice] = useState<PagesChoice>("all");

  const [status, setStatus] = useState<"idle" | "loading" | "processing" | "done" | "error">(
    "idle",
  );
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  // The doc pins a "Done in 1.4 s" card above the primary once a run finishes.
  // Timed for real; cleared the moment any input changes.
  const [elapsed, setElapsed] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  /**
   * Which run owns the panel. Dropping the blob is not enough on its own: a run
   * is async, nothing cancels it, and `ToolActions` binds ⌘↵ on the WINDOW — so
   * a run started before a drag can resolve after it and put a Download back
   * over a placement nobody chose. A run captures this before its first await
   * and commits nothing unless it still matches.
   */
  const runToken = useRef(0);

  const invalidate = useCallback(() => {
    runToken.current += 1;
    setResult(null);
    setElapsed(null);
    setError(null);
    setStatus((s) => (s === "done" || s === "processing" ? "idle" : s));
  }, []);

  const handleFiles = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      setFile(f);
      setPageCount(0);
      setPreviewPage(1);
      setPreview(null);
      invalidate();
    },
    [invalidate],
  );

  /*
    One pdfjs parse per previewed page, for both facts the placement needs: how
    big the page is as a reader shows it, and what it looks like. Re-opening the
    document when the page changes costs a parse; holding the proxy open across
    renders would cost a ref read during render, which `react-hooks/refs`
    rejects, and pdfjs pins every page's operator list in its worker until the
    proxy is destroyed.

    No setState before the first await: the code ahead of it runs synchronously
    in the effect body, which is what `react-hooks/set-state-in-effect` is about.
  */
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    let doc: Awaited<ReturnType<typeof loadPdfjsDocument>> | null = null;
    (async () => {
      try {
        const data = await file.arrayBuffer();
        if (cancelled) return;
        setStatus((s) => (s === "processing" ? s : "loading"));
        doc = await loadPdfjsDocument(data);
        if (cancelled) return;
        setPageCount(doc.numPages);
        const wanted = Math.min(Math.max(1, previewPage), doc.numPages);
        const page = await doc.getPage(wanted);
        const visual = page.getViewport({ scale: 1 });
        // Big enough to place an edge on a line of type, capped so a tabloid
        // sheet does not become a 20 MB data URL held in React state.
        const scale = Math.min(2.5, Math.max(0.75, 1000 / visual.width));
        const canvas = await renderPageFromDoc(doc, wanted, scale);
        if (cancelled) return;
        setPreview({
          // JPEG, not PNG: pdfjs paints an opaque white page background, so
          // there is no alpha to lose and no multi-megabyte string to hold.
          url: canvas.toDataURL("image/jpeg", 0.9),
          pageWidth: visual.width,
          pageHeight: visual.height,
          rotate: ((page.rotate % 360) + 360) % 360,
        });
        setStatus((s) => (s === "loading" ? "idle" : s));
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to render this page");
        setStatus("error");
      } finally {
        await doc?.destroy();
        doc = null;
      }
    })();
    return () => {
      cancelled = true;
      void doc?.destroy();
    };
  }, [file, previewPage]);

  /*
    Turn a picked file into bytes the engine can embed and a preview that shows
    the same picture.

    The EXIF arm is the load-bearing half. `<img>` applies the Orientation tag,
    so `naturalWidth`/`naturalHeight` are the size a person SEES; `embedPng` /
    `embedJpg` take `/Width` and `/Height` from the stored grid and ignore the
    tag entirely. Where the two differ, the picture is redrawn through a canvas
    at its displayed size — a canvas writes no EXIF, so the bytes that reach the
    engine are tagged nothing and stored the way they look. A JPEG pays a
    re-encode for that, which the rail says out loud.
  */
  const prepareImage = useCallback(async (picked: File): Promise<PlacedImage> => {
    const raw = new Uint8Array(await picked.arrayBuffer());
    const type = sniffImageType(raw);
    if (!type) {
      throw new Error(
        "This tool can place PNG and JPEG images, which are the two formats a PDF can hold directly. This file is neither — convert it first.",
      );
    }
    const orientation = readImageOrientation(raw, type);
    const decoded = await loadImage(new Blob([raw as BlobPart], { type }));
    const width = decoded.naturalWidth;
    const height = decoded.naturalHeight;
    if (!width || !height) throw new Error("This image could not be decoded.");

    if (orientation === 1) {
      // Nothing to correct, so the original bytes go in untouched — no
      // re-encode, no generational loss, and a PNG keeps its exact pixels.
      return {
        name: picked.name,
        bytes: raw,
        type,
        url: URL.createObjectURL(new Blob([raw as BlobPart], { type })),
        width,
        height,
        sourceSize: picked.size,
        orientation,
        reencoded: false,
      };
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser would not give us a canvas to redraw the image on.");
    ctx.drawImage(decoded, 0, 0, width, height);
    const blob = await canvasToBlob(
      canvas,
      type,
      type === "image/jpeg" ? REENCODE_JPEG_QUALITY : undefined,
    );
    return {
      name: picked.name,
      bytes: new Uint8Array(await blob.arrayBuffer()),
      type,
      url: URL.createObjectURL(blob),
      width,
      height,
      sourceSize: picked.size,
      orientation,
      reencoded: true,
    };
  }, []);

  const handleImageFile = useCallback(
    async (picked: File | undefined) => {
      if (!picked) return;
      invalidate();
      setImageError(null);
      try {
        const prepared = await prepareImage(picked);
        setImage(prepared);
      } catch (err) {
        setImage(null);
        setImageError(err instanceof Error ? err.message : "Could not read this image.");
      }
    },
    [invalidate, prepareImage],
  );

  /*
    One object URL is alive at a time. The cleanup fires when `image.url`
    changes or the page unmounts; at mount the value is null, so React's
    double-invoke in development has nothing to revoke.
  */
  const imageUrl = image?.url ?? null;
  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  /** Pointer position → the placement fraction, in per cent. */
  const pointToPercent = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const box = stageRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0 || box.height <= 0) return null;
    return {
      x: clampPercent(((e.clientX - box.left) / box.width) * 100),
      y: clampPercent(((e.clientY - box.top) / box.height) * 100),
    };
  }, []);

  const moveTo = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const point = pointToPercent(e);
      if (!point) return;
      invalidate();
      setXPercent(point.x);
      setYPercent(point.y);
    },
    [invalidate, pointToPercent],
  );

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (status === "processing") return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Not every environment implements pointer capture, and a gesture is
        // not worth refusing over it. Without it a release outside the stage is
        // never seen here, so the drag ends at the next pointerdown instead —
        // and every write it makes on the way goes through `invalidate()`, so
        // the worst case is a marker that keeps following the pointer, never a
        // download that stops matching one.
      }
      setDragging(true);
      moveTo(e);
    },
    [moveTo, status],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      moveTo(e);
    },
    [dragging, moveTo],
  );

  const endDrag = useCallback(() => setDragging(false), []);

  const handlePlace = useCallback(async () => {
    if (!file || !image) return;
    // Claimed BEFORE the first await; moving the marker, swapping either file
    // and resetting all bump the same counter.
    const token = (runToken.current += 1);
    setStatus("processing");
    setError(null);
    setElapsed(null);
    setResult(null);
    const startedAt = performance.now();
    try {
      const stamp: PdfStamp = {
        kind: "image",
        bytes: image.bytes,
        type: image.type,
        pages: pagesChoice === "one" ? [previewPage - 1] : pagesChoice,
        at: { x: xPercent / 100, y: yPercent / 100 },
        opacity: opacityPercent / 100,
        rotate: rotation,
        widthFraction: widthPercent / 100,
        behind,
        // Repeating one picture across a grid is what Watermark PDF is for;
        // this tool places it once per chosen page.
        tile: false,
      };
      const bytes = await stampPdf(await file.arrayBuffer(), [stamp]);
      // Superseded while it ran: the placement or a file changed under it, so
      // this output describes a document nobody is looking at.
      if (runToken.current !== token) return;
      setResult(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      // A small PDF finishes in tens of milliseconds; "Done in 0.0 s" reads
      // like a stopwatch that never started. Sub-second runs report ms.
      const ms = performance.now() - startedAt;
      setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
      setStatus("done");
    } catch (err) {
      if (runToken.current !== token) return;
      setError(err instanceof Error ? err.message : "Failed to place the image");
      setStatus("error");
    }
  }, [
    behind,
    file,
    image,
    opacityPercent,
    pagesChoice,
    previewPage,
    rotation,
    widthPercent,
    xPercent,
    yPercent,
  ]);

  const handleReset = useCallback(() => {
    setFile(null);
    setPageCount(0);
    setPreviewPage(1);
    setPreview(null);
    setImage(null);
    setImageError(null);
    invalidate();
  }, [invalidate]);

  if (!file) return <DropZone accept=".pdf" onFiles={handleFiles} label="Upload a PDF" />;

  // ── Derived readouts. Everything below describes the CURRENT settings, and
  //    `invalidate()` guarantees there is no finished file under them. ──
  const placedWidthPt = preview ? (preview.pageWidth * widthPercent) / 100 : null;
  const placedHeightPt =
    placedWidthPt !== null && image ? (image.height / image.width) * placedWidthPt : null;
  const pagesLabel =
    pagesChoice === "all"
      ? pageCount
        ? `ALL ${pageCount}`
        : "ALL"
      : pagesChoice === "first"
        ? "PAGE 1"
        : pagesChoice === "last"
          ? pageCount
            ? `PAGE ${pageCount}`
            : "LAST"
          : `PAGE ${previewPage}`;

  /*
    Does the un-rotated box run off the sheet? Only asked at rotation 0: a
    turned image sweeps a different rectangle, and a footnote that guessed at it
    would be stating something this file has not worked out.
  */
  const heightFraction =
    placedHeightPt !== null && preview ? placedHeightPt / preview.pageHeight : null;
  const overflows =
    rotation === 0 &&
    heightFraction !== null &&
    (xPercent + widthPercent > 100 || yPercent + heightFraction * 100 > 100);

  return (
    <>
      {/* ── Canvas: the page, with the image where it will land ── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={
            pageCount
              ? `${pageCount} PAGE${pageCount !== 1 ? "S" : ""} · ${formatFileSize(file.size)}`
              : formatFileSize(file.size)
          }
          trailing={pagesLabel}
        />

        {/*
          A BLOCK stage, not a flex row. As a flex item the wrapper's
          `min-width: auto` resolves against the rasterised page's intrinsic
          width — a 1000px-wide render — so on a phone the canvas column would
          have been pushed past the viewport and the body would scroll
          sideways. `mx-auto` centres it without that.
        */}
        <CanvasStage className="p-[15px]">
          {preview ? (
            <div
              ref={stageRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onLostPointerCapture={endDrag}
              style={{
                aspectRatio: `${preview.pageWidth} / ${preview.pageHeight}`,
                maxWidth: `calc(${preview.pageWidth / preview.pageHeight} * min(62vh, 720px))`,
              }}
              className={cn(
                "relative mx-auto w-full touch-none overflow-hidden rounded-[5px] border border-border",
                status === "processing" ? "cursor-default" : "cursor-crosshair",
              )}
            >
              {/*
                The wrapper carries the PAGE's aspect ratio and the image fills
                it edge to edge, so a fraction of the box is a fraction of the
                page — no letterbox band to account for, which is what would
                otherwise make the marker and the output disagree.
              */}
              {/* eslint-disable-next-line @next/next/no-img-element -- data: URL of a canvas we rendered; nothing for next/image to optimise under output: "export" */}
              <img
                src={preview.url}
                alt={`Page ${previewPage} — click or drag to move the image`}
                className="block h-full w-full"
                draggable={false}
              />
              {image && (
                /* eslint-disable-next-line @next/next/no-img-element -- blob: URL of the exact bytes handed to the engine; next/image cannot optimise a local object URL under output: "export" */
                <img
                  src={image.url}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  className="pointer-events-none absolute block"
                  style={{
                    left: `${xPercent}%`,
                    top: `${yPercent}%`,
                    width: `${widthPercent}%`,
                    height: "auto",
                    opacity: opacityPercent / 100,
                    // The engine anchors the draw at the image's BOTTOM-left
                    // corner and turns it about that point
                    // (pdf-engine-core.ts:2114-2121), so the preview turns
                    // about the same corner. Negated because a positive PDF
                    // angle is counter-clockwise and a positive CSS angle is
                    // clockwise.
                    transform: `rotate(${-rotation}deg)`,
                    transformOrigin: "left bottom",
                  }}
                />
              )}
            </div>
          ) : (
            <div className="flex h-[220px] items-center justify-center">
              <span className="font-mono text-[10.5px] leading-none text-text-muted">
                RENDERING PAGE {previewPage}
              </span>
            </div>
          )}
        </CanvasStage>

        <StatStrip
          stats={[
            {
              label: `PAGE ${previewPage}`,
              value: preview
                ? `${Math.round(preview.pageWidth)} × ${Math.round(preview.pageHeight)} PT`
                : "—",
              tone: "neutral",
            },
            {
              label: "IMAGE",
              value: image ? `${image.width}×${image.height}` : "NONE",
            },
            {
              label: "PLACED",
              value:
                placedWidthPt !== null && placedHeightPt !== null
                  ? `${Math.round(placedWidthPt)} × ${Math.round(placedHeightPt)} PT`
                  : "—",
              tone: "neutral",
            },
            { label: "PAGES", value: pagesLabel, tone: "neutral" },
          ]}
        />

        {/*
          Two sentences because the marker means two different things. The
          engine turns an image about its BOTTOM-left corner
          (pdf-engine-core.ts:2114-2121) while X and Y name its TOP-left, so
          "the corner lands here" is only true while Turn is 0.
        */}
        <CanvasFootnote>
          {!image
            ? "CHOOSE A PNG OR JPEG UNDER IMAGE TO SEE IT ON THE PAGE"
            : rotation === 0
              ? "CLICK OR DRAG ON THE PAGE TO PUT THE IMAGE'S TOP-LEFT CORNER THERE — THE X AND Y FIELDS DO THE SAME THING"
              : `CLICK OR DRAG TO MOVE THE IMAGE — AT ${rotation}° IT SWINGS ABOUT ITS BOTTOM-LEFT CORNER, SO THE MARKER IS WHERE ITS TOP-LEFT WOULD SIT UNTURNED`}
        </CanvasFootnote>

        {/*
          The rotated-page warning that stood here is GONE because the engine
          defect it described is fixed. `stampPdf` anchored an image with
          `y: origin.y - height` — a top-left-to-bottom-left correction along the
          UNROTATED y axis — which only means "down the page" at /Rotate 0. It
          now shifts along `displayedDownUnit` (pdf-stamp-core.ts), which asks
          `fractionToUserSpace` where the top and bottom of the DISPLAYED page
          are rather than tabulating four vectors that could drift from it.

          Verified across all four rotations after the fix: the requested
          (25%, 25%) puts the image's top-left at (25.0%, 25.0%) every time,
          where before it was (15.0%, 10.9%) at 90, (25.0%, 10.9%) at 180 and
          (35.0%, 10.9%) at 270. Pinned by an it.each over the four rotations in
          pdf-engine-stamp-forms.test.ts, mutation-proven by restoring the old
          line. Nothing on this page compensates for rotation, and nothing
          should: the engine is correct now, and a UI that quietly corrected for
          an engine bug would double-correct the day the engine was fixed.
        */}

        {image?.reencoded && (
          <WarningMessage
            message={
              image.type === "image/jpeg"
                ? `This photo carried an EXIF Orientation of ${image.orientation}, which a PDF reader ignores, so it was redrawn upright and re-encoded as JPEG at quality ${Math.round(
                    REENCODE_JPEG_QUALITY * 100,
                  )}%. That is one generation of JPEG loss, and the EXIF block — including any GPS position — is gone from the copy that goes into the PDF.`
                : `This PNG carried an EXIF Orientation of ${image.orientation}, which a PDF reader ignores, so it was redrawn upright before being embedded. PNG re-encoding is lossless, so no detail was lost; the metadata chunks did not survive the redraw.`
            }
          />
        )}

        {overflows && (
          <CanvasFootnote>
            PART OF THE IMAGE FALLS PAST THE PAGE EDGE AT THIS POSITION AND SIZE — A READER SHOWS
            ONLY WHAT IS INSIDE THE PAGE
          </CanvasFootnote>
        )}

        {imageError && <ErrorMessage message={imageError} />}
        {error && <ErrorMessage message={error} />}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {(status === "loading" || status === "processing") && (
              <ToolProgress
                phase={status === "loading" ? "RENDERING PAGE" : "PLACING IMAGE"}
                percent={null}
                label={status === "loading" ? "Rendering page" : "Placing image"}
              />
            )}
            {elapsed && <ToolDone elapsed={elapsed} />}
            {result ? (
              <DownloadButton
                blob={result}
                fileName={file.name.replace(/\.pdf$/i, "-with-image.pdf")}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel={status === "processing" ? "Placing…" : "Place image"}
                onPrimary={handlePlace}
                primaryDisabled={!image || !preview || status === "processing"}
              />
            )}
            <ToolResetLink onClick={handleReset} label="CHANGE FILE" />
          </>
        }
      >
        <ToolAsideSection label="IMAGE">
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            disabled={status === "processing"}
            className="cursor-pointer rounded-md border border-accent bg-accent/8 px-3 py-2 font-body text-xs text-accent transition-colors duration-200 hover:bg-accent/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
          >
            {image ? "Choose a different image" : "Choose an image"}
          </button>
          <input
            ref={imageInputRef}
            type="file"
            accept=".png,.jpg,.jpeg"
            className="hidden"
            onChange={(e) => {
              void handleImageFile(e.target.files?.[0]);
              // The same file twice in a row must still fire a change event.
              e.target.value = "";
            }}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {image
              ? `${image.name} — ${image.width} × ${image.height} px, ${formatFileSize(
                  image.sourceSize,
                )}`
              : "PNG or JPEG. These are the two formats a PDF can carry as-is; the file's own bytes decide, not its name."}
          </span>
        </ToolAsideSection>

        <ToolControlGroup>
          <ToolControl label="POSITION">
            {/* The two fields ARE the stored placement, in per cent of the
                displayed page from its top-left corner. Dragging on the page
                writes the same two numbers, which is why the two can never
                disagree — and why the placement is reachable with no pointer
                at all. */}
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["X", xPercent, setXPercent] as const,
                  ["Y", yPercent, setYPercent] as const,
                ]
              ).map(([label, value, set]) => (
                <label key={label} className="flex min-w-0 flex-col gap-1">
                  <span className="font-body text-[11px] text-text-muted">{label}</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={value}
                    onChange={(e) => {
                      invalidate();
                      set(clampPercent(Number(e.target.value)));
                    }}
                    aria-label={`${label} position, per cent across the page from its top-left corner`}
                    disabled={status === "processing"}
                    className={FIELD_CLASS}
                  />
                </label>
              ))}
            </div>
          </ToolControl>

          <ToolControl>
            <ToolSlider
              label="Width"
              display={
                placedWidthPt !== null
                  ? `${widthPercent}% · ${Math.round(placedWidthPt)} pt`
                  : `${widthPercent}%`
              }
              hint="Per cent of the page's width. The height follows the image's own proportions, so nothing is stretched."
              min={1}
              max={100}
              step={1}
              value={widthPercent}
              onChange={(v) => {
                invalidate();
                setWidthPercent(v);
              }}
              disabled={status === "processing"}
            />
          </ToolControl>

          <ToolControl>
            <ToolSlider
              label="Opacity"
              display={`${opacityPercent}%`}
              hint="Below 100% the page shows through the image."
              min={5}
              max={100}
              step={5}
              value={opacityPercent}
              onChange={(v) => {
                invalidate();
                setOpacityPercent(v);
              }}
              disabled={status === "processing"}
            />
          </ToolControl>

          <ToolControl>
            <ToolSlider
              label="Turn"
              display={`${rotation}°`}
              hint="Counter-clockwise, pivoting on the image's bottom-left corner rather than its middle — so it swings from that corner instead of turning in place."
              min={-180}
              max={180}
              step={5}
              value={rotation}
              onChange={(v) => {
                invalidate();
                setRotation(v);
              }}
              disabled={status === "processing"}
            />
          </ToolControl>

          <ToolControl label="PAGES">
            <ToolChoice
              label="Which pages get the image"
              fill
              value={pagesChoice}
              disabled={status === "processing"}
              onChange={(v: PagesChoice) => {
                invalidate();
                setPagesChoice(v);
              }}
              options={[
                { value: "all", label: "All" },
                { value: "first", label: "First" },
                { value: "last", label: "Last" },
                { value: "one", label: "One" },
              ]}
            />
            <label className="flex min-w-0 flex-col gap-1">
              <span className="font-body text-[11px] text-text-muted">
                Page shown{pagesChoice === "one" ? ", and the one that gets the image" : ""}
              </span>
              <input
                type="number"
                min={1}
                max={Math.max(1, pageCount)}
                step={1}
                value={previewPage}
                onChange={(e) => {
                  const wanted = Math.round(Number(e.target.value));
                  if (!Number.isFinite(wanted)) return;
                  invalidate();
                  setPreviewPage(Math.min(Math.max(1, wanted), Math.max(1, pageCount)));
                }}
                aria-label="Page to preview"
                disabled={status === "processing" || pageCount === 0}
                className={FIELD_CLASS}
              />
            </label>
          </ToolControl>

          <ToolControl label="LAYER">
            <ToolChoice
              label="Where the image sits in the page"
              fill
              value={behind ? "under" : "over"}
              disabled={status === "processing"}
              onChange={(v: string) => {
                invalidate();
                setBehind(v === "under");
              }}
              options={[
                { value: "over", label: "Over content" },
                { value: "under", label: "Under content" },
              ]}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              {behind
                ? "The image is drawn before the page's own content, so text and pictures cover it. A page with a filled background will hide it completely."
                : "The image is drawn last, so it covers whatever is under it."}
            </span>
          </ToolControl>
        </ToolControlGroup>

        <ToolAsideSection label="PLACEMENT">
          <ToolOutput
            rows={[
              ["Position", `${xPercent}% , ${yPercent}%`],
              [
                "Size",
                placedWidthPt !== null && placedHeightPt !== null
                  ? `${Math.round(placedWidthPt)} × ${Math.round(placedHeightPt)} pt`
                  : "—",
              ],
              ["Opacity", `${opacityPercent}%`],
              ["Pages", pagesLabel],
            ]}
          />
        </ToolAsideSection>

        <ToolAsideSection label="WHAT THIS DOES">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            The picture is drawn <strong>into the page&apos;s content</strong>, the same way the
            text around it is. It is not an annotation object, so nobody can click it in a reader
            and drag it or delete it — and neither can you. Keep the original PDF if you might
            want the page back without it.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            PNG and JPEG bytes go into the document as they are, so a photo is not re-compressed
            and a PNG&apos;s transparency is carried through as a soft mask — a logo with a
            transparent background stays transparent over the page. The one exception is an image
            whose EXIF Orientation is not 1: a PDF reader ignores that tag, so the picture is
            redrawn upright first and the canvas above says so.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Nothing else about the document is touched — no page is resized, reordered or
            re-encoded, and the text stays selectable. The pages you did not choose keep their
            content exactly as it arrived.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
