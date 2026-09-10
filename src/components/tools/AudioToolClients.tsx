"use client";

import dynamic from "next/dynamic";
import type { Tool } from "@/data/tools";
import type { AudioOutputFormat } from "@/lib/tools/audio-format";
import type { ExtractAudioFormat } from "@/lib/tools/extract-audio";

const AudioConverterUI = dynamic(() => import("./AudioConverterUI").then((m) => ({ default: m.AudioConverterUI })), { ssr: false });
const AudioTrimmerUI = dynamic(() => import("./AudioTrimmerUI").then((m) => ({ default: m.AudioTrimmerUI })), { ssr: false });
const AudioMergerUI = dynamic(() => import("./AudioMergerUI").then((m) => ({ default: m.AudioMergerUI })), { ssr: false });
const ExtractAudioUI = dynamic(() => import("./ExtractAudioUI").then((m) => ({ default: m.ExtractAudioUI })), { ssr: false });
/*
  The five audio-effects pages. Each is a single-slug tool with no
  registry-driven variant — one component, no props — so the wrappers below are
  the whole seam. They stay `ssr: false` for the same reason every other tool
  UI does: these mount Web Audio, `MediaRecorder` and (behind their own dynamic
  imports) the FFmpeg loader, none of which exists on the server.
*/
const NormalizeAudioUI = dynamic(() => import("./NormalizeAudioUI").then((m) => ({ default: m.NormalizeAudioUI })), { ssr: false });
const ChangeAudioVolumeUI = dynamic(() => import("./ChangeAudioVolumeUI").then((m) => ({ default: m.ChangeAudioVolumeUI })), { ssr: false });
const ReverseAudioUI = dynamic(() => import("./ReverseAudioUI").then((m) => ({ default: m.ReverseAudioUI })), { ssr: false });
const RemoveSilenceUI = dynamic(() => import("./RemoveSilenceUI").then((m) => ({ default: m.RemoveSilenceUI })), { ssr: false });
const AudioRecorderUI = dynamic(() => import("./AudioRecorderUI").then((m) => ({ default: m.AudioRecorderUI })), { ssr: false });

const AUDIO_OUTPUT_FORMATS = ["mp3", "wav", "flac"] as const;
const EXTRACT_AUDIO_FORMATS = ["original", "mp3", "wav"] as const;

function isAudioOutputFormat(value: string | undefined): value is AudioOutputFormat {
  return AUDIO_OUTPUT_FORMATS.includes(value as AudioOutputFormat);
}

function isExtractAudioFormat(value: string | undefined): value is ExtractAudioFormat {
  return EXTRACT_AUDIO_FORMATS.includes(value as ExtractAudioFormat);
}

/**
 * The output format an audio-converter page STARTS on.
 *
 * It used to be a literal typed into each wrapper below, which is what made
 * `wav-to-mp3` and `m4a-to-mp3` byte-identical and meant a new format pair
 * needed new code. It now comes off the registry entry, exactly the way
 * `PdfToJpgClient` reads `targetFormat` (`PdfToolClients.tsx:30`) — and it is a
 * SEED, not a lock: `AudioConverterUI` holds it in `useState` and the FORMAT
 * chips change it.
 *
 * `targetFormat` is read through a widening assignment because that field's
 * union is written for the image tools (`tools.ts:88`), and this file has to
 * compile whether or not it has grown an audio arm — the same read
 * `VideoToolClients.remuxTarget` does for the container pages.
 *
 * The fallback is the slug's own `-to-<ext>` tail, which every pair page in
 * this cluster carries: ONE rule for all of them, not a per-slug table. A hub
 * with no tail (`mp3-converter`) lands on MP3, which is what its name promises.
 */
function audioTarget(tool: Tool): AudioOutputFormat {
  const declared: string | undefined = tool.targetFormat;
  if (isAudioOutputFormat(declared)) return declared;
  const tail = /-to-([a-z0-9]+)$/.exec(tool.slug)?.[1];
  if (isAudioOutputFormat(tail)) return tail;
  return "mp3";
}

/**
 * Same rule for the extractor, with one difference: its default is the
 * LOSSLESS arm. A page called `extract-audio` should start by copying the
 * track out rather than by re-encoding it, and `video-to-wav` / `mp4-to-wav`
 * still get WAV off their own tails.
 */
function extractTarget(tool: Tool): ExtractAudioFormat {
  const declared: string | undefined = tool.targetFormat;
  if (isExtractAudioFormat(declared)) return declared;
  const tail = /-to-([a-z0-9]+)$/.exec(tool.slug)?.[1];
  if (isExtractAudioFormat(tail)) return tail;
  return "original";
}

/**
 * Every `audio-convert` page, plus the three original pair pages that still
 * carry their own toolTypes. One component, one seam, no per-slug wrappers.
 */
export function AudioConvertClient({ tool }: { tool: Tool }) {
  return (
    <AudioConverterUI
      acceptFormats={tool.acceptFormats}
      defaultFormat={audioTarget(tool)}
      practicalLimitNote={tool.practicalLimitNote}
    />
  );
}

export function ExtractAudioClient({ tool }: { tool: Tool }) {
  return (
    <ExtractAudioUI
      acceptFormats={tool.acceptFormats}
      defaultFormat={extractTarget(tool)}
      sizeCapMB={tool.maxSizeMB}
      practicalLimitNote={tool.practicalLimitNote}
    />
  );
}

export function AudioTrimmerClient() {
  return <AudioTrimmerUI />;
}

export function MergeAudioClient() {
  return <AudioMergerUI />;
}

export function NormalizeAudioClient() {
  return <NormalizeAudioUI />;
}

export function ChangeAudioVolumeClient() {
  return <ChangeAudioVolumeUI />;
}

export function ReverseAudioClient() {
  return <ReverseAudioUI />;
}

export function RemoveSilenceClient() {
  return <RemoveSilenceUI />;
}

export function AudioRecorderClient() {
  return <AudioRecorderUI />;
}
