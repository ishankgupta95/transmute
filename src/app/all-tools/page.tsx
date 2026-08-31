import type { Metadata } from "next";
import Link from "next/link";
import { tools } from "@/data/tools";
import { categories } from "@/data/categories";

/**
 * The crawlable full index: every registered tool, grouped by category, one
 * plain link each. Entirely registry-driven — a new tool appears here the
 * moment it lands in `src/data/tools.ts`, with no hand-curated list to drift.
 * Server Component on purpose: this page is text and links, nothing else.
 */

export const metadata: Metadata = {
  // The root layout's template appends " | Transmute".
  title: "All Tools",
  description: `Every Transmute tool on one page — ${tools.length} free, browser-based converters and utilities for images, PDFs, audio, video, and developer work.`,
  alternates: { canonical: "/all-tools" },
};

const H2 = "m-0 font-display text-[17px] leading-[1.25] font-medium text-text-primary";
const RULE =
  "h-px bg-[linear-gradient(to_right,transparent,var(--color-border)_32px,var(--color-border)_calc(100%-32px),transparent)]";

export default function AllToolsPage() {
  const groups = categories
    .map((cat) => ({
      cat,
      catTools: tools.filter((t) => t.category === cat.slug),
    }))
    .filter((g) => g.catTools.length > 0);

  return (
    <main className="mx-auto w-full max-w-[840px] flex-1 px-4 pt-11 pb-12 md:px-8">
      <div className="flex flex-col gap-7">
        <h1 className="m-0 font-display text-[clamp(28px,5vw,36px)] leading-[1.14] font-medium tracking-[-0.028em] text-text-primary">
          All tools
        </h1>

        <p className="m-0 max-w-[620px] font-body text-[15px] leading-[1.75] text-neutral-300">
          Every one of the {tools.length} tools on Transmute, on one page. Each
          runs entirely in your browser — no upload, no sign-up, no server.
        </p>

        <div className={RULE} />

        {groups.map(({ cat, catTools }) => (
          <section key={cat.slug} className="flex flex-col gap-2.5">
            <div className="flex items-baseline gap-2.5">
              <h2 className={H2}>{cat.name}</h2>
              <span className="font-mono text-[10px] leading-none text-text-muted">
                {catTools.length}
              </span>
              <Link
                href={`/${cat.slug}`}
                className="ml-auto rounded-sm font-mono text-[10px] leading-none tracking-[0.04em] text-text-muted transition-colors duration-200 hover:text-accent-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                HUB →
              </Link>
            </div>

            <ul className="m-0 grid list-none grid-cols-1 gap-x-8 p-0 sm:grid-cols-2">
              {catTools.map((tool) => (
                <li key={tool.slug} className="min-w-0">
                  <Link
                    href={`/${tool.slug}`}
                    className="flex min-w-0 flex-col gap-0.5 border-b border-border py-[11px] transition-[padding-left] duration-200 hover:pl-1.5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
                  >
                    <span className="truncate font-body text-[13.5px] leading-[1.3] font-medium text-neutral-200">
                      {tool.name}
                    </span>
                    <span className="line-clamp-1 font-body text-[11.5px] leading-[1.45] text-text-muted">
                      {tool.hubLine ?? tool.description}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
