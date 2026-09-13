import type { Metadata } from "next";
import { getToolsByCategory, splitByJob } from "@/data/tools";
import { CategoryHubPage } from "@/components/layout/CategoryHubPage";
import { OG_LOCALE } from "@/lib/seo/locale";

export const metadata: Metadata = {
  title: "PDF Tools — Merge, Split & Manipulate PDFs",
  // The operation list here has to keep pace with the registry — it enumerated
  // only the Phase-3 seven long after the page-geometry, extraction and
  // recompression tools shipped, which reads as a smaller site than it is.
  // The security four (protect / unlock / permissions / repair) joined it when
  // they shipped. Grouping is the only way this stays inside a meta length that
  // does not get cut off mid-word: "extract pages, text and images" is three
  // tools, "restrict" is the permissions page.
  description:
    "Free browser-based PDF tools. Merge, split, compress, crop, rotate, resize, extract pages, text and images, password-protect, unlock, restrict and repair — nothing is uploaded.",
  keywords: [
    "pdf merge",
    "pdf split",
    "pdf compress",
    "pdf to jpg",
    "images to pdf",
    "rotate pdf",
    "crop pdf",
    "extract pdf pages",
    "extract images from pdf",
    "delete pdf pages",
    "pdf to text",
    "password protect pdf",
    "unlock pdf",
    "pdf permissions",
    "repair pdf",
    "pdf tools online",
  ],
  alternates: { canonical: "/pdf-tools" },
  openGraph: {
    locale: OG_LOCALE,
    title: "PDF Tools — Merge, Split & Manipulate PDFs | Transmute",
    description: "Free browser-based PDF tools. Merge, split, compress, convert, rotate, protect, unlock and repair — no uploads needed.",
    url: "/pdf-tools",
  },
};

export default function PdfToolsPage() {
  const { utilities, converters } = splitByJob(getToolsByCategory("pdf-tools"));

  return (
    <CategoryHubPage
      breadcrumbName="PDF Tools"
      breadcrumbHref="/pdf-tools"
      title="PDF tools"
      intro="Merge, split, compress, convert, rotate and reshape PDF files — pull out the pages, the text or the images the document already holds — and add, remove or restrict a password, or repair a damaged one. All entirely in your browser. No files are uploaded to any server."
      sections={[
        { title: "Utilities", caption: "CHANGE THE FILE, KEEP THE FORMAT", tools: utilities },
        { title: "Format converters", caption: "ONE FORMAT IN, ANOTHER OUT", tools: converters },
      ]}
    />
  );
}
