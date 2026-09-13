import type { Metadata } from "next";
import { getToolsByCategory, splitByJob } from "@/data/tools";
import { CategoryHubPage } from "@/components/layout/CategoryHubPage";
import { OG_LOCALE } from "@/lib/seo/locale";

/*
  The description and keyword list below are hand-maintained, and they used to
  enumerate exactly the five tools this hub then had — one keyword per slug.
  Both were rewritten when the format matrix landed. If you add an audio tool,
  this block is the surface that goes stale silently: no test reads it, and
  `category-pages.spec.ts` only checks the H1 and four hardcoded links.
*/
export const metadata: Metadata = {
  title: "Audio Tools — Convert, Trim, Normalize & Record",
  description:
    "Free browser-based audio tools. Convert MP3, WAV, M4A, AAC, FLAC, OGG, Opus and WMA, trim on a waveform, merge, normalize loudness, change volume, cut silence and record. No uploads.",
  keywords: [
    "audio converter",
    "mp3 converter",
    "convert audio online",
    "flac to mp3",
    "opus to mp3",
    "wma to mp3",
    "wav to flac",
    "audio trimmer",
    "merge audio",
    "normalize audio",
    "change audio volume",
    "remove silence from audio",
    "reverse audio",
    "audio recorder",
    "audio tools online",
  ],
  alternates: { canonical: "/audio-tools" },
  openGraph: {
    locale: OG_LOCALE,
    title: "Audio Tools — Convert, Trim, Normalize & Record | Transmute",
    description: "Free browser-based audio tools. Convert between MP3, WAV, M4A, AAC, FLAC, OGG, Opus and WMA, trim, merge, normalize loudness, cut silence and record — no uploads needed.",
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
      intro="Convert between MP3, WAV, M4A, AAC, FLAC, OGG, Opus and WMA, trim on a waveform, merge clips, normalize to a LUFS target, change the gain, cut out silence, or record from a microphone — all entirely in your browser. Every conversion here decodes and re-encodes, and no file is uploaded to any server."
      sections={[
        { title: "Utilities", caption: "CHANGE THE FILE, KEEP THE FORMAT", tools: utilities },
        { title: "Format converters", caption: "ONE FORMAT IN, ANOTHER OUT", tools: converters },
      ]}
    />
  );
}
