import type { MarkdownPdfTheme, MarkdownPdfFont } from "./markdown-to-pdf";

interface PrintCssOpts {
  theme: MarkdownPdfTheme;
  font: MarkdownPdfFont;
  pageSize?: "A4" | "Letter";
}

/**
 * Build the inline `<style>` block injected into the print iframe. The iframe
 * is `about:blank` so it cannot inherit parent styles or reference Tailwind
 * tokens — every value is hard-coded.
 *
 * Web fonts are imported from Google Fonts at print time. The .woff2 data-URI
 * fallback in plan §P.3 was deferred because shipping all four faces (Newsreader
 * regular/italic, JetBrains Mono regular/bold, Outfit regular/medium) inline
 * would exceed the 200 KB budget. The trade-off: the iframe issues a one-shot
 * network request when the user clicks Export. We await `document.fonts.ready`
 * before triggering print so the layout is stable when the PDF is captured.
 */
export function buildPrintCss({ theme, font, pageSize = "A4" }: PrintCssOpts): string {
  const isDark = theme === "dark";
  const isSerif = font === "serif";

  const palette = isDark
    ? {
        bg: "#1a1814",
        text: "#f0eee8",
        textMuted: "#b8b6ae",
        rule: "#3a3733",
        codeBg: "#22201c",
        inlineCodeBg: "#2a2723",
        blockquoteBar: "#c9b88a",
        link: "#e0c374",
        tableHeaderBg: "#22201c",
      }
    : {
        bg: "#fdfdfb",
        text: "#1f1d1a",
        textMuted: "#5a5852",
        rule: "#e8e6e0",
        codeBg: "#f7f5ef",
        inlineCodeBg: "#f3efe7",
        blockquoteBar: "#c9b88a",
        link: "#9a7b1f",
        tableHeaderBg: "#f7f5ef",
      };

  const bodyFamily = isSerif
    ? `"Newsreader", "Charter", "Iowan Old Style", Georgia, "Times New Roman", serif`
    : `"Outfit", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;

  // Heading font: sans even when body is serif, for the MD Peek rhythm.
  const headingFamily = `"Syne", "Outfit", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  const monoFamily = `"JetBrains Mono", "SF Mono", Consolas, "Liberation Mono", Menlo, monospace`;

  return `
@import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Outfit:wght@400;500;600;700&family=Syne:wght@600;700&family=JetBrains+Mono:wght@400;700&display=swap');

@page {
  size: ${pageSize};
  margin: 18mm 16mm;
}
@page :first {
  margin-top: 28mm;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: ${palette.bg};
  color: ${palette.text};
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

body {
  font-family: ${bodyFamily};
  font-size: 11pt;
  line-height: 1.65;
  letter-spacing: 0.005em;
}

.md-pdf-doc {
  max-width: 100%;
  margin: 0 auto;
}

h1, h2, h3, h4, h5, h6 {
  font-family: ${headingFamily};
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.25;
  color: ${palette.text};
  break-after: avoid;
  page-break-after: avoid;
}
h1 {
  font-size: 22pt;
  margin: 24pt 0 12pt;
  font-weight: 700;
}
h2 {
  font-size: 17pt;
  margin: 20pt 0 10pt;
  padding-bottom: 4pt;
  border-bottom: 1px solid ${palette.rule};
}
h3 { font-size: 14pt; margin: 16pt 0 8pt; }
h4 { font-size: 12pt; margin: 14pt 0 6pt; }
h5, h6 { font-size: 11pt; margin: 12pt 0 4pt; color: ${palette.textMuted}; }

p {
  margin: 0 0 10pt;
  orphans: 3;
  widows: 3;
}

a {
  color: ${palette.link};
  text-decoration: underline;
  text-underline-offset: 2px;
}
@media print {
  /* Reveal the underlying URL for offline readers, but skip in-document anchors. */
  a[href^="http"]::after {
    content: " (" attr(href) ")";
    font-size: 0.85em;
    color: ${palette.textMuted};
    word-break: break-all;
  }
}

strong { font-weight: 600; }
em { font-style: italic; }
del { text-decoration: line-through; color: ${palette.textMuted}; }

ul, ol {
  margin: 0 0 10pt;
  padding-left: 1.4em;
}
li { margin: 4pt 0; }
li > ul, li > ol { margin: 4pt 0; }

blockquote {
  margin: 12pt 0;
  padding: 0 0 0 16px;
  border-left: 4px solid ${palette.blockquoteBar};
  color: ${palette.textMuted};
  font-size: 0.96em;
  font-style: italic;
  break-inside: avoid;
  page-break-inside: avoid;
}
blockquote p { margin: 0 0 6pt; }
blockquote p:last-child { margin: 0; }

code {
  font-family: ${monoFamily};
  font-size: 0.92em;
  background: ${palette.inlineCodeBg};
  color: ${palette.text};
  padding: 2px 6px;
  border-radius: 4px;
}

pre {
  margin: 12pt 0;
  padding: 16px 18px;
  background: ${palette.codeBg};
  border-radius: 12px;
  font-family: ${monoFamily};
  font-size: 0.92em;
  line-height: 1.5;
  overflow: hidden;
  break-inside: avoid;
  page-break-inside: avoid;
  white-space: pre-wrap;
  word-wrap: break-word;
}
pre code {
  background: transparent;
  padding: 0;
  border-radius: 0;
  font-size: 1em;
}

/* Shiki emits a <pre class="shiki ..."> with inline color styles per span.
   Make sure our wrapper styling doesn't fight Shiki's background tokens. */
pre.shiki {
  background: ${palette.codeBg} !important;
}
pre.shiki code { color: inherit; }

/* Plain fallback when no Shiki theme is loaded for the lang. */
pre.md-pdf-code-fallback {
  background: ${palette.codeBg};
  color: ${palette.text};
}

table {
  width: 100%;
  margin: 12pt 0;
  border-collapse: collapse;
  break-inside: avoid;
  page-break-inside: avoid;
  font-size: 0.96em;
}
th, td {
  padding: 8px 12px;
  border: 1px solid ${palette.rule};
  text-align: left;
  vertical-align: top;
}
th {
  background: ${palette.tableHeaderBg};
  font-weight: 600;
  font-family: ${headingFamily};
}

hr {
  margin: 24pt 0;
  border: 0;
  border-top: 1px solid ${palette.rule};
}

img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 12pt auto;
  break-inside: avoid;
  page-break-inside: avoid;
}
img[alt]::after {
  display: block;
  content: attr(alt);
  font-size: 9pt;
  color: ${palette.textMuted};
  font-style: italic;
  text-align: center;
  margin-top: 4pt;
}

/* Task-list rendering — checkbox token is replaced with ☐/☑ glyph in renderer. */
ul li:has(> input[type="checkbox"]),
ul li:where(:first-letter) {
  list-style: none;
}
`;
}

/**
 * Build the full print-ready HTML document injected into the iframe.
 * Self-contained — references no external stylesheets except the Google Fonts
 * @import inside the inline <style>.
 */
export function buildPrintHtml({
  bodyHtml,
  title,
  theme,
  font,
  pageSize = "A4",
}: {
  bodyHtml: string;
  title: string;
  theme: MarkdownPdfTheme;
  font: MarkdownPdfFont;
  pageSize?: "A4" | "Letter";
}): string {
  const css = buildPrintCss({ theme, font, pageSize });
  // Title is user-controllable so escape it before embedding in <title>.
  const safeTitle = title
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${safeTitle}</title>
<style>${css}</style>
</head>
<body>
<article class="md-pdf-doc">
${bodyHtml}
</article>
</body>
</html>`;
}
