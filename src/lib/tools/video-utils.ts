/**
 * Shared helpers for video tools that use the <video> element
 * for hardware-accelerated frame decoding.
 */

import type { ProcessingContext } from "@/hooks/useFileProcessor";
import { abortError, throwIfAborted } from "@/lib/utils/abort";

/**
 * Create a muted, off-screen video element.
 */
export function createVideo(src: string): HTMLVideoElement {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = src;
  return video;
}

/**
 * Wait until the video can play through without buffering.
 */
export function waitForReady(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 3) { resolve(); return; }
    video.oncanplay = () => resolve();
    video.onerror = () => reject(new Error("Failed to load video"));
  });
}

/**
 * The real duration of a loaded video, recovering it when the container does
 * not declare one.
 *
 * A MediaRecorder WebM written with a timeslice — exactly what Transmute's own
 * /screen-recorder produces (`recorder.start(1000)`) — carries no Duration
 * element, so the browser reports `Infinity` forever. Seeking past the end
 * forces the demuxer to walk the clusters and resolve the real value, which it
 * then announces with `durationchange`.
 *
 * Must be called AFTER `waitForReady` (it seeks, which needs a loaded element)
 * and BEFORE `playAndExtractFrames` (which drives `currentTime` itself). The
 * playhead is put back to 0 before this resolves.
 *
 * Falls back to whatever the element reports after `timeoutMs` — callers still
 * guard on a non-finite result, which is now the genuine "unreadable" case.
 */
export function resolveDuration(video: HTMLVideoElement, timeoutMs = 5000): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) {
    return Promise.resolve(video.duration);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: number) => {
      if (settled) return;
      settled = true;
      video.removeEventListener("durationchange", onDurationChange);
      clearTimeout(timer);
      resolve(value);
    };
    const onDurationChange = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      const resolved = video.duration;
      // The probe seek left the playhead past the end; rewind before any
      // caller starts walking frames.
      try { video.currentTime = 0; } catch { /* element may not be seekable */ }
      finish(resolved);
    };
    const timer = setTimeout(() => finish(video.duration), timeoutMs);
    video.addEventListener("durationchange", onDurationChange);
    try {
      video.currentTime = 1e101;
    } catch {
      finish(video.duration);
    }
  });
}

/**
 * Detect whether a file contains an audio track by attempting to decode it.
 * Always closes the AudioContext (browsers cap concurrent contexts at ~6).
 */
export async function detectAudio(file: File): Promise<boolean> {
  const audioCtx = new AudioContext();
  try {
    const buf = await file.arrayBuffer();
    await audioCtx.decodeAudioData(buf);
    return true;
  } catch {
    return false;
  } finally {
    await audioCtx.close();
  }
}

/**
 * Decode a file's audio to PCM once and return it (or null if it has no
 * decodable audio). Lets callers test for audio AND reuse the buffer instead of
 * decoding the whole file twice. Always closes the AudioContext.
 */
export async function decodeAudio(file: File): Promise<AudioBuffer | null> {
  const audioCtx = new AudioContext({ sampleRate: 48000 });
  try {
    const buf = await file.arrayBuffer();
    const decoded = await audioCtx.decodeAudioData(buf);
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  } finally {
    await audioCtx.close();
  }
}

/**
 * Throw a clear, user-facing error if the browser lacks the WebCodecs encode
 * APIs these tools rely on (Firefox has no VideoEncoder / requestVideoFrameCallback).
 */
export function assertWebCodecsSupported(): void {
  const ok =
    typeof VideoEncoder !== "undefined" &&
    typeof AudioEncoder !== "undefined" &&
    typeof VideoFrame !== "undefined" &&
    "requestVideoFrameCallback" in HTMLVideoElement.prototype;
  if (!ok) {
    throw new Error(
      "In-browser video encoding isn't supported in this browser. Please use Chrome or Edge.",
    );
  }
}

/**
 * Pick an H.264 encoder config the current device actually supports, trying
 * high → main → baseline profiles and hardware → software acceleration.
 */
export async function pickH264Config(base: {
  width: number;
  height: number;
  bitrate: number;
  framerate: number;
}): Promise<VideoEncoderConfig> {
  const codecs = ["avc1.640034", "avc1.4D4028", "avc1.42E01E"]; // High 5.2, Main 4.0, Baseline 3.0
  const accelerations: HardwareAcceleration[] = ["prefer-hardware", "no-preference"];
  for (const hardwareAcceleration of accelerations) {
    for (const codec of codecs) {
      const config: VideoEncoderConfig = { codec, ...base, hardwareAcceleration };
      try {
        const support = await VideoEncoder.isConfigSupported(config);
        if (support.supported) return config;
      } catch {
        /* try the next combination */
      }
    }
  }
  throw new Error("This browser can't encode H.264 video. Please try Chrome or Edge.");
}

/**
 * Play the video and invoke `onFrame` for each presented frame via
 * `requestVideoFrameCallback`. This is the correct way to extract frames:
 * - The browser decodes at native speed (HW-accelerated)
 * - No redundant work (unlike seek-per-frame which re-decodes from keyframes)
 * - Backpressure: we pause playback while the callback runs, preventing
 *   memory buildup from unbounded encoder queues.
 *
 * The video must be attached to the DOM for rVFC to fire.
 *
 * `ctx.signal` cancels the walk: playback stops and the returned promise
 * rejects with an `AbortError`. Both waits here — the initial seek and the
 * frame loop — are event-driven with no timeout, so each needs its own abort
 * listener or a cancel mid-seek would simply be ignored.
 */
export async function playAndExtractFrames(
  video: HTMLVideoElement,
  startTime: number,
  endTime: number,
  onFrame: (video: HTMLVideoElement, timestampUs: number) => void | Promise<void>,
  { onProgress, signal }: ProcessingContext = {},
): Promise<void> {
  throwIfAborted(signal);

  // Attach to DOM (hidden) — rVFC requires the element to be connected
  video.style.position = "fixed";
  video.style.top = "-9999px";
  video.style.opacity = "0";
  video.style.pointerEvents = "none";
  document.body.appendChild(video);

  const duration = endTime - startTime;
  let abortRun: (() => void) | null = null;

  try {
    // Seek to start time
    if (startTime > 0) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          video.removeEventListener("seeked", onSeeked);
          signal?.removeEventListener("abort", onAbort);
        };
        const onSeeked = () => { cleanup(); resolve(); };
        const onAbort = () => { cleanup(); reject(abortError()); };
        video.addEventListener("seeked", onSeeked);
        signal?.addEventListener("abort", onAbort, { once: true });
        video.currentTime = startTime;
      });
    }

    await new Promise<void>((resolve, reject) => {
      let stopped = false;

      abortRun = () => {
        if (stopped) return;
        stopped = true;
        video.pause();
        reject(abortError());
      };
      signal?.addEventListener("abort", abortRun);

      const processFrame = async () => {
        if (stopped) return;

        const currentTime = video.currentTime;
        if (currentTime >= endTime) {
          stopped = true;
          video.pause();
          resolve();
          return;
        }

        // Pause to apply backpressure while we process this frame
        video.pause();

        const timestampUs = Math.round((currentTime - startTime) * 1_000_000);
        try {
          await onFrame(video, timestampUs);
        } catch (err) {
          stopped = true;
          reject(err);
          return;
        }

        // `onFrame` can take a while; a cancel during it must not schedule
        // another frame.
        if (stopped) return;

        const elapsed = currentTime - startTime;
        onProgress?.(Math.round((elapsed / duration) * 100));

        // Resume playback and request next frame
        video.requestVideoFrameCallback(processFrame);
        video.play().catch(() => { /* ignore autoplay issues */ });
      };

      video.onended = () => {
        if (!stopped) { stopped = true; resolve(); }
      };

      video.onerror = () => {
        if (!stopped) { stopped = true; reject(new Error("Video playback error")); }
      };

      // Kick off: request first frame callback, then start playing
      video.requestVideoFrameCallback(processFrame);
      video.play().catch(reject);
    });
  } finally {
    if (abortRun) signal?.removeEventListener("abort", abortRun);
    video.pause();
    document.body.removeChild(video);
  }
}
