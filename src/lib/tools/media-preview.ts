/**
 * Canvas decoration for the media tools: the waveform behind the audio trimmer
 * and the filmstrip under the video ones.
 *
 * The Tool Redesign doc draws both, and `/workspace` fakes them with seeded
 * constants. These build the real thing from the user's own file — nothing here
 * touches the network, and neither result feeds the conversion, so a failure is
 * cosmetic and callers should degrade to no decoration rather than erroring.
 */

/** Resolve on `event`, reject on `error`, and never hang forever. */
function once(el: HTMLMediaElement, event: string, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      el.removeEventListener(event, onOk);
      el.removeEventListener("error", onErr);
      clearTimeout(timer);
    };
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error(`media ${event} failed`));
    };
    const timer = setTimeout(onErr, timeoutMs);
    el.addEventListener(event, onOk, { once: true });
    el.addEventListener("error", onErr, { once: true });
  });
}

export interface Waveform {
  /** One 0–1 amplitude per bar, normalised so the loudest bar is 1. */
  peaks: number[];
  duration: number;
}

/**
 * Decode the file and reduce channel 0 to `bars` peak amplitudes.
 *
 * This decodes the whole file, which is the same work the trim itself does, so
 * it is not extra cost the tool was not already paying — but it is off the main
 * thread only insofar as `decodeAudioData` is, so callers should show a
 * placeholder while it runs.
 */
export async function computeWaveform(file: File, bars: number): Promise<Waveform> {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) throw new Error("Web Audio is unavailable");

  const ctx = new Ctor();
  try {
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    const data = buffer.getChannelData(0);
    const block = Math.max(1, Math.floor(data.length / bars));
    const peaks: number[] = [];

    for (let i = 0; i < bars; i++) {
      const start = i * block;
      const end = Math.min(data.length, start + block);
      let max = 0;
      for (let j = start; j < end; j++) {
        const v = Math.abs(data[j]);
        if (v > max) max = v;
      }
      peaks.push(max);
    }

    // Normalise against the loudest bar so quiet recordings still read as a
    // waveform rather than a flat line.
    const ceiling = Math.max(...peaks, 1e-4);
    return { peaks: peaks.map((p) => p / ceiling), duration: buffer.duration };
  } finally {
    void ctx.close();
  }
}

/**
 * Grab `count` evenly spaced frames as JPEG data URLs, sampling the middle of
 * each slice so the first frame is never the black leader.
 */
export async function extractFilmstrip(file: File, count: number): Promise<string[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.preload = "auto";
  // Required on iOS Safari, which otherwise refuses to decode off-screen.
  video.playsInline = true;

  try {
    await once(video, "loadedmetadata");
    if (!Number.isFinite(video.duration) || video.duration <= 0) return [];

    const width = 96;
    const ratio = video.videoWidth ? video.videoHeight / video.videoWidth : 9 / 16;
    const height = Math.max(1, Math.round(width * ratio));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return [];

    const frames: string[] = [];
    for (let i = 0; i < count; i++) {
      const target = (video.duration * (i + 0.5)) / count;
      video.currentTime = Math.min(target, Math.max(0, video.duration - 0.05));
      try {
        await once(video, "seeked", 5000);
      } catch {
        break; // Container we can seek into no further — keep what we have.
      }
      ctx.drawImage(video, 0, 0, width, height);
      frames.push(canvas.toDataURL("image/jpeg", 0.5));
    }
    return frames;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** Collapse page numbers into the doc's compact `1-3, 5, 8-10` notation. */
export function toPageRange(pages: number[]): string {
  if (pages.length === 0) return "—";
  const sorted = [...pages].sort((a, b) => a - b);
  const runs: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (const p of sorted.slice(1)) {
    if (p === prev + 1) {
      prev = p;
      continue;
    }
    runs.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = p;
    prev = p;
  }
  runs.push(start === prev ? `${start}` : `${start}-${prev}`);
  return runs.join(", ");
}

/** Parse `1-3, 5, 8-10` into zero-based page indices, clamped to `pageCount`. */
export function parsePageRange(input: string, pageCount: number): Set<number> {
  const pages = new Set<number>();
  for (const part of input.split(",")) {
    const trimmed = part.trim();
    const match = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = parseInt(match[2], 10);
      for (let i = start; i <= end && i <= pageCount; i++) {
        if (i >= 1) pages.add(i - 1);
      }
    } else {
      const n = parseInt(trimmed, 10);
      if (n >= 1 && n <= pageCount) pages.add(n - 1);
    }
  }
  return pages;
}
