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
  alternates: { canonical: "/developer-tools" },
  openGraph: {
    title: "Developer Tools — JSON, Base64, Hashes & More | Transmute",
    description: "Free browser-based developer tools. Format, encode, generate, and test — no sign-up required.",
    url: "/developer-tools",
  },
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
      <main className="flex-1 px-4 py-14 max-w-5xl mx-auto w-full">
        <BreadcrumbSchema items={breadcrumbs} />

        {/* Breadcrumbs */}
        <nav aria-label="Breadcrumb" className="mb-8">
          <ol className="flex items-center gap-2 text-sm text-text-muted">
            <li>
              <Link href="/" className="hover:text-text-secondary transition-colors duration-200">
                Home
              </Link>
            </li>
            <li className="flex items-center gap-2">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-40">
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span className="text-text-secondary">Developer Tools</span>
            </li>
          </ol>
        </nav>

        <div className="mb-12">
          <h1 className="text-3xl md:text-4xl font-bold font-display tracking-tight text-text-primary mb-3">
            Developer Tools
          </h1>
          <p className="text-text-secondary text-lg leading-relaxed max-w-2xl">
            Format JSON, encode Base64, generate UUIDs, test regex, build CSS gradients, and
            more — all free, all running locally in your browser.
          </p>
        </div>

        {SECTIONS.map((section) => {
          const sectionTools = devTools.filter((t) => section.types.includes(t.toolType));
          if (sectionTools.length === 0) return null;
          return (
            <section key={section.title} className="mb-12">
              <h2 className="text-sm font-semibold font-display text-text-muted uppercase tracking-wider mb-5">
                {section.title}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {sectionTools.map((tool) => (
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
