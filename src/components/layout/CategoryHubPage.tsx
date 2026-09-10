import Link from "next/link";
import type { Tool } from "@/data/tools";
import { getCategoryBySlug } from "@/data/categories";
import { getWorkspaceTool } from "@/data/workspace";
import { BreadcrumbSchema } from "@/components/seo/BreadcrumbSchema";
import { HubRail } from "@/components/layout/HubRail";
import { cn } from "@/lib/utils/cn";

export interface CategoryHubSection {
  title?: string;
  /** The mono strapline beside the heading, e.g. "ONE FORMAT IN, ANOTHER OUT". */
  caption?: string;
  tools: Tool[];
}

interface CategoryHubPageProps {
  breadcrumbName: string;
  breadcrumbHref: string;
  title: string;
  intro: string;
  sections: CategoryHubSection[];
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

const STAT = "flex flex-col gap-[5px] bg-bg-primary px-[18px] py-3";
const STAT_KEY =
  "font-mono text-[9.5px] leading-none tracking-[0.12em] text-text-muted";
const STAT_VALUE = "font-mono text-[15px] leading-none font-medium";

export function CategoryHubPage({
  breadcrumbName,
  breadcrumbHref,
  title,
  intro,
  sections,
}: CategoryHubPageProps) {
  const breadcrumbs = [
    { name: "Home", href: "/" },
    { name: breadcrumbName, href: breadcrumbHref },
  ];

  const category = getCategoryBySlug(breadcrumbHref.replace(/^\//, ""));
  const shown = sections.filter((s) => s.tools.length > 0);
  const total = shown.reduce((n, s) => n + s.tools.length, 0);

  return (
    <main className="flex-1">
      <BreadcrumbSchema items={breadcrumbs} />

      {/* ── Header ───────────────────────────────────────────── */}
      <div className="relative overflow-hidden px-4 pt-11 pb-5 md:px-11">
        <div className="pointer-events-none absolute -top-[160px] left-[120px] h-[340px] w-[520px] animate-tm-glow rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--color-accent)_30%,transparent)_0%,transparent_70%)] blur-[140px] motion-reduce:animate-none" />

        <div className="relative mx-auto max-w-[1440px]">
          <nav aria-label="Breadcrumb" className="mb-[26px]">
            <ol className="flex items-center gap-2 font-mono text-[11px] leading-none text-text-muted">
              <li>
                <Link
                  href="/"
                  className="transition-colors duration-200 hover:text-accent-200"
                >
                  HOME
                </Link>
              </li>
              <li aria-hidden="true" className="opacity-40">
                /
              </li>
              <li className="text-neutral-300">{breadcrumbName.toUpperCase()}</li>
            </ol>
          </nav>

          <div className="flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-end lg:gap-14">
            <div className="max-w-[620px]">
              <h1 className="m-0 mb-4 font-display text-[clamp(30px,5vw,44px)] leading-[1.1] font-medium tracking-[-0.028em] text-text-primary">
                {title}
              </h1>
              <p className="m-0 font-body text-[15px] leading-[1.7] text-neutral-400">
                {intro}
              </p>
            </div>

            <div className="flex flex-none gap-px overflow-hidden rounded-[9px] border border-border bg-border">
              <div className={STAT}>
                <span className={STAT_KEY}>TOOLS</span>
                <span className={cn(STAT_VALUE, "text-neutral-300")}>{total}</span>
              </div>
              <div className={STAT}>
                <span className={STAT_KEY}>ENGINE</span>
                <span className={cn(STAT_VALUE, "text-neutral-300")}>
                  {category?.engine ?? "NATIVE JS"}
                </span>
              </div>
              {/*
                This said "0 KB" on every hub, in the same green the UPLOAD /
                NEVER row uses — a flat claim that opening any tool here costs
                you no bytes. It was false on four of the five: /video-tools
                and /audio-tools can pull the ~31 MB FFmpeg core, /pdf-tools
                pulls 2.3 MB of qpdf, /image-tools 1.3 MB of heic2any. The
                figure now comes from the category (see `data/categories.ts`,
                which quotes the homepage ENGINES table), and the success
                colour is spent only where the claim is still "0 KB".

                As of 2026-09-05 that is nowhere. /developer-tools was the last
                hub costing nothing, and /qr-code-reader and /extract-archive
                put a WebAssembly engine behind it, so it quotes a range like
                the other four. The branch below is deliberately kept rather
                than deleted: it is the reserve that lights the stat up again if
                a category ever returns to fetching nothing, and deleting it
                would leave the test that asserts "no hub is green" passing for
                the wrong reason. `category-hub-claims.test.tsx` reads this file
                to check the branch is still here.
              */}
              <div className={STAT}>
                <span className={STAT_KEY}>DOWNLOAD</span>
                <span
                  className={cn(
                    STAT_VALUE,
                    // A range is one figure; "0–31 / MB" over two lines on a
                    // phone reads as two. ENGINE beside it still wraps, which
                    // is what keeps the strip inside a 360 px viewport.
                    "whitespace-nowrap",
                    category?.download === "0 KB" ? "text-success" : "text-neutral-300",
                  )}
                >
                  {category?.download ?? "—"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Sidebar + sections ───────────────────────────────── */}
      <div className="mx-auto grid max-w-[1440px] items-start gap-10 px-4 pt-[26px] pb-13 md:px-11 lg:grid-cols-[196px_1fr] lg:gap-12">
        <div className="flex flex-col gap-5.5 lg:sticky lg:top-[74px]">
          {shown.length > 1 && (
            <HubRail
              sections={shown.map((s, i) => ({
                id: slugify(s.title ?? `section-${i}`),
                title: s.title ?? "",
                count: s.tools.length,
              }))}
            />
          )}

          {category && category.formats.length > 0 && (
            <div className="flex flex-col gap-2.5">
              <span className="font-mono text-[9.5px] leading-none font-medium tracking-[0.14em] text-text-muted">
                I HAVE A…
              </span>
              <div className="flex flex-wrap gap-[5px]">
                {category.formats.map((f) => (
                  <span
                    key={f}
                    className="rounded-[6px] border border-border px-[9px] py-[5px] font-mono text-[10.5px] leading-none font-medium whitespace-nowrap text-neutral-400"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-10">
          {shown.map((section, idx) => (
            <section
              key={section.title ?? idx}
              id={slugify(section.title ?? `section-${idx}`)}
              className="flex scroll-mt-20 flex-col gap-3.5"
            >
              {section.title && (
                <div className="flex flex-wrap items-baseline gap-3">
                  <h2 className="m-0 font-display text-[17px] leading-[1.2] font-medium text-text-primary">
                    {section.title}
                  </h2>
                  {section.caption && (
                    <span className="font-mono text-[11px] leading-none text-text-muted">
                      {section.caption}
                    </span>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 gap-x-10 md:grid-cols-2">
                {section.tools.map((tool) => (
                  <Link
                    key={tool.slug}
                    href={`/${tool.slug}`}
                    className="flex items-center gap-3.5 border-b border-border py-[13px] transition-[padding-left] duration-[220ms] hover:pl-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                      <span className="font-body text-[13.5px] leading-[1.3] font-medium text-text-primary">
                        {getWorkspaceTool(tool.slug)?.name ?? tool.name}
                      </span>
                      <span className="line-clamp-2 font-body text-[11.5px] leading-[1.45] text-text-muted">
                        {tool.hubLine ?? tool.description}
                      </span>
                    </span>
                    <span className="flex-none font-mono text-[10px] leading-none whitespace-nowrap text-accent-300">
                      {getWorkspaceTool(tool.slug)?.route}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
