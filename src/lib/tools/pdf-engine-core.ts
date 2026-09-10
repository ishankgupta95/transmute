import {
  PDFArray,
  PDFContentStream,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  PDFHexString,
  StandardFonts,
  beginText,
  clip,
  concatTransformationMatrix,
  degrees,
  endPath,
  endText,
  LineCapStyle,
  moveText,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  setFontAndSize,
  showText,
} from "pdf-lib";
import { readImageOrientation } from "./image-orientation";
import {
  asExifOrientation,
  displayedDownUnit,
  displayedPageSize,
  displayedSize,
  unsupportedStampCharacters,
  fractionToUserSpace,
  normaliseRotation,
  placeImageInBox,
  visiblePageBox,
} from "./pdf-stamp-core";
import type {
  PDFCheckBox,
  PDFContext,
  PDFDropdown,
  PDFField,
  PDFFont,
  PDFForm,
  PDFImage,
  PDFObject,
  PDFOptionList,
  PDFPage,
  PDFRadioGroup,
  PDFTextField,
} from "pdf-lib";

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
 *
 * Both of those capabilities are back, but as tools of their own rather than
 * as a silent fallback in here: qpdf (Apache-2.0, compiled to WebAssembly)
 * backs /repair-pdf, which rebuilds a broken cross-reference table, and
 * /unlock-pdf, which decrypts with a password the user supplies. This module
 * still does neither — it is pdf-lib and nothing else — so the two messages in
 * `loadDocument` name the tool that can instead of dead-ending the user in
 * some other program.
 */

function toUint8Array(buf: ArrayBuffer | Uint8Array): Uint8Array {
  return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
}

// ── Loading ────────────────────────────────────────────────────────

/*
  The two sentences a user reads when a PDF will not open. Copied VERBATIM into
  pdf-image-core.ts and pdf-engine.ts (the pdfjs side) — a protected document
  must say the same thing whichever PDF tool it was dropped on. All three are
  hand-synced; if you change one, change all three.

  Both name a tool that exists and say what it actually does. /unlock-pdf runs
  qpdf's `--password=… --decrypt`, so it removes a password the user knows and
  it clears an owner-password restriction without one — it does not crack
  anything. /repair-pdf runs qpdf's plain copy, which rebuilds the
  cross-reference table; on a file that is not a PDF at all it fails too, hence
  the fallback advice.
*/
const PASSWORD_MESSAGE =
  "This PDF is password-protected. Run it through Unlock PDF (/unlock-pdf) first — that removes a password you know, or clears an owner-password restriction without one. It cannot crack a password you don't have.";

const DAMAGED_MESSAGE =
  "This PDF could not be read — the file is damaged or is not a PDF. If it really is a PDF, try Repair PDF (/repair-pdf), which rebuilds a broken cross-reference table. If that fails too, re-export it from the program that produced it.";

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
 * Resolve a destination to the page object it lands on, if it names one by
 * reference.
 *
 * A destination is either an explicit array whose FIRST element is the target
 * page — `[pageRef /Fit]`, `[pageRef /XYZ left top zoom]` (PDF 32000-1 12.3.2.2)
 * — or a name/string standing for one of those arrays in the document's
 * destination table. Both spellings are accepted here, and the array itself may
 * be reached through an indirect reference.
 *
 * `undefined` means "this destination names no page in this document": either
 * it is a page NUMBER (legal only for a remote /GoToR, where the number indexes
 * the OTHER file), or it is a name that this document's tables cannot resolve.
 * Neither can hold a page object alive, so neither is disturbed.
 */
function destinationPage(doc: PDFDocument, dest: PDFObject | undefined): PDFRef | undefined {
  let target = dest instanceof PDFRef ? doc.context.lookup(dest) : dest;

  if (target instanceof PDFName || target instanceof PDFString || target instanceof PDFHexString) {
    const key = target instanceof PDFName ? target.asString().slice(1) : target.asString();
    target = lookupNamedDestination(doc, key);
    if (target instanceof PDFDict) target = target.lookup(PDFName.of("D"));
  }

  if (!(target instanceof PDFArray) || target.size() === 0) return undefined;
  const first = target.get(0);
  return first instanceof PDFRef ? first : undefined;
}

/**
 * Look a named destination up in the two tables PDF 32000-1 12.3.2.3 defines:
 * the catalog's `/Dests` dictionary (the PDF 1.1 spelling) and the `/Dests`
 * name tree under `/Names` (the 1.2-and-later one, which may be split across
 * `/Kids`).
 *
 * `createGraftTarget` builds a fresh document and neither table is carried
 * across, so on today's graft outputs this returns undefined for every name —
 * which is exactly why a NAMED destination cannot keep a dropped page alive
 * the way an explicit one can: a name is a direct object, so pdf-lib's copier
 * has no reference to follow. The walk is here so the check stays correct if a
 * later change does start carrying /Names over.
 */
function lookupNamedDestination(doc: PDFDocument, key: string): PDFObject | undefined {
  const dests = doc.catalog.lookup(PDFName.of("Dests"));
  if (dests instanceof PDFDict) {
    const hit = dests.lookup(PDFName.of(key));
    if (hit) return hit;
  }

  const names = doc.catalog.lookup(PDFName.of("Names"));
  const tree = names instanceof PDFDict ? names.lookup(PDFName.of("Dests")) : undefined;
  return tree instanceof PDFDict ? walkNameTree(tree, key, 0) : undefined;
}

/**
 * One level of a name tree, and its /Kids. The depth cap is a cycle guard: a
 * /Kids entry pointing back at an ancestor is malformed but costs nothing to
 * survive, and this runs on files the user chose, not on files we produced.
 */
function walkNameTree(node: PDFDict, key: string, depth: number): PDFObject | undefined {
  if (depth > 32) return undefined;

  const names = node.lookup(PDFName.of("Names"));
  if (names instanceof PDFArray) {
    for (let i = 0; i + 1 < names.size(); i += 2) {
      const name = names.lookup(i);
      const asString =
        name instanceof PDFString || name instanceof PDFHexString ? name.asString() : undefined;
      if (asString === key) return names.lookup(i + 1);
    }
  }

  const kids = node.lookup(PDFName.of("Kids"));
  if (kids instanceof PDFArray) {
    for (let i = 0; i < kids.size(); i++) {
      const kid = kids.lookup(i);
      if (!(kid instanceof PDFDict)) continue;
      const hit = walkNameTree(kid, key, depth + 1);
      if (hit) return hit;
    }
  }
  return undefined;
}

/**
 * One `copyPages` call's worth of provenance: which source page each output
 * page came from. `pages[k]` is the copy of `src`'s page number `indices[k]`.
 */
interface GraftedPages {
  src: PDFDocument;
  indices: number[];
  pages: PDFPage[];
}

/**
 * Send one copied destination to the page it should now land on, or say it has
 * nowhere left to go.
 *
 * The redirection has to be worked out in the SOURCE document, because the
 * output alone cannot answer it. `PDFObjectCopier.copyPDFPage` clones the leaf
 * BEFORE consulting `traversedObjects`, so the copy `copyPages` registers in
 * the page tree is never memoised against the original; a destination arriving
 * at the same page through `copyPDFIndirectObject` therefore produces a SECOND,
 * separate copy under a different ref. In the output the two are indistinguishable
 * strangers. In the source they are one page.
 */
function retargetDestination(
  src: PDFDocument,
  out: PDFDocument,
  srcDest: PDFObject | undefined,
  outDest: PDFObject | undefined,
  mapped: Map<string, PDFRef>,
): "keep" | "drop" {
  const target = destinationPage(src, srcDest);
  // Names no page of this document — a /GoToR page number, or a name no
  // destination table resolves. It cannot hold a page object alive either way.
  if (!target) return "keep";

  const replacement = mapped.get(target.tag);
  if (!replacement) return "drop";

  // A named destination that DOES resolve in the source still arrives in the
  // output as a bare name, and the graft carries no name table for it to
  // resolve against, so there is no array here to repoint.
  const array = outDest instanceof PDFRef ? out.context.lookup(outDest) : outDest;
  if (array instanceof PDFArray && array.size() > 0 && array.get(0) instanceof PDFRef) {
    array.set(0, replacement);
  }
  return "keep";
}

/**
 * Repoint every page reference a copied annotation carries at the page it now
 * means, cut the links whose page did not survive, then drop what that leaves
 * unreferenced.
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
 * /P is NOT the only edge from an annotation to a page, and the second one is
 * worse than a validator complaint. A /Link's DESTINATION — `/Dest [pageRef
 * /Fit]` on the annotation, or `/A << /S /GoTo /D [pageRef /XYZ …] >>`, the
 * ordinary shape Word, InDesign and Acrobat emit for a cross-reference — is an
 * indirect reference to a page too, and `PDFObjectCopier.copyPDFIndirectObject`
 * follows every reference inside a copied annotation with no key filter. Two
 * things followed from that, both measured against the shipped build:
 *
 * - `deletePdfPages` removed nothing. A 4-page report whose page 1 linked to
 *   page 4 and whose page 2 linked to page 3 came back from
 *   `deletePdfPages(src, [2, 3])` reporting 2 pages while still holding 4
 *   `/Type /Page` objects, the dropped pages' content streams intact and
 *   inflatable — the orphans stayed reachable from the catalog (Root → Pages →
 *   kept page → /Annots → link → /Dest → orphan page), so the sweep below
 *   correctly declined to collect them. At 100 pages with a table of contents
 *   linking to all of them, deleting 99 returned a file the size of the source.
 *   The same 4-page fixture now yields 2 page objects and 997 bytes instead of
 *   4 and 1452, with the dropped pages' text gone from every stream.
 * - EVERY internal link landed on page 1. Because the destination's copy of the
 *   page is a different object from the one in the tree, no reader can locate
 *   it: asked through pdfjs, both links in a merged, reordered, extracted or
 *   page-deleted output resolved to page index 0 instead of 4 and 3. They now
 *   resolve to the pages they name, and a link whose page was dropped is
 *   removed rather than silently pointing at the first page.
 *
 * The action is dropped whole rather than emptied, because a /GoTo with no /D
 * is malformed and a link into a page this document does not contain has
 * nothing left to mean.
 *
 * The output and source annotation arrays are walked in lockstep because
 * `copyPDFArray` clones index by index, so entry j of the copy is entry j of
 * the original. If a document ever breaks that assumption the lockstep is
 * skipped and only /P is repaired — the pre-existing behaviour, not a throw.
 */
function fixAnnotationPageRefs(out: PDFDocument, grafts: GraftedPages[]): void {
  /*
    `getPages()` walks the page tree on every call, and splitPdfToPages runs
    this helper once per output file, so the source's page list is resolved
    once per graft rather than once per pass.

    The source-page → output-page map is PER GRAFT, and that is load-bearing
    rather than tidiness. `PDFRef.tag` is "objectNumber generationNumber",
    which is unique only WITHIN one document. `mergePdfs` hands this helper one
    graft per input file, and two PDFs out of the same producer routinely
    number their page objects identically — so a single shared map lets the
    later file's entry overwrite the earlier file's, and the earlier file's
    internal link is then repointed into the later file's pages. Measured
    through pdfjs while verifying the destination fix: merging a 3-page file
    (page refs 5/7/9, link p1 → p3) into a 7-page file (refs 5/7/9/11/13/15/17,
    link p1 → p7) sent the FIRST file's link to merged page 6 — the second
    file's page 3 — and merging two identical 4-page files sent file A's link
    to page 8 instead of page 4. A 4-page + 2-page merge, whose tags do not
    collide, was correct, which is exactly what makes the shared map look fine
    in casual testing.

    Per graft is also the semantically correct scope: a destination stored in
    file A can only ever name a page in file A, so it must never resolve
    against another input's page table.
  */
  const resolved = grafts.map((graft) => {
    const srcPages = graft.src.getPages();
    const mapped = new Map<string, PDFRef>();
    for (let k = 0; k < graft.pages.length; k++) {
      const from = srcPages[graft.indices[k]];
      if (from) mapped.set(from.ref.tag, graft.pages[k].ref);
    }
    return { graft, srcPages, mapped };
  });

  const live = new Set(out.getPages().map((p) => p.ref.tag));

  for (const { graft, srcPages, mapped } of resolved) {
    for (let k = 0; k < graft.pages.length; k++) {
      const outPage = graft.pages[k];
      const srcPage = srcPages[graft.indices[k]];
      const outAnnots = outPage.node.Annots();
      if (!outAnnots) continue;
      const srcAnnots = srcPage?.node.Annots();

      for (let i = 0; i < outAnnots.size(); i++) {
        const annot = out.context.lookup(outAnnots.get(i));
        if (!(annot instanceof PDFDict)) continue;

        if (annot.get(PDFName.of("P")) !== undefined) {
          annot.set(PDFName.of("P"), outPage.ref);
        }

        const source = srcAnnots && i < srcAnnots.size() ? srcAnnots.lookup(i) : undefined;
        if (!(source instanceof PDFDict)) continue;

        const verdict = retargetDestination(
          graft.src,
          out,
          source.get(PDFName.of("Dest")),
          annot.get(PDFName.of("Dest")),
          mapped,
        );
        if (verdict === "drop") annot.delete(PDFName.of("Dest"));

        const srcAction = source.lookup(PDFName.of("A"));
        const outAction = annot.lookup(PDFName.of("A"));
        if (
          srcAction instanceof PDFDict &&
          outAction instanceof PDFDict &&
          srcAction.get(PDFName.of("S")) === PDFName.of("GoTo")
        ) {
          const action = retargetDestination(
            graft.src,
            out,
            srcAction.get(PDFName.of("D")),
            outAction.get(PDFName.of("D")),
            mapped,
          );
          if (action === "drop") annot.delete(PDFName.of("A"));
        }
      }
    }
  }

  /*
    The catch-all for every OTHER way a copied annotation reaches a page.

    The loop above only sees annotations that are in an output page's /Annots
    array, and a link destination is not the only edge that escapes it.
    Measured: a form field whose /Kids hold one widget per page — the ordinary
    shape of a field repeated across a document — kept its widget on the
    DROPPED page alive through the surviving widget's /Parent, and that
    widget's own /P then held the dropped page and its content stream in the
    file. `deletePdfPages` on a 2-page fixture returned 1 page and 2 page
    objects, with the removed page's text still inflatable.

    /P is defined (PDF 32000-1 12.5.2) as "the page object with which this
    annotation is associated". One naming a page that is not in this document's
    page tree is therefore already meaningless — no reader can resolve it — so
    dropping the key costs nothing and frees the page. It is an optional entry;
    removing it does not invalidate the annotation.

    The shape test is deliberately narrow. /P means something else entirely on
    a structure element (there it is the PARENT element), so only
    annotation-shaped dictionaries — /Type /Annot, or a /Subtype together with
    the /Rect every annotation is required to carry — are touched.
  */
  for (const [, obj] of out.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const parentPage = obj.get(PDFName.of("P"));
    if (!(parentPage instanceof PDFRef) || live.has(parentPage.tag)) continue;
    const annotShaped =
      obj.get(PDFName.of("Type")) === PDFName.of("Annot") ||
      (obj.get(PDFName.of("Subtype")) !== undefined && obj.get(PDFName.of("Rect")) !== undefined);
    if (annotShaped) obj.delete(PDFName.of("P"));
  }

  sweepUnreachableObjects(out.context);
}

// ── Merge ──────────────────────────────────────────────────────────

export async function mergePdfs(buffers: ArrayBuffer[]): Promise<Uint8Array> {
  const out = await createGraftTarget();

  const grafts: GraftedPages[] = [];
  let infoCopied = false;
  for (const buf of buffers) {
    const src = await loadDocument(buf);
    const indices = src.getPageIndices();
    const pages = await out.copyPages(src, indices);
    for (const page of pages) out.addPage(page);
    grafts.push({ src, indices, pages });
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

  fixAnnotationPageRefs(out, grafts);
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

  fixAnnotationPageRefs(out, [{ src, indices: pageIndices, pages }]);
  return out.save(SAVE_OPTIONS);
}

/**
 * Graft `pageIndices` out of an ALREADY-LOADED source into a new document.
 *
 * Split-into-N and delete-pages both produce documents by copying a subset of
 * pages, and both have to do the same four things in the same order to be
 * correct: copy, carry the /Info the graft leaves behind, repoint annotation
 * /P at the pages that are actually in the new tree (see
 * `fixAnnotationPageRefs`), and save without letting pdf-lib invent a blank
 * page for an empty result.
 *
 * Taking the loaded `PDFDocument` rather than bytes is the point for
 * `splitPdfToPages`: a 300-page document split into 300 files parses ONCE and
 * then does 300 cheap grafts, instead of re-parsing the whole object graph per
 * output. Bookmarks are not carried, for the reason `copyDocInfo` explains.
 */
async function graftPages(src: PDFDocument, pageIndices: number[]): Promise<Uint8Array> {
  const out = await createGraftTarget();
  const pages = await out.copyPages(src, pageIndices);
  for (const page of pages) out.addPage(page);
  copyDocInfo(src, out);

  fixAnnotationPageRefs(out, [{ src, indices: pageIndices, pages }]);
  return out.save(SAVE_OPTIONS);
}

/**
 * One single-page PDF per selected page, in the order given.
 *
 * Out-of-range indices are SKIPPED rather than thrown on, the way
 * `rotatePdfPages` skips them: pdf-lib's `copyPages` has no bounds check at
 * all (PDFDocument.js:651 indexes the page array directly), so a stale index
 * from a UI that still holds the previous file's page count reaches
 * `PDFPageLeaf` as `undefined` and comes back out as a raw TypeError. A
 * selection that names nothing this document has yields no files, which is the
 * same shape as `splitPdf(data, [])` returning a zero-page document.
 */
export async function splitPdfToPages(
  data: ArrayBuffer | Uint8Array,
  pageIndices: number[],
): Promise<Uint8Array[]> {
  const src = await loadDocument(data);
  const count = src.getPageCount();

  const outputs: Uint8Array[] = [];
  for (const idx of pageIndices) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= count) continue;
    outputs.push(await graftPages(src, [idx]));
  }
  return outputs;
}

/**
 * Every page EXCEPT the given 0-based indices.
 *
 * The complement is computed here, from `src.getPageIndices()`, and never
 * passed in: the set of pages that survive is a fact about the document that
 * was actually opened, and deriving it from a page count the caller is holding
 * turns any staleness (a second file dropped on the same UI, a re-render that
 * lost a selection) into silently deleting the wrong pages.
 *
 * Deleting every page produces a genuine zero-page PDF rather than a blank
 * sheet — the same deliberate behaviour `splitPdf(data, [])` has. The UI is
 * the layer that refuses to let a user ask for that.
 */
export async function deletePdfPages(
  data: ArrayBuffer | Uint8Array,
  pageIndices: number[],
): Promise<Uint8Array> {
  const src = await loadDocument(data);
  const drop = new Set(pageIndices);
  const keep = src.getPageIndices().filter((i) => !drop.has(i));
  return graftPages(src, keep);
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

/**
 * The quarter turn a READER actually applies to the page.
 *
 * `normaliseQuarterTurn` above snaps to the nearest legal value because
 * `rotatePdfPages` has to WRITE one and pdf-lib rejects anything else. Every
 * other consumer only READS the angle, to work out which frame the user was
 * looking at — and for that, rounding is exactly the wrong rule, because pdfjs
 * does the opposite. Measured in the renderer this app itself ships
 * (node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs, `get rotate()`):
 *
 *     let rotate = Rotate || 0;
 *     if (rotate % 90 !== 0) rotate = 0;
 *     else if (rotate >= 360) rotate %= 360;
 *     else if (rotate < 0) rotate = (rotate % 360 + 360) % 360;
 *
 * A page carrying `/Rotate 45` or `/Rotate 100` — spec-illegal, but some
 * generators write the degree value verbatim — therefore renders UNROTATED
 * everywhere in this app: the page-picker thumbnails, CropPdfUI's crop frame
 * (CropPdfUI.tsx takes `page.getViewport({scale:1})` as the frame the rect is
 * expressed in) and ChangePdfPageSizeUI's "current size" probe. Rounding 45 up
 * to 90 put the engine in a frame no viewer showed: asking for A4 PORTRAIT on
 * such a page produced a 842 × 595 LANDSCAPE sheet, and cropping the visual
 * top-left quadrant returned a 100 × 200 page holding the BOTTOM-left region.
 * Neither op writes /Rotate back, so the disagreement survived into the file.
 *
 * This is the same convention `visiblePageRect` already follows: where pdfjs
 * and pdf-lib disagree about a malformed box, the engine matches the renderer.
 */
function displayedQuarterTurn(angle: number): number {
  if (!Number.isFinite(angle) || angle % 90 !== 0) return 0;
  return ((angle % 360) + 360) % 360;
}

/**
 * What pdfjs falls back to when it cannot read a /MediaBox — its
 * `LETTER_SIZE_MEDIABOX`. See `visiblePageRect` for why the engine copies it
 * rather than throwing pdf-lib's parser internals at the user.
 */
const LETTER_MEDIA_FALLBACK = { x: 0, y: 0, width: 612, height: 792 } as const;

/**
 * The rectangle a viewer actually shows: intersect(CropBox, MediaBox).
 *
 * A PDF page has five boxes and only ONE of them describes what ends up on
 * screen. PDF 32000-1 14.11.2 makes the CropBox the visible region and
 * requires it to be clipped to the MediaBox, and pdfjs implements exactly that
 * — its `PDFPageProxy.view` is `Util.intersect(cropBox, mediaBox)`, which is
 * what sizes the canvas and positions every rendered mark. So anything that
 * places content "on the page" has to work in this rectangle, not in the
 * MediaBox: a scanned document whose producer parked a 100pt margin in the
 * CropBox has a MediaBox that is real in the file and invisible in the reader.
 *
 * Four deliberate pieces of defensiveness, each for a shape that exists in
 * the wild:
 *
 * - `getCropBox()` is wrapped in try/catch. pdf-lib's `asRectangle()` THROWS
 *   `PDFArrayIsNotRectangleError` on a /CropBox whose array is not exactly
 *   four numbers (node_modules/pdf-lib/cjs/core/objects/PDFArray.js:55), where
 *   pdfjs merely warns and falls back to the MediaBox. A malformed box must
 *   cost the user a slightly wrong stamp position, not the whole operation.
 * - `getMediaBox()` is wrapped for the SAME reason, and it was not. That gap
 *   was measured, not theorised: `/MediaBox [0 0 612 null]` made crop, resize
 *   and add-page-numbers all die with "Expected instance of PDFNumber2, but
 *   got instance of PDFNull2" (pdf-lib's assertion interpolates its MINIFIED
 *   class name), a 3-element box died with "Attempted to convert PDFArray with
 *   3 elements to rectangle…", and an absent box — `MediaBox()` is a `lookup`,
 *   not a `lookupMaybe` — died on the bare `.asRectangle()` of undefined. All
 *   three strings reached the user verbatim: pdf.worker.ts forwards
 *   `err.message` and the UIs `setError` it straight into <ErrorMessage>.
 *   Meanwhile this repo's own pdfjs opens every one of those files and reports
 *   `view=[0,0,612,792]`, so the thumbnails and the size probe come up
 *   normally and only the run fails. The fallback below is pdfjs's own
 *   (`LETTER_SIZE_MEDIABOX`), so the three ops now agree with the renderer the
 *   app ships instead of refusing a file it displays.
 * - Both rectangles are normalised. Reversed-corner boxes are legal (see
 *   `normaliseRect`) and pdf-lib reports the raw numbers, so an un-normalised
 *   intersection of two legal boxes can come out empty.
 * - A non-positive intersection falls back to the media rect. A CropBox
 *   disjoint from the MediaBox is malformed, and an empty visible rect would
 *   make every downstream division by width/height produce NaN.
 *
 * Nothing changes for the overwhelmingly common file with no /CropBox at all:
 * pdf-lib's `getCropBox()` already falls back to the MediaBox and already
 * walks /Parent for an inherited one, so the intersection is the media rect
 * with itself.
 */
function visiblePageRect(page: PDFPage): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  let media: { x: number; y: number; width: number; height: number };
  try {
    media = normaliseRect(page.getMediaBox());
  } catch {
    media = { ...LETTER_MEDIA_FALLBACK };
  }

  let crop: { x: number; y: number; width: number; height: number };
  try {
    crop = normaliseRect(page.getCropBox());
  } catch {
    return media;
  }

  const x = Math.max(media.x, crop.x);
  const y = Math.max(media.y, crop.y);
  const width = Math.min(media.x + media.width, crop.x + crop.width) - x;
  const height = Math.min(media.y + media.height, crop.y + crop.height) - y;
  if (width <= 0 || height <= 0) return media;

  return { x, y, width, height };
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

  fixAnnotationPageRefs(out, [{ src, indices: newOrder, pages }]);
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
      The frame the number is placed in is the VISIBLE page rectangle —
      intersect(CropBox, MediaBox), see `visiblePageRect` — with /Rotate then
      applied on top of it. Two separate corrections, and the port got the
      first one wrong for a year:

      1. NOT the MediaBox. `getMediaBox()` reports the sheet, and a page whose
         producer set a CropBox shows only part of that sheet. Measured on
         MediaBox [0 0 842 1191] + CropBox [100 100 742 1091]: bottom-center
         stamped at (418.22, 20), which the repo's own pdfjs renders at canvas
         y = 1071 on a 991px-tall canvas — 80 points below the bottom of the
         visible page, i.e. all six positions missed. MuPDF's getBounds()
         returned the CROP box, so this was a regression introduced by the
         pdf-lib port and not a behaviour anyone chose.
      2. NOT rotated. getSize(), getMediaBox() and getCropBox() all report
         UNROTATED coordinates, so the visual frame has to be derived here: a
         quarter turn swaps the two dimensions, a half turn leaves them alone.
    */
    const rot = displayedQuarterTurn(page.getRotation().angle);
    const box = visiblePageRect(page);
    const visualWidth = rot % 180 === 0 ? box.width : box.height;
    const visualHeight = rot % 180 === 0 ? box.height : box.width;

    const isTop = position.startsWith("top");
    const y = isTop ? box.y + visualHeight - 30 : box.y + 20;
    let x: number;
    if (position.endsWith("left")) {
      x = box.x + 40;
    } else if (position.endsWith("right")) {
      x = box.x + visualWidth - 40 - textWidth;
    } else {
      x = box.x + (visualWidth - textWidth) / 2;
    }

    /*
      The number is placed in the visual frame above, but the operators below
      are appended to the page's own content stream, which is UNROTATED space
      — pdf-lib draws there exactly as the raw MuPDF stream did. So the stamp
      needs the inverse of the display rotation. Without it a number on a
      /Rotate 90 A4 page was centred on 842 inside a 595-wide media box and
      drawn sideways off the edge.

      /Rotate R displays the page turned R clockwise, so content = inverse of
      display: R=90 maps visual (X,Y) to (w−Y, X), inverted as [0 1 −1 0 w 0].
      w and h in those matrices are the UNROTATED dimensions of the VISIBLE
      rect, which is the one place the pdf-lib port gets to be simpler than the
      MuPDF one: the old code had to swap them back out of the visual rect, and
      the box getters hand them over already unrotated.

      Substituting the visible rect for the media box needs no new derivation:
      with visible rect C the visual frame's origin is C's rotated lower-left,
      so content = (C.x + C.width − Y, C.y + X) — the SAME matrix with C's
      origin and extent in place of the media box's. The translation components
      carry that origin because the matrix works in a box starting at (0,0) and
      the visual coordinates fed through it have had the origin removed (see
      tx/ty). An unrotated page skips the matrix entirely and keeps the raw
      coordinates, which are already content space.
    */
    const w = box.width;
    const h = box.height;
    const cm: [number, number, number, number, number, number] | null =
      rot === 90
        ? [0, 1, -1, 0, box.x + w, box.y]
        : rot === 180
          ? [-1, 0, 0, -1, box.x + w, box.y + h]
          : rot === 270
            ? [0, -1, 1, 0, box.x, box.y + h]
            : null;
    const tx = cm ? x - box.x : x;
    const ty = cm ? y - box.y : y;

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

// ── Page boxes: crop and resize ────────────────────────────────────

/** A crop rectangle in VISUAL page space (PDF points, origin at the visible page's lower-left). */
export interface PdfCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Turn a rectangle given in VISUAL page space into the page's own unrotated
 * content space.
 *
 * This is the same inversion `addPageNumbers` applies to a single point,
 * written out for a rectangle. /Rotate R displays the page turned R clockwise,
 * so with visible rect V the visual point (X, Y) lives at content:
 *
 *   R=0    (V.x + X,                 V.y + Y)
 *   R=90   (V.x + V.width − Y,       V.y + X)
 *   R=180  (V.x + V.width − X,       V.y + V.height − Y)
 *   R=270  (V.x + Y,                 V.y + V.height − X)
 *
 * — exactly the four `cm` matrices in `addPageNumbers`, read as maps instead of
 * as operators. Pushing both corners of the rectangle through each and taking
 * the min/max gives the table below. Note the quarter turns SWAP the extents:
 * a visual rect that is wide on a /Rotate 90 page is a tall rect in content
 * space, which is why `width: rect.height` is not a typo.
 *
 * The 90 and 270 rows are mirror images of each other and are the easy pair to
 * get backwards; both were verified by rendering the cropped output through
 * this repo's pdfjs and checking which corner of the visible page a marker
 * drawn at a known content position came out in.
 */
function visualRectToContent(
  visible: { x: number; y: number; width: number; height: number },
  rotation: number,
  rect: PdfCropRect,
): { x: number; y: number; width: number; height: number } {
  const { x: rx, y: ry, width: rw, height: rh } = rect;
  switch (rotation) {
    case 90:
      return {
        x: visible.x + visible.width - ry - rh,
        y: visible.y + rx,
        width: rh,
        height: rw,
      };
    case 180:
      return {
        x: visible.x + visible.width - rx - rw,
        y: visible.y + visible.height - ry - rh,
        width: rw,
        height: rh,
      };
    case 270:
      return {
        x: visible.x + ry,
        y: visible.y + visible.height - rx - rw,
        width: rh,
        height: rw,
      };
    default:
      return { x: visible.x + rx, y: visible.y + ry, width: rw, height: rh };
  }
}

/** The overlap of two normalised rectangles, or null if they do not overlap. */
function intersectRect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

/**
 * Bring BleedBox / TrimBox / ArtBox into line with `box`, but only where the
 * page actually declares them.
 *
 * These three describe production intent — where the printer trims, where the
 * finished artwork sits — and PDF 32000-1 14.11.2 requires each to lie inside
 * the CropBox. A trim box still describing the ORIGINAL sheet on a page whose
 * media and crop boxes just moved is a file that fails preflight and confuses
 * imposition software. But a page that never had one does not acquire one
 * here: inventing a trim box is inventing production intent the document never
 * expressed.
 *
 * `always` distinguishes the two callers. Cropping only narrows the visible
 * region, so an auxiliary box that still fits inside the crop keeps its own
 * meaning and is left alone. Resizing moves and rescales everything, which
 * leaves those coordinates describing nothing at all — `scaleAnnotations` does
 * not touch page boxes — so they are reset outright rather than kept because
 * they happen to land inside the new sheet.
 *
 * `asRectangle()` is wrapped for the reason `visiblePageRect` explains: a box
 * array that is not four numbers throws rather than being ignored, and a
 * malformed decorative box must not cost the user the operation.
 */
function alignAuxiliaryBoxes(
  page: PDFPage,
  box: { x: number; y: number; width: number; height: number },
  always = false,
): void {
  const setters = [
    [page.node.BleedBox(), (r: typeof box) => page.setBleedBox(r.x, r.y, r.width, r.height)],
    [page.node.TrimBox(), (r: typeof box) => page.setTrimBox(r.x, r.y, r.width, r.height)],
    [page.node.ArtBox(), (r: typeof box) => page.setArtBox(r.x, r.y, r.width, r.height)],
  ] as const;

  for (const [existing, set] of setters) {
    if (!existing) continue;
    if (always) {
      set(box);
      continue;
    }
    let current: { x: number; y: number; width: number; height: number };
    try {
      current = normaliseRect(existing.asRectangle());
    } catch {
      set(box);
      continue;
    }
    const contained =
      current.x >= box.x &&
      current.y >= box.y &&
      current.x + current.width <= box.x + box.width &&
      current.y + current.height <= box.y + box.height;
    if (!contained) set(box);
  }
}

/**
 * Crop pages to `rect`, given in visual page space.
 *
 * Two things this deliberately does NOT do:
 *
 * - It does not scale or move content. A PDF's content coordinates are
 *   absolute, so declaring the visible box to be [50 50 550 700] shows exactly
 *   the content already living in that region; a transformation matrix here
 *   would move the content out from under the box.
 * - It does not delete anything. The marks outside the crop are still in the
 *   file and any tool that widens the boxes back out gets them back. That is
 *   the honest difference between cropping and redaction, and the tool's copy
 *   has to say so.
 *
 * BOTH CropBox and MediaBox are set, to the same rectangle. Setting only the
 * CropBox leaves a MediaBox that some print and imposition paths still honour;
 * setting only the MediaBox is a silent no-op in every viewer whose CropBox is
 * smaller, because what gets displayed is the intersection of the two (proven
 * against this repo's pdfjs — see `visiblePageRect`).
 *
 * The result is clamped to the page's own visible rect, so an oversized or
 * out-of-bounds request cannot produce an empty or inverted box; a page whose
 * clamp leaves nothing is left completely untouched rather than being reduced
 * to a degenerate sheet. /Rotate is left alone: the crop is expressed in the
 * frame the user was looking at, and re-deriving a rotation from it would
 * change what they saw.
 */
export async function cropPdfPages(
  data: ArrayBuffer | Uint8Array,
  rect: PdfCropRect,
  pageIndices?: number[],
): Promise<Uint8Array> {
  const doc = await loadDocument(data);
  const pages = doc.getPages();
  const targets = pageIndices ?? pages.map((_, i) => i);

  for (const idx of targets) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= pages.length) continue;
    const page = pages[idx];

    const visible = visiblePageRect(page);
    const rot = displayedQuarterTurn(page.getRotation().angle);
    const wanted = normaliseRect(visualRectToContent(visible, rot, rect));
    const box = intersectRect(wanted, visible);
    if (!box) continue;

    page.setCropBox(box.x, box.y, box.width, box.height);
    page.setMediaBox(box.x, box.y, box.width, box.height);
    alignAuxiliaryBoxes(page, box);
  }

  return doc.save(SAVE_OPTIONS);
}

/*
  The named page-size table is defined in workers/pdf-protocol.ts and only
  re-exported here. It has to be reachable from a UI without dragging pdf-lib
  into the eager bundle — read the comment on PDF_PAGE_SIZES there for the
  measurement — and this file is the heaviest module in the app.
*/
export { PDF_PAGE_SIZES } from "@/lib/workers/pdf-protocol";
export type { PdfPageSizeName } from "@/lib/workers/pdf-protocol";

/**
 * Give the annotations the SAME affine the content just got.
 *
 * pdf-lib's `page.scaleAnnotations(s, s)` (PDFPage.js:520 → `scaleAnnot`)
 * multiplies /RD /CL /Vertices /QuadPoints /L /Rect and each /InkList row by
 * `s` about content space's ORIGIN — `PDFArray.scalePDFNumbers`, a pure
 * multiply with no translation term anywhere. The content stream, meanwhile,
 * gets `cm s 0 0 s ex ey`. The annotation therefore landed short by exactly
 * (ex, ey), and ex/ey are non-zero whenever the source and target aspect
 * ratios differ — i.e. on almost every named-size conversion the tool offers,
 * on a pristine zero-origin page, not only on the "cropped or offset" pages
 * the old comment here blamed.
 *
 * Measured against real output — a /Link whose /Rect exactly covered a drawn
 * 200 × 40 button, with the offset between the two read back through this
 * repo's own pdfjs: A4 → Letter drifted 26.00 pt horizontally; Letter → A4
 * drifted 35.76 pt vertically, more than the scaled hotspot's own 38.9 pt
 * height, so the link no longer overlapped the thing it linked and 36 pt of
 * blank paper below it was clickable; Letter → Legal 108.00 pt; Letter → A4
 * LANDSCAPE 190.95 pt; Legal → Tabloid LANDSCAPE 371.57 pt (131 mm). Only the
 * ratio-preserving resizes were clean (A4 → A5, 0.98 pt). Every one of those
 * measures 0.00 pt now, at all four /Rotate values and on a non-zero-origin
 * page.
 *
 * The key split is between COORDINATE PAIRS and DIFFERENCES:
 *
 * - /Rect, /QuadPoints, /Vertices, /L and each /InkList row are sequences of
 *   (x, y) POINTS, so they take the full affine.
 * - /RD (PDF 32000-1 12.5.6.10) is four margin widths — the inset of the
 *   annotation's real geometry from its /Rect — and /CL's numbers are points
 *   but relative to nothing that moves, so both take the scale only. Adding
 *   ex/ey to a margin would move the inset by the whole centring offset.
 *
 * Reversed /Rect corners stay reversed and normalised /Rect corners stay
 * normalised, because the scale is positive and identical on both axes.
 */
function transformAnnotations(page: PDFPage, scale: number, ex: number, ey: number): void {
  const annots = page.node.Annots();
  if (!annots) return;

  const mapPairs = (list: PDFArray) => {
    for (let i = 0; i + 1 < list.size(); i += 2) {
      const x = list.lookup(i);
      const y = list.lookup(i + 1);
      if (!(x instanceof PDFNumber) || !(y instanceof PDFNumber)) continue;
      list.set(i, PDFNumber.of(scale * x.asNumber() + ex));
      list.set(i + 1, PDFNumber.of(scale * y.asNumber() + ey));
    }
  };
  const mapScalars = (list: PDFArray) => {
    for (let i = 0; i < list.size(); i++) {
      const n = list.lookup(i);
      if (n instanceof PDFNumber) list.set(i, PDFNumber.of(scale * n.asNumber()));
    }
  };

  for (let i = 0; i < annots.size(); i++) {
    const annot = page.node.context.lookup(annots.get(i));
    if (!(annot instanceof PDFDict)) continue;

    for (const key of ["Rect", "QuadPoints", "Vertices", "L"]) {
      const list = annot.lookup(PDFName.of(key));
      if (list instanceof PDFArray) mapPairs(list);
    }
    for (const key of ["RD", "CL"]) {
      const list = annot.lookup(PDFName.of(key));
      if (list instanceof PDFArray) mapScalars(list);
    }
    const inkLists = annot.lookup(PDFName.of("InkList"));
    if (inkLists instanceof PDFArray) {
      for (let j = 0; j < inkLists.size(); j++) {
        const row = inkLists.lookup(j);
        if (row instanceof PDFArray) mapPairs(row);
      }
    }
  }
}

/**
 * Where the new sheet's lower-left corner goes in box-only mode.
 *
 * The content is not touched at all here, so the box IS the whole operation.
 * Writing it at (0, 0) anchors it to the content-space origin, which is
 * neither the visible page's corner nor any fixed VISUAL corner. Two measured
 * consequences: a page with MediaBox [50 70 450 670] and a mark 10 pt in from
 * its visible corner came out 60 pt / 80 pt in from the resized sheet's corner
 * — content the on-screen copy promises is "not rescaled or moved" moved by
 * exactly the media origin — and, worse, WHICH visual edge a smaller sheet
 * eats depended on /Rotate: shrinking a 400 × 600 page to 400 × 300 cut the
 * visual TOP half at /Rotate 0 and the visual BOTTOM half at /Rotate 180, from
 * the same input and the same request. The tool's preview anchors its source
 * rectangle bottom-left and the copy says the sheet is drawn from the
 * bottom-left of what you see, so that is what this computes.
 *
 * The four rows invert `visualRectToContent` for the visual rect
 * [0, 0, options.width, options.height] — the same table, and the 90/270 pair
 * is the one that is easy to get backwards: on a /Rotate 90 page the visual
 * bottom-left corner is the content RIGHT edge, so the box hangs off
 * `src.x + src.width`, not off `src.x`. Both were checked by rendering the
 * output through this repo's pdfjs and asking which markers survived.
 *
 * `targetWidth`/`targetHeight` arrive already swapped for a quarter turn, so
 * they are content-space extents here, not visual ones.
 */
function boxOnlyOrigin(
  src: { x: number; y: number; width: number; height: number },
  rotation: number,
  targetWidth: number,
  targetHeight: number,
): { x: number; y: number; width: number; height: number } {
  const right = src.x + src.width - targetWidth;
  const top = src.y + src.height - targetHeight;
  const corner =
    rotation === 90
      ? { x: right, y: src.y }
      : rotation === 180
        ? { x: right, y: top }
        : rotation === 270
          ? { x: src.x, y: top }
          : { x: src.x, y: src.y };
  return { ...corner, width: targetWidth, height: targetHeight };
}

export interface PdfPageSizeOptions {
  /** Target VISUAL width in PDF points (what the reader sees after /Rotate). */
  width: number;
  /** Target VISUAL height in PDF points. */
  height: number;
  /** true (default) = uniformly scale + centre the content. false = move the box only. */
  scaleContent: boolean;
}

/**
 * Resize every page to a target page size.
 *
 * Three things here are load-bearing and each one is a silent-wrong-output bug
 * if it is dropped:
 *
 * 1. `setSize()` is NOT used. It updates CropBox/BleedBox/TrimBox/ArtBox only
 *    when they float-EQUAL the MediaBox (PDFPage.js:112-123, via
 *    `rectanglesAreEqual`, which compares with ===). A page carrying a real
 *    CropBox therefore keeps the old one, the viewer keeps showing
 *    intersect(oldCrop, newMedia), and the resize is invisible in exactly the
 *    files that most need it. MediaBox and CropBox are written unconditionally
 *    instead, and the three auxiliary boxes are brought in behind them.
 * 2. The target dimensions are VISUAL. On a quarter-turned page the reader
 *    sees the media box's height as its width, so the two are swapped before
 *    anything is written — asking for A4 portrait on a /Rotate 90 page has to
 *    produce a page that READS as A4 portrait.
 * 3. When scaling, the transform is a full `cm`, not `page.scaleContent()`.
 *    pdf-lib's scaleContent emits `s 0 0 s 0 0`, which scales about content
 *    space's origin — correct only for a page whose visible rect starts at
 *    (0, 0). The e/f terms below subtract the source origin and re-centre the
 *    result, which is what makes a non-zero-origin or cropped page land in the
 *    middle of the new sheet instead of drifting off it.
 *
 * 4. The scaled content is CLIPPED to the source's visible rect. A page whose
 *    CropBox is smaller than its MediaBox — the normal shape of a print/bleed
 *    export, of a scanned or imposed document, and of anything this repo's own
 *    crop-pdf just produced — carries marks no reader ever showed. The new
 *    sheet's CropBox is the whole target, and `scale = Math.min(...)` always
 *    leaves slack on one axis, so without a clip those marks are scaled onto
 *    the visible output. Measured before the clip existed: MediaBox
 *    [0 0 400 600], CropBox [40 60 360 540], a 30 × 30 cyan block at content
 *    (5, 300) that pdfjs does not paint in the source, came out painted on the
 *    A4 output at every /Rotate — at 90 it landed at device [298, 179] to
 *    [335, 216], dead centre. The crop-pdf → pdf-resizer chain reproduced it
 *    with no exotic input at all: cropping a plain 400 × 600 page to
 *    [0 0 340 600] correctly hid a block at content (355, 280), and resizing
 *    that output to A4 painted it back. The clip is emitted AFTER the `cm`, so
 *    the rectangle is written in the SOURCE's own content coordinates; `W n`
 *    resolves the path through the CTM in force when it runs, and before the
 *    `cm` those same numbers would describe a rectangle in the new sheet's
 *    space and cut the content in half. For the ordinary page whose CropBox
 *    equals its MediaBox the clip IS the whole scaled page and paints nothing
 *    differently: builds with and without it are pixel-identical at 150dpi
 *    across four /Rotate values and three target sizes, the sole exception
 *    being antialiasing on the single boundary row when content is drawn flush
 *    to the sheet edge (36 differing pixels in 2.1 million).
 *
 * `page.pushOperators()` cannot do this job at all: it APPENDS to the content
 * stream, and a page CTM has to be a prefix. The wrapping pair of streams is
 * the same shape pdf-lib's own scaleContent uses.
 *
 * Honest limitation, which the UI copy must repeat — and it is NARROWER than
 * it first looks, so state it precisely rather than defensively. Annotation
 * POSITIONS now get the same affine the content gets (see
 * `transformAnnotations`), and an /AP appearance stream's /BBox and /Matrix
 * are NOT rewritten. That is not the visible defect it sounds like: PDF
 * 32000-1 12.5.5 has a reader fit the appearance's /BBox onto the annotation's
 * /Rect, and pdfjs demonstrably does (a Letter → A3 resize produced
 * `beginAnnotation` transform [1.3756, 0, 0, 1.3756, …], i.e. the stored
 * picture stretched onto the new rectangle), and because this function only
 * ever scales UNIFORMLY that fit cannot distort. The real residue is the /DA
 * default-appearance string: a field still names its original point size
 * (`/Helv 12 Tf` after the resize, measured), so a reader that REDRAWS the
 * field from /DA rather than trusting the stored picture renders text that is
 * too small for the enlarged box.
 */
export async function changePdfPageSize(
  data: ArrayBuffer | Uint8Array,
  options: PdfPageSizeOptions,
): Promise<Uint8Array> {
  const doc = await loadDocument(data);

  for (const page of doc.getPages()) {
    const rot = displayedQuarterTurn(page.getRotation().angle);
    const quarterTurned = rot % 180 === 90;
    const targetWidth = quarterTurned ? options.height : options.width;
    const targetHeight = quarterTurned ? options.width : options.height;

    const src = visiblePageRect(page);
    let box = { x: 0, y: 0, width: targetWidth, height: targetHeight };

    if (options.scaleContent) {
      const scale = Math.min(targetWidth / src.width, targetHeight / src.height);
      if (Number.isFinite(scale) && scale > 0) {
        const ex = (targetWidth - scale * src.width) / 2 - scale * src.x;
        const ey = (targetHeight - scale * src.height) / 2 - scale * src.y;

        // normalize() first: it turns a single /Contents stream into the array
        // wrapContentStreams needs, and resolves inherited /Resources onto the
        // leaf. A page with no content at all still has no array afterwards,
        // and wrapContentStreams then reports false — nothing to scale.
        page.node.normalize();
        const start = doc.context.register(
          PDFContentStream.of(doc.context.obj({}), [
            pushGraphicsState(),
            concatTransformationMatrix(scale, 0, 0, scale, ex, ey),
            // `re W n` in the source's own coordinates — see point 4 above for
            // why this follows the cm rather than preceding it.
            rectangle(src.x, src.y, src.width, src.height),
            clip(),
            endPath(),
          ]),
        );
        const end = doc.context.register(
          PDFContentStream.of(doc.context.obj({}), [popGraphicsState()]),
        );
        page.node.wrapContentStreams(start, end);
        transformAnnotations(page, scale, ex, ey);
      }
    } else {
      box = boxOnlyOrigin(src, rot, targetWidth, targetHeight);
    }

    page.setMediaBox(box.x, box.y, box.width, box.height);
    page.setCropBox(box.x, box.y, box.width, box.height);
    alignAuxiliaryBoxes(page, box, true);
  }

  return doc.save(SAVE_OPTIONS);
}

// ── Images to PDF (pdf-lib — creating from scratch) ────────────────

export type PageSize = "a4" | "letter" | "fit";

const PAGE_SIZES: Record<string, { width: number; height: number }> = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
};

/**
 * WHY THIS READS AN EXIF TAG. `embedJpg`/`embedPng` put the ORIGINAL bytes into
 * the document and take the dimensions from the stored sample grid — pdf-lib
 * never decodes, and a PDF reader never looks at EXIF inside a `/DCTDecode`
 * stream. Every image VIEWER does look. So a phone photo carrying Orientation 6
 * is 800×600 in the file and 600×800 on screen, and building the page from the
 * stored grid produced a landscape page with the photo lying on its side and
 * stretched to the wrong aspect ratio.
 *
 * That was live on all six `images-to-pdf` tools, and it was visible in the
 * product: the thumbnail strip renders the SAME bytes through an `<img>`, which
 * honours EXIF, so the preview showed the photo upright and the download showed
 * it sideways.
 *
 * `neutraliseJpegOrientation` — the cure `recompress-pdf-images` uses — is the
 * wrong tool here and would change nothing: it rewrites the tag a PDF reader
 * was already ignoring. The bytes are embedded as-is, so the answer has to be
 * a placement transform, which is what `placeImageInBox` returns.
 *
 * The WebP/HEIC/other arm needs none of this and must not get it: those are
 * decoded through `createImageBitmap` (which applies EXIF) and re-encoded
 * through a canvas (which writes none) in `images-to-pdf-prep.ts`, so their
 * orientation is already baked into the samples. `readImageOrientation`
 * returns 1 for every type that is not JPEG or PNG, which is exactly that.
 */
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

    const stored = embedded.scale(1);
    const orientation = asExifOrientation(readImageOrientation(img.bytes, img.type));
    // What a viewer shows: width and height exchanged for orientations 5-8.
    const shown = displayedSize(stored, orientation);

    let pageWidth: number;
    let pageHeight: number;

    if (pageSize === "fit") {
      pageWidth = shown.width;
      pageHeight = shown.height;
    } else {
      const dims = PAGE_SIZES[pageSize];
      pageWidth = dims.width;
      pageHeight = dims.height;
    }

    const page = pdf.addPage([pageWidth, pageHeight]);

    let box: { x: number; y: number; width: number; height: number };
    if (pageSize === "fit") {
      box = { x: 0, y: 0, width: pageWidth, height: pageHeight };
    } else {
      const margin = 40;
      const maxW = pageWidth - margin * 2;
      const maxH = pageHeight - margin * 2;
      // The clamp to 1 is deliberate and unchanged: a photo smaller than the
      // printable area is placed at its own size rather than blown up.
      const scale = Math.min(maxW / shown.width, maxH / shown.height, 1);
      const w = shown.width * scale;
      const h = shown.height * scale;
      box = { x: (pageWidth - w) / 2, y: (pageHeight - h) / 2, width: w, height: h };
    }

    const placement = placeImageInBox({ stored, orientation, box, fit: "stretch" });
    page.drawImage(embedded, {
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      rotate: degrees(placement.rotate),
    });
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

/**
 * What writing `/Filter /FlateDecode` into a stream dictionary costs in the
 * SERIALISED file — computed the way `PDFDict.sizeInBytes()` computes it
 * (`key.sizeInBytes() + value.sizeInBytes() + 2`, PDFDict.js:110) rather than
 * assumed as a constant, so it cannot drift if pdf-lib changes its spacing.
 *
 * WHY IT EXISTS. `deflateRawStreams` used to guard with
 * `packed.length >= obj.contents.length`, which compares stream PAYLOADS and
 * ignores the dictionary entry it is about to add two lines later. On a
 * document made of many small raw streams that entry costs more than the
 * payload saves, so the "compressor" grew the file. Measured on a generated
 * 60-page document whose content streams arrive uncompressed: the pass touched
 * every stream, saved a handful of payload bytes, and took the output from
 * 11,032 to 11,192 bytes — a 1.45% LOSS on a tool whose one job is to shrink
 * things. It never reached a user, because the object-stream rewrite carries
 * the file overall and `CompressPdfUI` hands back the original when the result
 * is not smaller; the pass was simply losing money on that shape of document.
 */
const FILTER_ENTRY_BYTES =
  PDFName.of("Filter").sizeInBytes() + PDFName.of("FlateDecode").sizeInBytes() + 2;

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
    // The comparison has to include the `/Filter /FlateDecode` this pass is
    // about to write into the dictionary, or a stream that deflates by fewer
    // bytes than the entry costs makes the FILE bigger while making the
    // STREAM smaller. See FILTER_ENTRY_BYTES.
    if (packed.length + FILTER_ENTRY_BYTES >= obj.contents.length) continue;

    obj.dict.set(PDFName.of("Filter"), PDFName.of("FlateDecode"));
    // `contents` is readonly, so the stream object is replaced rather than
    // mutated; PDFRawStream.of carries the dict across and /Length is reset
    // from the new byte count.
    obj.dict.set(PDFName.of("Length"), context.obj(packed.length));
    context.assign(ref, PDFRawStream.of(obj.dict, packed));
  }
}

/** Inflate a zlib-wrapped stream, or null if the bytes will not decode. */
async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  // Same defensive copy as `deflate`, for the same reason.
  const input = new Uint8Array(bytes.length);
  input.set(bytes);

  try {
    const stream = new DecompressionStream("deflate");
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
  } catch {
    // A stream we cannot read is a stream we have no business rewriting.
    return null;
  }
}

/**
 * Re-compress the streams that arrived ALREADY carrying /FlateDecode.
 *
 * This is the lever that actually pays, and it is the one nobody proposed.
 * Producers differ enormously in how hard they compress: measured across 400
 * real PDFs on this machine the existing passes save 10.88% and adding this
 * one takes it to 19.23%, with the median per-file saving going 6.19% ->
 * 16.47%. On Xcode's own 1,278,722-byte Acknowledgments.pdf — macOS Quartz
 * output, the single commonest producer in that sample — it is the difference
 * between 5.68% and 31.05%. It costs no new dependency and no bundle bytes:
 * `DecompressionStream` is the platform's, as `CompressionStream` already was.
 * Time cost measured on a 924-page 1.4 MB document: 69 ms -> 166 ms.
 *
 * Only a stream whose /Filter is the BARE NAME /FlateDecode is touched. A
 * filter ARRAY means a chain (`[/ASCII85Decode /FlateDecode]`), and a chain is
 * not ours to reinterpret — the same restraint the raw-stream pass shows.
 *
 * /DecodeParms is deliberately NOT skipped here, and the asymmetry with the
 * pass above is the point. There, writing /FlateDecode beside a STALE
 * /DecodeParms would bring inert parameters to life and corrupt the stream.
 * Here the dictionary is left exactly as found: inflate -> deflate reproduces
 * the identical post-filter bytes, so a /Predictor keeps describing precisely
 * what it described before. Verified against files that carry predictors —
 * pdfjs extracts identical text before and after.
 *
 * No margin is needed in this guard, unlike the one above: this pass changes
 * no dictionary key except /Length, which can only get shorter as the payload
 * shrinks.
 */
async function redeflateFlateStreams(context: PDFContext): Promise<void> {
  if (typeof DecompressionStream === "undefined" || typeof CompressionStream === "undefined") {
    return;
  }

  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;

    const filter = obj.dict.get(PDFName.of("Filter"));
    if (filter === undefined) continue;
    if (!(filter instanceof PDFName) || filter !== PDFName.of("FlateDecode")) continue;
    if (obj.contents.length === 0) continue;

    const raw = await inflate(obj.contents);
    if (raw === null) continue;

    const packed = await deflate(raw);
    if (packed.length >= obj.contents.length) continue;

    obj.dict.set(PDFName.of("Length"), context.obj(packed.length));
    context.assign(ref, PDFRawStream.of(obj.dict, packed));
  }
}

/**
 * What this actually does, so the copy around it can stay true: it drops
 * every object nothing references any more, deflates the streams that came in
 * uncompressed, RE-deflates the ones that arrived already compressed but
 * loosely, and rewrites the file with its objects packed into compressed
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
  await redeflateFlateStreams(pdf.context);
  // `useObjectStreams: true` is pdf-lib's own default (PDFDocument.js:1248), so
  // this is documentation rather than a switch — every other op in this file
  // already writes object streams and a cross-reference stream. It stays
  // spelled out because the copy names it as one of the three things the tool
  // does, and a reader checking that claim should find it here.
  return pdf.save({ ...SAVE_OPTIONS, useObjectStreams: true });
}

/* ══ Stamping: watermark / signature / image / annotation marks ═════════ */

/**
 * ONE ENGINE OP SERVES FOUR TOOLS, and that is deliberate rather than
 * incidental. `watermark-pdf`, `sign-pdf`, `add-image-to-pdf` and
 * `annotate-pdf` are the same operation with different defaults: put a thing
 * at a place on some pages. Splitting them would have produced four copies of
 * the page-geometry handling, which is the half that is actually hard — a
 * CropBox that differs from the MediaBox, a non-zero origin, and a `/Rotate`
 * of 90/180/270 all move where "the top-left corner of the page" is.
 *
 * All placement arrives as FRACTIONS of the displayed page, top-left origin,
 * because that is what a preview overlay can report without knowing anything
 * about PDF user space. `pdf-stamp-core.ts` converts.
 */

export type PdfStampPages = "all" | "first" | "last" | number[];

interface PdfStampCommon {
  pages: PdfStampPages;
  /** 0..1 across and down the page AS DISPLAYED, from its top-left corner. */
  at: { x: number; y: number };
  /** 0..1. */
  opacity: number;
  /** Degrees counter-clockwise. */
  rotate: number;
}

export interface PdfTextStamp extends PdfStampCommon {
  kind: "text";
  text: string;
  /** Points. */
  size: number;
  /** "#rrggbb". */
  colour: string;
  bold: boolean;
  /**
   * Draw UNDER the page's existing content instead of over it.
   *
   * Verified end to end: `page.node.normalizedEntries()` converts a single
   * `/Contents` stream into an array (wrapping the original in q/Q), and
   * inserting at index 0 makes the new stream render FIRST. Text on the page
   * then covers the watermark rather than the other way round, which is what
   * a watermark under body text is supposed to look like.
   */
  behind: boolean;
  /** Repeat across the whole page on a grid, the classic diagonal watermark. */
  tile: boolean;
}

export interface PdfImageStamp extends PdfStampCommon {
  kind: "image";
  bytes: Uint8Array;
  type: string;
  /** Width as a fraction of the displayed page width; height follows the image. */
  widthFraction: number;
  behind: boolean;
  tile: boolean;
}

export interface PdfRectStamp extends PdfStampCommon {
  kind: "rect";
  /** Fractions of the displayed page. */
  size: { width: number; height: number };
  /** "#rrggbb", or absent for no fill. */
  fill?: string;
  /** "#rrggbb", or absent for no outline. */
  stroke?: string;
  strokeWidth: number;
}

/**
 * A freehand stroke — what `pdf-editor`'s pen and highlighter draw.
 *
 * The points are FRACTIONS of the displayed page, in draw order, and each one
 * is mapped through `fractionToUserSpace` independently. That is why this stamp
 * carries no anchor correction and ignores `rotate`: a stroke is drawn where
 * the user drew it, and mapping each point separately makes a page's own
 * `/Rotate` fall out for free rather than needing the height shift the image
 * and rectangle stamps need.
 */
export interface PdfPathStamp extends PdfStampCommon {
  kind: "path";
  points: { x: number; y: number }[];
  /** "#rrggbb". */
  stroke: string;
  /** Points. */
  strokeWidth: number;
}

export type PdfStamp = PdfTextStamp | PdfImageStamp | PdfRectStamp | PdfPathStamp;

/*
  The text pre-flight lives in `pdf-stamp-core.ts` as a PURE predicate, and the
  engine calls it rather than owning it.

  It used to be here, implemented by embedding a throwaway Helvetica and asking
  it to measure each character — correct, but unreachable from a UI, because a
  component that imports this module drags pdf-lib's chunk into the eager
  bundle. Four of the seven tools built against this engine independently
  reported that they could not warn the user before the run for exactly that
  reason. The pure version is a measured 218-codepoint table (WinAnsi/cp1252),
  re-derived against pdf-lib by a test that fails in either direction, so the
  check a user sees on keypress and the check that refuses the run are the same
  function.
*/

/*
  Re-exported so existing callers of the engine keep one import site, and
  because a re-export from `pdf-stamp-core` is free: that module has zero
  imports of its own, so nothing is dragged along with it.
*/
export { isStampDrawable, unsupportedStampCharacters } from "./pdf-stamp-core";

export const STAMP_TEXT_UNSUPPORTED =
  "This page can only draw text the standard PDF fonts cover — Latin letters, digits and punctuation, including accents, curly quotes and the euro sign. It cannot draw";

function parseColour(value: string): { r: number; g: number; b: number } {
  const hex = value.trim().replace(/^#/, "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  const n = Number.parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(n)) return { r: 0, g: 0, b: 0 };
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

function resolvePages(count: number, pages: PdfStampPages): number[] {
  if (pages === "all") return Array.from({ length: count }, (_, i) => i);
  if (pages === "first") return count > 0 ? [0] : [];
  if (pages === "last") return count > 0 ? [count - 1] : [];
  // A page index a user cannot have chosen is dropped rather than throwing:
  // `copyPages` has no bounds check either, and a stamp is additive.
  return [...new Set(pages)].filter((index) => index >= 0 && index < count).sort((a, b) => a - b);
}

/**
 * Apply stamps to a document.
 *
 * Every stamp's `pages` is resolved independently, so one call can put a
 * signature on the last page and a watermark on all of them.
 */
export async function stampPdf(
  data: ArrayBuffer | Uint8Array,
  stamps: PdfStamp[],
): Promise<Uint8Array> {
  const pdf = await loadDocument(data);

  const pageList = pdf.getPages();
  let regular: PDFFont | null = null;
  let bold: PDFFont | null = null;
  const embeddedImages = new Map<PdfImageStamp, PDFImage>();

  for (const stamp of stamps) {
    if (stamp.kind === "text") {
      const bad = unsupportedStampCharacters(stamp.text);
      if (bad.length > 0) {
        throw new Error(`${STAMP_TEXT_UNSUPPORTED} ${bad.map((c) => `"${c}"`).join(", ")}.`);
      }
      if (stamp.bold && !bold) bold = await pdf.embedFont(StandardFonts.HelveticaBold);
      if (!stamp.bold && !regular) regular = await pdf.embedFont(StandardFonts.Helvetica);
    } else if (stamp.kind === "image") {
      embeddedImages.set(
        stamp,
        stamp.type === "image/png" ? await pdf.embedPng(stamp.bytes) : await pdf.embedJpg(stamp.bytes),
      );
    }
  }

  for (const stamp of stamps) {
    for (const index of resolvePages(pageList.length, stamp.pages)) {
      const page = pageList[index];
      const box = visiblePageBox({
        mediaBox: page.getMediaBox(),
        cropBox: page.getCropBox(),
      });
      const rotation = normaliseRotation(page.getRotation().angle);
      const shown = displayedPageSize(box, rotation);
      const down = displayedDownUnit(box, rotation);

      const spots =
        "tile" in stamp && stamp.tile
          ? tileFractions()
          : [stamp.at];

      const drawnUnder = "behind" in stamp && stamp.behind;
      const before = drawnUnder ? contentStreamCount(page) : 0;

      for (const at of spots) {
        const origin = fractionToUserSpace({ fraction: at, pageBox: box, rotation });
        drawStamp(page, stamp, origin, shown, rotation, down, box, {
          regular,
          bold,
          image: stamp.kind === "image" ? (embeddedImages.get(stamp) ?? null) : null,
        });
      }

      if (drawnUnder) moveAppendedContentToFront(page, before);
    }
  }

  return pdf.save(SAVE_OPTIONS);
}

function contentStreamCount(page: PDFPage): number {
  page.node.normalizedEntries();
  const contents = page.node.Contents();
  return contents instanceof PDFArray ? contents.size() : 0;
}

/**
 * Move everything drawn since `before` to the FRONT of the page's content.
 *
 * A PDF page paints its content streams in order, so "under the existing
 * content" means "earlier in the array". `normalizedEntries()` is what makes
 * that expressible: it converts a single `/Contents` stream into an array and
 * wraps the original in q/Q, so inserting ahead of it cannot leak graphics
 * state into the page's own drawing.
 *
 * Verified end to end with pdf.js's operator list: the inserted stream renders
 * first and the original content second, so page text covers the watermark
 * instead of the watermark covering the text.
 */
function moveAppendedContentToFront(page: PDFPage, before: number): void {
  const contents = page.node.Contents();
  if (!(contents instanceof PDFArray)) return;
  const added = contents.size() - before;
  if (added <= 0) return;
  const moved: PDFObject[] = [];
  for (let i = 0; i < added; i++) moved.push(contents.get(before + i));
  // Remove from the end so the earlier indices stay valid.
  for (let i = contents.size() - 1; i >= before; i--) contents.remove(i);
  for (let i = moved.length - 1; i >= 0; i--) contents.insert(0, moved[i]);
}

/** A 3×4 grid, inset so nothing sits flush against an edge. */
function tileFractions(): { x: number; y: number }[] {
  const spots: { x: number; y: number }[] = [];
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 3; column++) {
      spots.push({ x: 0.14 + column * 0.29, y: 0.13 + row * 0.245 });
    }
  }
  return spots;
}

function drawStamp(
  page: PDFPage,
  stamp: PdfStamp,
  origin: { x: number; y: number },
  shown: { width: number; height: number },
  rotation: 0 | 90 | 180 | 270,
  down: { x: number; y: number },
  pageBox: { x: number; y: number; width: number; height: number },
  fonts: { regular: PDFFont | null; bold: PDFFont | null; image: PDFImage | null },
): void {
  // A stamp's own rotation composes with the page's: a user who asks for 45°
  // on a page the reader turns 90° means 45° as they SEE it.
  const angle = stamp.rotate + rotation;

  if (stamp.kind === "text") {
    const font = stamp.bold ? fonts.bold : fonts.regular;
    if (!font) return;
    const colour = parseColour(stamp.colour);
    page.drawText(stamp.text, {
      x: origin.x,
      y: origin.y,
      size: stamp.size,
      font,
      color: rgb(colour.r, colour.g, colour.b),
      opacity: stamp.opacity,
      rotate: degrees(angle),
    });
    return;
  }

  if (stamp.kind === "image") {
    const image = fonts.image;
    if (!image) return;
    const width = shown.width * stamp.widthFraction;
    const height = (image.height / image.width) * width;
    /*
      Fractions are top-left anchored; a PDF draws an image from its BOTTOM
      left, so the anchor drops by the stamp's own height — ALONG DISPLAYED
      DOWN, not along the unrotated y axis. `y: origin.y - height` was correct
      only on a `/Rotate 0` page and put the mark up to two of its own heights
      out of place on a turned one. See `displayedDownUnit`.
    */
    page.drawImage(image, {
      x: origin.x + down.x * height,
      y: origin.y + down.y * height,
      width,
      height,
      opacity: stamp.opacity,
      rotate: degrees(angle),
    });
    return;
  }

  if (stamp.kind === "path") {
    if (stamp.points.length < 2) return;
    const colour = parseColour(stamp.stroke);
    const at = (point: { x: number; y: number }) =>
      fractionToUserSpace({ fraction: point, pageBox, rotation });
    // Segment by segment, because each endpoint is mapped independently — see
    // PdfPathStamp. Round caps and joins so a stroke reads as one pen line
    // rather than a chain of separate rectangles at every bend.
    for (let i = 1; i < stamp.points.length; i++) {
      page.drawLine({
        start: at(stamp.points[i - 1]),
        end: at(stamp.points[i]),
        thickness: stamp.strokeWidth,
        color: rgb(colour.r, colour.g, colour.b),
        opacity: stamp.opacity,
        lineCap: LineCapStyle.Round,
      });
    }
    return;
  }

  const width = shown.width * stamp.size.width;
  const height = shown.height * stamp.size.height;
  const fill = stamp.fill ? parseColour(stamp.fill) : null;
  const stroke = stamp.stroke ? parseColour(stamp.stroke) : null;
  page.drawRectangle({
    // Same top-left-to-bottom-left correction as the image branch, and the
    // same reason it has to follow the page's rotation.
    x: origin.x + down.x * height,
    y: origin.y + down.y * height,
    width,
    height,
    color: fill ? rgb(fill.r, fill.g, fill.b) : undefined,
    borderColor: stroke ? rgb(stroke.r, stroke.g, stroke.b) : undefined,
    borderWidth: stroke ? stamp.strokeWidth : 0,
    opacity: fill ? stamp.opacity : undefined,
    borderOpacity: stroke ? stamp.opacity : undefined,
    rotate: degrees(angle),
  });
}

/* ══ AcroForm reading, filling and flattening ═══════════════════════════ */

export type PdfFormFieldKind =
  | "text"
  | "checkbox"
  | "radio"
  | "dropdown"
  | "optionlist"
  | "button"
  | "signature"
  | "unknown";

export interface PdfFormField {
  name: string;
  kind: PdfFormFieldKind;
  /** Text for a text field, the chosen option(s) for a chooser, checked state for a box. */
  value: string | string[] | boolean | null;
  /** Selectable options, for the three chooser kinds. Empty otherwise. */
  options: string[];
  readOnly: boolean;
  required: boolean;
  multiline: boolean;
  maxLength: number | null;
  /** 0-based pages this field's widgets appear on. */
  pageIndices: number[];
  /**
   * Widgets whose `/AP /N` could not be resolved. NOT cosmetic: each one is a
   * field that makes `flatten()` throw. See `PDF_FORM_FLATTEN_BLOCKED`.
   */
  brokenWidgets: number;
}

export interface PdfFormReport {
  /**
   * Whether the document ARRIVED with an /AcroForm.
   *
   * ⚠ This is read from the catalog BEFORE `getForm()` is called, and that
   * order is load-bearing. MEASURED: `PDFDocument.getForm()` lazily CREATES an
   * /AcroForm dictionary when the document has none — on this repo's own
   * fixtures, `catalog.get(AcroForm)` is undefined before the call and defined
   * after it. A tool that called `getForm()` first and saved would add a form
   * dictionary to a document that never had one, which is a structural change
   * the user did not ask for from a tool whose copy says it only touches form
   * fields.
   */
  hasForm: boolean;
  /**
   * The producer's own `/NeedAppearances` flag: "do not trust my appearance
   * streams, regenerate them from the values". When it is set, filling and
   * flattening both regenerate rather than trusting what is there.
   */
  needAppearances: boolean;
  fields: PdfFormField[];
  /** Field names that would make `flatten()` throw. Empty means flatten is safe. */
  flattenBlockedBy: string[];
}

/**
 * The message for a document `flatten()` cannot process.
 *
 * WHY THIS IS DETECTED RATHER THAN CAUGHT. `flatten()` walks the fields in
 * order and deletes each one as it bakes it, so a throw part-way leaves the
 * document HALF-FLATTENED — measured: fields before the failure are already
 * gone and their values already drawn — and the subsequent `save()` throws
 * `Expected instance of PDFDict or PDFStream, but got instance of undefined`.
 * There is no recovering that object; the only correct handling is to look
 * before leaping, and to reload from the original bytes if you ever do leap.
 *
 * The condition is a widget whose `/AP /N` will not resolve. pdf-lib
 * regenerates appearances for text fields, check boxes, dropdowns, option
 * lists and buttons, so those repair themselves; the two that reach here are
 * RADIO GROUPS (measured: `updateFieldAppearances()` leaves their widgets
 * without an /AP) and SIGNATURE fields.
 */
export const PDF_FORM_FLATTEN_BLOCKED =
  "Some fields in this form have no stored appearance, and this engine cannot draw them: flattening would produce a document with those fields blank. Signature fields and some radio groups are the usual cause.";

/*
  Field-flag bits from PDF 32000-1 table 227, the three this file needs.
  Spelled as the bit VALUE rather than the bit NUMBER because that is what
  `getFlags()` returns.
*/
const FF_RADIO = 1 << 15; // 32768  — /Btn is a radio group
const FF_PUSHBUTTON = 1 << 16; // 65536  — /Btn is a pushbutton, not a toggle
const FF_COMBO = 1 << 17; // 131072 — /Ch is a dropdown, not a list box

/**
 * Which kind of form field this is, derived from the PDF's OWN `/FT` and field
 * flags rather than from pdf-lib's class identity.
 *
 * ⚠ THIS IS NOT PEDANTRY, IT IS A BUG THAT WOULD HAVE SHIPPED SILENTLY. The
 * obvious implementation is `field.constructor.name === "PDFTextField"`, and it
 * works perfectly in the unit tests — which import pdf-lib straight out of
 * node_modules. The worker does not: it is esbuild-bundled by
 * `scripts/build-workers.mjs`, and esbuild RENAMES the classes to avoid
 * collisions. Measured on this exact module, same document, same pdf-lib:
 *
 *     unbundled : constructor.name = "PDFTextField"
 *     bundled   : constructor.name = "PDFTextField3"
 *
 * So every field would classify as "unknown" in the shipped build, with every
 * value and option list coming back empty, while `npm test` stayed green. It is
 * the same family as the `instanceof EncryptedPDFError` trap this file already
 * documents: pdf-lib class identity is not something to reason from.
 *
 * `/FT` plus the flag bits is spec data. No bundler can rename it.
 */
function fieldKind(field: PDFField): PdfFormFieldKind {
  const acro = field.acroField;
  let type: string;
  let flags: number;
  try {
    type = String(acro.dict.get(PDFName.of("FT")) ?? acro.FT?.());
    flags = acro.getFlags();
  } catch {
    return "unknown";
  }

  switch (type) {
    case "/Tx":
      return "text";
    case "/Sig":
      return "signature";
    case "/Btn":
      if ((flags & FF_PUSHBUTTON) !== 0) return "button";
      return (flags & FF_RADIO) !== 0 ? "radio" : "checkbox";
    case "/Ch":
      return (flags & FF_COMBO) !== 0 ? "dropdown" : "optionlist";
    default:
      return "unknown";
  }
}

/**
 * `/AP /N` for one widget, or undefined when it cannot be resolved.
 *
 * pdf-lib's error subclasses cannot be caught by `instanceof` (see the note at
 * the top of this file), and a malformed dictionary can throw from the lookup
 * itself, so this is defensive by design: anything it cannot resolve counts as
 * missing, which is the safe direction — it reports a hazard the flatten would
 * have survived rather than missing one it would not.
 */
function widgetHasAppearance(doc: PDFDocument, widget: { dict: PDFDict }): boolean {
  try {
    if (widget.dict.get(PDFName.of("Rect")) === undefined) return false;
    const ap = widget.dict.get(PDFName.of("AP"));
    if (ap === undefined) return false;
    const resolved = ap instanceof PDFRef ? doc.context.lookup(ap) : ap;
    if (!(resolved instanceof PDFDict)) return false;
    return resolved.get(PDFName.of("N")) !== undefined;
  } catch {
    return false;
  }
}

function fieldValue(field: PDFField): string | string[] | boolean | null {
  try {
    switch (fieldKind(field)) {
      case "text":
        return (field as PDFTextField).getText() ?? "";
      case "checkbox":
        return (field as PDFCheckBox).isChecked();
      case "radio":
        return (field as PDFRadioGroup).getSelected() ?? "";
      case "dropdown":
        return (field as PDFDropdown).getSelected();
      case "optionlist":
        return (field as PDFOptionList).getSelected();
      default:
        return null;
    }
  } catch {
    // A field whose stored value does not match its own declared options is a
    // real shape in the wild. Reporting null beats refusing the whole document.
    return null;
  }
}

function fieldOptions(field: PDFField): string[] {
  try {
    switch (fieldKind(field)) {
      case "radio":
        return (field as PDFRadioGroup).getOptions();
      case "dropdown":
        return (field as PDFDropdown).getOptions();
      case "optionlist":
        return (field as PDFOptionList).getOptions();
      default:
        return [];
    }
  } catch {
    return [];
  }
}

function describeForm(doc: PDFDocument): PdfFormReport {
  // Read the catalog BEFORE getForm() — see PdfFormReport.hasForm.
  const hasForm = doc.catalog.get(PDFName.of("AcroForm")) !== undefined;
  if (!hasForm) {
    return { hasForm: false, needAppearances: false, fields: [], flattenBlockedBy: [] };
  }

  const form = doc.getForm();
  const needAppearances =
    String(form.acroForm.dict.get(PDFName.of("NeedAppearances")) ?? "") === "true";

  const pageRefs = doc.getPages().map((page) => page.ref);
  const fields: PdfFormField[] = [];
  const flattenBlockedBy: string[] = [];

  for (const field of form.getFields()) {
    const widgets = field.acroField.getWidgets();
    let broken = 0;
    const pageIndices: number[] = [];
    for (const widget of widgets) {
      if (!widgetHasAppearance(doc, widget)) broken += 1;
      const parent = widget.P();
      if (parent) {
        const index = pageRefs.findIndex((ref) => ref === parent);
        if (index >= 0 && !pageIndices.includes(index)) pageIndices.push(index);
      }
    }

    const kind = fieldKind(field);
    const text = kind === "text" ? (field as PDFTextField) : null;

    fields.push({
      name: field.getName(),
      kind,
      value: fieldValue(field),
      options: fieldOptions(field),
      readOnly: field.isReadOnly(),
      required: field.isRequired(),
      multiline: text ? text.isMultiline() : false,
      maxLength: text ? (text.getMaxLength() ?? null) : null,
      pageIndices: pageIndices.sort((a, b) => a - b),
      brokenWidgets: broken,
    });

    if (broken > 0) flattenBlockedBy.push(field.getName());
  }

  return { hasForm, needAppearances, fields, flattenBlockedBy };
}

/** What is in this document's form, without changing a byte of it. */
export async function readPdfForm(data: ArrayBuffer | Uint8Array): Promise<PdfFormReport> {
  return describeForm(await loadDocument(data));
}

export interface PdfFormValues {
  [fieldName: string]: string | string[] | boolean;
}

/**
 * Apply values to an existing form, optionally flattening afterwards.
 *
 * Values go in through the HIGH-LEVEL setters on purpose. MEASURED: setting a
 * field's `/V` at the low level and then flattening bakes the OLD appearance
 * stream and silently loses the new value — `setText` and its siblings mark the
 * field dirty so its appearance is regenerated, and the low-level path does
 * not. A fill that wrote `/V` directly would produce a document that says one
 * thing to a form reader and shows another to a human.
 */
export async function fillPdfForm(
  data: ArrayBuffer | Uint8Array,
  values: PdfFormValues,
  options: { flatten?: boolean } = {},
): Promise<Uint8Array> {
  const pdf = await loadDocument(data);
  if (pdf.catalog.get(PDFName.of("AcroForm")) === undefined) {
    throw new Error(PDF_FORM_NO_FIELDS);
  }

  const form = pdf.getForm();
  for (const [name, value] of Object.entries(values)) {
    const field = form.getFields().find((candidate) => candidate.getName() === name);
    if (!field) continue;
    applyFieldValue(field, value);
  }

  if (options.flatten) {
    const report = describeForm(pdf);
    if (report.flattenBlockedBy.length > 0) throw new Error(PDF_FORM_FLATTEN_BLOCKED);
    if (report.needAppearances) markEveryFieldDirty(form);
    form.flatten();
  }

  return pdf.save(SAVE_OPTIONS);
}

export const PDF_FORM_NO_FIELDS =
  "This PDF has no form fields — there is nothing to fill in or flatten. A document that only looks like a form, with lines and boxes drawn on the page, has no fields for any tool to write into.";

function applyFieldValue(field: PDFField, value: string | string[] | boolean): void {
  switch (fieldKind(field)) {
    case "text":
      (field as PDFTextField).setText(typeof value === "string" ? value : String(value));
      return;
    case "checkbox":
      if (value) (field as PDFCheckBox).check();
      else (field as PDFCheckBox).uncheck();
      return;
    case "radio": {
      const choice = Array.isArray(value) ? value[0] : String(value);
      if (choice) (field as PDFRadioGroup).select(choice);
      else (field as PDFRadioGroup).clear();
      return;
    }
    case "dropdown": {
      const choice = Array.isArray(value) ? value[0] : String(value);
      if (choice) (field as PDFDropdown).select(choice);
      else (field as PDFDropdown).clear();
      return;
    }
    case "optionlist": {
      const chosen = Array.isArray(value) ? value : [String(value)];
      const real = chosen.filter((entry) => entry.length > 0);
      if (real.length > 0) (field as PDFOptionList).select(real);
      else (field as PDFOptionList).clear();
      return;
    }
    default:
      // Buttons and signature fields carry no value a form filler can set.
      return;
  }
}

/**
 * Regenerate every field's appearance from its value.
 *
 * Only done when the producer asked for it with `/NeedAppearances`, because
 * that flag means precisely "my appearance streams may not match my values".
 * Doing it unconditionally would overwrite appearances a producer built
 * deliberately.
 */
function markEveryFieldDirty(form: PDFForm): void {
  for (const field of form.getFields()) form.markFieldAsDirty(field.ref);
}

/** Bake every form field into the page and remove the fields themselves. */
export async function flattenPdfForm(data: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const pdf = await loadDocument(data);
  if (pdf.catalog.get(PDFName.of("AcroForm")) === undefined) {
    throw new Error(PDF_FORM_NO_FIELDS);
  }

  const report = describeForm(pdf);
  if (report.flattenBlockedBy.length > 0) throw new Error(PDF_FORM_FLATTEN_BLOCKED);

  const form = pdf.getForm();
  if (report.needAppearances) markEveryFieldDirty(form);
  form.flatten();
  return pdf.save(SAVE_OPTIONS);
}

/* ══ Metadata ═══════════════════════════════════════════════════════════ */

export interface PdfMetadataReport {
  /** The eight standard /Info entries, absent ones omitted. */
  info: Record<string, string>;
  /**
   * How many XMP `/Metadata` streams the document carries — on the catalog, on
   * pages, and on image XObjects. This is the number that makes
   * `remove-metadata` honest: clearing /Info leaves every one of these intact.
   */
  xmpStreams: number;
}

const INFO_KEYS = [
  "Title",
  "Author",
  "Subject",
  "Keywords",
  "Creator",
  "Producer",
  "CreationDate",
  "ModDate",
] as const;

/**
 * Every object in the document that carries an XMP `/Metadata` stream.
 *
 * WHY THIS WALKS MORE THAN THE CATALOG. XMP is not one place. The catalog
 * carries the document packet, but pages may carry their own and so may image
 * XObjects — a photograph placed into a PDF commonly brings its camera XMP
 * with it. MEASURED: clearing the /Info dictionary through pdf-lib's setters
 * removes the /Info strings and leaves the XMP packet completely intact, so a
 * tool that only called the setters would report "metadata removed" over a
 * document still stating its title, author and often the producing
 * application. That is the difference between this tool working and lying.
 */
function metadataStreamRefs(doc: PDFDocument): PDFRef[] {
  const refs: PDFRef[] = [];
  const seen = new Set<string>();

  const consider = (holder: PDFDict | undefined): void => {
    if (!holder) return;
    const value = holder.get(PDFName.of("Metadata"));
    if (value instanceof PDFRef && !seen.has(value.tag)) {
      seen.add(value.tag);
      refs.push(value);
    }
  };

  consider(doc.catalog);
  for (const page of doc.getPages()) {
    consider(page.node);
    const resources = page.node.Resources();
    const xObjects = resources?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    if (!xObjects) continue;
    for (const [, value] of xObjects.entries()) {
      const resolved = value instanceof PDFRef ? doc.context.lookup(value) : value;
      if (resolved instanceof PDFStream) consider(resolved.dict);
    }
  }

  return refs;
}

/** What identifying information this document is carrying, without changing it. */
export async function readPdfMetadata(data: ArrayBuffer | Uint8Array): Promise<PdfMetadataReport> {
  const pdf = await loadDocument(data);
  const info: Record<string, string> = {};
  const dict = pdf.context.lookupMaybe(pdf.context.trailerInfo.Info, PDFDict);
  if (dict) {
    for (const key of INFO_KEYS) {
      const value = dict.get(PDFName.of(key));
      if (value === undefined) continue;
      const text =
        value instanceof PDFString || value instanceof PDFHexString
          ? value.decodeText()
          : String(value);
      if (text.length > 0) info[key] = text;
    }
  }
  return { info, xmpStreams: metadataStreamRefs(pdf).length };
}

/**
 * Strip the document's identifying metadata: the whole /Info dictionary and
 * every XMP packet.
 *
 * The /Info entries are DELETED rather than set to "". MEASURED: pdf-lib's
 * setters write an empty hex string (`<FEFF>`, a lone byte-order mark) for an
 * empty value, so the key survives — an emptied /Title is still a /Title. The
 * page content is untouched: this changes what the document says ABOUT itself,
 * never what it shows.
 */
export async function removePdfMetadata(data: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const pdf = await loadDocument(data);

  const infoDict = pdf.context.lookupMaybe(pdf.context.trailerInfo.Info, PDFDict);
  if (infoDict) {
    for (const key of infoDict.keys()) infoDict.delete(key);
  }

  for (const ref of metadataStreamRefs(pdf)) {
    pdf.context.delete(ref);
  }
  pdf.catalog.delete(PDFName.of("Metadata"));
  for (const page of pdf.getPages()) {
    page.node.delete(PDFName.of("Metadata"));
    const resources = page.node.Resources();
    const xObjects = resources?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    if (!xObjects) continue;
    for (const [, value] of xObjects.entries()) {
      const resolved = value instanceof PDFRef ? pdf.context.lookup(value) : value;
      if (resolved instanceof PDFStream) resolved.dict.delete(PDFName.of("Metadata"));
    }
  }

  // The sweep collects anything the deletions orphaned; without it the XMP
  // stream objects would still be written out, merely unreferenced.
  sweepUnreachableObjects(pdf.context);
  return pdf.save(SAVE_OPTIONS);
}

// pdfjs rendering (pdfToImages, thumbnails) lives in pdf-engine.ts — it needs
// the DOM canvas and already runs its raster math in pdfjs's own worker.
