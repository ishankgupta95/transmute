"use client";

import dynamic from "next/dynamic";
import type { Tool } from "@/data/tools";

const AudioConverterUI = dynamic(() => import("./AudioConverterUI").then((m) => ({ default: m.AudioConverterUI })), { ssr: false });
const AudioTrimmerUI = dynamic(() => import("./AudioTrimmerUI").then((m) => ({ default: m.AudioTrimmerUI })), { ssr: false });
const AudioMergerUI = dynamic(() => import("./AudioMergerUI").then((m) => ({ default: m.AudioMergerUI })), { ssr: false });

export function Mp3ToWavClient({ tool }: { tool: Tool }) {
  return <AudioConverterUI acceptFormats={tool.acceptFormats} outputFormat="wav" />;
}

export function WavToMp3Client({ tool }: { tool: Tool }) {
  return <AudioConverterUI acceptFormats={tool.acceptFormats} outputFormat="mp3" showBitrateSelector />;
}

export function M4aToMp3Client({ tool }: { tool: Tool }) {
  return <AudioConverterUI acceptFormats={tool.acceptFormats} outputFormat="mp3" showBitrateSelector />;
}

export function AudioTrimmerClient() {
  return <AudioTrimmerUI />;
}

export function MergeAudioClient() {
  return <AudioMergerUI />;
}
