/**
 * Cancellation helpers shared by the hook layer and the processing libs.
 *
 * Everything long-running here — FFmpeg.wasm in a worker, WebCodecs encode
 * loops — signals cancellation the same way, so the UI can tell "the user
 * pressed Cancel" apart from "the conversion broke" with one check.
 */

/**
 * The rejection an aborted operation raises.
 *
 * Constructed explicitly rather than passing `signal.reason` through, so every
 * layer produces the same shape regardless of how the abort was raised.
 */
export function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

/** Bail out immediately if the caller has already cancelled. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

/** True for the rejection an `AbortSignal` produces, however it was raised. */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}
