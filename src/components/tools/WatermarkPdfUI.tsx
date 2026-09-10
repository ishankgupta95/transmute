"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
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
import { neutraliseJpegOrientation, readJpegOrientation } from "@/lib/tools/jpeg-orientation";
import { parsePageRange } from "@/lib/tools/media-preview";
import {
  ToolActions,
  ToolAdvanced,
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
import { CANVAS_COLUMN, STAGE_GROW } from "@/components/workspace/shared";
import { cn } from "@/lib/utils/cn";

/*
  Stamp a mark onto a PDF's pages — `stampPdf` (pdf-engine-core.ts:1975), the
  one engine op that also serves sign / add-image / annotate.

  The whole design problem here is that a placement has to be expressed in a
  frame the user can see. The engine solved that half: every stamp arrives as a
  FRACTION of the displayed page measured from its top-left corner, and
  `pdf-stamp-core.fractionToUserSpace` turns that into PDF user space with the
  page's CropBox, its box origin and its /Rotate all accounted for. So this
  component never touches PDF coordinates at all. It owns one number pair —
  "how far across, how far down" — and the preview draws that pair in the same
  units the engine consumes.

  The preview is an SVG whose viewBox IS the page's point size, laid over the
  rasterised page. That is not decoration: SVG's `<text x y>` puts the baseline
  at y and `<image x y>` puts the top-left at x,y, which is exactly what
  pdf-lib's `drawText` and this engine's `drawImage` call do
  (pdf-engine-core.ts:2095 and :2114). Point-for-point the overlay runs the
  engine's own arithmetic, so a mark that looks right here lands there.
*/

type MarkKind = "text" | "image";
type PageChoice = "all" | "first" | "last" | "range";
type Status = "idle" | "loading" | "processing" | "done" | "error";

const NUMBER_FIELD_CLASS =
  "w-full rounded-md border border-border bg-bg-elevated px-2.5 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-45";

const TEXT_FIELD_CLASS =
  "w-full rounded-md border border-border bg-bg-elevated px-2.5 py-2 text-sm text-text-primary placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-45";

const HINT_CLASS = "font-body text-[10.5px] leading-[1.5] text-text-muted";

/**
 * The characters pdf-lib's standard fonts can draw, as a codepoint test.
 *
 * The engine exports `unsupportedStampCharacters` for exactly this, but it
 * lives in `pdf-engine-core` and is NOT re-exported by `pdf-engine`, and
 * importing the core from a component pulls pdf-lib's 705 KB chunk onto the
 * main thread purely to answer a question about a text box. So the repertoire
 * is inlined instead — as a table, not as a rule of thumb.
 *
 * MEASURED 2026-09-10, not remembered, and DIFFERENTIALLY against the engine
 * rather than derived from a spec. Every codepoint of U+0020..U+FFFF (minus
 * the surrogate block), U+1F300..U+1F9FF and U+20000..U+2005F — 65,344 of them
 * — was pushed through both this predicate and
 * `font.widthOfTextAtSize(ch, 12)` on an embedded `StandardFonts.Helvetica`
 * from this repo's own pdf-lib: **0 mismatches**. The 218 the font accepts are
 * exactly `0x20..0x7e` (95) plus `0xa0..0xff` (96) plus the 27 listed below;
 * U+007F and U+0080..U+009F are NOT encodable and are correctly outside both
 * ranges. The seven text vectors `pdf-engine-stamp-forms.test.ts` pins for
 * `unsupportedStampCharacters` come back identical here, in the same order.
 *
 * ⚠ If the engine ever embeds a Unicode font, this table is a lie in the safe
 * direction (it refuses text the engine could draw) and should be deleted in
 * favour of the engine's own function.
 */
const WINANSI_EXTRAS = new Set([
  0x152, 0x153, 0x160, 0x161, 0x178, 0x17d, 0x17e, 0x192, 0x2c6, 0x2dc, 0x2013, 0x2014, 0x2018,
  0x2019, 0x201a, 0x201c, 0x201d, 0x201e, 0x2020, 0x2021, 0x2022, 0x2026, 0x2030, 0x2039, 0x203a,
  0x20ac, 0x2122,
]);

/**
 * The characters in `text` the engine would refuse, in the order they appear.
 *
 * Mirrors `unsupportedStampCharacters` including its newline exemption. The
 * point of running it HERE is that the engine throws — a run that gets as far
 * as `stampPdf` with a CJK character in it comes back as an error box, and the
 * user learns after pressing the button instead of while typing.
 */
function unsupportedCharacters(text: string): string[] {
  const bad: string[] = [];
  for (const character of text) {
    if (character === "\n" || character === "\r") continue;
    const cp = character.codePointAt(0) ?? 0;
    const drawable =
      (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WINANSI_EXTRAS.has(cp);
    if (!drawable && !bad.includes(character)) bad.push(character);
  }
  return bad;
}

/**
 * The 3 × 4 grid `tile` repeats on, from the engine's own formula
 * (`tileFractions`, pdf-engine-core.ts:2069-2077): columns at 0.14 / 0.43 /
 * 0.72 across, rows at 0.13 / 0.375 / 0.62 / 0.865 down, row-major.
 *
 * Recomputed rather than eyeballed because these twelve spots are what the
 * preview draws, and a preview that marked a grid the engine does not use
 * would be the most convincing kind of wrong.
 */
const TILE_SPOTS: readonly { x: number; y: number }[] = Array.from({ length: 12 }, (_, i) => ({
  x: 0.14 + (i % 3) * 0.29,
  y: 0.13 + Math.floor(i / 3) * 0.245,
}));

/** Percent, clamped to the page and rounded to a tenth so a field and a drag agree. */
function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10));
}

/**
 * PNG or JPEG, decided by the first bytes rather than by the file's name or
 * its `type`.
 *
 * `stampPdf` branches on `stamp.type` alone — `"image/png"` goes to
 * `embedPng`, anything else to `embedJpg` (pdf-engine-core.ts:1998). A PNG the
 * OS handed over with an empty `type`, or a `.png` that is really a JPEG,
 * would therefore be sent to the wrong embedder and throw a parser error at
 * the user. Four bytes of signature settle it.
 */
function sniffImageType(bytes: Uint8Array): "image/png" | "image/jpeg" | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  return null;
}

/** The rasterised first page, plus the page size the overlay is drawn in. */
interface PagePreview {
  /** Data URL of the rendered page. */
  url: string;
  /**
   * The page's VISUAL size in PDF points — pdfjs's scale-1 viewport, which has
   * /Rotate applied and is clipped to the CropBox. `stampPdf` measures its own
   * fractions against `displayedPageSize(visiblePageBox(...))`, which resolves
   * to the same rectangle, so the SVG viewBox below and the engine share one
   * coordinate system by construction rather than by coincidence.
   */
  width: number;
  height: number;
}

/** The mark image, decoded once so the preview and the engine cannot disagree. */
interface StampImage {
  name: string;
  size: number;
  /** Exactly the bytes that will be embedded. */
  bytes: Uint8Array;
  type: "image/png" | "image/jpeg";
  /** blob: URL for the overlay; revoked when this object is replaced. */
  url: string;
  /** The stored sample grid, which is what pdf-lib measures the image by. */
  width: number;
  height: number;
  /** The EXIF Orientation the JPEG arrived with; 1 for "none" and for a PNG. */
  exifOrientation: number;
}

/**
 * THE RUN'S FACTS RIDE ON THE RESULT OBJECT, the pattern
 * `ChangeImageDpiUI.tsx:141-166` sets out: what the readouts say about the
 * download is read off the download, never off the rail. Every control already
 * drops the result, so the two can only ever agree — but tying them together
 * means there is no invalidation left to get wrong.
 */
interface StampRun {
  blob: Blob;
  /** Pages the engine's own page resolution reached. */
  pages: number;
  kind: MarkKind;
  tiled: boolean;
}

export function WatermarkPdfUI() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [preview, setPreview] = useState<PagePreview | null>(null);

  const [mark, setMark] = useState<MarkKind>("text");
  const [text, setText] = useState("CONFIDENTIAL");
  const [fontSize, setFontSize] = useState(56);
  const [bold, setBold] = useState(true);
  const [colour, setColour] = useState("#d92d20");
  const [image, setImage] = useState<StampImage | null>(null);
  const [widthPercent, setWidthPercent] = useState(30);

  // The one number pair this component owns, in percent of the displayed page
  // from its top-left corner. The two number fields in the rail ARE this pair,
  // which is what makes the placement reachable without a pointer — the
  // accessibility rule `PixelateImageUI.tsx:519-542` establishes.
  const [anchor, setAnchor] = useState({ x: 12, y: 82 });
  const [opacity, setOpacity] = useState(0.22);
  const [rotate, setRotate] = useState(45);
  const [tile, setTile] = useState(false);
  const [behind, setBehind] = useState(false);

  const [pageChoice, setPageChoice] = useState<PageChoice>("all");
  const [rangeText, setRangeText] = useState("");

  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<StampRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The doc pins a "Done in 1.4 s" card above the primary once a run
  // finishes. Timed for real; cleared the moment the inputs change.
  const [elapsed, setElapsed] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const surfaceRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const previewLoadedRef = useRef(false);
  /**
   * Which run owns the footer. Dropping the blob is not enough on its own:
   * `stampPdf` runs in the PDF pool worker, so the main thread stays live for
   * the whole run and the mark can be dragged straight through it. Without the
   * token, that run's `setResult` lands afterwards and puts a Download button
   * over a mark nobody placed. Every invalidation bumps it; a run commits
   * nothing unless it still matches.
   */
  const runToken = useRef(0);

  const invalidate = useCallback(() => {
    runToken.current += 1;
    setResult(null);
    setElapsed(null);
    setStatus((s) => (s === "done" || s === "processing" || s === "error" ? "idle" : s));
    setError(null);
  }, []);

  const handleFiles = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      setFile(f);
      setPageCount(0);
      setPreview(null);
      previewLoadedRef.current = false;
      invalidate();
      setStatus("loading");
    },
    [invalidate],
  );

  /*
    One pdfjs parse per file, for both facts this tool needs: how many pages
    there are, and what page 1 looks like at what size. Placement is expressed
    against what the user is LOOKING at, so the picture and the page dimensions
    the overlay is drawn in come from the same page object.
  */
  useEffect(() => {
    if (!file || previewLoadedRef.current) return;
    previewLoadedRef.current = true;
    let cancelled = false;
    let doc: Awaited<ReturnType<typeof loadPdfjsDocument>> | null = null;
    (async () => {
      try {
        doc = await loadPdfjsDocument(await file.arrayBuffer());
        const page = await doc.getPage(1);
        const visual = page.getViewport({ scale: 1 });
        // Big enough to judge a mark against a line of type, capped so a
        // tabloid sheet does not become a 20 MB data URL held in state.
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
          width: visual.width,
          height: visual.height,
        });
      } catch (err) {
        if (cancelled) return;
        // `loadPdfjsDocument` already maps the two failures people actually
        // hit — a password, a damaged file — onto the house sentences that
        // name the tool to run instead. Rendering it verbatim is the point.
        setError(err instanceof Error ? err.message : "Could not render the first page.");
        setStatus("error");
      } finally {
        await doc?.destroy();
        doc = null;
      }
    })();
    return () => {
      cancelled = true;
      previewLoadedRef.current = false;
      void doc?.destroy();
    };
  }, [file]);

  // The blob: URL belongs to the image object, so replacing the image is what
  // revokes the old one; unmounting revokes the live one.
  useEffect(() => {
    if (!image) return;
    const url = image.url;
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const handlePickImage = useCallback(
    async (picked: File | undefined) => {
      if (!picked) return;
      invalidate();
      const bytes = new Uint8Array(await picked.arrayBuffer());
      const type = sniffImageType(bytes);
      if (!type) {
        setImage(null);
        setError(
          `${picked.name} is not a PNG or a JPEG. Those are the two formats a PDF can carry directly, so anything else has to be converted first — the image tools (/image-tools) include a converter for every format this site reads.`,
        );
        setStatus("error");
        return;
      }
      /*
        MEASURED TRAP, and it would have made this preview lie.

        A PDF reader never looks at EXIF inside an image stream: the picture IS
        the /Width × /Height sample grid and the page's matrix decides where it
        goes. A browser <img>, meanwhile, DOES apply the Orientation tag. So a
        phone JPEG (Orientation 6 is the common one) would be drawn upright in
        the overlay and sideways in the download, with its aspect ratio wrong
        as well, because the stored grid is transposed relative to what was
        shown. Rewriting the tag to 1 before anything decodes the bytes makes
        both sides read the same grid — the fix `jpeg-orientation.ts` exists
        for. `imageOrientation: "none"` does not work; it is not a real value.

        MEASURED on this repo's own `sample-photo-portrait.jpg` (Orientation
        6): `embedJpg` reports 800 × 600 and writes the file's 54,591 bytes
        into a /DCTDecode stream byte for byte, while a browser shows the same
        file 600 × 800. Without the rewrite the overlay would draw a portrait
        picture and the download would hold a landscape one.

        `neutraliseJpegOrientation` returns the same array back (it patches two
        bytes in place) or null for an orientation outside 1..8 — which every
        decoder ignores anyway, so the original bytes are the right answer
        there too.
      */
      const exifOrientation = type === "image/jpeg" ? readJpegOrientation(bytes) : 1;
      const embeddable = type === "image/jpeg" ? (neutraliseJpegOrientation(bytes) ?? bytes) : bytes;
      const url = URL.createObjectURL(new Blob([embeddable as BlobPart], { type }));
      const probe = new Image();
      probe.onload = () => {
        setImage({
          name: picked.name,
          size: picked.size,
          bytes: embeddable,
          type,
          url,
          width: probe.naturalWidth,
          height: probe.naturalHeight,
          exifOrientation,
        });
      };
      probe.onerror = () => {
        URL.revokeObjectURL(url);
        setImage(null);
        setError(`${picked.name} could not be decoded. Try re-saving it as a PNG or a JPEG.`);
        setStatus("error");
      };
      probe.src = url;
    },
    [invalidate],
  );

  /** Screen point → percent of the displayed page. The one conversion here. */
  const pointToPercent = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const el = surfaceRef.current;
    if (!el) return null;
    const box = el.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null;
    return {
      x: clampPercent(((e.clientX - box.left) / box.width) * 100),
      y: clampPercent(((e.clientY - box.top) / box.height) * 100),
    };
  }, []);

  // Placement is inert while tiling — the engine ignores `at` entirely and
  // uses its fixed grid (pdf-engine-core.ts:2013-2016) — so the drag surface
  // is switched off with it rather than moving a marker nothing reads.
  const placementLocked = tile || status === "processing" || !preview;

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (placementLocked) return;
      const p = pointToPercent(e);
      if (!p) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Not every environment implements pointer capture, and a gesture is
        // not worth refusing over it. Without capture a release outside the
        // page is never seen here, so the drag ends at the next pointerdown;
        // every write it makes on the way goes through `invalidate()`, so the
        // worst case is a mark that keeps following the pointer, never a
        // download that stops matching one.
      }
      invalidate();
      setDragging(true);
      setAnchor(p);
    },
    [invalidate, placementLocked, pointToPercent],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging || placementLocked) return;
      const p = pointToPercent(e);
      if (!p) return;
      invalidate();
      setAnchor(p);
    },
    [dragging, invalidate, placementLocked, pointToPercent],
  );

  const endDrag = useCallback(() => setDragging(false), []);

  /**
   * Arrow keys on the handle, because a drag surface that only answers to a
   * pointer is the defect `ImageCropperUI` carries and this family is not
   * going to repeat. The two number fields in the rail are the other half of
   * the same guarantee: they hold this exact pair, so nothing can drift.
   */
  const handleAnchorKeys = useCallback(
    (e: ReactKeyboardEvent<HTMLButtonElement>) => {
      const step = e.shiftKey ? 5 : 0.5;
      const delta =
        e.key === "ArrowLeft"
          ? { x: -step, y: 0 }
          : e.key === "ArrowRight"
            ? { x: step, y: 0 }
            : e.key === "ArrowUp"
              ? { x: 0, y: -step }
              : e.key === "ArrowDown"
                ? { x: 0, y: step }
                : null;
      if (!delta) return;
      e.preventDefault();
      invalidate();
      setAnchor((a) => ({ x: clampPercent(a.x + delta.x), y: clampPercent(a.y + delta.y) }));
    },
    [invalidate],
  );

  const setAnchorField = useCallback(
    (axis: "x" | "y", value: number) => {
      invalidate();
      setAnchor((a) => ({ ...a, [axis]: clampPercent(value) }));
    },
    [invalidate],
  );

  const handleReset = useCallback(() => {
    setFile(null);
    setPageCount(0);
    setPreview(null);
    previewLoadedRef.current = false;
    setDragging(false);
    invalidate();
  }, [invalidate]);

  const badCharacters = mark === "text" ? unsupportedCharacters(text) : [];
  const selectedPages =
    pageChoice === "range" ? [...parsePageRange(rangeText, pageCount)].sort((a, b) => a - b) : null;
  const targetPages =
    pageCount === 0
      ? 0
      : pageChoice === "all"
        ? pageCount
        : pageChoice === "range"
          ? (selectedPages?.length ?? 0)
          : 1;

  const markReady =
    mark === "text" ? text.trim().length > 0 && badCharacters.length === 0 : image !== null;
  const canRun =
    Boolean(file) &&
    preview !== null &&
    markReady &&
    targetPages > 0 &&
    status !== "processing" &&
    status !== "loading";

  const handleRun = useCallback(async () => {
    if (!file || !preview || !markReady || targetPages < 1) return;
    // Claimed BEFORE the first await, and bumped by every control, so a
    // mismatch on the way out means "the mark this run was for is gone".
    const token = (runToken.current += 1);
    setStatus("processing");
    setError(null);
    setElapsed(null);
    setResult(null);
    const startedAt = performance.now();

    const common = {
      pages: (pageChoice === "range" ? (selectedPages ?? []) : pageChoice) as PdfStamp["pages"],
      at: { x: anchor.x / 100, y: anchor.y / 100 },
      opacity,
      rotate,
    };
    const stamp: PdfStamp | null =
      mark === "text"
        ? { kind: "text", text, size: fontSize, colour, bold, behind, tile, ...common }
        : image
          ? {
              kind: "image",
              bytes: image.bytes,
              type: image.type,
              widthFraction: widthPercent / 100,
              behind,
              tile,
              ...common,
            }
          : null;
    if (!stamp) return;

    try {
      const bytes = await stampPdf(await file.arrayBuffer(), [stamp]);
      if (runToken.current !== token) return;
      setResult({
        blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
        pages: targetPages,
        kind: mark,
        tiled: tile,
      });
      // A small PDF finishes in tens of milliseconds; "Done in 0.0 s" reads
      // like a stopwatch that never started. Sub-second runs report ms.
      const ms = performance.now() - startedAt;
      setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
      setStatus("done");
    } catch (err) {
      // A superseded run's failure is not the user's problem either: the mark
      // it failed on is not the one on screen any more.
      if (runToken.current !== token) return;
      setError(err instanceof Error ? err.message : "Could not add the watermark.");
      setStatus("error");
    }
  }, [
    anchor.x,
    anchor.y,
    behind,
    bold,
    colour,
    file,
    fontSize,
    image,
    mark,
    markReady,
    opacity,
    pageChoice,
    preview,
    rotate,
    selectedPages,
    targetPages,
    text,
    tile,
    widthPercent,
  ]);

  if (!file) return <DropZone accept=".pdf" onFiles={handleFiles} />;

  const spots = tile ? TILE_SPOTS : [{ x: anchor.x / 100, y: anchor.y / 100 }];
  const imageWidthPt = preview ? preview.width * (widthPercent / 100) : 0;
  const imageHeightPt = image ? (image.height / image.width) * imageWidthPt : 0;
  const pagesLabel =
    pageCount === 0 ? "—" : `${targetPages} OF ${pageCount}`;
  const markLabel = mark === "text" ? "TEXT MARK" : "IMAGE MARK";

  return (
    <>
      {/* ── Canvas: page 1, with the mark drawn where it will land ── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={
            pageCount
              ? `${pageCount} PAGE${pageCount !== 1 ? "S" : ""} · ${formatFileSize(file.size)}`
              : formatFileSize(file.size)
          }
          trailing={markLabel}
        />

        <CanvasStage className={cn(STAGE_GROW, "flex items-center justify-center bg-bg-secondary p-4")}>
          {preview && (
            <div
              ref={surfaceRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onLostPointerCapture={endDrag}
              className={cn(
                "relative inline-block max-h-full max-w-full touch-none overflow-hidden select-none",
                placementLocked ? "cursor-default" : "cursor-crosshair",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- data: URL of a canvas we rendered; nothing for next/image to optimise under output: "export" */}
              <img
                src={preview.url}
                alt="Page 1 — drag on it to place the watermark"
                className="block max-h-full max-w-full"
                draggable={false}
              />

              {/*
                The overlay's viewBox is the page's POINT size, so every number
                below is the number the engine is handed. `<text x y>` sets the
                baseline at y and `<image x y>` sets the top-left at x,y, which
                is what `drawText` and `drawImage` do on the other side; SVG's
                rotate() is clockwise where the engine's is counter-clockwise,
                hence the negation, and both turn about the anchor itself.

                Two honest limits: the preview uses whatever Helvetica or Arial
                this browser has rather than the font that gets embedded, so a
                text mark's WIDTH here is close and not exact; and `behind`
                cannot be shown at all, because the page underneath is a flat
                picture with nothing to slide beneath.
              */}
              <svg
                viewBox={`0 0 ${preview.width} ${preview.height}`}
                preserveAspectRatio="none"
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 size-full"
              >
                {spots.map((spot, i) => {
                  const ax = spot.x * preview.width;
                  const ay = spot.y * preview.height;
                  const spin = `rotate(${-rotate} ${ax} ${ay})`;
                  if (mark === "text") {
                    return (
                      <text
                        key={i}
                        x={ax}
                        y={ay}
                        transform={spin}
                        fontFamily="Helvetica, Arial, sans-serif"
                        fontSize={fontSize}
                        fontWeight={bold ? 700 : 400}
                        fill={colour}
                        fillOpacity={opacity}
                        style={{ whiteSpace: "pre" }}
                      >
                        {text}
                      </text>
                    );
                  }
                  return image ? (
                    <image
                      key={i}
                      href={image.url}
                      x={ax}
                      y={ay}
                      width={imageWidthPt}
                      height={imageHeightPt}
                      opacity={opacity}
                      transform={spin}
                      preserveAspectRatio="none"
                    />
                  ) : null;
                })}
              </svg>

              {!tile && (
                <button
                  type="button"
                  onKeyDown={handleAnchorKeys}
                  disabled={status === "processing"}
                  aria-label={`Watermark anchor: ${anchor.x}% across, ${anchor.y}% down the page. Arrow keys move it, Shift for larger steps.`}
                  style={{ left: `${anchor.x}%`, top: `${anchor.y}%` }}
                  className="absolute size-5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-accent bg-accent/25 shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_22%,transparent)] transition-colors duration-200 hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
                />
              )}
            </div>
          )}
        </CanvasStage>

        <StatStrip
          stats={[
            { label: "MARK", value: mark === "text" ? "TEXT" : "IMAGE", tone: "neutral" },
            { label: "PAGES", value: pagesLabel },
            {
              label: "PLACED",
              value: tile ? "TILED 3×4" : `${anchor.x}% · ${anchor.y}%`,
              tone: "neutral",
            },
            {
              label: "OUT",
              value: result ? formatFileSize(result.blob.size) : "—",
              tone: result ? "ok" : "accent",
            },
          ]}
        />

        <CanvasFootnote>
          {tile
            ? "TILING IGNORES THE ANCHOR — THE MARK REPEATS ON A FIXED 3 × 4 GRID ON EVERY CHOSEN PAGE"
            : "THE RING IS THE ANCHOR · TEXT SITS ON IT AS A BASELINE AND RUNS RIGHT · AN IMAGE HANGS FROM IT BY ITS TOP-LEFT CORNER"}
        </CanvasFootnote>

        {/*
          The line the registry copy is not allowed to carry alone. `stampPdf`
          draws into the page's content stream, so the mark is part of the page
          rather than an annotation object — which is what people want from a
          watermark, and also why nothing on this site can take it off again.
          It is still not a security control, and saying otherwise next to a
          button labelled CONFIDENTIAL would be the lie worth avoiding.
        */}
        <CanvasFootnote>
          THE MARK IS DRAWN INTO THE PAGE, NOT ATTACHED AS AN ANNOTATION — NO TOOL HERE CAN REMOVE
          IT AGAIN. IT IS A VISIBLE LABEL, NOT PROTECTION.
        </CanvasFootnote>

        {behind && (
          <CanvasFootnote>
            THE PREVIEW CANNOT SHOW &ldquo;UNDER THE PAGE CONTENT&rdquo; — THE PAGE ABOVE IS ONE
            FLAT PICTURE, SO THE MARK IS DRAWN ON TOP HERE AND UNDERNEATH IN THE DOWNLOAD
          </CanvasFootnote>
        )}

        {pageCount > 1 && (
          <CanvasFootnote>
            PAGE 1 IS THE PREVIEW · THE ANCHOR IS A SHARE OF EACH PAGE, SO IT LANDS IN THE SAME
            RELATIVE SPOT ON PAGES OF A DIFFERENT SIZE
          </CanvasFootnote>
        )}

        {mark === "image" && image && image.exifOrientation !== 1 && (
          <WarningMessage
            message={`${image.name} carried an EXIF rotation tag (Orientation ${image.exifOrientation}). PDFs ignore EXIF, so the mark is placed exactly as the file stores its pixels — which is what the preview above now shows. If that is not the way up you wanted, re-save the picture with the rotation applied and drop it in again.`}
          />
        )}

        {mark === "text" && badCharacters.length > 0 && (
          <WarningMessage
            message={`The standard PDF fonts cannot draw ${badCharacters
              .map((c) => `"${c}"`)
              .join(", ")}. They cover Latin letters, digits and punctuation — accents, curly quotes, the euro sign — but not CJK, Cyrillic, Greek, Arabic or emoji. Remove those characters, or use an image mark made in a program that has the font.`}
          />
        )}

        {pageChoice === "range" && pageCount > 0 && targetPages === 0 && (
          <WarningMessage
            message={`No page in this document matches "${rangeText || "(empty)"}". Use numbers and ranges between 1 and ${pageCount}, like 1-3, 5, 8-10.`}
          />
        )}

        {error && <ErrorMessage message={error} />}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {(status === "loading" || status === "processing") && (
              <ToolProgress
                phase={status === "loading" ? "RENDERING PAGE" : "STAMPING"}
                percent={null}
                label={status === "loading" ? "Rendering page 1" : "Adding the watermark"}
              />
            )}
            {elapsed && <ToolDone elapsed={elapsed} />}
            {result ? (
              <DownloadButton
                blob={result.blob}
                fileName={file.name.replace(/\.pdf$/i, "-watermarked.pdf")}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel={status === "processing" ? "Stamping…" : "Add watermark"}
                onPrimary={handleRun}
                primaryDisabled={!canRun}
              />
            )}
            <ToolResetLink onClick={handleReset} label="CHANGE FILE" />
          </>
        }
      >
        <ToolAsideSection label="MARK">
          <ToolChoice
            label="What to stamp"
            fill
            disabled={status === "processing"}
            value={mark}
            onChange={(v: MarkKind) => {
              invalidate();
              setMark(v);
            }}
            options={[
              { value: "text", label: "Text" },
              { value: "image", label: "Image" },
            ]}
          />
          <span className={HINT_CLASS}>
            {mark === "text"
              ? "Drawn with the standard PDF font, so it stays sharp at any zoom and adds almost nothing to the file."
              : "A JPEG goes in byte for byte; a PNG is re-packed losslessly and keeps its transparency, which is what a logo or a signature needs."}
          </span>
        </ToolAsideSection>

        <ToolControlGroup>
          {mark === "text" ? (
            <>
              <ToolControl label="TEXT">
                <input
                  type="text"
                  value={text}
                  onChange={(e) => {
                    invalidate();
                    setText(e.target.value);
                  }}
                  aria-label="Watermark text"
                  placeholder="CONFIDENTIAL"
                  disabled={status === "processing"}
                  className={TEXT_FIELD_CLASS}
                />
              </ToolControl>

              <ToolControl>
                <ToolSlider
                  label="Text size"
                  display={`${fontSize} pt`}
                  hint="Points, the PDF's own unit — 72 pt is one inch, so the mark keeps its size on a page of any dimensions."
                  min={8}
                  max={200}
                  step={1}
                  value={fontSize}
                  onChange={(v) => {
                    invalidate();
                    setFontSize(v);
                  }}
                  disabled={status === "processing"}
                />
              </ToolControl>

              <ToolControl label="STYLE">
                <label className="flex cursor-pointer items-center justify-between gap-3 font-body text-[12.5px] text-neutral-300">
                  Colour
                  <input
                    type="color"
                    value={colour}
                    onChange={(e) => {
                      invalidate();
                      setColour(e.target.value);
                    }}
                    aria-label="Watermark colour"
                    disabled={status === "processing"}
                    className="size-8 cursor-pointer rounded-sm border border-border"
                  />
                </label>
                <label className="flex cursor-pointer items-center gap-2.5 font-body text-[12.5px] text-neutral-300">
                  <input
                    type="checkbox"
                    checked={bold}
                    onChange={(e) => {
                      invalidate();
                      setBold(e.target.checked);
                    }}
                    disabled={status === "processing"}
                    className="size-4 rounded-sm border-border accent-accent"
                  />
                  Bold
                </label>
              </ToolControl>
            </>
          ) : (
            <>
              <ToolControl label="IMAGE">
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={status === "processing"}
                  className="cursor-pointer rounded-md border border-border px-3 py-2 text-left font-body text-xs text-neutral-300 transition-colors duration-200 hover:border-accent/40 hover:text-accent-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {image ? "Choose a different image" : "Choose a PNG or JPEG"}
                </button>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                  className="hidden"
                  onChange={(e) => {
                    void handlePickImage(e.target.files?.[0]);
                    // The same file twice in a row must still fire a change.
                    e.target.value = "";
                  }}
                />
                <span className={HINT_CLASS}>
                  {image
                    ? `${image.name} — ${image.width} × ${image.height} px, ${formatFileSize(image.size)}`
                    : "PNG and JPEG only — those are what a PDF can hold without any loss, so nothing here has to guess at a conversion."}
                </span>
              </ToolControl>

              <ToolControl>
                <ToolSlider
                  label="Image width"
                  display={`${widthPercent}%`}
                  hint="A share of each page's width; the height follows the picture's own proportions."
                  min={2}
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
            </>
          )}

          <ToolControl label="POSITION">
            {/*
              These two fields ARE the stored anchor. Dragging on the page
              writes the same two numbers and the handle reads them back, so
              the pointer and the keyboard cannot describe different places —
              and the placement is reachable with no pointer at all.
            */}
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["x", "X — across"],
                  ["y", "Y — down"],
                ] as const
              ).map(([axis, label]) => (
                <label key={axis} className="flex min-w-0 flex-col gap-1">
                  <span className="font-body text-[11px] text-text-muted">{label}</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={anchor[axis]}
                    onChange={(e) => setAnchorField(axis, Number(e.target.value))}
                    aria-label={
                      axis === "x"
                        ? "Anchor position across the page, in percent"
                        : "Anchor position down the page, in percent"
                    }
                    disabled={placementLocked}
                    className={NUMBER_FIELD_CLASS}
                  />
                </label>
              ))}
            </div>
            <span className={HINT_CLASS}>
              {tile
                ? "Tiling is on, so the anchor is not used — the engine repeats the mark on its own 3 × 4 grid."
                : "Percent across and down the page as it is displayed, from the top-left corner. Drag the ring on the page, or use the arrow keys once it has focus."}
            </span>
          </ToolControl>

          <ToolControl>
            <ToolSlider
              label="Opacity"
              display={`${Math.round(opacity * 100)}%`}
              min={0.05}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(v) => {
                invalidate();
                setOpacity(v);
              }}
              disabled={status === "processing"}
            />
          </ToolControl>

          <ToolControl>
            <ToolSlider
              label="Rotation"
              display={`${rotate}°`}
              hint="Counter-clockwise, turning about the anchor. On a page the reader already rotates, this is the angle you see."
              min={-180}
              max={180}
              step={1}
              value={rotate}
              onChange={(v) => {
                invalidate();
                setRotate(v);
              }}
              disabled={status === "processing"}
            />
          </ToolControl>

          <ToolControl label="REPEAT AND DEPTH">
            <label className="flex cursor-pointer items-center gap-2.5 font-body text-[12.5px] text-neutral-300">
              <input
                type="checkbox"
                checked={tile}
                onChange={(e) => {
                  invalidate();
                  setTile(e.target.checked);
                }}
                disabled={status === "processing"}
                className="size-4 rounded-sm border-border accent-accent"
              />
              Tile across the page
            </label>
            <label className="flex cursor-pointer items-center gap-2.5 font-body text-[12.5px] text-neutral-300">
              <input
                type="checkbox"
                checked={behind}
                onChange={(e) => {
                  invalidate();
                  setBehind(e.target.checked);
                }}
                disabled={status === "processing"}
                className="size-4 rounded-sm border-border accent-accent"
              />
              Place under the page content
            </label>
            <span className={HINT_CLASS}>
              Tiling repeats the mark twelve times on a fixed grid and ignores the anchor. Placing
              it underneath puts the page&apos;s own text and pictures over the top, which is the
              classic look — the preview cannot show that, so check the download.
            </span>
          </ToolControl>

          <ToolControl label="PAGES">
            <ToolChoice
              label="Which pages to stamp"
              fill
              disabled={status === "processing"}
              value={pageChoice}
              onChange={(v: PageChoice) => {
                invalidate();
                setPageChoice(v);
              }}
              options={[
                { value: "all", label: "All" },
                { value: "first", label: "First" },
                { value: "last", label: "Last" },
                { value: "range", label: "Range" },
              ]}
            />
            {pageChoice === "range" && (
              <input
                type="text"
                value={rangeText}
                onChange={(e) => {
                  invalidate();
                  setRangeText(e.target.value);
                }}
                placeholder="1-3, 5, 8-10"
                aria-label="Page range to stamp"
                disabled={status === "processing"}
                className={cn(TEXT_FIELD_CLASS, "font-mono text-xs")}
              />
            )}
            <span className={HINT_CLASS}>
              {pageCount > 0
                ? `${targetPages} of ${pageCount} page${pageCount !== 1 ? "s" : ""} will be stamped.`
                : "Reading the document…"}
            </span>
          </ToolControl>
        </ToolControlGroup>

        <ToolAsideSection label="A WATERMARK IS NOT PROTECTION">
          <span className={HINT_CLASS}>
            The mark becomes part of the page&apos;s own drawing instructions, so it survives
            printing, re-saving and a trip through most other tools, and nothing on this site can
            strip it back off. That is not the same as security: the page underneath is untouched,
            its text stays selectable and copyable, and anyone with a PDF editor can take the mark
            out again. Use it to label a document, not to lock one.
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["In", formatFileSize(file.size)],
              ["Out", result ? formatFileSize(result.blob.size) : "—"],
              ["Mark", result ? (result.kind === "text" ? "Text" : "Image") : markLabel],
              [
                "Pages stamped",
                result ? `${result.pages}${result.tiled ? " · tiled" : ""}` : "—",
              ],
            ]}
          />
        </ToolAsideSection>

        <ToolAdvanced
          rows={[
            ["Mark", "DRAWN INTO PAGE CONTENT"],
            ["Text font", "HELVETICA · LATIN ONLY"],
            ["Your pages", "NOT RE-ENCODED"],
            ["Links, bookmarks, form fields", "KEPT"],
          ]}
        />
      </ToolAside>
    </>
  );
}
