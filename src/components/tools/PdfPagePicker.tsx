"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { loadPdfjsDocument, renderPageFromDoc } from "@/lib/tools/pdf-engine";
import { PageDeck, PageTile } from "@/components/tools/ToolCanvas";

/*
  The page picker — a thumbnail deck you click pages in — is the whole surface
  of three tools that differ only in what they do with the selection:

    split-pdf          the selection is what you keep, one PDF out
    extract-pdf-pages  the selection is what you keep, one PDF *or* one per page
    delete-pdf-pages   the selection is what LEAVES

  Only the deck and the thumbnail pass live here. The range field, the
  select-all pair, the primary label, the output filename and the
  disabled-predicate stay in each tool, deliberately: those are exactly the
  four things that differ, and folding them behind a `mode` flag would put
  three tools' divergent copy inside one component's ternaries. The shared part
  is the part that is genuinely identical.
*/

/**
 * pdfjs rasterises thumbnails on the main thread, one page at a time. Past
 * ~50 pages that is seconds of jank for tiles nobody scrolls to, so the pass
 * stops there — the deck still renders a tile for EVERY page (the ones past
 * the cap fall back to `PageTile`'s ruled-paper placeholder) and the range
 * field still reaches them.
 */
export const PDF_THUMBNAIL_LIMIT = 50;

/**
 * Render page thumbnails for `file` as pdfjs data URLs, index-aligned with the
 * deck (`thumbnails[0]` is page 1). Entries are `""` for a page that failed to
 * render and `undefined` past the cap; both mean "no thumb" to `PageTile`.
 *
 * Moved verbatim out of `SplitPdfUI` — including the `thumbsLoadedRef`
 * teardown clear, which is load-bearing (see the comment at the bottom).
 */
export function usePdfPageThumbnails(file: File | null, pageCount: number): string[] {
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const thumbsLoadedRef = useRef(false);

  useEffect(() => {
    if (!file || pageCount === 0) {
      // The three callers used to clear this by hand in handleFiles and
      // handleReset. The hook owns the state now, so dropping the file has to
      // drop the deck here or a reset would leave the previous document's
      // thumbnails sitting under the next one's page numbers.
      setThumbnails([]);
      return;
    }
    if (thumbsLoadedRef.current) return;
    thumbsLoadedRef.current = true;
    // Same reason, for the replace-the-file path: a new file (or a corrected
    // page count) invalidates every tile already published.
    setThumbnails([]);
    let cancelled = false;
    let doc: Awaited<ReturnType<typeof loadPdfjsDocument>> | null = null;
    (async () => {
      const freshBuf = await file.arrayBuffer();
      doc = await loadPdfjsDocument(freshBuf);
      const thumbs: string[] = [];
      try {
        for (let i = 1; i <= Math.min(pageCount, PDF_THUMBNAIL_LIMIT); i++) {
          // `break`, not `return` — the finally below has to run or the pdfjs
          // document stays pinned in its worker for the tab's lifetime.
          if (cancelled) break;
          try {
            const canvas = await renderPageFromDoc(doc, i, 0.3);
            thumbs.push(canvas.toDataURL("image/jpeg", 0.6));
          } catch {
            thumbs.push("");
          }
          // Publish in batches so the deck fills in as it renders rather than
          // staying blank for several seconds — same as the reorder deck.
          if (!cancelled && i % 5 === 0) setThumbnails([...thumbs]);
        }
        if (!cancelled) setThumbnails(thumbs);
      } finally {
        await doc.destroy();
        doc = null;
      }
    })();
    return () => {
      cancelled = true;
      /*
        The ref means "a thumbnail pass is in flight, or finished, for this
        file + page count". Tearing the effect down makes both false, so it
        has to clear HERE and not only in handleFiles / handleReset —
        otherwise any teardown-then-rerun of the same effect instance
        (StrictMode's mount double-invoke, Fast Refresh) leaves it stuck
        true, the re-run returns early, and the deck never fills in. Kept
        identical in RotatePdfUI and PdfPageReorderUI.
      */
      thumbsLoadedRef.current = false;
      void doc?.destroy();
    };
  }, [file, pageCount]);

  return thumbnails;
}

/**
 * The deck itself, plus the note that appears once the thumbnail pass has
 * stopped short of the page count.
 *
 * `renderBadge` and `tileLabel` exist for `delete-pdf-pages`, whose selection
 * means the opposite of everyone else's: a selected tile is a doomed page, so
 * it needs its own corner marker and its own accessible name. The base name
 * stays `Page N` (an e2e locator pins `/^Page 1(,|$)/`), so any override must
 * keep that prefix and put the extra words after a comma.
 */
export function PdfPageDeck({
  pageCount,
  selected,
  onToggle,
  thumbnails,
  renderBadge,
  tileLabel,
}: {
  pageCount: number;
  /** 0-based page indices. */
  selected: Set<number>;
  onToggle: (idx: number) => void;
  thumbnails: string[];
  renderBadge?: (idx: number, isSelected: boolean) => ReactNode;
  tileLabel?: (idx: number, isSelected: boolean) => string;
}) {
  return (
    <>
      <PageDeck>
        {Array.from({ length: pageCount }, (_, idx) => {
          const isSelected = selected.has(idx);
          return (
            <PageTile
              key={idx}
              number={idx + 1}
              thumb={thumbnails[idx] || undefined}
              selected={isSelected}
              // Dimming marks pages the selection has left out. With nothing
              // selected yet there is nothing to contrast against, so a freshly
              // loaded deck would grey out whole and read as disabled.
              dimUnselected={selected.size > 0}
              label={tileLabel?.(idx, isSelected)}
              badge={renderBadge?.(idx, isSelected)}
              onClick={() => onToggle(idx)}
            />
          );
        })}
      </PageDeck>
      {pageCount > PDF_THUMBNAIL_LIMIT && (
        <p className="m-0 font-mono text-[9.5px] leading-none tracking-[0.06em] text-text-muted">
          THUMBNAILS RENDERED FOR THE FIRST {PDF_THUMBNAIL_LIMIT} OF {pageCount} PAGES — EVERY PAGE STAYS SELECTABLE VIA THE RANGE FIELD
        </p>
      )}
    </>
  );
}
