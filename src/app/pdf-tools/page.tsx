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
      <main className="flex-1 px-4 py-14 max-w-5xl mx-auto w-full">
        <BreadcrumbSchema items={breadcrumbs} />

        {/* Breadcrumbs */}
        <nav aria-label="Breadcrumb" className="mb-8">
          <ol className="flex items-center gap-2 text-sm text-text-muted">
            <li>
              <Link href="/" className="hover:text-text-secondary transition-colors duration-200">
                Home
              </Link>
            </li>
            <li className="flex items-center gap-2">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-40">
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span className="text-text-secondary">PDF Tools</span>
            </li>
          </ol>
        </nav>

        <div className="mb-12">
          <h1 className="text-3xl md:text-4xl font-bold font-display tracking-tight text-text-primary mb-3">
            PDF Tools
          </h1>
          <p className="text-text-secondary text-lg leading-relaxed max-w-2xl">
            Merge, split, compress, convert, rotate, and manipulate PDF files — all
            entirely in your browser. No files are uploaded to any server.
          </p>
        </div>

        <section>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {pdfTools.map((tool) => (
              <Link
                key={tool.slug}
                href={`/${tool.slug}`}
                className="group rounded-lg border border-border bg-bg-elevated p-6 transition-all duration-300 hover:bg-[rgba(255,255,255,0.025)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.15)]"
              >
                <h3 className="font-semibold text-text-primary group-hover:text-accent transition-colors duration-200">
                  {tool.name}
                </h3>
                <p className="text-sm text-text-muted mt-2 line-clamp-2 leading-relaxed">
                  {tool.description}
                </p>
              </Link>
            ))}
          </div>
        </section>
      </main>
  );
}
