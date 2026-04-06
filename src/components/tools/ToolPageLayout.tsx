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
    <main className="flex-1 px-4 py-14 max-w-4xl mx-auto w-full">
      <ToolSchema toolName={tool.name} howToSteps={howToSteps} faqs={faqs} />
      <BreadcrumbSchema items={breadcrumbs} />

      {/* Breadcrumbs */}
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
                <span className="text-text-secondary">{crumb.name}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>

      {/* Hero */}
      <section className="text-center mb-12">
        <h1 className="text-3xl md:text-4xl font-bold font-display tracking-tight text-text-primary mb-3">
          {tool.h1}
        </h1>
        <p className="text-text-secondary text-lg leading-relaxed max-w-2xl mx-auto">{tool.subtitle}</p>
      </section>

      {/* Tool UI */}
      <section className="mb-16">{children}</section>

      {/* How-To Steps */}
      {howToSteps.length > 0 && (
        <section className="mb-14">
          <h2 className="text-xl font-bold font-display text-text-primary mb-6">
            How It Works
          </h2>
          <ol className="space-y-4">
            {howToSteps.map((step, i) => (
              <li key={i} className="flex gap-4 items-start">
                <span className="flex-shrink-0 w-8 h-8 rounded-md bg-accent-muted border border-[rgba(86,184,230,0.15)] text-accent text-sm font-bold flex items-center justify-center">
                  {i + 1}
                </span>
                <span className="text-text-secondary pt-1 leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* About This Tool */}
      {aboutText && (
        <section className="mb-14">
          <h2 className="text-xl font-bold font-display text-text-primary mb-4">
            About {tool.name}
          </h2>
          <p className="text-text-secondary leading-relaxed">{aboutText}</p>
        </section>
      )}

      {/* FAQ */}
      {faqs.length > 0 && (
        <section className="mb-14">
          <h2 className="text-xl font-bold font-display text-text-primary mb-6">
            Frequently Asked Questions
          </h2>
          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <details
                key={i}
                className="group rounded-lg border border-border/80 bg-bg-secondary/40 backdrop-blur-sm overflow-hidden"
              >
                <summary className="cursor-pointer px-6 py-4 font-medium text-text-primary flex items-center justify-between">
                  {faq.question}
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="flex-shrink-0 text-text-muted transition-transform duration-200 group-open:rotate-180"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </summary>
                <p className="px-6 pb-5 text-sm text-text-secondary leading-relaxed">{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* Related Tools */}
      {relatedTools.length > 0 && (
        <section>
          <h2 className="text-xl font-bold font-display text-text-primary mb-6">
            Related Tools
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {relatedTools.map((related) => (
              <Link
                key={related.slug}
                href={`/${related.slug}`}
                className="group rounded-lg border border-border/80 bg-bg-secondary/40 backdrop-blur-sm p-5 transition-all duration-300 hover:border-accent/30 hover:bg-bg-elevated/50 hover:-translate-y-0.5"
              >
                <p className="font-semibold text-text-primary group-hover:text-accent transition-colors duration-200">{related.name}</p>
                <p className="text-sm text-text-muted mt-1.5 line-clamp-2 leading-relaxed">
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
