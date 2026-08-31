import { describe, it, expect } from "vitest";
import { formatXml, minifyXml } from "@/lib/tools/xml-format";

describe("formatXml", () => {
  it("indents nested elements two spaces per level", () => {
    expect(formatXml("<root><item><name>Test</name></item></root>")).toBe(
      ["<root>", "  <item>", "    <name>Test</name>", "  </item>", "</root>"].join("\n"),
    );
  });

  it("does not indent after a comment — the old off-by-one", () => {
    const out = formatXml("<root><!-- a comment --><item>x</item></root>");
    expect(out).toBe(
      ["<root>", "  <!-- a comment -->", "  <item>x</item>", "</root>"].join("\n"),
    );
  });

  it("keeps siblings level after a self-closing element", () => {
    const out = formatXml("<root><a/><b>x</b></root>");
    expect(out.split("\n")).toEqual(["<root>", "  <a/>", "  <b>x</b>", "</root>"]);
  });

  it("does not touch a text node containing a newline", () => {
    // The old string-splitting indenter re-indented "line two" as if it were a
    // tag, changing document CONTENT, and desynced the depth counter after it.
    const out = formatXml("<root><p>line one\nline two</p><a>x</a></root>");
    expect(out).toBe(
      ["<root>", "  <p>line one\nline two</p>", "  <a>x</a>", "</root>"].join("\n"),
    );
  });

  it("keeps mixed content on one line, spacing intact", () => {
    const out = formatXml("<root><p>Hello <b>world</b> now</p></root>");
    expect(out).toBe(["<root>", "  <p>Hello <b>world</b> now</p>", "</root>"].join("\n"));
  });

  it("does not re-declare an inherited namespace on children", () => {
    const out = formatXml('<root xmlns="urn:x"><a><b>text</b></a></root>');
    expect(out).toBe(
      ['<root xmlns="urn:x">', "  <a>", "    <b>text</b>", "  </a>", "</root>"].join("\n"),
    );
  });

  it("preserves attributes and escapes their values", () => {
    expect(formatXml('<root a="1&amp;2" b="x"/>')).toBe('<root a="1&amp;2" b="x"/>');
  });

  it("throws the parser's message for invalid XML", () => {
    expect(() => formatXml("<root><unclosed></root>")).toThrow();
  });
});

describe("minifyXml", () => {
  it("collapses inter-tag whitespace", () => {
    expect(minifyXml("<root>\n  <item>x</item>\n</root>")).toBe(
      "<root><item>x</item></root>",
    );
  });

  it("keeps SIGNIFICANT whitespace between siblings in mixed content", () => {
    // `<b>Hello</b> <i>world</i>` must not render as "Helloworld".
    expect(minifyXml("<p><b>Hello</b> <i>world</i></p>")).toBe(
      "<p><b>Hello</b> <i>world</i></p>",
    );
  });

  it("keeps the space between </a> and <b> — the reported corruption", () => {
    expect(
      minifyXml("<root><p>line one\nline two</p><a>x</a> <b>y</b></root>"),
    ).toBe("<root><p>line one\nline two</p><a>x</a> <b>y</b></root>");
  });

  it("keeps a multi-line text node exactly as written", () => {
    expect(minifyXml("<root><p>line one\nline two</p></root>")).toBe(
      "<root><p>line one\nline two</p></root>",
    );
  });
});
