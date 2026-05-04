import { test, expect } from "@playwright/test";

test.describe("CSS tools", () => {
  test("color picker round-trips HEX → RGB → HSL", async ({ page }) => {
    await page.goto("/color-picker");

    // The HEX input is the only text input; default value is the brand teal.
    const hexInput = page.locator('input[type="text"]').first();
    await hexInput.fill("#ff0000");
    await hexInput.blur();

    // RGB is split across three number inputs; check the first three values.
    const rgbInputs = page.locator('input[type="number"]');
    await expect(rgbInputs.nth(0)).toHaveValue("255"); // R
    await expect(rgbInputs.nth(1)).toHaveValue("0"); // G
    await expect(rgbInputs.nth(2)).toHaveValue("0"); // B

    // HSL inputs follow RGB.
    await expect(rgbInputs.nth(3)).toHaveValue("0"); // H
    await expect(rgbInputs.nth(4)).toHaveValue("100"); // S
    await expect(rgbInputs.nth(5)).toHaveValue("50"); // L
  });

  test("CSS gradient generator emits valid CSS for the chosen type", async ({ page }) => {
    await page.goto("/css-gradient-generator");

    const code = page.locator("code");
    await expect(code).toContainText("background:");
    await expect(code).toContainText("linear-gradient(");

    await page.getByRole("button", { name: "Radial" }).click();
    await expect(code).toContainText("radial-gradient(circle,");

    await page.getByRole("button", { name: "Conic" }).click();
    await expect(code).toContainText("conic-gradient(from");
  });

  test("Box shadow generator emits parseable box-shadow", async ({ page }) => {
    await page.goto("/box-shadow-generator");
    const code = page.locator("code");
    await expect(code).toContainText("box-shadow:");
    // Default has y=4, blur=16; rgba alpha 0.25.
    await expect(code).toContainText("rgba(0, 0, 0, 0.25)");
  });
});
