import type { Metadata } from "next";
import { getToolsByCategory, splitByJob } from "@/data/tools";
import { CategoryHubPage } from "@/components/layout/CategoryHubPage";

export const metadata: Metadata = {
  title: "Audio Tools — Convert, Trim & Merge Audio",
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

export default function AudioToolsPage() {
  const { utilities, converters } = splitByJob(getToolsByCategory("audio-tools"));

  return (
    <CategoryHubPage
      breadcrumbName="Audio Tools"
      breadcrumbHref="/audio-tools"
      title="Audio tools"
      intro="Convert between audio formats, trim on a waveform, and merge clips — all entirely in your browser. No files are uploaded to any server."
      sections={[
        { title: "Utilities", caption: "CHANGE THE FILE, KEEP THE FORMAT", tools: utilities },
        { title: "Format converters", caption: "ONE FORMAT IN, ANOTHER OUT", tools: converters },
      ]}
    />
  );
}
