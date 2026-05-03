import type { Metadata } from "next";
import { getToolsByCategory } from "@/data/tools";
import { CategoryHubPage } from "@/components/layout/CategoryHubPage";

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
  const sections = SECTIONS.map((section) => ({
    title: section.title,
    tools: devTools.filter((t) => section.types.includes(t.toolType)),
  }));

  return (
    <CategoryHubPage
      breadcrumbName="Developer Tools"
      breadcrumbHref="/developer-tools"
      title="Developer Tools"
      intro="Format JSON, encode Base64, generate UUIDs, test regex, build CSS gradients, and more — all free, all running locally in your browser."
      sections={sections}
    />
  );
}
