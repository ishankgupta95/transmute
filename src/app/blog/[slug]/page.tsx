import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { posts, getPostBySlug } from "@/data/posts";
import { getToolBySlug } from "@/data/tools";
import { BreadcrumbSchema } from "@/components/seo/BreadcrumbSchema";

const BASE_URL = "https://transmute.tools";

export async function generateStaticParams() {
  return posts.map((p) => ({ slug: p.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return { title: "Post Not Found" };

  return {
    title: post.title,
    description: post.description,
    keywords: post.keywords,
    alternates: { canonical: `${BASE_URL}/blog/${post.slug}` },
    openGraph: {
      title: post.title,
      description: post.description,
      url: `${BASE_URL}/blog/${post.slug}`,
      type: "article",
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt ?? post.publishedAt,
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt: `${post.title} — Transmute blog`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
      images: ["/og-image.png"],
    },
  };
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  const { default: PostBody } = await import(`@/content/blog/${slug}.mdx`);

  const primaryTool = post.primaryTool ? getToolBySlug(post.primaryTool) : undefined;
  const relatedTools = post.relatedTools
    .map((s) => getToolBySlug(s))
    .filter((t): t is NonNullable<typeof t> => t !== undefined);

  const breadcrumbs = [
    { name: "Home", href: "/" },
    { name: "Blog", href: "/blog" },
    { name: post.title, href: `/blog/${post.slug}` },
  ];

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt ?? post.publishedAt,
    url: `${BASE_URL}/blog/${post.slug}`,
    image: `${BASE_URL}/og-image.png`,
    author: { "@type": "Organization", name: "Transmute" },
    publisher: {
      "@type": "Organization",
      name: "Transmute",
      url: BASE_URL,
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": `${BASE_URL}/blog/${post.slug}` },
    keywords: post.keywords.join(", "),
  };

  return (
    <main className="flex-1 px-4 py-14 max-w-3xl mx-auto w-full">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }}
      />
      <BreadcrumbSchema items={breadcrumbs} />

      <nav aria-label="Breadcrumb" className="mb-8">
        <ol className="flex items-center gap-2 text-sm text-text-muted">
          {breadcrumbs.map((crumb, i) => (
            <li key={crumb.href} className="flex items-center gap-2">
              {i > 0 && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-40">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              )}
              {i < breadcrumbs.length - 1 ? (
                <Link href={crumb.href} className="hover:text-text-secondary transition-colors duration-200">
                  {crumb.name}
                </Link>
              ) : (
                <span className="text-text-secondary line-clamp-1">{crumb.name}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>

      <header className="mb-10">
        <div className="flex items-center gap-3 text-xs text-text-muted mb-4">
          <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
          <span aria-hidden>·</span>
          <span>{post.readingTime} min read</span>
        </div>
        <h1 className="text-3xl md:text-4xl font-bold font-display tracking-tight text-text-primary mb-4 leading-tight">
          {post.title}
        </h1>
        <p className="text-text-secondary text-lg leading-relaxed">{post.description}</p>
      </header>

      {primaryTool && (
        <aside className="mb-10 rounded-lg border border-accent-muted bg-accent-muted/30 p-5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm text-text-muted mb-0.5">Use the tool now</p>
              <p className="font-semibold text-text-primary">{primaryTool.name}</p>
            </div>
            <Link
              href={`/${primaryTool.slug}`}
              className="inline-flex items-center gap-2 rounded-md bg-accent text-bg-primary px-4 py-2 text-sm font-semibold hover:bg-accent-hover transition-colors"
            >
              Open {primaryTool.name}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>
          </div>
        </aside>
      )}

      <article className="prose prose-invert prose-headings:font-display prose-headings:text-text-primary prose-p:text-text-secondary prose-p:leading-relaxed prose-li:text-text-secondary prose-strong:text-text-primary prose-a:text-accent hover:prose-a:text-accent-hover prose-a:no-underline hover:prose-a:underline prose-code:text-accent prose-code:before:content-none prose-code:after:content-none prose-code:bg-bg-elevated prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-pre:bg-bg-secondary prose-pre:border prose-pre:border-border max-w-none">
        <PostBody />
      </article>

      {relatedTools.length > 0 && (
        <section className="mt-16">
          <h2 className="text-xl font-bold font-display text-text-primary mb-6">
            Tools mentioned in this post
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {relatedTools.map((tool) => (
              <Link
                key={tool.slug}
                href={`/${tool.slug}`}
                className="group rounded-lg border border-border/80 bg-bg-secondary/40 backdrop-blur-sm p-5 transition-all duration-300 hover:border-accent/30 hover:bg-bg-elevated/50 hover:-translate-y-0.5"
              >
                <p className="font-semibold text-text-primary group-hover:text-accent transition-colors duration-200">
                  {tool.name}
                </p>
                <p className="text-sm text-text-muted mt-1.5 line-clamp-2 leading-relaxed">
                  {tool.description}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
