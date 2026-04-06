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
            <span className="text-text-secondary">Image Tools</span>
          </li>
        </ol>
      </nav>

      <h1 className="text-3xl font-bold font-display text-text-primary mb-2">
        Image Tools
      </h1>
      <p className="text-text-secondary mb-10 max-w-2xl">
        Convert between image formats, compress file sizes, resize, crop, and transform
        images — all entirely in your browser. No files are uploaded to any server.
      </p>

      {/* Utilities section */}
      <section className="mb-10">
        <h2 className="text-lg font-bold font-display text-text-primary mb-4">
          Image Utilities
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {utilities.map((tool) => (
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

      {/* Converters section */}
      <section>
        <h2 className="text-lg font-bold font-display text-text-primary mb-4">
          Format Converters
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {converters.map((tool) => (
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
