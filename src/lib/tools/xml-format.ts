/**
 * XML pretty-print / minify on the browser's own parser. Parse errors
 * surface as thrown Errors with the parser's message.
 *
 * Both entry points walk the parsed `Document` rather than re-indenting the
 * serialized string. The old string pass split on every `>` `<` boundary and
 * treated the resulting fragments as tags, so a text node containing a newline
 * ("line one\nline two") became two "lines", gained indentation of its own —
 * changing document *content*, not just layout — and permanently desynced the
 * depth counter for every sibling after it.
 *
 * Serialization is hand-rolled instead of `XMLSerializer` because serializing a
 * nested element on its own makes the serializer re-declare every namespace it
 * inherits from an ancestor: `<b>x</b>` inside `<root xmlns="urn:x">` comes
 * back as `<b xmlns="urn:x">x</b>`. A formatter must not add attributes.
 */

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_NODE = 4;
const PI_NODE = 7;
const COMMENT_NODE = 8;
const DOCTYPE_NODE = 10;

function parseOrThrow(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const errorNode = doc.querySelector("parsererror");
  if (errorNode) throw new Error(errorNode.textContent ?? "Invalid XML");
  return doc;
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

function attrsOf(el: Element): string {
  return Array.from(el.attributes)
    .map((a) => ` ${a.name}="${escapeAttr(a.value)}"`)
    .join("");
}

/** One node, and everything under it, on a single line. */
function serializeNode(node: Node): string {
  switch (node.nodeType) {
    case ELEMENT_NODE: {
      const el = node as Element;
      const attrs = attrsOf(el);
      if (el.childNodes.length === 0) return `<${el.nodeName}${attrs}/>`;
      const inner = Array.from(el.childNodes).map(serializeNode).join("");
      return `<${el.nodeName}${attrs}>${inner}</${el.nodeName}>`;
    }
    case TEXT_NODE:
      return escapeText(node.nodeValue ?? "");
    case CDATA_NODE:
      return `<![CDATA[${node.nodeValue ?? ""}]]>`;
    case COMMENT_NODE:
      return `<!--${node.nodeValue ?? ""}-->`;
    case PI_NODE: {
      const pi = node as ProcessingInstruction;
      return `<?${pi.target}${pi.data ? ` ${pi.data}` : ""}?>`;
    }
    case DOCTYPE_NODE: {
      const dt = node as DocumentType;
      const pub = dt.publicId ? ` PUBLIC "${dt.publicId}"` : "";
      const sys = dt.systemId
        ? `${dt.publicId ? "" : " SYSTEM"} "${dt.systemId}"`
        : "";
      return `<!DOCTYPE ${dt.name}${pub}${sys}>`;
    }
    default:
      return "";
  }
}

/** Does this node hold real (non-whitespace) character data of its own? */
function hasCharacterData(node: Node): boolean {
  return Array.from(node.childNodes).some(
    (c) =>
      (c.nodeType === TEXT_NODE || c.nodeType === CDATA_NODE) &&
      (c.nodeValue ?? "").trim() !== "",
  );
}

/** Any surviving text/CDATA child — after stripping, all of it is significant. */
function hasTextChild(node: Node): boolean {
  return Array.from(node.childNodes).some(
    (c) => c.nodeType === TEXT_NODE || c.nodeType === CDATA_NODE,
  );
}

/**
 * Delete the whitespace-only text nodes that are pure layout, and only those.
 * XML alone cannot say which whitespace is ignorable — that needs a DTD — so
 * this takes the two signals that are actually available:
 *
 *  - it must CONTAIN A NEWLINE. `<b>Hello</b> <i>world</i>` renders as two
 *    words; deleting that single space joins them. A `>\n  <` boundary is
 *    someone's indentation.
 *  - its parent must have no real character data of its own, so a lone `"\n"`
 *    between two inline elements inside a paragraph of prose is left alone.
 */
function stripIgnorableWhitespace(node: Node): void {
  const insideProse = hasCharacterData(node);
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === TEXT_NODE) {
      const text = child.nodeValue ?? "";
      if (!insideProse && text.trim() === "" && text.includes("\n")) {
        node.removeChild(child);
      }
      continue;
    }
    if (child.nodeType === ELEMENT_NODE) stripIgnorableWhitespace(child);
  }
}

function printNode(node: Node, depth: number, out: string[]): void {
  const pad = "  ".repeat(depth);
  if (node.nodeType !== ELEMENT_NODE) {
    const text = serializeNode(node);
    if (text.trim()) out.push(pad + text);
    return;
  }

  const el = node as Element;
  // Empty, simple-text and mixed-content elements print whole, on one line —
  // that is what keeps a multi-line text node byte-identical to the input, and
  // what stops a significant inter-element space being indented away.
  if (el.childNodes.length === 0 || hasTextChild(el)) {
    out.push(pad + serializeNode(el));
    return;
  }

  out.push(`${pad}<${el.nodeName}${attrsOf(el)}>`);
  for (const child of Array.from(el.childNodes)) printNode(child, depth + 1, out);
  out.push(`${pad}</${el.nodeName}>`);
}

export function formatXml(xml: string): string {
  const doc = parseOrThrow(xml);
  stripIgnorableWhitespace(doc);

  const out: string[] = [];
  for (const child of Array.from(doc.childNodes)) printNode(child, 0, out);
  return out.join("\n");
}

export function minifyXml(xml: string): string {
  const doc = parseOrThrow(xml);
  stripIgnorableWhitespace(doc);
  return Array.from(doc.childNodes).map(serializeNode).join("");
}
