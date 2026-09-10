/**
 * The geometry every "put something on a PDF page" tool needs, in one place:
 * how an EXIF-oriented image has to be drawn so it lands the way a viewer
 * shows it, where a displayed-size picture sits inside a target box, and how a
 * point a user picked on a rendered preview maps back into PDF user space.
 *
 * ONE implementation, three callers. images→PDF (six shipped tool pages) needs
 * the orientation half; the stamp/watermark/signature family needs the
 * placement half; a drag-to-place preview overlay needs `fractionToUserSpace`.
 * `src/lib/tools/image-edit-core.ts` is the precedent — the pipelines own the
 * surface they draw on, this file owns the arithmetic, so the copies cannot
 * drift.
 *
 * LEAF MODULE — ZERO imports, runtime or type. Not a stylistic preference:
 * `src/lib/workers/pdf-protocol.ts` records the measurement. pdf-lib's
 * package.json declares no `sideEffects: false`, so a bundler must keep any
 * module reached from an eager import; a UI that statically imports something
 * which re-exports from `pdf-engine-core` turned a 2,259-byte entry that
 * LAZILY loaded a 705 KB pdf-lib chunk into a 2,361-byte entry that loads it
 * STATICALLY. A page-placement control has to import this table at render
 * time, so this file must reach nothing. `import type` is banned here too, for
 * the same reason it is banned in `jpeg-orientation.ts`: the moment one exists,
 * the next edit makes it a value import and nothing catches it.
 *
 * Pure functions only — no DOM, no clock, no randomness. Every function is
 * total: bad numbers get a documented answer instead of a throw, because these
 * run over dimensions parsed out of arbitrary user files.
 *
 * ── The coordinate systems, because three of them meet in this file ──
 *
 *  * PDF USER SPACE: y grows UPWARD, the origin is the page box's lower-left
 *    corner, and the unit is a point (1/72"). Everything returned by this
 *    module is in it.
 *  * A STORED image's pixel grid: y grows DOWNWARD from the top-left of the
 *    sample data as written in the file, before any EXIF tag is honoured.
 *  * The DISPLAYED picture: what a person sees — the stored grid after the
 *    EXIF Orientation tag has been applied, which for values 5–8 has the
 *    stored width and height EXCHANGED.
 */

/** EXIF Orientation values 1..8, as stored in the tag. */
export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** A rectangle in PDF user space: lower-left corner plus extents. */
export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A width/height pair with no position. */
export interface PdfSize {
  width: number;
  height: number;
}

/**
 * How an image with a given EXIF Orientation must be drawn into a PDF so that
 * it appears the way every image viewer shows it.
 *
 * `swapsAxes` is true for 5..8, where the DISPLAYED width/height are the
 * stored height/width.
 */
export interface OrientationDraw {
  /** Degrees counter-clockwise to pass to pdf-lib's `degrees()`. */
  rotate: 0 | 90 | 180 | 270;
  /** Multiply the drawn width by this (-1 mirrors horizontally). */
  scaleX: 1 | -1;
  /** Multiply the drawn height by this (-1 mirrors vertically). */
  scaleY: 1 | -1;
  /** True when orientation 5..8 exchange the displayed axes. */
  swapsAxes: boolean;
}

/**
 * The eight draw recipes, RE-DERIVED rather than remembered — twice, by two
 * routes that share no assumption, because a table like this is exactly the
 * kind of thing that reads right and ships upside down.
 *
 * ROUTE 1 — from the tag's own definition. EXIF 2.3 / TIFF 6.0 tag 0x0112 does
 * not say "rotate 90°"; it says where the stored data's 0th ROW and 0th COLUMN
 * sit in the picture a viewer shows: (top,left) (top,right) (bottom,right)
 * (bottom,left) (left,top) (right,top) (right,bottom) (left,bottom) for 1..8.
 * Placing a 4×2 grid of uniquely-tagged cells by those eight rules gives the
 * displayed grid mechanically, with no rotation vocabulary involved at all.
 *
 * ROUTE 2 — from Chrome's decoder. A 40×20 JPEG with four coloured quadrants,
 * an APP1 Exif segment spliced in carrying each of the eight values, decoded
 * with `createImageBitmap` and read back corner by corner. Measured
 * 2026-09-10; the tag was read back out of the spliced bytes first as a
 * positive control, because "nothing rotated" from a file the decoder never
 * saw a tag in proves nothing:
 *
 *   1: 40×20  TL=TL TR=TR BL=BL BR=BR      5: 20×40  TL=TL TR=BL BL=TR BR=BR
 *   2: 40×20  TL=TR TR=TL BL=BR BR=BL      6: 20×40  TL=BL TR=TL BL=BR BR=TR
 *   3: 40×20  TL=BR TR=BL BL=TR BR=TL      7: 20×40  TL=BR TR=TR BL=BL BR=TL
 *   4: 40×20  TL=BL TR=BR BL=TL BR=TR      8: 20×40  TL=TR TR=BR BL=TL BR=BL
 *
 * The two routes agree cell for cell, and `pdf-stamp-core.test.ts` pins the
 * Chrome measurement against a simulation of pdf-lib's own matrix composition,
 * so a wrong entry here fails a test rather than shipping a sideways photo.
 *
 * ⚠ In WORDS, 5 is the TRANSPOSE (mirror horizontally, then rotate 90°
 * COUNTER-clockwise) and 7 is the TRANSVERSE (mirror horizontally, then rotate
 * 90° CLOCKWISE) — the pair is easy to state backwards, and half the tables on
 * the internet do. The numbers below are what was measured; the words are a
 * gloss on them, never the other way round.
 *
 * `scaleX`/`scaleY` are applied BEFORE `rotate`, matching pdf-lib's operator
 * order in `drawImage`: translate(x,y) · rotate(θ) · scale(w,h), so a point
 * goes through the scale first (node_modules/pdf-lib/cjs/api/operations.js:39).
 * The four reflections (2,4,5,7) each need exactly one mirror; which axis it is
 * spent on is free, so it is spent on whichever reads as the plain-English
 * meaning of the value — horizontal for 2/5/7, vertical for 4.
 */
const ORIENTATION_DRAW: Record<ExifOrientation, OrientationDraw> = {
  /** As stored. */
  1: { rotate: 0, scaleX: 1, scaleY: 1, swapsAxes: false },
  /** Mirrored horizontally. */
  2: { rotate: 0, scaleX: -1, scaleY: 1, swapsAxes: false },
  /** Rotated 180°. */
  3: { rotate: 180, scaleX: 1, scaleY: 1, swapsAxes: false },
  /** Mirrored vertically. */
  4: { rotate: 0, scaleX: 1, scaleY: -1, swapsAxes: false },
  /** Transpose: mirrored horizontally, then rotated 90° counter-clockwise. */
  5: { rotate: 90, scaleX: -1, scaleY: 1, swapsAxes: true },
  /** Rotated 90° clockwise — the commonest one, a phone held upright. */
  6: { rotate: 270, scaleX: 1, scaleY: 1, swapsAxes: true },
  /** Transverse: mirrored horizontally, then rotated 90° clockwise. */
  7: { rotate: 270, scaleX: -1, scaleY: 1, swapsAxes: true },
  /** Rotated 90° counter-clockwise. */
  8: { rotate: 90, scaleX: 1, scaleY: 1, swapsAxes: true },
};

/**
 * Narrow a number that came out of a file to an `ExifOrientation`.
 *
 * `readJpegOrientation` (jpeg-orientation.ts) returns a plain `number` because
 * it reads whatever the file says, and files say things like 0 and 9. 1 is the
 * honest answer for all of them: it is what "no rotation" means, and it is
 * what a decoder does with a file that has no readable tag.
 */
export function asExifOrientation(value: number): ExifOrientation {
  return Number.isInteger(value) && value >= 1 && value <= 8
    ? (value as ExifOrientation)
    : 1;
}

/**
 * The draw recipe for one orientation. A fresh object every call — the table
 * above is module state, and a caller that adjusts a field on it would corrupt
 * every later call in the tab.
 */
export function orientationDraw(orientation: ExifOrientation): OrientationDraw {
  return { ...ORIENTATION_DRAW[asExifOrientation(orientation)] };
}

/**
 * The displayed size of an image whose STORED pixel grid is w x h.
 * Returns { width: h, height: w } for orientations 5..8.
 *
 * This is the number a layout must use. Using the stored size for orientation
 * 6 or 8 is the shipped bug this module exists to end: the picture gets fitted
 * to a box shaped for the wrong aspect ratio, so it is stretched as well as
 * turned.
 */
export function displayedSize(stored: PdfSize, orientation: ExifOrientation): PdfSize {
  const width = positive(stored.width);
  const height = positive(stored.height);
  return orientationDraw(orientation).swapsAxes
    ? { width: height, height: width }
    : { width, height };
}

/**
 * Where to place a DISPLAYED-size image inside a target box, and with what
 * pdf-lib draw arguments, so that the EXIF orientation is honoured.
 *
 * `box` is in PDF user space, already resolved by `visiblePageBox` below.
 * `fit` is "contain" (letterbox, preserve aspect) or "stretch".
 *
 * The returned x/y/width/height/rotate are EXACTLY what the caller passes to
 * `page.drawImage(embedded, { x, y, width, height, rotate: degrees(rotate) })`.
 * pdf-lib accepts negative width/height, and the returned values may be
 * negative for the mirrored orientations (2,4,5,7) — that is deliberate and
 * verified to render correctly.
 */
export interface StampPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  rotate: 0 | 90 | 180 | 270;
}

export function placeImageInBox(args: {
  stored: PdfSize;
  orientation: ExifOrientation;
  box: PdfRect;
  fit: "contain" | "stretch";
}): StampPlacement {
  const draw = orientationDraw(args.orientation);
  const shown = displayedSize(args.stored, args.orientation);
  const box = {
    x: finite(args.box.x),
    y: finite(args.box.y),
    width: positive(args.box.width),
    height: positive(args.box.height),
  };

  // The rectangle the DISPLAYED picture is to occupy, in user space. "stretch"
  // takes the whole box; "contain" takes the largest concentric rectangle of
  // the DISPLAYED aspect ratio that fits — displayed, so that an orientation-6
  // photo is letterboxed as the portrait it will appear as, not as the
  // landscape its sample grid is.
  let targetWidth = box.width;
  let targetHeight = box.height;
  if (args.fit === "contain") {
    const scale = Math.min(box.width / shown.width, box.height / shown.height);
    targetWidth = shown.width * scale;
    targetHeight = shown.height * scale;
  }
  const targetX = box.x + (box.width - targetWidth) / 2;
  const targetY = box.y + (box.height - targetHeight) / 2;

  /*
    pdf-lib draws an image XObject over the unit square with the FIRST sample
    row at the TOP (v = 1), under the CTM translate(x,y)·rotate(θ)·scale(w,h).
    So the drawn extents `width`/`height` are measured along the image's OWN
    axes, before the rotation — which for a 90°/270° recipe means the target
    box's height and width swap over.
  */
  const width = draw.scaleX * (draw.swapsAxes ? targetHeight : targetWidth);
  const height = draw.scaleY * (draw.swapsAxes ? targetWidth : targetHeight);

  /*
    x/y is not a corner of the target rectangle — it is the anchor the rotation
    turns about, i.e. wherever the STORED image's bottom-left sample ends up.
    Rather than tabulate that corner for all eight recipes (eight chances to
    write "top-right" where the drawing says "top-left"), transform the unit
    square with the anchor at the origin, and shift by however far its bounding
    box misses the target rectangle's lower-left corner. One rule, no cases.

    cos/sin are read from a table because Math.cos(Math.PI / 2) is 6.1e-17, not
    0, and a placement that is 6e-17 off is a placement whose test cannot use
    an exact comparison.
  */
  const cos = COS[draw.rotate];
  const sin = SIN[draw.rotate];
  const cornerX = [0, cos * width, -sin * height, cos * width - sin * height];
  const cornerY = [0, sin * width, cos * height, sin * width + cos * height];

  return {
    x: targetX - Math.min(...cornerX),
    y: targetY - Math.min(...cornerY),
    width,
    height,
    rotate: draw.rotate,
  };
}

/** Exact quarter-turn cosines. Math.cos(π/2) is 6.1e-17; that is not 0. */
const COS: Record<0 | 90 | 180 | 270, number> = { 0: 1, 90: 0, 180: -1, 270: 0 };
const SIN: Record<0 | 90 | 180 | 270, number> = { 0: 0, 90: 1, 180: 0, 270: -1 };

/**
 * The rectangle a reader actually shows for a page, in PDF user space,
 * accounting for a CropBox that differs from the MediaBox and for a
 * non-zero origin.
 *
 * ⚠ MEASURED: using the MediaBox when a CropBox exists pushes a stamp
 * off the visible page. Callers must use this, not `page.getSize()` —
 * `getSize()` reports the MediaBox's extents and drops its origin entirely
 * (node_modules/pdf-lib/cjs/api/PDFPage.js:294), so on a page whose box starts
 * at (0, 396) every stamp lands 396 points low.
 *
 * Call it with plain rectangles — `visiblePageBox({ mediaBox: page.getMediaBox(),
 * cropBox: page.getCropBox() })` — because this module may not import pdf-lib
 * (see the header). pdf-lib's `getCropBox()` already falls back to the MediaBox
 * when the page declares none, so passing both is safe; `null`/`undefined` is
 * accepted for the caller that has not looked.
 *
 * Two traps handled here:
 *  * pdf-lib's `asRectangle` does NOT normalise a rectangle
 *    (core/objects/PDFArray.js:54-66) — it subtracts element 0 from element 2
 *    verbatim. PDF 32000-1 §7.9.5 leaves the corner order unspecified, so a
 *    perfectly legal `/MediaBox [0 792 612 0]` arrives as height −792. Every
 *    rectangle is re-cornered before use.
 *  * A CropBox is only meaningful where it overlaps the MediaBox, so the two
 *    are INTERSECTED. A CropBox that misses the MediaBox entirely is a broken
 *    file; the MediaBox is the only answer that still shows the page.
 */
export function visiblePageBox(boxes: {
  mediaBox: PdfRect;
  cropBox?: PdfRect | null;
}): PdfRect {
  const media = normaliseRect(boxes.mediaBox);
  if (!boxes.cropBox) return media;
  const crop = normaliseRect(boxes.cropBox);

  const x = Math.max(media.x, crop.x);
  const y = Math.max(media.y, crop.y);
  const right = Math.min(media.x + media.width, crop.x + crop.width);
  const top = Math.min(media.y + media.height, crop.y + crop.height);
  if (right <= x || top <= y) return media;
  return { x, y, width: right - x, height: top - y };
}

/**
 * `rotation` is normalised to 0|90|180|270 — pdf-lib's own
 * `reduceRotation(-90)` returns 0, which is WRONG (it should be 270), so
 * normalise with `((r % 360) + 360) % 360` yourself.
 *
 * Non-multiples of 90 are rounded to the NEAREST quarter turn rather than
 * truncated or rejected: PDF 32000-1 §7.7.3.3 requires /Rotate to be a
 * multiple of 90, so a file carrying 47 is already broken and the reader has
 * picked something; rounding at least keeps a stamp on the same side of the
 * page as the content. Ties go to the larger angle (Math.round's rule: 45
 * becomes 90, −45 becomes 0). A non-finite angle is 0, the same answer a
 * missing /Rotate gives.
 */
export function normaliseRotation(angle: number): 0 | 90 | 180 | 270 {
  if (!Number.isFinite(angle)) return 0;
  const quarters = Math.round(angle / 90);
  const wrapped = ((quarters % 4) + 4) % 4;
  return (wrapped * 90) as 0 | 90 | 180 | 270;
}

/**
 * The size of a page AS THE USER SEES IT — width and height exchanged when
 * the page's /Rotate is 90 or 270.
 */
export function displayedPageSize(
  pageBox: PdfSize,
  rotation: 0 | 90 | 180 | 270,
): PdfSize {
  const width = positive(pageBox.width);
  const height = positive(pageBox.height);
  const turned = normaliseRotation(rotation) % 180 !== 0;
  return turned ? { width: height, height: width } : { width, height };
}

/**
 * Map a point expressed as a FRACTION of the displayed page (0..1 from the
 * top-left of the page as the user sees it, which is how a preview overlay
 * reports a drag) into PDF user-space coordinates on that page.
 *
 * `pageBox` is the visible box; `rotation` is the page's normalised /Rotate.
 * This is the function a placement canvas depends on, and it is the reason
 * the maths lives in a leaf rather than in a component.
 *
 * TWO flips at once, which is why it is worth its own function rather than a
 * line in a component:
 *
 *  * The fraction's y runs DOWN from the top (a canvas, a mouse event, a
 *    thumbnail) and user space's y runs UP from the bottom.
 *  * /Rotate turns the page CLOCKWISE for display (PDF 32000-1 §7.7.3.3), so
 *    on a 90° page the fraction's x axis runs along the page's y axis. Both
 *    are inverted below: the caller hands over a point in the ROTATED picture
 *    and gets back the unrotated user-space point that lands there.
 *
 * Derived, not tabulated: rotating the displayed picture 90° clockwise sends
 * unit-square (dx,dy) to (1−dy,dx), 180° to (1−dx,1−dy) and 270° to (dy,1−dx);
 * each line below is that map inverted, with dy = 1 − (b) folding in the y
 * flip. The corners round-trip for all four rotations, which is what the test
 * asserts.
 *
 * Fractions outside 0..1 are clamped: they name a point that is not on the
 * page, and the nearest edge is the only answer that does not invent a page.
 */
/**
 * The unit vector pointing DOWN the page as the reader sees it, expressed in
 * PDF user space.
 *
 * WHY IT EXISTS. Placement fractions are top-left anchored, but a PDF draws an
 * image and a rectangle from their BOTTOM-left corner, so a stamp has to be
 * shifted by its own height along "displayed down". The obvious spelling —
 * `y: origin.y - height` — is a subtraction along the UNROTATED y axis, and it
 * only means "down the page" when `/Rotate` is 0. On a turned page it puts the
 * mark up to two of its own heights out of place: measured on A4, a 0.50 x 0.30
 * rect requested at (0.200, 0.100) landed at (0.200, 0.100) on an unrotated
 * page but at (-0.012, -0.200) at 90 degrees, (0.200, -0.500) at 180 — entirely
 * off the top of the page — and (0.412, -0.200) at 270.
 *
 * ⚠ IT IS DERIVED FROM `fractionToUserSpace` RATHER THAN TABULATED, and that is
 * deliberate. A hand-written table of four vectors is a second statement of the
 * same geometry that can drift from the first; asking the mapping itself where
 * the top of the page goes and where the bottom goes cannot. For rotation 0 it
 * reduces to exactly `(0, -1)`, so the old behaviour is a special case of this
 * one rather than something replaced.
 */
export function displayedDownUnit(
  pageBox: PdfRect,
  rotation: 0 | 90 | 180 | 270,
): { x: number; y: number } {
  const top = fractionToUserSpace({ fraction: { x: 0, y: 0 }, pageBox, rotation });
  const bottom = fractionToUserSpace({ fraction: { x: 0, y: 1 }, pageBox, rotation });
  const dx = bottom.x - top.x;
  const dy = bottom.y - top.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (!Number.isFinite(length) || length === 0) return { x: 0, y: -1 };
  return { x: dx / length, y: dy / length };
}

export function fractionToUserSpace(args: {
  fraction: { x: number; y: number };
  pageBox: PdfRect;
  rotation: 0 | 90 | 180 | 270;
}): { x: number; y: number } {
  const fx = clamp01(args.fraction.x);
  const fy = clamp01(args.fraction.y);
  const x = finite(args.pageBox.x);
  const y = finite(args.pageBox.y);
  const width = positive(args.pageBox.width);
  const height = positive(args.pageBox.height);

  switch (normaliseRotation(args.rotation)) {
    case 90:
      return { x: x + fy * width, y: y + fx * height };
    case 180:
      return { x: x + (1 - fx) * width, y: y + fy * height };
    case 270:
      return { x: x + (1 - fy) * width, y: y + (1 - fx) * height };
    default:
      return { x: x + fx * width, y: y + (1 - fy) * height };
  }
}

// ── internals ────────────────────────────────────────────────────

/** Any finite number, or 0 — geometry with a NaN in it silently draws nothing. */
function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * A strictly positive extent. Unlike image-edit-core's `positiveInt` this does
 * NOT round: PDF user space is continuous, and A4 is 595.28 × 841.89 points.
 */
function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Lower-left corner plus positive extents, whichever corners the file gave. */
function normaliseRect(rect: PdfRect): PdfRect {
  const x1 = finite(rect.x);
  const y1 = finite(rect.y);
  const x2 = x1 + finite(rect.width);
  const y2 = y1 + finite(rect.height);
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: positive(Math.abs(x2 - x1)),
    height: positive(Math.abs(y2 - y1)),
  };
}

/**
 * The codepoints pdf-lib's standard fonts can actually draw — WinAnsi, i.e.
 * cp1252 — as 18 ranges.
 *
 * ⚠ THIS TABLE IS A MEASUREMENT, NOT A RECOLLECTION. It was produced by asking
 * an embedded Helvetica to measure every codepoint from U+0000 to U+FFFF and
 * keeping the ones that did not throw: exactly **218** of them, the highest
 * being U+2122. `pdf-stamp-core.test.ts` re-derives it against pdf-lib and
 * fails if the two ever disagree in either direction.
 *
 * WHY IT LIVES HERE, in the module with no imports at all. A tool has to tell
 * the user that a character cannot be drawn BEFORE they press the button, and
 * the only other way to know is to ask pdf-lib — which would mean a component
 * reaching into `pdf-engine-core` and pulling pdf-lib's chunk into the eager
 * bundle. Four of the seven tools built against the stamping engine reported
 * exactly that problem. A pure predicate costs nothing and is what the engine
 * itself now uses, so the check the user sees and the check that refuses the
 * run cannot drift apart.
 */
const WINANSI_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x20, 0x7e],
  [0xa0, 0xff],
  [0x152, 0x153],
  [0x160, 0x161],
  [0x178, 0x178],
  [0x17d, 0x17e],
  [0x192, 0x192],
  [0x2c6, 0x2c6],
  [0x2dc, 0x2dc],
  [0x2013, 0x2014],
  [0x2018, 0x201a],
  [0x201c, 0x201e],
  [0x2020, 0x2022],
  [0x2026, 0x2026],
  [0x2030, 0x2030],
  [0x2039, 0x203a],
  [0x20ac, 0x20ac],
  [0x2122, 0x2122],
];

/** Whether a standard PDF font can draw this single character. */
export function isStampDrawable(character: string): boolean {
  const cp = character.codePointAt(0);
  if (cp === undefined) return true;
  for (const [lo, hi] of WINANSI_RANGES) {
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

/**
 * The characters a text stamp cannot draw, in the order they first appear.
 *
 * Newlines are skipped: they are not drawn glyphs and pdf-lib handles them.
 *
 * WHAT THIS MEANS IN PRACTICE, because copy written from a vague memory of it
 * has already been wrong once: WESTERN European Latin is fine — é ü ñ ç å ø æ,
 * curly quotes, the em dash and the euro sign all encode. CENTRAL and EASTERN
 * European Latin is NOT — Ł ł ș ț ő ű Đ all fail — and neither do Greek,
 * Cyrillic, Hebrew, Arabic, Thai, Devanagari, CJK, box-drawing characters or
 * emoji. "Latin is fine" is too generous a sentence to put in front of a user.
 */
export function unsupportedStampCharacters(text: string): string[] {
  const bad: string[] = [];
  for (const character of text) {
    if (character === "\n" || character === "\r") continue;
    if (isStampDrawable(character)) continue;
    if (!bad.includes(character)) bad.push(character);
  }
  return bad;
}
