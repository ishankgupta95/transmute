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
 */
export async function detectAudio(file: File): Promise<boolean> {
  try {
    const audioCtx = new AudioContext();
    const buf = await file.arrayBuffer();
    await audioCtx.decodeAudioData(buf);
    await audioCtx.close();
    return true;
  } catch {
    return false;
  }
}

export interface FrameCallbackInfo {
  timestamp: number; // microseconds
  done: boolean;
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
