"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import {
  deletePdfPages,
  loadPdfjsDocument,
  renderPageFromDoc,
  stampPdf,
  type PdfStamp,
} from "@/lib/tools/pdf-engine";
import { normaliseRotation, unsupportedStampCharacters } from "@/lib/tools/pdf-stamp-core";
import { readImageOrientation } from "@/lib/tools/image-orientation";
import { canvasToBlob, loadImage } from "@/lib/tools/canvas-utils";
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
  PDF EDITOR — five verbs, and one sentence the whole page is built around.

  THE SENTENCE: **the text already in your PDF cannot be edited here.** Not
  "not yet", not "only for some files". A PDF page is a content stream of
  drawing operators — "set font F1 at 11 pt, move to (72, 698), show these
  glyphs" — with no paragraphs, no line boxes and no reflow model. Nothing in
  this repo's dependency set (pdf-lib for writing, pdfjs-dist for rendering)
  can find the sentence a glyph belongs to, delete it and re-lay-out what
  follows. Adobe's own free tier cannot do it either. A reader who arrives here
  expecting Word-for-PDFs and is not told IMMEDIATELY has been misled, so the
  claim is refused on the canvas, in the rail, in the FAQ and in the registry
  copy rather than only in prose below the fold.

  What this page really is: five things you can ADD TO or REMOVE FROM a
  document, all of which the engine can do exactly.

    add text   → PdfTextStamp   (drawText, Helvetica/Helvetica-Bold)
    add image  → PdfImageStamp  (embedPng / embedJpg + drawImage)
    whiteout   → PdfRectStamp   fill #ffffff, opacity 1 — PAINT, NOT REDACTION
    freehand   → PdfPathStamp   (a round-capped polyline, drawn segment by segment)
    delete page → deletePdfPages

  TWO OPS, IN ONE ORDER THAT MATTERS. `stampPdf` runs FIRST and `deletePdfPages`
  second, because every stamp's `pages` is a 0-based index into the document as
  it stands when the op runs. Deleting first would shift every index after the
  hole and land marks on the wrong pages. See `handleApply`.
*/

/* ── Marks ───────────────────────────────────────────────────────────────── */

type EditKind = "text" | "image" | "whiteout" | "draw";

const EDIT_LABEL: Record<EditKind, string> = {
  text: "Text",
  image: "Image",
  whiteout: "Whiteout",
  draw: "Ink",
};

/** A picture prepared for embedding — see `prepareImage` for the EXIF half. */
interface EditImage {
  name: string;
  /** What goes to the engine: the original bytes, or the re-encoded ones. */
  bytes: Uint8Array;
  type: "image/png" | "image/jpeg";
  /** Object URL of exactly those bytes, so the preview is the embedded picture. */
  url: string;
  /** The picture's own pixel size, which is what sets the drawn aspect ratio. */
  width: number;
  height: number;
  sourceSize: number;
  /** The EXIF Orientation the file carried. 1 means "as stored". */
  orientation: number;
  /** True when the rotation had to be baked in, which costs a re-encode. */
  reencoded: boolean;
}

/**
 * One mark, in ONE coordinate space: percent of the page AS DISPLAYED, from
 * its top-left corner. That is `PdfStampCommon.at` (and `PdfRectStamp.size`)
 * multiplied by 100 and nothing else, so the number in a field, the shape on
 * the preview and the fraction handed to the engine are the same quantity.
 * `PixelateImageUI` established the rule; it is the reason a drag and a typed
 * number can never disagree, and the reason four of the five verbs are fully
 * operable from a keyboard.
 *
 * Deliberately flat rather than a discriminated union: every mark shares the
 * placement editor, and a union would mean four parallel field blocks that
 * drift. Fields a kind does not use are simply not read for that kind — the
 * `stampFor` switch below is the single place that decides which.
 */
interface Edit {
  id: number;
  kind: EditKind;
  /** 1-based, matching the PAGE field. Converted to 0-based only in `stampFor`. */
  page: number;
  x: number;
  y: number;
  /** Whiteout: box width. Image: width, with the height following the picture. */
  width: number;
  /** Whiteout only. */
  height: number;
  /** Text only. */
  text: string;
  /** Text only, in points. */
  fontSize: number;
  /** Text only. */
  bold: boolean;
  /** Text colour, or ink colour. Whiteout is white by definition. */
  colour: string;
  /** Percent; divided by 100 on the way into the stamp. */
  opacity: number;
  /** Ink only, in points. */
  strokeWidth: number;
  /** Ink only. FRACTIONS of the displayed page, in draw order — the engine's own unit. */
  points: { x: number; y: number }[];
  /** Image only. */
  image: EditImage | null;
}

type EditDefaults = Omit<Edit, "id" | "kind" | "page">;

const EDIT_DEFAULTS: Record<EditKind, EditDefaults> = {
  text: {
    x: 12, y: 20, width: 0, height: 0,
    text: "New text", fontSize: 12, bold: false,
    colour: "#111111", opacity: 100, strokeWidth: 2, points: [], image: null,
  },
  image: {
    x: 12, y: 20, width: 30, height: 0,
    text: "", fontSize: 12, bold: false,
    colour: "#111111", opacity: 100, strokeWidth: 2, points: [], image: null,
  },
  whiteout: {
    x: 12, y: 20, width: 48, height: 6,
    text: "", fontSize: 12, bold: false,
    colour: "#ffffff", opacity: 100, strokeWidth: 2, points: [], image: null,
  },
  draw: {
    x: 0, y: 0, width: 0, height: 0,
    text: "", fontSize: 12, bold: false,
    colour: "#e0245e", opacity: 100, strokeWidth: 2, points: [], image: null,
  },
};

const INK_SWATCHES = [
  { value: "#111111", label: "Black" },
  { value: "#e0245e", label: "Red" },
  { value: "#1f6feb", label: "Blue" },
  { value: "#1a7f37", label: "Green" },
  { value: "#b35c00", label: "Amber" },
] as const;

/** Under this, a pointer gesture is a click that MOVES a mark, not a resize. */
const MIN_DRAG_PERCENT = 1.5;

/**
 * How far the pointer must travel before a stroke records another point, in
 * percent of the page. A raw `pointermove` stream is hundreds of samples for
 * one flick, and EVERY sample becomes its own `page.drawLine` call in the
 * content stream (pdf-engine-core.ts, the `path` branch of `drawStamp`), so an
 * undecimated stroke is both a fatter file and a slower save for a line nobody
 * can see the extra detail in.
 */
const MIN_STROKE_STEP = 0.35;

/** A hard ceiling on one stroke, for the same reason. */
const MAX_STROKE_POINTS = 600;

/**
 * pdf-lib leaves `lineHeight` at the `PDFPage` default of 24 and `stampPdf`
 * never overrides it, so a text mark's second and later lines land 24 points
 * below the one before WHATEVER font size you pick. The preview spaces its own
 * lines by exactly this number, so the surface carries the quirk instead of a
 * rail sentence having to.
 */
const TEXT_LINE_HEIGHT_PT = 24;

const FIELD_CLASS =
  "w-full rounded-md border border-border bg-bg-elevated px-2.5 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45";

const HINT_CLASS = "font-body text-[10.5px] leading-[1.5] text-text-muted";

const LINK_CLASS =
  "cursor-pointer self-start rounded-sm text-xs text-accent transition-colors hover:text-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:text-text-muted";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/**
 * The two formats a PDF can hold directly, sniffed from the BYTES.
 *
 * Names and MIME types lie — a WebP saved as `logo.png` is a file the picker's
 * `accept` list waves through and `embedPng` then rejects with a parser
 * internal. Same rule `AddImageToPdfUI` uses, kept local for the same reason:
 * `images-to-pdf-prep.ts` statically imports the HEIC and TIFF decoders and
 * this page has no use for them.
 */
function sniffImageType(bytes: Uint8Array): "image/png" | "image/jpeg" | null {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return "image/png";
  return null;
}

/** The quality the images→PDF family re-encodes at, for the EXIF redraw below. */
const REENCODE_JPEG_QUALITY = 0.92;

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value * 10) / 10));
}

function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Pull a mark back onto the page.
 *
 * Not decoration: `fractionToUserSpace` clamps the ANCHOR to 0..1
 * (pdf-stamp-core.ts) while the SIZE is taken from there unclamped, so a
 * rectangle wider than the page runs off the edge in the download while the
 * preview would happily draw it inside the frame. Keeping the rectangle on the
 * page keeps the two pictures identical.
 *
 * The origin is bounded to 99.5 rather than 100 because the extent below is
 * clamped into `100 - x`: an origin of 99.8 would hand `clampNumber` a max
 * under its own min, which returns the max — i.e. a NEGATIVE width, which
 * draws nothing in SVG and a back-to-front rectangle in the PDF.
 */
function normaliseEdit(edit: Edit): Edit {
  const x = clampNumber(edit.x, 0, 99.5);
  const y = clampNumber(edit.y, 0, 99.5);
  return {
    ...edit,
    x,
    y,
    width:
      edit.kind === "whiteout"
        ? clampNumber(edit.width, 0.5, 100 - x)
        : edit.kind === "image"
          ? clampNumber(edit.width, 1, 100 - x)
          : edit.width,
    height: edit.kind === "whiteout" ? clampNumber(edit.height, 0.5, 100 - y) : edit.height,
    opacity: clampNumber(edit.opacity, 5, 100),
    fontSize: clampNumber(edit.fontSize, 4, 144),
    strokeWidth: clampNumber(edit.strokeWidth, 0.25, 24),
  };
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The bounding box of a stroke, in percent of the page. */
function strokeBounds(points: readonly { x: number; y: number }[]): Rect {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    x: minX * 100,
    y: minY * 100,
    width: (maxX - minX) * 100,
    height: (maxY - minY) * 100,
  };
}

/**
 * Where a mark's X/Y fields point.
 *
 * A stroke has no stored anchor — its geometry IS its point list — so its
 * origin is derived from the bounding box. That is what lets the X and Y
 * fields move a stroke a keyboard could never have drawn.
 */
function editOrigin(edit: Edit): { x: number; y: number } {
  if (edit.kind !== "draw") return { x: edit.x, y: edit.y };
  const box = strokeBounds(edit.points);
  return { x: Math.round(box.x * 10) / 10, y: Math.round(box.y * 10) / 10 };
}

/**
 * Move a mark so its origin lands at (x, y).
 *
 * A stroke is TRANSLATED, and the translation is clamped as a whole rather
 * than point by point — clamping each point on its own would squash the stroke
 * against the edge instead of stopping it there.
 */
function moveEditTo(edit: Edit, x: number, y: number): Edit {
  if (edit.kind !== "draw") return normaliseEdit({ ...edit, x, y });
  const box = strokeBounds(edit.points);
  const nx = clampNumber(x, 0, Math.max(0, 100 - box.width));
  const ny = clampNumber(y, 0, Math.max(0, 100 - box.height));
  const dx = (nx - box.x) / 100;
  const dy = (ny - box.y) / 100;
  return {
    ...edit,
    x: nx,
    y: ny,
    points: edit.points.map((p) => ({ x: clampFraction(p.x + dx), y: clampFraction(p.y + dy) })),
  };
}

interface Point {
  x: number;
  y: number;
}

function rectBetween(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
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

/** A character named so the sentence reads — a bare quoted TAB says nothing. */
function describeCharacter(character: string): string {
  if (character === "\t") return "a tab";
  const code = character.codePointAt(0) ?? 0;
  if (code < 0x20 || code === 0x7f) {
    return `a control character (U+${code.toString(16).toUpperCase().padStart(4, "0")})`;
  }
  return `"${character}"`;
}

type PdfjsDocument = Awaited<ReturnType<typeof loadPdfjsDocument>>;

interface Snapshot {
  edits: Edit[];
  deleted: number[];
}

export function PdfEditorUI() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [edits, setEdits] = useState<Edit[]>([]);
  /** 1-based page numbers marked for removal. */
  const [deleted, setDeleted] = useState<number[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drawArmed, setDrawArmed] = useState(false);
  const [draft, setDraft] = useState<Point[] | null>(null);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "processing" | "done" | "error">(
    "idle",
  );
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The doc pins a "Done in 1.4 s" card above the primary once a run
  // finishes. Timed for real; cleared the moment the edit list changes.
  const [elapsed, setElapsed] = useState<string | null>(null);

  const nextIdRef = useRef(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Which mark a picked image is for; null means "make a new one". */
  const imageTargetRef = useRef<number | null>(null);
  /** Live stroke, kept off state so a pointermove is one setState, not two. */
  const strokeRef = useRef<Point[]>([]);

  /*
    ONE pdfjs parse per FILE, not per page.

    A tool called an editor invites page-flipping, and re-reading the whole
    file and re-parsing its object graph on every page change is seconds of
    work for a document of any size. The proxy is cached against the File
    object that produced it and destroyed when that identity changes or the
    component unmounts. The cache is only ever touched from inside an effect or
    a handler — never during render, which `react-hooks/refs` forbids.
  */
  const docCacheRef = useRef<{ key: File; doc: PdfjsDocument } | null>(null);

  useEffect(
    () => () => {
      void docCacheRef.current?.doc.destroy();
      docCacheRef.current = null;
    },
    [],
  );

  /*
    Every object URL this component ever makes, revoked together at unmount.

    Deliberately NOT revoked when a mark is removed: Undo can bring that mark
    back, and a resurrected mark pointing at a revoked URL is a broken picture
    on the canvas with a perfectly valid download behind it. The bytes are held
    by the mark anyway, so the URL is the cheap half.
  */
  const objectUrlsRef = useRef<string[]>([]);
  useEffect(
    () => () => {
      for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
      objectUrlsRef.current = [];
    },
    [],
  );

  /*
    The app-wide "stale-result invalidation" contract, with the fence the plain
    version is missing. Clearing `result` alone is inert while a run is in
    flight — there is nothing to clear yet — and both `stampPdf` and
    `deletePdfPages` run in the pool worker, so the whole surface stays
    editable for the length of a run. Move a mark mid-run and the finished
    bytes would describe a page that is no longer anywhere on screen. A run
    claims the token before its first await and commits nothing unless it still
    holds it.
  */
  const runToken = useRef(0);

  const invalidate = useCallback(() => {
    runToken.current += 1;
    setResult(null);
    setElapsed(null);
    setError(null);
    setStatus((s) => (s === "done" || s === "processing" || s === "error" ? "idle" : s));
  }, []);

  /** Snapshot BEFORE a structural change, so Undo has somewhere to go back to. */
  const pushHistory = useCallback(() => {
    setHistory((h) => [...h.slice(-29), { edits, deleted }]);
  }, [deleted, edits]);

  const handleFiles = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      setFile(f);
      setPageCount(0);
      setPageNumber(1);
      setPreview(null);
      setEdits([]);
      setDeleted([]);
      setHistory([]);
      setSelectedId(null);
      setDrawArmed(false);
      setDraft(null);
      setDragStart(null);
      setImageError(null);
      invalidate();
    },
    [invalidate],
  );

  const handleReset = useCallback(() => {
    setFile(null);
    setPageCount(0);
    setPageNumber(1);
    setPreview(null);
    setEdits([]);
    setDeleted([]);
    setHistory([]);
    setSelectedId(null);
    setDrawArmed(false);
    setDraft(null);
    setDragStart(null);
    setImageError(null);
    invalidate();
  }, [invalidate]);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    (async () => {
      try {
        // Inside the async body, not beside it: `react-hooks/set-state-in-effect`
        // rejects a setState in the effect body itself, and the phase readout
        // is exactly the kind of "an external system is busy" signal an effect
        // is allowed to publish. Nothing has awaited yet, so it still lands in
        // the same commit a bare call would have.
        setStatus("loading");
        let entry = docCacheRef.current;
        if (!entry || entry.key !== file) {
          const opened = await loadPdfjsDocument(await file.arrayBuffer());
          if (cancelled) {
            await opened.destroy();
            return;
          }
          if (docCacheRef.current && docCacheRef.current.key !== file) {
            void docCacheRef.current.doc.destroy();
          }
          entry = { key: file, doc: opened };
          docCacheRef.current = entry;
        }
        const total = entry.doc.numPages;
        const target = Math.min(Math.max(1, pageNumber), total);
        const page = await entry.doc.getPage(target);
        const visual = page.getViewport({ scale: 1 });
        // Big enough to place a mark on one line of type, capped so a tabloid
        // sheet does not become a 20 MB data URL held in React state.
        const scale = Math.min(2.5, Math.max(0.75, 1000 / visual.width));
        const canvas = await renderPageFromDoc(entry.doc, target, scale);
        if (cancelled) return;
        setPageCount(total);
        // The field has to agree with the page on screen. A number typed
        // before the document was open can be past the end, and the render
        // silently falls back to the last page — leaving the rail claiming
        // page 999. Writing the clamped value back converges in one extra
        // pass, because clamping it again is a no-op.
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
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, pageNumber]);

  const selected = edits.find((e) => e.id === selectedId) ?? null;
  const currentPage = preview?.page ?? pageNumber;
  const pageIsDeleted = deleted.includes(currentPage);

  const updateSelected = useCallback(
    (patch: Partial<Edit>) => {
      invalidate();
      setEdits((list) =>
        list.map((e) => (e.id === selectedId ? normaliseEdit({ ...e, ...patch }) : e)),
      );
    },
    [invalidate, selectedId],
  );

  const moveSelectedTo = useCallback(
    (x: number, y: number) => {
      invalidate();
      setEdits((list) => list.map((e) => (e.id === selectedId ? moveEditTo(e, x, y) : e)));
    },
    [invalidate, selectedId],
  );

  const addEdit = useCallback(
    (kind: EditKind, image: EditImage | null = null) => {
      const id = nextIdRef.current;
      nextIdRef.current += 1;
      pushHistory();
      invalidate();
      setEdits((list) => [
        ...list,
        normaliseEdit({ id, kind, page: currentPage, ...EDIT_DEFAULTS[kind], image }),
      ]);
      setSelectedId(id);
      setDrawArmed(false);
      return id;
    },
    [currentPage, invalidate, pushHistory],
  );

  const removeSelected = useCallback(() => {
    if (selectedId === null) return;
    pushHistory();
    invalidate();
    setEdits((list) => list.filter((e) => e.id !== selectedId));
    setSelectedId(null);
  }, [invalidate, pushHistory, selectedId]);

  const clearEdits = useCallback(() => {
    pushHistory();
    invalidate();
    setEdits([]);
    setDeleted([]);
    setSelectedId(null);
    setDrawArmed(false);
  }, [invalidate, pushHistory]);

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const last = history[history.length - 1];
    invalidate();
    setEdits(last.edits);
    setDeleted(last.deleted);
    setSelectedId(null);
    setDrawArmed(false);
    setHistory(history.slice(0, -1));
  }, [history, invalidate]);

  const togglePageDeleted = useCallback(() => {
    pushHistory();
    invalidate();
    setDeleted((list) =>
      list.includes(currentPage)
        ? list.filter((p) => p !== currentPage)
        : [...list, currentPage].sort((a, b) => a - b),
    );
  }, [currentPage, invalidate, pushHistory]);

  /* ── Images ─────────────────────────────────────────────────────────────── */

  /*
    Turn a picked file into bytes the engine can embed and a preview that shows
    the same picture.

    The EXIF arm is the load-bearing half, and it is a trap this repo has
    written down: `<img>` and `createImageBitmap` both APPLY the Orientation
    tag, so `naturalWidth`/`naturalHeight` are the size a person SEES, while
    `embedPng`/`embedJpg` take `/Width` and `/Height` from the stored sample
    grid and ignore the tag entirely. Where the two differ, the picture is
    redrawn through a canvas at its displayed size — a canvas writes no EXIF,
    so the bytes that reach the engine are tagged nothing and stored the way
    they look. A JPEG pays one re-encode for that, which the canvas says out
    loud rather than leaving to be discovered in the output.
  */
  const prepareImage = useCallback(async (picked: File): Promise<EditImage> => {
    const raw = new Uint8Array(await picked.arrayBuffer());
    const type = sniffImageType(raw);
    if (!type) {
      throw new Error(
        "This editor can place PNG and JPEG images, which are the two formats a PDF can hold directly. This file is neither — convert it first.",
      );
    }
    const orientation = readImageOrientation(raw, type);
    const decoded = await loadImage(new Blob([raw as BlobPart], { type }));
    const width = decoded.naturalWidth;
    const height = decoded.naturalHeight;
    if (!width || !height) throw new Error("This image could not be decoded.");

    const remember = (url: string) => {
      objectUrlsRef.current.push(url);
      return url;
    };

    if (orientation === 1) {
      // Nothing to correct, so the original bytes go in untouched — no
      // re-encode, no generational loss, and a PNG keeps its exact pixels.
      return {
        name: picked.name,
        bytes: raw,
        type,
        url: remember(URL.createObjectURL(new Blob([raw as BlobPart], { type }))),
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
      url: remember(URL.createObjectURL(blob)),
      width,
      height,
      sourceSize: picked.size,
      orientation,
      reencoded: true,
    };
  }, []);

  const openImagePicker = useCallback((targetId: number | null) => {
    imageTargetRef.current = targetId;
    setImageError(null);
    fileInputRef.current?.click();
  }, []);

  const handleImagePicked = useCallback(
    async (picked: File | undefined) => {
      if (!picked) return;
      const target = imageTargetRef.current;
      try {
        const prepared = await prepareImage(picked);
        if (target === null) {
          addEdit("image", prepared);
        } else {
          invalidate();
          setEdits((list) =>
            list.map((e) => (e.id === target ? { ...e, image: prepared } : e)),
          );
        }
      } catch (err) {
        setImageError(err instanceof Error ? err.message : "Could not read this image.");
      }
    },
    [addEdit, invalidate, prepareImage],
  );

  /* ── The placement surface ──────────────────────────────────────────────── */

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
      if (status === "processing" || pageIsDeleted) return;
      const p = pointToPercent(e);
      if (!p) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture is not universal and a gesture is not worth refusing
        // over it. What it buys is the `pointerup` from outside the frame;
        // without it the gesture ends at the next press instead. Every write
        // it makes still goes through `invalidate()`, so the worst case is a
        // mark that keeps following the pointer — never a download that stops
        // matching the mark on screen.
      }
      if (drawArmed) {
        strokeRef.current = [{ x: clampFraction(p.x / 100), y: clampFraction(p.y / 100) }];
        setDraft([p]);
        return;
      }
      if (!selected || selected.page !== currentPage) return;
      setDragStart(p);
      if (selected.kind !== "whiteout") moveSelectedTo(p.x, p.y);
    },
    [
      currentPage,
      drawArmed,
      moveSelectedTo,
      pageIsDeleted,
      pointToPercent,
      selected,
      status,
    ],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const p = pointToPercent(e);
      if (!p) return;
      if (draft) {
        const points = strokeRef.current;
        const last = points[points.length - 1];
        const next = { x: clampFraction(p.x / 100), y: clampFraction(p.y / 100) };
        if (points.length >= MAX_STROKE_POINTS) return;
        if (
          last &&
          Math.hypot((next.x - last.x) * 100, (next.y - last.y) * 100) < MIN_STROKE_STEP
        ) {
          return;
        }
        points.push(next);
        setDraft(points.map((q) => ({ x: q.x * 100, y: q.y * 100 })));
        return;
      }
      if (!dragStart || !selected) return;
      if (selected.kind !== "whiteout") {
        moveSelectedTo(p.x, p.y);
        return;
      }
      const rect = rectBetween(dragStart, p);
      // Below the threshold the gesture is still ambiguous — leave the mark
      // alone until `pointerup` decides whether it was a click or a drag.
      if (rect.width < MIN_DRAG_PERCENT || rect.height < MIN_DRAG_PERCENT) return;
      updateSelected(rect);
    },
    [dragStart, draft, moveSelectedTo, pointToPercent, selected, updateSelected],
  );

  const finishStroke = useCallback(() => {
    const points = strokeRef.current;
    strokeRef.current = [];
    setDraft(null);
    // One point is a click, not a stroke, and `drawStamp` draws nothing for a
    // path of fewer than two points — so it would be an invisible mark in the
    // list that made the primary look ready.
    if (points.length < 2) return;
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    pushHistory();
    invalidate();
    const box = strokeBounds(points);
    setEdits((list) => [
      ...list,
      {
        ...EDIT_DEFAULTS.draw,
        id,
        kind: "draw",
        page: currentPage,
        x: Math.round(box.x * 10) / 10,
        y: Math.round(box.y * 10) / 10,
        colour: selected?.kind === "draw" ? selected.colour : EDIT_DEFAULTS.draw.colour,
        strokeWidth:
          selected?.kind === "draw" ? selected.strokeWidth : EDIT_DEFAULTS.draw.strokeWidth,
        points,
      },
    ]);
    setSelectedId(id);
  }, [currentPage, invalidate, pushHistory, selected]);

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (draft) {
        finishStroke();
        return;
      }
      if (!dragStart || !selected) return;
      const p = pointToPercent(e);
      setDragStart(null);
      if (!p) return;
      if (selected.kind !== "whiteout") {
        moveSelectedTo(p.x, p.y);
        return;
      }
      const rect = rectBetween(dragStart, p);
      // A click, or a twitch while clicking: move the mark, keep its size.
      // Top-left rather than centre because that is what the X and Y fields
      // hold, and the two must describe the same corner.
      if (rect.width < MIN_DRAG_PERCENT || rect.height < MIN_DRAG_PERCENT) {
        moveSelectedTo(dragStart.x, dragStart.y);
        return;
      }
      updateSelected(rect);
    },
    [dragStart, draft, finishStroke, moveSelectedTo, pointToPercent, selected, updateSelected],
  );

  const handleGestureCancel = useCallback(() => {
    if (draft) finishStroke();
    setDragStart(null);
  }, [draft, finishStroke]);

  /* ── What can run ───────────────────────────────────────────────────────── */

  const pageEdits = edits.filter((e) => e.page === currentPage);
  const liveEdits = edits.filter((e) => !deleted.includes(e.page));
  const strandedEdits = edits.length - liveEdits.length;
  const emptyText = liveEdits.some((e) => e.kind === "text" && e.text.trim() === "");
  const imagelessMark = liveEdits.some((e) => e.kind === "image" && e.image === null);
  const wouldEmptyDocument = pageCount > 0 && deleted.length >= pageCount;

  /*
    The WinAnsi pre-flight, run on the SAME function the engine refuses with.

    `unsupportedStampCharacters` lives in `pdf-stamp-core.ts`, which has ZERO
    imports of any kind — that is the whole reason it was moved there, so a
    component can warn before the run without dragging pdf-lib's eager chunk
    into this page's bundle. The engine calls the same predicate and throws
    with the same set, so the check a user sees on keypress and the check that
    refuses the run cannot drift apart.
  */
  const badCharacters = (() => {
    // Numbered against `edits`, NOT `liveEdits`: the chips in the rail are
    // numbered by their position in the full list, and a message that counts
    // a shorter list points at the wrong chip the moment a page is deleted.
    for (const [index, edit] of edits.entries()) {
      if (edit.kind !== "text" || deleted.includes(edit.page)) continue;
      const bad = unsupportedStampCharacters(edit.text);
      if (bad.length > 0) return { index: index + 1, page: edit.page, bad };
    }
    return null;
  })();

  const characterMessage = badCharacters
    ? `Mark ${badCharacters.index} (page ${badCharacters.page}) contains ${badCharacters.bad
        .map(describeCharacter)
        .join(
          ", ",
        )}. Text is drawn with the standard PDF fonts, which cover Latin letters, digits and punctuation — including accents, curly quotes and the euro sign — and nothing else. Remove those characters, or place the wording as an image instead.`
    : null;

  const handleApply = useCallback(async () => {
    if (!file) return;
    // Claimed BEFORE the first await, and bumped by every control, every drag
    // and a file swap — a mismatch on the way out means "the edits this run
    // was for are gone", so the bytes are dropped rather than published.
    runToken.current += 1;
    const token = runToken.current;
    setStatus("processing");
    setError(null);
    setElapsed(null);
    setResult(null);
    const startedAt = performance.now();

    const stamps: PdfStamp[] = [];
    for (const edit of edits) {
      // A mark on a page that is about to go is not worth drawing. Stamping it
      // would be correct and invisible; skipping it keeps the content stream
      // honest about what is actually in the output.
      if (deleted.includes(edit.page)) continue;
      const pages = [edit.page - 1];
      const at = { x: edit.x / 100, y: edit.y / 100 };
      const opacity = edit.opacity / 100;
      // `rotate` is left at zero throughout: the engine ADDS the page's own
      // /Rotate (drawStamp composes `stamp.rotate + rotation`), so zero means
      // "upright as displayed" — which is what the preview draws.
      if (edit.kind === "text") {
        stamps.push({
          kind: "text",
          pages,
          at,
          opacity,
          rotate: 0,
          text: edit.text,
          size: edit.fontSize,
          colour: edit.colour,
          bold: edit.bold,
          behind: false,
          tile: false,
        });
      } else if (edit.kind === "whiteout") {
        stamps.push({
          kind: "rect",
          pages,
          at,
          // Opaque by definition. A translucent cover is not a cover.
          opacity: 1,
          rotate: 0,
          size: { width: edit.width / 100, height: edit.height / 100 },
          fill: "#ffffff",
          strokeWidth: 0,
        });
      } else if (edit.kind === "image" && edit.image) {
        stamps.push({
          kind: "image",
          pages,
          at,
          opacity,
          rotate: 0,
          bytes: edit.image.bytes,
          type: edit.image.type,
          widthFraction: edit.width / 100,
          behind: false,
          tile: false,
        });
      } else if (edit.kind === "draw" && edit.points.length >= 2) {
        stamps.push({
          kind: "path",
          pages,
          // A path ignores its anchor — each point is mapped independently —
          // but `at` is required, so it names the point the stroke starts at.
          at: { ...edit.points[0] },
          opacity,
          rotate: 0,
          points: edit.points.map((p) => ({ ...p })),
          stroke: edit.colour,
          strokeWidth: edit.strokeWidth,
        });
      }
    }

    try {
      // Typed as the union both ops accept: `file.arrayBuffer()` hands back an
      // ArrayBuffer and `stampPdf` a `Uint8Array<ArrayBufferLike>`, and pinning
      // the variable to whichever came first makes the reassignment a type
      // error rather than a conversion.
      let bytes: ArrayBuffer | Uint8Array = await file.arrayBuffer();
      /*
        ORDER IS LOAD-BEARING. Every stamp's `pages` is a 0-based index into
        the document AS IT STANDS when the op runs, so the marks go on first
        and the pages come out second. Deleting first would shift every index
        after the hole and land marks on the wrong pages.
      */
      if (stamps.length > 0) bytes = await stampPdf(bytes, stamps);
      if (deleted.length > 0) {
        bytes = await deletePdfPages(
          bytes,
          deleted.map((p) => p - 1).sort((a, b) => a - b),
        );
      }
      if (runToken.current !== token) return;
      setResult(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      // A small PDF finishes in tens of milliseconds; "Done in 0.0 s" reads
      // like a stopwatch that never started. Sub-second runs report ms.
      const ms = performance.now() - startedAt;
      setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
      setStatus("done");
    } catch (err) {
      // A superseded run's failure belongs to edits nobody is looking at.
      if (runToken.current !== token) return;
      // The engine's refusals already carry a sentence naming their reason —
      // the unsupported-character one names the characters. Re-wording it here
      // would only let the two drift.
      setError(err instanceof Error ? err.message : "Failed to apply these edits");
      setStatus("error");
    }
  }, [deleted, edits, file]);

  if (!file) return <DropZone accept=".pdf" onFiles={handleFiles} label="Upload a PDF to edit" />;

  const hasWork = liveEdits.length > 0 || deleted.length > 0;
  const canRun =
    preview !== null &&
    hasWork &&
    !emptyText &&
    !imagelessMark &&
    !wouldEmptyDocument &&
    badCharacters === null &&
    status !== "processing" &&
    status !== "loading";

  const pageLabel = preview
    ? `${Math.round(preview.width)} × ${Math.round(preview.height)} PT`
    : "—";
  const pagesOut = pageCount > 0 ? pageCount - deleted.length : 0;

  const originOf = selected ? editOrigin(selected) : { x: 0, y: 0 };

  return (
    <>
      {/* ── Canvas: the page, with the marks drawn where they will land ── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={`${pageCount || "—"} PAGE${pageCount === 1 ? "" : "S"} · ${formatFileSize(file.size)}`}
          trailing={`${edits.length} MARK${edits.length === 1 ? "" : "S"}`}
        />

        {/*
          No `STAGE_GROW`, and that is load-bearing rather than a style choice:
          the wrapper below has to shrink-wrap the <img> EXACTLY, because every
          gesture reads its bounding box as the page and the SVG overlay is
          `inset-0` of it. A stage that stretched and then clipped a tall page
          would leave the box and the picture describing different rectangles,
          and every mark would land somewhere other than where it was drawn.
        */}
        <CanvasStage className="flex items-center justify-center bg-bg-secondary p-4">
          {preview && (
            <div
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handleGestureCancel}
              onLostPointerCapture={handleGestureCancel}
              className={cn(
                "relative inline-block touch-none select-none",
                pageIsDeleted
                  ? "cursor-not-allowed opacity-40"
                  : drawArmed || selected
                    ? "cursor-crosshair"
                    : "cursor-default",
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
                every mark is drawn in the engine's own units: a stroke's
                thickness is points, a text mark's size is points at the page's
                real scale rather than a guess in CSS pixels, and the fixed
                24 pt line advance can be drawn literally instead of described.
              */}
              <svg
                viewBox={`0 0 ${preview.width} ${preview.height}`}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 size-full"
              >
                {pageEdits.map((edit) => {
                  const x = (edit.x / 100) * preview.width;
                  const y = (edit.y / 100) * preview.height;
                  const isSelected = edit.id === selectedId;

                  if (edit.kind === "text") {
                    // pdf-lib splits on newlines and never wraps, so the
                    // preview does exactly that: one tspan per line, the first
                    // on the baseline at (x, y) — which is where `drawText`
                    // starts — and each later one 24 pt below.
                    const lines = edit.text.split(/\r\n|[\n\r]/);
                    return (
                      <g key={edit.id}>
                        {isSelected && (
                          /*
                            An anchor caret, deliberately NOT a bounding box:
                            this component cannot measure Helvetica's advance
                            widths, so any box it drew round the words would be
                            a guess, and a guessed box next to real text reads
                            as a claim about the mark's extent. The caret claims
                            only what is exact — where the first line starts.
                          */
                          <path
                            d={`M ${x} ${y - edit.fontSize} L ${x} ${y} L ${x + edit.fontSize * 0.8} ${y}`}
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
                          fontSize={edit.fontSize}
                          fontWeight={edit.bold ? "bold" : "normal"}
                          fill={edit.colour}
                          fillOpacity={edit.opacity / 100}
                        >
                          {lines.map((line, i) => (
                            <tspan key={i} x={x} dy={i === 0 ? 0 : TEXT_LINE_HEIGHT_PT}>
                              {/* A blank line still advances the baseline in
                                  the PDF (T* runs regardless), so it has to
                                  advance here too — an empty tspan would be
                                  skipped by some renderers. */}
                              {line === "" ? " " : line}
                            </tspan>
                          ))}
                        </text>
                      </g>
                    );
                  }

                  if (edit.kind === "image") {
                    const w = (edit.width / 100) * preview.width;
                    // Exactly what `drawStamp` computes: the height follows the
                    // picture's own pixel aspect, never the page's.
                    const h = edit.image ? (edit.image.height / edit.image.width) * w : w * 0.6;
                    return (
                      <g key={edit.id}>
                        {edit.image ? (
                          <image
                            href={edit.image.url}
                            x={x}
                            y={y}
                            width={w}
                            height={h}
                            opacity={edit.opacity / 100}
                          />
                        ) : (
                          <rect
                            x={x}
                            y={y}
                            width={w}
                            height={h}
                            fill="#000000"
                            fillOpacity={0.25}
                            stroke="#ffffff"
                            strokeWidth={1}
                            strokeDasharray="6 4"
                          />
                        )}
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
                  }

                  if (edit.kind === "whiteout") {
                    const w = (edit.width / 100) * preview.width;
                    const h = (edit.height / 100) * preview.height;
                    return (
                      <g key={edit.id}>
                        <rect x={x} y={y} width={w} height={h} fill="#ffffff" />
                        {/* A white box on a white page is invisible, so the
                            preview outlines every cover. The outline is a
                            guide — the canvas footnote says so, because it is
                            NOT drawn into the download. */}
                        <rect
                          x={x}
                          y={y}
                          width={w}
                          height={h}
                          fill="none"
                          stroke={isSelected ? "#ffffff" : "#9aa0a6"}
                          strokeWidth={1}
                          strokeDasharray="4 3"
                        />
                      </g>
                    );
                  }

                  return (
                    <polyline
                      key={edit.id}
                      points={edit.points
                        .map((p) => `${p.x * preview.width},${p.y * preview.height}`)
                        .join(" ")}
                      fill="none"
                      stroke={edit.colour}
                      strokeOpacity={edit.opacity / 100}
                      strokeWidth={edit.strokeWidth}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray={isSelected ? "6 4" : undefined}
                    />
                  );
                })}

                {draft && draft.length > 1 && (
                  <polyline
                    points={draft
                      .map(
                        (p) =>
                          `${(p.x / 100) * preview.width},${(p.y / 100) * preview.height}`,
                      )
                      .join(" ")}
                    fill="none"
                    stroke={selected?.kind === "draw" ? selected.colour : EDIT_DEFAULTS.draw.colour}
                    strokeWidth={
                      selected?.kind === "draw"
                        ? selected.strokeWidth
                        : EDIT_DEFAULTS.draw.strokeWidth
                    }
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
              </svg>
            </div>
          )}
        </CanvasStage>

        <StatStrip
          stats={[
            { label: `PAGE ${currentPage}`, value: pageLabel, tone: "neutral" },
            { label: "MARKS HERE", value: `${pageEdits.length}` },
            {
              label: "SELECTED",
              value: selected ? EDIT_LABEL[selected.kind].toUpperCase() : "NONE",
              tone: "neutral",
            },
            {
              label: "THIS PAGE",
              value: pageIsDeleted ? "DELETED" : "KEPT",
              tone: pageIsDeleted ? "accent" : "neutral",
            },
            {
              label: "PAGES OUT",
              value: pageCount ? `${pagesOut} OF ${pageCount}` : "—",
              tone: "neutral",
            },
          ]}
        />

        {/*
          The sentence the registry copy is not allowed to carry alone, next to
          the button, in the place a reader looks first. Both halves are facts
          about the engine, and both are the ones a person arriving from a word
          processor assumes the other way round.
        */}
        <CanvasFootnote>
          THE TEXT ALREADY IN THIS PDF CANNOT BE EDITED — A PAGE HOLDS GLYPHS AT FIXED
          COORDINATES, NOT PARAGRAPHS. YOU ADD NEW MARKS OVER IT, AND THEY ARE PAINTED IN
          PERMANENTLY.
        </CanvasFootnote>

        <CanvasFootnote>
          WHITEOUT IS PAINT, NOT REDACTION — THE COVERED TEXT IS STILL IN THE FILE AND STILL
          COPYABLE. THE DASHED OUTLINES ARE GUIDES AND ARE NOT DRAWN INTO THE DOWNLOAD.
        </CanvasFootnote>

        <CanvasFootnote>
          {pageIsDeleted
            ? "THIS PAGE IS MARKED FOR DELETION — ITS MARKS WILL NOT BE DRAWN. PRESS KEEP THIS PAGE TO PUT IT BACK."
            : drawArmed
              ? "DRAG ON THE PAGE TO DRAW A LINE · EACH DRAG IS ONE MARK · FREEHAND IS THE ONE VERB A KEYBOARD CANNOT DRAW"
              : selected
                ? "DRAG ON THE PAGE TO PLACE THE SELECTED MARK · A WHITEOUT DRAG SETS ITS SIZE · OR TYPE ITS POSITION IN THE FIELDS"
                : "ADD A MARK, THEN DRAG ON THE PAGE TO PLACE IT — OR TYPE ITS POSITION IN THE FIELDS"}
        </CanvasFootnote>

        {wouldEmptyDocument && (
          <WarningMessage
            message={`All ${pageCount} pages are marked for deletion. A PDF with no pages cannot be opened by any reader, so leave at least one page behind.`}
          />
        )}

        {characterMessage && <WarningMessage message={characterMessage} />}

        {emptyText && !characterMessage && (
          <WarningMessage message="One of your text marks is empty. Empty text draws nothing at all, so type its wording or remove the mark." />
        )}

        {imagelessMark && (
          <WarningMessage message="One of your image marks has no picture yet. Choose a PNG or JPEG for it, or remove the mark." />
        )}

        {strandedEdits > 0 && !wouldEmptyDocument && (
          <WarningMessage
            message={`${strandedEdits} mark${strandedEdits === 1 ? "" : "s"} sit on a page you have marked for deletion, so ${strandedEdits === 1 ? "it" : "they"} will not be drawn. Keep that page to bring ${strandedEdits === 1 ? "it" : "them"} back.`}
          />
        )}

        {selected?.image?.reencoded && (
          <WarningMessage
            message={
              selected.image.type === "image/jpeg"
                ? `This photo carried an EXIF Orientation of ${selected.image.orientation}, which a PDF reader ignores, so it was redrawn upright and re-encoded as JPEG at quality ${Math.round(REENCODE_JPEG_QUALITY * 100)}. That costs one generation of JPEG quality.`
                : `This PNG carried an EXIF Orientation of ${selected.image.orientation}, which a PDF reader ignores, so it was redrawn upright before being embedded. PNG re-encoding is lossless, so no detail was lost; the metadata chunks did not survive the redraw.`
            }
          />
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
                phase={status === "loading" ? "RENDERING PAGE" : "APPLYING EDITS"}
                percent={null}
                label={status === "loading" ? "Rendering page" : "Applying edits"}
              />
            )}
            {elapsed && <ToolDone elapsed={elapsed} />}
            {result ? (
              <DownloadButton
                blob={result}
                fileName={file.name.replace(/\.pdf$/i, "-edited.pdf")}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel={status === "processing" ? "Applying…" : "Apply edits"}
                onPrimary={handleApply}
                primaryDisabled={!canRun}
              />
            )}
            <ToolResetLink onClick={handleReset} label="CHANGE FILE" />
          </>
        }
      >
        <ToolControlGroup>
          <ToolControl label="PAGE">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={pageCount || undefined}
                value={pageNumber}
                onChange={(e) => {
                  invalidate();
                  const wanted = Math.max(1, Math.round(Number(e.target.value) || 1));
                  const next = pageCount > 0 ? Math.min(pageCount, wanted) : wanted;
                  setPageNumber(next);
                  setDraft(null);
                  setDragStart(null);
                  // A mark selected on the page you just left would leave the
                  // PLACE fields editing something nobody can see — typing a
                  // number and watching nothing move. Turning the page drops
                  // the selection unless the mark is on the new page too.
                  const held = edits.find((mark) => mark.id === selectedId);
                  if (held && held.page !== next) setSelectedId(null);
                }}
                aria-label="Page to edit"
                disabled={status === "processing"}
                className={cn(FIELD_CLASS, "w-24")}
              />
              <span className={HINT_CLASS}>
                of {pageCount || "—"}
              </span>
            </div>
            <button
              type="button"
              onClick={togglePageDeleted}
              disabled={status === "processing" || pageCount === 0}
              className={chipClass(
                pageIsDeleted,
                "self-start rounded-[6px] px-2.5 py-[7px] text-[11.5px] disabled:cursor-not-allowed disabled:opacity-45",
              )}
              aria-pressed={pageIsDeleted}
            >
              {pageIsDeleted ? "Keep this page" : "Delete this page"}
            </button>
            <span className={HINT_CLASS}>
              Marks stay with the page you put them on, so you can work through several pages
              and apply them all in one pass. Deleted pages are removed after the marks are
              drawn.
            </span>
            {deleted.length > 0 && (
              <div className="flex flex-wrap gap-[5px]" role="group" aria-label="Pages marked for deletion">
                {deleted.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      invalidate();
                      setPageNumber(p);
                    }}
                    disabled={status === "processing"}
                    className={chipClass(
                      true,
                      "rounded-[6px] px-2 py-[6px] text-[11px] disabled:opacity-45",
                    )}
                  >
                    {`Page ${p} · deleted`}
                  </button>
                ))}
              </div>
            )}
          </ToolControl>

          <ToolControl label="ADD A MARK">
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => addEdit("text")}
                disabled={status === "processing" || !preview || pageIsDeleted}
                className={chipClass(
                  false,
                  "rounded-[6px] px-1 py-[7px] text-[11.5px] text-text-muted disabled:cursor-not-allowed disabled:opacity-45",
                )}
              >
                Add text
              </button>
              <button
                type="button"
                onClick={() => openImagePicker(null)}
                disabled={status === "processing" || !preview || pageIsDeleted}
                className={chipClass(
                  false,
                  "rounded-[6px] px-1 py-[7px] text-[11.5px] text-text-muted disabled:cursor-not-allowed disabled:opacity-45",
                )}
              >
                Add image
              </button>
              <button
                type="button"
                onClick={() => addEdit("whiteout")}
                disabled={status === "processing" || !preview || pageIsDeleted}
                className={chipClass(
                  false,
                  "rounded-[6px] px-1 py-[7px] text-[11.5px] text-text-muted disabled:cursor-not-allowed disabled:opacity-45",
                )}
              >
                Whiteout
              </button>
              <button
                type="button"
                onClick={() => {
                  setDrawArmed((armed) => !armed);
                  setDragStart(null);
                }}
                aria-pressed={drawArmed}
                disabled={status === "processing" || !preview || pageIsDeleted}
                className={chipClass(
                  drawArmed,
                  cn(
                    "rounded-[6px] px-1 py-[7px] text-[11.5px] disabled:cursor-not-allowed disabled:opacity-45",
                    !drawArmed && "text-text-muted",
                  ),
                )}
              >
                Draw
              </button>
            </div>
            <span className={HINT_CLASS}>
              {drawArmed
                ? "Drawing is on: every drag across the page becomes one ink stroke. Press Draw again to stop."
                : "Text, image and whiteout land at a default spot you then move. Draw arms the pen — a stroke needs a pointer."}
            </span>
            {/* Hidden on purpose: the two buttons above are the affordance, and
                both are ordinary buttons a keyboard reaches. */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".png,.jpg,.jpeg"
              className="hidden"
              onChange={(e) => {
                void handleImagePicked(e.target.files?.[0]);
                // Same file twice in a row must still fire `change`.
                e.target.value = "";
              }}
            />
          </ToolControl>

          <ToolControl label="MARKS">
            <div className="flex flex-wrap gap-[5px]" role="group" aria-label="Marks in this document">
              {edits.length === 0 ? (
                <span className={HINT_CLASS}>No marks yet.</span>
              ) : (
                edits.map((edit, i) => (
                  <button
                    key={edit.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(edit.id);
                      setDrawArmed(false);
                      if (edit.page !== pageNumber) {
                        invalidate();
                        setPageNumber(edit.page);
                      }
                    }}
                    aria-pressed={edit.id === selectedId}
                    disabled={status === "processing"}
                    className={chipClass(
                      edit.id === selectedId,
                      cn(
                        "rounded-[6px] px-2 py-[7px] text-[11.5px] disabled:opacity-45",
                        edit.id !== selectedId && "text-text-muted",
                      ),
                    )}
                  >
                    {`${i + 1} · ${EDIT_LABEL[edit.kind]} · p${edit.page}`}
                  </button>
                ))
              )}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={removeSelected}
                disabled={!selected || status === "processing"}
                className={LINK_CLASS}
              >
                Remove mark
              </button>
              <button
                type="button"
                onClick={undo}
                disabled={history.length === 0 || status === "processing"}
                className={LINK_CLASS}
              >
                Undo
              </button>
              <button
                type="button"
                onClick={clearEdits}
                disabled={(edits.length === 0 && deleted.length === 0) || status === "processing"}
                className={LINK_CLASS}
              >
                Clear all
              </button>
            </div>
            <span className={HINT_CLASS}>
              Clear all drops every mark <em>and</em> un-deletes every page. Undo steps back
              through marks added, removed and cleared, and through pages deleted — nudging a
              number or dragging a mark is not a separate step.
            </span>
          </ToolControl>

          {selected && (
            <ToolControl label="PLACE">
              {/*
                These fields ARE the stored mark, in percent of the page as
                displayed. Dragging on the page writes the same numbers, which
                is why the two can never disagree — and why every mark except a
                freehand stroke can be placed to the point without a pointer.
                A stroke's X and Y are its bounding box's corner, so typing
                into them TRANSLATES the whole stroke.
              */}
              <div className="grid grid-cols-2 gap-2">
                <label className="flex min-w-0 flex-col gap-1">
                  <span className="font-body text-[11px] text-text-muted">X %</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={originOf.x}
                    onChange={(e) => moveSelectedTo(Number(e.target.value), originOf.y)}
                    aria-label="Mark x position as a percentage of the page"
                    disabled={status === "processing"}
                    className={FIELD_CLASS}
                  />
                </label>
                <label className="flex min-w-0 flex-col gap-1">
                  <span className="font-body text-[11px] text-text-muted">Y %</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={originOf.y}
                    onChange={(e) => moveSelectedTo(originOf.x, Number(e.target.value))}
                    aria-label="Mark y position as a percentage of the page"
                    disabled={status === "processing"}
                    className={FIELD_CLASS}
                  />
                </label>
                {(selected.kind === "whiteout" || selected.kind === "image") && (
                  <label className="flex min-w-0 flex-col gap-1">
                    <span className="font-body text-[11px] text-text-muted">Width %</span>
                    <input
                      type="number"
                      min={0.5}
                      max={100}
                      step={0.5}
                      value={selected.width}
                      onChange={(e) => updateSelected({ width: Number(e.target.value) })}
                      aria-label="Mark width as a percentage of the page width"
                      disabled={status === "processing"}
                      className={FIELD_CLASS}
                    />
                  </label>
                )}
                {selected.kind === "whiteout" && (
                  <label className="flex min-w-0 flex-col gap-1">
                    <span className="font-body text-[11px] text-text-muted">Height %</span>
                    <input
                      type="number"
                      min={0.5}
                      max={100}
                      step={0.5}
                      value={selected.height}
                      onChange={(e) => updateSelected({ height: Number(e.target.value) })}
                      aria-label="Mark height as a percentage of the page height"
                      disabled={status === "processing"}
                      className={FIELD_CLASS}
                    />
                  </label>
                )}
              </div>
              <span className={HINT_CLASS}>
                {selected.kind === "text"
                  ? "Percentages of the page as displayed, from its top-left corner. X and Y are where the first line's baseline starts, and the text runs right from there."
                  : selected.kind === "draw"
                    ? "X and Y are the top-left corner of the stroke's bounding box, so changing them slides the whole stroke without reshaping it."
                    : selected.kind === "image"
                      ? "Percentages of the page as displayed, from its top-left corner. Width is a share of the page width and the height follows the picture's own proportions, so nothing is stretched."
                      : "Percentages of the page as displayed, measured from its top-left corner — so the same numbers hold whatever size the page is."}
              </span>
            </ToolControl>
          )}

          {selected?.kind === "text" && (
            <ToolControl label="TEXT">
              <textarea
                value={selected.text}
                onChange={(e) => updateSelected({ text: e.target.value })}
                rows={3}
                aria-label="Text to draw on the page"
                disabled={status === "processing"}
                className={cn(FIELD_CLASS, "resize-y font-body leading-[1.45]")}
              />
              <label className="flex items-center justify-between gap-3 font-body text-[12.5px] text-neutral-300">
                Size in points
                <input
                  type="number"
                  min={4}
                  max={144}
                  step={1}
                  value={selected.fontSize}
                  onChange={(e) => updateSelected({ fontSize: Number(e.target.value) })}
                  aria-label="Text size in points"
                  disabled={status === "processing"}
                  className={cn(FIELD_CLASS, "w-24")}
                />
              </label>
              <label className="flex items-center justify-between gap-3 font-body text-[12.5px] text-neutral-300">
                Bold
                <input
                  type="checkbox"
                  checked={selected.bold}
                  onChange={(e) => updateSelected({ bold: e.target.checked })}
                  aria-label="Draw this text in bold"
                  disabled={status === "processing"}
                  className="size-4 rounded-sm border-border accent-accent"
                />
              </label>
              <span className={HINT_CLASS}>
                Helvetica, or Helvetica-Bold. Nothing is wrapped for you — press Enter where a
                line should break. Extra lines land {TEXT_LINE_HEIGHT_PT} points below the one
                before whatever size you pick, so above {TEXT_LINE_HEIGHT_PT} pt they start to
                overlap. The preview spaces them the same way.
              </span>
            </ToolControl>
          )}

          {selected?.kind === "image" && (
            <ToolControl label="IMAGE">
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[11px] break-all text-neutral-300">
                  {selected.image ? selected.image.name : "No picture chosen yet"}
                </span>
                {selected.image && (
                  <span className={HINT_CLASS}>
                    {selected.image.width} × {selected.image.height} px ·{" "}
                    {formatFileSize(selected.image.sourceSize)} ·{" "}
                    {selected.image.type === "image/png" ? "PNG" : "JPEG"}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => openImagePicker(selected.id)}
                disabled={status === "processing"}
                className={LINK_CLASS}
              >
                {selected.image ? "Replace image" : "Choose an image"}
              </button>
              <span className={HINT_CLASS}>
                PNG and JPEG only — those are the two formats a PDF can hold without being
                re-encoded. A PNG&apos;s transparency is kept.
              </span>
            </ToolControl>
          )}

          {selected?.kind === "draw" && (
            <ToolControl label="INK">
              <label className="flex items-center justify-between gap-3 font-body text-[12.5px] text-neutral-300">
                Thickness in points
                <input
                  type="number"
                  min={0.25}
                  max={24}
                  step={0.25}
                  value={selected.strokeWidth}
                  onChange={(e) => updateSelected({ strokeWidth: Number(e.target.value) })}
                  aria-label="Ink thickness in points"
                  disabled={status === "processing"}
                  className={cn(FIELD_CLASS, "w-24")}
                />
              </label>
              <span className={HINT_CLASS}>
                A stroke is drawn as {selected.points.length} round-capped segments, one per
                point recorded while you dragged. Points closer together than a third of a
                percent of the page are dropped, which keeps the file small without a visible
                difference.
              </span>
            </ToolControl>
          )}

          {selected && selected.kind !== "whiteout" && (
            /* An image has no colour of its own to set, so the heading says
               what the block actually contains rather than promising a swatch
               row that is not there. */
            <ToolControl label={selected.kind === "image" ? "OPACITY" : "COLOUR"}>
              {selected.kind !== "image" ? (
                <>
                  <ToolChoice
                    label="Mark colour"
                    fill
                    value={selected.colour}
                    onChange={(v: string) => updateSelected({ colour: v })}
                    disabled={status === "processing"}
                    options={INK_SWATCHES.map((s) => ({ value: s.value as string, label: s.label }))}
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
                </>
              ) : null}
              <ToolSlider
                label="Opacity"
                display={`${selected.opacity}%`}
                hint="Applies to the whole mark."
                min={5}
                max={100}
                step={5}
                value={selected.opacity}
                onChange={(v) => updateSelected({ opacity: v })}
                disabled={status === "processing"}
              />
            </ToolControl>
          )}

          {selected?.kind === "whiteout" && (
            <ToolControl label="COVER">
              <span className={HINT_CLASS}>
                A whiteout is an opaque white rectangle, so it has no colour or opacity to set —
                a see-through cover is not a cover. On a page with a coloured or textured
                background it will read as a white box, because that is exactly what it is.
              </span>
            </ToolControl>
          )}
        </ToolControlGroup>

        <ToolAsideSection label="WHAT THIS CANNOT DO">
          <span className={HINT_CLASS}>
            <strong>It cannot edit the text that is already there.</strong> A PDF page is a list
            of drawing instructions — glyphs placed at fixed coordinates — with no paragraphs and
            no reflow. There is nothing to click into and retype, and no tool built on these
            libraries can put it back together after a change. What you can do is cover the old
            wording with a whiteout and draw the new wording on top; that is the whole workflow
            this page supports.
          </span>
          <span className={HINT_CLASS}>
            <strong>Whiteout is not redaction.</strong> It paints an opaque rectangle over the
            page. The text underneath is still in the file, still selectable and still copyable by
            anything that reads the content stream. This site ships no redaction tool, because no
            honest permissive client-side one exists — if the point is that nobody can ever
            recover it, do not use this.
          </span>
          <span className={HINT_CLASS}>
            <strong>The marks are painted into the page.</strong> They are drawn into the page&apos;s
            own content rather than attached as PDF annotation objects, so a reader shows no
            comment to click, no author, no reply and no Delete. Undo works here, before you press
            the button; after you download, taking a mark out again means editing the page itself.
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="KEYBOARD">
          <span className={HINT_CLASS}>
            Adding a mark, choosing its page, deleting a page, selecting a mark, removing one and
            undoing are all ordinary buttons. Text, image and whiteout marks are placed by the X,
            Y, Width and Height fields, which hold the same numbers a drag writes — so those three
            verbs need no pointer at all, and an existing stroke can be slid across the page from
            the fields too.
          </span>
          <span className={HINT_CLASS}>
            <strong>Freehand is the exception.</strong> Drawing a line means tracing a path, and
            there is no honest keyboard equivalent — this page will not pretend otherwise. Every
            other verb is fully operable without a mouse.
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="WHAT DOES NOT CHANGE">
          {/*
            Every clause is something the ops demonstrably do not do. `stampPdf`
            appends drawing operators to a page's content and saves — it never
            touches a page box, the page tree, a font already in the file or an
            image XObject. `deletePdfPages` is different in kind: it grafts the
            surviving pages into a NEW document with `copyPages`, and that graft
            does not carry `/Outlines`. Deliberately NOT claiming the untouched
            pages come back "byte for byte": pdf-lib re-serialises the whole
            document on save, and that is a claim this component has not
            measured.
          */}
          <span className={HINT_CLASS}>
            Marks are added to a page and nothing is taken away: page sizes and page order are
            untouched, existing text stays selectable and searchable, and no image in the file is
            re-encoded.
          </span>
          <span className={HINT_CLASS}>
            {deleted.length > 0
              ? "Because you are deleting pages, the document is rebuilt from the pages you keep. Those pages are copied whole — fonts, images and formatting survive exactly — but bookmarks and the document outline are not carried over."
              : "Delete a page and the document is rebuilt from the pages you keep: they are copied whole, but bookmarks and the document outline are not carried over. Marking up without deleting anything re-saves the file instead and keeps them."}
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Pages out", pageCount ? `${pagesOut} of ${pageCount}` : "—"],
              ["Out", result ? formatFileSize(result.size) : "—"],
              ["Marks", `${liveEdits.length}`],
              ["Pages deleted", `${deleted.length}`],
            ]}
          />
        </ToolAsideSection>

        <ToolAdvanced
          rows={[
            ["Existing text", "NOT EDITABLE"],
            ["Marks", "DRAWN INTO THE PAGE"],
            ["Annotation objects", "NONE WRITTEN"],
            ["Whiteout", "PAINT · NOT REDACTION"],
            ["Text font", "HELVETICA · WINANSI"],
            ["Text line spacing", `${TEXT_LINE_HEIGHT_PT} PT FIXED`],
            ["Placement", "% OF PAGE AS DISPLAYED"],
            ["Order", "MARKS FIRST, THEN DELETIONS"],
          ]}
        />
      </ToolAside>
    </>
  );
}
