import Link from "next/link";
import type { Tool } from "@/data/tools";
import { BreadcrumbSchema } from "@/components/seo/BreadcrumbSchema";

export interface CategoryHubSection {
  title?: string;
  tools: Tool[];
}

interface CategoryHubPageProps {
  breadcrumbName: string;
  breadcrumbHref: string;
  title: string;
  intro: string;
  sections: CategoryHubSection[];
}

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

  return (
    <main className="flex-1 px-4 py-14 max-w-5xl mx-auto w-full">
      <BreadcrumbSchema items={breadcrumbs} />

      <nav aria-label="Breadcrumb" className="mb-8">
        <ol className="flex items-center gap-2 text-sm text-text-muted">
          <li>
            <Link href="/" className="hover:text-text-secondary transition-colors duration-200">
              Home
            </Link>
          </li>
          <li className="flex items-center gap-2">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="opacity-40"
              aria-hidden="true"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span className="text-text-secondary">{breadcrumbName}</span>
          </li>
        </ol>
      </nav>

      <div className="mb-12">
        <h1 className="text-3xl md:text-4xl font-bold font-display tracking-tight text-text-primary mb-3">
          {title}
        </h1>
        <p className="text-text-secondary text-lg leading-relaxed max-w-2xl">{intro}</p>
      </div>

      {sections.map((section, idx) => {
        if (section.tools.length === 0) return null;
        const isLast = idx === sections.length - 1;
        return (
          <section key={section.title ?? idx} className={isLast ? undefined : "mb-12"}>
            {section.title && (
              <h2 className="text-sm font-semibold font-display text-text-muted uppercase tracking-wider mb-5">
                {section.title}
              </h2>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {section.tools.map((tool) => (
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
        );
      })}
    </main>
  );
}
