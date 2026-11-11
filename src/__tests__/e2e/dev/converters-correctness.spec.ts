import { test, expect, type Page } from "@playwright/test";
import * as yaml from "js-yaml";
import JSZip from "jszip";
import { marked } from "marked";
import TurndownService from "turndown";
import { downloadBytes, waitForDownload } from "../helpers";

/**
 * Output-value correctness for the text / file converters.
 *
 * Every expected value is computed independently of the page (js-yaml,
 * JSON.parse, hand-built OOXML) so a tool that renders *something* in the
 * right shape but with the wrong content fails here. Locators are scoped to
 * `[data-tool-surface]` because the FAQ copy below it repeats UI strings.
 */

const surfaceOf = (page: Page) => page.locator("[data-tool-surface]");

// First hit on a route compiles it in the shared dev server; give it room.
test.beforeEach(() => {
  test.setTimeout(120_000);
});

/** Open a text-in tool, switch to Paste mode when it has one, fill the textarea. */
async function paste(page: Page, slug: string, text: string): Promise<void> {
  await page.goto(`/${slug}`);
  const surface = surfaceOf(page);
  const pasteTab = surface.getByRole("button", { name: "Paste", exact: true });
  const box = surface.locator("textarea").first();
  // Hydration is async: wait for either the mode switch or the textarea.
  await pasteTab.or(box).first().waitFor({ timeout: 90_000 });
  if (await pasteTab.isVisible()) await pasteTab.click();
  await surface.locator("textarea").first().fill(text);
}

const region = (page: Page, name: string) => surfaceOf(page).getByRole("region", { name, exact: true });

async function outText(page: Page, name: string): Promise<string> {
  const r = region(page, name);
  await expect(r).toBeVisible();
  return (await r.textContent()) ?? "";
}

test.describe("subtitle-converter", () => {
  const SRT =
    "1\n00:00:01,000 --> 00:00:04,500\nHello there\n\n2\n00:01:02,250 --> 00:01:03,000\nSecond cue\nline two\n";

  test("SRT -> VTT rewrites timestamps and header, and VTT -> SRT restores the original", async ({ page }) => {
    await paste(page, "subtitle-converter", SRT);
    await surfaceOf(page).getByRole("button", { name: "VTT", exact: true }).click();
    const vtt = await outText(page, "Converted subtitles");
    expect(vtt.startsWith("WEBVTT")).toBe(true);
    expect(vtt).toContain("00:00:01.000 --> 00:00:04.500");
    expect(vtt).toContain("00:01:02.250 --> 00:01:03.000");
    expect(vtt).not.toContain(","); // no SRT decimal comma survives
    expect(vtt).toContain("Hello there");
    expect(vtt).toContain("Second cue\nline two");

    // Feed the VTT back through, ask for SRT: must equal the original cues.
    await surfaceOf(page).locator("textarea").first().fill(vtt);
    await surfaceOf(page).getByRole("button", { name: "SRT", exact: true }).click();
    const srt = await outText(page, "Converted subtitles");
    expect(srt.trim()).toBe(SRT.trim());
  });

  test("time shift moves every cue by the requested amount", async ({ page }) => {
    await paste(page, "subtitle-converter", SRT);
    await surfaceOf(page).getByLabel("Time shift").fill("+2.5s");
    const out = await outText(page, "Converted subtitles");
    expect(out).toContain("00:00:03,500 --> 00:00:07,000");
    expect(out).toContain("00:01:04,750 --> 00:01:05,500");
  });
});

test.describe("yaml / json converters", () => {
  const YAML_SRC =
    "name: transmute\nports:\n  - 8080\n  - 8443\nnested:\n  enabled: true\n  nothing: null\n  ratio: 1.5\n  text: 'quoted: yes'\n";

  test("yaml-to-json output parses to exactly what js-yaml loads (2 spaces)", async ({ page }) => {
    await paste(page, "yaml-to-json", YAML_SRC);
    const out = await outText(page, "Converted output");
    expect(JSON.parse(out)).toEqual(yaml.load(YAML_SRC));
    expect(out.trim()).toBe(JSON.stringify(yaml.load(YAML_SRC), null, 2));
  });

  test("yaml-to-json honours the 4-space indent option", async ({ page }) => {
    await paste(page, "yaml-to-json", "a:\n  b: 1\n");
    await surfaceOf(page).getByRole("button", { name: "4 spaces" }).click();
    const out = await outText(page, "Converted output");
    expect(out.trim()).toBe(JSON.stringify({ a: { b: 1 } }, null, 4));
  });

  test("json-to-yaml output loads back to the same value", async ({ page }) => {
    const value = {
      name: "transmute",
      ports: [8080, 8443],
      nested: { enabled: true, nothing: null, ratio: 1.5, text: "quoted: yes" },
    };
    await paste(page, "json-to-yaml", JSON.stringify(value));
    // The page renders the output in a region; find it whatever its label.
    const out = await surfaceOf(page).getByRole("region").first().textContent();
    expect(yaml.load(out ?? "")).toEqual(value);
  });

  test("yaml-formatter re-emits equivalent YAML with keys sorted on request", async ({ page }) => {
    const src = "zeta: 1\nalpha:\n    - x\n    - y\nmid: {k: v}\n";
    await paste(page, "yaml-formatter", src);
    const out = await outText(page, "Formatted YAML");
    expect(yaml.load(out)).toEqual(yaml.load(src));

    await surfaceOf(page).getByLabel("Sort keys alphabetically").check();
    const sorted = await outText(page, "Formatted YAML");
    expect(yaml.load(sorted)).toEqual(yaml.load(src));
    expect(Object.keys(yaml.load(sorted) as object)).toEqual(["alpha", "mid", "zeta"]);
    const order = ["alpha:", "mid:", "zeta:"].map((k) => sorted.indexOf(k));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
  });
});

test("json-minify strips whitespace and keeps a 20-digit integer exact", async ({ page }) => {
  await paste(page, "json-minify", '{\n  "id": 12345678901234567890,\n  "rate": 1.0,\n  "s": "a b",\n  "l": [ 1, 2 ]\n}');
  const r = surfaceOf(page).getByRole("region").first();
  await expect(r).toBeVisible();
  const out = ((await r.textContent()) ?? "").trim();
  // Whitespace inside strings is preserved, outside is gone; digits are untouched
  // (a JSON.parse/stringify round trip would turn the id into 12345678901234567000).
  expect(out).toBe('{"id":12345678901234567890,"rate":1.0,"s":"a b","l":[1,2]}');
});

test.describe("sort-dedupe-lines", () => {
  test("sorts A-Z, removes duplicates and blank lines", async ({ page }) => {
    await paste(page, "sort-dedupe-lines", "pear\napple\n\npear\nbanana\napple\n");
    const surface = surfaceOf(page);
    await surface.getByLabel("Sort order").selectOption({ label: "A → Z" });
    await surface.getByLabel("Remove blank lines").check();
    const out = await outText(page, "Sorted lines");
    expect(out.trim().split("\n")).toEqual(["apple", "banana", "pear"]);
  });

  test("natural sort puts file2 before file10, Z-A reverses", async ({ page }) => {
    await paste(page, "sort-dedupe-lines", "file10.txt\nfile2.txt\nfile1.txt");
    const surface = surfaceOf(page);
    await surface.getByLabel("Sort order").selectOption({ label: "Natural — file2 before file10" });
    expect((await outText(page, "Sorted lines")).trim().split("\n")).toEqual([
      "file1.txt",
      "file2.txt",
      "file10.txt",
    ]);
    await surface.getByLabel("Sort order").selectOption({ label: "Z → A" });
    expect((await outText(page, "Sorted lines")).trim().split("\n")).toEqual([
      "file2.txt",
      "file10.txt",
      "file1.txt",
    ]);
  });
});

test.describe("crlf-lf", () => {
  const CRLF = Buffer.from("one\r\ntwo\r\n\r\nthree\r\n", "utf8");

  test("CRLF file -> LF download has no CR and same lines", async ({ page }) => {
    await page.goto("/crlf-lf");
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "win.txt",
      mimeType: "text/plain",
      buffer: CRLF,
    });
    await surfaceOf(page).getByRole("button", { name: "LF", exact: true }).click();
    const { download } = await waitForDownload(page, page.getByRole("button", { name: /^Download/ }));
    const bytes = await downloadBytes(download);
    expect(bytes.toString("utf8")).toBe("one\ntwo\n\nthree\n");
  });

  test("LF file -> CRLF download has a CR before every LF", async ({ page }) => {
    await page.goto("/crlf-lf");
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "unix.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("a\nb\n\nc\n", "utf8"),
    });
    await surfaceOf(page).getByRole("button", { name: "CRLF", exact: true }).click();
    const { download } = await waitForDownload(page, page.getByRole("button", { name: /^Download/ }));
    const bytes = await downloadBytes(download);
    expect(bytes.toString("utf8")).toBe("a\r\nb\r\n\r\nc\r\n");
  });
});

/** Minimal valid .xlsx built with JSZip. */
async function buildXlsx(): Promise<Buffer> {
  const z = new JSZip();
  z.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
  );
  z.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  z.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="People" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  z.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
  );
  z.file(
    "xl/sharedStrings.xml",
    `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4"><si><t>name</t></si><si><t>score</t></si><si><t>Ada, L</t></si><si><t>Bob</t></si></sst>`,
  );
  z.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>42</v></c></row><row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>3.5</v></c></row></sheetData></worksheet>`,
  );
  return z.generateAsync({ type: "nodebuffer" });
}

test("xlsx-to-csv emits the cell values, quoting the comma, and downloads the same CSV", async ({ page }) => {
  await page.goto("/xlsx-to-csv");
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "people.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: await buildXlsx(),
  });
  const expected = 'name,score\n"Ada, L",42\nBob,3.5';
  await expect(surfaceOf(page).locator("pre").first()).toHaveText(expected, { timeout: 30_000 });

  const { download, suggestedFilename } = await waitForDownload(page, page.getByRole("button", { name: /^Download/ }));
  expect(suggestedFilename).toMatch(/\.csv$/);
  // Header/BOM options aside, the body must be the CSV above (RFC 4180: CRLF or LF).
  const body = (await downloadBytes(download)).toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  expect(body.trim()).toBe(expected);
});

test("xlsx-to-csv semicolon separator changes the delimiter", async ({ page }) => {
  await page.goto("/xlsx-to-csv");
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "people.xlsx",
    mimeType: "application/octet-stream",
    buffer: await buildXlsx(),
  });
  await surfaceOf(page).getByRole("button", { name: "Semicolon", exact: true }).click();
  await expect(surfaceOf(page).locator("pre").first()).toHaveText("name;score\nAda, L;42\nBob;3.5", {
    timeout: 30_000,
  });
});

test("charset-converter reads Latin-1 bytes as Windows-1252 and downloads UTF-8", async ({ page }) => {
  await page.goto("/charset-converter");
  // "café naïve\n" in ISO-8859-1: é = E9, ï = EF
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "latin.txt",
    mimeType: "text/plain",
    buffer: Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x6e, 0x61, 0xef, 0x76, 0x65, 0x0a]),
  });
  const dec = region(page, "Decoded text");
  await expect(dec).toHaveText("café naïve", { timeout: 15_000 });
  const { download } = await waitForDownload(page, page.getByRole("button", { name: /^Download/ }));
  expect(Array.from(await downloadBytes(download))).toEqual([
    0x63, 0x61, 0x66, 0xc3, 0xa9, 0x20, 0x6e, 0x61, 0xc3, 0xaf, 0x76, 0x65, 0x0a,
  ]);
});

test("charset-converter decodes Shift_JIS when told to", async ({ page }) => {
  await page.goto("/charset-converter");
  // "日本語" in Shift_JIS
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "jp.txt",
    mimeType: "text/plain",
    buffer: Buffer.from([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea]),
  });
  await surfaceOf(page).getByLabel("Read the file as").selectOption({ label: "Shift_JIS · Japanese" });
  await expect(region(page, "Decoded text")).toHaveText("日本語");
  const { download } = await waitForDownload(page, page.getByRole("button", { name: /^Download/ }));
  expect((await downloadBytes(download)).toString("utf8")).toBe("日本語");
});

test("har-viewer lists each request with its method, status and path", async ({ page }) => {
  const har = {
    log: {
      version: "1.2",
      creator: { name: "t", version: "1" },
      entries: [
        {
          startedDateTime: "2024-01-01T00:00:00.000Z",
          time: 120,
          request: { method: "GET", url: "https://example.com/api/items?x=1", httpVersion: "HTTP/1.1", headers: [], queryString: [], cookies: [], headersSize: -1, bodySize: 0 },
          response: { status: 200, statusText: "OK", httpVersion: "HTTP/1.1", headers: [], cookies: [], content: { size: 10, mimeType: "application/json" }, redirectURL: "", headersSize: -1, bodySize: 10 },
          cache: {},
          timings: { send: 1, wait: 100, receive: 19 },
        },
        {
          startedDateTime: "2024-01-01T00:00:01.000Z",
          time: 50,
          request: { method: "POST", url: "https://example.com/missing", httpVersion: "HTTP/1.1", headers: [], queryString: [], cookies: [], headersSize: -1, bodySize: 0 },
          response: { status: 404, statusText: "Not Found", httpVersion: "HTTP/1.1", headers: [], cookies: [], content: { size: 0, mimeType: "text/html" }, redirectURL: "", headersSize: -1, bodySize: 0 },
          cache: {},
          timings: { send: 1, wait: 40, receive: 9 },
        },
      ],
    },
  };
  await page.goto("/har-viewer");
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "t.har",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(har)),
  });
  const surface = surfaceOf(page);
  await expect(surface.getByText("2 REQUESTS", { exact: true })).toBeVisible();
  const rows = surface.locator("button[aria-pressed]").filter({ hasText: /example\.com/ });
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("GET");
  await expect(rows.nth(0)).toContainText("200");
  await expect(rows.nth(0)).toContainText("/api/items?x=1");
  await expect(rows.nth(0)).toContainText("120 ms");
  await expect(rows.nth(1)).toContainText("POST");
  await expect(rows.nth(1)).toContainText("404");
  await expect(rows.nth(1)).toContainText("/missing");
  // Summed durations: 120 + 50
  await expect(surface.getByText("170 ms").first()).toBeVisible();
});

async function buildDocx(): Promise<Buffer> {
  const z = new JSZip();
  z.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  z.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  z.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Title Here</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Plain and </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r><w:r><w:t>.</w:t></w:r></w:p></w:body></w:document>`,
  );
  return z.generateAsync({ type: "nodebuffer" });
}

test("docx-to-markdown turns a Heading1 and a bold run into # and ** markup", async ({ page }) => {
  await page.goto("/docx-to-markdown");
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "t.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: await buildDocx(),
  });
  const md = region(page, "Markdown output");
  await expect(md).toHaveText("# Title Here\n\nPlain and **bold**.", { timeout: 30_000 });
});

test("svg-optimizer output is a smaller, still-valid SVG with the same shape", async ({ page }) => {
  const src = `<?xml version="1.0"?>\n<!-- c -->\n<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">\n  <metadata>junk</metadata>\n  <rect x="10.000" y="10.000" width="80.000" height="80.000" fill="#ff0000"/>\n</svg>\n`;
  await page.goto("/svg-optimizer");
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "t.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(src),
  });
  const out = await outText(page, "Optimised SVG");
  expect(out.length).toBeLessThan(src.length);
  expect(out).not.toContain("metadata");
  expect(out).not.toContain("<!--");

  // Parses as SVG and keeps the root geometry.
  const parsed = await page.evaluate((s) => {
    const d = new DOMParser().parseFromString(s, "image/svg+xml");
    const root = d.documentElement;
    return {
      err: d.querySelector("parsererror") !== null,
      tag: root.tagName,
      viewBox: root.getAttribute("viewBox"),
      kids: root.children.length,
    };
  }, out);
  expect(parsed).toEqual({ err: false, tag: "svg", viewBox: "0 0 100 100", kids: 1 });

  // Renders to the same pixels as the original.
  const px = await page.evaluate(async ([a, b]) => {
    async function raster(svg: string) {
      const img = new Image();
      img.src = "data:image/svg+xml;base64," + btoa(svg);
      await img.decode();
      const c = document.createElement("canvas");
      c.width = 100;
      c.height = 100;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0, 100, 100);
      return Array.from(g.getImageData(0, 0, 100, 100).data);
    }
    const [ra, rb] = [await raster(a), await raster(b)];
    let diff = 0;
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) diff++;
    return { diff, red: ra[(50 * 100 + 50) * 4], redOpt: rb[(50 * 100 + 50) * 4], cornerA: ra[3] };
  }, [src, out]);
  expect(px).toEqual({ diff: 0, red: 255, redOpt: 255, cornerA: 0 });
});

test("csv-markdown-table renders a pipe table matching the CSV cells", async ({ page }) => {
  await page.goto("/csv-markdown-table");
  await surfaceOf(page).locator("textarea").first().fill("name,role\nAda,Engineer\n\"Smith, J\",Ops");
  await surfaceOf(page).getByLabel("Line the columns up").uncheck();
  const out = (await outText(page, "Result")).trim().split("\n");
  const cells = (l: string) => l.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
  expect(cells(out[0])).toEqual(["name", "role"]);
  expect(cells(out[1]).every((c) => /^:?-{3,}:?$/.test(c))).toBe(true);
  expect(cells(out[2])).toEqual(["Ada", "Engineer"]);
  expect(cells(out[3])).toEqual(["Smith, J", "Ops"]);
  expect(out).toHaveLength(4);
});

test.describe("text-format converters", () => {
  test("json-to-csv flattens nested objects, unions headers and quotes per RFC 4180", async ({ page }) => {
    const rows = [
      { id: 1, name: 'Ada "the" Countess', tags: ["a", "b"], addr: { city: "London", zip: null } },
      { id: 2, name: "Bob, Jr.", note: "line1\nline2", addr: { city: "Paris" } },
    ];
    await page.goto("/json-to-csv");
    await surfaceOf(page).locator("textarea").first().fill(JSON.stringify(rows));
    await surfaceOf(page).getByRole("button", { name: /Convert to CSV/i }).click();
    const out = await outText(page, "CSV output");
    // Headers in first-seen order across all rows; nested keys joined with dots;
    // arrays serialised as JSON; null -> empty; quotes doubled.
    const expected = [
      "id,name,tags,addr.city,addr.zip,note",
      '1,"Ada ""the"" Countess","[""a"",""b""]",London,,',
      '2,"Bob, Jr.",,Paris,,"line1\nline2"',
    ].join("\n");
    expect(out.trim()).toBe(expected);
  });

  test("csv-to-json handles quoted commas, doubled quotes, embedded newlines, CRLF and short rows", async ({ page }) => {
    await page.goto("/csv-to-json");
    const csv = 'name,note,n\r\n"Smith, J","He said ""hi""",1\r\n"Multi\nline",plain\r\n';
    await surfaceOf(page).getByLabel("Input CSV").fill(csv);
    await surfaceOf(page).getByRole("button", { name: "Convert to JSON" }).click();
    const out = JSON.parse(await outText(page, "JSON output"));
    expect(out).toEqual([
      { name: "Smith, J", note: 'He said "hi"', n: "1" },
      { name: "Multi\nline", note: "plain", n: "" },
    ]);
  });

  test("sql-formatter keeps every token, upper-cases keywords and breaks clauses onto lines", async ({ page }) => {
    const sql =
      "select u.id, count(o.id) as n from users u left join orders o on o.user_id = u.id where u.name = 'Bob' and u.age > 18 group by u.id order by n desc limit 10";
    await page.goto("/sql-formatter");
    await surfaceOf(page).getByLabel("Input SQL").fill(sql);
    await surfaceOf(page).getByRole("button", { name: "Format SQL" }).click();
    const out = await outText(page, "Formatted SQL");
    // Same tokens modulo whitespace and keyword case; the string literal keeps its case.
    expect(out.replace(/\s+/g, "").toLowerCase()).toBe(sql.replace(/\s+/g, "").toLowerCase());
    expect(out).toContain("'Bob'");
    for (const kw of ["SELECT", "FROM", "LEFT JOIN", "WHERE", "GROUP BY", "ORDER BY", "LIMIT"]) {
      expect(out).toContain(kw);
    }
    const lines = out.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(7);
    expect(lines.find((l) => /^\s*FROM\b/.test(l))).toBeTruthy();
    expect(lines.find((l) => /^\s*WHERE\b/.test(l))).toBeTruthy();
  });

  test("markdown-to-html HTML source equals marked's output for a mixed document", async ({ page }) => {
    const md =
      "# Title\n\nSome *em* and **strong** and `code`.\n\n- one\n- two\n\n1. a\n2. b\n\n[link](https://example.com)\n\n```js\nconst x = 1 < 2;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
    await page.goto("/markdown-to-html");
    await surfaceOf(page).getByLabel("Markdown").fill(md);
    await surfaceOf(page).getByRole("button", { name: "HTML", exact: true }).click();
    const out = await outText(page, "HTML output");
    expect(out.trim()).toBe((marked.parse(md) as string).trim());
    expect(out).toContain("<table>");
    expect(out).toContain("&lt; 2;");
  });

  test("html-to-markdown matches Turndown (atx headings, fenced code) for a mixed fragment", async ({ page }) => {
    const html =
      '<h2>Head</h2><p>Para with <em>em</em>, <strong>strong</strong> and <a href="https://example.com/a">a link</a>.</p><ul><li>one</li><li>two</li></ul><ol><li>x</li><li>y</li></ol><pre><code>let a = 1;\nlet b = 2;</code></pre><blockquote><p>quoted</p></blockquote>';
    await page.goto("/html-to-markdown");
    await surfaceOf(page).locator("textarea").first().fill(html);
    await surfaceOf(page).getByRole("button", { name: "Convert to Markdown" }).click();
    const expected = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" }).turndown(html);
    const out = ((await surfaceOf(page).locator("pre").first().textContent()) ?? "").trim();
    expect(out).toBe(expected.trim());
    expect(out).toContain("## Head");
    expect(out).toContain("[a link](https://example.com/a)");
  });

  test("xml-formatter indents nested elements, keeps text/attributes/entities, and minify round-trips", async ({ page }) => {
    const xml =
      '<root a="1 &amp; 2"><item id="1"><name>Test &lt;1&gt;</name><empty/></item><!-- note --><item id="2"><![CDATA[x < y]]></item></root>';
    await page.goto("/xml-formatter");
    await surfaceOf(page).locator("textarea").first().fill(xml);
    await surfaceOf(page).getByRole("button", { name: /Format XML/i }).click();
    const out = await outText(page, "Formatted XML");

    // Same infoset: strip indentation whitespace and compare canonical serialisations.
    const canon = (s: string) =>
      page.evaluate((x) => {
        const d = new DOMParser().parseFromString(x, "application/xml");
        if (d.querySelector("parsererror")) return "PARSE_ERROR";
        const strip = (n: Node) => {
          for (const c of Array.from(n.childNodes)) {
            if (c.nodeType === 3 && !(c.nodeValue ?? "").trim()) n.removeChild(c);
            else strip(c);
          }
        };
        strip(d);
        return new XMLSerializer().serializeToString(d);
      }, s);
    expect(await canon(out)).toBe(await canon(xml));
    expect(await canon(out)).not.toBe("PARSE_ERROR");

    // Indented: nested element sits deeper than its parent.
    const lines = out.split("\n");
    const indentOf = (needle: string) => (lines.find((l) => l.includes(needle)) ?? "").search(/\S/);
    expect(indentOf("<item id=\"1\"")).toBeGreaterThan(indentOf("<root"));
    expect(indentOf("<name>")).toBeGreaterThan(indentOf("<item id=\"1\""));
  });

  test("xml-formatter reports malformed XML instead of emitting output", async ({ page }) => {
    await page.goto("/xml-formatter");
    await surfaceOf(page).locator("textarea").first().fill("<a><b></a>");
    await surfaceOf(page).getByRole("button", { name: /Format XML/i }).click();
    await expect(surfaceOf(page).getByRole("alert")).toBeVisible();
    await expect(surfaceOf(page).getByRole("region", { name: "Formatted XML" })).toHaveCount(0);
  });
});
