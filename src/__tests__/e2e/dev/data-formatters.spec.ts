import { test, expect } from "@playwright/test";
import { errorAlert } from "../helpers";

test.describe("data formatters", () => {
  test("JSON formatter pretty-prints valid JSON", async ({ page }) => {
    await page.goto("/json-formatter");
    const input = page.getByPlaceholder(/{"name":/);
    await input.fill('{"a":1,"b":[2,3]}');

    // Output is rendered into a <pre>; assert the pretty-printed shape.
    await expect(page.locator("pre")).toContainText('"a": 1');
    await expect(page.locator("pre")).toContainText('"b":');
  });

  test("JSON formatter surfaces parse errors for invalid input", async ({ page }) => {
    await page.goto("/json-formatter");
    const input = page.getByPlaceholder(/{"name":/);
    await input.fill("{not json}");
    await expect(errorAlert(page)).toBeVisible();
  });

  test("JSON formatter minify mode collapses whitespace", async ({ page }) => {
    await page.goto("/json-formatter");
    const input = page.getByPlaceholder(/{"name":/);
    await input.fill('{\n  "a":  1,\n  "b": 2\n}');

    await page.getByRole("button", { name: "Minify" }).click();
    const output = await page.locator("pre").innerText();
    expect(output).toBe('{"a":1,"b":2}');
  });

  test("CSV → JSON converter parses headers + rows", async ({ page }) => {
    await page.goto("/csv-to-json");
    await page
      .getByPlaceholder("name,age,city")
      .fill("name,age\nAlice,30\nBob,25");
    await page.getByRole("button", { name: "Convert to JSON" }).click();

    const output = page.locator("pre").innerText();
    expect(await output).toContain('"name": "Alice"');
    expect(await output).toContain('"age": "30"');
  });

  test("JSON → CSV converter emits headers + rows", async ({ page }) => {
    await page.goto("/json-to-csv");
    // Find the JSON textarea — it's the only one on this page.
    const ta = page.locator("textarea").first();
    await ta.fill('[{"name":"Alice","age":30},{"name":"Bob","age":25}]');
    await page.getByRole("button", { name: /Convert to CSV/i }).click();
    const output = await page.locator("pre").innerText();
    expect(output).toContain("name,age");
    expect(output).toContain("Alice,30");
  });

  test("SQL formatter pretty-prints with chosen dialect", async ({ page }) => {
    await page.goto("/sql-formatter");
    const ta = page.locator("textarea").first();
    await ta.fill("select id, name from users where age > 18 order by name asc");
    await page.getByRole("button", { name: "Format SQL" }).click();
    const out = await page.locator("pre").innerText();
    // Default config is uppercase + 2-space indent.
    expect(out).toContain("SELECT");
    expect(out).toContain("FROM");
    expect(out).toContain("WHERE");
  });

  test("Markdown → HTML converter renders an H1", async ({ page }) => {
    await page.goto("/markdown-to-html");
    const ta = page.locator("textarea").first();
    await ta.fill("# Hello world\n\nThis is **bold**.");

    // Switch to HTML source view so we can read the marked-up output as text.
    await page.getByRole("button", { name: "HTML", exact: true }).click();
    const html = await page.locator("pre").innerText();
    expect(html).toContain("<h1");
    expect(html).toContain("Hello world");
    expect(html).toContain("<strong>bold</strong>");
  });

  test("HTML → Markdown converter handles basic tags", async ({ page }) => {
    await page.goto("/html-to-markdown");
    const ta = page.locator("textarea").first();
    await ta.fill("<h1>Hello</h1><p>This is <strong>bold</strong>.</p>");
    await page.getByRole("button", { name: "Convert to Markdown" }).click();
    const md = await page.locator("pre").innerText();
    expect(md).toContain("# Hello");
    expect(md).toMatch(/\*\*bold\*\*/);
  });

  test("XML formatter pretty-prints valid XML", async ({ page }) => {
    await page.goto("/xml-formatter");
    const ta = page.locator("textarea").first();
    await ta.fill("<root><child>value</child></root>");
    await page.getByRole("button", { name: /Format XML/i }).click();
    const out = await page.locator("pre").innerText();
    // Pretty-printed output puts <child> on its own indented line.
    expect(out.split("\n").length).toBeGreaterThan(1);
    expect(out).toContain("<child>value</child>");
  });
});
