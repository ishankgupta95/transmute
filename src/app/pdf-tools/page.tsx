import type { Metadata } from "next";
import Link from "next/link";
import { getToolsByCategory } from "@/data/tools";
import { BreadcrumbSchema } from "@/components/seo/BreadcrumbSchema";

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
};

export default function PdfToolsPage() {
  const pdfTools = getToolsByCategory("pdf-tools");

  const breadcrumbs = [
    { name: "Home", href: "/" },
    { name: "PDF Tools", href: "/pdf-tools" },
  ];

  return (
    <main className="flex-1 px-4 py-16 max-w-5xl mx-auto w-full">
      <BreadcrumbSchema items={breadcrumbs} />

      {/* Breadcrumbs */}
      <nav aria-label="Breadcrumb" className="mb-8">
        <ol className="flex items-center gap-1.5 text-sm text-text-muted">
          <li>
            <Link href="/" className="hover:text-text-secondary transition-colors">
              Home
            </Link>
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true">/</span>
            <span className="text-text-secondary">PDF Tools</span>
          </li>
        </ol>
      </nav>

      <h1 className="text-3xl font-bold font-display text-text-primary mb-2">
        PDF Tools
      </h1>
      <p className="text-text-secondary mb-10 max-w-2xl">
        Merge, split, compress, convert, rotate, and manipulate PDF files — all
        entirely in your browser. No files are uploaded to any server.
      </p>

      <section>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {pdfTools.map((tool) => (
            <Link
              key={tool.slug}
              href={`/${tool.slug}`}
              className="group rounded-lg border border-border bg-bg-secondary p-5 hover:border-border-hover hover:bg-bg-hover transition-colors"
            >
              <h3 className="font-medium text-text-primary group-hover:text-accent transition-colors">
                {tool.name}
              </h3>
              <p className="text-sm text-text-muted mt-1.5 line-clamp-2">
                {tool.description}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
