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
});
