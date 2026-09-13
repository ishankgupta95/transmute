import type { Metadata } from "next";
import { getToolsByCategory } from "@/data/tools";
import { CategoryHubPage } from "@/components/layout/CategoryHubPage";
import { OG_LOCALE } from "@/lib/seo/locale";

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
    locale: OG_LOCALE,
    title: "Image Tools — Convert, Compress, Resize & More | Transmute",
    description: "Free browser-based image tools. Convert formats, compress, resize, crop, and more — no uploads needed.",
    url: "/image-tools",
  },
};

/*
  A section caption is a claim about every card under it, and the Utilities one
  used to read "CHANGE THE FILE, KEEP THE FORMAT" — false for sixteen of the
  thirty-two cards it sat over. The split is `toolType !== "image-convert"`,
  which is a statement about the tool ARCHETYPE and not about the format, so
  the section correctly holds /ico-to-png (ICO → PNG, whose own H1 reads
  "Convert ICO to PNG Online" two inches above a heading that reads "Format
  converters"), /base64-to-image (TXT → IMG), /image-to-base64, /png-to-ico,
  /favicon-generator (PNG → ZIP), /image-splitter (IMG → ZIP), /exif-viewer
  (IMG → DATA), /image-color-palette (IMG → HEX), and the eight edit pages that
  accept .avif/.bmp/.gif and write none of them.

  Moving the obvious converters across would have fixed five cards and left
  eleven under the same false caption, so the caption is the defect rather than
  the split. What replaces it claims only what the section actually is: the
  complement of the converter list below it. The other three hubs carry the
  identical pair of strings and want the same look — not changed here, because
  their memberships were not audited. `tool-metadata.test.ts` pins this one
  against the workspace routes of the cards under it.
*/
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
        { title: "Utilities", caption: "EVERYTHING ELSE IN THIS CATEGORY", tools: utilities },
        { title: "Format converters", caption: "ONE FORMAT IN, ANOTHER OUT", tools: converters },
      ]}
    />
  );
}
