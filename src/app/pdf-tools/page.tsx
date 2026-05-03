import type { Metadata } from "next";
import { getToolsByCategory } from "@/data/tools";
import { CategoryHubPage } from "@/components/layout/CategoryHubPage";

export const metadata: Metadata = {
  title: "PDF Tools — Merge, Split & Manipulate PDFs | Transmute",
  description:
    "Free browser-based PDF tools. Merge, split, compress, convert, rotate, reorder, and add page numbers to PDF files without uploading. Everything runs locally.",
  keywords: [
    "pdf merge",
    "pdf split",
    "pdf compress",
    "pdf to jpg",
    "images to pdf",
    "rotate pdf",
    "pdf tools online",
  ],
  alternates: { canonical: "/pdf-tools" },
  openGraph: {
    title: "PDF Tools — Merge, Split & Manipulate PDFs | Transmute",
    description: "Free browser-based PDF tools. Merge, split, compress, convert, rotate, and more — no uploads needed.",
    url: "/pdf-tools",
  },
};

export default function PdfToolsPage() {
  const pdfTools = getToolsByCategory("pdf-tools");

  return (
    <CategoryHubPage
      breadcrumbName="PDF Tools"
      breadcrumbHref="/pdf-tools"
      title="PDF Tools"
      intro="Merge, split, compress, convert, rotate, and manipulate PDF files — all entirely in your browser. No files are uploaded to any server."
      sections={[{ tools: pdfTools }]}
    />
  );
}
