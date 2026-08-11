import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { posts, getPostBySlug, postTag } from "@/data/posts";
import { getToolBySlug } from "@/data/tools";
import { getWorkspaceTool } from "@/data/workspace";
import { ArticleRail } from "@/components/blog/ArticleRail";
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
    alternates: { canonical: `/blog/${post.slug}` },
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

  const primaryRoute = (
    primaryTool ? (getWorkspaceTool(primaryTool.slug)?.route ?? "IN → OUT") : "IN → OUT"
  ).split(" → ");

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
    <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-11 md:px-11">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }}
      />
      <BreadcrumbSchema items={breadcrumbs} />

      <nav aria-label="Breadcrumb" className="mb-6">
        <ol className="flex items-center gap-2 font-mono text-[11px] leading-none text-text-muted">
          <li>
            <Link href="/" className="transition-colors duration-200 hover:text-accent-200">
              HOME
            </Link>
          </li>
          <li aria-hidden="true" className="opacity-40">/</li>
          <li>
            <Link href="/blog" className="transition-colors duration-200 hover:text-accent-200">
              BLOG
            </Link>
          </li>
          <li aria-hidden="true" className="opacity-40">/</li>
          <li className="line-clamp-1 text-neutral-300">{post.title.toUpperCase()}</li>
        </ol>
      </nav>

      <div className="grid items-start gap-10 lg:grid-cols-[210px_minmax(0,1fr)_260px] lg:gap-14">
        <ArticleRail targetId="post-body" />

        <div className="flex min-w-0 flex-col gap-5.5">
          <div className="flex items-center gap-[11px] font-mono text-[10.5px] leading-none text-text-muted">
            <time dateTime={post.publishedAt}>{formatDate(post.publishedAt).toUpperCase()}</time>
            <span aria-hidden="true" className="opacity-40">·</span>
            <span>{post.readingTime} MIN READ</span>
            <span aria-hidden="true" className="opacity-40">·</span>
            <span className="text-accent-300">{postTag(post)}</span>
          </div>

          <h1 className="m-0 font-display text-[clamp(28px,5vw,40px)] leading-[1.14] font-medium tracking-[-0.028em] text-text-primary">
            {post.title}
          </h1>

          <p className="m-0 font-body text-[16.5px] leading-[1.7] text-neutral-300">
            {post.description}
          </p>

          <div className="my-1.5 h-px bg-[linear-gradient(to_right,transparent,var(--color-border)_32px,var(--color-border)_calc(100%-32px),transparent)]" />

          <article
            id="post-body"
            className="prose prose-invert max-w-none prose-headings:font-display prose-headings:font-medium prose-headings:tracking-[-0.01em] prose-headings:text-text-primary prose-h2:text-[22px] prose-h2:leading-[1.25] prose-h2:scroll-mt-24 prose-p:font-body prose-p:text-[15px] prose-p:leading-[1.75] prose-p:text-neutral-400 prose-li:text-neutral-400 prose-strong:text-text-primary prose-a:text-accent prose-a:no-underline hover:prose-a:underline hover:prose-a:text-accent-400 prose-blockquote:border-l-2 prose-blockquote:border-accent prose-blockquote:pl-5.5 prose-blockquote:not-italic prose-blockquote:text-neutral-300 prose-code:rounded prose-code:bg-bg-elevated prose-code:px-1.5 prose-code:py-0.5 prose-code:font-mono prose-code:text-sm prose-code:text-accent-300 prose-code:before:content-none prose-code:after:content-none prose-pre:border prose-pre:border-border prose-pre:bg-nocturne-sunken"
          >
            <PostBody />
          </article>
        </div>

        {/* Try-it rail — the conversion this article is about, one click away. */}
        <aside className="flex flex-col gap-3 lg:sticky lg:top-[74px]">
          {primaryTool && (
            <div className="flex flex-col gap-3.5 rounded-[11px] border border-accent/40 bg-accent/6 p-[18px]">
              <span className="font-mono text-[9.5px] leading-none font-medium tracking-[0.14em] text-accent-300">
                TRY IT HERE
              </span>

              <div className="flex h-[74px] items-stretch">
                <div className="flex flex-1 items-center border-[1.5px] border-r-0 border-accent px-3 font-mono text-[17px] leading-none font-medium text-neutral-200">
                  {primaryRoute[0]}
                </div>
                <div className="relative w-1 flex-none">
                  <span className="absolute -top-[5px] -bottom-[5px] left-px w-[1.5px] animate-tm-glow bg-accent shadow-[0_0_12px_color-mix(in_srgb,var(--color-accent)_70%,transparent)]" />
                </div>
                <div className="flex w-[70px] flex-none items-center rounded-r-[70px] border-[1.5px] border-l-0 border-accent bg-accent/20 px-3 font-mono text-[17px] leading-none font-medium text-accent-200">
                  {primaryRoute[1]}
                </div>
              </div>

              <span className="font-body text-xs leading-[1.55] text-neutral-400">
                Batch convert straight from this page. Nothing uploads.
              </span>

              <Link
                href={`/${primaryTool.slug}`}
                className="flex h-[34px] items-center justify-center rounded-lg border border-accent font-display text-[13px] leading-none font-medium whitespace-nowrap text-accent transition-colors duration-200 hover:bg-accent/12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Open {primaryTool.name}
              </Link>
            </div>
          )}

          {relatedTools.length > 0 && (
            <div className="flex flex-col gap-[11px] rounded-[11px] border border-border px-[18px] py-4">
              <span className="font-mono text-[9.5px] leading-none font-medium tracking-[0.14em] text-text-muted">
                ALSO MENTIONED
              </span>
              {relatedTools.map((tool) => (
                <Link
                  key={tool.slug}
                  href={`/${tool.slug}`}
                  className="flex items-center justify-between gap-3 font-body text-[12.5px] leading-none text-neutral-400 transition-colors duration-200 hover:text-accent-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <span className="truncate">{tool.name}</span>
                  <span className="flex-none font-mono text-[9.5px] whitespace-nowrap text-text-muted">
                    {getWorkspaceTool(tool.slug)?.route}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
