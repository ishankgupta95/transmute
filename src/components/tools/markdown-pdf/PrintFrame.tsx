"use client";

import { useEffect, useRef } from "react";

interface PrintFrameProps {
  /** Fully self-contained HTML document (head + body + inline <style>). */
  html: string;
  /** Fired when the print dialog closes (via afterprint) or fails to open. */
  onDone: () => void;
}

/**
 * Off-screen iframe that loads a self-contained HTML doc and triggers
 * `window.print()` once its fonts have settled. The iframe is unmounted by
 * the parent on `onDone`, so this component is intentionally short-lived.
 */
export function PrintFrame({ html, onDone }: PrintFrameProps) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;

    let cancelled = false;
    let cleanup: (() => void) | null = null;

    const triggerPrint = async () => {
      const win = iframe.contentWindow;
      const doc = iframe.contentDocument;
      if (!win || !doc) {
        onDone();
        return;
      }

      doc.open();
      doc.write(html);
      doc.close();

      // Wait for web fonts to load before printing — otherwise the layout
      // settles after the print snapshot is taken and the PDF ends up using
      // fallback fonts.
      try {
        if (doc.fonts && typeof doc.fonts.ready?.then === "function") {
          await Promise.race([
            doc.fonts.ready,
            new Promise((r) => setTimeout(r, 3000)),
          ]);
        }
      } catch {
        // Some browsers throw on document.fonts in iframes — proceed anyway.
      }

      if (cancelled) return;

      const handleAfterPrint = () => {
        win.removeEventListener("afterprint", handleAfterPrint);
        onDone();
      };
      win.addEventListener("afterprint", handleAfterPrint);
      cleanup = () => win.removeEventListener("afterprint", handleAfterPrint);

      // Edge case: some browsers fire afterprint synchronously, others not at
      // all (Safari with cancelled dialog). Belt-and-braces fallback timer.
      const fallback = setTimeout(() => {
        if (!cancelled) onDone();
      }, 60_000);
      cleanup = () => {
        clearTimeout(fallback);
        win.removeEventListener("afterprint", handleAfterPrint);
      };

      win.focus();
      win.print();
    };

    triggerPrint();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [html, onDone]);

  return (
    <iframe
      ref={ref}
      title="Markdown to PDF print preview"
      aria-hidden="true"
      className="absolute -left-[9999px] top-0 h-0 w-0 border-0"
    />
  );
}
