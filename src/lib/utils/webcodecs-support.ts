/**
 * Whether this browser can ENCODE video in the page: VideoEncoder,
 * AudioEncoder, VideoFrame and requestVideoFrameCallback all present.
 *
 * Encode-specific on purpose — video-to-gif only decodes (it needs rVFC
 * alone), so it must not be gated on this predicate or Firefox would lose a
 * tool that works there today.
 *
 * A leaf with zero imports so worker entrypoints and the pre-flight UI can
 * share it. Every probe is typeof-guarded (including HTMLVideoElement, which
 * jsdom defines but SSR does not) so calling it anywhere is safe. Not
 * memoised — the answer can't change mid-session, but tests stub these
 * globals per case.
 */
export function isWebCodecsEncodeSupported(): boolean {
  return (
    typeof VideoEncoder !== "undefined" &&
    typeof AudioEncoder !== "undefined" &&
    typeof VideoFrame !== "undefined" &&
    typeof HTMLVideoElement !== "undefined" &&
    "requestVideoFrameCallback" in HTMLVideoElement.prototype
  );
}

/**
 * The one user-facing sentence for the missing-encoder case, shared by the
 * pre-flight banners and `assertWebCodecsSupported` so the page and the
 * post-click error can never disagree.
 */
export const WEBCODECS_UNSUPPORTED_MESSAGE =
  "This browser can't encode video in the page — it doesn't support the WebCodecs API. Please use Chrome or Edge.";
