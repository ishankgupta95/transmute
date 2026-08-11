import type { Metadata } from "next";
import { getToolsByCategory, splitByJob } from "@/data/tools";
import { CategoryHubPage } from "@/components/layout/CategoryHubPage";

export const metadata: Metadata = {
  title: "Video Tools — Convert, Trim, Compress & Record",
  description:
    "Free browser-based video tools. Convert video to GIF, trim clips, extract audio, compress for sharing, and record your screen. Powered by FFmpeg.wasm — no uploads needed.",
  keywords: [
    "video to gif",
    "video trimmer",
    "mp4 to mp3",
    "webm to mp4",
    "compress video",
    "screen recorder",
    "video tools online",
  ],
  alternates: { canonical: "/video-tools" },
  openGraph: {
    title: "Video Tools — Convert, Trim, Compress & Record | Transmute",
    description: "Free browser-based video tools. Convert to GIF, trim, compress, and record your screen — no uploads needed.",
    url: "/video-tools",
  },
};

export default function VideoToolsPage() {
  const { utilities, converters } = splitByJob(getToolsByCategory("video-tools"));

  return (
    <CategoryHubPage
      breadcrumbName="Video Tools"
      breadcrumbHref="/video-tools"
      title="Video tools"
      intro="Convert, trim, compress and record video, or pull the audio out — all entirely in your browser. No files are uploaded to any server."
      sections={[
        { title: "Utilities", caption: "CHANGE THE FILE, KEEP THE FORMAT", tools: utilities },
        { title: "Format converters", caption: "ONE FORMAT IN, ANOTHER OUT", tools: converters },
      ]}
    />
  );
}
