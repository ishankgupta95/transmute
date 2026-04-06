import type { ReactNode } from "react";
import Link from "next/link";
import type { FAQ } from "@/data/faqs";
import type { Tool } from "@/data/tools";
import { getToolBySlug } from "@/data/tools";
import { ToolSchema } from "@/components/seo/ToolSchema";
import { BreadcrumbSchema } from "@/components/seo/BreadcrumbSchema";

interface ToolPageLayoutProps {
  tool: Tool;
  children: ReactNode;
  howToSteps: string[];
  faqs: FAQ[];
  aboutText?: string;
}

export function ToolPageLayout({
  tool,
  children,
  howToSteps,
  faqs,
  aboutText,
}: ToolPageLayoutProps) {
  const relatedTools = tool.relatedTools
    .map((slug) => getToolBySlug(slug))
    .filter((t): t is Tool => t !== undefined);

  const categoryNames: Record<string, string> = {
    "image-tools": "Image Tools",
    "pdf-tools": "PDF Tools",
    "developer-tools": "Developer Tools",
  };
  const categoryName = categoryNames[tool.category] ?? tool.category;

  const breadcrumbs = [
    { name: "Home", href: "/" },
    { name: categoryName, href: `/${tool.category}` },
    { name: tool.name, href: `/${tool.slug}` },
  ];

  return (
    <main className="flex-1 px-4 py-12 max-w-4xl mx-auto w-full">
      <ToolSchema toolName={tool.name} howToSteps={howToSteps} faqs={faqs} />
      <BreadcrumbSchema items={breadcrumbs} />

      {/* Breadcrumbs */}
      <nav aria-label="Breadcrumb" className="mb-8">
        <ol className="flex items-center gap-1.5 text-sm text-text-muted">
          {breadcrumbs.map((crumb, i) => (
            <li key={crumb.href} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden="true">/</span>}
              {i < breadcrumbs.length - 1 ? (
                <Link href={crumb.href} className="hover:text-text-secondary transition-colors">
                  {crumb.name}
                </Link>
              ) : (
                <span className="text-text-secondary">{crumb.name}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>

      {/* Hero */}
      <section className="text-center mb-10">
        <h1 className="text-3xl md:text-4xl font-bold font-display text-text-primary mb-2">
          {tool.h1}
        </h1>
        <p className="text-text-secondary text-lg">{tool.subtitle}</p>
      </section>

      {/* Tool UI */}
      <section className="mb-12">{children}</section>

      {/* How-To Steps */}
      {howToSteps.length > 0 && (
        <section className="mb-12">
          <h2 className="text-xl font-bold font-display text-text-primary mb-4">
            How It Works
          </h2>
          <ol className="space-y-3">
            {howToSteps.map((step, i) => (
              <li key={i} className="flex gap-3 text-text-secondary">
                <span className="flex-shrink-0 w-7 h-7 rounded-full bg-accent-muted text-accent text-sm font-bold flex items-center justify-center">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* About This Tool */}
      {aboutText && (
        <section className="mb-12">
          <h2 className="text-xl font-bold font-display text-text-primary mb-4">
            About {tool.name}
          </h2>
          <p className="text-text-secondary leading-relaxed">{aboutText}</p>
        </section>
      )}

      {/* FAQ */}
      {faqs.length > 0 && (
        <section className="mb-12">
          <h2 className="text-xl font-bold font-display text-text-primary mb-4">
            Frequently Asked Questions
          </h2>
          <div className="space-y-4">
            {faqs.map((faq, i) => (
              <details
                key={i}
                className="group rounded-lg border border-border bg-bg-secondary p-4"
              >
                <summary className="cursor-pointer font-medium text-text-primary">
                  {faq.question}
                </summary>
                <p className="mt-2 text-sm text-text-secondary">{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* Related Tools */}
      {relatedTools.length > 0 && (
        <section>
          <h2 className="text-xl font-bold font-display text-text-primary mb-4">
            Related Tools
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {relatedTools.map((related) => (
              <Link
                key={related.slug}
                href={`/${related.slug}`}
                className="rounded-lg border border-border bg-bg-secondary p-4 hover:border-border-hover hover:bg-bg-hover transition-colors"
              >
                <p className="font-medium text-text-primary">{related.name}</p>
                <p className="text-sm text-text-muted mt-1 line-clamp-2">
                  {related.description}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
