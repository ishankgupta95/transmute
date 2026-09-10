import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import JSZip from "jszip";
import {
  columnIndexFromRef,
  csvEscape,
  csvFileName,
  csvFileNames,
  csvZipName,
  CSV_DELIMITERS,
  CSV_EOL,
  EXAMPLE_DATE_SERIAL,
  excelSerialToIsoDate,
  isDateFormatCode,
  readDateStyleFlags,
  readXlsx,
  rowIndexFromRef,
  rowsToCsv,
  sniffContainer,
  XlsxReadError,
} from "@/lib/tools/xlsx";
import { XlsxToCsvUI } from "@/components/tools/XlsxToCsvUI";

/*
  These tests build REAL .xlsx packages in memory — the same ZIP-of-XML Excel
  writes — and run them back through the reader. That matters more here than in
  most of this suite: an .xlsx reader is nothing but a pile of format traps
  (sparse cells, sparse rows, multi-run shared strings, five cell types, dates
  that are only dates because a style says so), and a test that stubs the XML
  away tests nothing but the stub.

  The XML below is written by hand rather than generated, so the sparseness is
  deliberate and visible: sheet 1 has no B1, no rows 4 or 5, and sheet 2 has a
  cell at AB1 with twenty-six empty columns in front of it.
*/

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG_REL_NS}">
  <Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">
  <sheets>
    <sheet name="Data" sheetId="1" r:id="rId1"/>
    <sheet name="Q1 Notes" sheetId="2" state="hidden" r:id="rId2"/>
  </sheets>
</workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG_REL_NS}">
  <Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="${REL_NS}/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="${REL_NS}/sharedStrings" Target="sharedStrings.xml"/>
  <Relationship Id="rId4" Type="${REL_NS}/styles" Target="styles.xml"/>
</Relationships>`;

/*
  Index 1 keeps a trailing space that only survives `xml:space="preserve"`.
  Index 2 is TWO runs, which is what Excel writes when one word in a cell is
  bold — a reader that takes the first <t> truncates it to "Hello ".
  Index 5 carries an <rPh> phonetic guide, whose <t> is NOT part of the value.
*/
const SHARED_STRINGS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="${MAIN_NS}" count="6" uniqueCount="6">
<si><t>Name</t></si>
<si><t xml:space="preserve">Hello </t></si>
<si><r><t xml:space="preserve">Hello </t></r><r><t>World</t></r></si>
<si><t>Say "hi", now</t></si>
<si><t>Line1
Line2</t></si>
<si><t>furigana</t><rPh sb="0" eb="3"><t>PHONETIC</t></rPh></si>
</sst>`;

/*
  Style 0 general · 1 built-in date (numFmtId 14) · 2 custom date · 3 a custom
  format that merely CONTAINS the letters "months" inside a quoted literal, and
  is not a date. That last one is the whole reason `isDateFormatCode` strips
  quoted sections before it looks for y/m/d/h/s.
*/
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${MAIN_NS}">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/>
    <numFmt numFmtId="165" formatCode="0.00&quot; months&quot;"/>
  </numFmts>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
    <xf numFmtId="14" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>
  </cellXfs>
</styleSheet>`;

/* B1 is missing; rows 4 and 5 are missing. Both gaps must be padded. */
const SHEET1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${MAIN_NS}">
  <dimension ref="A1:C7"/>
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>Inline</t></is></c></row>
    <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>42</v></c><c r="C2" t="b"><v>1</v></c></row>
    <row r="3"><c r="A3" t="b"><v>0</v></c><c r="B3" t="str"><f>CONCATENATE("a","b")</f><v>ab</v></c><c r="C3" t="e"><v>#DIV/0!</v></c></row>
    <row r="6"><c r="A6" s="1"><v>45678</v></c><c r="B6" s="2"><v>45679</v></c><c r="C6" s="3"><v>3.5</v></c></row>
    <row r="7"><c r="A7" t="s"><v>3</v></c><c r="B7" t="s"><v>1</v></c><c r="C7" t="s"><v>4</v></c></row>
  </sheetData>
</worksheet>`;

/* One row, one cell at A1 and one at AB1 — column 27, zero-based. */
const SHEET2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${MAIN_NS}">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>5</v></c><c r="AB1" t="s"><v>0</v></c></row>
  </sheetData>
</worksheet>`;

const FULL_PACKAGE: Record<string, string> = {
  "_rels/.rels": ROOT_RELS,
  "xl/workbook.xml": WORKBOOK,
  "xl/_rels/workbook.xml.rels": WORKBOOK_RELS,
  "xl/sharedStrings.xml": SHARED_STRINGS,
  "xl/styles.xml": STYLES,
  "xl/worksheets/sheet1.xml": SHEET1,
  "xl/worksheets/sheet2.xml": SHEET2,
};

async function buildZip(parts: Record<string, string>): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const [path, body] of Object.entries(parts)) zip.file(path, body);
  return zip.generateAsync({ type: "arraybuffer" });
}

const bufferOf = (bytes: number[]): ArrayBuffer => new Uint8Array(bytes).buffer;

/* ── References ───────────────────────────────────────────────────────────── */

describe("cell references", () => {
  it.each([
    ["A1", 0],
    ["B1", 1],
    ["Z9", 25],
    ["AA1", 26],
    ["AB1", 27],
    ["AZ1", 51],
    ["BA1", 52],
    ["ZZ1", 701],
    ["AAA1", 702],
  ])("decodes the column of %s", (ref, expected) => {
    expect(columnIndexFromRef(ref)).toBe(expected);
  });

  it("reports -1 when a reference carries no column letters", () => {
    expect(columnIndexFromRef("12")).toBe(-1);
    expect(columnIndexFromRef("")).toBe(-1);
  });

  it("decodes the row number", () => {
    expect(rowIndexFromRef("A1")).toBe(1);
    expect(rowIndexFromRef("AB1048576")).toBe(1048576);
    expect(rowIndexFromRef("AB")).toBe(0);
  });
});

/* ── Container sniffing ───────────────────────────────────────────────────── */

describe("sniffContainer", () => {
  it("recognises a ZIP local header", () => {
    expect(sniffContainer(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]))).toBe("zip");
  });

  it("recognises an empty ZIP", () => {
    expect(sniffContainer(new Uint8Array([0x50, 0x4b, 0x05, 0x06]))).toBe("zip");
  });

  it("recognises an OLE2 compound file", () => {
    expect(
      sniffContainer(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
    ).toBe("ole2");
  });

  it("calls anything else unknown", () => {
    expect(sniffContainer(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBe("unknown");
    expect(sniffContainer(new Uint8Array([]))).toBe("unknown");
  });
});

/* ── Number formats ───────────────────────────────────────────────────────── */

describe("isDateFormatCode", () => {
  it.each(["yyyy-mm-dd", "d mmm yyyy", "h:mm:ss", "[$-409]m/d/yy h:mm AM/PM", "[h]:mm:ss"])(
    "reads %s as a date or time",
    (code) => {
      expect(isDateFormatCode(code)).toBe(true);
    },
  );

  it.each([
    ["General", "the default"],
    ['0.00" months"', "letters hidden inside a quoted literal"],
    ["#,##0.00", "a plain number"],
    ["0.00%", "a percentage"],
    ["[Red]\\-#,##0.00", "a colour section and an escaped minus"],
    ["0.00E+00", "scientific notation"],
    ["@", "text"],
  ])("does not read %s as a date (%s)", (code) => {
    expect(isDateFormatCode(code)).toBe(false);
  });
});

/*
  A BUILT-IN format writes no <numFmt> into the file at all — the id alone
  implies the code (ECMA-376 §18.8.30) — so the id table in xlsx.ts IS the
  whole format language below 164, and anything missing from it is a date the
  reader cannot see. `numberedStyles` builds a styles part whose xf at index i
  carries ids[i], so the flag array comes back positionally.
*/
const numberedStyles = (ids: readonly number[]): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${MAIN_NS}"><cellXfs count="${ids.length}">${ids
    .map(
      (id) =>
        `<xf numFmtId="${id}" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>`,
    )
    .join("")}</cellXfs></styleSheet>`;

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("built-in date number format ids", () => {
  // 14–22 every locale gets; 27–36 and 50–58 are the CJK-locale date/time
  // block (30 is plainly `m/d/yy`, 32 is `h"時"mm"分"`); 45–47 elapsed time.
  const DATE_IDS = [...range(14, 22), ...range(27, 36), ...range(45, 47), ...range(50, 58)];
  // 0–13 numbers, currencies and fractions; 23–26 and 41–44 reserved and
  // accounting; 37–40 accounting; 48 scientific; 49 text.
  const NOT_DATE_IDS = [...range(0, 13), ...range(23, 26), ...range(37, 44), 48, 49];

  it("marks every built-in date and time id as a date", () => {
    expect(readDateStyleFlags(numberedStyles(DATE_IDS))).toEqual(DATE_IDS.map(() => true));
  });

  it("leaves the number, currency, accounting and text ids alone", () => {
    expect(readDateStyleFlags(numberedStyles(NOT_DATE_IDS))).toEqual(
      NOT_DATE_IDS.map(() => false),
    );
  });
});

/* ── Date serials ─────────────────────────────────────────────────────────── */

describe("excelSerialToIsoDate", () => {
  it("converts a serial in the default 1900 date system", () => {
    expect(excelSerialToIsoDate(45678)).toBe("2025-01-21");
    expect(excelSerialToIsoDate(45672)).toBe("2025-01-15");
    expect(excelSerialToIsoDate(45292)).toBe("2024-01-01");
  });

  it("keeps Excel's fictional 1900 leap day out of the answer", () => {
    // Serials 1–59 count from 1899-12-31; serial 60 is 1900-02-29, a day that
    // never existed; only from 61 does the familiar 1899-12-30 epoch line up.
    expect(excelSerialToIsoDate(1)).toBe("1900-01-01");
    expect(excelSerialToIsoDate(59)).toBe("1900-02-28");
    expect(excelSerialToIsoDate(60)).toBeNull();
    expect(excelSerialToIsoDate(61)).toBe("1900-03-01");
  });

  it("counts from 1904-01-01 in the 1904 date system", () => {
    expect(excelSerialToIsoDate(0, true)).toBe("1904-01-01");
    expect(excelSerialToIsoDate(45678, true)).toBe("2029-01-22");
    // The two systems are 1462 days apart, which is the whole reason a
    // workbook-wide flag decides which one a serial is read against.
    expect(excelSerialToIsoDate(45678 - 1462, true)).toBe(excelSerialToIsoDate(45678));
  });

  it("drops the time-of-day fraction rather than rounding it", () => {
    expect(excelSerialToIsoDate(45678.99)).toBe("2025-01-21");
  });

  it("returns null for what Excel cannot show as a date", () => {
    expect(excelSerialToIsoDate(0)).toBeNull();
    expect(excelSerialToIsoDate(-1)).toBeNull();
    expect(excelSerialToIsoDate(Number.NaN)).toBeNull();
    expect(excelSerialToIsoDate(Number.POSITIVE_INFINITY)).toBeNull();
    expect(excelSerialToIsoDate(1e300)).toBeNull();
  });

  it("is the serial the on-screen disclosure quotes", () => {
    expect(EXAMPLE_DATE_SERIAL).toBe(45678);
    expect(excelSerialToIsoDate(EXAMPLE_DATE_SERIAL)).toBe("2025-01-21");
  });
});

/* ── CSV writing ──────────────────────────────────────────────────────────── */

describe("csvEscape", () => {
  it("leaves a plain value alone", () => {
    expect(csvEscape("plain", ",")).toBe("plain");
    expect(csvEscape("trailing space ", ",")).toBe("trailing space ");
  });

  it("quotes a value containing the delimiter", () => {
    expect(csvEscape("a,b", ",")).toBe('"a,b"');
    // ...and does not quote it when the delimiter is something else.
    expect(csvEscape("a,b", ";")).toBe("a,b");
    expect(csvEscape("a;b", ";")).toBe('"a;b"');
    expect(csvEscape("a\tb", "\t")).toBe('"a\tb"');
  });

  it("doubles internal quotes and wraps the field", () => {
    expect(csvEscape('Say "hi"', ",")).toBe('"Say ""hi"""');
  });

  it("quotes a value containing CR or LF", () => {
    expect(csvEscape("one\ntwo", ",")).toBe('"one\ntwo"');
    expect(csvEscape("one\rtwo", ",")).toBe('"one\rtwo"');
  });

  it("leaves an empty field empty rather than writing two quotes", () => {
    expect(csvEscape("", ",")).toBe("");
  });
});

describe("rowsToCsv", () => {
  it("joins rows with CRLF, as RFC 4180 specifies", () => {
    expect(rowsToCsv([["a", "b"], ["c", "d"]])).toBe(`a,b${CSV_EOL}c,d`);
  });

  it("honours the delimiter", () => {
    expect(rowsToCsv([["a", "b"]], { delimiter: ";" })).toBe("a;b");
    expect(rowsToCsv([["a", "b"]], { delimiter: "\t" })).toBe("a\tb");
  });

  it("prefixes a byte-order mark only when asked", () => {
    expect(rowsToCsv([["a"]], { bom: true })).toBe("﻿a");
    expect(rowsToCsv([["a"]], { bom: false })).toBe("a");
    expect(rowsToCsv([["a"]])).toBe("a");
  });

  it("offers three delimiters, each with a distinct character", () => {
    expect(CSV_DELIMITERS.map((d) => d.char)).toEqual([",", ";", "\t"]);
    expect(CSV_DELIMITERS.every((d) => d.note.length > 20)).toBe(true);
  });
});

describe("output names", () => {
  it("joins the workbook name and the sheet name", () => {
    expect(csvFileName("budget.xlsx", "Sheet1")).toBe("budget-Sheet1.csv");
  });

  it("folds spaces and path characters out of a sheet name", () => {
    expect(csvFileName("book.xlsx", "Q1 / Q2 Actuals")).toBe("book-Q1-Q2-Actuals.csv");
  });

  it("falls back rather than emitting a bare extension", () => {
    expect(csvFileName("", "")).toBe("workbook-sheet.csv");
    expect(csvZipName("")).toBe("workbook-csv.zip");
  });

  it("keeps every name in a batch distinct", () => {
    // Two tabs that Excel itself allows: the names differ only in characters
    // `csvFileName` folds away, so both reduce to book-Q1-Q2.csv.
    expect(csvFileNames("book.xlsx", ["Q1 / Q2", "Q1-Q2", "Q1 Q2"])).toEqual([
      "book-Q1-Q2.csv",
      "book-Q1-Q2-2.csv",
      "book-Q1-Q2-3.csv",
    ]);
  });

  it("leaves already-distinct names alone", () => {
    expect(csvFileNames("book.xlsx", ["One", "Two"])).toEqual([
      "book-One.csv",
      "book-Two.csv",
    ]);
  });

  it("names the multi-sheet ZIP after the workbook", () => {
    expect(csvZipName("2026 budget.xlsx")).toBe("2026 budget-csv.zip");
  });
});

/* ── Packages that are not the happy path ─────────────────────────────────── */

const oneSheetWorkbook = (workbookPr = ""): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">${workbookPr}<sheets><sheet name="One" sheetId="1" r:id="rId1"/></sheets></workbook>`;

const oneSheetRels = (extra = ""): string =>
  `<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/>${extra}</Relationships>`;

const STYLES_REL = `<Relationship Id="rId9" Type="${REL_NS}/styles" Target="styles.xml"/>`;

/* Five dates on numFmtId 30 — `m/d/yy`, the built-in short date a CJK-locale
   Excel writes. No <numFmt> is present because a built-in id never needs one. */
const localeDatePackage = (): Record<string, string> => ({
  "_rels/.rels": ROOT_RELS,
  "xl/workbook.xml": oneSheetWorkbook(),
  "xl/_rels/workbook.xml.rels": oneSheetRels(STYLES_REL),
  "xl/styles.xml": numberedStyles([0, 30]),
  "xl/worksheets/sheet1.xml": `<worksheet xmlns="${MAIN_NS}"><sheetData>${[
    45670, 45671, 45672, 45673, 45674,
  ]
    .map((v, i) => `<row r="${i + 1}"><c r="A${i + 1}" s="1"><v>${v}</v></c></row>`)
    .join("")}</sheetData></worksheet>`,
});

/* Three t="s" cells and no sharedStrings part at all — every text cell points
   into a table that is not in the package. */
const NO_SHARED_STRINGS_PACKAGE: Record<string, string> = {
  "xl/workbook.xml": oneSheetWorkbook(),
  "xl/_rels/workbook.xml.rels": oneSheetRels(),
  "xl/worksheets/sheet1.xml": `<worksheet xmlns="${MAIN_NS}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>7</v></c></row></sheetData></worksheet>`,
};

/* A real .docx and a real .pptx: both carry a root relationship pointing at
   their own main part, which is exactly why neither ever reached the refusal
   that was written to describe them. */
const officeDocumentPackage = (target: string, body: string): Record<string, string> => ({
  "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="${target}"/></Relationships>`,
  [target]: body,
});

const DOCX_PACKAGE = officeDocumentPackage(
  "word/document.xml",
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Quarterly report</w:t></w:r></w:p></w:body></w:document>`,
);

const PPTX_PACKAGE = officeDocumentPackage(
  "ppt/presentation.xml",
  `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst><p:sldId id="256" r:id="rId2" xmlns:r="${REL_NS}"/></p:sldIdLst></p:presentation>`,
);

/* ── The round trip ───────────────────────────────────────────────────────── */

describe("readXlsx over a real package", () => {
  it("returns sheets in workbook order, with their names and hidden state", async () => {
    const wb = await readXlsx(await buildZip(FULL_PACKAGE), "book.xlsx");
    expect(wb.sheets.map((s) => s.name)).toEqual(["Data", "Q1 Notes"]);
    expect(wb.sheets.map((s) => s.hidden)).toEqual([false, true]);
  });

  it("reads every cell type into the right rectangle", async () => {
    const wb = await readXlsx(await buildZip(FULL_PACKAGE), "book.xlsx");
    expect(wb.sheets[0].rows).toEqual([
      // B1 is absent from the file — the gap is padded, not closed up.
      ["Name", "", "Inline"],
      // A multi-run <si>, a number, and a boolean written as Excel writes it.
      ["Hello World", "42", "TRUE"],
      // A false boolean, a formula's cached string result, an error literal.
      ["FALSE", "ab", "#DIV/0!"],
      // Rows 4 and 5 are absent from the file entirely.
      ["", "", ""],
      ["", "", ""],
      ["45678", "45679", "3.5"],
      ['Say "hi", now', "Hello ", "Line1\nLine2"],
    ]);
    expect(wb.sheets[0].rowCount).toBe(7);
    expect(wb.sheets[0].columnCount).toBe(3);
  });

  it("pads twenty-six missing columns in front of AB1", async () => {
    const wb = await readXlsx(await buildZip(FULL_PACKAGE), "book.xlsx");
    const row = wb.sheets[1].rows[0];
    expect(wb.sheets[1].columnCount).toBe(28);
    expect(row[0]).toBe("furigana");
    expect(row[27]).toBe("Name");
    expect(row.slice(1, 27).every((c) => c === "")).toBe(true);
  });

  it("excludes an <rPh> phonetic run from the string it guards", async () => {
    const wb = await readXlsx(await buildZip(FULL_PACKAGE), "book.xlsx");
    expect(wb.sheets[1].rows[0][0]).toBe("furigana");
    expect(wb.sheets[1].rows[0][0]).not.toContain("PHONETIC");
  });

  it("counts the cells whose raw serial number is really a date", async () => {
    const wb = await readXlsx(await buildZip(FULL_PACKAGE), "book.xlsx");
    expect(wb.styleTableRead).toBe(true);
    // A6 (built-in numFmtId 14) and B6 (custom yyyy-mm-dd). C6 wears a custom
    // format whose only letters are inside a quoted literal, so it is a number.
    expect(wb.sheets[0].dateFormattedCells).toBe(2);
  });

  it("counts a whole column of built-in short dates (numFmtId 30)", async () => {
    // The regression this guards: a CJK-locale workbook puts its dates on the
    // 27–36 / 50–58 block and on nothing else, and reporting zero dates there
    // suppresses the one warning the styles pass exists to produce.
    const wb = await readXlsx(await buildZip(localeDatePackage()), "invoices.xlsx");
    expect(wb.styleTableRead).toBe(true);
    expect(wb.sheets[0].numericCells).toBe(5);
    expect(wb.sheets[0].dateFormattedCells).toBe(5);
  });

  it("reads the 1904 date system flag off the workbook", async () => {
    const plain = await readXlsx(await buildZip(FULL_PACKAGE), "book.xlsx");
    expect(plain.date1904).toBe(false);

    const mac = await readXlsx(
      await buildZip({
        ...FULL_PACKAGE,
        "xl/workbook.xml": WORKBOOK.replace("<sheets>", `<workbookPr date1904="1"/><sheets>`),
      }),
      "mac.xlsx",
    );
    expect(mac.date1904).toBe(true);
  });

  it("counts the cells a missing shared-string table leaves empty", async () => {
    const wb = await readXlsx(await buildZip(NO_SHARED_STRINGS_PACKAGE), "damaged.xlsx");
    // Three of the four values are gone. Without a count this reads on screen
    // as a clean conversion of a mostly-empty sheet.
    expect(wb.sharedStringsRead).toBe(false);
    expect(wb.sheets[0].unresolvedSharedStrings).toBe(3);
    expect(wb.sheets[0].rows).toEqual([
      ["", ""],
      ["", "7"],
    ]);
  });

  it("counts a shared-string index that points past the end of the table", async () => {
    const wb = await readXlsx(
      await buildZip({
        ...NO_SHARED_STRINGS_PACKAGE,
        "xl/_rels/workbook.xml.rels": oneSheetRels(
          `<Relationship Id="rId8" Type="${REL_NS}/sharedStrings" Target="sharedStrings.xml"/>`,
        ),
        // A table with two entries, against cells asking for 0, 1 and 2.
        "xl/sharedStrings.xml": `<sst xmlns="${MAIN_NS}" count="2"><si><t>one</t></si><si><t>two</t></si></sst>`,
      }),
      "truncated.xlsx",
    );
    expect(wb.sharedStringsRead).toBe(true);
    expect(wb.sheets[0].unresolvedSharedStrings).toBe(1);
    expect(wb.sheets[0].rows).toEqual([
      ["one", "two"],
      ["", "7"],
    ]);
  });

  it("counts no unresolved strings in a package that has its table", async () => {
    const wb = await readXlsx(await buildZip(FULL_PACKAGE), "book.xlsx");
    expect(wb.sharedStringsRead).toBe(true);
    expect(wb.sheets.map((s) => s.unresolvedSharedStrings)).toEqual([0, 0]);
  });

  it("counts the plain numbers a missing style table would leave in doubt", async () => {
    const wb = await readXlsx(await buildZip(FULL_PACKAGE), "book.xlsx");
    // B2 (42) and the three cells of row 6. A formula's string result and an
    // error literal are not numbers, and neither is a shared string.
    expect(wb.sheets[0].numericCells).toBe(4);
    // Sheet 2 is two shared strings — nothing there can be a date.
    expect(wb.sheets[1].numericCells).toBe(0);
  });

  it("counts formula cells and error cells", async () => {
    const wb = await readXlsx(await buildZip(FULL_PACKAGE), "book.xlsx");
    expect(wb.sheets[0].formulaCells).toBe(1);
    expect(wb.sheets[0].errorCells).toBe(1);
  });

  it("writes the sheet back out as RFC 4180 CSV", async () => {
    const wb = await readXlsx(await buildZip(FULL_PACKAGE), "book.xlsx");
    const csv = rowsToCsv(wb.sheets[0].rows);
    expect(csv.split(CSV_EOL)[0]).toBe("Name,,Inline");
    // The one row that exercises every quoting rule at once: an embedded
    // comma AND embedded quotes, a preserved trailing space that needs no
    // quoting, and an embedded newline that does.
    expect(csv).toContain('"Say ""hi"", now",Hello ,"Line1\nLine2"');
  });

  it("reports the style table as unread when the package has no styles part", async () => {
    const parts = { ...FULL_PACKAGE };
    delete parts["xl/styles.xml"];
    const wb = await readXlsx(await buildZip(parts), "book.xlsx");
    expect(wb.styleTableRead).toBe(false);
    // Zero because nothing could be counted — NOT a claim that there are none.
    expect(wb.sheets[0].dateFormattedCells).toBe(0);
    // The data is untouched by the missing styles.
    expect(wb.sheets[0].rows[5]).toEqual(["45678", "45679", "3.5"]);
  });

  it("finds the workbook without a package relationships part", async () => {
    const parts = { ...FULL_PACKAGE };
    delete parts["_rels/.rels"];
    const wb = await readXlsx(await buildZip(parts), "book.xlsx");
    expect(wb.sheets.map((s) => s.name)).toEqual(["Data", "Q1 Notes"]);
  });
});

/* ── Refusals ─────────────────────────────────────────────────────────────── */

describe("readXlsx refusals", () => {
  const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00];

  it("names the format when handed an old binary .xls", async () => {
    const err = await readXlsx(bufferOf(OLE2), "accounts.xls").catch((e) => e);
    expect(err).toBeInstanceOf(XlsxReadError);
    expect((err as XlsxReadError).kind).toBe("legacy-xls");
    expect((err as Error).message).toContain(".xls file");
    expect((err as Error).message).toMatch(/Save As|re-save|\.xlsx/i);
  });

  it("explains the OLE2 container when the name says .xlsx", async () => {
    const err = await readXlsx(bufferOf(OLE2), "secret.xlsx").catch((e) => e);
    expect((err as XlsxReadError).kind).toBe("ole-container");
    expect((err as Error).message).toMatch(/password/i);
  });

  it("refuses a file that is not a ZIP at all", async () => {
    const err = await readXlsx(bufferOf([0x25, 0x50, 0x44, 0x46, 0x2d]), "notes.xlsx").catch(
      (e) => e,
    );
    expect((err as XlsxReadError).kind).toBe("not-a-zip");
  });

  it("refuses a ZIP with no main document part at all", async () => {
    const zip = await buildZip({ "photos/readme.txt": "holiday snaps" });
    const err = await readXlsx(zip, "renamed.xlsx").catch((e) => e);
    expect((err as XlsxReadError).kind).toBe("not-a-workbook");
    expect((err as Error).message).toMatch(/no workbook part/i);
  });

  it("names Word when a .docx has been renamed to .xlsx", async () => {
    // The package a real .docx is: a root relationship pointing at
    // word/document.xml, which loads perfectly well and simply is not a
    // workbook. Telling this user their spreadsheet "declares no sheets"
    // sends them back to Excel to hunt for tabs that were never the problem.
    const err = await readXlsx(await buildZip(DOCX_PACKAGE), "report.xlsx").catch((e) => e);
    expect(err).toBeInstanceOf(XlsxReadError);
    expect((err as XlsxReadError).kind).toBe("not-a-workbook");
    expect((err as Error).message).toMatch(/Word document/i);
    expect((err as Error).message).not.toMatch(/declares no sheets/i);
  });

  it("names PowerPoint when a .pptx has been renamed to .xlsx", async () => {
    const err = await readXlsx(await buildZip(PPTX_PACKAGE), "deck.xlsx").catch((e) => e);
    expect((err as XlsxReadError).kind).toBe("not-a-workbook");
    expect((err as Error).message).toMatch(/PowerPoint/i);
    expect((err as Error).message).not.toMatch(/declares no sheets/i);
  });

  it("still finds a workbook when the root relationship points elsewhere", async () => {
    // A package that names a non-workbook main part but keeps a real workbook
    // where every .xlsx keeps one. Refusing that would be the fix overshooting.
    const wb = await readXlsx(
      await buildZip({ ...DOCX_PACKAGE, ...FULL_PACKAGE, "_rels/.rels": DOCX_PACKAGE["_rels/.rels"] }),
      "odd.xlsx",
    );
    expect(wb.sheets.map((s) => s.name)).toEqual(["Data", "Q1 Notes"]);
  });

  it("keeps \"declares no sheets\" for a real workbook part with an empty <sheets/>", async () => {
    const zip = await buildZip({
      "xl/workbook.xml": `<workbook xmlns="${MAIN_NS}"><sheets/></workbook>`,
    });
    const err = await readXlsx(zip, "empty.xlsx").catch((e) => e);
    expect((err as XlsxReadError).kind).toBe("not-a-workbook");
    expect((err as Error).message).toMatch(/declares no sheets/i);
  });

  it("reports damaged XML rather than silently returning nothing", async () => {
    const parts = { ...FULL_PACKAGE, "xl/worksheets/sheet1.xml": "<worksheet><sheetData>" };
    const err = await readXlsx(await buildZip(parts), "book.xlsx").catch((e) => e);
    expect(err).toBeInstanceOf(XlsxReadError);
    expect((err as XlsxReadError).kind).toBe("corrupt");
  });
});

/* ── The UI, wired to the reader ──────────────────────────────────────────── */

/*
  Not a layout test — that is the all-tools Playwright sweep's job. This is the
  one seam the pure functions above cannot cover: that the component actually
  reaches the reader, and that the CSV a user sees and the name on the download
  button are the ones this module produced. It is written with `createElement`
  so it can live beside the parser tests it is checking against.
*/
describe("XlsxToCsvUI", () => {
  /** Render the tool and hand it one workbook, the way the drop zone does. */
  const dropWorkbook = (zip: ArrayBuffer, name: string) => {
    const { container } = render(createElement(XlsxToCsvUI));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File([zip], name)] });
    fireEvent.change(input);
  };

  const warningText = async (): Promise<string> => {
    const el = await waitFor(() => screen.getByRole("status"));
    return el.textContent ?? "";
  };

  it("renders a real initial surface before any file is dropped", () => {
    render(createElement(XlsxToCsvUI));
    expect(screen.getByText(/Drop an \.xlsx workbook/i)).toBeTruthy();
  });

  it("pairs the worked example serial with the date it really is", async () => {
    dropWorkbook(
      await buildZip({
        "xl/workbook.xml": oneSheetWorkbook(),
        "xl/_rels/workbook.xml.rels": oneSheetRels(STYLES_REL),
        "xl/styles.xml": numberedStyles([0, 14]),
        "xl/worksheets/sheet1.xml": `<worksheet xmlns="${MAIN_NS}"><sheetData><row r="1"><c r="A1" s="1"><v>45678</v></c></row></sheetData></worksheet>`,
      }),
      "dates.xlsx",
    );

    const text = await warningText();
    expect(text).toContain("45678 rather than 2025-01-21");
    // 2025-01-15 is serial 45672 — the pair this sentence used to assert.
    expect(text).not.toContain("2025-01-15");
  });

  it("moves the worked example onto the 1904 epoch when the workbook declares it", async () => {
    dropWorkbook(
      await buildZip({
        "xl/workbook.xml": oneSheetWorkbook(`<workbookPr date1904="1"/>`),
        "xl/_rels/workbook.xml.rels": oneSheetRels(STYLES_REL),
        "xl/styles.xml": numberedStyles([0, 14]),
        "xl/worksheets/sheet1.xml": `<worksheet xmlns="${MAIN_NS}"><sheetData><row r="1"><c r="A1" s="1"><v>45678</v></c></row></sheetData></worksheet>`,
      }),
      "mac-dates.xlsx",
    );

    const text = await warningText();
    expect(text).toContain("45678 rather than 2029-01-22");
    expect(text).toContain("1904-01-01");
  });

  it("warns about a date column carried on a locale short-date format", async () => {
    dropWorkbook(await buildZip(localeDatePackage()), "invoices.xlsx");

    await waitFor(() => {
      expect(screen.getByLabelText("CSV preview").textContent).toContain("45670");
    });
    expect(screen.getByText("DATE CELLS").parentElement?.textContent).toContain("5");
    expect(await warningText()).toMatch(/5 cells .* carry a date or time format/);
  });

  it("says how many cells a missing shared-string table emptied", async () => {
    dropWorkbook(await buildZip(NO_SHARED_STRINGS_PACKAGE), "damaged.xlsx");

    const text = await warningText();
    expect(text).toMatch(/3 cells point at a shared string this workbook does not contain/);
    expect(text).toContain("sharedStrings.xml");
  });

  it("says nothing about dates when a styleless workbook holds no numbers", async () => {
    // The package below has no xl/styles.xml, so `styleTableRead` is false —
    // but every cell in it is a string, and there is therefore nothing to be
    // uncertain about. Warning here would be noise dressed as honesty.
    const zip = await buildZip({
      "xl/workbook.xml": `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets><sheet name="One" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      "xl/worksheets/sheet1.xml": `<worksheet xmlns="${MAIN_NS}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>text</t></is></c></row></sheetData></worksheet>`,
    });

    const { container } = render(createElement(XlsxToCsvUI));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File([zip], "words.xlsx")] });
    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getByLabelText("CSV preview").textContent).toBe("text");
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("DATE CELLS").parentElement?.textContent).toContain("0");
  });

  it("previews the sheet's real CSV and names the download after it", async () => {
    // A1 holds a comma, so it MUST come back quoted; B1 is absent, so the
    // preview must show an empty field rather than shifting 7 left.
    const zip = await buildZip({
      "xl/workbook.xml": `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets><sheet name="One" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      "xl/worksheets/sheet1.xml": `<worksheet xmlns="${MAIN_NS}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>a,b</t></is></c><c r="C1"><v>7</v></c></row></sheetData></worksheet>`,
    });

    const { container } = render(createElement(XlsxToCsvUI));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File([zip], "book.xlsx")] });
    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getByLabelText("CSV preview").textContent).toBe('"a,b",,7');
    });
    // The e2e download helpers all match /^Download /, so the accessible name
    // is load-bearing, not decoration.
    expect(screen.getByRole("button", { name: "Download book-One.csv" })).toBeTruthy();
  });
});
