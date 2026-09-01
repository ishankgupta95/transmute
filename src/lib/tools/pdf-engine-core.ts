import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFStream,
  StandardFonts,
  beginText,
  concatTransformationMatrix,
  degrees,
  endText,
  moveText,
  popGraphicsState,
  pushGraphicsState,
  setFontAndSize,
  showText,
} from "pdf-lib";
import type { PDFContext, PDFObject } from "pdf-lib";

/**
 * The pdf-lib implementations, environment-agnostic (no DOM) so they run
 * inside the PDF pool worker (workers/pdf.worker.ts) — multi-hundred-page
 * saves used to freeze the tab. pdf-engine.ts re-exports these behind
 * worker-routing wrappers; UIs never import this module directly. The pdfjs
 * render path stays in pdf-engine.ts: pdfjs ships its own worker already.
 *
 * Everything here used to run on MuPDF compiled to WebAssembly. That engine
 * is gone; these are pure-JS pdf-lib ports of the same seven operations. Two
 * behavioural deltas came with the swap and both are surfaced honestly rather
 * than papered over (see `loadDocument`): MuPDF silently reconstructed broken
 * cross-reference tables, and it opened documents whose only protection was an
 * owner password. pdf-lib does neither, so those files now fail with a message
 * that says what actually went wrong instead of quietly producing output the
 * user cannot trust.
 */

function toUint8Array(buf: ArrayBuffer | Uint8Array): Uint8Array {
  return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
}

// ── Loading ────────────────────────────────────────────────────────

const PASSWORD_MESSAGE =
  "This PDF is password-protected. Remove the password in a PDF reader and try again — nothing here can decrypt a protected document.";

const DAMAGED_MESSAGE =
  "This PDF could not be read — the file is damaged or is not a PDF. Nothing here repairs a broken PDF, so try re-exporting it from the program that produced it.";

/**
 * `PDFDocument.load`, with the two failure modes users actually hit turned
 * into sentences instead of parser internals.
 *
 * Matching is done on the message text, NOT `instanceof`. pdf-lib 1.17.1 is
 * compiled to ES5, so its error subclasses go through tslib's `__extends`;
 * `Error.call(this, msg)` returns a fresh native Error rather than
 * initialising `this`, which means `err instanceof EncryptedPDFError` is
 * false and `err.constructor.name` is plain `"Error"` for every one of them.
 * Verified against the installed build — do not "fix" this to an instanceof
 * check, it silently stops matching.
 *
 * Anything that is neither an encryption refusal nor a parse failure is
 * rethrown untouched: we do not know what it was, so we do not get to
 * describe it.
 *
 * `updateMetadata: false` is the load option that stops pdf-lib stamping its
 * own /Producer and a fresh /ModDate onto the document the moment it opens —
 * on the in-place ops (rotate, page numbers, compress) that would rewrite the
 * user's metadata behind their back, and on the grafting ops it would corrupt
 * the /Info we are about to carry across. Note this belongs on `load`, not on
 * `save`: pdf-lib's SaveOptions has no such field.
 */
async function loadDocument(data: ArrayBuffer | Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(toUint8Array(data), { updateMetadata: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/is encrypted/.test(message)) throw new Error(PASSWORD_MESSAGE);
    if (/Failed to parse|Missing catalog|corrupt page tree/i.test(message)) {
      throw new Error(DAMAGED_MESSAGE);
    }
    throw err;
  }
}

// ── Document /Info ─────────────────────────────────────────────────

/**
 * Carry the source document's /Info fields onto a grafted output.
 *
 * split / merge / reorder all build a fresh `PDFDocument` and copy pages in,
 * which carries page-level content but leaves the trailer empty — the title
 * and author silently vanished. (Bookmarks are a separate problem: the
 * /Outlines tree points at page objects by reference and would need its
 * destinations remapped across the copy, so it is deliberately not carried.
 * MergePdfUI's stat strip says so rather than claiming "KEPT".)
 *
 * MuPDF did this with one `graftMap.graftObject(info)` that deep-copied the
 * whole dictionary across documents. pdf-lib has no cross-context graft for
 * the trailer, so this reads and re-sets the eight standard entries instead.
 * The consequence worth stating plainly: a NON-standard /Info key — some
 * producers add their own — is not carried through any more. The eight below
 * are everything the tools' copy promises and everything the e2e contract
 * checks.
 *
 * Each field is read behind its own try: pdf-lib's getters assert the entry's
 * type and throw on, say, a /Title that is a number rather than a string, and
 * one malformed entry must not cost the caller the other seven — or the whole
 * operation, which is what the old blanket catch risked.
 */
function copyDocInfo(src: PDFDocument, out: PDFDocument): void {
  const carry = <T>(read: () => T | undefined, write: (value: T) => void): void => {
    let value: T | undefined;
    try {
      value = read();
    } catch {
      return;
    }
    if (value === undefined) return;
    write(value);
  };

  carry(() => src.getTitle(), (v) => out.setTitle(v));
  carry(() => src.getAuthor(), (v) => out.setAuthor(v));
  carry(() => src.getSubject(), (v) => out.setSubject(v));
  // getKeywords hands back the joined string the file stores; setKeywords
  // joins its array with the same single space, so a one-element array is an
  // exact round-trip rather than a re-split that could lose the original
  // spacing.
  carry(() => src.getKeywords(), (v) => out.setKeywords([v]));
  carry(() => src.getCreator(), (v) => out.setCreator(v));
  carry(() => src.getProducer(), (v) => out.setProducer(v));
  carry(() => src.getCreationDate(), (v) => out.setCreationDate(v));
  carry(() => src.getModificationDate(), (v) => out.setModificationDate(v));
}

/**
 * Output documents for the grafting ops start with NO /Info at all
 * (`updateMetadata: false` on create), so `copyDocInfo` writes exactly the
 * fields the source actually had. Creating with the default would stamp
 * "pdf-lib (…)" as the producer and today's date on every file, which for a
 * source that carried neither is an invented fact, not a carried one.
 */
function createGraftTarget(): Promise<PDFDocument> {
  return PDFDocument.create({ updateMetadata: false });
}

// ── Saving ─────────────────────────────────────────────────────────

/**
 * `addDefaultPage` defaults to TRUE in pdf-lib: a document that reaches
 * `save()` with no pages gets a blank one invented for it. That is a sensible
 * default for a library whose usual caller is building a document from
 * scratch, and completely wrong for a toolkit — extracting zero pages, or
 * compressing a pathological file whose page tree is empty, must not hand the
 * user back a blank sheet they never asked for. Every operation that saves a
 * document derived from the user's own file turns it off.
 *
 * imagesToPdf deliberately does NOT use this: it builds a document from
 * scratch, which is the case the pdf-lib default is written for.
 */
const SAVE_OPTIONS = { addDefaultPage: false } as const;

// ── Load / Info ────────────────────────────────────────────────────

export async function getPageCount(data: ArrayBuffer | Uint8Array): Promise<number> {
  const doc = await loadDocument(data);
  return doc.getPageCount();
}

/**
 * Repoint each copied annotation's /P at the page it now lives on, then drop
 * whatever that leaves unreferenced.
 *
 * An annotation may name its page with `/P` (PDF 32000-1 12.5.2). pdf-lib's
 * `copyPages` deep-copies the annotation, and that copy carries /P, so the
 * copier follows it and copies the ORIGINAL page dictionary too — a second
 * `/Type /Page` object that is not in the output's /Pages tree and that the
 * annotation, not the tree, is holding alive. The result is a file with twice
 * as many page objects as pages: the page count is right and every viewer
 * renders it correctly, but each annotation claims to belong to a page that
 * is not in the document, which is exactly what preflight and PDF/A validators
 * fail on. MuPDF's graft did not have this shape.
 *
 * Fixing the reference makes the duplicate unreachable, and the sweep the
 * compressor already owns then collects it.
 */
function fixAnnotationPageRefs(out: PDFDocument): void {
  for (const page of out.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const annot = out.context.lookup(annots.get(i));
      if (annot instanceof PDFDict && annot.get(PDFName.of("P")) !== undefined) {
        annot.set(PDFName.of("P"), page.ref);
      }
    }
  }
  sweepUnreachableObjects(out.context);
}

// ── Merge ──────────────────────────────────────────────────────────

export async function mergePdfs(buffers: ArrayBuffer[]): Promise<Uint8Array> {
  const out = await createGraftTarget();

  let infoCopied = false;
  for (const buf of buffers) {
    const src = await loadDocument(buf);
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const page of pages) out.addPage(page);
    // A merge has no single authoritative title, so the first document's
    // /Info wins rather than the last one silently overwriting it. The latch
    // fires on the first document, not on the first document that happens to
    // have a title: blending a title from file 1 with an author from file 3
    // would be a document description that never existed anywhere.
    if (!infoCopied) {
      copyDocInfo(src, out);
      infoCopied = true;
    }
  }

  fixAnnotationPageRefs(out);
  return out.save(SAVE_OPTIONS);
}

// ── Split ──────────────────────────────────────────────────────────

/** Extract specific pages (0-indexed) into a new PDF. */
export async function splitPdf(
  data: ArrayBuffer | Uint8Array,
  pageIndices: number[],
): Promise<Uint8Array> {
  const src = await loadDocument(data);
  const out = await createGraftTarget();

  // copyPages honours the order it is handed, and the callers hand it their
  // own selection order (SplitPdfUI sorts ascending first).
  const pages = await out.copyPages(src, pageIndices);
  for (const page of pages) out.addPage(page);
  copyDocInfo(src, out);

  fixAnnotationPageRefs(out);
  return out.save(SAVE_OPTIONS);
}

// ── Rotate ────────────────────────────────────────────────────────

/** Rotate specified pages by the given angle (90, 180, 270). */
export async function rotatePdfPages(
  data: ArrayBuffer | Uint8Array,
  pageIndices: number[],
  angle: number,
): Promise<Uint8Array> {
  const doc = await loadDocument(data);
  const pages = doc.getPages();

  for (const idx of pageIndices) {
    if (idx >= 0 && idx < pages.length) {
      const page = pages[idx];
      // Rotation is cumulative, and /Rotate is an inheritable attribute: on a
      // document that carries its rotation on the /Pages node, reading the raw
      // page dictionary returns nothing and every rotation became a silent
      // no-op. pdf-lib's getRotation() walks the /Parent chain for us
      // (PDFPageLeaf.Rotate uses getInheritableAttribute), and setRotation
      // writes the absolute result onto this leaf only — siblings that were
      // only inheriting keep inheriting.
      page.setRotation(degrees(normaliseQuarterTurn(page.getRotation().angle + angle)));
    }
  }

  return doc.save(SAVE_OPTIONS);
}

/**
 * Put a page rectangle into the lower-left-origin, positive-extent form the
 * placement maths assumes.
 *
 * PDF 32000-1 7.9.5 lets a rectangle be written with EITHER pair of opposite
 * corners, and requires readers to normalise it — so `/MediaBox [0 792 612 0]`
 * is a perfectly legal way to describe the same US Letter page as
 * `[0 0 612 792]`. pdf-lib's `getMediaBox()` reports the raw numbers, which
 * for that spelling gives a negative height; the number would then be stamped
 * at y = 792 + 20 on a page that ends at 792, i.e. off the top edge and
 * invisible. MuPDF normalised for us because `getBounds()` returned an already
 * resolved rectangle.
 */
function normaliseRect(rect: { x: number; y: number; width: number; height: number }): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: Math.min(rect.x, rect.x + rect.width),
    y: Math.min(rect.y, rect.y + rect.height),
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
}

/**
 * Snap an angle to the quarter turn it is nearest, in [0, 360).
 *
 * PDF 32000-1 requires /Rotate to be a multiple of 90 and pdf-lib enforces
 * that on write, so a malformed source value has to be repaired rather than
 * carried: adding 90 to a stored 45 would otherwise throw halfway through the
 * document and lose the whole operation. The same normalisation gives
 * addPageNumbers the four cases its compensation matrix knows how to invert.
 */
function normaliseQuarterTurn(angle: number): number {
  return ((((Math.round(angle / 90) * 90) % 360) + 360) % 360);
}

// ── Reorder ───────────────────────────────────────────────────────

/** Reorder pages based on the given order (0-indexed). */
export async function reorderPdfPages(
  data: ArrayBuffer | Uint8Array,
  newOrder: number[],
): Promise<Uint8Array> {
  const src = await loadDocument(data);
  const out = await createGraftTarget();

  const pages = await out.copyPages(src, newOrder);
  for (const page of pages) out.addPage(page);
  copyDocInfo(src, out);

  fixAnnotationPageRefs(out);
  return out.save(SAVE_OPTIONS);
}

// ── Add Page Numbers (creates content on existing pages) ───────────

export type PageNumberPosition = "bottom-left" | "bottom-center" | "bottom-right" | "top-left" | "top-center" | "top-right";

/**
 * The key our Helvetica goes under in each page's /Font dictionary.
 *
 * pdf-lib offers a randomised unique key, but a stable name keeps the output
 * reproducible for a given input, which is worth more here than guarding
 * against a collision with a name no real producer emits. Re-stamping a file
 * this tool already numbered reuses the key for the same Helvetica, which is
 * the correct outcome.
 */
const PAGE_NUMBER_FONT_KEY = "PgNum";

export async function addPageNumbers(
  data: ArrayBuffer | Uint8Array,
  position: PageNumberPosition = "bottom-center",
  startNumber: number = 1,
): Promise<Uint8Array> {
  const doc = await loadDocument(data);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontSize = 10;

  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const text = String(startNumber + i);
    const textWidth = font.widthOfTextAtSize(text, fontSize);

    /*
      MuPDF handed back the VISUAL page rectangle — /Rotate already applied —
      and the placement below is written in those terms. pdf-lib does not:
      getSize() and getMediaBox() both report the UNROTATED media box, so the
      visual frame has to be derived here. A quarter turn swaps the two
      dimensions; a half turn leaves them alone.
    */
    const rot = normaliseQuarterTurn(page.getRotation().angle);
    const media = normaliseRect(page.getMediaBox());
    const visualWidth = rot % 180 === 0 ? media.width : media.height;
    const visualHeight = rot % 180 === 0 ? media.height : media.width;

    const isTop = position.startsWith("top");
    const y = isTop ? media.y + visualHeight - 30 : media.y + 20;
    let x: number;
    if (position.endsWith("left")) {
      x = media.x + 40;
    } else if (position.endsWith("right")) {
      x = media.x + visualWidth - 40 - textWidth;
    } else {
      x = media.x + (visualWidth - textWidth) / 2;
    }

    /*
      The number is placed in the visual frame above, but the operators below
      are appended to the page's own content stream, which is UNROTATED space
      — pdf-lib draws there exactly as the raw MuPDF stream did. So the stamp
      needs the inverse of the display rotation. Without it a number on a
      /Rotate 90 A4 page was centred on 842 inside a 595-wide media box and
      drawn sideways off the edge.

      /Rotate R displays the page turned R clockwise, so content = inverse of
      display: R=90 maps visual (X,Y) to (y, w−x), inverted as [0 1 −1 0 w 0].
      w and h in those matrices are the UNROTATED media dimensions, which is
      the one place the pdf-lib port gets to be simpler than the MuPDF one:
      the old code had to swap them back out of the visual rect, and
      getMediaBox() hands them over already unrotated.

      The translation components additionally carry the media box origin,
      because the matrix works in a box that starts at (0,0) and the visual
      coordinates fed through it have had that origin removed (see tx/ty). An
      unrotated page skips the matrix entirely and keeps the raw coordinates,
      which are already content space.
    */
    const w = media.width;
    const h = media.height;
    const cm: [number, number, number, number, number, number] | null =
      rot === 90
        ? [0, 1, -1, 0, media.x + w, media.y]
        : rot === 180
          ? [-1, 0, 0, -1, media.x + w, media.y + h]
          : rot === 270
            ? [0, -1, 1, 0, media.x, media.y + h]
            : null;
    const tx = cm ? x - media.x : x;
    const ty = cm ? y - media.y : y;

    /*
      `setFontDictionary` runs PDFPageLeaf.normalize() first, and normalize
      does the two jobs the MuPDF version had to do by hand: it resolves an
      INHERITED /Resources onto the page (so adding our font cannot shadow the
      fonts and XObjects the page was inheriting and visually corrupt it), and
      it wraps whatever content the page already had in q/Q so an unbalanced
      graphics state in the original cannot leak into the stamp. That is why
      the block of Resources/Font plumbing that used to live here is gone
      rather than ported.
    */
    page.node.setFontDictionary(PDFName.of(PAGE_NUMBER_FONT_KEY), font.ref);

    /*
      Written as explicit operators rather than page.drawText(): drawText
      emits its translation as a text MATRIX (`1 0 0 1 x y Tm`) plus a fill
      colour and a leading, where the placement contract here — and the e2e
      assertion that pins it — is a plain `x y Td` inside the compensation
      matrix. showText takes the font's own encoding of the string, which is
      a hex literal, so the parenthesis escaping the raw-string version needed
      has no equivalent to port.
    */
    page.pushOperators(
      pushGraphicsState(),
      ...(cm ? [concatTransformationMatrix(...cm)] : []),
      beginText(),
      setFontAndSize(PAGE_NUMBER_FONT_KEY, fontSize),
      moveText(tx, ty),
      showText(font.encodeText(text)),
      endText(),
      popGraphicsState(),
    );
  }

  return doc.save(SAVE_OPTIONS);
}

// ── Images to PDF (pdf-lib — creating from scratch) ────────────────

export type PageSize = "a4" | "letter" | "fit";

const PAGE_SIZES: Record<string, { width: number; height: number }> = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
};

export async function imagesToPdf(
  images: { bytes: Uint8Array; type: string }[],
  pageSize: PageSize = "a4",
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();

  for (const img of images) {
    let embedded;
    if (img.type === "image/png") {
      embedded = await pdf.embedPng(img.bytes);
    } else {
      embedded = await pdf.embedJpg(img.bytes);
    }

    const imgDims = embedded.scale(1);

    let pageWidth: number;
    let pageHeight: number;

    if (pageSize === "fit") {
      pageWidth = imgDims.width;
      pageHeight = imgDims.height;
    } else {
      const dims = PAGE_SIZES[pageSize];
      pageWidth = dims.width;
      pageHeight = dims.height;
    }

    const page = pdf.addPage([pageWidth, pageHeight]);

    if (pageSize === "fit") {
      page.drawImage(embedded, { x: 0, y: 0, width: pageWidth, height: pageHeight });
    } else {
      const margin = 40;
      const maxW = pageWidth - margin * 2;
      const maxH = pageHeight - margin * 2;
      const scale = Math.min(maxW / imgDims.width, maxH / imgDims.height, 1);
      const w = imgDims.width * scale;
      const h = imgDims.height * scale;
      const x = (pageWidth - w) / 2;
      const y = (pageHeight - h) / 2;
      page.drawImage(embedded, { x, y, width: w, height: h });
    }
  }

  return pdf.save();
}

// ── Compress PDF ───────────────────────────────────────────────────

/**
 * Mark every indirect object the document can actually reach from its
 * trailer, and delete the rest.
 *
 * The four trailer entries are the only entry points a conforming reader
 * has, so anything they cannot reach is dead weight: an image an editor
 * replaced, a page someone removed, a font from a revision that was
 * incrementally saved over. Those survive `load` + `save` untouched, because
 * pdf-lib rewrites every indirect object it was given without asking whether
 * anyone still points at it.
 *
 * Reachability is what makes this safe on the things a naive rebuild loses.
 * Interactive form fields and their values, the outline tree, page labels,
 * named destinations, annotations and embedded attachments all hang off the
 * catalog, so marking keeps them by construction — which is exactly why
 * compression must NOT be implemented as "copy the pages into a new
 * document": copyPages carries pages and nothing else, and would silently
 * drop all of it.
 */
function sweepUnreachableObjects(context: PDFContext): void {
  const live = new Set<string>();
  const stack: PDFObject[] = [];
  const push = (obj: PDFObject | undefined): void => {
    if (obj) stack.push(obj);
  };

  push(context.trailerInfo.Root);
  push(context.trailerInfo.Info);
  push(context.trailerInfo.Encrypt);
  push(context.trailerInfo.ID);

  while (stack.length > 0) {
    const obj = stack.pop()!;
    if (obj instanceof PDFRef) {
      // Dedupe on the ref, not the resolved object: a page tree is a cyclic
      // graph (/Parent points back up) and every dictionary shared between
      // pages would otherwise be walked once per referrer.
      if (live.has(obj.tag)) continue;
      live.add(obj.tag);
      push(context.lookup(obj));
    } else if (obj instanceof PDFStream) {
      // A stream's references all live in its dictionary; its bytes are opaque.
      push(obj.dict);
    } else if (obj instanceof PDFDict) {
      for (const value of obj.values()) push(value);
    } else if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) push(obj.get(i));
    }
  }

  // enumerateIndirectObjects returns a fresh array, so deleting from the
  // context while walking it is safe.
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!live.has(ref.tag)) context.delete(ref);
  }
}

/** Deflate to the zlib container /FlateDecode expects (RFC 1950, magic 0x78). */
async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  // Copied into a freshly allocated buffer rather than handed over directly:
  // `CompressionStream` accepts only a view onto a plain ArrayBuffer, and a
  // Uint8Array off the parser carries the wider ArrayBufferLike type (it could
  // in principle be backed by a SharedArrayBuffer).
  const input = new Uint8Array(bytes.length);
  input.set(bytes);

  const stream = new CompressionStream("deflate");
  const writer = stream.writable.getWriter();
  void writer.write(input);
  void writer.close();

  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  let size = 0;
  for (const chunk of chunks) size += chunk.length;
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Compress the streams that arrived with no filter at all.
 *
 * This is the one axis where the old MuPDF engine genuinely beat a plain
 * pdf-lib re-save, and it is worth the code: pdf-lib writes back a stream it
 * did not itself create exactly as it found it, so a document from a producer
 * that emits raw content streams — a great many of them do — was coming out
 * 0.2% smaller where MuPDF managed 83.5%. Deflating those closes the gap and
 * then some (measured 84.4% on the same file).
 *
 * Only streams with NO /Filter are touched. A stream that already declares
 * one is either compressed (re-deflating it would cost time to gain nothing)
 * or uses an encoding whose bytes we have no business reinterpreting, so it
 * is left alone. A stream whose deflate does not actually come out smaller —
 * short ones, and anything already high-entropy like an embedded JPEG's
 * samples — is left alone too, because the point is to shrink the file.
 *
 * The compressor is the platform's own `CompressionStream`, so this adds no
 * bytes to the bundle; "deflate" is the zlib-wrapped variant, which is what
 * /FlateDecode means. Where it is missing the pass simply does not run and
 * the object sweep above still stands: a smaller win, never a failure.
 */
async function deflateRawStreams(context: PDFContext): Promise<void> {
  if (typeof CompressionStream === "undefined") return;

  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (obj.dict.get(PDFName.of("Filter")) !== undefined) continue;
    /*
      A /DecodeParms with no /Filter is inert — there is no filter for it to
      parameterise, so every reader ignores it — but the moment this pass wrote
      /FlateDecode beside it, it would come alive and be applied to the deflated
      output. A leftover `<< /Predictor 12 /Columns 5 >>` (what a tool that
      stripped the filter without stripping its parameters leaves behind) then
      makes a conforming reader run PNG un-filtering over bytes that were never
      predictor-encoded: verified against pdfjs, the image does not decode at
      all and is dropped from the page. Compressing must never do that, and the
      tool's copy promises the pixels come out byte for byte identical — so a
      stream carrying stale parameters is left exactly as it was found.
    */
    if (obj.dict.get(PDFName.of("DecodeParms")) !== undefined) continue;
    if (obj.contents.length === 0) continue;

    const packed = await deflate(obj.contents);
    if (packed.length >= obj.contents.length) continue;

    obj.dict.set(PDFName.of("Filter"), PDFName.of("FlateDecode"));
    // `contents` is readonly, so the stream object is replaced rather than
    // mutated; PDFRawStream.of carries the dict across and /Length is reset
    // from the new byte count.
    obj.dict.set(PDFName.of("Length"), context.obj(packed.length));
    context.assign(ref, PDFRawStream.of(obj.dict, packed));
  }
}

/**
 * What this actually does, so the copy around it can stay true: it drops
 * every object nothing references any more, deflates the streams that came in
 * uncompressed, and rewrites the file with its objects packed into compressed
 * object streams and a cross-reference stream instead of a plain xref table.
 * It does NOT re-encode images, re-sample anything, or subset fonts — the
 * pixels and the text come out byte-identical, which is why a PDF that is
 * mostly photographs barely moves.
 *
 * Nothing here refuses to grow. A file that is already packed this way comes
 * back the same size — the two checked-in samples come back byte-identical —
 * and CompressPdfUI is the layer that compares the two sizes and hands back
 * the original when the rewrite did not pay, along with the copy that tells
 * the user that happened.
 */
export async function compressPdf(data: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const pdf = await loadDocument(data);
  sweepUnreachableObjects(pdf.context);
  await deflateRawStreams(pdf.context);
  return pdf.save({ ...SAVE_OPTIONS, useObjectStreams: true });
}

// pdfjs rendering (pdfToImages, thumbnails) lives in pdf-engine.ts — it needs
// the DOM canvas and already runs its raster math in pdfjs's own worker.
