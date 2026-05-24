import type { Metadata } from "next";
import Link from "next/link";
import { posts } from "@/data/posts";
import { BreadcrumbSchema } from "@/components/seo/BreadcrumbSchema";

const BASE_URL = "https://transmute.tools";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Practical guides on file conversion, image formats, PDFs, and developer tooling — written for the long-tail of how-to questions our tools quietly answer.",
  alternates: { canonical: `${BASE_URL}/blog` },
  openGraph: {
    title: "Transmute Blog",
    description:
      "Practical guides on file conversion, image formats, PDFs, and developer tooling.",
    url: `${BASE_URL}/blog`,
    type: "website",
  },
};

const blogSchema = {
  "@context": "https://schema.org",
  "@type": "Blog",
  name: "Transmute Blog",
  url: `${BASE_URL}/blog`,
  description:
    "Practical guides on file conversion, image formats, PDFs, and developer tooling.",
  blogPost: posts.map((p) => ({
    "@type": "BlogPosting",
    headline: p.title,
    description: p.description,
    datePublished: p.publishedAt,
    dateModified: p.updatedAt ?? p.publishedAt,
    url: `${BASE_URL}/blog/${p.slug}`,
  })),
};

const breadcrumbs = [
  { name: "Home", href: "/" },
  { name: "Blog", href: "/blog" },
];

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

export default function BlogIndexPage() {
  const sorted = [...posts].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  return (
    <main className="flex-1 px-4 py-14 max-w-4xl mx-auto w-full">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(blogSchema) }}
      />
      <BreadcrumbSchema items={breadcrumbs} />

      <nav aria-label="Breadcrumb" className="mb-8">
        <ol className="flex items-center gap-2 text-sm text-text-muted">
          <li>
            <Link href="/" className="hover:text-text-secondary transition-colors duration-200">
              Home
            </Link>
          </li>
          <li className="flex items-center gap-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-40" aria-hidden="true">
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span className="text-text-secondary">Blog</span>
          </li>
        </ol>
      </nav>

      <header className="mb-12">
        <h1 className="text-3xl md:text-4xl font-bold font-display tracking-tight text-text-primary mb-3">
          Blog
        </h1>
        <p className="text-text-secondary text-lg leading-relaxed max-w-2xl">
          Practical guides on file conversion, image formats, PDFs, and developer
          tooling — written to answer the questions our tools quietly solve.
        </p>
      </header>

      <ul className="space-y-6">
        {sorted.map((post) => (
          <li key={post.slug}>
            <Link
              href={`/blog/${post.slug}`}
              className="group block rounded-lg border border-border bg-bg-elevated p-6 transition-all duration-300 hover:bg-bg-hover hover:border-border-hover hover:-translate-y-0.5"
            >
              <div className="flex items-center gap-3 text-xs text-text-muted mb-3">
                <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
                <span aria-hidden>·</span>
                <span>{post.readingTime} min read</span>
              </div>
              <h2 className="text-xl font-bold font-display text-text-primary group-hover:text-accent transition-colors duration-200 mb-2">
                {post.title}
              </h2>
              <p className="text-sm text-text-secondary leading-relaxed">{post.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
