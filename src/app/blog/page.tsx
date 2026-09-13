import type { Metadata } from "next";
import Link from "next/link";
import { posts, postTag } from "@/data/posts";
import { BreadcrumbSchema } from "@/components/seo/BreadcrumbSchema";
import { OG_LOCALE } from "@/lib/seo/locale";

const BASE_URL = "https://transmute.tools";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Practical guides on file conversion, image formats, PDFs, and developer tooling — written for the long-tail of how-to questions our tools quietly answer.",
  alternates: { canonical: "/blog" },
  openGraph: {
    locale: OG_LOCALE,
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

/** `3 MAY 2026` — the doc's stamp. UTC so the ISO day never slips a timezone. */
const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

/** `MAY 2026` — the coarser stamp the UPDATED tile carries. */
const formatMonth = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

export default function BlogIndexPage() {
  // Date first, then longest read — every post currently shares a publish date,
  // so without the tie-break the sort was a no-op and the numbering fell back
  // to registry order.
  const sorted = [...posts].sort(
    (a, b) =>
      b.publishedAt.localeCompare(a.publishedAt) || b.readingTime - a.readingTime,
  );
  const totalReading = posts.reduce((n, p) => n + p.readingTime, 0);
  const latest = sorted[0]?.updatedAt ?? sorted[0]?.publishedAt;

  return (
    <main className="flex-1">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(blogSchema) }}
      />
      <BreadcrumbSchema items={breadcrumbs} />

      <div className="mx-auto max-w-[1440px] px-4 pt-12 pb-10 md:px-11">
        <nav aria-label="Breadcrumb" className="mb-[26px]">
          <ol className="flex items-center gap-2 font-mono text-[11px] leading-none text-text-muted">
            <li>
              <Link href="/" className="transition-colors duration-200 hover:text-accent-200">
                HOME
              </Link>
            </li>
            <li aria-hidden="true" className="opacity-40">/</li>
            <li className="text-neutral-300">BLOG</li>
          </ol>
        </nav>

        {/* `auto`, not a fixed 380px track: inside a fixed track the UPDATED
            tile had 93px for a date needing ~99px, so it either wrapped
            mid-date or (with nowrap) clipped. Content-sized, like the hub
            strip it is meant to match. */}
        <div className="grid items-end gap-10 lg:grid-cols-[1fr_auto] lg:gap-16">
          <div>
            <h1 className="m-0 mb-4 font-display text-[clamp(30px,5vw,44px)] leading-[1.1] font-medium tracking-[-0.028em] text-text-primary">
              Notes on file formats
            </h1>
            <p className="m-0 max-w-[560px] font-body text-[15px] leading-[1.7] text-neutral-400">
              Practical guides on conversion, image formats, PDFs and developer tooling —
              written to answer the questions the tools quietly solve.
            </p>
          </div>

          <div className="flex gap-px overflow-hidden rounded-[9px] border border-border bg-border">
            {[
              ["POSTS", String(posts.length)],
              ["READING", `${totalReading} MIN`],
              ["UPDATED", formatMonth(latest).toUpperCase()],
            ].map(([k, v]) => (
              <div key={k} className="flex flex-1 flex-col gap-[5px] bg-bg-primary px-4 py-3">
                <span className="font-mono text-[9.5px] leading-none tracking-[0.12em] text-text-muted">
                  {k}
                </span>
                <span className="font-mono text-[15px] leading-none font-medium whitespace-nowrap text-neutral-300">
                  {v}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-x-12 px-4 pb-13 md:px-11 lg:grid-cols-2">
        {sorted.map((post, i) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="flex items-start gap-[18px] border-b border-border py-5.5 transition-[padding-left] duration-[220ms] hover:pl-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span className="w-[22px] flex-none font-mono text-[10.5px] leading-[1.8] text-text-muted">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-[7px]">
              <span className="flex items-center gap-2.5 font-mono text-[10.5px] leading-none text-text-muted">
                <time dateTime={post.publishedAt}>{formatDate(post.publishedAt).toUpperCase()}</time>
                <span aria-hidden="true" className="opacity-40">·</span>
                <span>{post.readingTime} MIN</span>
                <span aria-hidden="true" className="opacity-40">·</span>
                <span className="text-accent-300">{postTag(post)}</span>
              </span>
              <span className="font-display text-base leading-[1.35] font-medium text-text-primary">
                {post.title}
              </span>
              <span className="font-body text-[12.5px] leading-[1.6] text-text-muted">
                {post.indexBlurb ?? post.description}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}
