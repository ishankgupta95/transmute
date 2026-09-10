"use client";

import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/useIsClient";

/** The rotating proof panel: a real route, its real engine, and what it costs. */
const LIVE = [
  {
    from: "HEIC",
    to: "JPG",
    inMeta: "4032 × 3024\n4.28 MB",
    outMeta: "same\n1.42 MB",
    note: "iPhone photos into a format every device on earth already opens.",
    engine: "CANVAS 2D",
    time: "~0.3 s / photo",
  },
  {
    from: "MP4",
    to: "GIF",
    inMeta: "00:47.2\n28.6 MB",
    outMeta: "480 px · 15 fps\n10.9 MB",
    note: "Trim on a filmstrip, pick a frame rate, watch the size before you commit.",
    // Not FFmpeg: video-to-gif decodes with the native <video> element and
    // encodes with gifenc. See the ENGINES table on the homepage.
    engine: "CANVAS 2D · GIFENC",
    time: "~9 s / 5 s clip",
  },
  {
    from: "PDF",
    to: "PDF",
    inMeta: "4 files\n61 pages",
    outMeta: "1 file\n8.9 MB",
    note: "Merge, split, rotate, reorder and compress — page thumbnails, no upload.",
    engine: "PDF-LIB",
    // The old "~1.2 s / 100 p" was timed against MuPDF's WASM, which this app
    // no longer ships; carrying that number over to a pure-JS engine would be
    // inventing a measurement. What replaced it is bounded rather than precise:
    // pdf-lib merging four 25-page documents and re-saving them measures ~12 ms
    // here, and rotating 100 pages ~14 ms, so "under a second" holds with room
    // for the file read, the worker hop, and pages far heavier than a test
    // fixture's. Re-time it before making the claim any tighter.
    time: "under a second / 100 p",
  },
  {
    from: "WAV",
    to: "MP3",
    inMeta: "48 kHz stereo\n126 MB",
    outMeta: "192 kbps\n7.4 MB",
    note: "Scrub the waveform, set in and out, export at the bitrate you want.",
    engine: "WEB AUDIO",
    time: "~2 s / minute",
  },
  {
    /*
      This was MOV -> MP4 and described a WebCodecs GPU re-encode. Since
      `mov-to-mp4` shipped that is a stream copy through FFmpeg — no decode, no
      GPU, milliseconds — so the row was advertising the wrong engine for a
      page that now exists. WEBM -> MP4 is the conversion that really is
      WebCodecs (`webm-to-mp4`), so the claim moved to the tool it is true of.
    */
    from: "WEBM",
    to: "MP4",
    inMeta: "VP9 1080p\n420 MB",
    outMeta: "H.264 1080p\n84 MB",
    note: "Re-encoded with WebCodecs on your own GPU, not in a queue behind other people.",
    engine: "WEBCODECS",
    time: "~0.4× realtime",
  },
  {
    from: "JSON",
    to: "CSV",
    inMeta: "2 400 records\n1.1 MB",
    outMeta: "18 columns\n612 KB",
    note: "Nested payloads flattened to columns, with the error line called out.",
    engine: "NATIVE JS",
    time: "instant",
  },
] as const;

const ROW =
  "flex justify-between bg-bg-primary px-3.5 py-2.5 font-mono text-[11px] leading-none";

/*
  The doc swaps the two big format words on `tmSlide .45s cubic-bezier(.2,.7,.3,1)`.
  The shared `animate-tm-rise` token runs the same curve at 0.3s and is imported by
  five other components, so the duration is corrected here against the same keyframe
  rather than by retuning the token. tm-rise travels 8px where tmSlide travels 6px —
  closing that last 2px needs a keyframe in globals.css, which this pass does not own.
*/
const FORMAT_SWAP = "animate-tm-slide";

export function LiveEngine() {
  // Auto-rotating content above the fold is exactly what WCAG 2.2.2 is about:
  // with the preference set the panel holds on one entry and every animation
  // in it stops, matching the sibling HeroSearch typewriter.
  const reduced = usePrefersReducedMotion();
  const [i, setI] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setI((n) => (n + 1) % LIVE.length), 3200);
    return () => clearInterval(id);
  }, [reduced]);

  const live = LIVE[i];

  return (
    <div className="overflow-hidden rounded-[14px] bg-nocturne-sunken shadow-[0_0_0_1px_var(--color-neutral-800),0_24px_60px_rgba(0,0,0,.55)]">
      <div className="flex h-[34px] items-center justify-between border-b border-border px-3.5 font-mono text-[9.5px] leading-none font-medium tracking-[0.14em] text-text-muted">
        <span>LIVE ENGINE</span>
        <span className="flex items-center gap-1.5">
          <span className="size-[5px] animate-[tm-blink-deep_1.6s_ease-in-out_infinite] rounded-full bg-accent motion-reduce:animate-none" />
          RUNNING
        </span>
      </div>

      <div className="relative flex justify-center overflow-hidden px-4 pt-[38px] pb-[34px] sm:px-[26px]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(233,233,237,.06)_1px,transparent_0)] bg-[length:20px_20px] opacity-60" />

        {/*
          Fluid, capped at the design's 331px. Fixed widths (176 + 5 + 150)
          overran the card below ~380px and `overflow-hidden` sliced the accent
          bracket and the arc off both ends. 53% + 45% + the 5px seam fits at
          320 and still hits the cap on desktop.
        */}
        <div className="relative flex h-[250px] w-full max-w-[331px] items-stretch">
          {/* IN — the file as it arrived: square, still open. */}
          <div className="flex w-[53%] min-w-0 flex-col justify-center gap-[9px] border-2 border-r-0 border-accent px-3 sm:px-5">
            <span className="font-mono text-[9.5px] leading-none font-medium tracking-[0.16em] text-text-muted">
              IN
            </span>
            <span
              key={`in-${i}`}
              className={`${FORMAT_SWAP} font-mono text-[40px] leading-none font-medium tracking-[-0.01em] whitespace-pre-line text-neutral-200 motion-reduce:animate-none`}
            >
              {live.from}
            </span>
            <span className="font-mono text-[10.5px] leading-[1.45] whitespace-pre-line text-text-muted">
              {live.inMeta}
            </span>
          </div>

          {/* The seam — the same gap the logo carries. */}
          <div className="relative w-[5px] flex-none">
            <span className="absolute -top-2 -bottom-2 left-0.5 w-[1.5px] animate-tm-seam bg-accent motion-reduce:animate-none shadow-[0_0_16px_2px_color-mix(in_srgb,var(--color-accent)_70%,transparent)]" />
          </div>

          {/* OUT — resolved into the arc. */}
          <div className="flex w-[45%] min-w-0 flex-col justify-center gap-[9px] rounded-r-full border-2 border-l-0 border-accent bg-accent/22 px-3 sm:px-[18px]">
            <span className="font-mono text-[9.5px] leading-none font-medium tracking-[0.16em] text-accent-200/70">
              OUT
            </span>
            <span
              key={`out-${i}`}
              className={`${FORMAT_SWAP} font-mono text-[40px] leading-none font-medium tracking-[-0.01em] whitespace-pre-line text-accent-200 motion-reduce:animate-none`}
            >
              {live.to}
            </span>
            <span className="font-mono text-[10.5px] leading-[1.45] whitespace-pre-line text-accent-300">
              {live.outMeta}
            </span>
          </div>
        </div>
      </div>

      <div className="px-5 pb-4.5">
        <p className="m-0 min-h-[38px] text-center font-body text-xs leading-[1.55] text-text-muted">
          {live.note}
        </p>
      </div>

      <div className="flex flex-col gap-px border-t border-border bg-border">
        <div className={ROW}>
          <span className="text-text-muted">RUNS ON</span>
          <span className="text-neutral-300">{live.engine}</span>
        </div>
        <div className={ROW}>
          <span className="text-text-muted">TYPICAL TIME</span>
          <span className="text-neutral-300">{live.time}</span>
        </div>
        <div className={ROW}>
          <span className="text-text-muted">BYTES SENT</span>
          <span className="text-success">0</span>
        </div>
      </div>
    </div>
  );
}
