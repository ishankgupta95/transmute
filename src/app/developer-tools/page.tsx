import type { Metadata } from "next";
import { getToolsByCategory } from "@/data/tools";
import { CategoryHubPage } from "@/components/layout/CategoryHubPage";

export const metadata: Metadata = {
  title: "Developer Tools — JSON, Base64, Hashes & More",
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

/*
  Developer tools keep their own five-way grouping rather than the
  Utilities / Format-converters split the four media hubs use: "convert one
  format to another" does not describe most of what is here. Captions match
  the other hubs' voice.
*/
const SECTIONS = [
  { title: "Text & Data Formatters", caption: "PASTE IT IN, GET IT READABLE", types: ["json-formatter", "json-to-csv", "csv-to-json", "sql-formatter", "markdown-to-html", "html-to-markdown", "xml-formatter"] },
  { title: "Encoders & Decoders", caption: "ONE ENCODING TO ANOTHER", types: ["base64-encode-decode", "url-encode-decode", "jwt-decoder", "html-entity-encode-decode"] },
  { title: "Generators", caption: "NOTHING IN, SOMETHING OUT", types: ["uuid-generator", "password-generator", "hash-generator", "lorem-ipsum-generator", "qr-code-generator"] },
  { title: "CSS Tools", caption: "TUNE IT, COPY THE RULE", types: ["color-picker", "css-gradient-generator", "box-shadow-generator"] },
  { title: "Utilities", caption: "INSPECT, COMPARE, CONVERT", types: ["regex-tester", "cron-expression-generator", "timestamp-converter", "text-diff", "text-case-converter", "word-counter"] },
];

export default function DeveloperToolsPage() {
  const devTools = getToolsByCategory("developer-tools");
  const grouped = SECTIONS.map((section) => ({
    title: section.title,
    caption: section.caption,
    tools: devTools.filter((t) => section.types.includes(t.toolType)),
  }));

  // The lists above are keyed by toolType, so a newly registered developer
  // tool would otherwise drop off this page silently. Catch the stragglers.
  const claimed = new Set(SECTIONS.flatMap((s) => s.types));
  const unclaimed = devTools.filter((t) => !claimed.has(t.toolType));

  const sections = [
    ...grouped.filter((s) => s.tools.length > 0),
    ...(unclaimed.length > 0
      ? [{ title: "More", caption: "EVERYTHING ELSE", tools: unclaimed }]
      : []),
  ];

  return (
    <CategoryHubPage
      breadcrumbName="Developer Tools"
      breadcrumbHref="/developer-tools"
      title="Developer tools"
      intro="Format JSON, encode Base64, generate UUIDs, test regex, build CSS gradients, and more — all free, all running locally in your browser."
      sections={sections}
    />
  );
}
