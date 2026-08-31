import type { Metadata } from "next";
import { getToolsByCategory } from "@/data/tools";
import { CategoryHubPage } from "@/components/layout/CategoryHubPage";

export const metadata: Metadata = {
  title: "Image Tools — Convert, Compress, Resize & More",
  description:
    "Free browser-based image tools. Convert formats, compress to target size, resize with presets, crop, extract colors, view EXIF data, and more. No uploads — everything runs locally.",
  keywords: [
    "image converter",
    "image compressor",
    "image resizer",
    "image cropper",
    "heic to jpg",
    "webp to jpg",
    "image tools online",
  ],
  alternates: { canonical: "/image-tools" },
  openGraph: {
    title: "Image Tools — Convert, Compress, Resize & More | Transmute",
    description: "Free browser-based image tools. Convert formats, compress, resize, crop, and more — no uploads needed.",
    url: "/image-tools",
  },
};

export default function ImageToolsPage() {
  const imageTools = getToolsByCategory("image-tools");
  const converters = imageTools.filter((t) => t.toolType === "image-convert");
  const utilities = imageTools.filter((t) => t.toolType !== "image-convert");

  return (
    <CategoryHubPage
      breadcrumbName="Image Tools"
      breadcrumbHref="/image-tools"
      title="Image tools"
      intro="Convert between formats, compress to an exact size, resize, crop and inspect — all in this tab. No file is uploaded to any server."
      sections={[
        { title: "Utilities", caption: "CHANGE THE FILE, KEEP THE FORMAT", tools: utilities },
        { title: "Format converters", caption: "ONE FORMAT IN, ANOTHER OUT", tools: converters },
      ]}
    />
  );
}
