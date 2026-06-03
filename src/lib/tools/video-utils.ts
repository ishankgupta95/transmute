/**
 * Shared helpers for video tools that use the <video> element
 * for hardware-accelerated frame decoding.
 */

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
 */
export async function playAndExtractFrames(
  video: HTMLVideoElement,
  startTime: number,
  endTime: number,
  onFrame: (video: HTMLVideoElement, timestampUs: number) => void | Promise<void>,
  onProgress?: (progress: number) => void,
): Promise<void> {
  // Attach to DOM (hidden) — rVFC requires the element to be connected
  video.style.position = "fixed";
  video.style.top = "-9999px";
  video.style.opacity = "0";
  video.style.pointerEvents = "none";
  document.body.appendChild(video);

  const duration = endTime - startTime;

  try {
    // Seek to start time
    if (startTime > 0) {
      await new Promise<void>((resolve) => {
        const onSeeked = () => { video.removeEventListener("seeked", onSeeked); resolve(); };
        video.addEventListener("seeked", onSeeked);
        video.currentTime = startTime;
      });
    }

    await new Promise<void>((resolve, reject) => {
      let stopped = false;

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
    video.pause();
    document.body.removeChild(video);
  }
}
