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
import { CANVAS_COLUMN, STAGE_GROW, chipClass } from "@/components/workspace/shared";
import { cn } from "@/lib/utils/cn";

/*
  WHAT THIS PAGE IS, STATED ONCE SO NO SENTENCE BELOW CAN DRIFT FROM IT.

  This tool draws a PICTURE onto a page. `stampPdf` embeds the image
  (`pdf-engine-core.ts:1995-1999`) and calls `page.drawImage`
  (`pdf-engine-core.ts:2114-2121`), which appends to the page's content stream.
  There is no `/Sig` field, no certificate, no digest and no cryptography
  anywhere in the path — `pdf-engine-core.ts` imports nothing of the kind.

  So every user-facing string on this page says "drawn" or "visual" signature.
  None of them says digital signature, certified, eIDAS, ESIGN or legally
  binding, and none of them may ever be edited to. A picture of a signature and
  a certificate-based signature are different objects with different guarantees,
  and a file-conversion site claiming the second while shipping the first would
  be the worst copy lie in this repository.
*/

/** The pad's logical drawing space, and the units every stroke point is in. */
const PAD_WIDTH = 720;
const PAD_HEIGHT = 240;

const PEN_MIN = 3;
const PEN_MAX = 14;

/** Pad units → exported PNG pixels. 3× keeps a signature crisp at print size. */
const EXPORT_SCALE = 3;

const INK_OPTIONS: { value: string; label: string }[] = [
  { value: "#111827", label: "Black" },
  { value: "#1d4ed8", label: "Blue" },
];

const NUMBER_FIELD_CLASS =
  "w-full rounded-md border border-border bg-bg-elevated px-2.5 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-45";

/**
 * The claim a page called "Sign PDF" will be believed about, and must not be.
 *
 * Kept as one string so the sentence the user reads is the sentence a copy
 * test can assert — JSX interpolation would let whitespace drift between them.
 */
const NOT_A_DIGITAL_SIGNATURE =
  "This places a picture of your signature into the page, the same way a rubber stamp does. " +
  "It is a visual signature and nothing more: no certificate is involved, nothing is " +
  "cryptographically signed, and the file carries no signature field for a reader to validate. " +
  "Nothing here can prove who signed, or show that the document was altered afterwards — a PDF " +
  "reader will show the picture and report no signature at all. Whether a drawn signature is " +
  "enough is between you and whoever asked for the document; this tool makes no claim about it.";

type Mode = "draw" | "upload";
type Scope = "page" | "all";

interface Point {
  x: number;
  y: number;
}

/** One pen-down-to-pen-up path, in pad units. */
type Stroke = Point[];

/**
 * A signature ready to be placed: the exact bytes the engine will embed, plus
 * the intrinsic size the on-page preview needs to match the engine's own
 * geometry (`height = image.height / image.width × width`,
 * pdf-engine-core.ts:2110-2111).
 */
interface SignatureAsset {
  /** Shown in the on-page overlay. A data: URL for the pad, blob: for a file. */
  url: string;
  bytes: Uint8Array;
  /** `stampPdf` branches on exactly this string: PNG embeds, anything else is embedded as JPEG. */
  type: "image/png" | "image/jpeg";
  width: number;
  height: number;
  label: string;
  /** True only where the source format can carry alpha at all. */
  transparent: boolean;
}

/** Percentages, because the three number fields in the rail ARE this object. */
interface Placement {
  xPct: number;
  yPct: number;
  widthPct: number;
}

interface Preview {
  url: string;
  /** The page's VISIBLE size in points — pdfjs's scale-1 viewport, /Rotate applied. */
  pageWidth: number;
  pageHeight: number;
}

/** One decimal place, clamped. Non-finite (a cleared field) falls to the floor. */
function clampPct(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value * 10) / 10));
}

/**
 * How tall the placed signature is, as a percentage of the DISPLAYED page.
 *
 * The engine derives height from the image's aspect and the page's width
 * (pdf-engine-core.ts:2110-2111); this is that same relation expressed in the
 * preview's percentage frame, which is why the overlay and the output agree.
 */
function heightPct(
  widthPctValue: number,
  signature: SignatureAsset | null,
  preview: Preview | null,
): number | null {
  if (!signature || !preview || signature.width <= 0 || preview.pageHeight <= 0) return null;
  return (
    (signature.height / signature.width) * widthPctValue * (preview.pageWidth / preview.pageHeight)
  );
}

/**
 * Keep the whole signature box on the page.
 *
 * `fractionToUserSpace` clamps the ANCHOR to 0..1 (pdf-stamp-core.ts:377-378)
 * but nothing clamps the box's far edge, so a wide signature anchored near the
 * right margin runs off the sheet and is simply not drawn there. Clamping the
 * top-left against the box's own size is what stops the preview from showing a
 * signature the output would clip.
 *
 * ONE function, used by the drag and by the three number fields alike, so the
 * two can never disagree about where the signature is.
 */
function clampPlacement(
  place: Placement,
  signature: SignatureAsset | null,
  preview: Preview | null,
): Placement {
  const widthPct = clampPct(place.widthPct, 2, 100);
  const tall = heightPct(widthPct, signature, preview);
  return {
    widthPct,
    xPct: clampPct(place.xPct, 0, Math.max(0, 100 - widthPct)),
    yPct: clampPct(place.yPct, 0, tall === null ? 100 : Math.max(0, 100 - tall)),
  };
}

/** Paint strokes onto a context, offset to a crop box and scaled. */
function paintStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  pen: number,
  colour: string,
  offsetX: number,
  offsetY: number,
  scale: number,
): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = colour;
  ctx.lineWidth = pen * scale;
  for (const stroke of strokes) {
    if (stroke.length === 0) continue;
    ctx.beginPath();
    const first = stroke[0];
    ctx.moveTo((first.x - offsetX) * scale, (first.y - offsetY) * scale);
    // A single tap has no second point: line to itself so `round` caps draw a
    // dot rather than nothing at all.
    if (stroke.length === 1) {
      ctx.lineTo((first.x - offsetX) * scale, (first.y - offsetY) * scale);
    } else {
      for (let i = 1; i < stroke.length; i++) {
        ctx.lineTo((stroke[i].x - offsetX) * scale, (stroke[i].y - offsetY) * scale);
      }
    }
    ctx.stroke();
  }
}

/**
 * The ink's bounding box in pad units, grown by the pen so a round cap is not
 * sliced off. Trimming matters: the exported aspect ratio is what the engine
 * turns into the placed height, so exporting the whole empty pad would place a
 * mostly-blank 3:1 rectangle instead of the signature.
 */
function inkBounds(strokes: Stroke[], pen: number): Point & { width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stroke of strokes) {
    for (const p of stroke) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  const grow = pen;
  const x = Math.max(0, minX - grow);
  const y = Math.max(0, minY - grow);
  return {
    x,
    y,
    width: Math.max(1, Math.min(PAD_WIDTH, maxX + grow) - x),
    height: Math.max(1, Math.min(PAD_HEIGHT, maxY + grow) - y),
  };
}

/** `data:image/png;base64,…` → the bytes the engine embeds. */
function dataUrlToBytes(url: string): Uint8Array | null {
  const comma = url.indexOf(",");
  if (comma < 0) return null;
  try {
    const binary = atob(url.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Strokes → a transparent PNG.
 *
 * The export canvas is never filled, so only the ink is opaque. pdf-lib turns
 * a PNG's alpha channel into an /SMask on embed
 * (node_modules/pdf-lib/cjs/core/embedders/PngEmbedder.js:31,53-55), which is
 * why the page shows through around the strokes. The pad's own pale background
 * below is a drawing surface, not part of the picture.
 *
 * Called only from event handlers, never during render.
 */
function renderDrawnSignature(
  strokes: Stroke[],
  colour: string,
  pen: number,
): SignatureAsset | null {
  const box = inkBounds(strokes, pen);
  if (box.width <= 0 || box.height <= 0) return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(box.width * EXPORT_SCALE));
  canvas.height = Math.max(1, Math.round(box.height * EXPORT_SCALE));
  const ctx = canvas.getContext("2d");
  // No 2D context (a headless DOM, a tab out of canvas memory): report nothing
  // rather than a signature that would export blank.
  if (!ctx) return null;
  paintStrokes(ctx, strokes, pen, colour, box.x, box.y, EXPORT_SCALE);
  let url: string;
  try {
    url = canvas.toDataURL("image/png");
  } catch {
    return null;
  }
  const bytes = dataUrlToBytes(url);
  if (!bytes) return null;
  return {
    url,
    bytes,
    type: "image/png",
    width: canvas.width,
    height: canvas.height,
    label: "Drawn on the pad",
    transparent: true,
  };
}

/**
 * The two formats `stampPdf` can embed, decided from the MIME type with the
 * extension as the fallback for a browser that reports none.
 *
 * This has to be exact rather than lenient: the engine tests
 * `stamp.type === "image/png"` and sends EVERYTHING else to `embedJpg`
 * (pdf-engine-core.ts:1997-1998), so letting a WebP through would reach
 * pdf-lib's JPEG parser and throw at the user in its words, not ours.
 */
function signatureImageType(file: File): "image/png" | "image/jpeg" | null {
  if (file.type === "image/png") return "image/png";
  if (file.type === "image/jpeg") return "image/jpeg";
  if (file.type) return null;
  if (/\.png$/i.test(file.name)) return "image/png";
  if (/\.jpe?g$/i.test(file.name)) return "image/jpeg";
  return null;
}

export function SignPdfUI() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);

  const [mode, setMode] = useState<Mode>("draw");
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [ink, setInk] = useState<string>(INK_OPTIONS[0].value);
  const [pen, setPen] = useState(6);
  const [drawn, setDrawn] = useState<SignatureAsset | null>(null);
  const [uploaded, setUploaded] = useState<SignatureAsset | null>(null);

  const [place, setPlace] = useState<Placement>({ xPct: 58, yPct: 76, widthPct: 26 });
  const [scope, setScope] = useState<Scope>("page");

  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The doc pins a "Done in 1.4 s" card above the primary once a run
  // finishes. Timed for real; cleared the moment the inputs change.
  const [elapsed, setElapsed] = useState<string | null>(null);

  const padRef = useRef<HTMLCanvasElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  /** The stroke being drawn right now. Written and read only in handlers. */
  const drawingRef = useRef<Stroke | null>(null);
  /** Where inside the signature box the drag was grabbed, in percentage points. */
  const grabRef = useRef<{ dx: number; dy: number } | null>(null);

  /*
    Stale-result invalidation, the app-wide contract golden-paths.spec.ts pins
    for every tool — and a sharper problem here than on most pages. Placement,
    page, scope and the signature itself all change what a run produces, and
    the rail footer swaps the primary out for a Download the moment `result` is
    set. Without this the button would hand back a PDF signed at a position the
    canvas no longer shows.

    A ref, not state: the check has to see the value at the moment the promise
    settles, not the one captured when the callback was created. `stampPdf`
    runs in the PDF worker (pdf-engine.ts:57-80), so the main thread stays
    fully interactive for the whole run — the signature really can be dragged
    out from under a run in flight.
  */
  const runToken = useRef(0);

  const stale = useCallback(() => {
    runToken.current += 1;
    setResult(null);
    setElapsed(null);
    setStatus((s) => (s === "done" || s === "processing" ? "idle" : s));
  }, []);

  const handleFiles = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      setFile(f);
      setPageCount(0);
      setPageIndex(0);
      setPreview(null);
      setError(null);
      stale();
    },
    [stale],
  );

  /*
    One pdfjs parse per file and per page choice, for both facts this tool
    needs: how many pages there are, and what the chosen page looks like at
    what size. The placement is expressed against what the user is LOOKING at,
    so the preview pixels and the page dimensions come from the same page
    object rather than from two sources that could disagree.

    Nothing is set before the first `await`: a synchronous setState in an
    effect body is an ESLint error here (`react-hooks/set-state-in-effect`),
    and "still rendering" is derivable from `preview === null` anyway.
  */
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    let doc: Awaited<ReturnType<typeof loadPdfjsDocument>> | null = null;
    (async () => {
      try {
        doc = await loadPdfjsDocument(await file.arrayBuffer());
        const total = doc.numPages;
        const wanted = Math.min(Math.max(1, pageIndex + 1), total);
        const page = await doc.getPage(wanted);
        const visual = page.getViewport({ scale: 1 });
        // Big enough to place a signature against a printed line, capped so a
        // tabloid sheet does not become a 20 MB data URL held in state.
        const scale = Math.min(2.5, Math.max(0.75, 1000 / visual.width));
        const canvas = await renderPageFromDoc(doc, wanted, scale);
        if (cancelled) return;
        setPageCount(total);
        setPreview({
          // JPEG, not PNG: pdfjs paints an opaque white page background, so
          // there is no alpha to lose and no multi-megabyte string to hold.
          url: canvas.toDataURL("image/jpeg", 0.9),
          pageWidth: visual.width,
          pageHeight: visual.height,
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to render this page");
          setStatus("error");
        }
      } finally {
        await doc?.destroy();
        doc = null;
      }
    })();
    return () => {
      cancelled = true;
      void doc?.destroy();
    };
  }, [file, pageIndex]);

  // Redraw the pad from the completed strokes. Draw only — no setState, so
  // this never fights the incremental painting the pointer handlers do.
  useEffect(() => {
    // `mode` is a real dependency, not decoration: the pad unmounts when the
    // source switches to Upload, so on the way back the ref holds a FRESH,
    // blank canvas that the stroke list alone would never repaint.
    if (mode !== "draw") return;
    const canvas = padRef.current;
    if (!canvas) return;
    canvas.width = PAD_WIDTH;
    canvas.height = PAD_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, PAD_WIDTH, PAD_HEIGHT);
    paintStrokes(ctx, strokes, pen, ink, 0, 0, 1);
  }, [strokes, ink, pen, mode]);

  // An uploaded signature is held as a blob: URL, so the previous one has to be
  // released when it is replaced or the component goes away.
  useEffect(() => {
    const url = uploaded?.url;
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [uploaded]);

  /**
   * The one writer of the drawn signature. Every mutator — a finished stroke,
   * Undo stroke, Clear pad, the ink chips, the pen slider — comes through here
   * with the values it is changing to, so the picture can never describe a
   * setting other than the one on screen.
   */
  const commitStrokes = useCallback(
    (next: Stroke[], inkValue: string, penValue: number) => {
      stale();
      setStrokes(next);
      setDrawn(next.length > 0 ? renderDrawnSignature(next, inkValue, penValue) : null);
    },
    [stale],
  );

  /** Client point → pad units. The canvas fills its box, so this is one scale. */
  const pointToPad = useCallback((e: ReactPointerEvent<HTMLCanvasElement>): Point | null => {
    const canvas = padRef.current;
    if (!canvas) return null;
    const box = canvas.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null;
    return {
      x: ((e.clientX - box.left) / box.width) * PAD_WIDTH,
      y: ((e.clientY - box.top) / box.height) * PAD_HEIGHT,
    };
  }, []);

  const handlePadDown = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (status === "processing") return;
      const p = pointToPad(e);
      if (!p) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture is not universal and a stroke is not worth refusing
        // over it. Without capture a release outside the pad is never seen
        // here, so `handlePadCancel` on leave closes the stroke instead.
      }
      drawingRef.current = [p];
      const ctx = padRef.current?.getContext("2d");
      if (ctx) paintStrokes(ctx, [[p]], pen, ink, 0, 0, 1);
    },
    [ink, pen, pointToPad, status],
  );

  const handlePadMove = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const stroke = drawingRef.current;
      if (!stroke) return;
      const p = pointToPad(e);
      if (!p) return;
      const previous = stroke[stroke.length - 1];
      stroke.push(p);
      // Painted straight onto the canvas rather than through state: a stroke is
      // dozens of points a second, and a React commit per point would make the
      // line lag the pointer. The redraw effect above owns the pad again the
      // moment the stroke is committed.
      const ctx = padRef.current?.getContext("2d");
      if (ctx) paintStrokes(ctx, [[previous, p]], pen, ink, 0, 0, 1);
    },
    [ink, pen, pointToPad],
  );

  const finishStroke = useCallback(() => {
    const stroke = drawingRef.current;
    drawingRef.current = null;
    if (!stroke || stroke.length === 0) return;
    commitStrokes([...strokes, stroke], ink, pen);
  }, [commitStrokes, ink, pen, strokes]);

  /**
   * A pointer that leaves the pad.
   *
   * With capture held the pointer is still ours outside the box, and ending the
   * stroke here would cut a signature short the moment it crossed the edge —
   * so the stroke is closed ONLY where `setPointerCapture` did not take (the
   * `catch` above). That is the case where no `pointerup` would ever arrive
   * and the line would otherwise keep following an unpressed pointer.
   */
  const handlePadLeave = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) return;
      finishStroke();
    },
    [finishStroke],
  );

  const handleUndo = useCallback(() => {
    if (strokes.length === 0) return;
    commitStrokes(strokes.slice(0, -1), ink, pen);
  }, [commitStrokes, ink, pen, strokes]);

  const handleClearPad = useCallback(() => {
    commitStrokes([], ink, pen);
  }, [commitStrokes, ink, pen]);

  const handleUploadFile = useCallback(
    async (picked: File) => {
      const type = signatureImageType(picked);
      if (!type) {
        setError(
          `${picked.name} is not a PNG or a JPEG. Those are the only two formats this page can place on a PDF.`,
        );
        setStatus("error");
        return;
      }
      stale();
      setError(null);
      try {
        const bytes = new Uint8Array(await picked.arrayBuffer());
        // The intrinsic size is not decoration: the engine derives the placed
        // height from this aspect ratio, so the overlay needs the same numbers.
        const bitmap = await createImageBitmap(picked);
        const width = bitmap.width;
        const height = bitmap.height;
        bitmap.close();
        setUploaded({
          url: URL.createObjectURL(picked),
          bytes,
          type,
          width,
          height,
          label: picked.name,
          transparent: type === "image/png",
        });
      } catch {
        setError(`${picked.name} could not be read as an image. Try re-saving it as a PNG.`);
        setStatus("error");
      }
    },
    [stale],
  );

  const signature = mode === "draw" ? drawn : uploaded;

  const setPlaceField = useCallback(
    (key: keyof Placement, value: number) => {
      stale();
      setPlace((current) => clampPlacement({ ...current, [key]: value }, signature, preview));
    },
    [preview, signature, stale],
  );

  /** Client point → percentage of the displayed page. */
  const pointToPage = useCallback((e: ReactPointerEvent<HTMLDivElement>): Point | null => {
    const box = pageRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0 || box.height <= 0) return null;
    return {
      x: ((e.clientX - box.left) / box.width) * 100,
      y: ((e.clientY - box.top) / box.height) * 100,
    };
  }, []);

  const handlePageDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!signature || status === "processing") return;
      const p = pointToPage(e);
      if (!p) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // See the note on the pad: a missing capture only costs the pointerup.
      }
      const tall = heightPct(place.widthPct, signature, preview) ?? 0;
      const inside =
        p.x >= place.xPct &&
        p.x <= place.xPct + place.widthPct &&
        p.y >= place.yPct &&
        p.y <= place.yPct + tall;
      // Grabbing the box keeps the point under the pointer; clicking anywhere
      // else drops the box's centre there, which is the only reading of a
      // click on empty page that is not a surprise.
      grabRef.current = inside
        ? { dx: p.x - place.xPct, dy: p.y - place.yPct }
        : { dx: place.widthPct / 2, dy: tall / 2 };
      stale();
      setPlace(
        clampPlacement(
          { ...place, xPct: p.x - grabRef.current.dx, yPct: p.y - grabRef.current.dy },
          signature,
          preview,
        ),
      );
    },
    [place, pointToPage, preview, signature, stale, status],
  );

  const handlePageMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const grab = grabRef.current;
      if (!grab || !signature) return;
      const p = pointToPage(e);
      if (!p) return;
      stale();
      setPlace((current) =>
        clampPlacement({ ...current, xPct: p.x - grab.dx, yPct: p.y - grab.dy }, signature, preview),
      );
    },
    [pointToPage, preview, signature, stale],
  );

  const endPageDrag = useCallback(() => {
    grabRef.current = null;
  }, []);

  const goToPage = useCallback(
    (oneBased: number) => {
      const next = Math.min(Math.max(1, Math.round(oneBased)), Math.max(1, pageCount || 1)) - 1;
      if (next === pageIndex) return;
      stale();
      // Dropped rather than kept: the overlay must never sit on a page it was
      // not positioned against, and the new render arrives asynchronously.
      setPreview(null);
      setPageIndex(next);
    },
    [pageCount, pageIndex, stale],
  );

  const handleSign = useCallback(async () => {
    if (!file || !signature) return;
    // Claimed BEFORE the first await, and bumped by every control; a mismatch
    // on the way out means the placement this run was for is gone.
    const token = (runToken.current += 1);
    setStatus("processing");
    setError(null);
    setElapsed(null);
    setResult(null);
    const startedAt = performance.now();
    try {
      const stamp: PdfStamp = {
        kind: "image",
        bytes: signature.bytes,
        type: signature.type,
        // The fractions the engine wants, converted at exactly one site. `at`
        // is the box's TOP-LEFT corner as displayed: `drawImage` is given
        // `origin.y - height` (pdf-engine-core.ts:2115-2116).
        at: { x: place.xPct / 100, y: place.yPct / 100 },
        widthFraction: place.widthPct / 100,
        opacity: 1,
        rotate: 0,
        // A signature belongs over the page, never under it, and tiling would
        // repeat it twelve times across the sheet.
        behind: false,
        tile: false,
        pages: scope === "all" ? "all" : [pageIndex],
      };
      const bytes = await stampPdf(await file.arrayBuffer(), [stamp]);
      if (runToken.current !== token) return;
      setResult(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      // A small PDF finishes in tens of milliseconds; "Done in 0.0 s" reads
      // like a stopwatch that never started. Sub-second runs report ms.
      const ms = performance.now() - startedAt;
      setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
      setStatus("done");
    } catch (err) {
      // A superseded run's failure is not the user's problem either: the
      // placement it failed on is no longer the one on screen.
      if (runToken.current !== token) return;
      setError(err instanceof Error ? err.message : "Failed to sign this PDF");
      setStatus("error");
    }
  }, [file, pageIndex, place, scope, signature]);

  const handleReset = useCallback(() => {
    setFile(null);
    setPageCount(0);
    setPageIndex(0);
    setPreview(null);
    setError(null);
    stale();
    // The SIGNATURE is deliberately kept. Signing a second document is the
    // common case, and making someone re-draw their own name to do it would be
    // busywork — the same reasoning `pdf-resizer` uses for keeping its file
    // across a mode flip.
  }, [stale]);

  if (!file) {
    return <DropZone accept=".pdf" onFiles={handleFiles} label="Upload a PDF to sign" />;
  }

  const rendering = preview === null && status !== "error";
  const tallPct = heightPct(place.widthPct, signature, preview);
  const sizeLabel = signature
    ? `${signature.width} × ${signature.height} PX`
    : mode === "draw"
      ? "PAD IS EMPTY"
      : "NO IMAGE YET";
  const pagesLabel =
    scope === "all"
      ? pageCount
        ? `ALL ${pageCount}`
        : "ALL"
      : `PAGE ${pageIndex + 1}`;

  return (
    <>
      {/* ── Canvas: the page with the signature on it, and the pad ── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={`${pageCount ? `${pageCount} PAGE${pageCount !== 1 ? "S" : ""} · ` : ""}${formatFileSize(file.size)}`}
          trailing={pagesLabel}
        />

        <CanvasStage
          className={cn(STAGE_GROW, "flex items-center justify-center bg-bg-secondary p-3")}
        >
          {preview ? (
            <div
              ref={pageRef}
              onPointerDown={handlePageDown}
              onPointerMove={handlePageMove}
              onPointerUp={endPageDrag}
              onPointerCancel={endPageDrag}
              onLostPointerCapture={endPageDrag}
              className={cn(
                "relative inline-block max-h-full max-w-full touch-none select-none",
                signature ? "cursor-move" : "cursor-default",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- data: URL of a canvas we rendered; nothing for next/image to optimise under output: "export" */}
              <img
                src={preview.url}
                alt={`Page ${pageIndex + 1} — drag to position the signature`}
                className="block h-[min(58vh,680px)] w-auto max-w-full object-contain"
              />
              {signature && (
                /* eslint-disable-next-line @next/next/no-img-element -- the signature's own data:/blob: URL; nothing for next/image to optimise under output: "export" */
                <img
                  src={signature.url}
                  alt=""
                  // `height` is deliberately left to the intrinsic ratio: that
                  // is the same relation the engine uses to size the placed
                  // image, so the preview cannot drift from the output.
                  style={{
                    left: `${place.xPct}%`,
                    top: `${place.yPct}%`,
                    width: `${place.widthPct}%`,
                  }}
                  className="pointer-events-none absolute"
                />
              )}
            </div>
          ) : (
            <span className="font-mono text-[10.5px] leading-none text-text-muted">
              {rendering ? "RENDERING PAGE…" : "NO PAGE TO SHOW"}
            </span>
          )}
        </CanvasStage>

        <StatStrip
          stats={[
            {
              label: "PAGE",
              value: pageCount ? `${pageIndex + 1} / ${pageCount}` : "—",
              tone: "neutral",
            },
            { label: "SIGNATURE", value: signature ? "READY" : "NOT SET" },
            {
              label: "SIZE ON PAGE",
              value: tallPct === null ? "—" : `${place.widthPct}% × ${tallPct.toFixed(1)}%`,
              tone: "neutral",
            },
            { label: "SIGNS", value: pagesLabel, tone: "neutral" },
          ]}
        />

        {mode === "draw" && (
          <div className="flex flex-col gap-2">
            <canvas
              ref={padRef}
              aria-label="Signature pad — draw with a mouse, trackpad or finger. There is no keyboard equivalent for drawing; use Upload a signature image instead."
              onPointerDown={handlePadDown}
              onPointerMove={handlePadMove}
              onPointerUp={finishStroke}
              onPointerCancel={finishStroke}
              onPointerLeave={handlePadLeave}
              onLostPointerCapture={finishStroke}
              className="block aspect-3/1 w-full cursor-crosshair touch-none rounded-[10px] border border-neutral-800 bg-[#f4f5fa]"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleUndo}
                disabled={strokes.length === 0 || status === "processing"}
                className={chipClass(
                  false,
                  "rounded-[6px] px-3 py-[7px] text-[11.5px] disabled:cursor-not-allowed disabled:opacity-45",
                )}
              >
                Undo stroke
              </button>
              <button
                type="button"
                onClick={handleClearPad}
                disabled={strokes.length === 0 || status === "processing"}
                className={chipClass(
                  false,
                  "rounded-[6px] px-3 py-[7px] text-[11.5px] disabled:cursor-not-allowed disabled:opacity-45",
                )}
              >
                Clear pad
              </button>
              <CanvasFootnote>
                {strokes.length === 0
                  ? "DRAW HERE — THE PAD'S PALE BACKGROUND IS NOT PART OF THE SIGNATURE"
                  : `${strokes.length} STROKE${strokes.length !== 1 ? "S" : ""} · EXPORTED AS A TRANSPARENT PNG, TRIMMED TO THE INK`}
              </CanvasFootnote>
            </div>
          </div>
        )}

        {/*
          The line this page exists to be honest about, next to the button
          rather than buried in a FAQ. Always rendered, never behind a
          disclosure, and phrased so no reader can take it for a claim about
          certificates or legal effect.
        */}
        <CanvasFootnote>
          THIS DRAWS A PICTURE OF YOUR SIGNATURE ONTO THE PAGE. IT IS NOT A CERTIFICATE-BASED
          DIGITAL SIGNATURE, NOTHING IS CRYPTOGRAPHICALLY SIGNED, AND NO READER CAN VALIDATE IT.
        </CanvasFootnote>

        {signature && !signature.transparent && (
          <WarningMessage
            message={`${signature.label} is a JPEG, and JPEG has no transparency — the whole rectangle is drawn, so its background will cover the page behind it. A PNG saved with a transparent background is the format that lets the page show through.`}
          />
        )}

        {error && <ErrorMessage message={error} />}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {status === "processing" && (
              <ToolProgress phase="PLACING SIGNATURE" percent={null} label="Signing PDF" />
            )}
            {elapsed && <ToolDone elapsed={elapsed} />}
            {result ? (
              <DownloadButton
                blob={result}
                fileName={file.name.replace(/\.pdf$/i, "-signed.pdf")}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel={status === "processing" ? "Signing…" : "Sign PDF"}
                onPrimary={handleSign}
                primaryDisabled={!signature || !preview || status === "processing"}
              />
            )}
            <ToolResetLink onClick={handleReset} label="CHANGE FILE" />
          </>
        }
      >
        <ToolControlGroup>
          <ToolControl label="SIGNATURE">
            <ToolChoice
              label="Signature source"
              fill
              value={mode}
              onChange={(v: Mode) => {
                stale();
                setMode(v);
              }}
              disabled={status === "processing"}
              options={[
                { value: "draw", label: "Draw" },
                { value: "upload", label: "Upload" },
              ]}
            />
            {mode === "draw" ? (
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                Draw on the pad under the page. Drawing needs a pointer — switch to Upload to
                place a PNG or JPEG instead, which works from the keyboard.
              </span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={status === "processing"}
                  className={chipClass(
                    false,
                    "w-full rounded-[6px] px-3 py-[9px] text-[11.5px] disabled:cursor-not-allowed disabled:opacity-45",
                  )}
                >
                  Upload a signature image
                </button>
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg"
                  className="hidden"
                  onChange={(e) => {
                    const picked = e.target.files?.[0];
                    if (picked) void handleUploadFile(picked);
                    // The same file twice in a row must still fire a change.
                    e.target.value = "";
                  }}
                />
                <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                  {uploaded
                    ? `${uploaded.label} — ${uploaded.width} × ${uploaded.height} px`
                    : "PNG or JPEG only. A PNG with a transparent background is what lets the page show through the signature."}
                </span>
              </>
            )}
          </ToolControl>

          {mode === "draw" && (
            <ToolControl label="PEN">
              <ToolSlider
                label="Pen width"
                display={`${pen} px`}
                hint="Measured in the pad's own units, so the stroke keeps its weight whatever size the signature is placed at."
                min={PEN_MIN}
                max={PEN_MAX}
                step={1}
                value={pen}
                disabled={status === "processing"}
                onChange={(v) => {
                  setPen(v);
                  commitStrokes(strokes, ink, v);
                }}
              />
              <ToolChoice
                label="Ink colour"
                fill
                value={ink}
                disabled={status === "processing"}
                onChange={(v: string) => {
                  setInk(v);
                  commitStrokes(strokes, v, pen);
                }}
                options={INK_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              />
            </ToolControl>
          )}

          <ToolControl label="PLACEMENT">
            {/* These three fields ARE the stored placement, as percentages of
                the page you can see. Dragging on the page writes the same
                three numbers through the same clamp, which is why the two can
                never disagree — and why the position is reachable with no
                pointer at all. */}
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["xPct", "X %"],
                  ["yPct", "Y %"],
                  ["widthPct", "Width %"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex min-w-0 flex-col gap-1">
                  <span className="font-body text-[11px] text-text-muted">{label}</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={place[key]}
                    onChange={(e) => setPlaceField(key, Number(e.target.value))}
                    aria-label={
                      key === "widthPct"
                        ? "Signature width as a percentage of the page width"
                        : `Signature ${key === "xPct" ? "left" : "top"} edge as a percentage of the page`
                    }
                    disabled={status === "processing"}
                    className={NUMBER_FIELD_CLASS}
                  />
                </label>
              ))}
            </div>
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              X and Y are the signature&apos;s top-left corner, measured from the top-left of the
              page. Width is a share of the page width; the height follows your signature&apos;s
              own proportions.
            </span>
          </ToolControl>

          <ToolControl label="PAGE">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={1}
                max={Math.max(1, pageCount || 1)}
                value={pageIndex + 1}
                onChange={(e) => goToPage(Number(e.target.value))}
                aria-label="Page to preview and sign"
                disabled={status === "processing" || pageCount === 0}
                className={cn(NUMBER_FIELD_CLASS, "w-20 flex-none")}
              />
              <button
                type="button"
                onClick={() => goToPage(1)}
                disabled={status === "processing" || pageCount === 0}
                className={chipClass(
                  false,
                  "rounded-[6px] px-3 py-[7px] text-[11.5px] disabled:cursor-not-allowed disabled:opacity-45",
                )}
              >
                First page
              </button>
              <button
                type="button"
                onClick={() => goToPage(pageCount)}
                disabled={status === "processing" || pageCount === 0}
                className={chipClass(
                  false,
                  "rounded-[6px] px-3 py-[7px] text-[11.5px] disabled:cursor-not-allowed disabled:opacity-45",
                )}
              >
                Last page
              </button>
            </div>
            <ToolChoice
              label="Which pages get the signature"
              fill
              value={scope}
              disabled={status === "processing"}
              onChange={(v: Scope) => {
                stale();
                setScope(v);
              }}
              options={[
                { value: "page", label: "This page" },
                { value: "all", label: "Every page" },
              ]}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              {scope === "all"
                ? "The same position and the same share of the page width, on every page. On a document whose pages are not all the same size that means the signature is a different physical size on each one."
                : "Only the page shown above. Change the page number to sign a different one."}
            </span>
          </ToolControl>
        </ToolControlGroup>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Source", mode === "draw" ? "Drawn on the pad" : (uploaded?.label ?? "—")],
              ["Image", sizeLabel],
              ["Placed on", pagesLabel],
              ["Width of page", `${place.widthPct}%`],
            ]}
          />
        </ToolAsideSection>

        <ToolAsideSection label="THIS IS A DRAWN SIGNATURE">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {NOT_A_DIGITAL_SIGNATURE}
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            The picture is drawn into the page&apos;s own content, not attached as an annotation,
            so a reader cannot click it and press delete. That is not tamper-proofing: anyone with
            a PDF editor can still change the page, and nothing in the file would show it.
          </span>
        </ToolAsideSection>

        <ToolAdvanced
          rows={[
            ["Engine", "PDF-LIB"],
            ["Placed as", "PAGE CONTENT"],
            ["Signature field", "NONE"],
            ["Other pages", "UNCHANGED"],
            ["Pad export", "TRANSPARENT PNG"],
          ]}
        />
      </ToolAside>
    </>
  );
}
