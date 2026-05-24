import { test, expect } from "@playwright/test";
import { errorAlert } from "../helpers";

test.describe("dev utilities", () => {
  test("regex tester highlights matches and counts them", async ({ page }) => {
    await page.goto("/regex-tester");

    // Pattern is a single-line text input; testStr is a textarea.
    await page.locator('input[type="text"]').first().fill("\\d+");
    await page.locator("textarea").first().fill("a 12 b 345 c");

    // Highlight count is rendered as "Matches (N)".
    await expect(page.getByText(/Matches \(2\)/)).toBeVisible();
    // <mark> tags wrap each match.
    await expect(page.locator("mark")).toHaveCount(2);
    await expect(page.locator("mark").first()).toHaveText("12");
    await expect(page.locator("mark").nth(1)).toHaveText("345");
  });

  test("regex tester surfaces an invalid pattern as an alert", async ({ page }) => {
    await page.goto("/regex-tester");
    await page.locator('input[type="text"]').first().fill("[unclosed");
    await page.locator("textarea").first().fill("anything");
    await expect(errorAlert(page)).toBeVisible();
  });

  test("cron generator copies the constructed expression", async ({ page }) => {
    await page.goto("/cron-expression-generator");
    // Default constructed expression is "0 9 * * 1" — check the text input.
    const input = page.locator('input[type="text"]').first();
    await expect(input).toHaveValue("0 9 * * 1");
    // Description renders the human-readable explanation.
    await expect(page.getByText(/At 09:00 on Mon/)).toBeVisible();
  });

  test("cron generator updates description when the expression changes", async ({ page }) => {
    await page.goto("/cron-expression-generator");
    const input = page.locator('input[type="text"]').first();
    await input.fill("0 0 * * *");
    await expect(page.getByText(/At 00:00/)).toBeVisible();
  });

  test("timestamp converter emits all four formats from 'Now'", async ({ page }) => {
    await page.goto("/timestamp-converter");
    await page.getByRole("button", { name: "Now", exact: true }).click();

    // After clicking Now, every input should be populated and synced.
    const fields = page.locator('input[type="text"]');
    const unixSec = await fields.nth(0).inputValue();
    const unixMs = await fields.nth(1).inputValue();
    const iso = await fields.nth(2).inputValue();
    const human = await fields.nth(3).inputValue();

    expect(unixSec).toMatch(/^\d{10}$/);
    expect(unixMs).toMatch(/^\d{13}$/);
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(human.length).toBeGreaterThan(0);
    // sec and ms must agree to within 1s.
    expect(Math.abs(Number(unixMs) / 1000 - Number(unixSec))).toBeLessThan(1.1);
  });

  test("timestamp converter parses a known unix seconds value", async ({ page }) => {
    await page.goto("/timestamp-converter");
    const fields = page.locator('input[type="text"]');
    await fields.nth(0).fill("1700000000");
    // ISO should resolve to 2023-11-14T22:13:20.000Z (UTC).
    await expect(fields.nth(2)).toHaveValue("2023-11-14T22:13:20.000Z");
  });

  test("text diff highlights additions and deletions", async ({ page }) => {
    await page.goto("/text-diff");
    await page.getByPlaceholder("Paste original text...").fill("hello world");
    await page.getByPlaceholder("Paste modified text...").fill("hello brave world");

    // Added word should appear in a span tagged with the success class.
    await expect(page.locator("span.bg-success\\/20")).toContainText("brave");
  });

  test("text case converter cycles through every case", async ({ page }) => {
    await page.goto("/text-case-converter");
    await page.locator("textarea").first().fill("hello world example");

    const cases: Array<[string, string]> = [
      ["UPPERCASE", "HELLO WORLD EXAMPLE"],
      ["lowercase", "hello world example"],
      ["Title Case", "Hello World Example"],
      ["camelCase", "helloWorldExample"],
      ["snake_case", "hello_world_example"],
      ["kebab-case", "hello-world-example"],
      ["PascalCase", "HelloWorldExample"],
    ];

    for (const [button, expected] of cases) {
      await page.getByRole("button", { name: button, exact: true }).click();
      const output = page.locator("textarea[readonly]");
      await expect(output).toHaveValue(expected);
    }
  });

  test("word counter computes characters / words / sentences", async ({ page }) => {
    await page.goto("/word-counter");
    await page
      .getByPlaceholder(/Start typing/)
      .fill("Hello world. This is a sentence! And another?");

    // Stat tiles render value + label; assert by looking up the value next to
    // each label. Words = 8, characters = 45, sentences = 3, paragraphs = 1.
    await expect(page.getByText("Words").locator("..").locator(".font-mono")).toHaveText("8");
    await expect(page.getByText("Characters", { exact: true }).locator("..").locator(".font-mono")).toHaveText("45");
    await expect(
      page.getByText("Sentences").locator("..").locator(".font-mono"),
    ).toHaveText("3");
  });
});
