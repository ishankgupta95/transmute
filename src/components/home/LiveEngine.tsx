"use client";

import { useEffect, useState } from "react";

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
    engine: "FFMPEG WASM",
    time: "~9 s / 5 s clip",
  },
  {
    from: "PDF",
    to: "PDF",
    inMeta: "4 files\n61 pages",
    outMeta: "1 file\n8.9 MB",
    note: "Merge, split, rotate, reorder and compress — page thumbnails, no upload.",
    engine: "MUPDF WASM",
    time: "~1.2 s / 100 p",
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
    from: "MOV",
    to: "MP4",
    inMeta: "ProRes 4K\n1.2 GB",
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

export function LiveEngine() {
  const [i, setI] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % LIVE.length), 3200);
    return () => clearInterval(id);
  }, []);

  const live = LIVE[i];

  return (
    <div className="overflow-hidden rounded-[14px] bg-nocturne-sunken shadow-[0_0_0_1px_var(--color-neutral-800),0_24px_60px_rgba(0,0,0,.55)]">
      <div className="flex h-[34px] items-center justify-between border-b border-border px-3.5 font-mono text-[9.5px] leading-none font-medium tracking-[0.14em] text-text-muted">
        <span>LIVE ENGINE</span>
        <span className="flex items-center gap-1.5">
          <span className="size-[5px] animate-tm-blink rounded-full bg-accent" />
          RUNNING
        </span>
      </div>

      <div className="relative flex justify-center overflow-hidden px-6 pt-9 pb-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(233,233,237,.06)_1px,transparent_0)] bg-[length:20px_20px] opacity-60" />

        <div className="relative flex h-[250px] items-stretch" aria-live="polite">
          {/* IN — the file as it arrived: square, still open. */}
          <div className="flex w-[176px] flex-col justify-center gap-[9px] border-2 border-r-0 border-accent px-5">
            <span className="font-mono text-[9.5px] leading-none font-medium tracking-[0.16em] text-text-muted">
              IN
            </span>
            <span
              key={`in-${i}`}
              className="animate-tm-rise font-mono text-[40px] leading-none font-medium tracking-[-0.01em] whitespace-pre-line text-neutral-200"
            >
              {live.from}
            </span>
            <span className="font-mono text-[10.5px] leading-[1.45] whitespace-pre-line text-text-muted">
              {live.inMeta}
            </span>
          </div>

          {/* The seam — the same gap the logo carries. */}
          <div className="relative w-[5px] flex-none">
            <span className="absolute -top-2 -bottom-2 left-0.5 w-[1.5px] animate-tm-glow bg-accent shadow-[0_0_16px_2px_color-mix(in_srgb,var(--color-accent)_70%,transparent)]" />
          </div>

          {/* OUT — resolved into the arc. */}
          <div className="flex w-[150px] flex-col justify-center gap-[9px] rounded-r-[150px] border-2 border-l-0 border-accent bg-accent/22 px-[18px]">
            <span className="font-mono text-[9.5px] leading-none font-medium tracking-[0.16em] text-accent-200/70">
              OUT
            </span>
            <span
              key={`out-${i}`}
              className="animate-tm-rise font-mono text-[40px] leading-none font-medium tracking-[-0.01em] whitespace-pre-line text-accent-200"
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
