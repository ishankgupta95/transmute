import type { Metadata } from "next";
import Link from "next/link";
import { getToolsByCategory } from "@/data/tools";
import { BreadcrumbSchema } from "@/components/seo/BreadcrumbSchema";

export const metadata: Metadata = {
  title: "Image Tools — Convert, Compress, Resize & More | Transmute",
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
};

export default function ImageToolsPage() {
  const imageTools = getToolsByCategory("image-tools");

  const converters = imageTools.filter((t) => t.toolType === "image-convert");
  const utilities = imageTools.filter((t) => t.toolType !== "image-convert");

  const breadcrumbs = [
    { name: "Home", href: "/" },
    { name: "Image Tools", href: "/image-tools" },
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
              <span className="text-text-secondary">Image Tools</span>
            </li>
          </ol>
        </nav>

        <div className="mb-12">
          <h1 className="text-3xl md:text-4xl font-bold font-display tracking-tight text-text-primary mb-3">
            Image Tools
          </h1>
          <p className="text-text-secondary text-lg leading-relaxed max-w-2xl">
            Convert between image formats, compress file sizes, resize, crop, and transform
            images — all entirely in your browser. No files are uploaded to any server.
          </p>
        </div>

        {/* Utilities section */}
        <section className="mb-12">
          <h2 className="text-sm font-semibold font-display text-text-muted uppercase tracking-wider mb-5">
            Image Utilities
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {utilities.map((tool) => (
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

        {/* Converters section */}
        <section>
          <h2 className="text-sm font-semibold font-display text-text-muted uppercase tracking-wider mb-5">
            Format Converters
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {converters.map((tool) => (
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
