import type { Metadata } from "next";
import Link from "next/link";
import { getToolsByCategory } from "@/data/tools";
import { BreadcrumbSchema } from "@/components/seo/BreadcrumbSchema";

export const metadata: Metadata = {
  title: "Developer Tools — JSON, Base64, Hashes & More | Transmute",
  description:
    "Free browser-based developer tools. Format JSON & SQL, encode Base64, generate UUIDs & passwords, test regex, build CSS gradients, and more. No sign-up required.",
  keywords: [
    "developer tools",
    "json formatter",
    "base64 encoder",
    "uuid generator",
    "password generator",
    "regex tester",
    "css gradient generator",
  ],
};

const SECTIONS = [
  { title: "Text & Data Formatters", types: ["json-formatter", "json-to-csv", "csv-to-json", "sql-formatter", "markdown-to-html", "html-to-markdown", "xml-formatter"] },
  { title: "Encoders & Decoders", types: ["base64-encode-decode", "url-encode-decode", "jwt-decoder", "html-entity-encode-decode"] },
  { title: "Generators", types: ["uuid-generator", "password-generator", "hash-generator", "lorem-ipsum-generator", "qr-code-generator"] },
  { title: "CSS Tools", types: ["color-picker", "css-gradient-generator", "box-shadow-generator"] },
  { title: "Utilities", types: ["regex-tester", "cron-expression-generator", "timestamp-converter", "text-diff", "text-case-converter", "word-counter"] },
];

export default function DeveloperToolsPage() {
  const devTools = getToolsByCategory("developer-tools");

  const breadcrumbs = [
    { name: "Home", href: "/" },
    { name: "Developer Tools", href: "/developer-tools" },
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
            <span className="text-text-secondary">Developer Tools</span>
          </li>
        </ol>
      </nav>

      <h1 className="text-3xl font-bold font-display text-text-primary mb-2">
        Developer Tools
      </h1>
      <p className="text-text-secondary mb-10 max-w-2xl">
        Format JSON, encode Base64, generate UUIDs, test regex, build CSS gradients, and
        more — all free, all running locally in your browser.
      </p>

      {SECTIONS.map((section) => {
        const sectionTools = devTools.filter((t) => section.types.includes(t.toolType));
        if (sectionTools.length === 0) return null;
        return (
          <section key={section.title} className="mb-10">
            <h2 className="text-lg font-bold font-display text-text-primary mb-4">
              {section.title}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sectionTools.map((tool) => (
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
        );
      })}
    </main>
  );
}
