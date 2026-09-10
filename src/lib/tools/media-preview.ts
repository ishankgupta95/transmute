/**
 * Canvas decoration for the media tools: the waveform behind the audio trimmer
 * and the filmstrip under the video ones.
 *
 * The Tool Redesign doc draws both, and `/workspace` fakes them with seeded
 * constants. These build the real thing from the user's own file — nothing here
 * touches the network, and neither result feeds the conversion, so a failure is
 * cosmetic and callers should degrade to no decoration rather than erroring.
 */

// The header sniffer only, never `decodeAudioFile` — see the long note on
// `computeWaveform`. `sniffSampleRate` is a pure byte-walk over bytes this
// module has already read, so it costs nothing and pulls no engine.
import { sniffSampleRate } from "@/lib/tools/audio-decode";

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
  /**
   * Stream facts for the canvas header's technical readout
   * ("48 kHz · STEREO · 11:30 · 126 MB" in the Tool Redesign doc).
   *
   * `sampleRate` is the rate stored in the FILE's own container header, read
   * by `sniffSampleRate`. It deliberately is not `buffer.sampleRate`: this
   * function decodes through a plain `AudioContext`, which resamples to the
   * DEVICE's output rate, so that number described the machine rather than the
   * file — a 96 kHz master read "48 kHz" while every conversion arm on the
   * page went on to write 96 kHz, because `decodeAudioFile` sniffs the source
   * rate and decodes through an `OfflineAudioContext` at it (and the FLAC arm
   * never decodes in the tab at all).
   *
   * The one residual is a container `sniffSampleRate` cannot read: there is no
   * second source for the number, so the decoded buffer's rate stands in.
   * `channels` and `duration` survive resampling, so they are read off the
   * buffer either way.
   */
  sampleRate: number;
  channels: number;
}

/**
 * Decode the file and reduce channel 0 to `bars` peak amplitudes.
 *
 * This decodes the whole file, which is the same work the trim itself does, so
 * it is not extra cost the tool was not already paying — but it is off the main
 * thread only insofar as `decodeAudioData` is, so callers should show a
 * placeholder while it runs.
 *
 * ── Why this does NOT call `decodeAudioFile` ─────────────────────────────
 * `lib/tools/audio-decode`'s `decodeAudioFile` has a second tier: when the
 * browser's own decoder rejects a container on its allowlist (AAC/M4A in
 * Firefox, Ogg in Safari) it transcodes through FFmpeg.wasm. Routing the
 * waveform through it would make the two paths agree — a file whose
 * conversion succeeds would also draw a waveform instead of the caller's
 * "preview unavailable" state — and it is tempting, because the conversion
 * for exactly those files pulls the same engine.
 *
 * It is deliberately not done, on two counts:
 *
 * 1. Cost. The waveform is decoration behind a file the user has only
 *    *dropped*, not yet converted. Reaching the fallback pulls the ~31 MB
 *    FFmpeg core speculatively — spent in full even when the user then
 *    changes their mind and never presses the button.
 * 2. Contention. FFmpeg is a single, serialised singleton
 *    (`lib/tools/ffmpeg-loader`: one instance, one virtual FS, one FIFO
 *    queue). A preview transcode sitting on that queue sits *in front of*
 *    the conversion the user actually asked for, and then the conversion
 *    transcodes the same bytes a second time. Nothing this module can see
 *    lets it yield that queue to a real job.
 *
 * There is no cheaper bridge: on Firefox no browser API decodes AAC at all,
 * so the choice really is "31 MB for decoration" or "no decoration". The
 * asymmetry with `decodeAudioFile` is therefore intended — that path pays
 * because the user asked for the output; this one declines because nobody
 * did. Callers already degrade to a flat/absent waveform and say so.
 */
export async function computeWaveform(file: File, bars: number): Promise<Waveform> {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) throw new Error("Web Audio is unavailable");

  const arrayBuffer = await file.arrayBuffer();
  // Read the container's own rate BEFORE the decode: decodeAudioData detaches
  // its input, and the rate it hands back is the device's, not the file's.
  const containerRate = sniffSampleRate(new Uint8Array(arrayBuffer));

  const ctx = new Ctor();
  try {
    const buffer = await ctx.decodeAudioData(arrayBuffer);
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
    return {
      peaks: peaks.map((p) => p / ceiling),
      duration: buffer.duration,
      sampleRate: containerRate ?? buffer.sampleRate,
      channels: buffer.numberOfChannels,
    };
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
