/**
 * Shared helpers for video tools that use the <video> element
 * for hardware-accelerated frame decoding.
 */

import type { ProcessingContext } from "@/hooks/useFileProcessor";
import { abortError, throwIfAborted } from "@/lib/utils/abort";
import {
  isWebCodecsEncodeSupported,
  WEBCODECS_UNSUPPORTED_MESSAGE,
} from "@/lib/utils/webcodecs-support";

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
 * APIs these tools rely on. The predicate lives in `utils/webcodecs-support`
 * so the tool UIs can warn before the click with the exact same words.
 */
export function assertWebCodecsSupported(): void {
  if (!isWebCodecsEncodeSupported()) {
    throw new Error(WEBCODECS_UNSUPPORTED_MESSAGE);
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
 *
 * ── WHY THE WALK ENDS ON `ended` AND DOES NOT CHASE THE LAST PLANNED MOMENT ──
 *
 * This was carried as a defect — "a planned moment inside the final GOP whose
 * `requestVideoFrameCallback` has not been delivered is lost", shared by
 * /video-to-gif, /compress-video, /video-to-images and /webm-to-mp4. It was
 * measured in headless Chromium against the checked-in fixtures rather than
 * repaired, because it does not reproduce and the sketched repair is worse:
 *
 *   · `sample-video.mp4`'s video track is 48 samples of 2400/57600 s (one
 *     `stts` entry), so its PICTURE ends at exactly 2.000000 s. The 2.089796 s
 *     that `video.duration` reports is the AUDIO track (`mdhd` timescale 44100,
 *     duration 92160). The two are not the same number and nothing in the
 *     platform tells a caller that.
 *   · rVFC delivered every one of those 48 pictures — last `mediaTime`
 *     1.958333 — before `ended` fired at currentTime 2.089796, in 8 of 8 runs,
 *     both unthrottled and through this exact pause/`onFrame`/play loop.
 *     Nothing outstanding was dropped. `sample-video.webm` behaves the same
 *     (46 of 46, last `mediaTime` 1.886 against a duration of 1.886312 — the
 *     hardest case for the race, since its last picture lands ON the end).
 *   · So the moment /video-to-images discloses as missing — 2.000 s, planned
 *     off `duration` — is a moment the file has no picture at. No walk can
 *     deliver it.
 *   · Seeking to 2.000 s after `ended` and awaiting one more frame callback
 *     DOES get a callback. It carries `mediaTime` 1.958333 and a pixel-
 *     identical picture to the frame already saved. "Recovering" it would file
 *     a duplicate of the last frame under a timestamp the clip has no picture
 *     at, and would silence a warning that is currently true.
 *
 * A bounded post-`ended` wait is not forbidden by anything here; an UNBOUNDED
 * one is, and `video-utils.test.ts` pins that this promise still settles when
 * the queued callback never arrives.
 *
 * The frame that IS measurably lost sits at the OTHER end. rVFC fires only for
 * newly PRESENTED frames, and the frame at the start position has already been
 * presented by the time `waitForReady` — or the seek below — resolves. So every
 * caller's first delivery is the SECOND picture: first `mediaTime` 0.041667 on
 * the MP4 and 0.041 on the WebM, in every run, never 0. Closing that means
 * handing over the displayed frame before playback starts, which changes the
 * frame count of four shipped tools and their fixture-count assertions; it is
 * deliberately left alone here rather than folded into an unrelated fix.
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

      /*
        ⚠ THE PARAMETERS ARE LOAD-BEARING, AND THEY WERE MISSING UNTIL 2026-09-13.

        `requestVideoFrameCallback` hands its callback `(now, metadata)`, and
        `metadata.mediaTime` is the PRESENTATION TIMESTAMP of the frame being
        handed over. This callback used to take no parameters at all and read
        `video.currentTime` instead — the playhead, sampled whenever the
        callback happened to be dispatched, which is not the same number and is
        not even biased the same way between engines.

        Measured on `sample-video.mp4` (24 fps, 41.667 ms per frame):
          · Chromium: `currentTime - mediaTime` ranges −28.3 ms to −10.8 ms
          · WebKit  : the same quantity ranges  +0.9 ms to +32.0 ms
        So the error is comparable to a whole frame period and points in
        OPPOSITE directions depending on the engine. Any consumer comparing a
        frame's time against a planned moment was therefore deciding on a
        drifting clock — which is exactly how `frame-export.spec.ts` came to
        fail about two runs in three, with a different symptom per project.

        `mediaTime` is a property of the frame. It does not drift.
      */
      const processFrame = async (_now?: number, metadata?: { mediaTime?: number }) => {
        if (stopped) return;

        /*
          The playhead still decides when to STOP: `endTime` bounds the window
          playback is walking, and `currentTime` is what walks it. `mediaTime`
          lags it by up to a frame, so ending on `mediaTime` would run the walk
          fractionally past its window. The two numbers answer two questions
          and this is the one `currentTime` is right for.
        */
        const currentTime = video.currentTime;
        if (currentTime >= endTime) {
          stopped = true;
          video.pause();
          resolve();
          return;
        }

        // Pause to apply backpressure while we process this frame
        video.pause();

        /*
          …and the frame's own timestamp is what identifies the PICTURE. The
          fallback exists because `metadata` is typed optional here (the
          callback signature is not in TypeScript's DOM lib and is declared by
          hand); every engine that implements rVFC supplies it — verified in
          Chromium and WebKit — so the fallback is a type guard rather than a
          supported path.
        */
        const frameTime = typeof metadata?.mediaTime === "number" ? metadata.mediaTime : currentTime;
        const timestampUs = Math.round((frameTime - startTime) * 1_000_000);
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
