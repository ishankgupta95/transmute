import type { Metadata } from "next";
import { getToolsByCategory, splitByJob } from "@/data/tools";
import { CategoryHubPage } from "@/components/layout/CategoryHubPage";

/*
  The description and keyword list below are hand-maintained, and they used to
  enumerate exactly the six tools this hub then had. Both were rewritten when
  the container tools, mute-video and rotate-video landed. If you add a video
  tool, this block is the surface that goes stale silently — no test reads it.
*/
export const metadata: Metadata = {
  title: "Video Tools — Convert, Split, Merge, Compress & Record",
  description:
    "Free browser-based video tools. Rewrap MOV, MKV and AVI as MP4 without re-encoding, split or join clips losslessly, save frames as images, trim, mute, rotate, compress, and record your screen or camera. No uploads.",
  keywords: [
    "video to mp4",
    "mov to mp4",
    "mkv to mp4",
    "avi to mp4",
    "mute video",
    "rotate video",
    "split video",
    "merge video",
    "video to images",
    "video thumbnail",
    "video to gif",
    "video trimmer",
    "mp4 to mp3",
    "webm to mp4",
    "compress video",
    "compress video to 25mb",
    "screen recorder",
    "webcam recorder",
    "video tools online",
  ],
  alternates: { canonical: "/video-tools" },
  openGraph: {
    title: "Video Tools — Convert, Split, Merge, Compress & Record | Transmute",
    description: "Free browser-based video tools. Swap containers, split and join clips without re-encoding, save frames as images, trim, compress, and record your screen or camera — no uploads needed.",
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
      intro="Swap containers without re-encoding where the codec allows, cut a clip into parts or join matching clips back together the same way, save frames as images, mute or rotate, trim, compress by preset or to a size limit, pull the audio out, or record your screen or camera — all entirely in your browser. No files are uploaded to any server."
      sections={[
        { title: "Utilities", caption: "CHANGE THE FILE, KEEP THE FORMAT", tools: utilities },
        { title: "Format converters", caption: "ONE FORMAT IN, ANOTHER OUT", tools: converters },
      ]}
    />
  );
}
