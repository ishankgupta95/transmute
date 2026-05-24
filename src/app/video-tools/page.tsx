import type { Metadata } from "next";
import { getToolsByCategory } from "@/data/tools";
import { CategoryHubPage } from "@/components/layout/CategoryHubPage";

export const metadata: Metadata = {
  title: "Video Tools — Convert, Trim, Compress & Record | Transmute",
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

const CONVERTER_TYPES = ["video-to-gif", "webm-to-mp4", "mp4-to-mp3"];

export default function VideoToolsPage() {
  const videoTools = getToolsByCategory("video-tools");
  const converters = videoTools.filter((t) => CONVERTER_TYPES.includes(t.toolType));
  const utilities = videoTools.filter((t) => !CONVERTER_TYPES.includes(t.toolType));

  return (
    <CategoryHubPage
      breadcrumbName="Video Tools"
      breadcrumbHref="/video-tools"
      title="Video Tools"
      intro="Convert, trim, compress, and record video — all entirely in your browser using FFmpeg.wasm. No files are uploaded to any server."
      sections={[
        { title: "Video Utilities", tools: utilities },
        { title: "Format Converters", tools: converters },
      ]}
    />
  );
}
