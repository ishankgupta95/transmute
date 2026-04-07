import type { Metadata } from "next";
import { getToolBySlug } from "@/data/tools";

const BASE_URL = "https://transmute.tools";

export const DEFAULT_HOW_TO_STEPS = [
  "Upload your file by dragging it into the drop zone or clicking to browse.",
  "Adjust the quality slider to balance file size and visual fidelity (optional).",
  "Click Download to save your converted file.",
];

export function getToolMetadata(slug: string): Metadata {
  const tool = getToolBySlug(slug);
  if (!tool) {
    return { title: "Tool Not Found" };
  }

  return {
    title: `${tool.h1} | Transmute`,
    description: tool.description,
    keywords: tool.keywords,
    alternates: {
      canonical: `${BASE_URL}/${tool.slug}`,
    },
    openGraph: {
      title: `${tool.name} | Transmute`,
      description: tool.description,
      url: `${BASE_URL}/${tool.slug}`,
      siteName: "Transmute",
      type: "website",
    },
    twitter: {
      card: "summary",
      title: `${tool.name} | Transmute`,
      description: tool.description,
    },
  };
}
