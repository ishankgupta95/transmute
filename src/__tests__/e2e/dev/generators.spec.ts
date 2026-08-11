import { test, expect } from "@playwright/test";
import { waitForDownload, downloadBytes, errorAlert } from "../helpers";

test.describe("generators", () => {
  test("UUID v4 generator emits valid v4 UUIDs", async ({ page }) => {
    await page.goto("/uuid-generator");
    await page.getByRole("button", { name: /Generate/ }).click();

    // One UUID by default; check the rendered <code> matches the v4 shape.
    const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const uuid = await page.locator("code").first().innerText();
    expect(uuid).toMatch(v4);
  });

  test("UUID v7 generator emits version-7 UUIDs", async ({ page }) => {
    await page.goto("/uuid-generator");
    await page.getByRole("button", { name: "UUID v7", exact: true }).click();
    await page.getByRole("button", { name: /Generate/, exact: true }).click();

    const v7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const uuid = await page.locator("code").first().innerText();
    expect(uuid).toMatch(v7);
  });

  test("UUID generator can produce a batch", async ({ page }) => {
    await page.goto("/uuid-generator");
    // The count control is a ToolChoice chip group, not a <select>.
    await page.getByRole("button", { name: "10", exact: true }).click();
    await page.getByRole("button", { name: /Generate/, exact: true }).click();
    await expect(page.locator("code")).toHaveCount(10);
  });

  test("Password generator respects length and character set", async ({ page }) => {
    await page.goto("/password-generator");

    // Use the range slider via the React-friendly setter trick — direct
    // assignment doesn't trigger React's onChange.
    const slider = page.locator('input[type="range"]');
    await slider.evaluate((el: HTMLInputElement) => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(el, "24");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await expect(page.getByText("24", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Generate", exact: true }).click();
    const pw = await page.locator("code").first().innerText();
    expect(pw.length).toBe(24);
    // With all char-types on, should contain at least one digit + symbol.
    expect(pw).toMatch(/\d/);
    expect(pw).toMatch(/[^a-zA-Z0-9]/);
  });

  test("Password generator errors when no character types are selected", async ({ page }) => {
    await page.goto("/password-generator");
    // Uncheck each character-class option by its label. Iterating over a
    // raw `input[type="checkbox"]` collection is fragile because React
    // re-renders shift the locator; labels are stable.
    for (const label of ["Uppercase", "Lowercase", "Numbers", "Symbols"]) {
      const cb = page.getByLabel(label);
      if (await cb.isChecked()) await cb.uncheck();
    }
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(errorAlert(page)).toBeVisible();
  });

  test("Hash generator produces a known SHA-256 for known input", async ({ page }) => {
    await page.goto("/hash-generator");
    await page.locator("textarea").first().fill("abc");

    // SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    await expect(
      page.locator("code", {
        hasText: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      }),
    ).toBeVisible();
  });

  test("Lorem ipsum generator emits the requested unit count", async ({ page }) => {
    await page.goto("/lorem-ipsum-generator");

    // Default: 3 paragraphs.
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    const text = await page.getByText(/Lorem ipsum/).first().innerText();
    // Three paragraphs = at least 2 blank-line separators.
    expect(text.split(/\n\n/).length).toBe(3);

    // Switch to "words" and assert word count.
    await page.getByRole("button", { name: "Words" }).click();
    await page.locator('input[type="number"]').fill("20");
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    const wordsText = await page.locator(".whitespace-pre-wrap").innerText();
    // generateWords appends a trailing period.
    const cleaned = wordsText.replace(/\.$/, "").trim();
    expect(cleaned.split(/\s+/).length).toBe(20);
  });

  test("QR code generator renders a canvas and downloads PNG", async ({ page }) => {
    await page.goto("/qr-code-generator");
    await page.locator("textarea").first().fill("https://transmute.tools");
    await page.getByRole("button", { name: "Generate QR Code" }).click();

    // The canvas becomes visible (loses the 'hidden' class) once data is set.
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();

    const { suggestedFilename, download } = await waitForDownload(
      page,
      page.getByRole("button", { name: "Download PNG" }),
    );
    expect(suggestedFilename).toMatch(/\.png$/);
    const bytes = await downloadBytes(download);
    // PNG magic bytes
    expect(bytes.subarray(0, 4).toString("hex")).toBe("89504e47");
  });

  test("QR code generator can download SVG", async ({ page }) => {
    await page.goto("/qr-code-generator");
    await page.locator("textarea").first().fill("https://transmute.tools");
    await page.getByRole("button", { name: "Generate QR Code" }).click();

    const { suggestedFilename, download } = await waitForDownload(
      page,
      page.getByRole("button", { name: "Download SVG" }),
    );
    expect(suggestedFilename).toMatch(/\.svg$/);
    const bytes = await downloadBytes(download);
    expect(bytes.toString("utf8").slice(0, 5)).toMatch(/<\?xml|<svg/);
  });
});
