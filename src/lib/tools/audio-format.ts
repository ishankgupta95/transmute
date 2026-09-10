/**
 * ───────────────────────────────────────────────────────────────────────────
 * What the audio output formats ARE — with no engine attached
 * ───────────────────────────────────────────────────────────────────────────
 * Every fact here is needed by both halves of the cluster: `audio-convert.ts`,
 * which decodes and re-encodes, and `extract-audio.ts`, which mostly does not
 * decode at all. Neither may reach the other to get them.
 *
 * THIS FILE HAS NO IMPORTS, AND THAT IS THE POINT
 *   `extract-audio.ts` runs entirely inside FFmpeg. If it reached into
 *   `audio-convert.ts` for a constant, `/mp4-to-mp3`'s import closure would
 *   contain `decodeAudioFile` — and `size-claims.test.ts` walks exactly that
 *   closure to decide which drop zones are allowed to say "NO SIZE CAP".
 *   /mp4-to-mp3 mounts its input and never decodes in the tab, so its claim is
 *   true, and the gate was right to fail the version of this cluster that made
 *   the two files neighbours. A leaf with no imports keeps the answer honest,
 *   and keeps a bundler from putting a Web Audio decoder in the extractor's
 *   chunk.
 */

/**
 * The formats the audio worker pool can encode on its own — lamejs MP3 and the
 * hand-rolled WAV writer in audio-pcm.ts. `audio-trim.ts` and `audio-merge.ts`
 * declare exactly this union inline as `"wav" | "mp3"`; this is the same type
 * with a name.
 */
export type WorkerAudioFormat = "mp3" | "wav";

/** Every format `convertAudio` can produce. */
export type AudioOutputFormat = WorkerAudioFormat | "flac";

/** What the MP3 tools have always defaulted to, and what the pickers seed. */
export const DEFAULT_MP3_BITRATE = 192;

export interface AudioFormatSpec {
  /** Output extension, without the dot. */
  ext: string;
  mime: string;
  /** Which engine can produce it. */
  engine: "web-audio" | "ffmpeg";
  /**
   * FFmpeg's own encoder name for `-c:a`, which is NOT always the format name
   * — Opus would be `libopus`, not `opus`. Only the `ffmpeg` engine reads it.
   */
  codec?: string;
  /**
   * True when the format reproduces its input's samples bit-for-bit. Copy on
   * every page has to key off this and nothing else: WAV and FLAC are lossless
   * *containers for the decode they were given*, MP3 is not, and a page that
   * says "no quality loss" about an MP3 output is lying.
   */
  lossless: boolean;
}

/**
 * The whole format matrix, in one place, so a new page is a row rather than a
 * branch. `label` deliberately lives in the UI layer, not here — this module
 * decides bytes, not words.
 */
export const AUDIO_FORMAT_SPECS: Record<AudioOutputFormat, AudioFormatSpec> = {
  mp3: { ext: "mp3", mime: "audio/mpeg", engine: "web-audio", lossless: false },
  wav: { ext: "wav", mime: "audio/wav", engine: "web-audio", lossless: true },
  flac: { ext: "flac", mime: "audio/flac", engine: "ffmpeg", codec: "flac", lossless: true },
};

/** Output extension for a format, without the dot. */
export function audioOutputExtension(format: AudioOutputFormat): string {
  return AUDIO_FORMAT_SPECS[format].ext;
}

/** Whether a format keeps the decoded samples intact. */
export function isLosslessAudioFormat(format: AudioOutputFormat): boolean {
  return AUDIO_FORMAT_SPECS[format].lossless;
}

/**
 * The only `-compression_level` at which stereo `libopus` has EVER completed in
 * the shipped core — and, measured here, still not reliably.
 *
 * Measured 2026-09-04, headless Chromium, `public/ffmpeg-core.wasm`, one
 * `sample-audio.wav` stereo source:
 *
 *   fresh core, first job   -c:a libopus                        RuntimeError: memory access out of bounds
 *   fresh core, first job   -c:a libopus -compression_level 5   RuntimeError: memory access out of bounds
 *   fresh core, first job   -c:a libopus -compression_level 4   EXIT=0, 25 839 B
 *   fresh core, first job   -c:a libopus -compression_level 1   EXIT=0, 25 705 B
 *   fresh core, first job   -c:a libopus -compression_level 0   EXIT=0, 25 315 B
 *   fresh core, `-ac 1`, default level 10                       EXIT=0, 18 636 B
 *   after SIX unrelated jobs in the same instance,
 *                           -c:a libopus -compression_level 4   RuntimeError: memory access out of bounds
 *
 * The last line is why NO format in `AUDIO_FORMAT_SPECS` emits Opus: the
 * documented-safe level is safe on a cold core and not on a warm one, and a
 * trap does not fail one job — it poisons the whole FFmpeg instance until
 * `terminateFFmpeg` throws it away (see WASM_TRAP_SIGNATURES in
 * ffmpeg-loader.ts). Opus stays an INPUT format here, which is the case
 * `opus-to-mp3` actually needs.
 *
 * The constant and the guard below exist so that a future Opus encoder cannot
 * be added without at least the level that has a measurement behind it.
 */
export const OPUS_SAFE_COMPRESSION_LEVEL = 4;

/**
 * Refuse an argv that would hand stereo Opus to the trap above.
 *
 * Called on every FFmpeg argv this cluster builds — in `audio-convert.ts` and
 * in `extract-audio.ts` — rather than written into one table entry, so it also
 * covers whatever gets added next. Throwing is the right answer over silently
 * repairing the argv: a caller that reached for `libopus` wanted Opus, and the
 * honest outcome is a failure that names the reason, not a file the user did
 * not ask for.
 */
export function assertSafeFFmpegAudioArgs(args: readonly string[]): void {
  if (!args.includes("libopus")) return;
  const at = args.indexOf("-compression_level");
  const level = at === -1 ? Number.NaN : Number(args[at + 1]);
  if (Number.isFinite(level) && level <= OPUS_SAFE_COMPRESSION_LEVEL) return;
  throw new Error(
    `Refusing to encode Opus at compression level ${
      at === -1 ? "default (10)" : String(args[at + 1])
    }: this FFmpeg build crashes on stereo Opus above level ${OPUS_SAFE_COMPRESSION_LEVEL}, and the crash takes every other media tool in the tab down with it.`,
  );
}
