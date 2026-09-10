import { extractAudio } from "./extract-audio";
import type { ProcessedResult, ProcessingContext } from "@/hooks/useFileProcessor";

export interface Mp4ToMp3Options {
  bitrate: number;
}

/**
 * Extract an MP4's audio as MP3.
 *
 * The engine moved to `extract-audio.ts`, which does the same thing for every
 * container FFmpeg can demux and for outputs other than MP3 — including the
 * arm that lifts the audio out without re-encoding it at all. This file is the
 * `/mp4-to-mp3` page's entry point and nothing more.
 *
 * Two things about the shared engine are visible here and worth naming. It
 * probes the file first, so a video with no audio track now says exactly that
 * instead of "FFmpeg audio extraction failed"; and it passes `-map 0:a:0`,
 * which pins the extraction to the FIRST audio stream rather than whichever
 * one FFmpeg's default selection calls best.
 */
export async function mp4ToMp3(
  file: File,
  options: Mp4ToMp3Options,
  ctx: ProcessingContext = {},
): Promise<ProcessedResult> {
  return extractAudio(file, { format: "mp3", bitrate: options.bitrate }, ctx);
}
