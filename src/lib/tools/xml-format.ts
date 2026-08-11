/**
 * XML pretty-print / minify on the browser's own parser. Parse errors
 * surface as thrown Errors with the parser's message.
 */

function parseOrThrow(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const errorNode = doc.querySelector("parsererror");
  if (errorNode) throw new Error(errorNode.textContent ?? "Invalid XML");
  return doc;
}

export function formatXml(xml: string): string {
  const raw = new XMLSerializer().serializeToString(parseOrThrow(xml));

  let formatted = "";
  let indent = 0;
  const parts = raw.replace(/(>)(<)/g, "$1\n$2").split("\n");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("</")) indent--;
    formatted += "  ".repeat(Math.max(0, indent)) + trimmed + "\n";
    // Only an ELEMENT opening tag opens a level. `<!-- comments -->`,
    // `<!DOCTYPE>` and `<?processing?>` used to match the old "starts with <"
    // test and pushed everything after them one level deep.
    if (
      /^<[a-zA-Z]/.test(trimmed) &&
      !trimmed.endsWith("/>") &&
      !trimmed.includes("</")
    ) {
      indent++;
    }
  }
  return formatted.trim();
}

export function minifyXml(xml: string): string {
  return new XMLSerializer()
    .serializeToString(parseOrThrow(xml))
    .replace(/>\s+</g, "><");
}
