/**
 * The .docx reader, exercised against real packages.
 *
 * Every fixture here is a genuine ZIP of OOXML built by `docx()` below — a
 * DOCX is nothing else — so mammoth, jszip and turndown all run for real. That
 * matters more than usual on this page: the whole pitch is a truthful account
 * of what a Word document loses on the way to Markdown, and a mocked reader
 * would let that account drift away from what the code actually does.
 */
import { createElement } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import JSZip from "jszip";
import {
  convertDocxToMarkdown,
  countWords,
  DocxReadError,
  htmlToMarkdown,
  imageExtension,
  markdownFileName,
  markdownZipName,
  readDocxPackageFacts,
} from "@/lib/tools/docx-to-markdown";

afterEach(cleanup);

/* ── Fixture builders ───────────────────────────────────────────────────── */

const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';

/** A 1×1 red PNG, 70 bytes. Small enough to inline, real enough to decode. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function pngBytes(): Uint8Array {
  const binary = atob(PNG_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

interface DocxParts {
  body: string;
  /** Extra relationship entries for `word/_rels/document.xml.rels`. */
  rels?: string;
  extra?: Record<string, string | Uint8Array>;
}

/** A minimal but genuinely valid .docx package, as an ArrayBuffer. */
async function docx({ body, rels = "", extra = {} }: DocxParts): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      "</Types>",
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>",
  );
  zip.file(
    "word/_rels/document.xml.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      rels +
      "</Relationships>",
  );
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document ${W_NS}><w:body>${body}</w:body></w:document>`);
  for (const [path, content] of Object.entries(extra)) zip.file(path, content);
  const buffer = await zip.generateAsync({ type: "arraybuffer" });
  return buffer;
}

const para = (runs: string, pPr = "") => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${runs}</w:p>`;
const run = (text: string, rPr = "") =>
  `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const cell = (text: string, attrs = "") =>
  `<w:tc>${attrs ? `<w:tcPr>${attrs}</w:tcPr>` : ""}${para(run(text))}</w:tc>`;

const IMAGE_REL =
  '<Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>';

const drawing = (alt: string) =>
  "<w:r><w:drawing><wp:inline><wp:extent cx=\"1\" cy=\"1\"/>" +
  `<wp:docPr id="1" name="Picture 1" descr="${alt}"/>` +
  '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
  `<pic:nvPicPr><pic:cNvPr id="0" name="image1.png" descr="${alt}"/><pic:cNvPicPr/></pic:nvPicPr>` +
  '<pic:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  "<pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>";

/*
  Word's "Insert > Picture > Link to File": the relationship points OUT of the
  package with `TargetMode="External"` and the blip carries `r:link` rather than
  `r:embed`. There is no `word/media/` part at all, and a browser cannot open
  the path — mammoth's own `external-picture.docx` fixture is this shape.
*/
const LINKED_IMAGE_REL =
  '<Relationship Id="rIdLinked" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="tiny-picture.png" TargetMode="External"/>';

const linkedDrawing =
  "<w:r><w:drawing><wp:inline><wp:extent cx=\"1\" cy=\"1\"/>" +
  '<wp:docPr id="1" name="Picture 1"/>' +
  '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
  '<pic:nvPicPr><pic:cNvPr id="0" name="tiny-picture.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:link="rIdLinked"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  "<pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>";

/* ── The writer, on its own ─────────────────────────────────────────────── */

describe("htmlToMarkdown", () => {
  it("writes a pipe table where plain turndown would write loose paragraphs", () => {
    const { markdown, docFacts } = htmlToMarkdown(
      "<table><tr><td><p>Region</p></td><td><p>Q1</p></td></tr>" +
        "<tr><td><p>North</p></td><td><p>120</p></td></tr></table>",
    );
    expect(markdown).toBe("| Region | Q1 |\n| --- | --- |\n| North | 120 |");
    expect(docFacts.tables).toBe(1);
    expect(docFacts.tableRows).toBe(2);
    expect(docFacts.htmlTables).toBe(0);
  });

  it("pads a horizontally merged cell so the columns after it still line up", () => {
    const { markdown, docFacts } = htmlToMarkdown(
      '<table><tr><td colspan="2"><p>Both</p></td><td><p>C</p></td></tr>' +
        "<tr><td><p>a</p></td><td><p>b</p></td><td><p>c</p></td></tr></table>",
    );
    expect(markdown).toBe("| Both | | C |\n| --- | --- | --- |\n| a | b | c |");
    expect(docFacts.colspanCells).toBe(1);
    expect(docFacts.htmlTables).toBe(0);
  });

  it("keeps a vertically merged table as HTML rather than writing a wrong one", () => {
    const { markdown, docFacts } = htmlToMarkdown(
      '<table><tr><td rowspan="2"><p>Tall</p></td><td><p>a</p></td></tr>' +
        "<tr><td><p>b</p></td></tr></table>",
    );
    expect(markdown).toContain('rowspan="2"');
    expect(markdown).not.toContain("| --- |");
    expect(docFacts.rowspanCells).toBe(1);
    expect(docFacts.htmlTables).toBe(1);
  });

  it("does not count a merged cell as padded when its table stayed HTML", () => {
    // The merge is inside a table that takes the HTML exit, so nothing about it
    // was flattened — reporting it as a padded cell would overstate the loss.
    const { docFacts } = htmlToMarkdown(
      '<table><tr><td rowspan="2"><p>Tall</p></td><td colspan="2"><p>Wide</p></td></tr>' +
        "<tr><td><p>b</p></td><td><p>c</p></td></tr></table>",
    );
    expect(docFacts.colspanCells).toBe(1);
    expect(docFacts.pipeColspanCells).toBe(0);
    expect(docFacts.htmlTables).toBe(1);
  });

  it("counts multi-paragraph cells only in the tables that became pipe tables", () => {
    const { docFacts } = htmlToMarkdown(
      "<table><tr><td><p>one</p><p>two</p></td></tr></table>" +
        '<table><tr><td rowspan="2"><p>x</p><p>y</p></td><td><p>z</p></td></tr>' +
        "<tr><td><p>w</p></td></tr></table>",
    );
    expect(docFacts.multilineCells).toBe(2);
    expect(docFacts.pipeMultilineCells).toBe(1);
  });

  it("keeps a table nested in a cell as HTML", () => {
    const { docFacts } = htmlToMarkdown(
      "<table><tr><td><table><tr><td><p>inner</p></td></tr></table></td></tr></table>",
    );
    expect(docFacts.nestedTables).toBe(1);
    // BOTH tables come out as HTML: the outer one takes the exit, and the
    // inner one is carried along inside its `outerHTML`. Counting only the
    // outer one left the inner one classified as a pipe table it never became.
    expect(docFacts.htmlTables).toBe(2);
    expect(docFacts.pipeTables).toBe(0);
  });

  it("does not call a table nested inside an HTML table a pipe table", () => {
    // The whole thing is emitted as the outer table's raw markup, so nothing
    // in the inner table was padded out, flattened or given a header row —
    // and the page must not say any of those happened.
    const { markdown, docFacts } = htmlToMarkdown(
      "<table><tr><td><p>Form section</p>" +
        '<table><tr><td colspan="2"><p>one</p><p>two</p></td><td><p>z</p></td></tr></table>' +
        "</td></tr></table>",
    );
    expect(markdown.startsWith("<table>")).toBe(true);
    expect(markdown).not.toContain("| ---");
    expect(markdown).not.toContain("<br>");
    expect(docFacts.tables).toBe(2);
    expect(docFacts.pipeTables).toBe(0);
    expect(docFacts.htmlTables).toBe(2);
    // The document-wide figures still see the merge and the two paragraphs.
    expect(docFacts.colspanCells).toBe(1);
    expect(docFacts.multilineCells).toBe(1);
    // The pipe-table figures — the ones the page writes sentences from — do not.
    expect(docFacts.pipeColspanCells).toBe(0);
    expect(docFacts.pipeMultilineCells).toBe(0);
  });

  it("counts a list flattened into one cell, which has a single child element", () => {
    const { markdown, docFacts } = htmlToMarkdown(
      "<table><tr><td><ul><li>x</li><li>y</li></ul></td><td><p>z</p></td></tr></table>",
    );
    // The list is gone as a structure: its markers are literal text now.
    expect(markdown).toContain("| *   x<br>*   y | z |");
    expect(docFacts.multilineCells).toBe(1);
    expect(docFacts.pipeMultilineCells).toBe(1);
    expect(docFacts.pipeListCells).toBe(1);
  });

  it("counts a <br> inside a single paragraph as a flattened cell", () => {
    const { markdown, docFacts } = htmlToMarkdown(
      "<table><tr><td><p>one<br />two</p></td><td><p>z</p></td></tr></table>",
    );
    expect(markdown).toContain("| one<br>two | z |");
    expect(docFacts.pipeMultilineCells).toBe(1);
    // It was not a list, so the page says nothing about bullets.
    expect(docFacts.pipeListCells).toBe(0);
  });

  it("keeps every table as HTML when asked to", () => {
    const { markdown, docFacts } = htmlToMarkdown(
      "<table><tr><td><p>a</p></td></tr></table>",
      { tableMode: "html" },
    );
    expect(markdown.startsWith("<table>")).toBe(true);
    expect(docFacts.htmlTables).toBe(1);
  });

  it("escapes a pipe inside a cell and joins a two-paragraph cell with <br>", () => {
    const { markdown, docFacts } = htmlToMarkdown(
      "<table><tr><td><p>a|b</p></td><td><p>one</p><p>two</p></td></tr></table>",
    );
    expect(markdown).toContain("| a\\|b | one<br>two |");
    expect(docFacts.multilineCells).toBe(1);
  });

  it("turns mammoth's footnote anchors into GFM footnotes", () => {
    const { markdown, docFacts } = htmlToMarkdown(
      '<p>Text.<sup><a href="#footnote-1" id="footnote-ref-1">[1]</a></sup></p>' +
        '<ol><li id="footnote-1"><p>The note. <a href="#footnote-ref-1">↑</a></p></li></ol>',
    );
    expect(markdown).toContain("Text.[^1]");
    expect(markdown).toContain("[^1]: The note.");
    // The back-link is a navigation artefact of mammoth's HTML; in a .md file
    // it is a link to an anchor that does not exist.
    expect(markdown).not.toContain("↑");
    expect(docFacts.footnotes).toBe(1);
  });

  it("numbers an endnote from the marker mammoth printed, not from its id", () => {
    const { markdown, docFacts } = htmlToMarkdown(
      '<p>A.<sup><a href="#footnote-1" id="footnote-ref-1">[1]</a></sup>' +
        '<sup><a href="#endnote-1" id="endnote-ref-1">[2]</a></sup></p>' +
        '<ol><li id="footnote-1"><p>Foot.</p></li><li id="endnote-1"><p>End.</p></li></ol>',
    );
    expect(markdown).toContain("A.[^1][^2]");
    expect(markdown).toContain("[^2]: End.");
    expect(docFacts.footnotes).toBe(1);
    expect(docFacts.endnotes).toBe(1);
  });

  it("keeps strikethrough, superscript and subscript, which plain turndown erases", () => {
    const { markdown, docFacts } = htmlToMarkdown("<p><s>gone</s> H<sub>2</sub>O x<sup>2</sup></p>");
    expect(markdown).toContain("~~gone~~");
    expect(markdown).toContain("H<sub>2</sub>O");
    expect(markdown).toContain("x<sup>2</sup>");
    expect(docFacts.strikethroughRuns).toBe(1);
    expect(docFacts.superscriptRuns).toBe(1);
    expect(docFacts.subscriptRuns).toBe(1);
  });

  it("uses the html-to-markdown page's options: ATX headings and fenced code", () => {
    const { markdown } = htmlToMarkdown("<h2>Title</h2><pre><code>x = 1</code></pre>");
    expect(markdown).toContain("## Title");
    expect(markdown).toContain("```");
  });

  it("returns an empty string for an empty body rather than whitespace", () => {
    const { markdown, words } = htmlToMarkdown("");
    expect(markdown).toBe("");
    expect(words).toBe(0);
  });

  it("counts headings, links, list items and images off the HTML", () => {
    const { docFacts } = htmlToMarkdown(
      '<h1>A</h1><h2>B</h2><p><a href="https://example.com">x</a></p>' +
        '<ul><li>one</li><li>two</li></ul><p><img src="media/image-1.png" alt="" /></p>',
    );
    expect(docFacts.headings).toBe(2);
    expect(docFacts.links).toBe(1);
    expect(docFacts.listItems).toBe(2);
    expect(docFacts.images).toBe(1);
  });
});

describe("countWords", () => {
  it("counts whitespace-separated runs and calls an empty string zero", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n ")).toBe(0);
    expect(countWords("one two  three\nfour")).toBe(4);
  });

  it("does not glue the last word of a block to the first of the next", () => {
    // `body.textContent` gives "Quarterly ReportPlain text" — 3 words, one of
    // them invented. The block-boundary break is what makes the readout real.
    expect(htmlToMarkdown("<h1>Quarterly Report</h1><p>Plain text</p>").words).toBe(4);
    expect(htmlToMarkdown("<ul><li>one</li><li>two</li></ul>").words).toBe(2);
  });

  it("does not split a word that a run boundary falls inside", () => {
    expect(htmlToMarkdown("<p>Micro<strong>soft</strong> Word</p>").words).toBe(2);
  });
});

describe("markdownFileName / markdownZipName / imageExtension", () => {
  it("swaps the extension and falls back on a nameless file", () => {
    expect(markdownFileName("Quarterly Report.docx")).toBe("Quarterly Report.md");
    expect(markdownFileName("notes.v2.docx")).toBe("notes.v2.md");
    expect(markdownFileName(".docx")).toBe("document.md");
    expect(markdownZipName("Quarterly Report.docx")).toBe("Quarterly Report-markdown.zip");
  });

  it("maps Word's image content types onto file extensions", () => {
    expect(imageExtension("image/png")).toBe("png");
    expect(imageExtension("image/jpeg")).toBe("jpg");
    expect(imageExtension("image/x-emf")).toBe("emf");
    expect(imageExtension("image/jpeg; charset=binary")).toBe("jpg");
    expect(imageExtension(null)).toBe("bin");
    expect(imageExtension("application/octet-stream")).toBe("bin");
  });
});

/* ── The package scan ───────────────────────────────────────────────────── */

describe("readDocxPackageFacts", () => {
  it("counts the parts mammoth never opens", async () => {
    const buffer = await docx({
      body: para(run("Body text.")),
      extra: {
        "word/header1.xml": "<w:hdr/>",
        "word/header2.xml": "<w:hdr/>",
        "word/footer1.xml": "<w:ftr/>",
        "word/comments.xml":
          `<w:comments ${W_NS}><w:comment w:id="0"><w:p/></w:comment><w:comment w:id="1"><w:p/></w:comment></w:comments>`,
        "word/embeddings/oleObject1.bin": "x",
        "word/charts/chart1.xml": "<c/>",
        "word/vbaProject.bin": "x",
        "word/media/image1.png": pngBytes(),
      },
    });
    const facts = await readDocxPackageFacts(buffer);
    expect(facts.headers).toBe(2);
    expect(facts.footers).toBe(1);
    expect(facts.comments).toBe(2);
    expect(facts.embeddedObjects).toBe(1);
    expect(facts.charts).toBe(1);
    expect(facts.macros).toBe(true);
    expect(facts.mediaFiles).toBe(1);
    expect(facts.mediaBytes).toBe(70);
  });

  it("counts tracked changes, unmapped run properties, text boxes and fields", async () => {
    const buffer = await docx({
      body:
        `<w:p><w:ins w:id="1"><w:r><w:t>added</w:t></w:r></w:ins>` +
        `<w:del w:id="2"><w:r><w:delText>removed</w:delText></w:r></w:del></w:p>` +
        para(run("u", '<w:u w:val="single"/>')) +
        para(run("plain", '<w:u w:val="none"/>')) +
        para(run("h", '<w:highlight w:val="yellow"/>')) +
        para(run("c", '<w:color w:val="FF0000"/>')) +
        para(run("d", '<w:color w:val="auto"/>')) +
        `<w:p><w:r><w:pict><w:txbxContent>${para(run("boxed"))}</w:txbxContent></w:pict></w:r></w:p>` +
        `<w:p><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>` +
        `<w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" </w:instrText></w:r></w:p>`,
    });
    const facts = await readDocxPackageFacts(buffer);
    expect(facts.insertions).toBe(1);
    expect(facts.deletions).toBe(1);
    // `w:val="none"` is Word's way of switching underline OFF: counting it
    // would report an underline the document does not have.
    expect(facts.underlinedRuns).toBe(1);
    expect(facts.highlightedRuns).toBe(1);
    // Same for `w:val="auto"`, which means "whatever the theme says".
    expect(facts.colouredRuns).toBe(1);
    expect(facts.textBoxes).toBe(1);
    expect(facts.fieldRuns).toBe(2);
    expect(facts.fields).toEqual(["PAGE", "TOC"]);
  });

  it("reads single-quoted attributes and a bare <w:u/>, which both mean underline", async () => {
    const buffer = await docx({
      body:
        para(run("a", "<w:u w:val='single'/>")) +
        para(run("b", "<w:u/>")) +
        para(run("c", "<w:u w:val='none'/>")) +
        para(run("d", "<w:color w:val='FF0000'/>")),
    });
    const facts = await readDocxPackageFacts(buffer);
    expect(facts.underlinedRuns).toBe(2);
    expect(facts.colouredRuns).toBe(1);
  });

  it("counts a text box once, not twice, when Word wrote both AlternateContent branches", async () => {
    const inner = `<w:txbxContent>${para(run("boxed"))}</w:txbxContent>`;
    const buffer = await docx({
      body:
        "<w:p><w:r><mc:AlternateContent>" +
        `<mc:Choice Requires="wps"><w:drawing>${inner}</w:drawing></mc:Choice>` +
        `<mc:Fallback><w:pict>${inner}</w:pict></mc:Fallback>` +
        "</mc:AlternateContent></w:r></w:p>",
    });
    expect((await readDocxPackageFacts(buffer)).textBoxes).toBe(1);
  });

  it("does not read <w:delText> or <w:insideH> as revision marks", async () => {
    const buffer = await docx({
      body:
        `<w:tbl><w:tblPr><w:tblBorders><w:insideH w:val="single"/></w:tblBorders></w:tblPr>` +
        `<w:tr>${cell("x")}</w:tr></w:tbl>` +
        `<w:p><w:del w:id="1"><w:r><w:delText>gone</w:delText></w:r>` +
        `<w:r><w:delText>also gone</w:delText></w:r></w:del></w:p>`,
    });
    const facts = await readDocxPackageFacts(buffer);
    expect(facts.insertions).toBe(0);
    expect(facts.deletions).toBe(1);
  });

  it("reports zero for a document that carries none of it", async () => {
    const facts = await readDocxPackageFacts(await docx({ body: para(run("Just text.")) }));
    expect(facts.headers).toBe(0);
    expect(facts.comments).toBe(0);
    expect(facts.deletions).toBe(0);
    expect(facts.macros).toBe(false);
    expect(facts.fields).toEqual([]);
  });

  it("names an old .doc by its OLE header rather than blaming the ZIP", async () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    await expect(readDocxPackageFacts(ole.buffer)).rejects.toBeInstanceOf(DocxReadError);
    await expect(readDocxPackageFacts(ole.buffer)).rejects.toThrow(/OLE compound document/);
    await expect(readDocxPackageFacts(ole.buffer)).rejects.toThrow(/password/);
  });

  it("names RTF under a .docx extension", async () => {
    const rtf = new TextEncoder().encode("{\\rtf1\\ansi hello}");
    await expect(readDocxPackageFacts(rtf.buffer as ArrayBuffer)).rejects.toThrow(/RTF/);
  });

  it("says a file is not a ZIP without quoting jszip's documentation URL", async () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    await expect(readDocxPackageFacts(junk.buffer)).rejects.toThrow(/not a ZIP/);
    await expect(readDocxPackageFacts(junk.buffer)).rejects.not.toThrow(/https?:/);
  });

  it("distinguishes a ZIP that is simply not a Word document", async () => {
    const zip = new JSZip();
    zip.file("hello.txt", "hi");
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    await expect(readDocxPackageFacts(buffer)).rejects.toThrow(/word\/document\.xml/);
  });
});

/* ── End to end, over a real package ────────────────────────────────────── */

describe("convertDocxToMarkdown", () => {
  it("converts headings, emphasis, links and lists", async () => {
    const buffer = await docx({
      body:
        para(run("Quarterly Report"), '<w:pStyle w:val="Heading1"/>') +
        para(run("Plain ") + run("bold", "<w:b/>") + run(" and ") + run("italic", "<w:i/>")) +
        '<w:p><w:hyperlink r:id="rIdLink"><w:r><w:t>docs</w:t></w:r></w:hyperlink></w:p>',
      rels:
        '<Relationship Id="rIdLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/docs" TargetMode="External"/>',
    });
    const out = await convertDocxToMarkdown(buffer);
    expect(out.markdown).toContain("# Quarterly Report");
    expect(out.markdown).toContain("Plain **bold** and _italic_");
    expect(out.markdown).toContain("[docs](https://example.com/docs)");
    expect(out.docFacts.headings).toBe(1);
    expect(out.docFacts.links).toBe(1);
    expect(out.words).toBe(7);
  });

  it("surfaces mammoth's own message for a style it does not recognise", async () => {
    const buffer = await docx({
      body: para(run("Quoted."), '<w:pStyle w:val="PullQuote"/>'),
      extra: {
        "word/styles.xml":
          `<w:styles ${W_NS}><w:style w:type="paragraph" w:styleId="PullQuote"><w:name w:val="Pull Quote"/></w:style></w:styles>`,
      },
    });
    const out = await convertDocxToMarkdown(buffer);
    expect(out.messages.map((m) => m.message).join(" ")).toContain("Pull Quote");
    expect(out.messages[0].type).toBe("warning");
    // The words survive even though the style does not.
    expect(out.markdown).toBe("Quoted.");
  });

  it("references images into a media folder and hands back their bytes", async () => {
    const buffer = await docx({
      body: `<w:p>${drawing("A red square")}${drawing("A red square")}</w:p>`,
      rels: IMAGE_REL,
      extra: { "word/media/image1.png": pngBytes() },
    });
    const out = await convertDocxToMarkdown(buffer, { imageMode: "reference" });
    expect(out.markdown).toContain("![A red square](media/image-1.png)");
    expect(out.markdown).toContain("![A red square](media/image-2.png)");
    expect(out.images).toHaveLength(2);
    expect(out.images[0].name).toBe("media/image-1.png");
    expect(out.images[0].bytes.length).toBe(70);
    expect(out.images[0].contentType).toBe("image/png");
    expect(out.docFacts.images).toBe(2);
  });

  it("embeds images as data URIs when asked, and still knows how big they were", async () => {
    const buffer = await docx({
      body: `<w:p>${drawing("A red square")}</w:p>`,
      rels: IMAGE_REL,
      extra: { "word/media/image1.png": pngBytes() },
    });
    const out = await convertDocxToMarkdown(buffer, { imageMode: "embed" });
    expect(out.markdown).toContain("data:image/png;base64,");
    expect(out.docFacts.images).toBe(1);
    // The bytes are still measured in embed mode — that is what lets the page
    // say how much of the .md file is picture rather than prose.
    expect(out.images).toHaveLength(1);
    expect(out.images[0].bytes.length).toBe(70);
  });

  it("reads no image bytes in drop mode, where they are about to be discarded", async () => {
    const buffer = await docx({
      body: `<w:p>${drawing("A red square")}</w:p>`,
      rels: IMAGE_REL,
      extra: { "word/media/image1.png": pngBytes() },
    });
    const out = await convertDocxToMarkdown(buffer, { imageMode: "drop" });
    expect(out.images).toHaveLength(0);
    expect(out.docFacts.images).toBe(1);
  });

  it("drops images and still reports how many there were", async () => {
    const buffer = await docx({
      body: `<w:p>${drawing("A red square")}<w:r><w:t>caption</w:t></w:r>${drawing("A red square")}</w:p>`,
      rels: IMAGE_REL,
      extra: { "word/media/image1.png": pngBytes() },
    });
    const out = await convertDocxToMarkdown(buffer, { imageMode: "drop" });
    expect(out.markdown).not.toContain("![");
    expect(out.markdown).toContain("caption");
    expect(out.images).toHaveLength(0);
    // The count is what makes the disclosure honest: nothing on screen would
    // otherwise say two pictures had been in the document at all.
    expect(out.docFacts.images).toBe(2);
  });

  it("does not count a linked picture it could not read as one it placed", async () => {
    const buffer = await docx({
      body: para(run("Chapter one.")) + `<w:p>${linkedDrawing}</w:p>`,
      rels: LINKED_IMAGE_REL,
    });
    const out = await convertDocxToMarkdown(buffer, { imageMode: "reference" });
    // Nothing was written, so nothing may be counted as written: `images` and
    // `docFacts.images` are what the ZIP sentence and the download both read.
    expect(out.markdown).toBe("Chapter one.");
    expect(out.markdown).not.toContain("media/");
    expect(out.images).toHaveLength(0);
    expect(out.docFacts.images).toBe(0);
    // …and the picture is not silently forgotten either.
    expect(out.docFacts.unreadableImages).toBe(1);
    expect(out.messages[0].type).toBe("error");
    expect(out.messages[0].message).toContain("could not open external image");
  });

  it("still counts the readable pictures alongside one it could not read", async () => {
    const buffer = await docx({
      body: `<w:p>${drawing("A red square")}${linkedDrawing}</w:p>`,
      rels: IMAGE_REL + LINKED_IMAGE_REL,
      extra: { "word/media/image1.png": pngBytes() },
    });
    const out = await convertDocxToMarkdown(buffer, { imageMode: "reference" });
    expect(out.images).toHaveLength(1);
    expect(out.docFacts.images).toBe(1);
    expect(out.docFacts.unreadableImages).toBe(1);
    // The one that worked keeps the first slot; the failure does not burn a
    // file name, so the links and the ZIP entries still line up.
    expect(out.markdown).toContain("media/image-1.png");
    expect(out.markdown).not.toContain("media/image-2.png");
  });

  it("counts every picture in drop mode, where nothing is read and nothing can fail", async () => {
    const buffer = await docx({
      body: para(run("Chapter one.")) + `<w:p>${linkedDrawing}</w:p>`,
      rels: LINKED_IMAGE_REL,
    });
    const out = await convertDocxToMarkdown(buffer, { imageMode: "drop" });
    expect(out.docFacts.images).toBe(1);
    expect(out.docFacts.unreadableImages).toBe(0);
    expect(out.markdown).toBe("Chapter one.");
  });

  it("keeps a tracked insertion and loses a tracked deletion, and counts both", async () => {
    const buffer = await docx({
      body:
        `<w:p><w:r><w:t xml:space="preserve">Kept </w:t></w:r>` +
        `<w:ins w:id="1"><w:r><w:t xml:space="preserve">ADDED </w:t></w:r></w:ins>` +
        `<w:del w:id="2"><w:r><w:delText xml:space="preserve">REMOVED </w:delText></w:r></w:del>` +
        `<w:r><w:t>tail.</w:t></w:r></w:p>`,
    });
    const out = await convertDocxToMarkdown(buffer);
    expect(out.markdown).toBe("Kept ADDED tail.");
    expect(out.markdown).not.toContain("REMOVED");
    expect(out.packageFacts.insertions).toBe(1);
    expect(out.packageFacts.deletions).toBe(1);
  });

  it("leaves header and footer text out of the Markdown and says they were there", async () => {
    const buffer = await docx({
      body: para(run("Body only.")),
      extra: {
        "word/header1.xml": `<w:hdr ${W_NS}>${para(run("RUNNING HEADER"))}</w:hdr>`,
        "word/footer1.xml": `<w:ftr ${W_NS}>${para(run("PAGE FOOTER"))}</w:ftr>`,
      },
    });
    const out = await convertDocxToMarkdown(buffer);
    expect(out.markdown).toBe("Body only.");
    expect(out.packageFacts.headers).toBe(1);
    expect(out.packageFacts.footers).toBe(1);
  });

  it("leaves a comment out of the Markdown and counts it", async () => {
    const buffer = await docx({
      body:
        `<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Reviewed sentence.</w:t></w:r>` +
        `<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>`,
      extra: {
        "word/comments.xml": `<w:comments ${W_NS}><w:comment w:id="0" w:author="R">${para(run("Is this right?"))}</w:comment></w:comments>`,
      },
    });
    const out = await convertDocxToMarkdown(buffer);
    expect(out.markdown).toBe("Reviewed sentence.");
    expect(out.markdown).not.toContain("Is this right?");
    expect(out.packageFacts.comments).toBe(1);
  });

  it("drops underline, because mammoth's default style map has no output for it", async () => {
    const buffer = await docx({ body: para(run("underlined", '<w:u w:val="single"/>')) });
    const out = await convertDocxToMarkdown(buffer);
    expect(out.markdown).toBe("underlined");
    expect(out.packageFacts.underlinedRuns).toBe(1);
  });

  it("carries a Word table through as a pipe table", async () => {
    const buffer = await docx({
      body:
        `<w:tbl><w:tr>${cell("Region")}${cell("Q1")}</w:tr>` +
        `<w:tr>${cell("North")}${cell("120")}</w:tr></w:tbl>`,
    });
    const out = await convertDocxToMarkdown(buffer);
    expect(out.markdown).toBe("| Region | Q1 |\n| --- | --- |\n| North | 120 |");
    expect(out.docFacts.tables).toBe(1);
  });

  it("counts a horizontal merge Word wrote as a gridSpan", async () => {
    const buffer = await docx({
      body:
        `<w:tbl><w:tr>${cell("Both", '<w:gridSpan w:val="2"/>')}${cell("C")}</w:tr>` +
        `<w:tr>${cell("a")}${cell("b")}${cell("c")}</w:tr></w:tbl>`,
    });
    const out = await convertDocxToMarkdown(buffer);
    expect(out.docFacts.colspanCells).toBe(1);
    expect(out.markdown).toContain("| Both | | C |");
  });

  it("returns empty Markdown for a document with an empty body", async () => {
    const out = await convertDocxToMarkdown(await docx({ body: "" }));
    expect(out.markdown).toBe("");
    expect(out.words).toBe(0);
    expect(out.messages).toEqual([]);
  });

  it("refuses an .xlsx renamed to .docx with a message naming the missing part", async () => {
    const zip = new JSZip();
    zip.file("xl/workbook.xml", "<workbook/>");
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    await expect(convertDocxToMarkdown(buffer)).rejects.toBeInstanceOf(DocxReadError);
    await expect(convertDocxToMarkdown(buffer)).rejects.toThrow(/word\/document\.xml/);
  });
});

/* ── The page itself ────────────────────────────────────────────────────── */

/*
  `DocxToMarkdownUI` is a .tsx component and this is a .ts file, so the element
  is built with `createElement` rather than JSX. That is the whole difference:
  the component mounts, takes a real .docx through the real reader, and is
  asserted on the DOM it actually renders.
*/
describe("DocxToMarkdownUI", () => {
  it("mounts with a drop zone and no controls that cannot act yet", async () => {
    const { DocxToMarkdownUI } = await import("@/components/tools/DocxToMarkdownUI");
    render(createElement(DocxToMarkdownUI));
    expect(screen.getByText(/Drop a Word \.docx to begin/i)).toBeInTheDocument();
    // Nothing to download before anything has been read.
    expect(screen.queryByRole("button", { name: /^Download /i })).toBeNull();
  });

  it("converts a dropped document and reports what it lost, with counts", async () => {
    const { DocxToMarkdownUI } = await import("@/components/tools/DocxToMarkdownUI");
    const buffer = await docx({
      body:
        para(run("Report"), '<w:pStyle w:val="Heading1"/>') +
        para(run("Body text here.")) +
        `<w:p><w:del w:id="1"><w:r><w:delText>cut</w:delText></w:r></w:del></w:p>`,
      extra: { "word/header1.xml": "<w:hdr/>" },
    });
    const file = new File([buffer], "Report.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    const { container } = render(createElement(DocxToMarkdownUI));
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    await act(async () => {
      fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });
    });

    await waitFor(() =>
      expect(screen.getByLabelText("Markdown output").textContent).toContain("# Report"),
    );
    expect(screen.getByRole("button", { name: /^Download Report\.md$/ })).toBeInTheDocument();

    // The derived disclosure, with the numbers taken off this document.
    // `WarningMessage` is role="status" — it informs, it does not alert.
    const said = screen
      .getAllByRole("status")
      .map((el) => el.textContent ?? "")
      .join(" ");
    expect(said).toContain("1 page header");
    expect(said).toContain("0 insertions and 1 deletion");
  });

  it("says nothing about losses a document did not have", async () => {
    const { DocxToMarkdownUI } = await import("@/components/tools/DocxToMarkdownUI");
    const buffer = await docx({ body: para(run("Only prose here.")) });
    const file = new File([buffer], "plain.docx");
    const { container } = render(createElement(DocxToMarkdownUI));
    await act(async () => {
      fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
        target: { files: [file] },
      });
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Markdown output").textContent).toBe("Only prose here."),
    );
    // No warnings at all: a list of zeroes is reassurance, not disclosure.
    expect(screen.queryAllByRole("status")).toEqual([]);
    expect(screen.queryAllByRole("alert")).toEqual([]);
  });

  it("shows the reader's own message for an unrecognised Word style", async () => {
    const { DocxToMarkdownUI } = await import("@/components/tools/DocxToMarkdownUI");
    const buffer = await docx({
      body: para(run("Callout text."), '<w:pStyle w:val="Callout"/>'),
      extra: {
        "word/styles.xml": `<w:styles ${W_NS}><w:style w:type="paragraph" w:styleId="Callout"><w:name w:val="Callout"/></w:style></w:styles>`,
      },
    });
    const { container } = render(createElement(DocxToMarkdownUI));
    await act(async () => {
      fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
        target: { files: [new File([buffer], "styled.docx")] },
      });
    });
    await waitFor(() =>
      expect(screen.getAllByRole("status").map((e) => e.textContent).join(" ")).toContain(
        "Unrecognised paragraph style: 'Callout'",
      ),
    );
  });

  it("promises no media folder and no ZIP for a picture it could not read", async () => {
    const { DocxToMarkdownUI } = await import("@/components/tools/DocxToMarkdownUI");
    const buffer = await docx({
      body: para(run("Chapter one.")) + `<w:p>${linkedDrawing}</w:p>`,
      rels: LINKED_IMAGE_REL,
    });
    const { container } = render(createElement(DocxToMarkdownUI));
    await act(async () => {
      fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
        target: { files: [new File([buffer], "linked.docx")] },
      });
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Markdown output").textContent).toBe("Chapter one."),
    );

    // One .md and nothing else, so the footer offers the plain download rather
    // than a ZIP of a media folder that was never written.
    expect(screen.getByRole("button", { name: /^Download linked\.md$/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ZIP/i })).toBeNull();

    const said = screen.getAllByRole("status").map((el) => el.textContent ?? "").join(" ");
    expect(said).not.toContain("media folder");
    expect(said).not.toContain("the download is a ZIP");
    // …and the picture is not passed over in silence either.
    expect(said).toContain("could not be read out of the package");

    // Mammoth typed this one an error, so it belongs in the alert rather than
    // under the reassuring sentence about unrecognised styles.
    const alerted = screen.getAllByRole("alert").map((el) => el.textContent ?? "").join(" ");
    expect(alerted).toContain("could not open external image");
    expect(said).not.toContain("could not open external image");
  });

  it("clears the previous run's result while re-converting under new settings", async () => {
    const { DocxToMarkdownUI } = await import("@/components/tools/DocxToMarkdownUI");
    const buffer = await docx({
      body: `<w:p>${drawing("A red square")}</w:p>` + para(run("Caption.")),
      rels: IMAGE_REL,
      extra: { "word/media/image1.png": pngBytes() },
    });
    const { container } = render(createElement(DocxToMarkdownUI));
    await act(async () => {
      fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
        target: { files: [new File([buffer], "photos.docx")] },
      });
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Download Markdown \+ 1 image \(ZIP\)/ })).
        toBeInTheDocument(),
    );

    // IMAGES → Drop re-runs the whole conversion. Nothing from the finished
    // Link run may survive that window: its Markdown still carries media/
    // links, and describing or downloading it under the new setting hands out
    // a .md pointing at files no download contains.
    fireEvent.click(screen.getByRole("button", { name: "Drop" }));
    expect(screen.queryByRole("button", { name: /ZIP/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
    expect(
      screen.queryAllByRole("status").map((el) => el.textContent ?? "").join(" "),
    ).not.toContain("media folder");
    expect(screen.getByLabelText("Markdown output").textContent).toBe("Unpacking the document…");

    await waitFor(() =>
      expect(screen.getAllByRole("status").map((el) => el.textContent ?? "").join(" ")).toContain(
        "1 image was removed",
      ),
    );
    expect(screen.getByLabelText("Markdown output").textContent).toBe("Caption.");
  });

  it("refuses an old .doc with the OLE sentence and offers nothing to download", async () => {
    const { DocxToMarkdownUI } = await import("@/components/tools/DocxToMarkdownUI");
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    const { container } = render(createElement(DocxToMarkdownUI));
    await act(async () => {
      fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
        target: { files: [new File([ole], "old.docx")] },
      });
    });
    await waitFor(() =>
      expect(screen.getAllByRole("alert").map((e) => e.textContent).join(" ")).toContain(
        "OLE compound document",
      ),
    );
    expect(screen.queryByRole("button", { name: /^Download /i })).toBeNull();
  });
});
