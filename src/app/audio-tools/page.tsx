import type { Metadata } from "next";
import { getToolsByCategory } from "@/data/tools";
import { CategoryHubPage } from "@/components/layout/CategoryHubPage";

export const metadata: Metadata = {
  title: "Audio Tools — Convert, Trim & Merge Audio | Transmute",
  description:
    "Free browser-based audio tools. Convert between MP3, WAV, and M4A. Trim audio clips and merge multiple files. No uploads — everything runs locally.",
  keywords: [
    "audio converter",
    "mp3 to wav",
    "wav to mp3",
    "m4a to mp3",
    "audio trimmer",
    "merge audio",
    "audio tools online",
  ],
  alternates: { canonical: "/audio-tools" },
  openGraph: {
    title: "Audio Tools — Convert, Trim & Merge Audio | Transmute",
    description: "Free browser-based audio tools. Convert MP3, WAV, M4A, trim clips, and merge files — no uploads needed.",
    url: "/audio-tools",
  },
};

const CONVERTER_TYPES = ["mp3-to-wav", "wav-to-mp3", "m4a-to-mp3"];

export default function AudioToolsPage() {
  const audioTools = getToolsByCategory("audio-tools");
  const converters = audioTools.filter((t) => CONVERTER_TYPES.includes(t.toolType));
  const utilities = audioTools.filter((t) => !CONVERTER_TYPES.includes(t.toolType));

  return (
    <CategoryHubPage
      breadcrumbName="Audio Tools"
      breadcrumbHref="/audio-tools"
      title="Audio Tools"
      intro="Convert between audio formats, trim clips, and merge files — all entirely in your browser using the Web Audio API. No files are uploaded to any server."
      sections={[
        { title: "Audio Utilities", tools: utilities },
        { title: "Format Converters", tools: converters },
      ]}
    />
  );
}
