import type { Metadata } from "next";
import { getToolsByCategory } from "@/data/tools";
import { CategoryHubPage } from "@/components/layout/CategoryHubPage";

/*
  Hand-written and read by no test, so it rots the moment the category grows
  and nothing goes red. Refreshed twice in Wave 4: first for the developer
  fills, which put YAML, HAR, XLSX and a signing JWT tool on the hub, and again
  for batch 2, which put ZIP, TAR, 7z, RAR, SVG, DOCX and a QR reader on it —
  the SERP line had been describing a category that stopped at JSON and Base64,
  and then one that never opened a file that was not text.
*/
export const metadata: Metadata = {
  title: "Developer Tools — JSON, YAML, ZIP, Base64 & More",
  description:
    "Free browser-based developer tools. Convert YAML and JSON, zip and unzip files, open a TAR or 7z archive, optimise SVGs, read a QR code, sign JWTs and checksum files. Nothing uploaded.",
  keywords: [
    "developer tools",
    "json formatter",
    "yaml to json",
    "json to yaml",
    "base64 encoder",
    "uuid generator",
    "password generator",
    "regex tester",
    "har viewer",
    "xlsx to csv",
    "jwt encoder",
    "file checksum",
    "chmod calculator",
    "unzip files online",
    "extract 7z online",
    "svg optimizer",
    "docx to markdown",
    "qr code reader",
    "barcode generator",
    "css gradient generator",
  ],
  alternates: { canonical: "/developer-tools" },
  openGraph: {
    title: "Developer Tools — JSON, YAML, ZIP, Base64 & More | Transmute",
    description: "Free browser-based developer tools. Convert, format, encode, generate, unpack, and test — no sign-up required.",
    url: "/developer-tools",
  },
};

/*
  Developer tools keep their own five-way grouping rather than the
  Utilities / Format-converters split the four media hubs use: "convert one
  format to another" does not describe most of what is here. Captions match
  the other hubs' voice.
*/
/*
  Wave 4's nineteen fills are folded into the five groups rather than given a
  sixth: `yaml-json-converter` reads like `csv-to-json`, `line-endings` like
  the other encodings, `wifi-qr-code` like `qr-code-generator`. Two placements
  are worth a word. `har-viewer` sits with the formatters, not the utilities,
  because a HAR is JSON and the page's job is making it readable. And
  `file-checksum` sits with the generators beside `hash-generator` even though
  its point is the comparison — the digests are what it makes, and splitting
  the two hashing pages across two headings would hide the pair.
*/
/*
  Batch 2 is where the sixth group finally earned itself. Three of its seven
  tools open or write an archive, and none of the five headings above fits:
  "Utilities" is inspect/compare/convert and an archive page is none of those,
  and "Text & Data Formatters" would file a .rar under text. The other four
  fold in: `svg-optimizer` sits with the formatters because an SVG is XML and
  the page's job is taking that apart and writing it back smaller,
  `docx-to-markdown` beside the two Markdown pages it shares a writer with,
  `barcode-generator` beside the two QR generators, and `qr-code-reader` with
  the decoders rather than the generators, because it runs the other way.
*/
const SECTIONS = [
  { title: "Text & Data Formatters", caption: "PASTE IT IN, GET IT READABLE", types: ["json-formatter", "json-minify", "json-to-csv", "csv-to-json", "yaml-json-converter", "yaml-formatter", "sql-formatter", "markdown-to-html", "html-to-markdown", "docx-to-markdown", "xml-formatter", "svg-optimizer", "xlsx-to-csv", "har-viewer", "sort-dedupe-lines"] },
  { title: "Files & Archives", caption: "OPEN IT, PACK IT, READ IT", types: ["create-zip", "unzip-files", "extract-archive"] },
  { title: "Encoders & Decoders", caption: "ONE ENCODING TO ANOTHER", types: ["base64-encode-decode", "url-encode-decode", "jwt-decoder", "jwt-encoder", "html-entity-encode-decode", "charset-converter", "line-endings", "qr-code-reader"] },
  { title: "Generators", caption: "NOTHING IN, SOMETHING OUT", types: ["uuid-generator", "password-generator", "hash-generator", "hmac-generator", "file-checksum", "lorem-ipsum-generator", "qr-code-generator", "wifi-qr-code", "barcode-generator"] },
  { title: "CSS Tools", caption: "TUNE IT, COPY THE RULE", types: ["color-picker", "css-gradient-generator", "box-shadow-generator"] },
  { title: "Utilities", caption: "INSPECT, COMPARE, CONVERT", types: ["regex-tester", "cron-expression-generator", "timestamp-converter", "timezone-converter", "text-diff", "text-case-converter", "word-counter", "subtitle-converter", "chmod-calculator", "http-status-codes", "byte-converter", "aspect-ratio-calculator", "url-parser"] },
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
      intro="Format JSON, encode Base64, zip and unpack archives, optimise SVGs, read a QR code, generate UUIDs, test regex, and more — all free, all running locally in your browser."
      sections={sections}
    />
  );
}
