/**
 * The canvas header's meta line.
 *
 * The Tool Redesign doc makes this a technical readout, not a byte count:
 * `4032 × 3024 · 4.28 MB` for an image, `1920 × 1080 · 00:47.2 · 28.6 MB` for
 * a video, `48 kHz · STEREO · 11:30 · 126 MB` for audio.
 *
 * Every helper here degrades to the facts it actually has. The doc also prints
 * a codec (`H.264`) and a colour space (`sRGB` / `RGBA`); nothing in this app
 * reads either, so neither is ever emitted — the readout states what was
 * measured and stops.
 */

export interface Dimensions {
  w: number;
  h: number;
}

/** Join the segments that exist, in the doc's order, with its separator. */
function join(parts: (string | null | undefined | false)[]): string {
  return parts.filter((p): p is string => Boolean(p)).join(" · ");
}

/** `4032 × 3024 · 4.28 MB`, or the size alone until the decode lands. */
export function imageMeta(dims: Dimensions | null, size: string): string {
  return join([dims && `${dims.w} × ${dims.h}`, size]);
}

/** `1920 × 1080 · 00:47.2 · 28.6 MB`. Codec is deliberately absent. */
export function videoMeta(
  dims: Dimensions | null,
  duration: string | null,
  size: string,
): string {
  return join([dims && `${dims.w} × ${dims.h}`, duration, size]);
}

/**
 * `48 kHz · STEREO · 11:30 · 126 MB`.
 *
 * The rate and channel count describe the DECODED buffer — the one the
 * encoders will see — because that is the only thing the browser exposes
 * without a container parser.
 */
export function audioMeta(
  stream: { sampleRate: number; channels: number } | null,
  duration: string | null,
  size: string,
): string {
  return join([
    stream && `${+(stream.sampleRate / 1000).toFixed(1)} kHz`,
    stream && (stream.channels === 1 ? "MONO" : stream.channels === 2 ? "STEREO" : `${stream.channels} CH`),
    duration,
    size,
  ]);
}
