"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import { loadPdfjsDocument, renderPageFromDoc, stampPdf } from "@/lib/tools/pdf-engine";
import type { PdfStamp } from "@/lib/tools/pdf-engine";
import { unsupportedStampCharacters } from "@/lib/tools/pdf-stamp-core";
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
import { CANVAS_COLUMN, chipClass } from "@/components/workspace/shared";
import { cn } from "@/lib/utils/cn";

/*
  ANNOTATE PDF — three marks you place by hand, and two things it cannot do.

  The engine op is `stampPdf`, shared with the watermark/signature/image pages:
  a highlight and a box are `PdfRectStamp`s, a note is a `PdfTextStamp`. What
  makes this page different from those three is what it has to REFUSE to imply.

  1. NOTHING HERE SELECTS TEXT. There is no text layer under the preview — the
     page is a raster from pdfjs — and `pdf-engine-core.ts` has no text-position
     model of any kind, so a highlight cannot find a line of prose and follow
     it. It is a rectangle at a place you chose. Anyone arriving from a desktop
     reader assumes the opposite, so the page says so on the canvas, in the
     rail, and in the registry copy.

  2. THE MARKS GO INTO THE PAGE CONTENT, NOT INTO /Annots. `drawStamp`
     (pdf-engine-core.ts:2079-2141) calls `page.drawRectangle` and
     `page.drawText`, both of which push operators onto the page's content
     stream — verified by inflating the saved stream, which contains the path
     and text operators and no annotation dictionary anywhere. So a reader
     shows no comment to click, no author, no reply and no Delete.

  Everything else on this page is scoped down to what can be stated exactly.
*/

/* ── The character set the notes can actually carry ──────────────────────── */

/*
  THE 218-CODEPOINT WinAnsi TABLE THAT USED TO BE COPIED HERE IS GONE, and the
  60-line justification above it went with it, because both of its reasons
  stopped being true on 2026-09-10.

  It argued that `unsupportedStampCharacters()` was unusable from a component
  because (a) it lived in `pdf-engine-core`, whose import graph is pdf-lib's
  705 KB eager chunk, and (b) it would answer WRONGLY on the main thread anyway,
  since its probe font was initialised only by `stampPdf` inside the pool worker
  — on an uninitialised instance every character came back unsupported.

  Both were fair at the time and neither survives. The function now lives in
  `pdf-stamp-core.ts`, which has ZERO imports of its own, so a component may
  import it freely; and it is a pure table rather than a live probe, so there is
  no instance to be uninitialised. The engine calls this same function, so the
  check the user sees on keypress and the check that refuses the run are now
  literally the same code rather than two tables that agreed "by construction".

  That matters more than the duplication: `pdf-stamp-core.test.ts` re-derives
  the table against pdf-lib across the whole BMP and fails in BOTH directions,
  so a copy here would have been a second, ungated statement of a measured fact.
*/

/** A character named so the sentence reads — a bare quoted TAB says nothing. */
function describeCharacter(character: string): string {
  if (character === "\t") return "a tab";
  const code = character.codePointAt(0) ?? 0;
  if (code < 0x20 || code === 0x7f) {
    return `a control character (U+${code.toString(16).toUpperCase().padStart(4, "0")})`;
  }
  return `"${character}"`;
}

/* ── Marks ───────────────────────────────────────────────────────────────── */

type MarkKind = "highlight" | "box" | "note";

/**
 * One mark, in ONE coordinate space: percent of the page AS DISPLAYED, from
 * its top-left corner. That is `PdfStampCommon.at` and `PdfRectStamp.size`
 * scaled by 100 and nothing else, so the number in a field, the shape on the
 * preview and the fraction handed to the engine are the same quantity — the
 * rule `PixelateImageUI` established, and the reason the drag and the fields
 * cannot drift apart.
 */
interface Mark {
  id: number;
  kind: MarkKind;
  x: number;
  y: number;
  /** Ignored by a note, which is anchored at a point. */
  width: number;
  height: number;
  /** "#rrggbb", straight from `<input type="color">` and straight to the engine. */
  colour: string;
  /** Percent; divided by 100 on the way into the stamp. */
  opacity: number;
  /** Note only. */
  text: string;
  /** Note only, in points. */
  fontSize: number;
  /** Box only, in points. */
  lineWidth: number;
}

const MARK_LABEL: Record<MarkKind, string> = {
  highlight: "Highlight",
  box: "Box",
  note: "Note",
};

/**
 * Sensible starting geometry, so pressing Add puts something on the page
 * immediately instead of leaving the user to guess four numbers first.
 * A highlight opens at 35% because that is roughly where a flat translucent
 * block still lets body text read through it — see the note on `HIGHLIGHT`.
 */
const MARK_DEFAULTS: Record<MarkKind, Omit<Mark, "id" | "kind">> = {
  highlight: {
    x: 12, y: 24, width: 62, height: 3.5,
    colour: "#ffe14d", opacity: 35, text: "", fontSize: 12, lineWidth: 1.5,
  },
  box: {
    x: 12, y: 24, width: 62, height: 14,
    colour: "#e0245e", opacity: 100, text: "", fontSize: 12, lineWidth: 1.5,
  },
  note: {
    x: 12, y: 24, width: 0, height: 0,
    colour: "#e0245e", opacity: 100, text: "Note", fontSize: 12, lineWidth: 1.5,
  },
};

const SWATCHES = [
  { value: "#ffe14d", label: "Yellow" },
  { value: "#7ee787", label: "Green" },
  { value: "#7cc4ff", label: "Blue" },
  { value: "#ff9ec4", label: "Pink" },
  { value: "#e0245e", label: "Red" },
] as const;

/** Under this, a pointer gesture is a click that MOVES a mark, not a resize. */
const MIN_DRAG_PERCENT = 1.5;

/**
 * pdf-lib leaves `lineHeight` at the `PDFPage` default of 24 (pdf-lib
 * PDFPage.js:23) and `stampPdf` never overrides it, so a note's second and
 * later lines land 24 points below the one before whatever font size you pick.
 * The preview spaces its own lines by exactly this number so the surface tells
 * the truth about it rather than a rail sentence having to.
 */
const NOTE_LINE_HEIGHT_PT = 24;

const FIELD_CLASS =
  "w-full rounded-md border border-border bg-bg-elevated px-2.5 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45";

const HINT_CLASS = "font-body text-[10.5px] leading-[1.5] text-text-muted";

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value * 10) / 10));
}

/**
 * Pull a mark back onto the page.
 *
 * The clamp is not decoration: `fractionToUserSpace` clamps `at` to 0..1
 * (pdf-stamp-core.ts:377-378) while the SIZE is drawn from there unclamped, so
 * a rectangle wider than the page runs off the edge in the download while the
 * preview would happily draw it inside the frame. Keeping the rectangle on the
 * page keeps the two pictures identical.
 */
function normaliseMark(mark: Mark): Mark {
  // 99.5, not 100: the width below is clamped into `100 - x`, and an origin of
  // 99.8 would hand `clampNumber` a max under its own min — which returns the
  // max, i.e. a NEGATIVE width. That draws nothing in SVG and a back-to-front
  // rectangle in the PDF, so the origin is bounded to leave the minimum extent
  // room. A mark at 99.5% of the page is already off the edge of it anyway.
  const x = clampNumber(mark.x, 0, 99.5);
  const y = clampNumber(mark.y, 0, 99.5);
  return {
    ...mark,
    x,
    y,
    width: mark.kind === "note" ? 0 : clampNumber(mark.width, 0.5, 100 - x),
    height: mark.kind === "note" ? 0 : clampNumber(mark.height, 0.5, 100 - y),
    opacity: clampNumber(mark.opacity, 5, 100),
    fontSize: clampNumber(mark.fontSize, 5, 96),
    lineWidth: clampNumber(mark.lineWidth, 0.25, 12),
  };
}

interface Point {
  x: number;
  y: number;
}

function rectBetween(a: Point, b: Point): { x: number; y: number; width: number; height: number } {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

interface Preview {
  /** Data URL of the rasterised page — JPEG, since pdfjs paints it opaque. */
  url: string;
  /**
   * The page's VISUAL size in points: pdfjs's viewport at scale 1, which has
   * /Rotate applied. It is the same frame `displayedPageSize` gives the engine,
   * so the SVG overlay's viewBox and the stamp's fractions agree by
   * construction rather than by assumption.
   */
  width: number;
  height: number;
  /** The page's own /Rotate, normalised the way the engine normalises it. */
  rotation: 0 | 90 | 180 | 270;
  /** Which page this is of — a late render must not land under another page. */
  page: number;
}

function normaliseRotation(angle: number): 0 | 90 | 180 | 270 {
  if (!Number.isFinite(angle)) return 0;
  const quarters = Math.round(angle / 90);
  return ((((quarters % 4) + 4) % 4) * 90) as 0 | 90 | 180 | 270;
}

export function AnnotatePdfUI() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "processing" | "done" | "error">(
    "idle",
  );
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The doc pins a "Done in 1.4 s" card above the primary once a run
  // finishes. Timed for real; cleared the moment the inputs change.
  const [elapsed, setElapsed] = useState<string | null>(null);

  const nextIdRef = useRef(1);
  /*
    The app-wide "stale-result invalidation" contract, with the fence the
    plain version is missing. Clearing `result` alone is inert while a run is
    in flight — there is nothing to clear yet — and `stampPdf` runs in the pool
    worker, so the whole surface stays draggable for the length of a run. Move
    a mark mid-run and the finished bytes would describe a rectangle that is no
    longer anywhere on screen. A run claims the token before its first await
    and commits nothing unless it still holds it.
  */
  const runToken = useRef(0);

  const invalidate = useCallback(() => {
    runToken.current += 1;
    setResult(null);
    setElapsed(null);
    setError(null);
    setStatus((s) => (s === "done" || s === "processing" || s === "error" ? "idle" : s));
  }, []);

  const handleFiles = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      setFile(f);
      setPageCount(0);
      setPageNumber(1);
      setPreview(null);
      setMarks([]);
      setSelectedId(null);
      setDragStart(null);
      invalidate();
    },
    [invalidate],
  );

  const handleReset = useCallback(() => {
    setFile(null);
    setPageCount(0);
    setPageNumber(1);
    setPreview(null);
    setMarks([]);
    setSelectedId(null);
    setDragStart(null);
    invalidate();
  }, [invalidate]);

  /*
    One pdfjs parse per page shown, for the three facts this tool needs: how
    many pages there are, what the page looks like, and how the file turns it.
    All three come off the same page object, so the picture the marks are
    placed on and the geometry the engine is handed cannot disagree.
  */
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    let doc: Awaited<ReturnType<typeof loadPdfjsDocument>> | null = null;
    setStatus("loading");
    (async () => {
      try {
        doc = await loadPdfjsDocument(await file.arrayBuffer());
        const total = doc.numPages;
        const target = Math.min(Math.max(1, pageNumber), total);
        const page = await doc.getPage(target);
        const visual = page.getViewport({ scale: 1 });
        // Big enough to put a highlight on one line of type, capped so a
        // tabloid sheet does not become a 20 MB data URL held in state.
        const scale = Math.min(2.5, Math.max(0.75, 1000 / visual.width));
        const canvas = await renderPageFromDoc(doc, target, scale);
        if (cancelled) return;
        setPageCount(total);
        // The field has to agree with the page on screen. A number typed
        // before the document was open (the page count is unknown until this
        // line) can be past the end, and the render silently falls back to the
        // last page — leaving the rail claiming page 999. Writing the clamped
        // value back converges in one extra pass, because clamping it again is
        // a no-op.
        if (target !== pageNumber) setPageNumber(target);
        setPreview({
          url: canvas.toDataURL("image/jpeg", 0.9),
          width: visual.width,
          height: visual.height,
          rotation: normaliseRotation(page.rotate),
          page: target,
        });
        setStatus("idle");
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
  }, [file, pageNumber]);

  const selected = marks.find((m) => m.id === selectedId) ?? null;

  const updateSelected = useCallback(
    (patch: Partial<Mark>) => {
      invalidate();
      setMarks((list) =>
        list.map((m) => (m.id === selectedId ? normaliseMark({ ...m, ...patch }) : m)),
      );
    },
    [invalidate, selectedId],
  );

  const addMark = useCallback(
    (kind: MarkKind) => {
      const id = nextIdRef.current;
      nextIdRef.current += 1;
      invalidate();
      setMarks((list) => [...list, normaliseMark({ id, kind, ...MARK_DEFAULTS[kind] })]);
      setSelectedId(id);
    },
    [invalidate],
  );

  const removeSelected = useCallback(() => {
    invalidate();
    setMarks((list) => list.filter((m) => m.id !== selectedId));
    setSelectedId(null);
  }, [invalidate, selectedId]);

  /* ── The placement surface ─────────────────────────────────────────────── */

  /**
   * Screen point → percent of the displayed page.
   *
   * The wrapper shrink-wraps the `<img>`, which is sized only by `max-width` /
   * `max-height`, so its box IS the picture: one uniform scale, no letterbox
   * to account for.
   */
  const pointToPercent = useCallback((e: ReactPointerEvent<HTMLDivElement>): Point | null => {
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null;
    return {
      x: ((e.clientX - box.left) / box.width) * 100,
      y: ((e.clientY - box.top) / box.height) * 100,
    };
  }, []);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!selected || status === "processing") return;
      const p = pointToPercent(e);
      if (!p) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture is not universal and a gesture is not worth refusing
        // over it. What it buys is the `pointerup` from outside the frame;
        // without it the drag ends at the next press instead. Every write it
        // makes still goes through `invalidate()`, so the worst case is a mark
        // that keeps following the pointer — never a download that stops
        // matching the mark on screen.
      }
      setDragStart(p);
      if (selected.kind === "note") updateSelected({ x: p.x, y: p.y });
    },
    [pointToPercent, selected, status, updateSelected],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragStart || !selected) return;
      const p = pointToPercent(e);
      if (!p) return;
      if (selected.kind === "note") {
        updateSelected({ x: p.x, y: p.y });
        return;
      }
      const rect = rectBetween(dragStart, p);
      // Below the threshold the gesture is still ambiguous — leave the mark
      // alone until `pointerup` decides whether it was a click or a drag.
      if (rect.width < MIN_DRAG_PERCENT || rect.height < MIN_DRAG_PERCENT) return;
      updateSelected(rect);
    },
    [dragStart, pointToPercent, selected, updateSelected],
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragStart || !selected) return;
      const p = pointToPercent(e);
      setDragStart(null);
      if (!p) return;
      if (selected.kind === "note") {
        updateSelected({ x: p.x, y: p.y });
        return;
      }
      const rect = rectBetween(dragStart, p);
      // A click, or a twitch while clicking: move the mark, keep its size.
      // Top-left rather than centre because that is what the X and Y fields
      // hold, and the two must describe the same corner.
      if (rect.width < MIN_DRAG_PERCENT || rect.height < MIN_DRAG_PERCENT) {
        updateSelected({ x: dragStart.x, y: dragStart.y });
        return;
      }
      updateSelected(rect);
    },
    [dragStart, pointToPercent, selected, updateSelected],
  );

  const handleDragCancel = useCallback(() => setDragStart(null), []);

  /* ── What can run ──────────────────────────────────────────────────────── */

  /*
    THE ROTATED-PAGE LIMIT THAT USED TO BE HERE IS GONE, because the engine
    defect behind it is fixed.

    `drawStamp` anchored a rectangle and an image with `y: origin.y - height` —
    a top-left-to-bottom-left correction along the UNROTATED y axis, which only
    means "down the page" at /Rotate 0. Measured before the fix, a 0.50 x 0.30
    rect requested at (0.200, 0.100) landed at (0.200, 0.100) on an unrotated
    page but at (-0.012, -0.200) at 90 degrees, (0.200, -0.500) at 180 and
    (0.412, -0.200) at 270 — the size right at every rotation, the position out
    by the mark's own height, twice that at 180.

    It now shifts along `displayedDownUnit` (pdf-stamp-core.ts), which asks
    `fractionToUserSpace` where the top and bottom of the DISPLAYED page are
    instead of tabulating four vectors that could drift from it, and which
    returns exactly (0, -1) at rotation 0 so the old behaviour is a special case
    of the new one. An it.each over all four rotations pins it in
    pdf-engine-stamp-forms.test.ts and is mutation-proven by restoring the old
    line. So highlights and boxes are offered on a turned page like any other.
  */
  const rotation = preview?.rotation ?? 0;

  const emptyNote = marks.some((m) => m.kind === "note" && m.text.trim() === "");
  const badCharacters = (() => {
    for (const [index, mark] of marks.entries()) {
      if (mark.kind !== "note") continue;
      const bad = unsupportedStampCharacters(mark.text);
      if (bad.length > 0) return { index: index + 1, bad };
    }
    return null;
  })();

  const characterMessage = badCharacters
    ? `Mark ${badCharacters.index} contains ${badCharacters.bad
        .map(describeCharacter)
        .join(", ")}. Notes are drawn with the standard PDF fonts, which cover Latin letters, digits and punctuation — including accents, curly quotes and the euro sign — and nothing else. Remove those characters, or put the wording somewhere the page already has it.`
    : null;

  const handleAnnotate = useCallback(async () => {
    if (!file || !preview || marks.length === 0) return;
    // Claimed BEFORE the first await, and bumped by every control, every drag
    // and a file swap — a mismatch on the way out means "the marks this run
    // was for are gone", so the bytes are dropped rather than published.
    runToken.current += 1;
    const token = runToken.current;
    setStatus("processing");
    setError(null);
    setElapsed(null);
    setResult(null);
    const startedAt = performance.now();
    const pages = [preview.page - 1];
    const stamps: PdfStamp[] = marks.map((mark) => {
      const at = { x: mark.x / 100, y: mark.y / 100 };
      const opacity = mark.opacity / 100;
      if (mark.kind === "note") {
        return {
          kind: "text",
          pages,
          at,
          opacity,
          // Left at zero deliberately: the engine adds the page's own /Rotate
          // (pdf-engine-core.ts:2089), so zero means "upright as displayed",
          // which is what the preview draws.
          rotate: 0,
          text: mark.text,
          size: mark.fontSize,
          colour: mark.colour,
          bold: false,
          behind: false,
          tile: false,
        };
      }
      const size = { width: mark.width / 100, height: mark.height / 100 };
      return mark.kind === "highlight"
        ? { kind: "rect", pages, at, opacity, rotate: 0, size, fill: mark.colour, strokeWidth: 0 }
        : {
            kind: "rect",
            pages,
            at,
            opacity,
            rotate: 0,
            size,
            stroke: mark.colour,
            strokeWidth: mark.lineWidth,
          };
    });
    try {
      const bytes = await stampPdf(await file.arrayBuffer(), stamps);
      if (runToken.current !== token) return;
      setResult(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      // A small PDF finishes in tens of milliseconds; "Done in 0.0 s" reads
      // like a stopwatch that never started. Sub-second runs report ms.
      const ms = performance.now() - startedAt;
      setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
      setStatus("done");
    } catch (err) {
      // A superseded run's failure belongs to marks nobody is looking at.
      if (runToken.current !== token) return;
      // The engine's refusals already carry a sentence naming their reason —
      // the unsupported-character one names the characters. Re-wording it here
      // would only let the two drift.
      setError(err instanceof Error ? err.message : "Failed to draw the marks on this page");
      setStatus("error");
    }
  }, [file, marks, preview]);

  if (!file) return <DropZone accept=".pdf" onFiles={handleFiles} label="Upload a PDF to mark up" />;

  const canRun =
    preview !== null &&
    marks.length > 0 &&
    !emptyNote &&
    badCharacters === null &&
    status !== "processing" &&
    status !== "loading";

  const pageLabel = preview
    ? `${Math.round(preview.width)} × ${Math.round(preview.height)} PT`
    : "—";

  return (
    <>
      {/* ── Canvas: the page, with the marks drawn where they will land ── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={`${pageCount || "—"} PAGE${pageCount === 1 ? "" : "S"} · ${formatFileSize(file.size)}`}
          trailing={`${marks.length} MARK${marks.length === 1 ? "" : "S"}`}
        />

        {/*
          No `STAGE_GROW`, and that is load-bearing rather than a style choice:
          the wrapper below has to shrink-wrap the <img> EXACTLY, because the
          drag reads its bounding box as the page and the SVG overlay is
          `inset-0` of it. A stage that stretched and then clipped a tall page
          would leave the box and the picture describing different rectangles,
          and every mark would land somewhere other than where it was drawn.
          `AddPageNumbersUI` sizes its page stage the same way.
        */}
        <CanvasStage className="flex items-center justify-center bg-bg-secondary p-4">
          {preview && (
            <div
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handleDragCancel}
              onLostPointerCapture={handleDragCancel}
              className={cn(
                "relative inline-block touch-none select-none",
                selected ? "cursor-crosshair" : "cursor-default",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- data: URL of a canvas we rendered; nothing for next/image to optimise under output: "export" */}
              <img
                src={preview.url}
                alt={`Page ${preview.page} — place marks on it`}
                draggable={false}
                className="block max-h-[min(62vh,720px)] max-w-full"
              />

              {/*
                The overlay is an SVG whose viewBox is the page in POINTS, so
                every mark is drawn in the engine's own units: a rectangle's
                stroke width is points, and a note's font size is points at the
                page's real scale rather than a guess in CSS pixels. It also
                lets the multi-line spacing be drawn at the literal 24 pt the
                engine uses, so the preview carries that quirk instead of a
                sentence having to.
              */}
              <svg
                viewBox={`0 0 ${preview.width} ${preview.height}`}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 size-full"
              >
                {marks.map((mark) => {
                  const x = (mark.x / 100) * preview.width;
                  const y = (mark.y / 100) * preview.height;
                  const w = (mark.width / 100) * preview.width;
                  const h = (mark.height / 100) * preview.height;
                  const isSelected = mark.id === selectedId;
                  if (mark.kind === "note") {
                    // pdf-lib splits on newlines and never wraps, so the
                    // preview does exactly that: one tspan per line, the first
                    // on the baseline at (x, y) — which is where `drawText`
                    // starts — and each later one 24 pt below.
                    const lines = mark.text.split(/\r\n|[\n\r]/);
                    return (
                      <g key={mark.id}>
                        {/*
                          An anchor caret, deliberately NOT a bounding box: this
                          component cannot measure Helvetica's advance widths,
                          so any box it drew round the words would be a guess,
                          and a guessed box next to real text reads as a claim
                          about the note's extent. The caret claims only what is
                          exact — the point the first line starts from.
                        */}
                        {isSelected && (
                          <path
                            d={`M ${x} ${y - mark.fontSize} L ${x} ${y} L ${x + mark.fontSize * 0.8} ${y}`}
                            fill="none"
                            stroke="#ffffff"
                            strokeWidth={1}
                            strokeDasharray="4 3"
                          />
                        )}
                        <text
                          x={x}
                          y={y}
                          fontFamily="Helvetica, Arial, sans-serif"
                          fontSize={mark.fontSize}
                          fill={mark.colour}
                          fillOpacity={mark.opacity / 100}
                        >
                          {lines.map((line, i) => (
                            <tspan key={i} x={x} dy={i === 0 ? 0 : NOTE_LINE_HEIGHT_PT}>
                              {/* A blank line still advances the baseline in
                                  the PDF (T* runs regardless), so it has to
                                  advance here too — an empty tspan would be
                                  skipped by some renderers. */}
                              {line === "" ? " " : line}
                            </tspan>
                          ))}
                        </text>
                      </g>
                    );
                  }
                  return (
                    <g key={mark.id}>
                      <rect
                        x={x}
                        y={y}
                        width={w}
                        height={h}
                        fill={mark.kind === "highlight" ? mark.colour : "none"}
                        fillOpacity={mark.kind === "highlight" ? mark.opacity / 100 : 0}
                        stroke={mark.kind === "box" ? mark.colour : "none"}
                        strokeOpacity={mark.kind === "box" ? mark.opacity / 100 : 0}
                        strokeWidth={mark.kind === "box" ? mark.lineWidth : 0}
                      />
                      {isSelected && (
                        <rect
                          x={x}
                          y={y}
                          width={w}
                          height={h}
                          fill="none"
                          stroke="#ffffff"
                          strokeWidth={1}
                          strokeDasharray="4 3"
                        />
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </CanvasStage>

        <StatStrip
          stats={[
            { label: `PAGE ${preview?.page ?? pageNumber}`, value: pageLabel, tone: "neutral" },
            { label: "MARKS", value: `${marks.length}` },
            {
              label: "SELECTED",
              value: selected ? MARK_LABEL[selected.kind].toUpperCase() : "NONE",
              tone: "neutral",
            },
            {
              label: "TURNED",
              value: rotation === 0 ? "NO" : `${rotation}°`,
              tone: rotation === 0 ? "neutral" : "accent",
            },
          ]}
        />

        {/*
          The sentence the registry copy is not allowed to carry alone. Both
          halves are facts about `drawStamp`, and both are the ones a user
          arriving from a desktop reader assumes the other way round.
        */}
        <CanvasFootnote>
          NOTHING HERE SELECTS TEXT — A HIGHLIGHT IS A RECTANGLE YOU PLACE. MARKS ARE PAINTED
          INTO THE PAGE, SO A READER HAS NO COMMENT TO CLICK AND NO DELETE.
        </CanvasFootnote>

        <CanvasFootnote>
          {selected
            ? "DRAG ON THE PAGE TO SET THE SELECTED MARK · A CLICK MOVES IT · THE DASHED OUTLINE IS NOT DRAWN INTO THE DOWNLOAD"
            : "ADD A MARK, THEN DRAG ON THE PAGE TO PLACE IT — OR TYPE ITS POSITION IN THE FIELDS"}
        </CanvasFootnote>


        {characterMessage && <WarningMessage message={characterMessage} />}

        {emptyNote && !characterMessage && (
          <WarningMessage message="One of your notes is empty. An empty note draws nothing at all, so type its wording or remove the mark." />
        )}

        {error && <ErrorMessage message={error} />}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {(status === "loading" || status === "processing") && (
              <ToolProgress
                phase={status === "loading" ? "RENDERING PAGE" : "DRAWING MARKS"}
                percent={null}
                label={status === "loading" ? "Rendering page" : "Drawing marks"}
              />
            )}
            {elapsed && <ToolDone elapsed={elapsed} />}
            {result ? (
              <DownloadButton
                blob={result}
                fileName={file.name.replace(/\.pdf$/i, "-annotated.pdf")}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel={status === "processing" ? "Annotating…" : "Annotate page"}
                onPrimary={handleAnnotate}
                primaryDisabled={!canRun}
              />
            )}
            <ToolResetLink onClick={handleReset} label="CHANGE FILE" />
          </>
        }
      >
        <ToolControlGroup>
          <ToolControl label="PAGE">
            <input
              type="number"
              min={1}
              max={pageCount || undefined}
              value={pageNumber}
              onChange={(e) => {
                invalidate();
                const wanted = Math.max(1, Math.round(Number(e.target.value) || 1));
                setPageNumber(pageCount > 0 ? Math.min(pageCount, wanted) : wanted);
              }}
              aria-label="Page to mark up"
              disabled={status === "processing"}
              className={cn(FIELD_CLASS, "w-24")}
            />
            <span className={HINT_CLASS}>
              One page per pass. Every mark below lands on the page shown, and switching pages
              brings them with you — download the result and drop it back in to mark another page.
            </span>
          </ToolControl>

          <ToolControl label="MARKS">
            <div className="flex flex-wrap gap-[5px]" role="group" aria-label="Marks on this page">
              {marks.length === 0 ? (
                <span className={HINT_CLASS}>No marks yet.</span>
              ) : (
                marks.map((mark, i) => (
                  <button
                    key={mark.id}
                    type="button"
                    onClick={() => setSelectedId(mark.id)}
                    aria-pressed={mark.id === selectedId}
                    disabled={status === "processing"}
                    className={chipClass(
                      mark.id === selectedId,
                      cn(
                        "rounded-[6px] px-2 py-[7px] text-[11.5px] disabled:opacity-45",
                        mark.id !== selectedId && "text-text-muted",
                      ),
                    )}
                  >
                    {`${i + 1} · ${MARK_LABEL[mark.kind]}`}
                  </button>
                ))
              )}
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {(["highlight", "box", "note"] as const).map((kind) => {
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => addMark(kind)}
                    disabled={status === "processing" || !preview}
                    className={chipClass(
                      false,
                      "rounded-[6px] px-1 py-[7px] text-[11.5px] text-text-muted disabled:cursor-not-allowed disabled:opacity-45",
                    )}
                  >
                    {kind === "highlight"
                      ? "Add highlight"
                      : kind === "box"
                        ? "Add box"
                        : "Add note"}
                  </button>
                );
              })}
            </div>


            <button
              type="button"
              onClick={removeSelected}
              disabled={!selected || status === "processing"}
              className="cursor-pointer self-start text-xs text-accent transition-colors hover:text-accent-hover disabled:cursor-not-allowed disabled:text-text-muted"
            >
              Remove mark
            </button>
          </ToolControl>

          {selected && (
            <ToolControl label="PLACE">
              {/*
                These four fields ARE the stored mark, in percent of the page as
                displayed. Dragging on the page writes the same four numbers,
                which is why the two can never disagree — and why a mark can be
                placed to the point without a pointer at all.
              */}
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["x", "X"],
                    ["y", "Y"],
                    ["width", "Width"],
                    ["height", "Height"],
                  ] as const
                ).map(([key, label]) => {
                  const isSize = key === "width" || key === "height";
                  return (
                    <label key={key} className="flex min-w-0 flex-col gap-1">
                      <span className="font-body text-[11px] text-text-muted">{`${label} %`}</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        value={selected.kind === "note" && isSize ? "" : selected[key]}
                        placeholder={selected.kind === "note" && isSize ? "—" : undefined}
                        onChange={(e) => updateSelected({ [key]: Number(e.target.value) })}
                        aria-label={`Mark ${label.toLowerCase()} as a percentage of the page`}
                        disabled={
                          status === "processing" || (selected.kind === "note" && isSize)
                        }
                        className={FIELD_CLASS}
                      />
                    </label>
                  );
                })}
              </div>
              <span className={HINT_CLASS}>
                {selected.kind === "note"
                  ? "A note is anchored at a point, not a box: X and Y are where its first line starts, and the text runs right from there."
                  : "Percentages of the page as it is displayed, measured from its top-left corner — so the same numbers hold whatever size the page is."}
              </span>
            </ToolControl>
          )}

          {selected && (
            <ToolControl label="COLOUR">
              <ToolChoice
                label="Mark colour"
                fill
                value={selected.colour}
                onChange={(v: string) => updateSelected({ colour: v })}
                disabled={status === "processing"}
                options={SWATCHES.map((s) => ({ value: s.value as string, label: s.label }))}
              />
              <label className="flex items-center justify-between gap-3 font-body text-[12.5px] text-neutral-300">
                Custom colour
                <input
                  type="color"
                  value={selected.colour}
                  onChange={(e) => updateSelected({ colour: e.target.value })}
                  aria-label="Custom mark colour"
                  disabled={status === "processing"}
                  className="size-8 cursor-pointer rounded-sm border border-border"
                />
              </label>
            </ToolControl>
          )}

          {selected && (
            <ToolControl>
              <ToolSlider
                label="Opacity"
                display={`${selected.opacity}%`}
                hint={
                  selected.kind === "highlight"
                    ? "A highlight is a flat translucent block laid over the page, not a multiply blend — the text under it comes through tinted, and at 100% it covers the text completely."
                    : "Applies to the whole mark."
                }
                min={5}
                max={100}
                step={5}
                value={selected.opacity}
                onChange={(v) => updateSelected({ opacity: v })}
                disabled={status === "processing"}
              />
            </ToolControl>
          )}

          {selected?.kind === "box" && (
            <ToolControl label="LINE WIDTH">
              <input
                type="number"
                min={0.25}
                max={12}
                step={0.25}
                value={selected.lineWidth}
                onChange={(e) => updateSelected({ lineWidth: Number(e.target.value) })}
                aria-label="Box line width in points"
                disabled={status === "processing"}
                className={cn(FIELD_CLASS, "w-24")}
              />
              <span className={HINT_CLASS}>
                Points, and the line is centred on the rectangle you placed — half of it falls
                inside the shape and half outside.
              </span>
            </ToolControl>
          )}

          {selected?.kind === "note" && (
            <ToolControl label="NOTE">
              <textarea
                value={selected.text}
                onChange={(e) => updateSelected({ text: e.target.value })}
                rows={3}
                aria-label="Note text"
                disabled={status === "processing"}
                className={cn(FIELD_CLASS, "resize-y font-body leading-[1.45]")}
              />
              <label className="flex items-center justify-between gap-3 font-body text-[12.5px] text-neutral-300">
                Size in points
                <input
                  type="number"
                  min={5}
                  max={96}
                  step={1}
                  value={selected.fontSize}
                  onChange={(e) => updateSelected({ fontSize: Number(e.target.value) })}
                  aria-label="Note size in points"
                  disabled={status === "processing"}
                  className={cn(FIELD_CLASS, "w-24")}
                />
              </label>
              <span className={HINT_CLASS}>
                Nothing is wrapped for you — press Enter where a line should break. Extra lines
                land {NOTE_LINE_HEIGHT_PT} points below the one before, whatever size you pick, so
                above {NOTE_LINE_HEIGHT_PT} pt they start to overlap. The preview spaces them the
                same way.
              </span>
            </ToolControl>
          )}
        </ToolControlGroup>

        <ToolAsideSection label="WHAT THIS CANNOT DO">
          <span className={HINT_CLASS}>
            <strong>It does not select text.</strong> The page you are marking is a picture of the
            page, and the engine underneath has no model of where the words are — so a highlight
            is a coloured rectangle at the spot you chose, not a highlight that finds a line and
            follows it across a column break. Placing one over a paragraph is your eye&apos;s job,
            not the tool&apos;s.
          </span>
          <span className={HINT_CLASS}>
            <strong>The marks are painted into the page.</strong> They are drawn into the page&apos;s
            own content rather than attached as PDF annotation objects, so a reader shows no
            comment to click, no author, no reply and no Delete. That makes them permanent in
            normal use: taking one out again means editing the page itself. If you need something
            a colleague can answer, this is the wrong tool.
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="WHAT DOES NOT CHANGE">
          {/*
            Every clause here is something `stampPdf` demonstrably does not do,
            rather than a guess at what a rewrite costs. It appends drawing
            operators to ONE page's content (`resolvePages` is given a single
            index) and saves; it never touches a page box, the page tree, a font
            already in the file, or an image XObject. Deliberately NOT claiming
            the other pages come back "byte for byte" — pdf-lib re-serialises
            the whole document on `save`, and that is a claim about the file
            this component has not measured.
          */}
          <span className={HINT_CLASS}>
            Only the page you marked is changed, and only by adding to it. Nothing is removed,
            no page is re-laid-out, page sizes and page order are untouched, existing text stays
            selectable and searchable, and no image in the file is re-encoded.
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Page", `${preview?.page ?? pageNumber} of ${pageCount || "—"}`],
              ["Out", result ? formatFileSize(result.size) : "—"],
              ["Marks", `${marks.length}`],
              ["Page size", pageLabel],
            ]}
          />
        </ToolAsideSection>

        <ToolAdvanced
          rows={[
            ["Marks", "DRAWN INTO THE PAGE"],
            ["Annotation objects", "NONE WRITTEN"],
            ["Existing text", "UNTOUCHED"],
            ["Note font", "HELVETICA · WINANSI"],
            ["Note line spacing", `${NOTE_LINE_HEIGHT_PT} PT FIXED`],
          ]}
        />
      </ToolAside>
    </>
  );
}
