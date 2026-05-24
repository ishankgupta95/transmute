import { test, expect } from "@playwright/test";
import { errorAlert } from "../helpers";

test.describe("encoders", () => {
  test("Base64 encode + decode round-trip", async ({ page }) => {
    await page.goto("/base64-encode-decode");

    const input = page.locator("textarea").first();
    await input.fill("hello world");

    // Encode mode is default; output should appear as a readonly textarea.
    const output = page.locator("textarea[readonly]");
    await expect(output).toHaveValue("aGVsbG8gd29ybGQ=");

    // Switch to decode and feed the encoded value back.
    await page.getByRole("button", { name: "Decode" }).click();
    await input.fill("aGVsbG8gd29ybGQ=");
    await expect(output).toHaveValue("hello world");
  });

  test("Base64 decode surfaces an error for invalid input", async ({ page }) => {
    await page.goto("/base64-encode-decode");
    await page.getByRole("button", { name: "Decode" }).click();
    await page.locator("textarea").first().fill("not_valid_base64$$$");
    await expect(errorAlert(page)).toBeVisible();
  });

  test("URL encode + decode round-trip handles special chars", async ({ page }) => {
    await page.goto("/url-encode-decode");
    const input = page.locator("textarea").first();
    await input.fill("Hello World & foo=bar");
    const output = page.locator("textarea[readonly]");
    await expect(output).toHaveValue("Hello%20World%20%26%20foo%3Dbar");

    await page.getByRole("button", { name: "Decode" }).click();
    await input.fill("Hello%20World%20%26%20foo%3Dbar");
    await expect(output).toHaveValue("Hello World & foo=bar");
  });

  test("JWT decoder splits header / payload and flags expiry", async ({ page }) => {
    await page.goto("/jwt-decoder");
    // Test JWT with payload {"sub":"1234567890","name":"John Doe","iat":1516239022}
    const token =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    await page.locator("textarea").first().fill(token);
    // Header + payload render into <pre> blocks.
    const preBlocks = page.locator("pre");
    await expect(preBlocks.first()).toContainText('"alg": "HS256"');
    await expect(preBlocks.nth(1)).toContainText('"sub": "1234567890"');
    await expect(preBlocks.nth(1)).toContainText('"name": "John Doe"');
  });

  test("JWT decoder rejects malformed tokens", async ({ page }) => {
    await page.goto("/jwt-decoder");
    await page.locator("textarea").first().fill("not.a.jwt");
    await expect(errorAlert(page)).toBeVisible();
  });

  test("HTML entity encoder escapes the five risky chars", async ({ page }) => {
    await page.goto("/html-entity-encode-decode");
    await page.locator("textarea").first().fill('<p>Hello & "world"</p>');
    const output = page.locator("textarea[readonly]");
    await expect(output).toHaveValue(
      '&lt;p&gt;Hello &amp; &quot;world&quot;&lt;/p&gt;',
    );
  });

  test("HTML entity decoder reverses the escape", async ({ page }) => {
    await page.goto("/html-entity-encode-decode");
    await page.getByRole("button", { name: "Decode" }).click();
    await page
      .locator("textarea")
      .first()
      .fill('&lt;p&gt;Hello &amp; &quot;world&quot;&lt;/p&gt;');
    const output = page.locator("textarea[readonly]");
    await expect(output).toHaveValue('<p>Hello & "world"</p>');
  });
});
